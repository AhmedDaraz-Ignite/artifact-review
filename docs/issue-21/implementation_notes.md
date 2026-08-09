# Issue 21 - An unsent diagram edit reappears after the review is ended and reopened

Branch: `bug-21-unsent-diagram-reappears`

## Reproduction

Script: `repro21.py` (scratchpad, not committed). It boots `server.py` against a
temporary session directory and runs the reported sequence over HTTP.

1. `PUT /whiteboard/process-topology` with a scene whose node reads
   `Coding agent - DDD` and a baseline whose node reads `Coding agent`.
2. `POST /end` with `by: user`.
3. Stop the server, start it again on the same session directory (a reopen).
4. `GET /whiteboard/process-topology`.

Result before the fix:

```
PUT    (200, {'ok': True, ...})
END    (200, {'ok': True, ...})
ON DISK AFTER END: ['process-topology.working.json']
AFTER REOPEN saved is None: False
  scene node   : Coding agent - DDD
  baseline node: Coding agent
```

That matches the issue exactly, including the `baseline` and `scene` mismatch.

## Root cause

A working whiteboard record is autosave only. It exists so a page reload or a
crash does not lose the scene being edited. `server.py` already treats it as
session-scoped: `_whiteboard_working_put` refuses a write with `409 session
ended` once `STATE["ended"]` is true.

The other half was missing. `_end` never removed the `*.working.json` files
already on disk. `SESSION_DIR` is keyed by the artifact path, so it survives the
process, and the next review served the old draft back from
`_whiteboard_working_get`.

The frame then restores it silently. In `tooling/whiteboard-entry.mjs`,
`initialize` calls `startSaved` whenever `saved.source_hash === init.sourceHash`.
The Mermaid source did not change, so the hashes matched, the stale-source
banner never appeared, and Excalidraw's mount-time `onChange` drove the status
straight to `Autosaved`.

## Second root cause, found while rehearsing the proof video

The server fix alone did not hold in a real browser. The rehearsal ended the
review from the browser, reopened it, and the unsent edit was back on the
canvas. The draft file had been deleted at `/end` and then written again.

The chain is deterministic, not a race:

1. `applyState` in `chrome.html` sets `state = next`, so `ended` is already
   false, and then runs `if (wasEnded && !ended) requestArtifactReload(...)`.
2. `reloadArtifactOnce` starts with `await flushInlineDiagrams("artifact-reload")`.
3. Every open editor frame flushes, `saveInlineDiagram` relays the scene, and
   the server accepts the PUT because the session is live again.

So the editor belonging to the review that just ended writes its scene into the
next one. Deleting the file was never going to hold on its own while a live
editor still held that scene in memory. The two halves cover what the other
cannot see. The server kills drafts already on disk, which matters when the tab
was closed and no client is involved. The client stops an editor from a finished
review creating a new one.

## Fix

`skills/artifact-review/assets/review-ui/chrome.html`

- A diagram record carries `retired`. It starts true when the record is built
  while the review is already ended.
- `applyState` retires every open record the moment the review ends.
- `saveInlineDiagram` refuses a retired record and tells the frame the scene was
  not autosaved, so the editor says so instead of showing a false `Autosaved`.

A reopen rebuilds the records from scratch, so live editing resumes normally.

`skills/artifact-review/scripts/server.py`

- New `_discard_working_whiteboards_locked()` deletes every `*.working.json`
  under the session's `whiteboards/` directory. Content-addressed snapshot blobs
  in `whiteboards/blobs/` are left alone, because submitted feedback references
  them.
- `_end` calls it after the quota check passes and before `_persist_locked()`,
  inside `EVENTS_COND`. That is the same lock that already orders autosaves
  against `/end`, so an autosave in flight either lands before the delete or is
  refused with 409 after it.

No client change. Once the draft is gone, `initialize` takes the `!saved` branch
and converts the artifact's current Mermaid source.

## Alternatives rejected

- **Banner on restore with a discard button.** The issue allows this as a second
  option. Rejected as the primary fix: it treats the symptom on screen and
  leaves a dead draft on disk that the server already refuses to write to. The
  server guard shows the intended lifetime, so scoping the file to that lifetime
  is the root cause fix.
- **Delete the draft when the diagram editor closes.** Wrong lifetime. That
  breaks reload recovery, which is the only reason the file exists.
- **Delete on `/shutdown`.** A shutdown is not the end of a review. A session
  can be stopped and restarted without ending, and the draft should survive.

## Code review triage

`/code-review` reviewed `main...HEAD`, which pulled in another agent's already
merged artifact column width work as well as this diff.

Rejected, out of scope: findings on `skills/artifact-review/assets/artifact-template.html`
(two CSS specificity notes), `tests/steps/layout.steps.js`, and
`tests/support/review-ui.js`. None of them are in this diff. Ten agents are
working in parallel and another one owns those files.

