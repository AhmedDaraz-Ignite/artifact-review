# Diagram card single surface - implementation notes

Date: 2026-08-11
Branch: `fix-diagram-card-single-surface`, cut from `origin/main` at `6d5dcac`.

## Reported defect

A diagram card in the review UI painted two stacked surfaces. A band across the top of the card
held the "Edit diagram" icon button at its right. A separate inset panel with its own rounded
corners sat below it and held the picture. The reviewer circled the band and said the button was
"inside the top header, I did not ask for that".

## Intended result

One surface. The edit icon button sits at the top right inside the diagram's own box, above the
picture, on the same background and within the same border. The agreed design already said so:
the row "sits inside the diagram's existing border instead of adding another one", and the picture
is on the next line and never covered.

## Root cause

`mountInline` in `skills/artifact-review/assets/review-ui/sdk.js` inserted the
`<section class="arev-inline-board">` as the diagram block's **preceding sibling**:

```js
if (!host.parentNode || host.nextElementSibling !== block)
  block.parentNode.insertBefore(host, block);
```

The host paints nothing itself, so the row took its colour from whatever the block's parent paints.
The block keeps its own background and border, so the result read as a header band above a nested
panel. Nothing about it was specific to one artifact: any artifact whose diagram block carries a
background or a border showed it, wrapper or no wrapper.

Measured in the browser on `docs/arev-main-technical-design/technical-design.html`, diagram
`d-session-states`, before the change:

| Box | Top | Height | Background |
| --- | --- | --- | --- |
| `div.scroll` | 451 | 538 | `rgb(255, 255, 255)` |
| `section.arev-inline-board` | 452 | 44 | transparent |
| `pre.mermaid` | 496 | 472 | `rgb(242, 243, 245)` |

44px of white above a grey panel that starts 45px into the card. That is the band.

## Fix

The row now lives inside the diagram block, so it shares that block's background and border. Three
paths keep it there:

- `placeBoardHost` puts the host back as the block's first child. `mountInline` calls it instead of
  inserting a sibling.
- `liftBoardHost` moves it out again on activation, because the editor stands in for the block and
  the block is hidden while the editor is open. `deactivateInlineBoard` and the frame error handler
  place it back.
- A listener on `arev:mermaid-rendered` places every resting row again. A theme flip makes the
  offline renderer rewrite the block with `holder.innerHTML = svg`, which throws away everything
  inside it.

Resting padding changed from `9px 10px 3px` to `0 0 8px`. The block already has its own padding, so
the row only needs the gap between itself and the picture.

## The renderer bug this uncovered

With the row inside the block, `holder.querySelector("svg")` finds the pencil icon. Two places
treated any SVG in the block as proof that a diagram had been drawn:

- `collectPending` in `tooling/mermaid-entry.mjs`, and
- `renderMermaidLocally` plus `unrenderedMermaidFindings` in `sdk.js`.

`collectPending` broke rendering outright. `boot()` sends `sdk-ready` before the dynamic Mermaid
import resolves, so the mount message arrives first, the icon is already in the block when
`collectPending` runs, and the block is filtered out and never drawn. Caught in the browser, where
the diagram came up as bare source text.

Both files now ask for an SVG that is not review chrome. `mermaidSvgFor` in `sdk.js` already
rejected `[data-arev-internal]` for exactly this reason, so the rule was there, just not applied on
these paths.

`tooling/mermaid-entry.mjs` is a build input, so `npm run build` regenerated
`skills/artifact-review/assets/review-ui/mermaid.js`.

## Tests

`tests/support/diagram.js` gained `restingPlacement`, which reports whether the control sits inside
the diagram block, the host's own background and border, and the boxes of the control, the block and
the picture. Every selector stays in the page object.

Selectors there now say `:scope > svg` rather than `svg`, so a test asks for the drawn diagram and
never the control's icon. Mermaid writes its SVG as the block's own child.

Three raw selectors sat in step files and broke on strict mode once the icon shared the block:
`#<id> svg` and `pre.mermaid svg` in `tests/steps/diagram.steps.js` and
`tests/steps/whiteboard.steps.js`. They moved to the page object as `rendered(id).svg` and
`boards.drawnDiagrams`, which is where the contributing guide already said they belonged.

The existing step "activation control sits above its diagram" compared the control against the
block's top. That is the assertion that made the band look correct, so it now compares against the
picture, which is what "never covered" was always about.

New scenario in `tests/features/whiteboard.feature`:

```gherkin
  Scenario: The diagram card shows one surface, not a band above a panel
    Then the "clean-flow" diagram offers an activation control
    And the "clean-flow" activation control sits inside the diagram surface
    And the "clean-flow" diagram card carries no second surface
```

It fails on the base commit: the host is the block's sibling there, so `insideDiagramBlock` is
false and the control's top sits above the block's top.

### Counts

| Run | Base commit `6d5dcac` | With the change |
| --- | --- | --- |
| `npm test` | SELFTEST: PASS | SELFTEST: PASS |
| `npm run test:e2e` | 88 passed | 89 passed |

## Browser verification

Real visible Chromium at 1440x1000, against a session opened with
`ARTIFACT_REVIEW_HOME` pointed at the session scratchpad so the user's own review data was never
touched.

| Check | Result |
| --- | --- |
| Host's parent | `PRE.mermaid`, the diagram block |
| Control inside the block | Yes, in light, after a flip to dark, and back to light |
| Control box | 32 by 32, 6px corners, unchanged |
| Clear of the picture | 8px, in every theme state |
| Editor still opens in place | Yes, host lifted to `DIV.scroll`, block hidden, canvas drawn |
| Page and console errors | None |

Screenshots:

```
/private/tmp/claude-501/-Users-ahmeddaraz-Work-open-source-artifact-review/fb4677a4-6a92-4d91-97a9-4ccadc6d9af8/scratchpad/before.png
/private/tmp/claude-501/-Users-ahmeddaraz-Work-open-source-artifact-review/fb4677a4-6a92-4d91-97a9-4ccadc6d9af8/scratchpad/after.png
/private/tmp/claude-501/-Users-ahmeddaraz-Work-open-source-artifact-review/fb4677a4-6a92-4d91-97a9-4ccadc6d9af8/scratchpad/after-dark.png
/private/tmp/claude-501/-Users-ahmeddaraz-Work-open-source-artifact-review/fb4677a4-6a92-4d91-97a9-4ccadc6d9af8/scratchpad/after-editor.png
```

## Left alone

`technical-design.html` gives its `pre` a 20px bottom margin inside a `.scroll` that has none, so a
thin strip of the wrapper's background shows below the picture. That is the artifact's own CSS, it
was there before this change, and it is not part of the reported defect.
