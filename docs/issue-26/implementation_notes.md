# Issue 26 - Diagram rows show the accessibility phrasing as their visible label

## What the issue asked for

1. Each row names its diagram, for example `Process topology`.
2. The instruction to focus the editor belongs to the row's accessible name, not its visible text.
3. The list carries its own heading so it is not mistaken for draft feedback.
4. The row shows the diagram's caption, not the raw block id.

## Reproduction

Built a repro artifact with eight Mermaid blocks: six with authored ids, one wrapped in
`<figure><figcaption>`, one with no id at all.

- Artifact: `/private/tmp/claude-501/-Users-ahmeddaraz-Work-open-source-artifact-review/6c87a310-b3b7-4418-98b7-9aefe91ea77d/scratchpad/issue-26-repro.html`
- Before screenshot: `/private/tmp/claude-501/-Users-ahmeddaraz-Work-open-source-artifact-review/6c87a310-b3b7-4418-98b7-9aefe91ea77d/scratchpad/before.png`

Observed before the fix, matching the report exactly:

```
◇ Focus diagram editor: process-topology      aria-label: null
◇ Focus diagram editor: review-turn-sequence  aria-label: null
... eight rows, all inside section#draftSection under the heading "Draft feedback"
```

## Root cause

`renderDiagramList()` in `skills/artifact-review/assets/review-ui/chrome.html` wrote the action
phrasing into the row's `textContent`:

```js
label.textContent = `Focus diagram editor: ${block.id}`;
```

A button with no `aria-label` takes its accessible name from its visible text. Whoever wrote this
got a correct screen-reader name for free and paid for it with a broken visible label. The two names
have to be separate: `aria-label` carries the action, `textContent` carries the diagram name.

The list also lived inside `#draftSection`, so its rows rendered directly under the `Draft feedback`
heading with nothing to separate them.

## The fix

Three changes, all in the review chrome plus one in the artifact SDK.

**1. Split the visible name from the accessible name** (`chrome.html`, `renderDiagramList`):

```js
const name = diagramName(block);
button.setAttribute("aria-label", `Focus diagram editor: ${name}`);
const label = document.createElement("span");
label.className = "diagram-name";
label.textContent = name;
```

**2. Name the diagram in the SDK, which is the side that can see the artifact** (`sdk.js`). Only the
SDK runs inside the artifact document, so only it can read a caption. It also owns the id format, so
it is the only place that can name a block without guessing:

```js
function diagramTitle(holder, authoredId, index) {
  var figure = holder.closest("figure");
  var caption = figure ? figure.querySelector(":scope > figcaption") : null;
  var title =
    normalizedText(caption) ||
    (holder.getAttribute("aria-label") || "").trim();
  if (title) return title.slice(0, 80);
  var words = String(authoredId || "").replace(/[-_]+/g, " ").trim();
  if (!words) return "Diagram " + (index + 1);
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, 80);
}
```

`findMermaid()` ships that as `title` on every block, and the chrome just reads it:

```js
function diagramName(block) {
  return String(block?.title || "").trim().slice(0, 80) ||
    String(block?.id || "");
}
```

**3. Give the list its own section and heading** (`chrome.html`), moved out of `#draftSection`:

```html
<section id="diagramSection" aria-labelledby="diagramSectionTitle" hidden>
<div class="section-head">
  <h2 id="diagramSectionTitle">Diagrams</h2>
  <span class="hint">Open the inline editor</span>
</div>
<div class="diagram-list" id="diagrams"></div>
</section>
```

`renderDiagramList()` now toggles `#diagramSection.hidden` instead of the list's own `hidden`, so an
artifact with no diagrams hides the heading too.

## Code review (step 3) and what was applied

`/code-review` at medium effort returned four findings. It diffed against a stale local `main`, so
three of them (`artifact-template.html:63`, `artifact-template.html:64`, `tests/steps/layout.steps.js:6`)
belong to work already merged into `origin/main` by other agents. `git diff origin/main...HEAD`
confirms this branch touches only `chrome.html` and `sdk.js`. **Rejected as out of scope**; ten other
agents are working in parallel and editing those files would collide with them.

**Accepted:** `sdk.js` used `figure.querySelector("figcaption")`, which searches the whole subtree. A
`<figure>` may nest, and a caption may legally be a figure's last child, so a nested figure's image
credit could outrank the real caption. Scoped it to the figure's own caption:

```js
var caption = figure ? figure.querySelector(":scope > figcaption") : null;
```

Proved with a caption-last artifact: the row reads `Outer caption wins`, where plain `querySelector`
returns `Inner image credit`.

The reviewer also cleared three things it checked on purpose: the `hidden` toggle still works against
`display:flex` because chrome.html line 65 carries `[hidden] { display:none !important }`; the
`.diagram-name` ellipsis works inside the flex row because `overflow:hidden` drops the automatic
minimum size to zero; and no other code queries `#diagrams` or `#draftSection` for this list.

## Simplify (step 5)

Four parallel cleanup agents. Three independently flagged the same real problem, so it was fixed:

**`chrome.html` re-parsed an id format that `sdk.js` owns.** The first version of `diagramName()`
matched `/^arev-mermaid-(\d+)$/` to decide whether an id was generated. That is another module's
private string format read from across a `postMessage` boundary, and it leaked in a second way: an
authored id with punctuation becomes `slug-<8 hex digits>` through `safeDiagramId()`, so a diagram
authored as `Risk map, phase 2!` would have shown the row name `Risk map  phase 2  3f2a1c9d`.

The fix moved the whole naming decision into `sdk.js`, where the caption, the author's own id, and
the index are all already in scope. `chrome.html` lost the regex and the humanizer and is now two
lines. Verified against an artifact carrying all four naming paths:

