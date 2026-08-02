# Runtime and Agent Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make review startup light, serve large static assets efficiently, and reduce the context and output cost paid by every agent session.

**Architecture:** Keep the existing sandbox boundary and one-process-per-artifact server. Replace eager per-diagram editor frames with one lazily created frame that moves between diagram hosts after a bounded autosave flush. Build a startup-time static asset manifest with cached raw/gzip bytes and hashes, then expose those hashes in internal URLs for immutable browser caching. Leave detailed workflow guidance in lazy references while `SKILL.md` becomes the compact router.

**Tech Stack:** Python 3.9 standard library, HTML/CSS/vanilla JavaScript, bundled Excalidraw/Mermaid assets, Node.js, Playwright, shell acceptance runner.

## Global Constraints

- Keep all reviewed artifact source files authoritative and untouched by the review runtime.
- Keep tokenless nested-frame assets Host-validated and free of the bearer token.
- Never mount more than one `/whiteboard-frame` in an artifact document.
- Do not load `/whiteboard.js` or `/whiteboard.css` until a reviewer opens a diagram editor.
- Flush the active scene before switching diagrams or reloading the artifact.
- Use content hashes for immutable internal asset URLs; dynamic controller and state responses remain `no-store`.
- Preserve Python 3.9 compatibility and add no Python runtime dependency.
- Keep default CLI event output machine-readable and single-line; expose pretty output only by an explicit flag.
- Add the failing acceptance assertion before each behavior change.

---

### Task 1: Lazy shared whiteboard frame

**Files:**

- Modify: `skills/artifact-review/assets/review-ui/sdk.js`
- Modify: `skills/artifact-review/assets/review-ui/chrome.html`
- Modify: `tests/whiteboard-test-helpers.mjs`
- Modify: `tests/selftest-whiteboard.mjs`
- Modify: `tests/selftest-diagram-features.mjs`

**Interfaces:**

- Consumes: existing `want-board`, `focus-inline`, `whiteboard-frame`, `flush`, and `save-result` messages.
- Produces: one global SDK frame, `activateInlineDiagram(record)`, and the invariant `document.querySelectorAll('[id^="arev-board-"] iframe').length <= 1`.

- [ ] **Step 1: Write failing lazy-mount assertions**

Before opening either editor, assert every diagram host exists, no host contains an iframe, and no request pathname is `/whiteboard.js` or `/whiteboard.css`. Open the first host and assert exactly one frame exists; open the second and assert the same frame count remains one while its URL now names the second diagram.

```js
test.check('diagram editors defer the heavy whiteboard bundle',
  await artifactFrame.locator('[id^="arev-board-"] iframe').count() === 0 &&
  !whiteboardRequests.some(url => /\/whiteboard\.(?:js|css)$/.test(new URL(url).pathname)));

await openWhiteboard(page, first);
await openWhiteboard(page, second);
test.check('all diagrams share one lazily moved editor frame',
  await artifactFrame.locator('[id^="arev-board-"] iframe').count() === 1 &&
  new URL(second.editorFrame.url()).searchParams.get('diagram') === second.id);
```

- [ ] **Step 2: Run the diagram drive and verify RED**

Run through the fixture wrapper:

```bash
bash tests/run.sh
```

Expected: the new pre-activation assertion sees one iframe and the two-diagram assertion sees two frames.

- [ ] **Step 3: Build dormant diagram hosts**

In `mountInline`, create the host and activation button but keep the Mermaid block visible. Store `iframe:null`, `ready:false`, and `wantsUnlock:false` on each board. Do not assign `src` or create an iframe during discovery.

```js
var sharedInlineFrame = null;
var activeInlineBoardId = null;

function mountInline(message) {
  // Validate id/channel/selector, create one compact host and activation button,
  // register the board, and leave its source block visible.
}
```

- [ ] **Step 4: Move one frame after a controller-side flush**

Make an activation click send `want-board`. In `focusInlineDiagram`, await `flushInlineDiagrams('diagram-switch')`, then post `focus-inline`. The SDK creates the shared iframe on first activation, detaches it from the previous host, restores the previous Mermaid block, updates `src` with the next diagram/channel, and hides the new source only after the frame sends `ready`.

