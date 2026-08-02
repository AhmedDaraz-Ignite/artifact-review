#!/usr/bin/env python3
"""Contract tests for the incremental, durable review session store."""

import copy
import json
import pathlib
import sqlite3
import sys
import tempfile
import threading
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills" / "artifact-review" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from review_store import ReviewStore
from versioning import STATE_SCHEMA


def sample_state():
    return {
        "ended": False,
        "ended_by": None,
        "queue": [
            {"qid": "queue-1", "kind": "chat", "text": "First", "ts": 1.0},
            {"qid": "queue-2", "kind": "chat", "text": "Second", "ts": 2.0},
        ],
        "audit": {"status": "clear", "findings": []},
        "feed": [
            {
                "id": "feedback-1",
                "role": "human",
                "ts": 3.0,
                "items": [{"qid": "sent-1", "kind": "chat", "text": "Sent"}],
                "status": "sent",
            },
            {
                "id": "reply-1",
                "role": "agent",
                "ts": 4.0,
                "text": "Reply",
                "reply_to": "feedback-1",
            },
        ],
        "events": [
            {
                "schema": "artifact-review/event/v1",
                "id": "feedback-1",
                "type": "feedback",
                "items": [{"qid": "sent-1", "kind": "chat", "text": "Sent"}],
                "sent_at": 3.0,
            }
        ],
        "agent": {"status": "idle", "last_seen": 5.0},
    }


class ReviewStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.session_dir = pathlib.Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def open_store(self):
        return ReviewStore(str(self.session_dir), STATE_SCHEMA)

    def table_count(self, table):
        with sqlite3.connect(self.session_dir / "review.sqlite3") as connection:
            return connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]

    def test_creates_hardened_schema_and_normalized_rows(self):
        store = self.open_store()
        try:
            store.sync(sample_state())
            pragmas = {
                "journal_mode": store._conn.execute("PRAGMA journal_mode").fetchone()[0],
                "synchronous": store._conn.execute("PRAGMA synchronous").fetchone()[0],
                "foreign_keys": store._conn.execute("PRAGMA foreign_keys").fetchone()[0],
            }
        finally:
            store.close()

        self.assertEqual(pragmas["journal_mode"].lower(), "wal")
        self.assertEqual(pragmas["synchronous"], 2)
        self.assertEqual(pragmas["foreign_keys"], 1)
        self.assertEqual(self.table_count("queue_items"), 2)
        self.assertEqual(self.table_count("feed_items"), 2)
        self.assertEqual(self.table_count("agent_events"), 1)
        self.assertEqual(self.table_count("migrations"), 1)

    def test_sync_appends_updates_and_deletes_only_normalized_rows(self):
        original = sample_state()
        store = self.open_store()
        try:
            store.sync(original)
            changed = copy.deepcopy(original)
            changed["queue"] = [changed["queue"][1], {
                "qid": "queue-3", "kind": "chat", "text": "Third", "ts": 6.0,
            }]
            changed["feed"][0]["status"] = "delivered"
            changed["feed"].append({
                "id": "reply-2", "role": "agent", "ts": 7.0,
                "text": "Another reply", "reply_to": "feedback-1",
            })
            changed["events"] = []
            changed["ended"] = True
            changed["ended_by"] = "user"
            store.sync(changed)
            restored = store.load()
        finally:
            store.close()

        self.assertEqual(restored, changed)
        self.assertEqual(self.table_count("queue_items"), 2)
        self.assertEqual(self.table_count("feed_items"), 3)
        self.assertEqual(self.table_count("agent_events"), 0)

    def test_sync_rolls_back_every_table_when_one_write_fails(self):
        original = sample_state()
        store = self.open_store()
        try:
            store.sync(original)
            store._conn.execute(
                "CREATE TRIGGER reject_event BEFORE INSERT ON agent_events "
                "BEGIN SELECT RAISE(ABORT, 'forced failure'); END"
            )
            changed = copy.deepcopy(original)
            changed["queue"].append({
                "qid": "queue-3", "kind": "chat", "text": "Third", "ts": 6.0,
            })
            changed["events"].append({
                "schema": "artifact-review/event/v1", "id": "feedback-2",
                "type": "feedback", "items": [], "sent_at": 7.0,
            })
            with self.assertRaises(sqlite3.DatabaseError):
                store.sync(changed)
            self.assertEqual(store.load(), original)
        finally:
            store.close()

    def test_committed_state_is_immediately_visible_to_concurrent_reader(self):
        store = self.open_store()
        reader = self.open_store()
        ready = threading.Event()
        observed = []

        def read_after_commit():
            ready.wait(timeout=2)
            observed.append(reader.load())

        thread = threading.Thread(target=read_after_commit)
        thread.start()
        try:
            expected = sample_state()
            store.sync(expected)
            ready.set()
            thread.join(timeout=2)
            self.assertFalse(thread.is_alive())
            self.assertEqual(observed, [expected])
        finally:
            store.close()
            reader.close()

    def test_valid_legacy_json_migrates_once_without_loss(self):
        expected = sample_state()
        legacy = self.session_dir / "session.json"
        legacy.write_text(json.dumps(expected), encoding="utf-8")

        store = self.open_store()
        try:
            self.assertEqual(store.load(), expected)
        finally:
            store.close()

        self.assertFalse(legacy.exists())
        self.assertTrue((self.session_dir / "session.legacy.json").is_file())
        self.assertEqual(self.table_count("migrations"), 2)

    def test_invalid_legacy_json_is_quarantined_not_overwritten(self):
        legacy = self.session_dir / "session.json"
        legacy.write_text("{broken", encoding="utf-8")

        store = self.open_store()
        try:
            self.assertEqual(store.load(), ReviewStore.empty_state())
        finally:
            store.close()

        quarantined = list(self.session_dir.glob("session.corrupt.*.json"))
        self.assertEqual(len(quarantined), 1)
        self.assertEqual(quarantined[0].read_text(encoding="utf-8"), "{broken")

    def test_corrupt_sqlite_is_quarantined_before_recovery(self):
        database = self.session_dir / "review.sqlite3"
        database.write_bytes(b"not a sqlite database")

        store = self.open_store()
        try:
            store.sync(sample_state())
            self.assertEqual(store.load(), sample_state())
        finally:
            store.close()

        quarantined = list(self.session_dir.glob("review.corrupt.*.sqlite3"))
        self.assertEqual(len(quarantined), 1)
        self.assertEqual(quarantined[0].read_bytes(), b"not a sqlite database")

    def test_restart_load_is_equivalent_and_activity_is_stably_paged(self):
        expected = sample_state()
        expected["feed"] = [
            {"id": f"feed-{index}", "role": "agent", "ts": float(index),
             "text": f"Reply {index}"}
            for index in range(125)
        ]
        store = self.open_store()
        store.sync(expected)
        store.close()

        reopened = self.open_store()
        try:
            self.assertEqual(reopened.load(), expected)
            newest = reopened.activity(before=None, limit=50)
            earlier = reopened.activity(before=newest["next_before"], limit=50)
            oldest = reopened.activity(before=earlier["next_before"], limit=50)
        finally:
            reopened.close()

        self.assertEqual([item["id"] for item in newest["items"]],
                         [f"feed-{index}" for index in range(75, 125)])
        self.assertEqual([item["id"] for item in earlier["items"]],
                         [f"feed-{index}" for index in range(25, 75)])
        self.assertEqual([item["id"] for item in oldest["items"]],
                         [f"feed-{index}" for index in range(25)])
        self.assertEqual(newest["total"], 125)
        self.assertTrue(newest["has_more"])
        self.assertFalse(oldest["has_more"])


if __name__ == "__main__":
    unittest.main()
