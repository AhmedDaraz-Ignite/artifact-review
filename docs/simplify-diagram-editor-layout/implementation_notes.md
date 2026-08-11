# Simplify the diagram editor layout - implementation notes

## Goal

Reduce the embedded Excalidraw chrome to what a reviewer marking up an
agent-authored diagram actually needs, and give the controls that stay a home
that matches what each one does.

## The approved design

Reached over four rounds of mockups. The accepted arrangement:

- Tool strip stays floating at the top of the canvas.
- Excalidraw's scene menu, shape library and help button are gone.
- Undo and redo lead the dock, ahead of zoom.
- A right-hand rail carries lock and pan, and nothing else.
- Fit sits at the dock's opposite end as an icon.

Three earlier rounds were rejected and are worth recording, because each
rejection changed the design:

1. **Round 1 cut the tool set to six.** Rejected. It answered a question about
   structure by deleting features.
2. **Round 2 sorted the controls into zones but kept the reference
   arrangement.** Rejected as a copy of the tool it was compared against.
3. **Round 3 docked every control to the frame so nothing floated.** Rejected;
   the floating arrangement was wanted, simplified rather than replaced.

The mockup that was approved lives in
`docs/artifact-review-ux-hardening/editor-layout-proposal.html` in the main
checkout. It is a design document, not part of this change.

## What was built

| Change | How |
|---|---|
| Menu, library and help hidden | CSS, in `tooling/whiteboard-frame.css` |
| Lock and pan out of the tool strip | CSS hides Excalidraw's; the frame renders its own rail |
| Rail wired to the editor | `excalidrawAPI.setActiveTool`, read back in `onChange` |
| Fit control | New button calling the existing `fitScene()` |
| Undo and redo ahead of zoom | Flex `order` on the dock |
| Scene actions removed | `UIOptions.canvasActions`, a supported API |

## Decisions

- **Selectors prefer `data-testid` over class names.** Excalidraw publishes
  `main-menu-trigger`, `button-undo`, `toolbar-lock` and `toolbar-hand` as test
  ids. They survive its UI refactors better than class names, which turns the
  riskiest part of this change from guesswork into something a test can hold.
- **The rail reads Excalidraw's state rather than keeping its own.** Excalidraw
  owns the active tool. A second copy would drift the moment a keyboard
  shortcut changed the tool, so `syncModeRail` reads `appState` back.
- **Controls hidden through the supported API where one exists.** Scene load,
  save, export, clear and background all have `canvasActions` flags. Only the
  controls with no flag are hidden with CSS.
- **`tools.image` was left alone.** Removing the image tool was in an earlier
  rejected round and is not part of the approved design.
- **React moved into its own container.** `mountEditor` calls
  `host.replaceChildren()`, which deleted the rail and the fit button on every
  mount. React now owns `#wbCanvas`; the frame's own controls are siblings.

## Corrections made during the run

- **The rail and fit button did not appear at all** on first run, for the
  `replaceChildren` reason above. Found by looking at the running editor, not by
  reading the code.
- **The first selector set targeted the wrong layout.** Excalidraw renders a
  compact layout at inline editor sizes, where the menu sits in the dock rather
  than at the top left. The rules now match each control directly instead of the
  region that holds it at one size.
- **The conversion-failure path replaced the wrong node.** It emptied
  `#wbEditor`, which would have destroyed the canvas container permanently. It
  now replaces `#wbCanvas` and marks the editor so the rail and fit hide.
- **A `width:auto` rule on the footer did nothing** and was removed rather than
  shipped as dead CSS. The dock is drawn by another element, so it still spans
  the canvas; fit takes its free right end instead of a corner of its own.
- **The new test caught two undeclared selectors** that had been added to the
  stylesheet without joining its lists, which is the failure it exists to catch.

## Review feedback applied

An accessibility and design-system review found nine issues. All were fixed.

**The one real defect.** `.wb-fit` and `.wb-mode` had equal specificity and
`.wb-mode` came later, so the fit button lost its border, padding, background
and radius to the cascade. It rendered as a bare glyph on the canvas casting a
shadow over nothing, and its contrast then depended on whatever the reviewer had
drawn underneath. The button now sits in its own `.wb-fit-wrap`, which carries
the surface. This was visible in the screenshots taken before the review and had
been read as intentional.

The rest:

- **Touch targets were 30px** against the 44px the product promises. Added a
  `pointer:coarse` query, mirroring the pattern already in the review chrome.
- **The pressed state was carried by colour alone** at 1.17:1 against the rail.
  The fill now inverts to the accent, which reads in greyscale and clears 3:1.
