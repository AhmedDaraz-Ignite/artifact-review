# Issue 14: the diagram editor opens with a canvas too short to show the diagram

## Symptom

Opening the inline editor gave a canvas of about 836 x 226 px whatever the diagram measured. The
converted scene was clipped, the Excalidraw toolbar covered the top of what was left, and a shape
drawn near an edge landed outside the visible strip. Fullscreen gave the canvas room but kept the
50 % zoom it had picked for the small box, with the scene in the top left corner.

## Root cause

Two independent causes, both needed fixing.

**1. The host height came from an unrendered block, then got clamped twice.**

`boot()` in `skills/artifact-review/assets/review-ui/sdk.js` sends `sdk-ready` without awaiting the
`import("/mermaid.js")` it just started. The controller answers with `mount-inline`, so `mountInline`
ran while the Mermaid holder was still plain `<pre>` text a few lines tall. It froze that
measurement on the board:

```js
var measuredHeight = Math.round(block.getBoundingClientRect().height || 320);
var editorHeight = Math.max(300, Math.min(420, measuredHeight + 64));
```

The 300 px floor is what produced the 226 px canvas. Even a correct measurement could not have
helped: `Math.min(420, ...)` and the CSS rule `.arev-inline-board.arev-inline-active{max-height:420px}`
both capped the host below the size of every diagram in the report.

**2. Excalidraw keeps its zoom when its container grows.**

The frame fitted the scene once, in a `setTimeout(..., 0)` inside the `excalidrawAPI` callback.
Every later size change kept the zoom computed for the older, smaller box. Fullscreen was the
visible case.

## Fix

`sdk.js` - measure at activation, cap in CSS:

```js
    var editorHeight = Math.max(
      300,
      Math.round(board.block.getBoundingClientRect().height) + 216,
    );
```

```
.arev-inline-board.arev-inline-active{max-height:calc(100vh - 24px);margin:0;background:#fff}
.arev-inline-board>iframe{position:absolute;inset:0;display:block;width:100%;height:100%;border:0;background:#fff}
```

`tooling/whiteboard-entry.mjs` - refit when the canvas changes size:

```js
    if (message.type === "fullscreen-state") queueFit();
```

`queueFit` debounces `scrollToContent(..., {fitToContent:true})` by 100 ms. The `excalidrawAPI`
callback calls it for the mount, and `fullscreen-state` covers fullscreen in and out.

`clearToolbar` then slides the scene out from under Excalidraw's floating toolbar, taking the
distance from the slack below it:

```js
    const shift = Math.min(covered, slack);
    if (shift <= 0) return;
    state.api.updateScene({ appState:{ scrollY:appState.scrollY + shift / zoom } });
```

## Decisions

- **Measure at activation, not by closing the `sdk-ready` race.** Awaiting the Mermaid import in
  `boot()` would put a dynamic import on the critical path of the whole review UI, and
  `renderMermaidLocally` returns `null` when the artifact rendered its own Mermaid, so that path
  would need a new completion signal. A mount-time measurement also goes stale on its own as fonts
  settle and the artifact pane resizes. Measuring at the moment of use makes the ordering
  irrelevant.
- **Cap in CSS, not JS.** `max-height:calc(100vh - 24px)` re-evaluates on every resize for free,
  where a JS cap would need a `resize` listener to stop a shrinking window from leaving an 858 px
  editor the reviewer has to scroll past. The paired `position:absolute;inset:0` on the iframe makes
  it follow the clamped box instead of the requested `style.height`. `width:100%;height:100%` stay:
  an absolutely positioned replaced element with `auto` size falls back to its intrinsic 300x150.
- **`216` is a guess at the frame's chrome plus toolbar room.** Header plus feedback bar measure
  about 115 px, a banner adds about 30 px, and the remaining 70 px keeps the fitted scene clear of
  Excalidraw's toolbar. The parent cannot read any of it across the sandboxed iframe. Reporting the
  real number on the existing `ready` message was considered and rejected: `ready` fires before
  `initialize` decides whether to show a banner, so the reported number would be wrong in exactly
  the case the constant is generous for. An under-guess degrades softly, because the fit zooms the
  scene down rather than clipping it.
- **The toolbar needed both the extra height and `clearToolbar`.** Neither alone is enough. Extra
  height does nothing once `max-height` binds, which it does for any diagram taller than the
  artifact view. The nudge alone runs out of slack on a short diagram: measured on the 382 px
  sequence diagram it could only move 24 px of the 36 px needed, leaving 5 px of the first row
  under the toolbar.
- **`fullscreen-state`, not a `ResizeObserver`.** An observer on `#wbEditor` was the first version.
  It covered more triggers, but `scrollToContent` writes `appState.scrollX/scrollY/zoom`, which
  Excalidraw reports through `onChange`, which is wired to `scheduleSave`. Every window resize
  became a full scene save with no reviewer edit. The parent already posts `fullscreen-state` on
  every path that changes the canvas size after mount (the frame's own button, Escape, closing the
  board, switching boards), and nothing read it before.
- **Cap on the viewport, not a fraction of it.** A first attempt used `innerHeight * 0.9` and the
  new assertion failed only in the parallel run. `window.innerHeight` inside the artifact iframe is
  not the browser viewport and it varies with the review chrome, so 0.9 of it left the 730 px
  fixture diagram 19 px short.

## Verification

- `And the "review-er" editor canvas is at least as tall as the diagram` in
  `tests/features/diagram-editing.feature`, folded into the existing mount scenario rather than
  given its own server boot. `Board.unlock` measures the rendered SVG before the click, because
  `markBoardReady` hides the block afterwards.
- Proven to catch the regression: dropping the 160 px allowance gives `canvas 634 < diagram 729.75`
  and the step fails.
- `npx playwright test --project=review`: 65 passed, exit 0.
- `npm test` (Python runtime suite): SELFTEST PASS.
- `npm run build` regenerates `whiteboard.js`, and a rebuild leaves the committed bundle byte
  identical. CI checks the same thing.

### Browser check

Recorded against a three-diagram artifact at a 1440x950 viewport. Measured from the painted canvas
pixels, not from the code:

| Diagram | Read mode | Host | Canvas | Canvas covers diagram | Content clears toolbar | Content inside canvas |
| --- | --- | --- | --- | --- | --- | --- |
| `request-seq` | 382 px | 598 | 896x502 | yes | yes (ink 66, toolbar 60) | yes |
| `review-flow` | 702 px | 873 (capped) | 896x777 | yes | yes (ink 65) | yes |
| `store-er` | 662 px | 873 (capped) | 896x777 | yes | yes (ink 67) | yes |

Fullscreen on `request-seq`: canvas 502 -> 777 px tall and the scene re-centred to ink top 197,
exactly `(777 - 384) / 2`, at 100 % zoom. The old behaviour was 50 % zoom in the top left corner.
`fitToContent` will not magnify past 1:1, which is why the scene keeps its size rather than filling
the taller box.

Recording: `.playwright-cli/videos/issue-14-canvas-height.mp4` (43 s: all three editors opening,
plus fullscreen in and out).

Note on the recording: `verify-ui`'s marker overlay only runs in the top document, and this app
renders the artifact in a sandboxed cross-origin iframe with the editor in a second frame inside it.
The annotated-clip path therefore cannot mark the changed surface, so the proof here is the
recording plus the measured pixel table above.
