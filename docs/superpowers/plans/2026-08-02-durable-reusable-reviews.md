# Durable and Reusable Reviews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make long and repeated reviews durable, bounded, incrementally synchronized, exportable as stable reports, and maintainable through explicit archive/prune operations.

**Architecture:** Add a standard-library SQLite store that normalizes queue, feed, pending agent events, and scalar session metadata while preserving the existing in-memory state machine. `_persist_locked()` becomes a transactional diff sync rather than a full JSON rewrite and migrates legacy `session.json` once. The browser receives bounded initial state plus revision deltas and requests older activity pages on demand. A single manifest supplies tool, event, and report versions to the CLI and server.

**Tech Stack:** Python 3.9 standard library (`sqlite3`, `zipfile`, `hashlib`, `subprocess`), HTML/CSS/vanilla JavaScript, Node.js, Playwright, `unittest`.

## Global Constraints

- Preserve existing review event ordering, delivery acknowledgement, reopen, and browser terminology.
- Keep feedback durable before notifying an agent waiter.
- Migrate a valid legacy `session.json` without losing queue, feed, or feedback events.
- Quarantine corrupt database/state files; never silently overwrite the only recoverable copy.
- Keep SQLite writes under the existing state lock and one transaction per logical mutation.
- Return at most 50 activity entries in initial browser state and per activity page.
- Retain at most 256 browser revision deltas in memory; return a full reset when a client falls behind that window.
- Cap queue at 500 items, pending agent events at 1,000, feed history at 10,000, whiteboard snapshots at 1,000 content-addressed blobs, and session snapshot bytes at 512 MiB.
- Deduplicate byte-identical scene and PNG snapshots by SHA-256 while keeping paths immutable.
- Automatic shutdown is delayed 300 seconds after end and is cancelled by reopen.
- Archive never deletes source state. Prune is explicit, path-confined, and dry-run by default.
- Public event/report schemas are versioned and tests reject unmanifested version drift.

---

### Task 1: Single version manifest and public schemas

**Files:**

- Create: `skills/artifact-review/manifest.json`
- Create: `skills/artifact-review/scripts/versioning.py`
- Modify: `skills/artifact-review/scripts/arev.py`
- Modify: `skills/artifact-review/scripts/server.py`
- Modify: `tests/test_cli_foundation.py`
- Modify: `tests/selftest-loop.mjs`

**Interfaces:**

- Produces: `MANIFEST`, `TOOL_VERSION`, `EVENT_SCHEMA`, `REPORT_SCHEMA`, and `event_envelope(type, **fields)`.
- Consumes: current CLI/server version strings and all `/next` event creation points.

- [ ] **Step 1: Add failing manifest/schema tests**