```
◇ Risk map, phase 2!    (authored id with punctuation, no generated hash in sight)
◇ Named by aria-label   (aria-label on the block)
◇ Outer caption wins    (figcaption, with a nested figure present)
◇ Diagram 4             (no id at all)
```

Also applied: merged the duplicated `#draftSection` / `#diagramSection` CSS block into one rule, and
dropped a `holder.closest ? ... : null` guard that can never be false, since `findMermaid()` only
ever passes a real element.

**Skipped:** folding `diagramTitle()`'s trim-and-truncate tail into the existing `labelFor()` helper.
`labelFor()` returns `"<tag> text"` for annotation targets, which is a different output for a
different job; sharing only the `.slice(0, 80)` is not worth coupling them. The efficiency pass found
nothing: the added DOM work is one `closest` and one direct-child `querySelector` per block, once at
boot.

## Decisions and rejected alternatives

- **Caption sources: `figcaption` and `aria-label` only.** The diagram playbook tells authors to put
  a one-line caption above the block, but nothing marks that element as the caption. Reading
  `previousElementSibling` would guess, and would pick up an unrelated paragraph or a shared section
  heading, giving eight rows the same name. Two plain HTML sources that state authorship
  intent are enough; everything else falls back to the humanized id, which is what the issue's own
  expected result asks for (`process-topology` becomes `Process topology`).
- **Two diagrams inside one `<figure>` still share that figure's caption.** HTML gives a figure one
  caption, so there is nothing better to read. Left alone rather than inventing a numbering scheme
  for markup nobody writes.
- **Rejected parsing the Mermaid source for `title:` frontmatter or `accTitle:`.** No artifact in
  this repo uses it and it adds a parser for a case nobody has. Add it when a real artifact needs it.
- **`Diagram N` for generated ids.** A block with no authored id gets `arev-mermaid-7`, which
  humanizes to the useless "Arev mermaid 7". The row shows `Diagram 8` instead (1-based, matching
  reading order).
- **Kept `Focus diagram editor:` verbatim in the accessible name.** `tests/steps/artifact.steps.js`
  matches `getByRole('button', { name:/Focus diagram editor:/ })`, and that name is still correct
  for a screen reader. The test passes unchanged, which is the point: the accessible name was never
  the bug.
- **Diagram list scrolls internally.** `.diagram-list` got `min-height:0; overflow:auto` so an
  artifact with twenty diagrams cannot push the Activity section out of the rail.

## Verification

Re-ran the same probe against the same artifact after the fix. Restarting the session server is
required; it caches the review-ui assets in memory.

```
◇ Process topology                      aria-label: Focus diagram editor: Process topology
◇ Review turn sequence                  aria-label: Focus diagram editor: Review turn sequence
◇ Draft delivery states                 aria-label: Focus diagram editor: Draft delivery states
◇ Whiteboard save path                  aria-label: Focus diagram editor: Whiteboard save path
◇ Audit pipeline                        aria-label: Focus diagram editor: Audit pipeline
◇ Annotation anchor resolution          aria-label: Focus diagram editor: Annotation anchor resolution
◇ Session lifecycle, from open to end   aria-label: Focus diagram editor: Session lifecycle, from open to end
◇ Diagram 8                             aria-label: Focus diagram editor: Diagram 8

section: #diagramSection, heading "Diagrams"
```

Row 7 proves the `figcaption` path. Row 8 proves the generated-id fallback.

- After screenshot: `/private/tmp/claude-501/-Users-ahmeddaraz-Work-open-source-artifact-review/6c87a310-b3b7-4418-98b7-9aefe91ea77d/scratchpad/after.png`

Automated suites, run after every change including the simplify pass:

- `bash tests/run.sh` - 5 of 5 Python runtime suites PASS, no FAIL lines.
- `npx playwright test --project=review -g "diagram|reload|whiteboard|panel"` - 34 of 34 passed.

`tests/steps/artifact.steps.js:46` still matches
`getByRole('button', { name:/Focus diagram editor:/ })` and still passes, because that phrase moved
to the accessible name rather than disappearing.

## Visual proof

Recorded in a real, visible browser window at 1920x1080. The harness validated the delivered video
frames, not just the DOM: `VALIDATION PASS duration=147s canvas=3840x2160 chapters=2 markers=3`.

- Recording: `/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-26-diagram-row-accessibility-label/.playwright-cli/videos/verify-ui-diagram-list-names.mp4`
- Screenshot: `/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-26-diagram-row-accessibility-label/.playwright-cli/videos/verify-ui-diagram-list-names.png`
- Frames: `frame-diagram-list-names-marker1-Diagrams.png`, `-marker2-Process-topology.png`,
  `-marker3-Diagram-8.png`, `-chapter1.png`, `-chapter2.png`, in that same directory.

What the video shows, confirmed by opening each frame:

1. The rail carries a `Diagrams` heading of its own, below `Draft feedback` and clearly separate
   from it.
2. Eight rows, each reading a plain diagram name. No row repeats `Focus diagram editor:`.
3. The last row reads `Diagram 8`, not `arev-mermaid-7`.
4. Clicking the `Process topology` row opens that diagram's inline editor in the artifact, so the
   shorter label did not cost the row its behavior.

The accessibility tree recorded during the run confirms the split that the issue asked for:

```
- heading "Diagrams" [level=2]
- button "Focus diagram editor: Process topology"
  - generic: Process topology
```

The button's accessible name still carries the instruction. Its visible text is the name alone.

Note on the recording: the screen is shared by eleven parallel agents, so the run took the
`/tmp/arev-video.lock` mutex first, held it only for the recording, and released it in the same turn.
Two earlier background attempts to wait for that lock were killed by the harness before they won the
race, so the wait was moved into bounded foreground retries.
