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

---

# Step definitions use regex capture groups, not Cucumber Expressions

Changed on request, and the request was right.

## Why

`(...)` in a Cucumber Expression means optional text, not a capture group.
Alternation exists (`start/end`) but it matches without capturing. So any step
that needs to both constrain and capture has to widen to `{word}` or `{string}`
and re-check inside the body. Two steps did exactly that, and both were wrong:

```js
// any word other than "on" silently asserted OFF
Then('annotation mode is {word}', async ({ rail }, state) => {
  await expect(rail.annotateToggle)
    .toHaveAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
});

// any label other than "Send now" silently asserted popQueue
Then('the annotation menu focuses {string}', async ({ page }, label) => {
  const id = label === 'Send now' ? 'popSend' : 'popQueue';
```

`Then annotation mode is enabled` would have passed while asserting the
opposite of what it said. With `/^annotation mode is (on|off)$/` the step is
undefined, `bddgen` prints "Missing step definitions: 1" and exits 1 before any
browser starts. Verified by adding a feature with that typo.

## What the conversion cost

Nothing. `(\d+)` is matched against Cucumber's registered parameter types, so a
numeric group still arrives as a Number, exactly like `{int}` did. The only
real edit was putting back a `String(count)` that had been dropped on the
mistaken belief that regex hands back strings.

## Convention

Regex where the step captures. A plain string where it does not, since a
Cucumber Expression with no parameters is just a literal. Recurring vocabularies
are built once and interpolated:

```js
const DELIVERY_STATE = '(Draft|Sending|Sent|Received|Answered|Failed)';
Then(new RegExp(`^the composer shows "${DELIVERY_STATE}"$`), ...);
```

`defineParameterType` was considered as an alternative and rejected for now.
It would give the same constraint plus coercion, but it adds a registration
layer for vocabularies that currently appear in two or three steps each.

---

# One test root, and a simplification pass

Two jobs in one commit: fold `e2e/` into `tests/`, then delete what the first
three commits added and did not need.

## The layout

```text
tests/features/        Gherkin scenarios
tests/steps/           the step vocabulary
tests/support/         Playwright fixtures, page objects, the arev driver
tests/fixtures/        HTML artifacts (path unchanged, both suites read it)
tests/runtime/         the five Python tests
tests/perf.spec.js     the latency check
tests/bench-runtime.mjs
tests/legacy-drives/   the nine Node drives and their two helper modules
tests/run.sh
```

The Gherkin directories sit directly under `tests/`, not under `tests/e2e/`,
and the drives are the ones quarantined. That is the whole point. The drives
and the scenarios are the same kind of test: a real browser against a real
server against a real artifact. Nesting the new suite under `e2e/` would say
they are different families and would give the drives a permanent address.
Putting the drives in `legacy-drives/` says the opposite, and the directory
name carries the migration status without a doc that can go stale. Nine more
pull requests each delete one file plus one line of `run.sh`, and the last one
deletes the directory.

`tests/runtime/` exists so the five Python files stop being loose among five
directories. Each moved file needed `parents[1]` to become `parents[2]`.

The sections above this one quote the old paths, because they record what was
true when they were written. The live config now reads
`features:'tests/features/**/*.feature'`,
`steps:['tests/support/bdd.js', 'tests/steps/**/*.js']`, and
`testDir:'tests'` for the perf project. `bdd.js` still has to be first in
`steps` or `bddgen` cannot guess the test instance.

## Rejected

- **`tests/e2e/{features,steps,support}`.** Moves the wall one level down
  instead of removing it.
- **`tests/{playwright,node,python}`.** Groups by which tool runs the test,
  which is the split we were asked to stop having. It would also need renaming
  as the drives disappear.
- **`tests/unit`, `tests/integration`, `tests/e2e`.** A taxonomy this repo does
  not have. Everything except `tests/runtime/` drives a browser.
- **Moving `playwright.config.js` under `tests/`.** It is tool config, like
  `package.json`, and moving it buys nothing while costing a `-c` flag on both
  `bddgen` and `playwright test`.
- **Moving `bench-runtime.mjs` into `legacy-drives/`.** It shares those helpers
  but it is not a test and `npm test` never runs it. The contract of
  `legacy-drives/` is that deleting it is safe, and deleting the benchmark
  would silently break `docs/skill-efficiency-audit/bench.sh`.

`e2e/support/arev.js` already resolved `ROOT` as `../..`, and
`tests/support/arev.js` is the same depth, so that line did not move. The two
paths that did need fixing were `test-helpers.mjs` (`..` to `../..`) and the
`../package.json` read in `selftest-diagram-features.mjs`.

