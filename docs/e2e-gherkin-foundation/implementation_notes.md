# E2E Gherkin foundation

Plan artifact: https://claude.ai/code/artifact/08ad4285-468b-478d-a9f0-3b7c7a58d89f

Phases 1 and 2 are done. Phases 3 and 4 are tracked separately and not started.

## Why this exists

The repo already ran real browser tests: ten Node drives importing `chromium`
from the `playwright` library, 163 assertions, orchestrated by `tests/run.sh`
grepping for `PASS` and `FAIL`. What was missing was a test runner, not Gherkin.

Measured before starting:

- `selftest-loop.mjs` held 43 assertions in one `try` block, so the first throw
  collapsed the rest into a single `FAIL ... drive crashed` line.
- `chromium.launch` and `pageerror` appeared in 11 files each, `#curtain` in 10.
- 53 manual wait calls (`eventually`, `waitForFunction`, `waitForTimeout`).
- Drives ran in sequence, and a CI failure produced `tail -5` of a log.

## Decisions

**playwright-bdd 9.2.0 over cucumber-js.** Rejected `@cucumber/cucumber` because
it runs Gherkin but supplies no browser lifecycle, isolation, retries, or trace
artifacts, so we would rebuild by hand the exact duplication we are removing.
Rejected "keep the drives and extract more helpers" because helpers reduce
typing, not the missing runner. Playwright 1.55.1 was already a dev dependency
and CI already installed Chromium, so the runner was paid for.

**Plain ESM JavaScript.** Every file in the repo is plain ESM with no tsconfig.
TypeScript would give typed fixtures at the cost of a compiler this repo does
not have, which is a second migration wearing the first one's clothes.

**Exact version pins.** `npm install -D` wrote caret ranges. Every other dev
dependency here is pinned exactly, so both new entries were changed to match.
Verified one `playwright-core` in `node_modules` and everything deduped at
1.55.1.

**Isolation model.** Three facts about `arev` drove it, each checked in the
source rather than assumed:

- One real artifact path owns one live session, so each scenario gets its own
  temp directory and artifact copy.
- `registry.json` and its lock live under `ARTIFACT_REVIEW_HOME`, so each worker
  gets a private state root.
- `server.py` binds port `0` and prints `LISTENING <port>`, so no port allocator
  is needed.

**Steps can poll after the action.** `server.py` marks feedback events durable
until an agent polls and acknowledges them. Every existing drive starts a poll
*before* the click that should satisfy it, which forces an unnatural write
order. Because events are durable, a `Then` step can poll afterwards, so steps
read in the order a person would say them. `delivery.feature` proves this.

## Deviations from the published plan

**Single Playwright project, not two.** The plan's Phase 1 listed a project
split on the `@whiteboard` tag. No `@whiteboard` feature exists until Phase 3,
and a project matching zero tests is dead config. Moved to Phase 3, where the
tagged features actually arrive.

**The plan's config sample was wrong.** It showed `steps: 'e2e/steps/**/*.js'`.
`bddgen` then failed with "Can't guess test instance", because the file
exporting the extended `test` must also be listed. The real value is
`['e2e/support/bdd.js', 'e2e/steps/**/*.js']`. Found by running it, not by
reading.

**Added `delivery.feature` beyond the smoke scenario.** `Arev.poll()` has real
branching (spawn, JSON parse, killed-versus-failed) that the smoke test never
touched, and Phase 2's whole step ordering rests on the durable-events claim.
Leaving both unexercised until Phase 2 would move the risk without reducing it.

**Feature branch, not a worktree.** The standing rule is `wt new`. This session
is configured to work in place, so the work went on branch
`arev-e2e-gherkin-foundation` in the primary checkout instead. `main` carries
none of it.

## Verification

All four Phase 1 acceptance criteria were checked by running them, not by
inspection.

