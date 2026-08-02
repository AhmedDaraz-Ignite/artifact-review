#!/usr/bin/env python3
"""Focused unit and integration tests for the arev CLI foundation."""

import importlib.util
import io
import json
import multiprocessing
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
AREV_PATH = ROOT / "skills" / "artifact-review" / "scripts" / "arev.py"
SPEC = importlib.util.spec_from_file_location("arev_cli", AREV_PATH)
AREV = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AREV)


def load_arev(path, state_root, module_name):
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.STATE_ROOT = state_root
    module.REGISTRY = os.path.join(state_root, "registry.json")
    module.REGISTRY_LOCK = os.path.join(state_root, "registry.lock")
    return module


def registry_writer(path, state_root, key, ready, start):
    module = load_arev(path, state_root, f"arev_worker_{os.getpid()}")
    ready.put(key)
    if not start.wait(timeout=10):
        raise RuntimeError("registry writer start timed out")

    def add(registry):
        registry[key] = {"pid": os.getpid(), "port": 4000 + int(key)}

    module._update_registry(add)


def registry_entry_updater(path, state_root, artifact, value, ready, start):
    module = load_arev(path, state_root, f"arev_updater_{os.getpid()}")
    ready.put(value)
    if not start.wait(timeout=10):
        raise RuntimeError("registry updater start timed out")
    module._update_entry(artifact, last_event_id=value)


