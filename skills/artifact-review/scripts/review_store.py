"""Incremental SQLite persistence for one artifact-review session."""

import copy
import hashlib
import json
import os
import sqlite3
import threading
from datetime import datetime, timezone


DATABASE_NAME = "review.sqlite3"
LEGACY_NAME = "session.json"
SCALAR_KEYS = ("ended", "ended_by", "audit", "agent")


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False)


def _decode(value):
    return json.loads(value)


def _stamp():
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def _legacy_id(kind, index, value):
    digest = hashlib.sha256(
        f"{kind}:{index}:".encode("utf-8") + _json(value).encode("utf-8")
    ).hexdigest()[:20]
    return f"legacy-{kind}-{digest}"


class ReviewStore:
    """A normalized, transactional store for one in-memory review state.

    The HTTP server still owns the state machine. This class deliberately has
    no business rules: it diffs fixed-shape state into individual rows, making
    each logical server mutation one small SQLite transaction.
    """

    def __init__(self, session_dir, state_schema):
        if not isinstance(state_schema, int) or state_schema < 1:
            raise ValueError("state_schema must be a positive integer")
        self.session_dir = os.path.realpath(session_dir)
        self.path = os.path.join(self.session_dir, DATABASE_NAME)
        self.state_schema = state_schema
        self._lock = threading.RLock()
        self._closed = False
        os.makedirs(self.session_dir, exist_ok=True)
        new_store = not os.path.exists(self.path) or os.path.getsize(self.path) == 0
        self._conn, recovered = self._open_or_recover()
        new_store = new_store or recovered
        self._configure()
        self._initialise_schema()
        self._activity_cache = None
        self._last_state = self._load_unlocked()
        if new_store:
            self._migrate_legacy()
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    @staticmethod
    def empty_state():
        return {
            "ended": False,
            "ended_by": None,
            "queue": [],
            "audit": {"status": "pending", "findings": []},
            "feed": [],
            "events": [],
            "agent": {"status": "offline", "last_seen": None},
        }

    def _connect(self):
        return sqlite3.connect(
            self.path,
            timeout=5,
            isolation_level=None,
            check_same_thread=False,
        )

    def _open_or_recover(self):
        connection = None
        existed = os.path.exists(self.path) and os.path.getsize(self.path) > 0
        try:
            connection = self._connect()
            if existed:
                result = connection.execute("PRAGMA quick_check").fetchone()
                if not result or result[0] != "ok":
                    raise sqlite3.DatabaseError(
                        "review store integrity check failed")
            return connection, False
        except sqlite3.DatabaseError:
            if connection is not None:
                connection.close()
            if not existed:
                raise
            self._quarantine_database()
            return self._connect(), True

    def _quarantine_database(self):
        suffix = _stamp()
        quarantine = os.path.join(
            self.session_dir, f"review.corrupt.{suffix}.sqlite3")
        os.replace(self.path, quarantine)
        for sidecar in ("-wal", "-shm"):
            source = self.path + sidecar
            if os.path.exists(source):
                os.replace(source, quarantine + sidecar)

    def _configure(self):
        self._conn.execute("PRAGMA busy_timeout=5000")
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA synchronous=FULL")
        self._conn.execute("PRAGMA foreign_keys=ON")

    def _initialise_schema(self):
        empty = self.empty_state()
        self._conn.execute("BEGIN IMMEDIATE")
        try:
            statements = (
                """CREATE TABLE IF NOT EXISTS meta (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                )""",
                """CREATE TABLE IF NOT EXISTS queue_items (
                    item_id TEXT PRIMARY KEY,
                    position INTEGER NOT NULL,
                    payload_json TEXT NOT NULL
                )""",
                """CREATE INDEX IF NOT EXISTS queue_position
                    ON queue_items(position)""",
                """CREATE TABLE IF NOT EXISTS feed_items (
                    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                    item_id TEXT NOT NULL UNIQUE,
                    payload_json TEXT NOT NULL
                )""",
                """CREATE TABLE IF NOT EXISTS agent_events (
                    item_id TEXT PRIMARY KEY,
                    position INTEGER NOT NULL,
                    payload_json TEXT NOT NULL
                )""",
                """CREATE INDEX IF NOT EXISTS event_position
                    ON agent_events(position)""",
                """CREATE TABLE IF NOT EXISTS migrations (
                    name TEXT PRIMARY KEY,
                    applied_at TEXT NOT NULL
                )""",
            )
            for statement in statements:
                self._conn.execute(statement)
            stored = self._conn.execute(
                "SELECT value_json FROM meta WHERE key='state_schema'"
            ).fetchone()
            if stored is not None and _decode(stored[0]) != self.state_schema:
                raise RuntimeError(
                    "review store schema does not match this tool version")
            values = {"state_schema": self.state_schema}
            values.update({key: empty[key] for key in SCALAR_KEYS})
            for key, value in values.items():
                self._conn.execute(
                    "INSERT OR IGNORE INTO meta(key, value_json) VALUES (?, ?)",
                    (key, _json(value)),
                )
            self._conn.execute(
                "INSERT OR IGNORE INTO migrations(name, applied_at) VALUES (?, ?)",
                (f"schema-v{self.state_schema}",
                 datetime.now(timezone.utc).isoformat()),
            )
            self._conn.execute("COMMIT")
        except Exception:
            self._conn.execute("ROLLBACK")
            raise

    def _migrate_legacy(self):
        path = os.path.join(self.session_dir, LEGACY_NAME)
        if not os.path.exists(path):
            return
        try:
            with open(path, encoding="utf-8") as handle:
                saved = json.load(handle)
            if not isinstance(saved, dict):
                raise ValueError("legacy session must contain an object")
            migrated = self.empty_state()
            for key in SCALAR_KEYS:
                if key in saved:
                    migrated[key] = saved[key]
            for key in ("queue", "feed", "events"):
                if isinstance(saved.get(key), list):
                    migrated[key] = saved[key]
            self.sync(migrated)
            with self._lock:
                self._conn.execute(
                    "INSERT OR IGNORE INTO migrations(name, applied_at) "
                    "VALUES (?, ?)",
                    ("legacy-session-json-v1",
                     datetime.now(timezone.utc).isoformat()),
                )
            target = os.path.join(self.session_dir, "session.legacy.json")
            if os.path.exists(target):
                target = os.path.join(
                    self.session_dir, f"session.legacy.{_stamp()}.json")
            os.replace(path, target)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            if os.path.exists(path):
                os.replace(path, os.path.join(
                    self.session_dir, f"session.corrupt.{_stamp()}.json"))

    @staticmethod
    def _normalise_state(state):
        if not isinstance(state, dict):
            raise TypeError("review state must be an object")
        empty = ReviewStore.empty_state()
        result = {
            key: copy.deepcopy(state.get(key, empty[key]))
            for key in empty
        }
        for key in ("queue", "feed", "events"):
            if not isinstance(result[key], list):
                raise TypeError(f"review state {key} must be a list")
            for index, item in enumerate(result[key]):
                if not isinstance(item, dict):
                    raise TypeError(f"review state {key} items must be objects")
                identity = "qid" if key == "queue" else "id"
                if not item.get(identity):
                    item[identity] = _legacy_id(key, index, item)
        if not isinstance(result["audit"], dict):
            raise TypeError("review state audit must be an object")
        if not isinstance(result["agent"], dict):
            raise TypeError("review state agent must be an object")
        return result

    def _load_unlocked(self):
        state = self.empty_state()
        for key, value_json in self._conn.execute(
                "SELECT key, value_json FROM meta"):
            if key in SCALAR_KEYS:
                state[key] = _decode(value_json)
        state["queue"] = [
            _decode(row[0]) for row in self._conn.execute(
                "SELECT payload_json FROM queue_items "
                "ORDER BY position, item_id")
        ]
        state["feed"] = [
            _decode(row[0]) for row in self._conn.execute(
                "SELECT payload_json FROM feed_items ORDER BY sequence")
        ]
        state["events"] = [
            _decode(row[0]) for row in self._conn.execute(
                "SELECT payload_json FROM agent_events "
                "ORDER BY position, item_id")
        ]
        return state

    def load(self):
        with self._lock:
            self._ensure_open()
            state = self._load_unlocked()
            self._last_state = copy.deepcopy(state)
            self._activity_cache = None
            return state

    def _sync_scalars(self, state):
        for key in SCALAR_KEYS:
            if state[key] == self._last_state[key]:
                continue
            self._conn.execute(
                "INSERT INTO meta(key, value_json) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json",
                (key, _json(state[key])),
            )

    def _sync_ordered(self, table, identity, current, previous):
        current_ids = {item[identity] for item in current}
        previous_by_id = {item[identity]: item for item in previous}
        for old_id in set(previous_by_id) - current_ids:
            self._conn.execute(
                f"DELETE FROM {table} WHERE item_id=?", (old_id,))
        previous_positions = {
            item[identity]: index for index, item in enumerate(previous)
        }
        for position, item in enumerate(current):
            item_id = item[identity]
            if (previous_by_id.get(item_id) == item
                    and previous_positions.get(item_id) == position):
                continue
            self._conn.execute(
                f"INSERT INTO {table}(item_id, position, payload_json) "
                "VALUES (?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET "
                "position=excluded.position, payload_json=excluded.payload_json",
                (item_id, position, _json(item)),
            )

    def _sync_feed(self, current, previous):
        current_ids = {item["id"] for item in current}
        previous_by_id = {item["id"]: item for item in previous}
        for old_id in set(previous_by_id) - current_ids:
            self._conn.execute(
                "DELETE FROM feed_items WHERE item_id=?", (old_id,))
        for item in current:
            item_id = item["id"]
            if previous_by_id.get(item_id) == item:
                continue
            self._conn.execute(
                "INSERT INTO feed_items(item_id, payload_json) VALUES (?, ?) "
                "ON CONFLICT(item_id) DO UPDATE SET "
                "payload_json=excluded.payload_json",
                (item_id, _json(item)),
            )

    def sync(self, state):
        normalised = self._normalise_state(state)
        with self._lock:
            self._ensure_open()
            feed_changed = normalised["feed"] != self._last_state["feed"]
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._sync_scalars(normalised)
                self._sync_ordered(
                    "queue_items", "qid", normalised["queue"],
                    self._last_state["queue"])
                self._sync_feed(normalised["feed"], self._last_state["feed"])
                self._sync_ordered(
                    "agent_events", "id", normalised["events"],
                    self._last_state["events"])
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise
            self._last_state = copy.deepcopy(normalised)
            if feed_changed:
                self._activity_cache = None

    def activity(self, before=None, limit=50):
        if not isinstance(limit, int) or isinstance(limit, bool):
            raise TypeError("activity limit must be an integer")
        limit = max(1, min(limit, 50))
        with self._lock:
            self._ensure_open()
            if before is None and limit == 50 and self._activity_cache is not None:
                return copy.deepcopy(self._activity_cache)
            if before is None:
                rows = self._conn.execute(
                    "SELECT sequence, payload_json FROM feed_items "
                    "ORDER BY sequence DESC LIMIT ?", (limit,)).fetchall()
            else:
                before = int(before)
                rows = self._conn.execute(
                    "SELECT sequence, payload_json FROM feed_items "
                    "WHERE sequence < ? ORDER BY sequence DESC LIMIT ?",
                    (before, limit),
                ).fetchall()
            rows.reverse()
            items = [_decode(row[1]) for row in rows]
            total = self._conn.execute(
                "SELECT count(*) FROM feed_items").fetchone()[0]
            if rows:
                cursor = rows[0][0]
                has_more = self._conn.execute(
                    "SELECT 1 FROM feed_items WHERE sequence < ? LIMIT 1",
                    (cursor,),
                ).fetchone() is not None
            else:
                cursor = None
                has_more = False
            page = {
                "items": items,
                "total": total,
                "next_before": cursor if has_more else None,
                "has_more": has_more,
            }
            if before is None and limit == 50:
                self._activity_cache = copy.deepcopy(page)
            return page

    def _ensure_open(self):
        if self._closed:
            raise RuntimeError("review store is closed")

    def close(self):
        with self._lock:
            if self._closed:
                return
            self._conn.close()
            self._closed = True