| Criterion | Result |
|---|---|
| Parallel scenarios do not interfere | 4 scenarios, 4 workers, all pass in 2.3s |
| A broken assertion yields failure artifacts | `trace.zip`, `video.webm`, and `error-context.md` written; the error pointed at the source step file and line, not the generated spec |
| No server or poll process survives | No `arev` process and no leftover temp dirs after both a passing and a deliberately failing run. The default `~/.artifact-review` home was never touched, which also confirms the per-worker root works |
| `npm test` still passes untouched | `SELFTEST: PASS` |

The failure case was produced with a throwaway feature and step file, then
deleted.

## Corrections taken during the work

- The plan was first drafted through the `artifact-review` skill's own review
  loop. Corrected to a published HTML artifact instead, and the `arev` scaffold
  was removed.
- Superpowers skills were dropped from the flow on request.
- Implementation is tracked as four separate dependency-chained tasks so it
  stays separate from the planning session and from `main`.

---

# Phase 2: porting selftest-loop.mjs

The drive held 43 assertion call sites (41 named, plus five templated latency
samples and one percentile). All of them are now scenarios, and the drive is
deleted along with its `tests/run.sh` entry in the same commit.

## Where each assertion went

| Drive assertions | Landed in |
|---|---|
| Server identity, clean artifact opens | `session.feature` |
| Menu structure, no second send button, end lives in one menu | `composer.feature` |
| Desktop and phone rail placement | `layout.feature` |
| Toggle state, keyboard menu, durable text anchor | `annotation.feature` |
| Draft, control dedupe, batch send, Sending, Failed, retry, Received, Answered | `delivery.feature` |
| Scroll restore, Mermaid re-index, rapid-save coalescing, source untouched | `live-reload.feature` |
| End labels, send and end, read-only, reopen rules, shutdown | `session-lifecycle.feature` |
| Five latency samples and the p95 SLO | `e2e/perf.spec.js` |
| No unexpected page errors | the `pageErrors` auto fixture, now on all 21 scenarios |
| "review loop drive completed" | Dropped. It only existed because one `try` block wrapped the whole drive, and Playwright reports a thrown step natively. |

## Bugs the port found in the old drive

**The menu assertion was reading pre-hydration DOM.** The drive checked that
`#chatMenu` text contained the lowercase `end review`. The shipped markup says
`Send and end review`, and the SDK rewrites it to `End review` once nothing is
drafted. The drive read `textContent` once, early, and matched the static
string before hydration. Playwright's retrying assertion waits for the settled
DOM, so the naive port failed. The step now matches `/end review/i` against the
label element, which is what the assertion always meant.

**Ending a review opens a confirm dialog.** `chrome.html` calls `confirm()`
before ending. The drive registered `page.on('dialog', d => d.accept())` as
incidental setup. Playwright dismisses dialogs by default, so the port silently
cancelled every end action and the agent poll returned `idle`. Dialogs are now
accepted in a fixture and recorded, and `the reviewer was asked to confirm` is a
real assertion rather than hidden plumbing.

**Annotation notes are not in `item.text`.** Chat items carry their words in
`text`, annotations in `comment` (`chrome.html` builds `{ ...popItem, comment }`).
The shared step reads `item.text ?? item.comment`.

## Deliberate differences from the drive

**Dropped one racy assertion.** The drive checked `audit.status === 'pending'`
immediately after a live reopen, then waited for it to become `clear`. The first
check races the browser's re-audit and only passed because it usually won. The
port keeps the settled `clear` assertion and the feed-preservation check, and
drops the racy one.

**The perf spec starts its poll before the click.** Gherkin steps can poll after
the action because events are durable, but a latency measurement cannot: it
would include Python process startup. `perf.spec.js` keeps the drive's ordering
for that reason, which is part of why it stayed a plain spec.

**`test-helpers.mjs` lost two exports.** `percentile` became dead and was
deleted. `runArev` is no longer imported anywhere, but `openSession` and
`stopSession` still call it, so it stopped being exported instead.

## Verification

- 21 scenarios pass in 6 parallel workers in 7.6 seconds.
- `npm test` still reports `SELFTEST: PASS` with the drive gone.
- No orphan server or poll process and no leftover temp directory after a run.
  `arev stop` returns as soon as it signals shutdown, so a check run in the same
  instant can still see the process; it is gone within about a second.