Assert the CLI and server import one manifest, `arev --version` equals its `tool_version`, every feedback/layout/ended/idle poll result contains `schema == manifest.event_schema`, and package metadata matches `tool_version`.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
python3 tests/test_cli_foundation.py
```

- [ ] **Step 3: Add and load the manifest**

Use:

```json
{
  "tool_version": "0.2.0",
  "event_schema": "artifact-review/event/v1",
  "report_schema": "artifact-review/report/v1",
  "state_schema": 1
}
```

`versioning.py` resolves it relative to the script directory, validates every required field, and exports constants. Replace duplicate `VERSION` literals and wrap public events with `event_envelope`.

- [ ] **Step 4: Run focused/full tests and commit**

```bash
python3 tests/test_cli_foundation.py
npm test
git add skills/artifact-review/manifest.json skills/artifact-review/scripts/versioning.py skills/artifact-review/scripts/arev.py skills/artifact-review/scripts/server.py tests/test_cli_foundation.py tests/selftest-loop.mjs package.json
git commit -m "Version review events from one manifest"
```

### Task 2: SQLite incremental session store and legacy migration

**Files:**

- Create: `skills/artifact-review/scripts/review_store.py`
- Modify: `skills/artifact-review/scripts/server.py`
- Create: `tests/test_review_store.py`
- Modify: `tests/run.sh`

**Interfaces:**

- Produces: `ReviewStore(session_dir, state_schema)`, `load() -> dict`, `sync(state) -> None`, `activity(before, limit) -> dict`, and `close()`.
- Consumes: in-memory `STATE` fields `ended`, `ended_by`, `queue`, `audit`, `feed`, `events`, and `agent`.

- [ ] **Step 1: Write failing store contract tests**

Cover schema creation, normalized row counts, append/update/delete sync, rollback on a forced error, concurrent reader visibility, valid `session.json` migration, corrupt JSON quarantine, corrupt SQLite quarantine, and load equivalence after process restart.

- [ ] **Step 2: Run the store test and verify RED**

```bash
python3 tests/test_review_store.py
```

- [ ] **Step 3: Implement normalized transactional sync**

Create tables `meta`, `queue_items`, `feed_items`, `agent_events`, and `migrations`. Use WAL, `synchronous=FULL`, foreign keys, and busy timeout. Cache the last synced fixed-shape state; one transaction upserts changed scalar keys/items, deletes removed ids, and appends new feed rows. Never serialize the complete feed or event list into one cell.

- [ ] **Step 4: Migrate and quarantine safely**

On a new database, import a valid legacy `session.json`, record the migration, and rename it `session.legacy.json`. Rename invalid JSON to `session.corrupt.<timestamp>.json`. If opening/integrity-checking SQLite fails, rename it `review.corrupt.<timestamp>.sqlite3` before creating a new store.

- [ ] **Step 5: Wire server restore/persist and verify**

Initialize `STORE` before `_restore`, make `_persist_locked` call `STORE.sync`, and keep working whiteboard files separate. Close the connection after `serve_forever` exits.

- [ ] **Step 6: Run focused/full tests and commit**

```bash
python3 tests/test_review_store.py
npm test
git add skills/artifact-review/scripts/review_store.py skills/artifact-review/scripts/server.py tests/test_review_store.py tests/run.sh
git commit -m "Persist review sessions incrementally in SQLite"
```

### Task 3: Revision deltas and paginated activity

**Files:**

- Modify: `skills/artifact-review/scripts/server.py`
- Modify: `skills/artifact-review/assets/review-ui/chrome.html`
- Modify: `tests/selftest-loop.mjs`
- Modify: `tests/selftest-rail.mjs`
- Modify: `tests/test_review_store.py`

**Interfaces:**

- Produces: `GET /state/next?after=N&mode=delta`, `GET /activity?before=N&limit=50`, `state.activity`, `applyStateDelta(current, response)`, and `loadEarlierActivity()`.
- Consumes: `ReviewStore.activity`, current revision condition variable, and `renderFeed`.

- [ ] **Step 1: Add failing delta/page assertions**

Seed 125 feed rows. Assert `/state` returns only rows 75-124 plus `{total:125,next_before:75,has_more:true}`. Fetch two earlier pages with no overlap/gap. Make a queue-only mutation and assert the next-state response contains `mode:'delta'`, the new revision, and queue data but no full feed. Ask after a revision older than the 256-entry window and assert `mode:'reset'` with bounded state.

- [ ] **Step 2: Run focused drives and verify RED**

```bash
node tests/selftest-loop.mjs FIXTURE
node tests/selftest-rail.mjs FIXTURE
```

- [ ] **Step 3: Publish bounded deltas**

Keep the last 256 `{revision, changes}` records. `_changed_locked()` compares the bounded public state with the prior published state and records scalar replacements, queue replacement, audit/agent replacement, and feed upserts keyed by event id. `/state/next` merges changes after `after` or emits a reset when unavailable.

- [ ] **Step 4: Page activity in browser/server**

Return the newest 50 feed rows in public state. `/activity` uses stable feed sequence indexes from SQLite. Add one **Load earlier activity** control at the top of Activity when `has_more`; merge pages by id while retaining scroll position and loaded pages across rail collapse.

- [ ] **Step 5: Run focused/full tests and commit**

```bash
npm test
git add skills/artifact-review/scripts/server.py skills/artifact-review/assets/review-ui/chrome.html tests/selftest-loop.mjs tests/selftest-rail.mjs tests/test_review_store.py
git commit -m "Stream review deltas and page activity"
```

### Task 4: Quotas, content-addressed snapshots, and retention

**Files:**

- Modify: `skills/artifact-review/scripts/server.py`
- Modify: `skills/artifact-review/scripts/review_store.py`
- Modify: `tests/test_review_store.py`
- Modify: `tests/selftest-whiteboard.mjs`
- Modify: `tests/selftest-loop.mjs`

**Interfaces:**

- Produces: `QuotaExceeded(kind, limit)`, `ReviewStore.usage()`, content-addressed `whiteboards/blobs/<sha256>.<ext>`, and `ReviewStore.prune_unreferenced_blobs()`.
- Consumes: queue/feed/event mutation paths and whiteboard submission bytes.

- [ ] **Step 1: Add failing boundary/dedup tests**

Assert values at each limit succeed, limit+1 returns 413 with `{error,resource,limit,current}`, identical scene/PNG submissions reuse paths, different bytes create different paths, partial write failure leaves neither metadata nor orphan temp files, and unreferenced blobs are removed while referenced ones survive.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
python3 tests/test_review_store.py
node tests/selftest-whiteboard.mjs FIXTURE
```

