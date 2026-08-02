#!/usr/bin/env python3
"""
arev - review loop for agent-written HTML artifacts.

The CLI starts one standard-library HTTP server per artifact, opens its browser
review surface, and long-polls for annotations, control interactions, chat, and
whiteboard edits. Feedback events are persisted until an agent acknowledges
them. The reviewed file itself is never modified by the tool.

State defaults to ``~/.artifact-review`` and can be relocated with
``ARTIFACT_REVIEW_HOME``. The server binds to loopback unless ``open --bind`` is
used explicitly; a tunnel-facing URL can be supplied with ``--public-url``.
"""

import argparse
import hashlib
import json
import math
import os
import queue
import secrets
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

VERSION = "0.1.0"
MINIMUM_PYTHON = (3, 9)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SKILL_DIR = os.path.dirname(SCRIPT_DIR)
REFERENCE_DIR = os.path.join(SKILL_DIR, "references", "playbooks")
ASSET_DIR = os.path.join(SKILL_DIR, "assets", "review-ui")
# Authoring asset, deliberately outside the directory the server can serve.
TEMPLATE = os.path.join(SKILL_DIR, "assets", "artifact-template.html")
STATE_ROOT = os.path.abspath(os.path.expanduser(
    os.environ.get("ARTIFACT_REVIEW_HOME") or "~/.artifact-review"))
REGISTRY = os.path.join(STATE_ROOT, "registry.json")


def _key(path):
    return hashlib.sha1(os.path.realpath(path).encode()).hexdigest()[:12]


def _load_registry():
    if os.path.exists(REGISTRY):
        try:
            with open(REGISTRY, encoding="utf-8") as fh:
                value = json.load(fh)
            return value if isinstance(value, dict) else {}
        except Exception:
            return {}
    return {}


def _ensure_private_dir(path):
    os.makedirs(path, exist_ok=True)
    try:
        os.chmod(path, 0o700)
    except OSError:
        pass


def _save_registry(reg):
    _ensure_private_dir(STATE_ROOT)
    fd, tmp = tempfile.mkstemp(prefix="registry.", suffix=".tmp", dir=STATE_ROOT)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(reg, fh, indent=2)
            fh.flush()
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, REGISTRY)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def _alive(entry):
    """Return whether a registry PID still names a live process.

    ``os.kill(pid, 0)`` is a harmless probe on POSIX but is not portable to
    Windows, where non-console signals terminate the target process.
    """
    try:
        pid = int(entry["pid"])
    except (OSError, TypeError, KeyError):
        return False
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            process = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
            if not process:
                return False
            try:
                exit_code = wintypes.DWORD()
                if not ctypes.windll.kernel32.GetExitCodeProcess(
                        process, ctypes.byref(exit_code)):
                    return False
                return exit_code.value == 259
            finally:
                ctypes.windll.kernel32.CloseHandle(process)
        except (AttributeError, OSError, ValueError):
            return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _api(entry, method, path, body=None, timeout=10):
    req = urllib.request.Request(
        f"http://127.0.0.1:{entry['port']}{path}", method=method,
        headers={"X-Arev-Token": entry["token"], "Content-Type": "application/json"},
        data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read())


def _entry_for(path, required=True):
    reg = _load_registry()
    entry = reg.get(os.path.realpath(path))
    if entry and _alive(entry):
        return entry
    if required:
        sys.exit(f"no running session for {path} - run: arev open {path}")
    return None


def _session_url(entry):
    base = entry.get("base_url") or f"http://127.0.0.1:{entry['port']}"
    parts = urllib.parse.urlsplit(base)
    query = [
        (key, value)
        for key, value in urllib.parse.parse_qsl(parts.query, keep_blank_values=True)
        if key != "t"
    ]
    query.append(("t", entry["token"]))
    return urllib.parse.urlunsplit((
        parts.scheme,
        parts.netloc,
        parts.path or "/",
        urllib.parse.urlencode(query),
        parts.fragment,
    ))


def _open_browser(url):
    try:
        return bool(webbrowser.open(url, new=2))
    except Exception:
        return False