- **The controls were operable before the editor existed.** They start disabled
  and `syncModeRail` enables them, so a reviewer never presses one that does
  nothing.
- **Fit announced nothing.** It repaints the canvas and changes no visible
  state, so a screen reader user could not tell whether it worked. It now writes
  to a dedicated polite live region, kept separate from the save status so the
  two do not overwrite each other.
- **`title` duplicated `aria-label`**, risking a double announcement. `title`
  now carries the keyboard shortcut instead, which also restores the discovery
  path the hidden Excalidraw controls provided.
- **The shadow broke the Flat Desk Rule** and was a third shadow value matching
  nothing in the vocabulary. Removed; the hairline border does the separating.
- **Off-scale values**: radius 9px and 6px, gap 2px, offset 26px, size 30px.
  All moved onto the documented radius and spacing scales. The gap change also
  keeps a focus ring clear of the neighbouring button.
- **`#e8edfb` was a second literal copy** of a palette entry with no token.
  Promoted to `--wb-accent-soft`.

A second review, for correctness, ran the built bundle in a real browser and
measured the result. It found three things that defeated the change's own goals.

**The shape library was never hidden.** The rule targeted `.sidebar-trigger`,
which is a `div` inside a `label`. The `label` also holds a transparent
checkbox, and that checkbox stayed live: invisible, third in the editor's tab
order, and still able to open a panel that links out to
`libraries.excalidraw.com` from a frame whose CSP forbids any network. Hiding
`.sidebar-trigger__label-element` takes the input with it. A scenario now
asserts no control can open the library, so this cannot come back unseen.

**The undo and redo reorder did nothing.** `.layer-ui__wrapper__footer-left`
computes to `display:block`, so both `align-items` and the child's `order` were
inert and zoom stayed first. The flex container is a `section` two levels down.
Fixed and confirmed by eye in the wide layout, where zoom is actually rendered;
the compact layout does not show zoom at all, which is why the first check
missed it.

**The test could not fail.** `test_class_hooks_still_exist` read the built
`whiteboard.css`, but this project's own stylesheet is bundled into that file,
so every class name found itself and the assertion passed no matter what
Excalidraw renamed. It now reads Excalidraw's own `index.css`. Verified by
checking that file contains none of this project's class names.

Also fixed from the same review:

- **Pan did not return to the previous tool.** Excalidraw's own `H` goes
  rectangle to hand and back to rectangle. The rail always returned to
  selection, so a reviewer who panned mid-drawing lost their tool. It now reads
  `lastActiveTool`.
- **`:has()` had no fallback.** Where it is unsupported the whole rule is
  dropped, so Excalidraw's lock and pan would stay in the tool strip while the
  rail showed them again. The rail is now only added when `CSS.supports`
  confirms `:has()`, and the divider rule was split out so it no longer fails
  with them.
- Comments that described one layout as if it were both were corrected.

Two findings were noted and not acted on:

- **`role="group"` gives two tab stops where `role="toolbar"` with a roving
  tabindex would give one.** The reviewer confirmed the group is valid and
  named. For two buttons, arrow-key navigation is not worth the extra state.
- **The canvas now carries four control clusters.** That is the arrangement
  that was approved after four rounds; it is a design decision, not a defect.
  Recorded here so it is a choice on the record rather than an oversight.

## Cleanup pass

Four more reviews ran over the change for reuse, simplification, efficiency and
altitude. Between them they found one more defect and a lot of weight.

**The rail blocked the canvas mid-drag.** Excalidraw turns its own floating
chrome click-through while the pointer is down, through a `--ui-pointerEvents`
variable set on its container. The rail sits outside that container and cannot
inherit it, so a drag toward the right edge could end on a rail button instead
of the canvas. Fixed with Excalidraw's own `onPointerDown` and `onPointerUp`
props, which mirror that behaviour for the frame's controls, plus a
document-level `pointerup`/`pointercancel` listener so a missed event cannot
leave the rail permanently inert. Verified by drawing a rectangle whose drag
ends on top of the rail: the rectangle is created and the lock does not toggle.

Removed weight:

- **The `:has()` feature detect moved from JS to `@supports`.** It was a CSS
  fact stated in JavaScript 300 lines from the rule it guarded, and it forced a
  second code path through `syncModeRail` for a rail that might not exist.
- **`syncModeRail` lost both early returns and its enable path.** It now writes
  `aria-pressed` only when the value actually changed, which matters because
  `onChange` fires every frame during a drag and the attribute is style
  invalidating. Enabling the controls moved to the one place that knows the
  editor arrived.
