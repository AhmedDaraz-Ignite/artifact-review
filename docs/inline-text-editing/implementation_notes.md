# Inline text editing - implementation notes

Date: 2026-08-14
Branch: `inline-text-editing`
Deliverables: the approved mockup at `docs/inline-text-editing/mockup.html`, the feature itself, and
an enhancement issue.

## Request

A reviewer should be able to change the artifact's text in place instead of describing the change.
Two gestures were named: select a line and mark it for deletion, and select a range of words and
rewrite the text inside that range. After those edits the reviewer either saves them, or sends them
to the agent so the agent makes them. The mockup came first and was approved before any code.

## What the code did before

`sdk.js` runs inside the artifact iframe and already carried the two halves this feature needed.

- Annotation mode (`setAnnotate`) turns on a hover outline and a click handler.
- A non-collapsed selection on `mouseup` sends `pick-text` with a text anchor.
- A click sends `pick-element` with a CSS selector.

Both land in `chrome.html`, which opens the annotation popover and offers "Send now" or "Add to
review". The product could say *where* a change belonged. It had no way to say *what the text
becomes*.

The server never wrote the artifact: it read it (`_artifact`) and watched it for agent changes
(`_watch_file`). Saving reviewer edits into the file is a new capability, not a new caller.

## The shape that was approved

One new mode, `Edit text`, beside `Annotate` in the top bar with a `⌘E` shortcut. The two modes are
exclusive, because a click cannot both pick an element and place a text caret.

| Gesture | Result |
| --- | --- |
| Point at a line | The line is tinted and two handles appear, a pencil and a bin |
| Click the pencil | The whole line opens as itself in the editor, already holding its text |
| Click the tinted line | The same editor opens, so the pencil is a shortcut and not the only way in |
| Click the bin | The line is struck through, tinted, and tagged "Marked for deletion" |
| Select words or lines | A toolbar appears over the selection: Edit text, Delete, Comment |
| Edit text | The selection itself becomes the editor, already holding that exact text |
| Delete | The selected words are struck through in the danger tone |
| Comment | Falls back to the existing annotation popover |

Three shapes of editor, one behaviour. A word range inside one line becomes an inline editable span.
A selection crossing two lines grows to whole lines first. A whole line opens as itself, keeping its
own tag and its own look. `⌘Enter` saves as a draft, `Escape` puts the original back.

Each change becomes a row in the existing Draft feedback list with a chip (Edited, Cut text, Cut
line), a before-and-after preview, and a remove button that restores the artifact's own text. The
composer button reads "Send or add", and "Save or send" once the review holds a text edit. The menu
then gains a first item, "Save edits to the artifact".

## How it is built

**The editor lives in the artifact, not in the chrome.** An editor over the artifact's own words
cannot be drawn from the parent document, so the handles, the toolbars, the marks, and the live
editor are all created by `sdk.js` inside the iframe and marked `data-arev-internal`. The chrome
owns the rail, the queue, and every HTTP call, as it already did.

**A block is a line.** `BLOCK_SELECTOR` names the elements that count: `p`, `li`, the headings,
`blockquote`, `dd`, `dt`, `figcaption`, `td`, `th`, `caption`, `summary`. Anything inside an `svg` or
inside the review tool's own UI is excluded.

**What travels to the server.** A `text-edit` item carries `before` and `after` for the rail preview,
and `blocks` for the save: one before-and-after pair per block, holding that block's whole text. The
whole block text is used because it is far more likely to appear exactly once in the file than the
few words the reviewer picked.

**Stacked edits compose.** `before` is the block's resolved text immediately before the action and
`after` is its resolved text immediately after, where resolved means with the cut wrappers removed.
Two edits on one line therefore read A to B, then B to C, and the server applies them in that order.

**The save is a read-modify-write of the current file.** `POST /apply-edits` reads the artifact,
replaces each block's `before` with its `after`, writes the file atomically, and keeps the file's own
permissions. Applied items leave the queue and are delivered as a feedback event marked `applied`, so
the agent's existing loop learns what changed with no new event plumbing.

**What a save refuses, one edit at a time, leaving the rest to land.**

