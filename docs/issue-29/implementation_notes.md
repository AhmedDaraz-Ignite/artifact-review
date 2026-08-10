# Issue 29 - An empty send reports 'Failed'

Branch: `bug-29-i-d-be-happy-to`
Worktree: `/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-29-i-d-be-happy-to`

## Reported behavior

Choosing `Send now` with an empty note and no drafts set the composer chip to
`Failed`, the same word a refused delivery shows. Focus stayed on the action
button instead of moving to the note field.

## Reproduction

Added a scenario to `tests/features/composer.feature` and ran it against the
unchanged code. It failed twice, once per defect:

1. `Expected "Nothing to send", Received "Failed"`.
2. After only the wording was fixed, `expect(chat).toBeFocused()` still failed.

That second run proves the two defects are independent. The guard already called
`$("chat").focus()`, so the focus loss came from somewhere else.

## Root causes

**Wording.** `submitChat` reused the `Failed` value for both empty-composer
guards, so a reviewer mistake and a server refusal read the same.

**Focus.** `attachMenu` (`chrome.html`) ends every menu item click with
`trigger.focus()`. The item's own listener runs in the target phase and the menu
listener runs later in the bubble phase, so `trigger.focus()` overwrote the
`$("chat").focus()` the guard had just performed. This is shared code behind all
four menus, so the fix belongs there, not in the composer.

## Changes

- `attachMenu`: return focus to the trigger only when the item handler left
  focus alone. Checked every menu item for a synchronous focus move first, and
  only the two composer guards have one. `openAnnotation` and `closeAnnotation`
  focus after an `await`, so their behavior is unchanged.
- `submitChat`: the guards now set `Nothing to send` and `Nothing to add`.
- `actionState`: the class name now slugifies spaces, so a multi-word state
  gives one class instead of three.
- CSS: the two guard states use `--warning`, visually apart from the red
  `--danger` used by `Failed`.
- The typing reset used to clear only `Failed`. It now clears the guard states
  too, otherwise the chip would stay stale while the reviewer types.
- `DESIGN.md`: the chip vocabulary was documented as closed, so the two guard
  states are recorded there.

## Decisions

- Fixed the `queue` guard as well as the `send` guard. Both misused the same
  word, and the issue names one only because that is the path the reporter took.
- Kept two labels rather than one shared word. `Nothing to send` is wrong on the
  `Add to review` path.
- Rejected clearing any non-Draft chip on typing. That would also wipe `Sent`,
  which is a behavior change nobody asked for.

## Code review

Four findings came back. Three were accepted.

**Accepted: `Nothing to add` shipped untested.** The step pattern and the feature
covered only the send guard, so a typo in the queue guard would ship silently.
Added the pattern value and a scenario.

**Accepted: the focus test misread "focus is elsewhere" as "the item moved it".**
The first version compared `document.activeElement` against the menu. Safari and
Firefox on macOS do not focus a clicked button, so focus never enters the menu
there and the trigger would have stopped receiving focus back, a regression on
those browsers. The reviewer's own patch did not fix its own scenario, so the fix
went further: `attachMenu` now records where focus sat when the menu opened and
compares against that. An item that moved focus is then told apart from focus
that was already elsewhere, in every browser.

**Accepted: the chip kept claiming `Nothing to send` after a draft arrived from
the annotation popover.** Fixed in `renderQueue`, the one place a draft from any
source reaches the UI, rather than in the annotation handler. That also covers
page choices and diagrams. Proved by disabling the new branch and watching the
new scenario fail with `Expected "Draft", Received "Nothing to send"`.

**Rejected: add the guard states to `runtime.md`, `README.md`, and
`CONTRIBUTING.md`.** Those three list the states a delivery event moves through,
and the agent reads them to interpret events it received. An empty send creates no
event and sends no request, so the guard state is not a delivery state. Listing it
there would make those lists wrong. `DESIGN.md` is different: it describes the
chip the reviewer sees, and its own wording said "Failed only", so that
contradiction was fixed.

## Simplification

Four cleanup agents reviewed the diff for reuse, simplification, efficiency, and
altitude. Two of them independently reached the same conclusion about the focus
fix, which is why it was rewritten.

