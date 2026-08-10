# Issue 22 - Clicking a second element discards the annotation note already typed

## Report

In annotation mode, typing a note against one element and then clicking a different
element wiped the typed text. No warning, no way back.

## Root cause

`skills/artifact-review/assets/review-ui/chrome.html`, `openAnnotation()`.

The function ran `$("popText").value = ""` on every pick. The shell calls
`openAnnotation` for each `pick-element` and `pick-text` message from the artifact
iframe, whether or not the popover is already open with a live draft. The draft
lives only in `#popText.value`. It is not part of `popItem`, and it only enters the
item at submit time as `{ ...popItem, comment }`. So the wipe destroyed the only
copy.

`closeAnnotation()` did not clear the field. The old code therefore emptied the
field at the wrong moment: on open instead of on close.

## Fix

Move the clear from open to close.

- `openAnnotation` keeps whatever is in `#popText` and points `popItem` and the
  context line at the new target. When it carries a non-empty draft over, it
  announces "Your note moved to the element you just picked." so the retarget is
  not silent for a screen reader user.
- `closeAnnotation` empties `#popText`. That covers Cancel, Escape, and a
  successful send or queue, so a delivered note never reappears in the next
  popover.

The failed-submit path already keeps the popover open, so the preserved text
survives a retry unchanged.

A second defect came out of code review and is fixed here too. `submitAnnotation`
delivers asynchronously. A pick that landed while the request was in flight used
to repoint `popItem`, so the retry after a failure would attach the old comment to
the element picked afterwards, and the success path would then wipe the carried
note. `submitAnnotation` now sets a `popSending` flag and `openAnnotation` drops a
pick while that flag is set, telling the reviewer why through the live region.

## Alternatives rejected

- **`confirm()` before discarding.** The issue allows it. Rejected: a browser modal
  blocks the whole page, breaks automation, and asks the reviewer a question whose
  good answer is always "keep my text".
- **Guard inside the `pick-element` handler only.** Rejected: `pick-text` reaches
  the same wipe. One change in `openAnnotation` covers both message types, and
  those two call sites are the only callers in the repo.
- **Refusing the new pick while a draft exists.** Rejected: it blocks retargeting,
  which is a normal thing to want.
- **Reading `$("popText").disabled` as the in-flight signal.** This was the first
  version of the guard. Rejected after review: the attribute is set for a UI
  reason, so a later change to which controls get disabled would silently break
  the guard with no test pointing at the cause. An explicit `popSending` flag
  costs the same one line at the call site.

## Review findings

`/code-review medium`, then `/simplify` with four cleanup agents.

Accepted:

- The in-flight submit race described above. The fix for issue 22 made it worse,
  because `closeAnnotation` now clears the field.
- Use an explicit flag rather than the `disabled` attribute. Raised by the code
  reviewer and again by the altitude agent.
- Do not swallow the dropped pick in silence. `openAnnotation` announces
  "The previous note is still being delivered. Pick again once it lands."
- Hoist the repeated `$("pop")` and `$("popText")` lookups in `openAnnotation`.

Rejected:

- `assets/artifact-template.html:63`, the `:has()` breakout selector matching
  descendants at any depth. Real, but it belongs to the rail-width change, not to
  issue 22. Ten agents are working in parallel and an edit there would collide.
- `tests/support/review-ui.js:99`, `artifactWidth` dereferencing a null bounding
  box. Same reason: that helper came with the rail-width change and issue 22 does
  not call it.
- Folding the mid-delivery scenario into the existing in-flight scenario in
  `delivery.feature`. It would move annotation-retarget behavior into the delivery
  feature file for a saving of about two seconds.
- Reuse and simplification agents reported nothing to change.

## Callers checked

- `openAnnotation` - defined `chrome.html:1231`, called only from the
  `pick-element` and `pick-text` branches of the shell `message` handler.
- `closeAnnotation` - `#popCancel` click, Escape inside `#popText`, and the
  success branch of `submitAnnotation`.
- `submitAnnotation` - `#popSend` and `#popQueue`, plus Cmd/Ctrl+Enter through
  `$("popAction").click()`.

No other code reads or writes `#popText.value`.

## Verification

Two scenarios added to `tests/features/annotation.feature`:

1. `Switching the annotation target keeps the note already typed` - reproduces the
   bug.
2. `A delivered annotation leaves the next one empty` - guards the other side, so
   moving the clear to close does not leak a sent note into the next popover.

The reproduction had to assert the context line first
(`Then the annotation targets "<h1> Clean artifact fixture"`). The pick travels
`iframe -> postMessage -> shell`, so an assertion made right after the click reads
the DOM before the wipe and passes for the wrong reason. Anchoring on the observed
retarget makes the value assertion honest. Confirmed: the scenario failed on the
old code at the value assertion and passes on the new code.

Results:

- Before the fix: `Switching the annotation target keeps the note already typed`
  FAILED at `toHaveValue`.
- After the fix: `npx playwright test` - 70 passed.
- After the fix: `npm test` (Python runtime suite) - SELFTEST: PASS.

## Browser proof

Recorded against a fixture that matches the report: a Mermaid flowchart with the
`Session server` and `SQLite review store` nodes. Annotation mode on, click
`SQLite review store`, type an 80 character note, click `Session server`.

Result on screen: the context line reads `Session server` and the note is
unchanged in the field.

- Recording: `/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-22-clicking-element-discards-annotation/.playwright-cli/videos/verify-ui-annotation-note-survives-retarget.mp4`
- Note typed against the first node: `docs/issue-22/annotation-note-typed.png`
- Note kept after switching target: `docs/issue-22/annotation-note-kept-after-switch.png`

The harness validated the delivered frames: `VALIDATION PASS duration=137s
canvas=1920x2160 viewport=1920x2160 chapters=2 markers=2`. The `.playwright-cli`
directory is ignored by git, so the two frames above are copied into this folder
to keep the proof with the change.

## Autonomous-run choices

The user went away mid-run and asked for no further questions.

- The first `/code-review` ran against the primary checkout because the session
  working directory was still the main repo. Switched the session into the
  worktree with `EnterWorktree` and ran the review again against the real diff.
