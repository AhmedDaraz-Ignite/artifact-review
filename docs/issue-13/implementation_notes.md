# Issue 13 - Sequence diagram message labels overlap and lose their order

Branch: `bug-13-sequence-diagram-message-overlap`

## Symptom

Opening the diagram editor on a Mermaid sequence diagram draws every message label in the
strip between the participant header boxes. The labels overlap each other and the participant
names, and their vertical order no longer matches the source.

Reported `y` values, in source order: 93.0, 27.3, 189.0, 237.0, 59.0.

## Reproduction

A scratch harness (not committed) drove the real app end to end:

1. `arev open` on an artifact holding the issue's diagram.
2. Open the diagram editor, wait for the autosaved scene.
3. Drag the "Reviewer" participant box a little.
4. Read the saved scene from `<ARTIFACT_REVIEW_HOME>/sessions/*/whiteboards/*.working.json`.

The permanent version of this is the new e2e scenario described under Verification, which runs the
same four steps against the fixture in `tests/fixtures/diagram-features.html`.

Before the drag the scene is correct. After the drag:

| Arrow | Before | After |
| --- | --- | --- |
| 1 `queue five items` | y 103 | y 103 |
| 2 `send now` | y 151 | **y 38** |
| 3 `one feedback event` | y 199 | y 199 |
| 4 `one reply, whole batch` | y 247 | y 247 |
| 5 `batch marked answered` | y 295 | **y 37** |

Messages 2 and 5 jump into the participant header strip (y 0 to 65). That is the same
fingerprint as the report: messages 1, 3 and 4 keep the source grid, messages 2 and 5 land on
the participant labels.

Note: the pure conversion is correct, and so is the first open. The corruption only appears
once Excalidraw re-derives a bound arrow endpoint. Headless first-open runs therefore look
clean, which is why the earlier attempts to reproduce from the literal steps alone failed.

## Root cause

`node_modules/@excalidraw/mermaid-to-excalidraw/dist/parser/sequence.js`, `computeArrows`:

```js
// Attach to actors if available
const from = actorMap[message.from];
const to = actorMap[message.to];
if (from?.topId && to?.topId) {
    arrow.start = { type: from.bindType || "rectangle", id: from.topId };
    arrow.end = { type: to.bindType || "rectangle", id: to.topId };
}
```

Every message arrow is bound to the participants' **top header boxes**. That binding is
geometrically impossible: the arrow runs between two lifelines at y 103 to 295, while the box it
claims to bind to spans y 0 to 65. It never touches it.

An Excalidraw bound arrow does not store its endpoints as facts. It stores a focus and a gap
against the bound shape and re-derives the endpoints whenever that shape moves, resizes, or
re-lays out its label. The first re-derivation pulls the arrow onto the header box, and the
bound message label follows it onto the participant names.

There is nothing correct to bind to instead. Excalidraw only binds arrows to rectangle, ellipse,
diamond, text, image and frame elements. A lifeline is a `line`. So the fix is to stop binding.

## Fix

`tooling/build-whiteboard.mjs` gains a `mermaidSequenceArrowBinding` esbuild `onLoad` plugin that
removes that block at bundle time, matching how the repo already patches `parser/er.js`,
`flowchart.js`, `state.js` and `class.js`. The plugin asserts the target matched exactly once, so
an upstream rewrite fails the build instead of silently restoring the bug.

Rejected alternatives:

- Bind to the lifelines instead. Excalidraw cannot bind an arrow to a `line`.
- Correct the focus and gap so the re-derivation lands back on the original y. The stored value
  would still be a lie, and any resize would drift again.
- Edit `node_modules` directly. The repo never does; the build-time patch is the established
  pattern and survives `npm install`.

Losing the binding means dragging a participant no longer drags its messages along. That was
already broken: the lifelines are plain `line` elements and were never bound either, so a
participant drag already left the lifeline behind. Correct initial layout beats a half-working
drag.

## Verification

New scenario in `tests/features/diagram-editing.feature`: "Sequence message labels keep their own
arrow and their source order". It opens the editor, asserts source order, asserts no message arrow
carries a binding, then **moves the first participant box** and asserts source order again.