- **The icons' stroke and fill moved to CSS**, where the sizing already lived.
- **`aria-pressed` is no longer set and then removed** for the one button that
  is not a toggle, and `role` and `aria-label` go through `element()` like every
  other attribute in the file.
- **Two `canvasActions` flags were decoration.** `changeViewBackgroundColor` and
  `clearCanvas` only remove menu entries, and the menu is hidden. Kept `export`
  and `saveAsImage`, which gate dialogs that keyboard shortcuts still open.
- **The test lost its registry.** The two hook lists are now read out of the
  stylesheet, so a rule added tomorrow is covered the moment it is written, and
  the meta-test that existed only to police the lists is gone. It also stopped
  decoding 9MB of minified bundle to text for a byte search.
- **The two new scenarios merged into one** and stopped waiting on a save
  neither of them read, which removed an editor mount and roughly two seconds.

Judgement calls where the reviews disagreed:

- **The fit button keeps its wrapper.** Two reviews called it redundant; a third
  showed why it is not, since putting the border on the button itself would make
  hover and focus paint the full 40px box instead of the inset chip. It now
  reuses the rail's class with a modifier rather than owning a second one.
- **Both library assertions stay.** One review called them duplicates; another
  showed they are not, because the class-based one passes vacuously if the class
  is renamed while the role-based one still fails honestly. They guard different
  failures, so both earn their place.
- **`.wb-mode` keeps its 8px radius** rather than matching `.wb-button`'s 7px.
  8px is the documented control radius; the neighbouring 7px is drift, and
  copying it for local consistency is how a scale dies.

Not taken, and why:

- **Moving the controls into Excalidraw's `renderTopRightUI` and `Footer`
  slots** would be the deeper fix for the pointer-events problem, and would also
  delete the tuned offsets. It relocates the controls to where those slots put
  them, which is not the arrangement that was approved. The `onPointerDown`
  route gets the same behaviour without moving them.
- **An empty `<MainMenu/>`** would structurally remove the outbound links in
  Excalidraw's fallback menu. Nothing can open that menu once the trigger is
  hidden, so this is defence in depth on an unreachable path. Worth doing, not
  here.

## Fidelity pass against the approved mockup

Two gaps only showed up when the built editor was compared side by side with the
mockup, after every review had passed.

**The canvas hint text was still painted over the diagram.** Excalidraw's
`.HintViewer` is absolutely positioned and lands on the first row of a
top-heavy Mermaid diagram. The mockup shows a clear canvas. Hidden.

**The dock spanned the whole editor.** Excalidraw's compact layout sets
`.App-bottom-bar > .Island { width:100%; min-width:100% }`, so undo and redo sat
at the left edge of a full-width bar with the fit control floating at its right
and nothing between them. The mockup has two small clusters on one edge. The
Island now hugs its own controls.

This one had been looked at once and dropped. An earlier guess at
`.layer-ui__wrapper__footer` changed nothing and was removed as dead CSS,
without finding which element actually drew the bar. The reorder was then
verified in the wide layout, where a different container is used and the dock
already hugs, so the check ran against the one layout that did not have the bug.
Excalidraw has two layouts and a change to either needs looking at in both.

**A rebuild alone does not reach the browser.** The session server reads its
assets into memory at startup, so a rebuilt bundle is invisible until the server
restarts. The frame URL carries a content hash, which is the quickest way to
tell: an unchanged hash after a rebuild means the old bundle is still being
served. One fix was recorded as still broken for exactly this reason.

## Test

`tests/runtime/test_whiteboard_chrome.py`, wired into `tests/run.sh`.

The reduced chrome depends on Excalidraw internals. An upgrade can rename any of
them, and the failure is silent: the editor keeps working while hidden panels
return and the rail's controls appear twice. The test asserts every hook the
stylesheet uses is still in the built bundle, and that any hook added to the
stylesheet is declared, so the lists cannot drift from the rules.

## Verification

- `bash tests/run.sh`: all six suites pass, including the new one.
- Built with `node tooling/build-whiteboard.mjs`; the build is reproducible
  (rebuilding an unchanged tree produces no diff).
- Checked in a real browser against a probe artifact: menu, library and help are
  gone, the rail shows lock and pan, fit sits opposite undo and redo on the same
  row, and the tool strip has lost lock and pan.

## Known limits

- The dock still spans the canvas. Making it hug its content needs a rule
  against whichever element draws it, which was not identified.
- `.wb-fit`'s bottom offset is tuned to line up with Excalidraw's dock row. It is
  a measured constant, not one Excalidraw exposes.
