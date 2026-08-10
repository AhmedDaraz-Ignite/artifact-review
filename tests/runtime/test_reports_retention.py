#!/usr/bin/env python3
"""Reports, archives, retention, and delayed shutdown contract tests."""

import hashlib
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skills" / "artifact-review" / "scripts"
AREV = SCRIPTS / "arev.py"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import reports
from review_store import ReviewStore
import server as SERVER
from versioning import REPORT_SCHEMA, STATE_SCHEMA, TOOL_VERSION


class ReportRetentionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q"], cwd=self.repo, check=True)
        subprocess.run(
            ["git", "config", "user.email", "review@example.test"],
            cwd=self.repo, check=True)
        subprocess.run(
            ["git", "config", "user.name", "Review Test"],
            cwd=self.repo, check=True)
        self.artifact = self.repo / "artifact.html"
        self.artifact.write_text("<main>version one</main>\n", encoding="utf-8")
        subprocess.run(["git", "add", "artifact.html"], cwd=self.repo, check=True)
        subprocess.run(
            ["git", "commit", "-qm", "Add artifact"], cwd=self.repo, check=True)
        self.commit = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=self.repo, check=True,
            capture_output=True, text=True).stdout.strip()
        self.artifact.write_text(
            "<main>version two</main>\n", encoding="utf-8")

        self.state_root = self.root / "state"
        session_key = hashlib.sha1(
            str(self.artifact.resolve()).encode()).hexdigest()[:12]
        self.session_dir = self.state_root / "sessions" / session_key
        self.session_dir.mkdir(parents=True)
        self.store = ReviewStore(str(self.session_dir), STATE_SCHEMA)
        self.store.set_session_info(artifact_path=str(self.artifact))
        blob_dir = self.session_dir / "whiteboards" / "blobs"
        blob_dir.mkdir(parents=True)
        self.scene_bytes = b'{"elements":[]}'
        self.scene_hash = hashlib.sha256(self.scene_bytes).hexdigest()
        self.scene_path = blob_dir / f"{self.scene_hash}.excalidraw"
        self.scene_path.write_bytes(self.scene_bytes)
        state = ReviewStore.empty_state()
        state.update({
            "ended": True,
            "ended_by": "user",
            "audit": {"status": "clear", "findings": []},
            "feed": [
                {
                    "id": "feedback-1", "role": "human", "ts": 10.0,
                    "status": "answered", "delivered_at": 11.0,
                    "answered_at": 12.0,
                    "items": [{
                        "qid": "diagram-1", "kind": "whiteboard",
                        "id": "diagram", "summary": "Move the retry path",
                        "scene_path": str(self.scene_path),
                        "scene_hash": self.scene_hash,
                    }],
                },
                {
                    "id": "reply-1", "role": "agent", "ts": 12.0,
                    "text": "Updated the retry path.",
                    "reply_to": "feedback-1",
                },
            ],
            "agent": {"status": "offline", "last_seen": 12.0},
        })
        self.store.sync(state)
        self.store.close()

    def tearDown(self):
        self.temp.cleanup()

    def test_json_and_markdown_reports_are_versioned_complete_and_stable(self):
        report = reports.build_report(
            str(self.artifact), str(self.session_dir))
        expected_hash = hashlib.sha256(self.artifact.read_bytes()).hexdigest()
        self.assertEqual(report["schema"], REPORT_SCHEMA)
        self.assertEqual(report["tool_version"], TOOL_VERSION)
        self.assertEqual(report["artifact"]["path"], str(self.artifact.resolve()))
        self.assertEqual(report["artifact"]["sha256"], expected_hash)
        self.assertEqual(report["git"]["commit"], self.commit)
        self.assertTrue(report["git"]["dirty"])
        self.assertEqual(
            [entry["id"] for entry in report["activity"]],
            ["feedback-1", "reply-1"],
        )
        self.assertEqual(report["activity"][0]["delivered_at"], 11.0)
        self.assertEqual(report["activity"][0]["answered_at"], 12.0)
        self.assertEqual(report["snapshots"][0]["scene_hash"], self.scene_hash)
        self.assertEqual(
            report["snapshots"][0]["scene_archive_path"],
            f"blobs/{self.scene_path.name}",
        )

        first_json = reports.render_report(report, "json")
        second_json = reports.render_report(
            reports.build_report(str(self.artifact), str(self.session_dir)),
            "json",
        )
        self.assertEqual(first_json, second_json)
        self.assertEqual(json.loads(first_json), report)
        markdown = reports.render_report(report, "markdown")
        self.assertIn("# Artifact review report", markdown)
        self.assertIn("Updated the retry path.", markdown)
        self.assertIn(self.scene_hash, markdown)

    def test_archive_contains_database_report_and_blobs_but_not_artifact(self):
        archive = self.root / "review.zip"
        result = reports.write_archive(
            str(self.artifact), str(self.session_dir), str(archive))
        self.assertEqual(pathlib.Path(result), archive.resolve())
        with zipfile.ZipFile(archive) as bundle:
            names = set(bundle.namelist())
            self.assertIn("review.sqlite3", names)
            self.assertIn("report.json", names)
            self.assertIn(f"blobs/{self.scene_path.name}", names)
            self.assertNotIn("artifact.html", names)
            self.assertEqual(
                json.loads(bundle.read("report.json"))["schema"], REPORT_SCHEMA)
            self.assertNotIn(self.artifact.read_bytes(), [
                bundle.read(name) for name in names
                if not name.endswith("/")
            ])
        with self.assertRaises(ValueError):
            reports.write_archive(
                str(self.artifact), str(self.session_dir),
                str(self.session_dir / "review.sqlite3"),
            )

    def test_cli_exposes_report_archive_and_dry_run_prune(self):
        environment = {**os.environ, "ARTIFACT_REVIEW_HOME": str(self.state_root)}
        report = subprocess.run(
            [sys.executable, str(AREV), "report", str(self.artifact)],
            check=True, capture_output=True, text=True, env=environment)
        self.assertEqual(json.loads(report.stdout)["schema"], REPORT_SCHEMA)

        markdown_path = self.root / "review.md"
        subprocess.run([
            sys.executable, str(AREV), "report", str(self.artifact),
            "--format", "markdown", "-o", str(markdown_path),
        ], check=True, capture_output=True, text=True, env=environment)
        self.assertIn("# Artifact review report", markdown_path.read_text())

        archive_path = self.root / "cli-review.zip"
        subprocess.run([
            sys.executable, str(AREV), "archive", str(self.artifact),
            "-o", str(archive_path),
        ], check=True, capture_output=True, text=True, env=environment)
        self.assertTrue(archive_path.is_file())

        preview = subprocess.run([
            sys.executable, str(AREV), "prune", "--older-than", "0",
        ], check=True, capture_output=True, text=True, env=environment)
        value = json.loads(preview.stdout)
        self.assertFalse(value["apply"])
        self.assertEqual(len(value["candidates"]), 1)
        self.assertTrue(self.session_dir.is_dir())

    def test_prune_is_dry_run_by_default_and_refuses_unsafe_paths(self):
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "keep.txt").write_text("keep", encoding="utf-8")
        symlink = self.state_root / "sessions" / "escape"
        symlink.symlink_to(outside, target_is_directory=True)
        running_dir = self.state_root / "sessions" / "running-ended"
        running_store = ReviewStore(str(running_dir), STATE_SCHEMA)
        running_store.set_session_info(str(self.artifact))
        running_state = ReviewStore.empty_state()
        running_state["ended"] = True
        running_state["ended_by"] = "agent"
        running_store.sync(running_state)
        running_store.close()

        preview = reports.prune_sessions(
            str(self.state_root), older_than_days=0, apply=False,
            running_session_dirs={str(running_dir)}, now=time.time() + 1)
        self.assertEqual(
            [pathlib.Path(item["session_dir"]).name
             for item in preview["candidates"]],
            [self.session_dir.name],
        )
        self.assertEqual(
            [pathlib.Path(path).name for path in preview["refused"]],
            ["escape"],
        )
        self.assertTrue(self.session_dir.exists())
        self.assertTrue(outside.exists())

        applied = reports.prune_sessions(
            str(self.state_root), older_than_days=0, apply=True,
            running_session_dirs={str(running_dir)}, now=time.time() + 1)
        self.assertEqual(applied["removed_count"], 1)
        self.assertFalse(self.session_dir.exists())
        self.assertTrue(running_dir.is_dir())
        self.assertTrue((outside / "keep.txt").is_file())