class ControlUrlTests(unittest.TestCase):
    def test_formats_reachable_ipv4_and_ipv6_control_urls(self):
        self.assertTrue(
            hasattr(AREV, "_control_url"),
            "arev must expose one control URL formatter",
        )
        self.assertEqual(
            AREV._control_url("0.0.0.0", 4321),
            "http://127.0.0.1:4321",
        )
        self.assertEqual(
            AREV._control_url("::", 4321),
            "http://[::1]:4321",
        )
        self.assertEqual(
            AREV._control_url("::1", 4321),
            "http://[::1]:4321",
        )
        self.assertEqual(
            AREV._control_url("review.local", 4321),
            "http://review.local:4321",
        )

    def test_api_uses_the_registered_control_url(self):
        class HostEchoHandler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                body = json.dumps({"host": self.headers["Host"]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = ThreadingHTTPServer(("127.0.0.1", 0), HostEchoHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]
            result = AREV._api({
                "port": port,
                "token": "test-token",
                "control_url": f"http://localhost:{port}",
            }, "GET", "/health")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.assertEqual(result["host"], f"localhost:{port}")

    def test_public_url_rejects_an_unimplemented_path_prefix(self):
        with self.assertRaises(SystemExit) as caught:
            AREV._public_url("https://reviews.example.test/artifact-review")
        self.assertIn("path prefix", str(caught.exception))
        self.assertEqual(
            AREV._public_url("https://reviews.example.test/"),
            "https://reviews.example.test/",
        )

    def test_session_url_falls_back_to_the_reachable_control_url(self):
        url = AREV._session_url({
            "port": 4321,
            "token": "secret",
            "bind": "::1",
            "control_url": "http://[::1]:4321",
        })
        self.assertEqual(url, "http://[::1]:4321/?t=secret")

    def test_ipv6_open_prints_and_uses_a_bracketed_loopback_url(self):
        probe = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
        try:
            probe.bind(("::1", 0))
        except OSError as error:
            self.skipTest(f"IPv6 loopback unavailable: {error}")
        finally:
            probe.close()

        with tempfile.TemporaryDirectory(prefix="arev-ipv6-") as state_root:
            artifact = os.path.join(state_root, "artifact.html")
            pathlib.Path(artifact).write_text(
                "<!doctype html><title>IPv6</title>",
                encoding="utf-8",
            )
            environment = {**os.environ, "ARTIFACT_REVIEW_HOME": state_root}
            module = load_arev(str(AREV_PATH), state_root, "arev_ipv6")
            entry = None
            try:
                opened = subprocess.run(
                    [
                        sys.executable,
                        str(AREV_PATH),
                        "open",
                        artifact,
                        "--no-browser",
                        "--bind",
                        "::1",
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                    env=environment,
                )
                entry = module._load_registry()[os.path.realpath(artifact)]
                self.assertIn("http://[::1]:", opened.stdout)
                self.assertEqual(entry["control_url"], f"http://[::1]:{entry['port']}")
                self.assertTrue(module._verified_health(entry))
            finally:
                if entry is not None:
                    try:
                        module._api(entry, "POST", "/shutdown", {})
                    except (OSError, ValueError, KeyError):
                        pass


class RegistryLockTests(unittest.TestCase):
    def test_concurrent_mutations_preserve_every_session(self):
        context = multiprocessing.get_context("spawn")
        with tempfile.TemporaryDirectory(prefix="arev-registry-test-") as state_root:
            ready = context.Queue()
            start = context.Event()
            workers = [
                context.Process(
                    target=registry_writer,
                    args=(str(AREV_PATH), state_root, str(index), ready, start),
                )
                for index in range(8)
            ]
            for worker in workers:
                worker.start()
            for _ in workers:
                ready.get(timeout=10)
            start.set()
            for worker in workers:
                worker.join(timeout=15)

            self.assertEqual(
                [worker.exitcode for worker in workers],
                [0] * len(workers),
                "every registry writer must complete",
            )
            with open(os.path.join(state_root, "registry.json"), encoding="utf-8") as handle:
                registry = json.load(handle)
            self.assertEqual(set(registry), {str(index) for index in range(8)})

    def test_command_entry_updates_share_the_atomic_mutation_boundary(self):
        context = multiprocessing.get_context("spawn")
        with tempfile.TemporaryDirectory(prefix="arev-entry-update-") as state_root:
            module = load_arev(str(AREV_PATH), state_root, "arev_entry_update")
            artifacts = [os.path.join(state_root, f"artifact-{index}.html") for index in range(8)]
            module._save_registry({
                os.path.realpath(artifact): {"pid": index + 1}
                for index, artifact in enumerate(artifacts)
            })
            ready = context.Queue()
            start = context.Event()
            workers = [
                context.Process(
                    target=registry_entry_updater,
                    args=(
                        str(AREV_PATH),
                        state_root,
                        artifact,
                        f"event-{index}",
                        ready,
                        start,
                    ),
                )
                for index, artifact in enumerate(artifacts)
            ]
            for worker in workers:
                worker.start()
            for _ in workers:
                ready.get(timeout=10)
            start.set()
            for worker in workers:
                worker.join(timeout=15)
            self.assertEqual([worker.exitcode for worker in workers], [0] * len(workers))

            registry = module._load_registry()
            self.assertEqual(
                {
                    registry[os.path.realpath(artifact)].get("last_event_id")
                    for artifact in artifacts
                },
                {f"event-{index}" for index in range(8)},
            )


class ServerIdentityTests(unittest.TestCase):
    def test_health_must_match_the_registered_server_identity(self):
        instance_id = "0c02e3df-5467-4cff-b5c5-ef50582fc435"

        class HealthHandler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                body = json.dumps({
                    "ok": True,
                    "instance_id": instance_id,
                }).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = ThreadingHTTPServer(("127.0.0.1", 0), HealthHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        entry = {
            "port": server.server_address[1],
            "token": "test-token",
            "control_url": f"http://127.0.0.1:{server.server_address[1]}",
            "instance_id": instance_id,
        }
        try:
            self.assertTrue(
                hasattr(AREV, "_verified_health"),
                "arev must verify server identity through authenticated health",
            )
            self.assertTrue(AREV._verified_health(entry))
            self.assertFalse(AREV._verified_health({**entry, "instance_id": "other"}))
            legacy = dict(entry)
            legacy.pop("instance_id")
            self.assertFalse(AREV._verified_health(legacy))
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def test_stop_removes_stale_record_without_signalling_its_pid(self):
        with tempfile.TemporaryDirectory(prefix="arev-stale-stop-") as state_root:
            artifact = os.path.join(state_root, "artifact.html")
            pathlib.Path(artifact).write_text("<!doctype html>", encoding="utf-8")
            module = load_arev(str(AREV_PATH), state_root, "arev_stale_stop")
            module._save_registry({
                os.path.realpath(artifact): {
                    "pid": os.getpid(),
                    "port": 1,
                    "token": "stale-token",
                    "control_url": "http://127.0.0.1:1",
                    "instance_id": "stale-instance",
                },
            })
            signal_attempts = []

            def record_signal(pid, signal_number):
                signal_attempts.append((pid, signal_number))

            output = io.StringIO()
            with mock.patch.object(module.os, "kill", side_effect=record_signal):
                with redirect_stdout(output):
                    module.cmd_stop(SimpleNamespace(
                        all=False,
                        file=artifact,
                    ))

            self.assertEqual(signal_attempts, [])
            self.assertEqual(module._load_registry(), {})
            self.assertIn("stale", output.getvalue().lower())

    def test_sessions_does_not_report_a_pid_only_record_as_running(self):
        with tempfile.TemporaryDirectory(prefix="arev-stale-list-") as state_root:
            artifact = os.path.join(state_root, "artifact.html")
            pathlib.Path(artifact).write_text("<!doctype html>", encoding="utf-8")
            module = load_arev(str(AREV_PATH), state_root, "arev_stale_list")
            module._save_registry({
                os.path.realpath(artifact): {
                    "pid": os.getpid(),
                    "port": 1,
                    "token": "stale-token",
                    "control_url": "http://127.0.0.1:1",
                    "instance_id": "stale-instance",
                },
            })
            output = io.StringIO()
            with mock.patch.object(module.os, "kill", return_value=None):
                with redirect_stdout(output):
                    module.cmd_sessions(SimpleNamespace())
            self.assertNotIn("running", output.getvalue())
            self.assertIn("stale", output.getvalue())
            self.assertEqual(module._load_registry(), {})

    def test_cli_open_records_identity_and_stop_shuts_that_server_down(self):
        with tempfile.TemporaryDirectory(prefix="arev-owned-stop-") as state_root:
            artifact = os.path.join(state_root, "artifact.html")
            pathlib.Path(artifact).write_text(
                "<!doctype html><title>owned server</title>",
                encoding="utf-8",
            )
            environment = {**os.environ, "ARTIFACT_REVIEW_HOME": state_root}
            entry = None
            module = load_arev(str(AREV_PATH), state_root, "arev_owned_stop")
            try:
                opened = subprocess.run(
                    [
                        sys.executable,
                        str(AREV_PATH),
                        "open",
                        artifact,
                        "--no-browser",
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                    env=environment,
                )
                registry = module._load_registry()
                entry = registry[os.path.realpath(artifact)]
                self.assertIn("SESSION", opened.stdout)
                self.assertIn(
                    "control_url",
                    entry,
                    "open must persist the authenticated local control URL",
                )
                self.assertEqual(
                    entry["control_url"],
                    f"http://127.0.0.1:{entry['port']}",
                )
                self.assertIn(
                    "instance_id",
                    entry,
                    "open must persist the server health identity",
                )
                self.assertRegex(
                    entry["instance_id"],
                    r"^[a-f0-9-]{36}$",
                )
                self.assertTrue(module._verified_health(entry))

                stopped = subprocess.run(
                    [sys.executable, str(AREV_PATH), "stop", artifact],
                    check=True,
                    capture_output=True,
                    text=True,
                    env=environment,
                )
                self.assertIn("stopped verified", stopped.stdout)
                deadline = time.monotonic() + 3
                while time.monotonic() < deadline and module._verified_health(entry):
                    time.sleep(0.05)
                self.assertFalse(module._verified_health(entry))
                self.assertEqual(module._load_registry(), {})
            finally:
                if entry is not None:
                    cleanup = dict(entry)
                    cleanup["control_url"] = cleanup.get("control_url") or module._control_url(
                        cleanup.get("bind", "127.0.0.1"), cleanup["port"])
                    try:
                        module._api(cleanup, "POST", "/shutdown", {})
                    except (OSError, ValueError, KeyError):
                        pass


class ServerIdentityConcurrencyTests(unittest.TestCase):
    def test_open_replaces_a_live_pid_with_the_wrong_server_identity(self):
        with tempfile.TemporaryDirectory(prefix="arev-stale-open-") as state_root:
            artifact = os.path.join(state_root, "artifact.html")
            pathlib.Path(artifact).write_text(
                "<!doctype html><title>stale owner</title>",
                encoding="utf-8",
            )
            environment = {**os.environ, "ARTIFACT_REVIEW_HOME": state_root}
            module = load_arev(str(AREV_PATH), state_root, "arev_stale_open")
            key = os.path.realpath(artifact)
            module._save_registry({
                key: {
                    "pid": os.getpid(),
                    "port": 1,
                    "token": "stale-token",
                    "control_url": "http://127.0.0.1:1",
                    "base_url": "http://127.0.0.1:1",
                    "instance_id": "stale-instance",
                },
            })
            replacement = None
            try:
                opened = subprocess.run(
                    [
                        sys.executable,
                        str(AREV_PATH),
                        "open",
                        artifact,
                        "--no-browser",
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                    env=environment,
                )
                replacement = module._load_registry()[key]
                self.assertNotIn(":1/", opened.stdout)
                self.assertNotEqual(replacement["instance_id"], "stale-instance")
                self.assertTrue(module._verified_health(replacement))
            finally:
                if replacement and module._verified_health(replacement):
                    try:
                        module._api(replacement, "POST", "/shutdown", {})
                    except (OSError, ValueError, KeyError):
                        pass

    def test_concurrent_opens_reuse_one_owned_server(self):
        with tempfile.TemporaryDirectory(prefix="arev-concurrent-open-") as state_root:
            artifact = os.path.join(state_root, "artifact.html")
            pathlib.Path(artifact).write_text(
                "<!doctype html><title>one owner</title>",
                encoding="utf-8",
            )
            environment = {**os.environ, "ARTIFACT_REVIEW_HOME": state_root}
            command = [
                sys.executable,
                str(AREV_PATH),
                "open",
                artifact,
                "--no-browser",
            ]
            processes = [
                subprocess.Popen(
                    command,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    env=environment,
                )
                for _ in range(8)
            ]
            results = []
            urls = []
            module = load_arev(str(AREV_PATH), state_root, "arev_concurrent_open")
            try:
                for process in processes:
                    stdout, stderr = process.communicate(timeout=20)
                    results.append((process.returncode, stdout, stderr))
                    if "SESSION " in stdout:
                        urls.append(stdout.split("SESSION ", 1)[1].split()[0])

                self.assertEqual(
                    [result[0] for result in results],
                    [0] * len(processes),
                    results,
                )
                self.assertEqual(len(urls), len(processes), results)
                origins = {module.urllib.parse.urlsplit(url).netloc for url in urls}
                self.assertEqual(len(origins), 1, results)
                registry = module._load_registry()
                self.assertEqual(len(registry), 1)
                self.assertTrue(module._verified_health(next(iter(registry.values()))))
            finally:
                for url in set(urls):
                    parts = module.urllib.parse.urlsplit(url)
                    cleanup = {
                        "control_url": f"{parts.scheme}://{parts.netloc}",
                        "token": module.urllib.parse.parse_qs(parts.query)["t"][0],
                    }
                    try:
                        module._api(cleanup, "POST", "/shutdown", {})
                    except (OSError, ValueError, KeyError):
                        pass


class PollHeartbeatTests(unittest.TestCase):
    def test_long_poll_refreshes_listening_after_every_server_chunk(self):
        now = [1000.0]
        calls = []

        def fake_api(entry, method, path, body=None, timeout=10):
            calls.append((method, path, body))
            if path.startswith("/next?"):
                query = AREV.urllib.parse.parse_qs(
                    AREV.urllib.parse.urlsplit(path).query)
                now[0] += float(query["timeout"][0])
                return {"type": "idle"}
            return {"ok": True}

        output = io.StringIO()
        with mock.patch.object(AREV, "_entry_for", return_value={"token": "test"}):
            with mock.patch.object(AREV, "_api", side_effect=fake_api):
                with mock.patch.object(AREV.time, "time", side_effect=lambda: now[0]):
                    with redirect_stdout(output):
                        AREV.cmd_poll(SimpleNamespace(
                            file="artifact.html",
                            agent_reply=None,
                            timeout=181,
                        ))

        poll_count = sum(path.startswith("/next?") for _, path, _ in calls)
        statuses = [
            body["status"]
            for method, path, body in calls
            if method == "POST" and path == "/agent-status"
        ]
        self.assertEqual(poll_count, 3)
        self.assertEqual(statuses, ["listening"] * 4 + ["idle"])
        self.assertEqual(json.loads(output.getvalue()), {"type": "idle"})

    def test_poll_error_attempts_offline_without_masking_the_original_failure(self):
        statuses = []

        def fake_api(entry, method, path, body=None, timeout=10):
            if path == "/agent-status":
                statuses.append(body["status"])
                return {"ok": True}
            if path.startswith("/next?"):
                raise AREV.urllib.error.URLError("synthetic disconnect")
            return {"ok": True}

        with mock.patch.object(AREV, "_entry_for", return_value={"token": "test"}):
            with mock.patch.object(AREV, "_api", side_effect=fake_api):
                with self.assertRaises(SystemExit) as caught:
                    AREV.cmd_poll(SimpleNamespace(
                        file="artifact.html",
                        agent_reply=None,
                        timeout=5,
                    ))

        self.assertEqual(statuses, ["listening", "offline"])
        self.assertIn("synthetic disconnect", str(caught.exception))


if __name__ == "__main__":
    unittest.main(verbosity=2)
