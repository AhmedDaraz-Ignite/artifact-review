#!/usr/bin/env python3
"""
One-process-per-artifact HTTP server used by the ``arev`` CLI.

The controller document at ``/`` owns all authenticated state and mutation
requests. The reviewed document at ``/artifact`` receives an injected,
tokenless ``/sdk.js`` and is expected to run in a sandboxed iframe. Those
assets and the static nested whiteboard frame are intentionally tokenless so
reviewed content never learns the controller token; Host validation still
applies. Every controller document, state request, and mutation requires the
per-session token. CORS is enabled only for the static nested-editor assets.

Agent consumers long-poll ``GET /next``. Feedback is persisted before waiters
are notified, leased until acknowledged, and replayed after a failed consumer.
The bind address defaults to loopback but may be changed explicitly for a
user-managed port forwarder. JSON requests are capped at 32 MiB and decoded
whiteboard PNGs at 20 MiB. Pure standard library; prints ``LISTENING <port>``
after binding successfully.
"""

import argparse
import base64
import binascii
import copy
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

VERSION = "0.1.0"
MAX_REQUEST_BYTES = 32 * 1024 * 1024
MAX_WHITEBOARD_PNG_BYTES = 20 * 1024 * 1024
MAX_WHITEBOARD_ID_LENGTH = 128
PUBLIC_REVIEW_PATHS = frozenset((
    "/artifact", "/sdk.js",
    "/whiteboard-frame", "/whiteboard.js", "/whiteboard.css",
))
WHITEBOARD_ID_RE = re.compile(
    rf"^[a-zA-Z0-9_-]{{1,{MAX_WHITEBOARD_ID_LENGTH}}}$")
SOURCE_HASH_RE = re.compile(r"^[0-9a-f]{16,64}$")
MERMAID_NODE_TARGET_LIMITS = {
    "diagramId": 256,
    "nodeId": 256,
    "label": 512,
    "selector": 2048,
}

STATE_LOCK = threading.Lock()
EVENTS_COND = threading.Condition(STATE_LOCK)

ARTIFACT = None          # absolute path of the reviewed file
SESSION_DIR = None
TOKEN = None
ASSET_DIR = None
ALLOWED_HOSTS = {"127.0.0.1", "localhost", "::1"}
STATE = {
    "version": 0,          # artifact file mtime_ns; chrome reloads on change
    "revision": 0,         # any state change; browser long-polls this value
    "ended": False,
    "ended_by": None,
    "queue": [],           # pending feedback items, not yet flushed
    "audit": {"status": "pending", "findings": []},
    "feed": [],            # chrome-visible history: flushes + agent replies
    "events": [],          # durable events waiting for an agent poll + ack
    "agent": {"status": "offline", "last_seen": None},
}

MIME = {".js": "application/javascript", ".mjs": "application/javascript",
        ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml",
        ".png": "image/png", ".json": "application/json",
        ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
        ".wasm": "application/wasm"}


def _persist_locked():
    tmp = os.path.join(SESSION_DIR, "session.json.tmp")
    out = {k: STATE[k] for k in
           ("ended", "ended_by", "queue", "audit", "feed", "events", "agent")}
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=2)
        fh.flush()
    try:
        os.chmod(tmp, 0o600)
    except OSError:
        pass
    os.replace(tmp, os.path.join(SESSION_DIR, "session.json"))


def _restore():
    """Restore durable feedback, but reset process/session-transient state."""
    path = os.path.join(SESSION_DIR, "session.json")
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                saved = json.load(fh)
            for key in ("queue", "feed"):
                if isinstance(saved.get(key), list):
                    STATE[key] = saved[key]
            restored_events = saved.get("events")
            if isinstance(restored_events, list):
                # Feedback remains durable. Layout and ended events describe
                # the prior process/session lifecycle and must be regenerated.
                STATE["events"] = [
                    event for event in restored_events
                    if isinstance(event, dict)
                    and event.get("type") == "feedback"
                ]
                for event in STATE["events"]:
                    # A process restart invalidates any old delivery lease.
                    event.pop("claimed_at", None)
            previous_agent = saved.get("agent")
            last_seen = (previous_agent.get("last_seen")
                         if isinstance(previous_agent, dict) else None)
            STATE["agent"] = {"status": "offline", "last_seen": last_seen}
        except Exception:
            pass
    # Every explicit server start is a reopened, live session that must audit
    # the current artifact. Persist this reset so another CLI sees it too.
    STATE["ended"] = False
    STATE["ended_by"] = None
    STATE["audit"] = {"status": "pending", "findings": []}
    _persist_locked()