def _update_entry(path, **changes):
    real = os.path.realpath(path)
    reg = _load_registry()
    entry = reg.get(real)
    if entry:
        entry.update(changes)
        _save_registry(reg)


def _session_json(path):
    sess = os.path.join(STATE_ROOT, "sessions", _key(path), "session.json")
    if os.path.exists(sess):
        try:
            with open(sess, encoding="utf-8") as fh:
                value = json.load(fh)
            return value if isinstance(value, dict) else {}
        except Exception:
            pass
    return {}


def _normalise_host(value):
    value = (value or "").strip()
    if not value:
        return None
    try:
        return urllib.parse.urlsplit("//" + value).hostname
    except ValueError:
        return None


def _public_url(value):
    if not value:
        return None
    try:
        parts = urllib.parse.urlsplit(value)
    except ValueError:
        sys.exit(f"invalid --public-url: {value}")
    if parts.scheme not in ("http", "https") or not parts.hostname:
        sys.exit("--public-url must be an absolute http:// or https:// URL")
    return value


def _wait_for_listening(proc, timeout=10):
    """Read the server's one-line startup handshake without an unbounded block."""
    lines = queue.Queue(maxsize=1)

    def read_line():
        try:
            lines.put(proc.stdout.readline())
        except Exception:
            lines.put("")

    threading.Thread(target=read_line, daemon=True).start()
    try:
        line = lines.get(timeout=timeout).strip()
    except queue.Empty:
        return None
    if not line.startswith("LISTENING "):
        return None
    try:
        return int(line.split()[1])
    except (IndexError, ValueError):
        return None


def _terminate_pid(pid):
    try:
        os.kill(int(pid), signal.SIGTERM)
        return True
    except (OSError, TypeError, ValueError):
        return False


# ----------------------------------------------------------------- commands