## What the simplification pass deleted

**One HTTP client, not two.** `Arev.api()` was a second copy of `sessionApi()`
down to the error shaping. `sessionApi` now lives in `tests/support/arev.js`
next to the rest of the arev driver, `Arev.api()` calls it, and the drives keep
importing it from `test-helpers.mjs`, which re-exports. `ROOT`, `AREV`, and
`PYTHON` were triplicated the same way and collapsed with it.

**One way to run arev.** `poll()` hand-rolled `spawn` plus stdout and stderr
accumulation plus an explicit `Promise` constructor, next to `run()` which
already had `execFileAsync`. `promisify(execFile)` exposes the child on
`promise.child`, so a poll can still be killed. Verified before rewriting.

**`stopping` is now `child.killed`.** The flag existed only so a poll killed
during teardown resolved null instead of rejecting. Node already sets `killed`
on the child after a signal, so the flag was bookkeeping for a fact the
platform tracks. The reason the null matters is a test timeout: the awaiting
step is gone and the rejection would land unhandled. Proved with a script that
opens a session, abandons a poll, calls `stop()`, and checks the poll resolved
null with no unhandled rejection.

**`page.unrouteAll()` instead of a routes array.** `Network` kept every
`[pattern, handler]` pair so `clear()` could unroute them one at a time.
Playwright removes all of them in one call. The two deferred-promise pairs
became `Promise.withResolvers()`, which Node 22 has.

**The page objects are one file.** `review-rail.js` and
`annotation-popover.js` became `review-ui.js`. They stay two classes, because
the popover repeats two of the composer's labels behind a different trigger, so
one `choose(label)` cannot serve both. A comment says so. `popover.menu` was
never read and is gone.

**Dead guards.** Both `choose()` methods threw on an unknown label, and
`annotation.steps.js` had a `target()` helper that threw on an unknown target.
The step regexes constrain those labels, so none of the three could fire. The
annotation target step was the one exception: it captured `([^"]*)`, so it
really could reach the lookup. Narrowing it to
`(the first paragraph|the table)` matches the convention the previous commit
set and made the helper collapse into the lookup.

**Speculative parameters.** `Arev.open(extraArgs)` was never called with
arguments, and `open()`'s return value was never read. Both gone.

**`handle.original` reads plainly.** The `artifact` fixture's `from()` assigned
to the object it was being defined inside, through a `handle` variable that
existed only for that. It is `this.original` now and the variable is gone.

`layout.steps.js` had two idioms for the same assertion. Both are now the
filter form, which names the failing key.

## Verification

- `npm run test:e2e`: `21 passed`, the same 21 scenarios asserting the same
  things. Nothing was removed from a feature file.
- `npm test`: `SELFTEST: PASS`, 125 PASS lines, zero FAIL lines, exit 0.
- `npm run build` then `git diff --exit-code` on the four generated files: exit
  0, so no generated asset moved.
- No orphan process. Three seconds after both suites, the only `server.py`
  processes were two review sessions from the user's installed skill in
  `~/.claude/skills/`, both started before this work and neither from this
  checkout.

---

# Independent review pass

A second pair of eyes went over the three things this pull request decides:
where test code lives, how the old and new suites depend on each other, and
whether the port kept every assertion. The layout survived. The coupling and
three assertions did not.

## The layout stands, with one correction

`tests/features`, `tests/steps`, `tests/support` directly under `tests/`, with
the drives quarantined in one directory, is the right shape for a migration.
The new suite holds the permanent names and the dying code sits in a box whose
name states its status. The rejected alternatives above are still rejected for
the reasons given.

The correction is what the box holds. `tests/legacy-drives/` promised that
deleting it was safe, and it was not: `tests/bench-runtime.mjs` imported
`openSession`, `stopSession`, `openWhiteboard`, and `waitForInlineDiagram` from
inside it. The stated end state, an empty directory after nine more pull
requests, was unreachable, because the last drive to go would leave the two
helper modules behind for the benchmark. The directory is now `tests/legacy/`
and the benchmark lives in it.

Rejected: giving `bench-runtime.mjs` its own copy of the four helpers.
`waitForInlineDiagram` and `openWhiteboard` are not small, and the benchmark is
the same generation of code as the drives. It boots a browser against a real
session and reads response headers by hand, exactly like they do. It gets
rewritten or dropped when they do. `docs/skill-efficiency-audit/bench.sh` names
the path and was updated with the move, which is the whole cost the earlier
note worried about.

## The dependency ran the wrong way

