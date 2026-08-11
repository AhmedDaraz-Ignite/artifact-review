# Issue 32 - a wheel over a diagram steals the page scroll

## The report

Scrolling an artifact with the pointer over a Mermaid diagram zooms that diagram
instead of scrolling the page. The page stops moving. Nothing on screen says the
wheel was taken, or that a double click puts the diagram back.

## Root cause

`skills/artifact-review/assets/review-ui/sdk.js`, in `createExploreViewport`.

The explore-mode wheel listener is registered with `{ passive: false }` and
called `event.preventDefault()` on every wheel notch that was not in annotate
mode. A non-passive listener that always cancels claims the page's scroll, so
the browser never scrolled and every notch resized the diagram instead.

The listener is the only wheel path for rendered diagrams. `enhanceMermaidSvgs`
is its one caller, so one guard in the listener fixes every diagram on the page.

## The fix

1. Zoom now needs a deliberate gesture. The listener returns early unless
   `event.ctrlKey || event.metaKey` is held, so a plain wheel reaches the page
   untouched. The same check picks up trackpad pinch for free, because browsers
   send a pinch as a wheel event with `ctrlKey` set.
2. The zoom step follows the wheel delta instead of only its sign. A mouse
   notch is `deltaY 120` and still moves 15%. A trackpad sends one gesture as
   15 to 40 events of `deltaY` 1 to 5, and a fixed 15% per event drove the
   diagram straight to the `initial.w * 8` ceiling, which is the speck in the
   issue's screenshot. Measured: 15 events of `deltaY 2` took the viewBox from
   351 wide to 2814 before this change, and to 364 after it.
3. Discoverability. Each rendered SVG gets a `<title>` child naming all three
   gestures, which browsers show as a tooltip on hover. Inline SVG ignores a
   `title` attribute, so the child element is the only way to get one. A diagram
   that already carries its own `<title>` keeps it, so no accessible name is
   overwritten. The hint is removed while annotate mode freezes the gestures,
   because a tooltip that promises pan and zoom would be wrong there.
4. The SVG gets an `aria-label` when the hint is added. A `<title>` child is
   what a screen reader reads as the element's name, so without this every
   diagram would announce itself as a mouse instruction. The label names the
   diagram and demotes the hint to the description, where it belongs.
5. `touch-action` on an unfrozen diagram went from `none` to `pan-y`. `none`
   was the same bug for the other input device: a finger landing on a diagram
   could not scroll the page. `pan-y` gives vertical scrolling back to the
   browser and keeps horizontal drags for panning a wide diagram. A
   browser-owned scroll fires `pointercancel`, which the existing `endPan`
   already handles.

## Alternatives rejected

- **A visible reset button on every zoomed diagram.** More chrome inside the
  artifact for a state the reviewer can no longer enter by accident. The
  tooltip already names the double click. `showBoardSvg` injects visible chrome
  only into arev's own board host, and the comment above it asks for author
  diagrams to stay clean cards. Add the button if reviewers report they still
  cannot find their way back.
- **Zoom only after a click into the diagram.** The issue offers this as an
  alternative to a modifier. A modifier is one line and needs no focus state or
  focus ring of its own.
- **A shared "inner surface must not steal a page gesture" mechanism.** There
  is no second site. The wheel listener in `createExploreViewport` is the only
  wheel consumer in the review UI, so a shared gate would be one interface with
  one implementation.
- **Routing the hint through the review chrome.** The chrome's hint widgets
  live in `chrome.html`, a different document from the sandboxed artifact
  iframe. Pointing one at a diagram needs a new `postMessage` channel for what
  a `<title>` element does with no layout cost.

## Review findings taken and left

`/code-review` at high effort and `/simplify` (four angles) both ran against
this diff. Everything real was applied. Two were left:

