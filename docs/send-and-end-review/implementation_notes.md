# Send and end review

Branch: `send-and-end-session`
Worktree: `~/Work/open-source/worktrees/send-and-end-session`

## Problem

The `⋯` session menu in the top bar held two unrelated items: `Copy artifact
path` and `End review`. Ending a review from there was a dead end. A reviewer
finishes an audit with drafts on screen, and the only way to hand them over was
to send first, then hunt for a separate menu to end. Ending without sending
silently abandoned every draft.

## Change

`End review` moved out of the `⋯` menu and into the composer's send menu as a
separated, danger-toned third item.

- Nothing drafted: reads **End review** / "Stop accepting feedback for this
  session."
- Text or drafts pending: reads **Send and end review** / "Deliver everything,
  then stop accepting feedback."

The label is recomputed on the popover's `beforetoggle` event, which fires
synchronously inside `showPopover()`, so the menu is measured for positioning
only after the final text is in the DOM.

## Decisions

**Only the composer menu gets the item.** The annotation popover and the diagram
board share the same `Send now` / `Add to review` language, so adding an end
action to all three was tempting. DESIGN.md forbids exactly that ("Don't scatter
or duplicate controls for annotating, queuing, chatting, sending, and ending a
session"). The composer is the one surface a reviewer uses to say "I am done".

**The end action never becomes the remembered default.** `rememberChoice()`
copies the last explicit choice onto the primary button label. Routing the end
action through it would make the main button advertise a session-ending action.
The handler deliberately skips it.

**Send must land before the review ends.** `submitChat()` used to swallow
failures and return nothing. It now returns a boolean, and the end handler bails
out on a failed send, leaving the existing "your feedback is preserved" banner
and the drafts intact.

**Vocabulary is "review", not "session".** The request said "send and end
session", but every other label in the product says review (`Add to review`,
`Review options`, `Draft feedback`). DESIGN.md lists ambiguous delivery labels as
an anti-reference, so consistency won.

**The `⋯` menu keeps its single item.** DESIGN.md documents one session menu in
the top bar. Collapsing it into a bare copy-path icon button would have removed a
labelled affordance for a one-item saving.

## Positioning fix

`positionMenu()` assumed a two-item menu with hardcoded `160` and `132` px
offsets. The composer sits at the bottom of the rail, so its menu always opens
upward; a third item would have made it overlap its own trigger. It now measures
`menu.offsetHeight` after `showPopover()`, in the same synchronous task, so there
is no reposition flash.

## Verification

- `bash tests/run.sh` - SELFTEST: PASS (all six drives, no page errors).
- New assertions in `tests/selftest-loop.mjs`: the menu carries three items, the
  `⋯` menu carries one and no longer exposes `#endBtn`, the label reads
  `End review` when empty and `Send and end review` when pending, the pending
  note is delivered as a `feedback` event before the `ended` event, and `#chatEnd`
  is disabled on an ended session.
- Visible headed Chromium at 1440x900 and at 390x780 with touch emulation.
  Measured geometry: desktop menu top 663, bottom 846, trigger top 852, no
  overlap, inside the viewport. Narrow: 197px tall, fits the viewport, does not
  cover the trigger, 44px touch targets hold.

## Docs propagated

`DESIGN.md` - the "Menu button" bullet now records the separated danger item and
the rule that it never becomes the remembered default.