def cmd_open(args):
    path = os.path.realpath(args.file)
    if not os.path.isfile(path):
        sys.exit(f"no such file: {path}")

    prior = _session_json(path)
    if prior.get("ended_by") == "user" and not args.reopen:
        sys.exit("the human ended this session from the browser - "
                 "reopen only with --reopen once the concern is addressed")

    reg = _load_registry()
    entry = reg.get(path)
    if entry and _alive(entry):
        if args.reopen:
            try:
                _api(entry, "POST", "/reopen", {})
            except urllib.error.URLError as err:
                sys.exit(f"session server could not reopen: {err}")
        url = _session_url(entry)
        print(f"SESSION {url}")
        if not args.no_browser and not _open_browser(url):
            print("Browser launch was unavailable; open the SESSION URL manually.",
                  file=sys.stderr)
        return

    public_url = _public_url(args.public_url)
    token = secrets.token_hex(32)
    session_dir = os.path.join(STATE_ROOT, "sessions", _key(path))
    _ensure_private_dir(session_dir)
    log = open(os.path.join(session_dir, "server.log"), "ab")
    allowed_hosts = []
    for raw_host in args.allow_host:
        host = _normalise_host(raw_host)
        if not host:
            log.close()
            sys.exit(f"invalid --allow-host value: {raw_host}")
        if host.lower() not in allowed_hosts:
            allowed_hosts.append(host.lower())
    if public_url:
        public_host = urllib.parse.urlsplit(public_url).hostname.lower()
        if public_host not in allowed_hosts:
            allowed_hosts.append(public_host)

    popen_options = {}
    if os.name == "nt":
        popen_options["creationflags"] = getattr(
            subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        popen_options["start_new_session"] = True
    command = [
        sys.executable, os.path.join(SCRIPT_DIR, "server.py"),
        "--artifact", path, "--session-dir", session_dir, "--token", token,
        "--asset-dir", ASSET_DIR, "--bind", args.bind, "--port", str(args.port),
    ]
    for host in allowed_hosts:
        command.extend(["--allowed-host", host])
    try:
        proc = subprocess.Popen(
            command, stdout=subprocess.PIPE, stderr=log, text=True,
            **popen_options)
    finally:
        log.close()

    port = _wait_for_listening(proc)
    if not port:
        proc.terminate()
        sys.exit(f"server failed to start; see {session_dir}/server.log")

    base_url = public_url or f"http://127.0.0.1:{port}"
    reg[path] = {"port": port, "pid": proc.pid, "token": token,
                 "started": time.time(), "session_dir": session_dir,
                 "bind": args.bind, "base_url": base_url}
    _save_registry(reg)
    url = _session_url(reg[path])
    print(f"SESSION {url}")
    if args.bind not in ("127.0.0.1", "localhost", "::1") and not public_url:
        print("REMOTE NOTE: forward the selected port and pass --public-url on "
              "the next open if the browser is not on this machine.",
              file=sys.stderr)
    if not args.no_browser and not _open_browser(url):
        print("Browser launch was unavailable; open the SESSION URL manually.",
              file=sys.stderr)


def cmd_poll(args):
    entry = _entry_for(args.file)
    if args.agent_reply:
        _api(entry, "POST", "/agent-reply", {
            "text": args.agent_reply,
            "reply_to": entry.get("last_event_id"),
        })
    _api(entry, "POST", "/agent-status", {"status": "listening"})
    timeout = max(5, args.timeout)
    # One server-side long poll per loop; keep polling until a real event or
    # the caller's timeout budget runs out.
    deadline = time.time() + timeout
    while True:
        remaining = deadline - time.time()
        if remaining <= 0:
            break
        # Round the wait up, never down. Truncating 5.999 to 5 leaves a
        # sub-second remainder that costs another whole server round trip.
        chunk = min(90, math.ceil(remaining))
        try:
            event = _api(entry, "GET", f"/next?timeout={chunk}",
                         timeout=chunk + 15)
        except urllib.error.URLError as err:
            sys.exit(f"session server unreachable: {err}")
        if event.get("type") != "idle":
            if event.get("id"):
                _api(entry, "POST", "/ack", {
                    "id": event["id"],
                    "status": "working",
                    "received_at": time.time(),
                })
                _update_entry(args.file, last_event_id=event["id"])
            print(json.dumps(event, indent=2))
            return
    _api(entry, "POST", "/agent-status", {"status": "idle"})
    print(json.dumps({"type": "idle"}))


def cmd_end(args):
    entry = _entry_for(args.file)
    _api(entry, "POST", "/end", {"by": "agent"})
    print("ended")


def cmd_reply(args):
    entry = _entry_for(args.file)
    reply_to = args.to or entry.get("last_event_id")
    _api(entry, "POST", "/agent-reply", {
        "text": args.text,
        "reply_to": reply_to,
    })
    print("replied")


def cmd_stop(args):
    reg = _load_registry()
    if args.all:
        stopped = 0
        for entry in reg.values():
            if _alive(entry) and _terminate_pid(entry["pid"]):
                stopped += 1
        _save_registry({})
        print(f"stopped {stopped} session server(s)")
        return
    if not args.file:
        sys.exit("provide an artifact file or use: arev stop --all")
    entry = reg.pop(os.path.realpath(args.file), None)
    _save_registry(reg)
    if entry and _alive(entry) and _terminate_pid(entry["pid"]):
        print(f"stopped pid {entry['pid']}")
    else:
        print("no running server")


def cmd_export(args):
    sys.path.insert(0, SCRIPT_DIR)
    from export import export_html
    out = args.output or os.path.splitext(args.file)[0] + ".portable.html"
    result = export_html(args.file, out)
    print(f"wrote {os.path.abspath(out)}  inlined={result['inlined']}"
          + (f"  skipped={result['skipped']}" if result.get("skipped") else ""))


def _playbook_ids():
    return sorted(f[:-3] for f in os.listdir(REFERENCE_DIR)
                  if f.endswith(".md") and f != "design.md")


def _use_when(pid):
    """Return a playbook's matcher. It is the first line of the file."""
    with open(os.path.join(REFERENCE_DIR, pid + ".md"), encoding="utf-8") as fh:
        first = fh.readline().strip()
    if first.startswith("use_when:"):
        return first.split(":", 1)[1].strip()
    return ""


def _print_playbook_index():
    for pid in _playbook_ids():
        print(f"{pid}: {_use_when(pid)}")
    print()
    print("usage: arev playbook <id> [<id> ...] - open every playbook whose "
          "use_when matches the artifact")


def _print_playbooks(ids):
    books = _playbook_ids()
    for pid in ids:
        if pid not in books:
            sys.exit(f"unknown playbook '{pid}' (have: {', '.join(books)})")
    for pid in ids:
        with open(os.path.join(REFERENCE_DIR, pid + ".md"), encoding="utf-8") as fh:
            print(fh.read())


def cmd_playbook(args):
    if not args.id:
        _print_playbook_index()
        return
    _print_playbooks(args.id)


def _design_text():
    with open(os.path.join(REFERENCE_DIR, "design.md"), encoding="utf-8") as fh:
        return fh.read()


def cmd_design(args):
    print(_design_text())


def _doctor_checks():
    checks = {
        "python": sys.version.split()[0],
        "skill_dir": SKILL_DIR,
        "state_dir": STATE_ROOT,
        "server": os.path.isfile(os.path.join(SCRIPT_DIR, "server.py")),
        "review_ui": os.path.isfile(os.path.join(ASSET_DIR, "chrome.html")),
        "audit": os.path.isfile(os.path.join(ASSET_DIR, "audit.js")),
        "sdk": os.path.isfile(os.path.join(ASSET_DIR, "sdk.js")),
        "template": os.path.isfile(TEMPLATE),
        "offline_whiteboard": all(os.path.isfile(os.path.join(ASSET_DIR, name))
                                  for name in ("whiteboard-frame.html",
                                               "whiteboard.js",
                                               "whiteboard.css")),
    }
    checks["ok"] = all(value for key, value in checks.items()
                       if key not in ("python", "skill_dir", "state_dir"))
    return checks


def cmd_doctor(args):
    checks = _doctor_checks()
    print(json.dumps(checks, indent=2))
    if not checks["ok"]:
        sys.exit(1)


def cmd_new(args):
    """Write the themed artifact shell so no agent has to retype it.

    The shell is the part that is identical in every artifact: theme
    variables, both color schemes, the reading column, overflow containers,
    and control styling. Generating it here costs the caller nothing.
    """
    path = os.path.abspath(os.path.expanduser(args.file))
    if os.path.exists(path) and not args.force:
        sys.exit(f"{path} already exists - pass --force to overwrite it")
    if not os.path.isfile(TEMPLATE):
        sys.exit(f"missing artifact template: {TEMPLATE}")
    title = args.title or os.path.splitext(os.path.basename(path))[0]
    title = title.replace("-", " ").replace("_", " ").strip() or "Artifact"
    with open(TEMPLATE, encoding="utf-8") as fh:
        html = fh.read()
    html = html.replace("__AREV_TITLE__", _escape_html(title))
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"wrote {path}")
    print("fill the region between <!-- arev:content --> and <!-- /arev:content -->")