Rejected, the fix reintroduces the bug: the reviewer proposed moving the discard
out of `_end` and into `shutdown_if_still_ended`, so a reopened session keeps its
draft. `END_SHUTDOWN_DELAY` is `300.0` (`server.py:57`) and
`shutdown_if_still_ended` returns early when `STATE["ended"]` is false
(`server.py:294`). `/reopen` cancels that timer, so a reopen within five minutes
never reaches the shutdown path, and issue 21's steps 6 and 7 stay broken. The
underlying concern is real: an end followed by a reopen now loses an unsent
draft. That is the behaviour the issue asks for. Ending is confirm gated and the
feature file calls it deliberate and visible, so discarding unsent drafts at that
boundary is the specified result, not a surprise.

Accepted: the README sentence claimed too much. A process killed without `/end`
still leaves drafts on disk, and the next `arev open` resumes that same review
and serves them. The wording now ties the discard to ending a review, which is
what the code does.

## Simplify pass

Applied: `os.listdir` plus a suffix filter plus a missing-directory `try/except`
became one `glob.glob` call. Twelve lines became four. `glob.escape` guards the
directory part, because `ARTIFACT_REVIEW_HOME` can point at a path holding `[`
or `?`, and an unescaped pattern would silently match nothing and let the bug
back in.

Skipped, with reasons:

- Call `_whiteboard_dir_locked()` instead of joining the path. That helper runs
  `os.makedirs` and `os.chmod`, so ending a review would create a directory that
  may never have existed. The glob pattern absorbs the join anyway.
- Move the function into `ReviewStore` beside `prune_unreferenced_blobs`. The
  draft file is written and read only by `server.py`, so moving just the delete
  splits one file's lifetime across two modules. `ReviewStore.sync` runs its
  ended transition inside `BEGIN IMMEDIATE` and `COMMIT`, so unlinking there
  would destroy files that a rolled back transaction never recorded.
- Track open draft ids in memory instead of scanning the directory. This would
  break the fix. The session directory outlives the process, so a set built this
  run misses drafts a previous run wrote, and those are exactly the stale files
  issue 21 reports.
- Unlink outside the lock so the long poll is not delayed. The lock is what
  stops a concurrent `/reopen` from flipping `ended` back to false, letting a
  fresh draft be written, and then deleting it. `_persist_locked()` writes
  SQLite under the same lock two lines later, so a few unlinks cost nothing next
  to it.

## Verification

- `bash tests/run.sh` - `SELFTEST: PASS` (all five runtime suites).
- New unit test `test_ending_a_review_discards_unsent_editor_drafts` in
  `tests/runtime/test_review_store.py`. It asserts the draft is removed and a
  snapshot blob beside it is kept.
- Reproduction script re-run after the fix:

```
ON DISK AFTER END: []
AFTER REOPEN saved is None: True
```

- Browser proof, run against the real review UI on a live session:
  - Ending the review from the browser removed
    `process-topology.working.json` from the session directory.
  - Reopening with `arev open --reopen` did not write it back. Before the
    client fix, the same step recreated it with the `Coding agent - DDD` node.
  - Opening the editor after the reopen showed `Coding agent`, converted from
    the artifact's Mermaid source.
  - `GET /state` confirmed `ended: false` at that point, so the canvas was read
    in a live reopened review, not a dead one.

## Autonomous mode decisions

The user is asleep and set autonomous mode mid-run. Choices made without asking:

- Committed and pushed without a confirmation prompt, as instructed.
- Commit subject only, no body, no ticket ID, no personal detail, because this
  is a public repository.

## Proof of the fix

Screenshot, committed with this change:
`docs/issue-21/verified-after-reopen.png`. The canvas reads `Coding agent`
after the end and the reopen, and the review queue still shows `0`.

Recording, a local file, 16 MB, not committed to a public repository:
`/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-21-unsent-diagram-reappears/.playwright-cli/videos/verify-ui-unsent-diagram-discarded.mp4`

The harness validated the delivered frames: `VALIDATION PASS duration=188s
canvas=3840x2160 viewport=1920x1080 chapters=3 markers=2`. Marker frames beside
the mp4 in the same directory:

- `frame-unsent-diagram-discarded-marker1-Focus-diagram-editor--process-topology.png`
  shows the unsent edit, `Coding agent - DDD`, with `Draft feedback 0`.
- `frame-unsent-diagram-discarded-marker2-Focus-diagram-editor--process-topology.png`
  shows `Coding agent` after the reopen.

The clip runs 188s rather than the usual 90s cap because it has to show the full
reported sequence: the unsent edit, the end, the reopen, and the reopened
editor.

## Seen but not fixed, outside this issue

After a reopen the chrome keeps the red `Review ended by ... This session is
read-only.` banner, even though `/state` reports `ended: false` and the surface
accepts feedback again. `applyState` shows that banner when the review ends and
never clears it on the way back. This is a separate defect in the same file that
ten parallel agents are editing, so widening the change here would collide with
their work. Worth its own issue.