- [ ] **Step 3: Enforce fixed quotas before mutation**

Check queue/events/feed under the state lock and snapshot count/bytes through store usage. Return structured 413 errors without changing state. Retain the newest 10,000 feed entries and record the number trimmed in store metadata.

- [ ] **Step 4: Save immutable content-addressed blobs**

Canonicalize scene JSON with sorted compact encoding, hash bytes, atomically write only absent blobs, validate existing blob size/hash, and return shared paths. Store reference hashes with feed/queue items so pruning can calculate reachability.

- [ ] **Step 5: Run focused/full tests and commit**

```bash
npm test
git add skills/artifact-review/scripts/server.py skills/artifact-review/scripts/review_store.py tests/test_review_store.py tests/selftest-whiteboard.mjs tests/selftest-loop.mjs
git commit -m "Bound review storage and deduplicate snapshots"
```

### Task 5: Reports, archive/prune, and delayed end shutdown

**Files:**

- Create: `skills/artifact-review/scripts/reports.py`
- Modify: `skills/artifact-review/scripts/arev.py`
- Modify: `skills/artifact-review/scripts/server.py`
- Modify: `skills/artifact-review/SKILL.md`
- Modify: `skills/artifact-review/references/runtime.md`
- Create: `tests/test_reports_retention.py`
- Modify: `tests/test_cli_foundation.py`
- Modify: `tests/run.sh`

**Interfaces:**

- Produces: `arev report FILE --format json|markdown [-o FILE]`, `arev archive FILE [-o ZIP]`, `arev prune [--older-than DAYS] [--apply]`, `build_report`, `write_report`, and delayed shutdown scheduling/cancellation.
- Consumes: manifest schemas, SQLite store read API, artifact bytes/stat, optional local Git metadata, and session directory confinement.

- [ ] **Step 1: Add failing report/retention tests**

Create a temporary Git repo and review data. Assert JSON/Markdown contain report schema, tool version, artifact SHA-256, path, current Git commit and dirty flag, ordered feedback/replies, delivery timestamps, and snapshot identities. Assert archive contains DB/report/blobs without source artifact bytes. Assert prune defaults to dry-run, `--apply` removes only ended stopped sessions older than the threshold, and path traversal/symlinks are refused. Patch the shutdown delay to 50 ms and assert end schedules, reopen cancels, and an uncancelled timer stops the matching instance.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
python3 tests/test_reports_retention.py
```

- [ ] **Step 3: Implement deterministic reports**

`build_report` returns fixed-shape `artifact-review/report/v1` data. Git lookup is best-effort and local: `rev-parse --show-toplevel`, `rev-parse HEAD`, and `status --porcelain -- <artifact>`. JSON uses sorted keys/indentation; Markdown uses stable headings and escapes reviewer text safely.

- [ ] **Step 4: Implement archive and explicit prune**

Archive requires a stopped or ended session, writes a ZIP atomically, includes a generated JSON report, and leaves state intact. Prune enumerates only direct session children whose resolved paths stay below `STATE_ROOT/sessions`; dry-run prints candidates and `--apply` removes them plus unreferenced blobs.

- [ ] **Step 5: Schedule and cancel post-end shutdown**

Keep one daemon timer guarded by the state lock. `/end` schedules 300 seconds; `/reopen` cancels; `/shutdown` cancels. The callback checks the same instance is still ended before invoking `server.shutdown`.

- [ ] **Step 6: Update lazy skill guidance, run full tests, and commit**

```bash
python3 tests/test_reports_retention.py
npm test
git add skills/artifact-review/scripts/reports.py skills/artifact-review/scripts/arev.py skills/artifact-review/scripts/server.py skills/artifact-review/SKILL.md skills/artifact-review/references/runtime.md tests/test_reports_retention.py tests/test_cli_foundation.py tests/run.sh
git commit -m "Add reusable reports and review retention tools"
```