```js
async function focusInlineDiagram(id) {
  const record = inlineDiagrams.get(String(id || ''));
  if (!record || state?.ended) return;
  await flushInlineDiagrams('diagram-switch');
  art.contentWindow.postMessage({ arev:true, type:'focus-inline', id:record.block.id }, '*');
}
```

- [ ] **Step 5: Update helpers for deferred frame discovery**

`waitForInlineDiagram` returns the host without requiring an iframe. `openWhiteboard` clicks the unique activation control, then resolves the current `/whiteboard-frame?diagram=<id>` and assigns `diagram.editorFrame`.

- [ ] **Step 6: Run focused and full regressions**

```bash
npm test
```

Expected: all existing save, stale-source, fullscreen, offline, and delivery assertions pass with one shared frame.

- [ ] **Step 7: Commit**

```bash
git add skills/artifact-review/assets/review-ui/sdk.js skills/artifact-review/assets/review-ui/chrome.html tests/whiteboard-test-helpers.mjs tests/selftest-whiteboard.mjs tests/selftest-diagram-features.mjs
git commit -m "Lazy-load one shared diagram editor"
```

### Task 2: Hashed, compressed, memory-cached static assets

**Files:**

- Modify: `skills/artifact-review/scripts/server.py`
- Modify: `skills/artifact-review/assets/review-ui/chrome.html`
- Modify: `skills/artifact-review/assets/review-ui/whiteboard-frame.html`
- Create: `tests/test_asset_delivery.py`
- Modify: `tests/run.sh`

**Interfaces:**

- Produces: `_load_asset_cache(asset_dir) -> dict`, `_asset_url(name) -> str`, `_static_response(name, public_static=False)`, strong ETags, and `window.AREV.assets`.
- Consumes: current `MIME`, Host guard, public static CORS boundary, and boot placeholder.

- [ ] **Step 1: Add failing HTTP cache tests**

Start a temporary session and request the hashed whiteboard bundle with `Accept-Encoding: gzip`. Assert `Content-Encoding: gzip`, `Cache-Control: public, max-age=31536000, immutable`, a quoted SHA-256 ETag, `Vary: Accept-Encoding`, and a gzip body smaller than the source. Repeat with `If-None-Match` and assert 304 with no body. Request the unhashed path and assert it is revalidated rather than immutable.

```python
self.assertEqual(response.status, 200)
self.assertEqual(response.getheader('Content-Encoding'), 'gzip')
self.assertIn('immutable', response.getheader('Cache-Control'))
self.assertEqual(revalidated.status, 304)
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
python3 tests/test_asset_delivery.py
```

Expected: static responses are `no-store`, uncompressed, and ignore `If-None-Match`.

- [ ] **Step 3: Cache bytes and hashes once at startup**

Read only known files from `ASSET_DIR` into entries containing raw bytes, deterministic gzip bytes (`mtime=0`), MIME type, SHA-256 hex digest, and quoted ETag. Precompute combined `audit.js + sdk.js` as the logical `sdk.js` entry. Fail startup if a required runtime asset is absent.

- [ ] **Step 4: Serve conditional compressed variants**

For a matching `?v=<sha256>` use immutable caching; otherwise use `public, max-age=0, must-revalidate`. Honor `If-None-Match` before writing a body and set CORS only for the existing public nested-frame assets.

- [ ] **Step 5: Inject the manifest into internal URLs**

Add the public hash map to the controller boot object. Use it for the injected SDK, controller whiteboard stylesheet, frame URL, and the frame's own CSS/module URLs. The token must not appear in any asset URL.

- [ ] **Step 6: Run focused security and full regressions**

```bash
python3 tests/test_asset_delivery.py
npm test
```

- [ ] **Step 7: Commit**

```bash
git add skills/artifact-review/scripts/server.py skills/artifact-review/assets/review-ui/chrome.html skills/artifact-review/assets/review-ui/whiteboard-frame.html tests/test_asset_delivery.py tests/run.sh
git commit -m "Cache and compress hashed review assets"
```