def _changed_locked():
    STATE["revision"] += 1
    EVENTS_COND.notify_all()


def _state_locked():
    return copy.deepcopy({
        key: STATE[key]
        for key in ("version", "revision", "ended", "ended_by",
                    "queue", "audit", "feed", "agent")
    })


def _queue_item_locked(item):
    item["qid"] = secrets.token_hex(4)
    item["ts"] = time.time()
    if item["kind"] == "control":
        STATE["queue"] = [
            queued for queued in STATE["queue"]
            if not (queued["kind"] == "control"
                    and queued.get("selector") == item.get("selector"))
        ]
    STATE["queue"].append(item)
    return item


def _feedback_event_locked():
    if not STATE["queue"]:
        return None
    items = STATE["queue"]
    STATE["queue"] = []
    sent_at = time.time()
    event = {
        "id": secrets.token_hex(8),
        "type": "feedback",
        "items": items,
        "layout_warnings": STATE["audit"]["findings"],
        "sent_at": sent_at,
    }
    STATE["feed"].append({
        "id": event["id"],
        "role": "human",
        "ts": sent_at,
        "items": items,
        "status": "sent",
    })
    STATE["events"].append(event)
    return event


def _watch_file():
    """Publish artifact changes and invalidate layout results from older bytes."""
    last = None
    while True:
        try:
            mtime = os.stat(ARTIFACT).st_mtime_ns
        except OSError:
            mtime = last
        if mtime != last:
            with STATE_LOCK:
                STATE["version"] = mtime or 0
                if last is not None:
                    # Content changed: previous audit no longer describes it.
                    STATE["audit"] = {"status": "pending", "findings": []}
                    STATE["events"] = [
                        event for event in STATE["events"]
                        if event.get("type") != "layout"
                    ]
                    _persist_locked()
                _changed_locked()
            last = mtime
        time.sleep(0.5)


def _severe(findings):
    return [
        finding for finding in findings
        if isinstance(finding, dict) and finding.get("severity") == "severe"
    ]


def _write_private_json(path, value):
    tmp = path + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(value, fh, indent=2)
            fh.flush()
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def _write_private_bytes(path, value):
    tmp = path + ".tmp"
    try:
        with open(tmp, "wb") as fh:
            fh.write(value)
            fh.flush()
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, path)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def _utc_timestamp():
    return datetime.now(timezone.utc).isoformat(
        timespec="milliseconds").replace("+00:00", "Z")


def _validated_whiteboard_id(value):
    if isinstance(value, str) and WHITEBOARD_ID_RE.fullmatch(value):
        return value
    return None


def _validated_source_hash(value):
    if isinstance(value, str) and SOURCE_HASH_RE.fullmatch(value):
        return value
    return None


def _normalise_feedback_item(item):
    target = item.get("target")
    if (item.get("kind") != "element"
            or not isinstance(target, dict)
            or target.get("type") != "mermaid-node"):
        return item
    normalised = {"type": "mermaid-node"}
    for field, limit in MERMAID_NODE_TARGET_LIMITS.items():
        value = target.get(field)
        if not isinstance(value, str) or len(value) > limit:
            raise ValueError(
                f"mermaid-node target {field} must be a string "
                f"of at most {limit} characters")
        normalised[field] = value
    item["target"] = normalised
    return item