- The artifact changed after that edit was drawn on it (`baseVersion` against the file's version).
- The block's text is not in the file, because inline markup or entities break it into pieces.
- The block's text appears in the file more than once, so the target is ambiguous.

A refused edit stays drafted, and the reviewer sends it to the agent instead.

## Decisions and reasons

**A separate mode, not an extension of annotate mode.** Annotate mode swallows every click to pick an
element. Text editing needs the caret and the native selection.

**Edits ride in the existing draft queue.** They are feedback. A second list would break the
product's first anti-reference, "scattered or duplicated controls".

**The button label changes with the situation, the menu does not move.** Two labels, each true, beat
one label that lies.

**Marks never rest on colour alone.** A cut is struck through, an inline edit is underlined, and a cut
line or a rewritten block carries a text tag. Required by the product's WCAG 2.2 AA target.

**The caret lands after the text, never over it.** Opening the editor on a full selection would let
the first keystroke wipe the words the reviewer came to keep.

**Per-edit staleness, not per-batch.** The first attempt compared the chrome's current knowledge of
the file version against the server's, which are always equal, so the guard never fired. The version
the artifact was showing when the edit was drawn is stamped on the item instead.

## Faults found and fixed while driving it

1. **The batch version guard never fired.** Now stamped per edit as `baseVersion`.
2. **`mtime_ns` is wider than a JavaScript integer.** The browser hands back a rounded copy, so the
   comparison rounds both sides the same way.
3. **A range edit was refused by the server.** The editor host carried `data-arev-internal`, which is
   exactly what the block lookup skips, so the item arrived with no blocks. The host no longer
   carries the attribute and each editor names its own blocks. No scenario had saved a range edit,
   so one was added.
4. **`display:flex` outranks the `hidden` attribute.** Both floating groups now say `display:none`
   for themselves, the same trap the diagram editor's overlay already documents.
5. **The handles covered the first words** of an artifact whose text runs to the left edge. They move
   above the line when there is no margin beside it.
6. **Cutting words left two spaces.** Each removed wrapper leaves a marker, so the seam closes.
7. **The editor opened on a full selection**, so the first keystroke wiped the line.
8. **The line handles stayed on screen** while an editor was open.
9. **Edit text mode was lost whenever the artifact reloaded.** `reloadArtifactOnce` turns annotation
   mode back on inside the fresh document but knew nothing about the new mode, so the top bar kept
   reading "on" over an artifact with no handles. Saving reloads the artifact, so this sat right in
   the middle of the main path. Found by recording the demo video, after 109 green scenarios. The
   reload now restores whichever mode the top bar shows, and a scenario covers it.

## One fix outside the mockup

`.drafts { max-height:34% }` resolved against a height the browser had already measured from the
uncapped list, so the Draft section kept holding space the shortened list no longer filled. Three
drafts showed one row and a large empty gap. This predates the feature and reproduces with three
plain chat notes, but text edits arrive in threes and fours, so it is now `34vh`, and `22vh` on a
phone, which is a real length. Nothing else about the rail changed.

## Verification

- `npm test`: 7 suites pass, including the new `text-edits` suite of 20 tests covering rewrites,
  cuts, emptied tags, entity-escaped text, ambiguous and missing text, ordering, staleness, file
  permissions, and the refusal that writes nothing.
- `npm run test:e2e`: 108 scenarios pass, including 18 new ones in
  `tests/features/text-editing.feature`.
- Driven by hand in a visible browser against a real session: the handles, the three editor shapes,
  the multi-line editor, cancel, undo from the mark, removing a row, saving into the file, and the
  agent's `applied` event. No page errors.
- Two `verify-ui` proof clips, both validated by the harness against their own delivered frames:
  - `.playwright-cli/videos/verify-ui-edit-a-line.mp4` - 86s, 2 chapters, 4 markers. The line
    handles, the editor holding the line's own text, the rewritten line tagged Edited, and the
    draft row carrying the old and new text.
  - `.playwright-cli/videos/verify-ui-cut-and-save.mp4` - 74s, 2 chapters, 3 markers. A whole line
    marked for deletion, its draft row, and the save writing both changes into the file with the
    composer reading Applied and the agent's activity naming each change.
