"""Validated install manifest and fixed-shape public schema helpers."""

import json
import os
import re


MANIFEST_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "manifest.json",
)


def _load_manifest():
    with open(MANIFEST_PATH, encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise RuntimeError("artifact-review manifest must be an object")
    required = ("tool_version", "event_schema", "report_schema", "state_schema")
    missing = [key for key in required if key not in value]
    if missing:
        raise RuntimeError(
            "artifact-review manifest is missing: " + ", ".join(missing))
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", value["tool_version"]):
        raise RuntimeError("artifact-review tool_version must be semantic")
    for field, prefix in (
        ("event_schema", "artifact-review/event/v"),
        ("report_schema", "artifact-review/report/v"),
    ):
        if not re.fullmatch(re.escape(prefix) + r"[1-9][0-9]*", value[field]):
            raise RuntimeError(f"artifact-review {field} is invalid")
    if not isinstance(value["state_schema"], int) or value["state_schema"] < 1:
        raise RuntimeError("artifact-review state_schema must be a positive integer")
    return value


MANIFEST = _load_manifest()
TOOL_VERSION = MANIFEST["tool_version"]
EVENT_SCHEMA = MANIFEST["event_schema"]
REPORT_SCHEMA = MANIFEST["report_schema"]
STATE_SCHEMA = MANIFEST["state_schema"]


def event_envelope(event_type, **fields):
    if not isinstance(event_type, str) or not event_type:
        raise ValueError("event type must be a non-empty string")
    event = {"schema": EVENT_SCHEMA, "type": event_type}
    event.update(fields)
    return event