The drag matters. The first version of this scenario passed with the bug present, because the
scene only corrupts once Excalidraw re-derives a bound endpoint, and merely opening the editor
never does. The `/simplify` altitude pass caught that.

Two details the assertion has to get right:

- Order is read from each label's **arrow**, not from the label's own `y`. A message label is
  bound to its arrow, and after a drag the saved scene still holds the label's stale cached `y`
  while the arrow has already moved. Reading the arrow is reading what a reviewer sees.
- The drag step waits for the moved box to actually change position before reading the scene. A
  drag that missed would otherwise let every later assertion pass for free.

Results:

- Pre-fix, with the binding assertion removed so it cannot mask anything, the order assertion
  **fails** on its own: the labels come back as `batch marked answered, send now, queue five
  items, one feedback event, one reply, whole batch`.
- Post-fix the scenario passes.
- `npm test` (Python runtime): SELFTEST PASS.
- `npm run test:e2e`: 69 passed.
- Real browser proof: see below.

## Review feedback

`/code-review` confirmed the fix is sound and raised three findings. Two were CSS specificity
issues in `skills/artifact-review/assets/artifact-template.html`, which is already on `main` from
another PR, so they are outside issue 13 and were left alone. The third, an untracked scratch
directory, was fixed by moving the repro out of the repo.

`/simplify` ran four cleanup agents. Applied: the post-drag assertion above, the arrow-based order
read, the self-checking drag, a boolean instead of a counter in the new plugin, and two smaller
test-step tightenings.

Rejected, with reasons:

- Extracting a shared patch factory across all three esbuild plugins, raised by three of the four
  agents and worth about 95 lines. It means rewriting two plugins issue 13 does not touch, in a
  file that ten parallel agents may be editing. Worth doing later on a quiet branch.
- Folding the new patch into `mermaid11IdPrefixCompatibility`. Removing an arrow binding is not
  id-prefix compatibility, and that plugin's name is what the build error text reports.
- Deriving the expected message list from the fixture. It costs more code than it saves, and the
  file's existing `NODES` and `DIALECTS` use the same literal shape.

The altitude pass also confirmed the fix does not need generalizing: `sequence.js` is the only
parser in the library that binds an arrow to an element the arrow never touches. `er.js`,
`class.js` and `state.js` all bind to the real endpoints, and `flowchart.js` binds nothing.

## Proof of the fix

Recorded in a real, visible Chrome window at 1920x1080, driven through the review UI.

- Recording: `/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-13-sequence-diagram-message-overlap/.playwright-cli/videos/verify-ui-sequence-message-labels.mp4`
  (77s, validated: 2 chapter cards and 1 marker present in the delivered frames)
- Screenshot after the drag: `docs/issue-13/after-fix.png`
- Frame before the drag: `docs/issue-13/editor-before-drag.png`

The clip opens the diagram editor, which reports "Sequence diagram · Editable shapes", then drags
the Reviewer participant box. The saved scene before and after the drag:

| | Reviewer box | Arrow y values, in source order |
| --- | --- | --- |
| Before the drag | x=0 y=0 | 103, 151, 199, 247, 295, all unbound |
| After the drag | x=89 y=30 | 103, 151, 199, 247, 295, all unbound |

Pre-fix the same drag moved `send now` to y 38 and `batch marked answered` to y 37, both inside
the participant header strip.

The 6 MB recording is not committed. This is a public repository and the screenshots carry the
same evidence at 1 MB, so the video stays out of the history and is referenced by path.

Marker placement: the harness anchors its markers to text in the top document, and the Excalidraw
canvas lives two iframes down with no DOM text at all. The marker therefore sits on the review
panel's "Focus diagram editor: diagram-today" control, which is the nearest top-level element that
belongs to this diagram. The canvas itself is proved by the screenshots and by the scene table
above.

## Autonomous-run decisions

- The user went away mid-run and asked for no further questions. Committing, pushing and opening
  the PR happened without approval, as instructed.
- The screen is shared with other agents, so every windowed browser run took `/tmp/arev-video.lock`
  first and released it in the same turn.