### Task 3: Compact skill router and event output

**Files:**

- Modify: `skills/artifact-review/SKILL.md`
- Create: `skills/artifact-review/references/runtime.md`
- Create: `skills/artifact-review/references/events.md`
- Create: `skills/artifact-review/references/remote.md`
- Modify: `skills/artifact-review/scripts/arev.py`
- Modify: `tests/test_cli_foundation.py`
- Modify: `docs/skill-efficiency-audit/bench.sh`

**Interfaces:**

- Produces: `arev poll --pretty`, concise default `brief` install output, and a router under 5,500 bytes.
- Consumes: all existing commands and event schemas without changing their machine-readable fields.

- [ ] **Step 1: Add failing CLI-output tests**

Patch `_api` to return one feedback event. Assert default `cmd_poll` output is exactly one JSON line, `--pretty` is multi-line, and successful `brief plan` starts with one concise install line rather than a full path-bearing doctor document.

```python
self.assertEqual(len(default_output.splitlines()), 1)
self.assertGreater(len(pretty_output.splitlines()), 1)
self.assertRegex(brief_output.splitlines()[1], r'^INSTALL ok python=')
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
python3 tests/test_cli_foundation.py
```

- [ ] **Step 3: Make compact output the default**

Add `_print_event(value, pretty=False)` using `json.dumps(value, indent=2)` only for `--pretty`; otherwise use `separators=(',', ':')`. Add the flag to `poll`. Make `brief` print one install summary line on success and retain full `doctor` output for diagnosis.

- [ ] **Step 4: Split detailed guidance behind event routes**

Move delivery-state, whiteboard, remote/headless, lifecycle, and event-specific procedures from `SKILL.md` into the three references. Keep in `SKILL.md`: launcher resolution, the one-time `brief`/`new` setup, `open`, the foreground poll loop, a fixed event-to-reference table, source-authority/security rules, and finish commands.

- [ ] **Step 5: Measure the router and outputs**

Extend `bench.sh` to report `SKILL.md` bytes, default/pretty poll bytes, concise/full install bytes, initial controller compressed bytes, pre-activation whiteboard requests, and post-activation whiteboard transfer bytes. Assert the router is at most 5,500 bytes in the test harness.

- [ ] **Step 6: Run CLI and full regressions**

```bash
python3 tests/test_cli_foundation.py
bash docs/skill-efficiency-audit/bench.sh
npm test
```

- [ ] **Step 7: Commit**

```bash
git add skills/artifact-review/SKILL.md skills/artifact-review/references/runtime.md skills/artifact-review/references/events.md skills/artifact-review/references/remote.md skills/artifact-review/scripts/arev.py tests/test_cli_foundation.py docs/skill-efficiency-audit/bench.sh
git commit -m "Reduce review skill and event overhead"
```

### Task 4: Document measured efficiency guarantees

**Files:**

- Modify: `README.md`
- Modify: `docs/skill-efficiency-audit/implementation_notes.md`
- Create: `docs/skill-efficiency-audit/runtime-after.txt`

**Interfaces:**

- Consumes: the committed benchmark command and its raw output.
- Produces: reproducible before/after numbers and the user-facing lazy-editor/cache behavior.

- [ ] **Step 1: Capture the benchmark output**

```bash
bash docs/skill-efficiency-audit/bench.sh > docs/skill-efficiency-audit/runtime-after.txt
```

- [ ] **Step 2: Record only measured results**

Update the notes and README with the command, environment, router byte reduction, pre-activation request count, gzip ratio, and default event-output reduction. Label any browser timing as environment-specific rather than a universal latency guarantee.

- [ ] **Step 3: Run documentation and whitespace checks**

```bash
git diff --check
bash -n docs/skill-efficiency-audit/bench.sh
```

- [ ] **Step 4: Commit**

```bash
git add README.md docs/skill-efficiency-audit/implementation_notes.md docs/skill-efficiency-audit/runtime-after.txt
git commit -m "Document review runtime efficiency gains"
```