def _whiteboard_dir_locked():
    path = os.path.join(SESSION_DIR, "whiteboards")
    os.makedirs(path, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass
    return path


def _working_whiteboard_path(whiteboard_id):
    return os.path.join(
        SESSION_DIR, "whiteboards", whiteboard_id + ".working.json")


def _normalise_working_record(value):
    if not isinstance(value, dict):
        raise ValueError("working whiteboard record is not an object")
    scene = value.get("scene")
    baseline = value.get("baseline")
    source_hash = _validated_source_hash(value.get("source_hash"))
    metrics_version = value.get("text_metrics_version")
    updated_at = value.get("updated_at")
    if not isinstance(scene, dict):
        raise ValueError("working whiteboard scene is not an object")
    if baseline is not None and not isinstance(baseline, dict):
        raise ValueError("working whiteboard baseline is malformed")
    if source_hash is None:
        raise ValueError("working whiteboard source hash is malformed")
    if (not isinstance(metrics_version, int)
            or isinstance(metrics_version, bool)):
        raise ValueError("working whiteboard text metrics version is malformed")
    if not isinstance(updated_at, str) or len(updated_at) > 64:
        raise ValueError("working whiteboard timestamp is malformed")
    return {
        "source_hash": source_hash,
        "text_metrics_version": metrics_version,
        "updated_at": updated_at,
        "scene": scene,
        "baseline": baseline,
    }


def _new_whiteboard_snapshot_paths_locked(
        directory, whiteboard_id, include_png):
    for _ in range(16):
        suffix = f"{time.time_ns():x}-{secrets.token_hex(8)}"
        stem = f"{whiteboard_id}.{suffix}"
        scene_path = os.path.join(directory, stem + ".excalidraw")
        png_path = os.path.join(directory, stem + ".png") if include_png else None
        if (not os.path.exists(scene_path)
                and (png_path is None or not os.path.exists(png_path))):
            return scene_path, png_path
    raise OSError("cannot allocate a unique whiteboard snapshot")


def _normalise_host(value):
    value = (value or "").strip()
    if not value:
        return None
    try:
        return urlparse("//" + value).hostname
    except ValueError:
        return None


class ReviewHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    # -- guards ------------------------------------------------------------
    def _guard(self):
        raw_host = (self.headers.get("Host") or "").strip()
        try:
            host = urlparse("//" + raw_host).hostname or ""
        except ValueError:
            host = ""
        if host.lower() not in ALLOWED_HOSTS:
            self._json({"error": "bad host"}, 403)
            return False
        path = urlparse(self.path).path
        if self.command == "GET" and path in PUBLIC_REVIEW_PATHS:
            return True
        qs = parse_qs(urlparse(self.path).query)
        token = self.headers.get("X-Arev-Token") or (qs.get("t") or [""])[0]
        if not isinstance(token, str) or not secrets.compare_digest(token, TOKEN):
            self._json({"error": "bad token"}, 403)
            return False
        return True

    # -- helpers -----------------------------------------------------------
    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, body, ctype, public_static=False):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        if public_static:
            # The editor iframe has an opaque sandbox origin, so its ES module
            # and stylesheet loads require CORS despite using the same URL.
            self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _asset(self, name, public_static=False):
        path = os.path.join(ASSET_DIR, name)
        try:
            with open(path, "rb") as fh:
                body = fh.read()
        except OSError:
            self._json({"error": "asset not found", "asset": name}, 404)
            return
        self._bytes(
            body, MIME.get(os.path.splitext(name)[1], "text/plain"),
            public_static=public_static)

    def _body(self):
        raw_length = self.headers.get("Content-Length", "0")
        try:
            length = int(raw_length or 0)
        except (TypeError, ValueError):
            self._json({"error": "invalid Content-Length"}, 400)
            return None
        if length < 0:
            self._json({"error": "invalid Content-Length"}, 400)
            return None
        if length > MAX_REQUEST_BYTES:
            self._json({
                "error": "request body too large",
                "max_bytes": MAX_REQUEST_BYTES,
            }, 413)
            return None
        if not length:
            return {}
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError, RecursionError):
            self._json({"error": "invalid JSON body"}, 400)
            return None
        if not isinstance(body, dict):
            self._json({"error": "JSON body must be an object"}, 400)
            return None
        return body

    # -- GET ---------------------------------------------------------------
    def do_GET(self):
        if not self._guard():
            return
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._chrome()
        elif path == "/artifact":
            self._artifact()
        elif path == "/sdk.js":
            self._sdk()
        elif path == "/whiteboard-frame":
            self._asset("whiteboard-frame.html", public_static=True)
        elif path in ("/whiteboard.js", "/whiteboard.css"):
            self._asset(path.lstrip("/"), public_static=True)
        elif path.startswith("/whiteboard/"):
            self._whiteboard_working_get(path[len("/whiteboard/"):])
        elif path == "/state":
            with STATE_LOCK:
                state = _state_locked()
            self._json(state)
        elif path == "/state/next":
            self._state_next(parse_qs(urlparse(self.path).query))
        elif path == "/next":
            self._next(parse_qs(urlparse(self.path).query))
        else:
            self._json({"error": "not found", "path": path}, 404)

    def _whiteboard_working_get(self, raw_id):
        whiteboard_id = _validated_whiteboard_id(raw_id)
        if whiteboard_id is None:
            self._json({"error": "bad whiteboard id"}, 400)
            return
        path = _working_whiteboard_path(whiteboard_id)
        with STATE_LOCK:
            try:
                with open(path, encoding="utf-8") as fh:
                    saved = _normalise_working_record(json.load(fh))
            except FileNotFoundError:
                saved = None
            except (OSError, ValueError, TypeError, json.JSONDecodeError,
                    RecursionError) as error:
                self._json({
                    "error": f"cannot load working whiteboard: {error}"
                }, 500)
                return
        self._json({"saved": saved})

    def _chrome(self):
        path = os.path.join(ASSET_DIR, "chrome.html")
        html = open(path).read()
        boot = {"token": TOKEN, "artifact": ARTIFACT,
                "name": os.path.basename(ARTIFACT)}
        html = html.replace("/*__AREV_BOOT__*/", "window.AREV = " + json.dumps(boot) + ";")
        self._bytes(html.encode(), "text/html; charset=utf-8")

    def _artifact(self):
        try:
            raw = open(ARTIFACT, encoding="utf-8", errors="replace").read()
        except OSError as err:
            self._bytes(f"<h1>cannot read artifact</h1><p>{err}</p>".encode(), "text/html")
            return
        tag = '<script src="/sdk.js"></script>'
        # Inject before </body> when present, else append. The disk file is
        # untouched, so the artifact opened directly stays identical.
        if re.search(r"</body>", raw, re.I):
            raw = re.sub(r"</body>", tag + "</body>", raw, count=1, flags=re.I)
        else:
            raw += tag
        self._bytes(raw.encode(), "text/html; charset=utf-8")

    def _sdk(self):
        sdk = open(os.path.join(ASSET_DIR, "sdk.js")).read()
        audit_path = os.path.join(ASSET_DIR, "audit.js")
        audit = open(audit_path).read() if os.path.exists(audit_path) else "window.__arevAudit=function(){return []};"
        self._bytes((audit + "\n" + sdk).encode(), "application/javascript")

    def _next(self, qs):
        try:
            timeout = float((qs.get("timeout") or ["90"])[0])
        except (TypeError, ValueError):
            timeout = 90.0
        timeout = max(1.0, min(timeout, 600.0))
        deadline = time.time() + timeout
        response = None
        with EVENTS_COND:
            while True:
                now = time.time()
                event = next((
                    candidate for candidate in STATE["events"]
                    if not candidate.get("claimed_at")
                    or candidate["claimed_at"] < now - 30
                ), None)
                if event:
                    event["claimed_at"] = now
                    _persist_locked()
                    response = {
                        key: value for key, value in event.items()
                        if key != "claimed_at"
                    }
                    break
                remaining = deadline - time.time()
                if remaining <= 0:
                    response = {"type": "idle"}
                    break
                EVENTS_COND.wait(timeout=min(remaining, 30.0))
        self._json(response)

    def _state_next(self, qs):
        try:
            after = int((qs.get("after") or ["-1"])[0])
            timeout = float((qs.get("timeout") or ["25"])[0])
        except (TypeError, ValueError):
            after, timeout = -1, 25.0
        timeout = max(1.0, min(timeout, 60.0))
        deadline = time.time() + timeout
        with EVENTS_COND:
            while STATE["revision"] <= after:
                remaining = deadline - time.time()
                if remaining <= 0:
                    break
                EVENTS_COND.wait(timeout=remaining)
            state = _state_locked()
        self._json(state)

    # -- PUT ---------------------------------------------------------------
    def do_PUT(self):
        if not self._guard():
            return
        path = urlparse(self.path).path
        if not path.startswith("/whiteboard/"):
            self._json({"error": "not found", "path": path}, 404)
            return
        body = self._body()
        if body is None:
            return
        self._whiteboard_working_put(path[len("/whiteboard/"):], body)

    def _whiteboard_working_put(self, raw_id, body):
        whiteboard_id = _validated_whiteboard_id(raw_id)
        if whiteboard_id is None:
            self._json({"error": "bad whiteboard id"}, 400)
            return
        scene = body.get("scene")
        baseline = body.get("baseline")
        source_hash = _validated_source_hash(body.get("source_hash"))
        metrics_version = body.get("text_metrics_version")
        if not isinstance(scene, dict):
            self._json({
                "error": "whiteboard scene must be an object"
            }, 400)
            return
        if baseline is not None and not isinstance(baseline, dict):
            self._json({
                "error": "whiteboard baseline must be an object or null"
            }, 400)
            return
        if source_hash is None:
            self._json({
                "error": "source_hash must be 16-64 lowercase hex characters"
            }, 400)
            return
        if (not isinstance(metrics_version, int)
                or isinstance(metrics_version, bool)):
            self._json({
                "error": "text_metrics_version must be an integer"
            }, 400)
            return
        updated_at = _utc_timestamp()
        record = {
            "source_hash": source_hash,
            "text_metrics_version": metrics_version,
            "updated_at": updated_at,
            "scene": scene,
            "baseline": baseline,
        }
        with EVENTS_COND:
            # The shared state lock orders autosaves with /end and with every
            # other filesystem write made by this session process.
            if STATE["ended"]:
                self._json({"error": "session ended"}, 409)
                return
            try:
                _whiteboard_dir_locked()
                _write_private_json(
                    _working_whiteboard_path(whiteboard_id), record)
            except OSError as error:
                self._json({
                    "error": f"cannot save working whiteboard: {error}"
                }, 500)
                return
        self._json({"ok": True, "updated_at": updated_at})

    # -- POST --------------------------------------------------------------
    def do_POST(self):
        if not self._guard():
            return
        path = urlparse(self.path).path
        body = self._body()
        if body is None:
            return
        handler = {
            "/queue": self._queue, "/unqueue": self._unqueue, "/flush": self._flush,
            "/send": self._send, "/agent-reply": self._agent_reply,
            "/agent-status": self._agent_status, "/ack": self._ack, "/end": self._end,
            "/audit": self._audit, "/audit/override": self._audit_override,
            "/whiteboard": self._whiteboard,
        }.get(path)
        if handler:
            handler(body)
        else:
            self._json({"error": "not found", "path": path}, 404)

    def _queue(self, body):
        item = body.get("item") or {}
        if not isinstance(item, dict):
            self._json({"error": "item must be an object"}, 400)
            return
        if item.get("kind") not in ("text", "element", "control", "chat", "whiteboard"):
            self._json({"error": "bad item kind"}, 400)
            return
        try:
            _normalise_feedback_item(item)
        except ValueError as error:
            self._json({"error": str(error)}, 400)
            return
        with EVENTS_COND:
            if STATE["ended"]:
                self._json({"error": "session ended"}, 409)
                return
            _queue_item_locked(item)
            _persist_locked()
            _changed_locked()
        self._json({"ok": True, "qid": item["qid"], "queued": len(STATE["queue"])})

    def _unqueue(self, body):
        with EVENTS_COND:
            if STATE["ended"]:
                self._json({"error": "session ended"}, 409)
                return
            before = len(STATE["queue"])
            STATE["queue"] = [q for q in STATE["queue"] if q["qid"] != body.get("qid")]
            _persist_locked()
            if before != len(STATE["queue"]):
                _changed_locked()
            self._json({"ok": True, "removed": before - len(STATE["queue"])})

    def _flush(self, body):
        with EVENTS_COND:
            if STATE["ended"]:
                self._json({"error": "session ended"}, 409)
                return
            event = _feedback_event_locked()
            if not event:
                self._json({"error": "queue empty"}, 400)
                return
            _persist_locked()
            _changed_locked()
        self._json({"ok": True, "id": event["id"],
                    "sent": len(event["items"]), "sent_at": event["sent_at"]})

    def _send(self, body):
        item = body.get("item")
        if item is not None:
            if not isinstance(item, dict):
                self._json({"error": "item must be an object"}, 400)
                return
            if item.get("kind") not in (
                    "text", "element", "control", "chat", "whiteboard"):
                self._json({"error": "bad item kind"}, 400)
                return
            try:
                _normalise_feedback_item(item)
            except ValueError as error:
                self._json({"error": str(error)}, 400)
                return
        with EVENTS_COND:
            if STATE["ended"]:
                self._json({"error": "session ended"}, 409)
                return
            if item:
                _queue_item_locked(item)
            event = _feedback_event_locked()
            if not event:
                self._json({"error": "queue empty"}, 400)
                return
            _persist_locked()
            _changed_locked()
        self._json({"ok": True, "id": event["id"],
                    "sent": len(event["items"]), "sent_at": event["sent_at"]})

    def _agent_reply(self, body):
        text = (body.get("text") or "").strip()
        if not text:
            self._json({"error": "empty reply"}, 400)
            return
        reply_to = body.get("reply_to")
        with EVENTS_COND:
            if reply_to:
                for entry in STATE["feed"]:
                    if entry.get("id") == reply_to:
                        entry["status"] = "answered"
                        entry["answered_at"] = time.time()
                        break
            STATE["feed"].append({
                "role": "agent",
                "ts": time.time(),
                "text": text,
                "reply_to": reply_to,
            })
            STATE["agent"] = {"status": "working", "last_seen": time.time()}
            _persist_locked()
            _changed_locked()
        self._json({"ok": True})

    def _agent_status(self, body):
        status = body.get("status")
        if status not in ("offline", "idle", "listening", "working"):
            self._json({"error": "bad agent status"}, 400)
            return
        with EVENTS_COND:
            STATE["agent"] = {"status": status, "last_seen": time.time()}
            _persist_locked()
            _changed_locked()
        self._json({"ok": True})

    def _ack(self, body):
        event_id = body.get("id")
        status = body.get("status") or "working"
        if not event_id:
            self._json({"error": "missing event id"}, 400)
            return
        if status not in ("idle", "listening", "working"):
            self._json({"error": "bad agent status"}, 400)
            return
        with EVENTS_COND:
            before = len(STATE["events"])
            STATE["events"] = [
                event for event in STATE["events"]
                if event.get("id") != event_id
            ]
            received_at = body.get("received_at") or time.time()
            for entry in STATE["feed"]:
                if entry.get("id") == event_id:
                    entry["status"] = "delivered"
                    entry["delivered_at"] = received_at
                    break
            STATE["agent"] = {"status": status, "last_seen": time.time()}
            _persist_locked()
            _changed_locked()
        self._json({"ok": True, "acknowledged": before - len(STATE["events"])})

    def _end(self, body):
        by = body.get("by") if body.get("by") in ("agent", "user") else "agent"
        with EVENTS_COND:
            if STATE["ended"]:
                existing = next((
                    event for event in STATE["events"]
                    if event.get("type") == "ended"
                ), None)
                event_id = existing.get("id") if existing else None
                self._json({"ok": True, "id": event_id, "already_ended": True})
                return
            STATE["ended"] = True
            STATE["ended_by"] = by
            STATE["events"] = [
                event for event in STATE["events"]
                if event.get("type") != "layout"
            ]
            event = {"id": secrets.token_hex(8), "type": "ended",
                     "by": by, "sent_at": time.time()}
            STATE["events"].append(event)
            _persist_locked()
            _changed_locked()
        self._json({"ok": True, "id": event["id"]})

    def _audit(self, body):
        findings = body.get("findings")
        if findings is None:
            findings = []
        if (not isinstance(findings, list)
                or any(not isinstance(finding, dict) for finding in findings)):
            self._json({"error": "findings must be an array of objects"}, 400)
            return
        with EVENTS_COND:
            if STATE["ended"]:
                self._json({"error": "session ended"}, 409)
                return
            severe = _severe(findings)
            STATE["audit"] = {
                "status": "blocked" if severe else "clear",
                "findings": findings,
            }
            # A report supersedes every older layout event. This also removes a
            # stale severe event when a re-audit of changed content is clean.
            STATE["events"] = [
                event for event in STATE["events"]
                if event.get("type") != "layout"
            ]
            if severe:
                # The agent hears about a proven failure immediately. It can
                # fix and re-check before the human ever sees the page.
                STATE["events"].append({
                    "id": secrets.token_hex(8),
                    "type": "layout",
                    "layout_warnings": findings,
                    "sent_at": time.time(),
                })
            _persist_locked()
            _changed_locked()
        self._json({"ok": True, "status": STATE["audit"]["status"]})

    def _audit_override(self, body):
        with EVENTS_COND:
            if STATE["ended"]:
                self._json({"error": "session ended"}, 409)
                return
            STATE["audit"]["status"] = "overridden"
            _persist_locked()
            _changed_locked()
        self._json({"ok": True})

    def _whiteboard(self, body):
        wid = _validated_whiteboard_id(body.get("id"))
        if wid is None:
            self._json({"error": "bad whiteboard id"}, 400)
            return
        scene = body.get("scene")
        if not isinstance(scene, dict):
            self._json({"error": "whiteboard scene must be an object"}, 400)
            return
        if "source_hash" in body:
            source_hash = _validated_source_hash(body.get("source_hash"))
            if source_hash is None:
                self._json({
                    "error": "source_hash must be 16-64 lowercase hex characters"
                }, 400)
                return
        else:
            source_hash = None
        if ("image_fallback" in body
                and not isinstance(body.get("image_fallback"), bool)):
            self._json({"error": "image_fallback must be a boolean"}, 400)
            return
        if "stats" in body and not isinstance(body.get("stats"), dict):
            self._json({"error": "stats must be an object"}, 400)
            return
        png_bytes = None
        encoded_png = body.get("png_base64")
        if encoded_png is not None:
            if not isinstance(encoded_png, str):
                self._json({"error": "png_base64 must be a string"}, 400)
                return
            try:
                png_bytes = base64.b64decode(encoded_png, validate=True)
            except (binascii.Error, ValueError):
                self._json({"error": "invalid png_base64"}, 400)
                return
            if not png_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
                self._json({"error": "decoded whiteboard image is not a PNG"}, 400)
                return
            if len(png_bytes) > MAX_WHITEBOARD_PNG_BYTES:
                self._json({
                    "error": "whiteboard PNG too large",
                    "max_bytes": MAX_WHITEBOARD_PNG_BYTES,
                }, 413)
                return
        with EVENTS_COND:
            # Serialize the final state check with /end so no filesystem write
            # can begin after the session has ended.
            if STATE["ended"]:
                self._json({"error": "session ended"}, 409)
                return
            try:
                wdir = _whiteboard_dir_locked()
                scene_path, png_path = _new_whiteboard_snapshot_paths_locked(
                    wdir, wid, png_bytes is not None)
                _write_private_json(scene_path, scene)
                if png_path:
                    _write_private_bytes(png_path, png_bytes)
            except OSError as error:
                self._json({"error": f"cannot save whiteboard: {error}"}, 500)
                return
        self._json({
            "ok": True,
            "scene_path": scene_path,
            "png_path": png_path,
            "source_hash": source_hash,
        })


