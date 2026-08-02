# Review Workspace Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Artifact Review's live session foundation safe and predictable, and replace the fixed right review rail with a persistent Chrome-style panel-to-dock interaction that remains on the right at every viewport.

**Architecture:** Keep the existing single-process Python HTTP server and browser controller, but add authenticated lifecycle endpoints and a verified instance identity. Centralize CLI registry access behind a cross-platform lock and route every local request through a stored control URL. In the controller, keep the review panel DOM mounted while a small state machine changes its geometry and accessibility state, and replace the reload boolean with a version-keyed serial drain.

**Tech Stack:** Python 3 standard library, HTML/CSS/vanilla JavaScript, Node.js, Playwright, shell acceptance runner.

## Global Constraints

- Preserve the existing Review Desk palette, typography, state words, feedback history, and delivery behavior.
- Use Chrome only as the interaction reference: expanded panel becomes a 64px icon dock; the panel stays on the right.
- Keep every new server operation authenticated with the existing bearer token.
- Never signal a PID recovered from the registry; only terminate a fresh child through the owned `Popen` handle during failed startup.
- Keep the existing registry file readable during this slice.
- Add the test before each behavior change and observe the focused test fail for the intended reason.
- Use one commit per task after focused and relevant regression tests pass.
- Immediately before editing the review UI, load the Impeccable craft-floor playbook. After the UI is complete, run its detector exactly once and perform one bounded desktop/mobile visual-verification pass.

---

## Task 1: Add authenticated server identity, reopen, and shutdown

**Files:**

- Modify: `skills/artifact-review/scripts/server.py`
- Modify: `tests/selftest-loop.mjs`
- Modify: `tests/test-helpers.mjs`

- [ ] **Step 1: Write failing lifecycle assertions**

Extend the loop drive after the existing end-review assertion. Call `openSession(ART, ['--reopen'])`, then assert `/state` reports `ended === false`, `ended_by === null`, `audit.status === 'pending'`, feedback history remains, and a new queued chat can be accepted. Add a helper option so `openSession` can append CLI flags without duplicating process code.

Add direct authenticated assertions for:

```js
const health = await api('GET', '/health');
test.check('health exposes a stable server identity', /^[a-f0-9-]{36}$/.test(health.instance_id));

const reopened = await api('POST', '/reopen', {});
test.check('reopen is idempotent', reopened.ended === false && reopened.ended_by === null);
```

- [ ] **Step 2: Run the focused drive and confirm RED**

Run:

```bash
node tests/selftest-loop.mjs tests/fixtures/clean.html
```

Expected: failure because `/health` and `/reopen` do not exist and live `--reopen` leaves the session ended.

- [ ] **Step 3: Implement one process identity and the lifecycle routes**

In `server.py`, create one identity at module startup:

```python
INSTANCE_ID = str(uuid.uuid4())
```

Route authenticated requests as follows:

```python
if path == "/health":
    return self._json(200, {"ok": True, "instance_id": INSTANCE_ID})
```

For `POST /reopen`, mutate under the existing condition lock:

```python
STATE["ended"] = False
STATE["ended_by"] = None
STATE["events"] = [
    event for event in STATE.get("events", [])
    if event.get("kind") not in {"ended", "layout"}
]
STATE["audit"] = {"status": "pending", "issues": [], "checked_at": None}
STATE["revision"] += 1
_persist_locked()
COND.notify_all()
```

Return the public state. Repeating the operation must be harmless and must not erase `queue`, `history`, or feedback events.

For `POST /shutdown`, acknowledge first, then stop the exact running HTTP server without blocking its handler:

```python
self._json(200, {"ok": True, "instance_id": INSTANCE_ID})
threading.Thread(target=self.server.shutdown, daemon=True).start()
```

- [ ] **Step 4: Trigger browser re-audit after an ended-to-open transition**

In the controller, retain the previous ended value before applying state. When it changes from true to false, enqueue a reload for the current artifact version so the reset audit is actually repopulated.

- [ ] **Step 5: Run focused lifecycle tests and confirm GREEN**

Run the loop drive through `tests/run.sh` using a temporary filtered runner or run the full loop fixture. Verify health identity remains the same for the process and reopen accepts new feedback.

- [ ] **Step 6: Commit**

```bash
git add skills/artifact-review/scripts/server.py skills/artifact-review/assets/review-ui/chrome.html tests/selftest-loop.mjs tests/test-helpers.mjs
git commit -m "Add authenticated review lifecycle endpoints"
```

## Task 2: Make registry ownership, locking, and URLs safe

**Files:**

- Modify: `skills/artifact-review/scripts/arev.py`
- Create: `tests/test_cli_foundation.py`
- Modify: `tests/run.sh`

- [ ] **Step 1: Add failing focused Python tests**