`tests/legacy-drives/test-helpers.mjs` imported `AREV`, `PYTHON`, `ROOT`, and
`sessionApi` from `tests/support/arev.js` and re-exported them to the drives.
That made the living suite's driver load-bearing for nine files scheduled for
deletion. Every future change to `sessionApi` would have to keep the drives
working, and nobody reading `support/arev.js` would know why.

Temporary code is frozen and self-contained. `tests/legacy/test-helpers.mjs`
owns its own path constants and its own `sessionApi` again, which is where they
were before this pull request. That is roughly 25 duplicated lines with a
scheduled death date, and it buys a closed set: nothing in `tests/legacy/`
imports out, nothing outside imports in. `npm run test:e2e` and the drives can
now change without touching each other, and the final pull request of the
migration is one `rm -rf`.

## Three assertions were missing

Everything else in `selftest-loop.mjs` maps onto a scenario. Three did not.

**The `element` kind never reached the batch.** The drive queued a text
annotation, a chat note, and a page control, then sent a fourth annotation made
by clicking a table, and asserted the delivered kinds sorted to exactly
`chat, control, element, text`. The port split that in two: the batch scenario
carried three kinds, and the element annotation moved to the in-flight scenario
where only its comment text is checked. Nothing asserted that an element
annotation is delivered as kind `element`. The table annotation is back in the
batch, which is four drafts and four kinds again.

**The feed never showed `Sent`.** `delivery.feature` opens by naming six
delivery states. `Received` and `Answered` were asserted on the feed chip and
`Sent` only on the composer, so the one state that proves delivery left the
browser before the agent acknowledged it was untested in the feed. One line in
the retry scenario.

**Reopening no longer proved it resets the layout check.** The drive asserted
`audit.status == "pending"` right after `--reopen`, then waited for the browser
to drive it back to `clear`. The port kept only the second half. Without the
first, a `_reopen` that stopped resetting the audit would leave the status at
`clear` from the initial load and the wait would pass instantly against a
regression. The assertion is back, read off the response to `POST /reopen`
rather than a follow-up `GET /state`. That is deterministic where the drive was
racing the browser, which starts clearing the check as soon as the reopen
lands. Confirmed it bites: flipping the expectation to `clear` fails with
`Received: "pending"`.

Rejected as rightly dropped: the `ended` event's `schema` field.
`event_envelope` in `versioning.py` stamps `EVENT_SCHEMA` on every event from
one constant, so checking it on the feedback batch and again on the ended event
tests the same line twice.

## One weakened assertion

`the artifact has reloaded 1 time so far` counted immediately. The drive slept
100ms first, and that sleep was load-bearing: the assertion is that a second
reload never fires, and a broken build fires it a moment after the server bumps
the version. `expect.poll` can return on its first probe, so the count could be
read before the extra request. The step waits 200ms before counting.

## `npm test` leaked a temp directory per run

Not this pull request's doing, but found while confirming a clean run.
`tests/run.sh` creates `mktemp -d "artifact review selftest.XXXXXX"` and never
removes it. This machine had 91 of them. The `EXIT` trap now deletes the
directory, and a failing run sets `KEEP_LOGS=1` first so the `see $raw` paths
it printed still resolve. Deleting from the success path alone did not work:
the trap runs `arev stop --all` after it, and that recreates
`$WORK/state` as the registry root.

## Considered and left alone

- **`perf.spec.js` at the top of `tests/`.** A p95 loop is bad Gherkin and a
  `tests/perf/` directory for one file is worse.
- **The `perf` project's `testDir:'tests'`.** It scans `legacy/`, `runtime/`,
  and `fixtures/` for `*.spec.js` and finds nothing. Narrowing it fixes no
  problem.
- **`ReviewRail.latest(state)`.** It is the last chip whose text contains the
  state, not the newest chip, so a newer entry in a different state does not
  fail it. The drive had the same shape and no scenario currently depends on
  the difference.

## Verification

- `npm run test:e2e`: `21 passed`. Same count, three more assertions inside it.
- `npm test`: exit 0, `SELFTEST: PASS`, 125 `PASS` lines, zero `FAIL` lines.
- `npm run build` then `git diff --exit-code` on the four generated files:
  exit 0.
- `node tests/legacy/bench-runtime.mjs tests/fixtures/clean.html` from its new
  path prints its metrics JSON.
- The restored reopen assertion bites: flipped to `clear`, the scenario fails
  with `Received: "pending"`.
- Temp directory count in `$TMPDIR` unchanged across a full `npm test`, and no
  `arev-home-*` or `arev-artifact-*` left after `npm run test:e2e`. The only
  live `server.py` processes belong to the installed skill in
  `~/.claude/skills/`, neither started from this checkout.