- **Coalescing the `viewBox` write into one `requestAnimationFrame`.** Real and
  measured: a 40-event burst costs 45ms of layout on a 1000-node diagram and
  1.1ms with the frame coalescing, because each `viewBox` write makes the next
  `getBoundingClientRect` force a layout. Left out. It is pre-existing, this
  change makes it fire less often rather than more, and it moves when the
  attribute lands, which needs its own verification pass. It belongs in its own
  change, not in a scroll fix.
- **Dropping the `aria-labelledby` half of the label guard as unreachable.**
  `allMermaidSvgs` matches any `<svg>` inside a `.mermaid` holder, so a
  hand-authored SVG with an external label and no `<title>` child can reach the
  branch. The guard stays, rewritten as one `svg.matches()` call.

## Verification

- Reproduced first. With `sdk.js` stashed and only the new test present, the new
  scenario failed on `the "themed-flow" view has not changed`. A plain wheel had
  changed the viewBox.
- The trackpad scenario was reproduced the same way. With only the step
  normalization reverted, it failed with `Expected: < 527.7, Received: 2814.4`.
  That received value is the 8x ceiling, the speck in the issue's screenshot.
- `npx playwright test`: 70 passed, whole suite.
- `npm test` (Python runtime selftest): PASS, including guidance staleness after
  the `references/runtime.md` edit.

### Browser proof

Recorded against a purpose-built artifact with three Mermaid diagrams down a
3193px page, served by a real `arev` session and driven with real wheel,
keyboard, and mouse input. The harness validated the delivered frames:
`duration=153s canvas=1920x1080 viewport=1920x1080 chapters=3 markers=3`.

Recording:
`/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-32-scroll-diagram-zoom-interference/.playwright-cli/videos/verify-ui-issue-32-diagram-scroll.mp4`

Screenshot:
`/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-32-scroll-diagram-zoom-interference/.playwright-cli/videos/verify-ui-issue-32-diagram-scroll.png`

What the clip shows, with the numbers read out of the live page:

1. Twenty-two plain wheel notches with the pointer parked in the middle of the
   reading column. The page scrolled from 0 to 2113, past all three diagrams,
   and all three viewBoxes were byte-identical before and after.
2. Six Ctrl-held notches over the topology diagram. The viewBox went from
   `0 0 902.28 513.22` to `-592.38 -335.40 2087.03 1187.10`, and `scrollY`
   stayed at 1328 while it did.
3. One double click. The viewBox returned to exactly `0 0 902.28 513.22`.

The recording was taken at 1920x1080 rather than the issue's 1440x900. The
`verify-ui` harness fixes the canvas to the window it can prove parity with,
and the behavior does not depend on viewport width.

Note: `.playwright-cli/` is gitignored, so the video and screenshot stay local
and are referenced by absolute path here and in the pull request.

## Tests added

`tests/features/diagram-rendering.feature`:

- *A plain wheel over a diagram stays with the page*. Asserts the viewBox is
  unchanged, that the diagram did not cancel the wheel
  (`event.defaultPrevented === false`, which is what lets the browser scroll),
  that `touch-action` is `pan-y`, and that the tooltip names Ctrl and the
  double click.
- *A trackpad gesture zooms one step, not straight to the limit*. Fifteen
  `deltaY 2` events with Ctrl held must widen the view without reaching half
  again its size.
- The existing zoom scenario gained *the wheel was taken from the page*, so a
  future edit cannot drop the `preventDefault` and stay green.
- The annotate-freeze scenario gained *says nothing about gestures*, covering
  the hint removal.

`tests/support/diagram.js` grew `wheel({ ctrlKey, deltaY, times })` returning
whether the diagram cancelled the event, plus `pinch()`, `viewWidth()`,
`hint()`, and `touchAction()`. `zoom()` now sends the modifier, so the existing
zoom scenario still exercises the real zoom path.

## Autonomous-mode decisions

The user went to sleep mid-run and asked for no further questions. Choices made
without asking are the two rejected alternatives above, and committing and
pushing without the usual approval step.