Load `arev.py` through `importlib.util` after assigning a temporary `ARTIFACT_REVIEW_HOME`. Cover these exact contracts:

```python
self.assertEqual(arev._control_url("0.0.0.0", 4321), "http://127.0.0.1:4321")
self.assertEqual(arev._control_url("::", 4321), "http://[::1]:4321")
self.assertEqual(arev._control_url("::1", 4321), "http://[::1]:4321")
```

Add a multiprocessing test in which eight workers add distinct records through `_update_registry`; all eight keys must survive. Add a stale-record test whose fake PID points at the current test process and whose health request fails; patch `os.kill` to raise if called, run stop, and assert the record is removed without a signal attempt.

Add an IPv6 integration test guarded by an actual `AF_INET6` bind probe. Start with `--bind ::1`, assert the printed URL contains `[::1]`, and fetch `/health` through that URL.

- [ ] **Step 2: Run the Python test and confirm RED**

```bash
python3 tests/test_cli_foundation.py
```

Expected: URL helpers, locked registry mutation, and verified stop behavior are absent.

- [ ] **Step 3: Centralize URL formatting and API requests**

Add:

```python
def _url_host(bind):
    host = "127.0.0.1" if bind in {"", "0.0.0.0"} else "::1" if bind == "::" else bind
    return f"[{host}]" if ":" in host and not host.startswith("[") else host

def _control_url(bind, port):
    return f"http://{_url_host(bind)}:{port}"
```

Change `_api` to build URLs from `entry["control_url"]`, falling back only for legacy records. Keep `base_url` solely for the browser-facing URL. Reject a `--public-url` whose parsed path is not empty or `/` with an actionable CLI error.

- [ ] **Step 4: Add the cross-platform registry lock**

Create `registry.lock` beside the registry. The context manager opens it in append-binary mode, guarantees at least one byte for Windows locking, and uses:

```python
if os.name == "nt":
    import msvcrt
    msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
else:
    import fcntl
    fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
```

Unlock in `finally`. Keep `_load_registry_unlocked` and `_save_registry_unlocked` private; expose short `_read_registry()` and `_update_registry(mutator)` operations so no call site performs an unlocked read-modify-write. Hold the lock across the existing-session check and registry insertion during startup to prevent duplicate owners.

- [ ] **Step 5: Verify identity before reuse or stop**

Store:

```python
{
    "pid": process.pid,
    "port": port,
    "token": token,
    "control_url": control_url,
    "base_url": browser_base_url,
    "instance_id": health["instance_id"],
}
```

Implement `_verified_health(entry)` to call authenticated `/health` and require the returned identifier to equal the registry value. Permit one-time adoption for a legacy record missing `instance_id` only when its authenticated health call succeeds. Reuse only verified entries.

Change stop to:

```python
if _verified_health(entry):
    _api(entry, "POST", "/shutdown", {})
remove_registry_entry()
```

When verification fails, remove the stale entry and report it; never call `os.kill`.

- [ ] **Step 6: Integrate and run focused tests**

Add `python3 "$ROOT/tests/test_cli_foundation.py"` near the start of `tests/run.sh`. Run it directly, then run the existing security drive to verify bearer-token behavior remains intact.

- [ ] **Step 7: Commit**

```bash
git add skills/artifact-review/scripts/arev.py tests/test_cli_foundation.py tests/run.sh
git commit -m "Verify and lock review session registry"
```

## Task 3: Refresh poll presence throughout long waits

**Files:**

- Modify: `skills/artifact-review/scripts/arev.py`
- Modify: `tests/test_cli_foundation.py`

- [ ] **Step 1: Write a failing heartbeat unit test**

Patch the poll chunk size to a small value and replace `_api` with a recorder that returns idle poll responses. Run `cmd_poll` long enough for three chunks and assert an `agent-status` update with `status: "listening"` follows every `/poll` response. Make the final poll raise and assert a best-effort `status: "offline"` update occurs while the original exception remains the reported error.

- [ ] **Step 2: Run the heartbeat test and confirm RED**

```bash
python3 tests/test_cli_foundation.py PollHeartbeatTests
```

- [ ] **Step 3: Implement heartbeat after each chunk**

Extract `POLL_CHUNK_SECONDS = 90` and a `_set_agent_status(entry, status)` helper. Send `listening` initially and immediately after every completed poll chunk, including empty chunks. Wrap the loop so errors attempt `_set_agent_status(entry, "offline")` inside a nested `try/except` that cannot replace the original error.

- [ ] **Step 4: Run focused tests and commit**

```bash
python3 tests/test_cli_foundation.py PollHeartbeatTests
git add skills/artifact-review/scripts/arev.py tests/test_cli_foundation.py
git commit -m "Keep review poll presence alive"
```

## Task 4: Replace lossy iframe reload gating with a version drain