def _escape_html(value):
    return (value.replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def cmd_brief(args):
    """Everything needed before writing an artifact, in one command.

    Separate doctor, design, and playbook calls were four blocking round trips
    whose output is always read together.
    """
    checks = _doctor_checks()
    print("## install")
    print(json.dumps(checks, indent=2))
    if not checks["ok"]:
        sys.exit(1)
    print()
    print("## design")
    print(_design_text())
    if args.id:
        print("## playbooks")
        _print_playbooks(args.id)
        return
    print("## playbooks available")
    _print_playbook_index()


def cmd_sessions(args):
    reg = _load_registry()
    if not reg:
        print("no sessions")
        return
    for path, entry in reg.items():
        state = "running" if _alive(entry) else "dead"
        saved = _session_json(path)
        if saved.get("ended"):
            state += f", ended by {saved.get('ended_by')}"
        print(f"{state:22} :{entry['port']:<6} {path}")


def main():
    if sys.version_info < MINIMUM_PYTHON:
        required = ".".join(map(str, MINIMUM_PYTHON))
        sys.exit(f"artifact-review requires Python {required} or newer")

    ap = argparse.ArgumentParser(
        prog="arev",
        description="Review agent-written HTML artifacts in a browser and "
                    "exchange durable feedback with a coding agent.",
    )
    ap.add_argument("--version", action="version",
                    version=f"%(prog)s {VERSION}")
    sub = ap.add_subparsers(dest="cmd", metavar="COMMAND")

    p = sub.add_parser(
        "open", help="open or resume an artifact review session",
        description="Start the artifact's review server, or reuse its running "
                    "session, and optionally open it in a browser.")
    p.add_argument("file", help="HTML artifact to review")
    p.add_argument("--reopen", action="store_true",
                   help="reopen a session that the reviewer ended")
    p.add_argument("--no-browser", action="store_true",
                   help="print the session URL without launching a browser")
    p.add_argument("--bind", default="127.0.0.1",
                   help="listen address (default: 127.0.0.1)")
    p.add_argument("--port", type=int, default=0,
                   help="listen port (default: choose an available port)")
    p.add_argument("--public-url",
                   help="absolute browser-facing http(s) URL from a port forwarder")
    p.add_argument("--allow-host", action="append", default=[],
                   metavar="HOST",
                   help="additional Host header hostname accepted by the server")
    p.set_defaults(fn=cmd_open)

    p = sub.add_parser(
        "poll", help="wait for the next durable review event",
        description="Long-poll until feedback, a layout warning, or an ended "
                    "event is available; acknowledged events are not replayed.")
    p.add_argument("file", help="artifact with a running review session")
    p.add_argument("--timeout", type=int, default=110, metavar="SECONDS",
                   help="overall wait budget (default: 110; minimum: 5). The "
                        "default fits inside a 120s agent tool timeout; raise "
                        "it when the calling agent allows a longer one")
    p.add_argument("--agent-reply",
                   help="post this reply before waiting for the next event")
    p.set_defaults(fn=cmd_poll)

    p = sub.add_parser("end", help="end a review session as the agent")
    p.add_argument("file"); p.set_defaults(fn=cmd_end)
    p = sub.add_parser("reply", help="post an agent reply without waiting")
    p.add_argument("file"); p.add_argument("text")
    p.add_argument("--to", help="feedback event id (defaults to the last received event)")
    p.set_defaults(fn=cmd_reply)
    p = sub.add_parser("stop", help="stop one or all session servers")
    p.add_argument("file", nargs="?")
    p.add_argument("--all", action="store_true",
                   help="stop every server in the state registry")
    p.set_defaults(fn=cmd_stop)

    p = sub.add_parser("export", help="write a portable single-file artifact")
    p.add_argument("file")
    p.add_argument("-o", "--output"); p.set_defaults(fn=cmd_export)

    p = sub.add_parser(
        "new", help="scaffold a themed, audit-clean artifact shell",
        description="Write a self-contained HTML shell that already satisfies "
                    "the theme, layout, and overflow rules. Fill the marked "
                    "content region instead of writing a page from scratch.")
    p.add_argument("file", help="path to create")
    p.add_argument("--title", help="page title (default: derived from the filename)")
    p.add_argument("--force", action="store_true", help="overwrite an existing file")
    p.set_defaults(fn=cmd_new)

    p = sub.add_parser(
        "brief", help="install check, design guidance, and playbooks in one call",
        description="Print everything needed before writing an artifact. Pass "
                    "playbook ids when the artifact type is already known.")
    p.add_argument("id", nargs="*")
    p.set_defaults(fn=cmd_brief)

    p = sub.add_parser("playbook", help="print artifact-type design guidance")
    p.add_argument("id", nargs="*")
    p.set_defaults(fn=cmd_playbook)
    p = sub.add_parser("design", help="print general artifact design guidance")
    p.set_defaults(fn=cmd_design)
    p = sub.add_parser("sessions", help="list known review sessions")
    p.set_defaults(fn=cmd_sessions)
    p = sub.add_parser("doctor", help="check the standalone installation")
    p.set_defaults(fn=cmd_doctor)

    args = ap.parse_args()
    if not args.cmd:
        ap.print_help()
        sys.exit(1)
    args.fn(args)


if __name__ == "__main__":
    main()