class DelayedShutdownTests(unittest.TestCase):
    def setUp(self):
        self.previous_state = dict(SERVER.STATE)
        self.previous_delay = getattr(SERVER, "END_SHUTDOWN_DELAY", None)
        self.previous_timer = getattr(SERVER, "SHUTDOWN_TIMER", None)
        self.previous_instance = SERVER.INSTANCE_ID
        self.previous_poll = SERVER.LAST_PAGE_POLL
        self.previous_watched = SERVER.MAX_WATCHED_SHUTDOWN_DELAY
        SERVER.END_SHUTDOWN_DELAY = 0.05
        SERVER.SHUTDOWN_TIMER = None
        SERVER.LAST_PAGE_POLL = 0.0
        SERVER.STATE["ended"] = True

    def tearDown(self):
        with SERVER.STATE_LOCK:
            SERVER._cancel_shutdown_locked()
        SERVER.STATE.clear()
        SERVER.STATE.update(self.previous_state)
        SERVER.INSTANCE_ID = self.previous_instance
        SERVER.LAST_PAGE_POLL = self.previous_poll
        SERVER.MAX_WATCHED_SHUTDOWN_DELAY = self.previous_watched
        if self.previous_delay is not None:
            SERVER.END_SHUTDOWN_DELAY = self.previous_delay
        SERVER.SHUTDOWN_TIMER = self.previous_timer

    def _schedule(self):
        """Arm the delayed shutdown and return the event its server sets."""
        called = threading.Event()

        class FakeServer:
            shutdown = called.set

        with SERVER.STATE_LOCK:
            SERVER._schedule_shutdown_locked(FakeServer())
        return called

    def test_reopen_cancels_delayed_shutdown(self):
        called = self._schedule()
        with SERVER.STATE_LOCK:
            SERVER.STATE["ended"] = False
            SERVER._cancel_shutdown_locked()
        self.assertFalse(called.wait(0.15))

    def test_timer_stops_only_the_same_ended_instance(self):
        self.assertTrue(self._schedule().wait(0.5))

        SERVER.STATE["ended"] = True
        called = self._schedule()
        with SERVER.STATE_LOCK:
            SERVER.INSTANCE_ID = "replacement-instance"
        self.assertFalse(called.wait(0.15))

    def _poll_until(self, called, seconds):
        deadline = time.time() + seconds
        while time.time() < deadline and not called.is_set():
            SERVER.LAST_PAGE_POLL = time.time()
            time.sleep(0.05)

    def test_a_polling_page_holds_an_ended_session_open(self):
        # The refresh loop needs a wide margin over the delay on a loaded runner.
        SERVER.END_SHUTDOWN_DELAY = 0.25
        called = self._schedule()
        self._poll_until(called, 1.0)
        self.assertFalse(called.is_set())
        SERVER.LAST_PAGE_POLL = 0.0
        self.assertTrue(called.wait(1.0))

    def test_a_forgotten_tab_cannot_hold_the_session_open_forever(self):
        SERVER.END_SHUTDOWN_DELAY = 0.25
        SERVER.MAX_WATCHED_SHUTDOWN_DELAY = 0.5
        called = self._schedule()
        self._poll_until(called, 2.0)
        self.assertTrue(called.is_set())


if __name__ == "__main__":
    unittest.main()