**The focus fix no longer guesses.** Both the `menu.contains` version and the
`focusOnOpen` version inferred the item's intent from `document.activeElement`,
and both had a hole. A capture-phase listener has none. Capture descends from the
root before reaching the target, so the menu's listener now runs *before* the
item's own listener: the menu closes and hands focus back to the trigger first,
and an item that needs focus elsewhere simply takes it afterwards and wins. That
is DOM event ordering, not browser behavior, so Safari and Firefox need no
special case. It deleted `focusOnOpen`, the four-term condition, and the comment
explaining them.

Hole in the version it replaced, for the record: a reviewer who clicked into the
note field, wrote nothing, then opened the menu would have had
`focusOnOpen === #chat`, so the guard's own `focus()` looked like no change and
the trigger stole focus back. The reported bug, one path over.

**One `clearState(id, ...states)` helper replaced three copies.** Three places
read a chip's text, compared it against a hand-written state list, and wrote
`Draft`. The lists had already drifted: the annotation chip cleared only on
`Failed`. Each caller now names the states it owns, which is what stops a queued
draft from wiping a real delivery failure.

**One `stateClass` helper replaced two conversions.** `actionState` slugified
spaces but the feed chip at `renderFeed` still did the naive `toLowerCase()`. A
multi-word state reaching it would have emitted three junk classes.

**The queue reset moved from `renderQueue` to `applyState`.** `renderQueue`
paints the draft list. A rule about a different widget does not belong inside it.

**Rejected: fold the two labels into one, such as `Nothing yet`.** `Nothing to
send` is wrong on the `Add to review` path, and the chip is what a sighted
reviewer reads. Two accurate words beat one vague one.

**Rejected: drop the eager reset at the page-choice handler.** It resets from any
state, including `Sent`, which the queue-driven clear deliberately does not do.
Removing it would change behavior outside issue 29.

**Rejected: the efficiency angle found nothing.** It also corrected an assumption
in these notes: `renderQueue` is gated behind a paint cache and the poller is a
25s long poll, not an interval, so nothing here runs hot.

## Verification

- `npx playwright test` - 69 passed, including the new scenario.
- `npm test` (Python runtime) - SELFTEST: PASS.

Real browser proof, recorded through `verify-ui` against a live `arev` session.
The clip passed harness validation: `duration=67s canvas=3840x2160
viewport=1920x1080 chapters=2 markers=3`.

This is the second recording. The first one showed the earlier focus mechanism,
which the simplification round replaced, so it no longer showed the shipped code.
A recording of code that is not shipping proves nothing, so it was redone.

Recording:
`/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-29-i-d-be-happy-to/.playwright-cli/videos/verify-ui-issue-29-empty-send.mp4`

Screenshot:
`/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-29-i-d-be-happy-to/.playwright-cli/videos/verify-ui-issue-29-empty-send.png`

Frame showing the fixed chip:
`/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-29-i-d-be-happy-to/.playwright-cli/videos/frame-issue-29-empty-send-marker2-Nothing-to-send.png`

What the frames show. The composer starts empty with zero drafts and the chip on
`Draft`. Choosing `Send now` puts `Nothing to send` in the chip, drawn in amber
`rgb(161, 66, 15)`, and the note field gains its focus ring. The next text was
typed with no click in between, which is what proves focus landed there, and the
chip returns to `Draft` as the text arrives.

`.playwright-cli/` is in `.gitignore`, so the proof files stay local rather than
being committed to a public repository.

## Blockers hit and the choices made

- The first take ran 158s and failed the harness 100s cap. A second agent
  recording at the same time also overwrote the shared
  `~/.local/state/verify-ui/last-take` pointer, so half the chapters landed in
  its take. Re-recorded with `VUI_REPO` exported on every call, which pins the
  state directory to this worktree, and with the browser driven in batches to
  cut dead time. The second take passed at 63s.
- The first `/code-review` run reviewed the primary checkout instead of this
  worktree, because the shell working directory resets there between calls. Re-ran
  it with the worktree path and `git -C` spelled out.
- The recording lock at `/tmp/arev-video.lock` was held by another agent for 19
  minutes. Rather than break it blindly, the wait loop was given a 25 minute
  stale threshold. The other agent released it first, so nothing was broken.
- The first `vui-record start` of the second take failed its beacon probe. The
  browser was relaunched through `ensure-auth` and the take succeeded.
- The `arev` session URL carries a bearer token. It was passed to the browser
  driver as a command argument. There is no secret store for a throwaway
  localhost session, and the alternative was skipping browser verification, so
  the token was used and the session was stopped afterwards.