**Files:**

- Modify: `skills/artifact-review/assets/review-ui/chrome.html`
- Modify: `tests/selftest-loop.mjs`

- [ ] **Step 1: Add a failing two-save browser test**

During an intentionally delayed iframe load, atomically write version A and then version B of the fixture. Release the load and assert the frame eventually contains B, never settles on A, and performs no more than two reload operations. Also assert the artifact scroll position and annotation pressed state return after the final load.

- [ ] **Step 2: Run the loop drive and confirm RED**

Expected: the second save is ignored while `reloadInFlight` is true.

- [ ] **Step 3: Implement the serial version queue**

Replace the boolean and 250ms timer with:

```js
let loadedArtifactVersion = null;
let requestedArtifactVersion = null;
let reloadDrainPromise = null;

function requestArtifactReload(version) {
  if (version == null || version === loadedArtifactVersion) return reloadDrainPromise;
  requestedArtifactVersion = version;
  reloadDrainPromise ||= drainArtifactReloads().finally(() => { reloadDrainPromise = null; });
  return reloadDrainPromise;
}
```

`drainArtifactReloads` snapshots the newest requested version, calls `reloadArtifactOnce(version)`, records the version only after load succeeds, and loops once more whenever the requested version changed during the load.

`reloadArtifactOnce` must flush diagram saves, capture scroll and annotation mode, attach one-shot `load`/`error` listeners plus a bounded timeout before changing `iframe.src`, reset audit/controller state, await settlement, restore scroll and annotation state, and report a visible banner on failure without poisoning future requests.

- [ ] **Step 4: Run focused and diagram regressions**

Run the loop and diagram-feature drives. Confirm no fixed timer remains with:

```bash
rg -n "reloadInFlight|setTimeout\(.*250" skills/artifact-review/assets/review-ui/chrome.html
```

Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add skills/artifact-review/assets/review-ui/chrome.html tests/selftest-loop.mjs
git commit -m "Coalesce artifact reloads by version"
```

## Task 5: Build the persistent right-side Chrome-style review dock

**Files:**

- Modify: `skills/artifact-review/assets/review-ui/chrome.html`
- Modify: `tests/selftest-loop.mjs`

- [ ] **Step 1: Load the Impeccable craft-floor playbook**

Read `impeccable/references/craft-floor.md` immediately before editing the UI and follow its interaction, accessibility, and visual-quality floor.

- [ ] **Step 2: Write failing desktop, persistence, and narrow-screen tests**

At 1440px assert expanded width is 360px and right-aligned. Enter composer text, capture draft/activity scroll positions, collapse via `#railToggle`, and assert:

```js
{
  dockWidth: Math.round(rail.width) === 64,
  releasedWidth: Math.round(stageAfter.width - stageBefore.width) === 296,
  expanded: toggle.getAttribute('aria-expanded') === 'false',
  panelHidden: panel.getAttribute('aria-hidden') === 'true' && panel.inert,
}
```

Expand and assert text, drafts, activity, and scroll positions are unchanged. Reload the controller and assert the preference persists. Check `prefers-reduced-motion: reduce` computes zero transition duration.

Exercise Draft, Activity, and New feedback dock controls: each expands, focuses the target heading or composer, and updates the selected treatment. Verify a count of 100 displays `99+` while its accessible name contains `100`.

At 390px assert the collapsed dock is fixed to the right; expansion overlays from the right at `min(360px, viewport - 64px)` and does not move below or left. Assert the scrim closes, Escape closes, Tab remains contained, and focus returns to the toggle.

- [ ] **Step 3: Refactor markup without destroying panel state**

Keep one `<aside id="reviewRail">` with this stable structure:

```html
<div class="rail-toolbar" aria-label="Review panel controls">
  <button id="railToggle" aria-controls="reviewRailPanel"><span class="tooltip">Collapse review panel</span></button>
  <button id="draftDockBtn" aria-controls="draftSection"></button>
  <button id="activityDockBtn" aria-controls="activitySection"></button>
  <span class="dock-divider" aria-hidden="true"></span>
  <button id="newFeedbackDockBtn" aria-controls="chat"></button>
</div>
<div id="reviewRailPanel" class="rail-panel">…existing sections unchanged…</div>
```

Add a sibling `#railScrim` for the narrow overlay. Use inline SVG icons with `currentColor`; do not add an icon dependency or duplicate delivery actions.

- [ ] **Step 4: Implement the geometry and visual states**

Use variables `--review-rail-expanded: 360px` and `--review-dock-width: 64px`. Desktop remains a horizontal flex layout. Expanded toolbar is horizontal; collapsed toolbar is vertical. The same rail changes flex basis from 360px to 64px, and `.rail-panel` becomes visually hidden/inert without being removed.

