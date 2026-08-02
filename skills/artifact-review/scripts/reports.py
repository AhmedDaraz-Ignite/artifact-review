"""Deterministic review reports, portable archives, and safe retention."""

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import tempfile
import time
import zipfile

from review_store import ReviewStore
from versioning import REPORT_SCHEMA, STATE_SCHEMA, TOOL_VERSION


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _run_git(arguments, cwd):
    try:
        result = subprocess.run(
            ["git", "-C", cwd, *arguments],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return result.stdout.strip()


def _git_context(artifact_path):
    directory = os.path.dirname(artifact_path)
    root = _run_git(["rev-parse", "--show-toplevel"], directory)
    if not root:
        return {"root": None, "commit": None, "dirty": None}
    root = os.path.realpath(root)
    commit = _run_git(["rev-parse", "HEAD"], root)
    status = _run_git(["status", "--porcelain", "--", artifact_path], root)
    return {
        "root": root,
        "commit": commit,
        "dirty": None if status is None else bool(status),
    }


def _snapshot_from_item(item):
    if not isinstance(item, dict) or item.get("kind") != "whiteboard":
        return None
    scene_path = item.get("scene_path")
    png_path = item.get("png_path")
    scene_hash = item.get("scene_hash")
    png_hash = item.get("png_hash")
    if not scene_hash and isinstance(scene_path, str) and os.path.isfile(scene_path):
        scene_hash = _sha256_file(scene_path)
    if not png_hash and isinstance(png_path, str) and os.path.isfile(png_path):
        png_hash = _sha256_file(png_path)
    return {
        "diagram_id": item.get("id"),
        "summary": item.get("summary"),
        "source_hash": item.get("source_hash"),
        "scene_hash": scene_hash,
        "scene_path": scene_path,
        "scene_archive_path": (
            "blobs/" + os.path.basename(scene_path)
            if isinstance(scene_path, str) and scene_path else None
        ),
        "png_hash": png_hash,
        "png_path": png_path,
        "png_archive_path": (
            "blobs/" + os.path.basename(png_path)
            if isinstance(png_path, str) and png_path else None
        ),
        "image_fallback": bool(item.get("image_fallback", False)),
    }


def _snapshots(state):
    snapshots = []
    seen = set()
    collections = [state.get("queue", [])]
    collections.extend([
        entry.get("items", [])
        for entry in state.get("feed", [])
        if isinstance(entry, dict) and isinstance(entry.get("items", []), list)
    ])
    for items in collections:
        if not isinstance(items, list):
            continue
        for item in items:
            snapshot = _snapshot_from_item(item)
            if snapshot is None:
                continue
            identity = (
                snapshot["scene_hash"], snapshot["png_hash"],
                snapshot["diagram_id"],
            )
            if identity in seen:
                continue
            seen.add(identity)
            snapshots.append(snapshot)
    return snapshots


def _assemble_report(artifact_path, state, info, usage):
    stat = os.stat(artifact_path)
    return {
        "schema": REPORT_SCHEMA,
        "tool_version": TOOL_VERSION,
        "artifact": {
            "path": artifact_path,
            "sha256": _sha256_file(artifact_path),
            "bytes": stat.st_size,
            "modified_at": stat.st_mtime,
        },
        "git": _git_context(artifact_path),
        "session": {
            "ended": bool(state["ended"]),
            "ended_by": state["ended_by"],
            "audit": state["audit"],
            "agent": state["agent"],
            "created_at": info.get("created_at"),
            "updated_at": info.get("updated_at"),
            "ended_at": info.get("ended_at"),
            "usage": usage,
        },
        "drafts": state["queue"],
        "activity": state["feed"],
        "snapshots": _snapshots(state),
    }


def build_report(artifact_path, session_dir):
    artifact_path = os.path.realpath(artifact_path)
    session_dir = os.path.realpath(session_dir)
    if not os.path.isfile(artifact_path):
        raise FileNotFoundError(artifact_path)
    store = ReviewStore(session_dir, STATE_SCHEMA, read_only=True)
    try:
        return _assemble_report(
            artifact_path,
            store.load(),
            store.session_info(),
            store.usage(),
        )
    finally:
        store.close()


def _inline(value):
    return (str(value).replace("`", "\\`")
            .replace("\r", "\\r").replace("\n", "\\n"))


def _activity_text(entry):
    if entry.get("text"):
        return str(entry["text"])
    lines = []
    for item in entry.get("items") or []:
        if not isinstance(item, dict):
            continue
        if item.get("kind") == "chat":
            lines.append(str(item.get("text") or ""))
        elif item.get("kind") == "whiteboard":
            lines.append(
                f"Diagram {item.get('id')}: {item.get('summary') or 'edited'}")
        else:
            label = item.get("label") or item.get("selector") or item.get("kind")
            comment = item.get("comment")
            lines.append(f"{label}: {comment}" if comment else str(label))
    return "\n".join(lines)


def _indented(value):
    lines = str(value).splitlines() or [""]
    return "\n".join("    " + line for line in lines)


def _markdown(report):
    artifact = report["artifact"]
    git = report["git"]
    session = report["session"]
    lines = [
        "# Artifact review report",
        "",
        f"- Schema: `{_inline(report['schema'])}`",
        f"- Tool version: `{_inline(report['tool_version'])}`",
        f"- Artifact: `{_inline(artifact['path'])}`",
        f"- Artifact SHA-256: `{artifact['sha256']}`",
        f"- Git commit: `{git['commit'] or 'unavailable'}`",
        f"- Git dirty: `{git['dirty']}`",
        f"- Review ended: `{session['ended']}`",
        f"- Ended by: `{session['ended_by'] or 'n/a'}`",
        "",
        "## Activity",
        "",
    ]
    if not report["activity"]:
        lines.extend(["No delivered review activity.", ""])
    for index, entry in enumerate(report["activity"], 1):
        role = "Agent" if entry.get("role") == "agent" else "Reviewer"
        lines.extend([
            f"### {index}. {role}",
            "",
            f"- ID: `{_inline(entry.get('id') or 'n/a')}`",
            f"- Timestamp: `{entry.get('ts')}`",
        ])
        for field in ("status", "delivered_at", "answered_at", "reply_to"):
            if entry.get(field) is not None:
                lines.append(f"- {field.replace('_', ' ').title()}: "
                             f"`{_inline(entry[field])}`")
        lines.extend(["", _indented(_activity_text(entry)), ""])
    lines.extend(["## Snapshots", ""])
    if not report["snapshots"]:
        lines.extend(["No diagram snapshots.", ""])
    for snapshot in report["snapshots"]:
        lines.extend([
            f"- Diagram `{_inline(snapshot['diagram_id'] or 'unknown')}` — "
            f"scene `{snapshot['scene_hash'] or 'unavailable'}`, "
            f"PNG `{snapshot['png_hash'] or 'none'}`",
        ])
    lines.append("")
    return "\n".join(lines)


def render_report(report, report_format):
    if report_format == "json":
        return json.dumps(
            report, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
    if report_format == "markdown":
        return _markdown(report)
    raise ValueError("report format must be json or markdown")


def write_report(report, report_format, output):
    rendered = render_report(report, report_format)
    output = os.path.realpath(output)
    parent = os.path.dirname(output)
    os.makedirs(parent, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".arev-report.", dir=parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(rendered)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, output)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
    return output


def _safe_snapshot_paths(report, session_dir):
    whiteboards = os.path.realpath(os.path.join(session_dir, "whiteboards"))
    paths = set()
    for snapshot in report["snapshots"]:
        for field in ("scene_path", "png_path"):
            raw = snapshot.get(field)
            if not isinstance(raw, str) or not raw:
                continue
            path = os.path.realpath(raw)
            try:
                inside = os.path.commonpath((whiteboards, path)) == whiteboards
            except ValueError:
                inside = False
            if (inside and os.path.isfile(path)
                    and not os.path.islink(path)):
                paths.add(path)
    return sorted(paths)


def _path_inside(parent, path):
    try:
        return os.path.commonpath((parent, path)) == parent
    except ValueError:
        return False


def write_archive(artifact_path, session_dir, output):
    artifact_path = os.path.realpath(artifact_path)
    session_dir = os.path.realpath(session_dir)
    output = os.path.realpath(output)
    if output == artifact_path:
        raise ValueError("archive output cannot overwrite the artifact")
    if _path_inside(session_dir, output):
        raise ValueError("archive output cannot overwrite review session state")
    if not os.path.isfile(artifact_path):
        raise FileNotFoundError(artifact_path)
    parent = os.path.dirname(output)
    os.makedirs(parent, exist_ok=True)
    fd, tmp_archive = tempfile.mkstemp(prefix=".arev-archive.", dir=parent)
    os.close(fd)
    try:
        with tempfile.TemporaryDirectory(prefix="arev-archive-db.") as temp_dir:
            database_copy = os.path.join(temp_dir, "review.sqlite3")
            store = ReviewStore(session_dir, STATE_SCHEMA, read_only=True)
            try:
                store.backup_to(database_copy)
                source_usage = store.usage()
            finally:
                store.close()
            archived_store = ReviewStore(
                temp_dir, STATE_SCHEMA, read_only=True)
            try:
                archived_usage = archived_store.usage()
                for key in ("snapshot_blobs", "snapshot_bytes"):
                    archived_usage[key] = source_usage[key]
                report = _assemble_report(
                    artifact_path,
                    archived_store.load(),
                    archived_store.session_info(),
                    archived_usage,
                )
            finally:
                archived_store.close()
            with zipfile.ZipFile(
                    tmp_archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
                bundle.write(database_copy, "review.sqlite3")
                bundle.writestr("report.json", render_report(report, "json"))
                for path in _safe_snapshot_paths(report, session_dir):
                    bundle.write(path, "blobs/" + os.path.basename(path))
        os.replace(tmp_archive, output)
    finally:
        try:
            os.unlink(tmp_archive)
        except FileNotFoundError:
            pass
    return output


def _candidate_age(info, database_path):
    value = info.get("ended_at") or info.get("updated_at")
    if isinstance(value, (int, float)):
        return float(value)
    return os.path.getmtime(database_path)


def prune_sessions(state_root, older_than_days=30, apply=False,
                   running_session_dirs=None, now=None):
    if older_than_days < 0:
        raise ValueError("older_than_days cannot be negative")
    now = time.time() if now is None else float(now)
    cutoff = now - float(older_than_days) * 86400
    sessions_root = os.path.realpath(os.path.join(state_root, "sessions"))
    running = {os.path.realpath(path) for path in (running_session_dirs or set())}
    result = {
        "apply": bool(apply),
        "older_than_days": older_than_days,
        "candidates": [],
        "refused": [],
        "unreferenced_blobs": [],
        "removed_count": 0,
        "removed_blob_count": 0,
    }
    try:
        entries = sorted(os.scandir(sessions_root), key=lambda entry: entry.name)
    except FileNotFoundError:
        return result

    retained = []
    for entry in entries:
        if entry.is_symlink():
            result["refused"].append(entry.path)
            continue
        if not entry.is_dir(follow_symlinks=False):
            continue
        session_dir = os.path.realpath(entry.path)
        if os.path.dirname(session_dir) != sessions_root:
            result["refused"].append(entry.path)
            continue
        if session_dir in running:
            continue
        database = os.path.join(session_dir, "review.sqlite3")
        if not os.path.isfile(database) or os.path.islink(database):
            result["refused"].append(entry.path)
            continue
        try:
            store = ReviewStore(session_dir, STATE_SCHEMA, read_only=True)
            try:
                state = store.load()
                info = store.session_info()
                unreferenced = store.unreferenced_blobs()
            finally:
                store.close()
        except (OSError, RuntimeError, ValueError, sqlite3.DatabaseError):
            result["refused"].append(entry.path)
            continue
        result["unreferenced_blobs"].extend(unreferenced)
        if state["ended"] and _candidate_age(info, database) <= cutoff:
            result["candidates"].append({
                "session_dir": session_dir,
                "artifact_path": info.get("artifact_path"),
                "ended_at": info.get("ended_at"),
            })
        else:
            retained.append(session_dir)

    if not apply:
        return result
    for session_dir in retained:
        store = ReviewStore(session_dir, STATE_SCHEMA)
        try:
            pruned = store.prune_unreferenced_blobs()
            result["removed_blob_count"] += pruned["removed_count"]
        finally:
            store.close()
    for candidate in result["candidates"]:
        shutil.rmtree(candidate["session_dir"])
        result["removed_count"] += 1
    return result