def main():
    global ARTIFACT, SESSION_DIR, TOKEN, ASSET_DIR, ALLOWED_HOSTS
    ap = argparse.ArgumentParser(
        description="Internal artifact-review session server. Prefer the "
                    "public `arev open` command.")
    ap.add_argument("--version", action="version",
                    version=f"%(prog)s {VERSION}")
    ap.add_argument("--artifact", required=True)
    ap.add_argument("--session-dir", required=True)
    ap.add_argument("--token", required=True)
    ap.add_argument("--asset-dir", required=True)
    ap.add_argument("--bind", default="127.0.0.1")
    ap.add_argument("--allowed-host", action="append", default=[])
    ap.add_argument("--port", type=int, default=0)
    args = ap.parse_args()

    ARTIFACT = os.path.realpath(args.artifact)
    SESSION_DIR = os.path.realpath(args.session_dir)
    TOKEN = args.token
    ASSET_DIR = os.path.realpath(args.asset_dir)
    if not os.path.isfile(ARTIFACT):
        ap.error(f"artifact is not a file: {ARTIFACT}")
    if not os.path.isdir(ASSET_DIR):
        ap.error(f"asset directory does not exist: {ASSET_DIR}")
    if args.port < 0 or args.port > 65535:
        ap.error("--port must be between 0 and 65535")
    try:
        TOKEN.encode("ascii")
    except UnicodeEncodeError:
        ap.error("--token must contain ASCII characters only")
    if len(TOKEN) < 32:
        ap.error("--token must contain at least 32 characters")
    for raw_host in args.allowed_host:
        host = _normalise_host(raw_host)
        if not host:
            ap.error(f"invalid --allowed-host value: {raw_host}")
        ALLOWED_HOSTS.add(host.lower())
    if args.bind not in ("0.0.0.0", "::"):
        ALLOWED_HOSTS.add(args.bind.lower())
    os.makedirs(SESSION_DIR, exist_ok=True)
    try:
        os.chmod(SESSION_DIR, 0o700)
    except OSError:
        pass
    _restore()

    threading.Thread(target=_watch_file, daemon=True).start()
    server_class = ReviewHTTPServer
    if ":" in args.bind:
        class IPv6ReviewHTTPServer(ReviewHTTPServer):
            address_family = socket.AF_INET6
        server_class = IPv6ReviewHTTPServer
    server = server_class((args.bind, args.port), Handler)
    print(f"LISTENING {server.server_address[1]}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