At `max-width: 780px`, keep the stage full size, pin the rail to the right, and use a transform-based drawer plus scrim. Never switch `.workspace` to a column and never place the rail below the stage. Disable transitions under `prefers-reduced-motion`.

Preserve the Review Desk system: existing colors and type, 44px hit targets in the dock, quiet square selected state, clear focus ring, divider before compose, tooltip left of the right dock, and badge geometry that does not shift icons.

- [ ] **Step 5: Implement the panel state machine**

Restore before meaningful paint with a small head script using the versioned key `artifact-review:rail-state:v1`. Implement:

```js
function setRailCollapsed(collapsed, { persist = true, returnFocus = false } = {}) {
  document.documentElement.dataset.reviewRail = collapsed ? 'collapsed' : 'expanded';
  railToggle.setAttribute('aria-expanded', String(!collapsed));
  reviewRailPanel.inert = collapsed;
  reviewRailPanel.setAttribute('aria-hidden', String(collapsed));
  if (persist) localStorage.setItem(RAIL_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  if (returnFocus) railToggle.focus();
}
```

Wrap local-storage access in `try/catch` and default to expanded. `openRailSection(target)` expands, scrolls the existing section, and focuses its heading/composer. Preserve independent panel scroll, draft scroll, and activity scroll because the nodes stay mounted.

On narrow screens, use the same state plus a modal focus trap, Escape, and scrim close. Only New feedback is disabled when a session ends. Update the Draft badge to empty, `1`–`99`, or `99+`; expose the full number in the accessible name and tooltip.

- [ ] **Step 6: Run focused browser tests**

Run the loop drive, then the whiteboard and diagram drives to prove dock changes do not destroy editors or fullscreen state.

- [ ] **Step 7: Run Impeccable detector exactly once and perform bounded visual verification**

Run:

```bash
node /Users/ahmeddaraz/.agents/skills/impeccable/scripts/detect.mjs --json skills/artifact-review/assets/review-ui/chrome.html
```

Address real findings in one fix batch. Capture one desktop and one 390px screenshot, compare them with the two supplied Chrome references for interaction geometry, make at most one visual fix batch, then confirm once.

- [ ] **Step 8: Commit**

```bash
git add skills/artifact-review/assets/review-ui/chrome.html tests/selftest-loop.mjs
git commit -m "Add collapsible right review dock"
```

## Task 6: Verify the complete foundation and update operator documentation

**Files:**

- Modify: `README.md`
- Modify: `skills/artifact-review/SKILL.md`
- Modify: `docs/superpowers/specs/2026-08-02-review-workspace-foundation-design.md`

- [ ] **Step 1: Document observable behavior**

Document `open --reopen`, verified authenticated stop, IPv6 URL formatting, the persistent right dock, mobile overlay behavior, and the fact that collapsed review content is preserved. Keep skill routing compact; detailed behavior belongs in a lazily loaded reference if the main skill would grow.

- [ ] **Step 2: Run the complete verification set**

```bash
npm test
```

Also run Python bytecode compilation for modified Python modules and a shell syntax check for `tests/run.sh`. Record any environment-specific IPv6 skip explicitly.

- [ ] **Step 3: Self-review against the approved design**

Check every verification bullet in `docs/superpowers/specs/2026-08-02-review-workspace-foundation-design.md`. Search changed files for `TODO`, `TBD`, placeholder branches, hardcoded `127.0.0.1` API calls, `os.kill`, the old mobile stacked rail, and `reloadInFlight`. Confirm no result contradicts the design.

- [ ] **Step 4: Mark the foundation design implemented and commit**

Change the spec status to `implemented` only after all checks pass.

```bash
git add README.md skills/artifact-review/SKILL.md docs/superpowers/specs/2026-08-02-review-workspace-foundation-design.md
git commit -m "Document reliable review workspace foundation"
```

## Follow-on implementation sequence

After this foundation passes, continue the same design-test-implement-verify loop for every approved roadmap slice, in order:

1. Runtime and agent efficiency: shared lazy whiteboard editor, immutable hashed caching/ETags/compression/server byte cache, compact skill router and event output, and performance budgets.
2. Durable and reusable reviews: SQLite event storage, deltas/pagination, quotas/deduplication/retention/archive/prune/auto-stop, JSON/Markdown reports, artifact/Git identity, and one protocol manifest.
3. Arbitrary artifacts and export: confined asset root, parser-based SDK injection, robust portable bundling, strict external-resource manifest, and regression fixtures.
4. Annotation, audit, compatibility, and release quality: unique selectors/text-position anchors, capture opt-in/ignore/rectangles, audit triggers/viewports, Firefox/WebKit/OS/a11y/concurrency/corruption/remote tests, and automated release/build/protocol/update checks.

The overall goal remains active until all four follow-on slices are implemented and verified; completion of Task 6 only closes the foundation slice.
