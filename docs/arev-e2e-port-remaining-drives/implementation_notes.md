# Porting the last six drives

Finishes the migration started in `docs/e2e-gherkin-foundation/`. Six drives,
90 assertions, ported to 34 new scenarios. `tests/legacy/` is gone.

## Decision A: no `@whiteboard` tag, no second Playwright project

The plan of record was to tag the slow scenarios and give them a longer timeout
in their own project. Measured instead of assumed. The slowest scenario in the
whole suite is `A changed Mermaid source offers keep or re-convert` at 7.1s,
and the slowest whiteboard scenario is 4.5s. Both sit far under the existing
60s timeout, and the full run is 25.3s on six workers.

The 30 second numbers in the old helpers were ceilings on `waitFor`, not
durations. Nothing waits them out on a healthy run. A second project would add
a config split, a tag every new diagram scenario has to remember, and two
result groups in CI, and it would buy nothing today. Skipped. Add it when a
scenario actually approaches the timeout.

## Decision B: `tests/legacy/` is fully deleted, the bench script moved

`tests/bench-runtime.mjs` was moved into `tests/legacy/` during the foundation
work only because it shared the drives' helpers. It is not a test: it is the
browser half of `docs/skill-efficiency-audit/bench.sh`, run by hand.

It now lives at `docs/skill-efficiency-audit/bench-runtime.mjs`, next to its
only caller, with the four helper functions it used inlined. That is about 45
lines. In exchange the audit owns everything it runs and `tests/` holds only
tests.

Rejected: importing `tests/support/arev.js` and `tests/support/diagram.js` from
the bench script. Those modules use `expect.poll` from `@playwright/test`,
which expects a test runner around it, and it would leave the audit tooling
coupled to how the suite happens to be organised.

Rejected: `tooling/bench-runtime.mjs`. `tooling/` is the build, and the bench
is not part of it.

## The activity drive had to keep its ordering

`selftest-rail.mjs` posted 125 agent replies before launching a browser, so the
page loaded with the server's bounded 50-entry window and a live
`Load earlier activity` button. Opening the browser first, which is what every
other Background does, makes the client accumulate all 125 entries from the
delta stream and the button never appears, so the paging path is never
exercised. The test passed and proved nothing.

`tests/features/activity-history.feature` therefore starts the server, posts
the history, and only then opens the browser. That needed a new step, `the
review server is running`, and a guard in `the reviewer has the review session
open` so it does not open a second session.

## Read the loaded history in one snapshot

`Load earlier activity restores the whole history` asserts entry count, first
entry, last entry and the button's `hidden` flag in a single `evaluate`, the
way the drive did. Split into separate auto-retrying assertions it flakes: a
later server update repaints the feed, and `renderFeed` re-derives `hidden`
from `state.activity.has_more`, which the server still reports as true. The
loaded 125 entries survive, because `applyStateDelta` keeps the client's
`has_more` once the local feed passes 50, but the button comes back.

That looks like a real product bug worth a separate issue: after loading the
full history, the next server update re-offers a page that no longer exists.
Out of scope here and not silently covered up. The ported assertion is exactly
the one the drive made.

## Two assertions changed shape, none dropped

Every `test.check` in the six drives maps to a scenario step. Two are worth
naming.

- The per-drive `... drive completed` catch-alls and the `has no unexpected
  page errors` checks are structural, not behavioural. Playwright fails a
  scenario on any throw, and the `pageErrors` auto-fixture in
  `tests/support/bdd.js` already fails on an unexpected page error. Both are
  covered by the harness rather than a step.
- `node identity keys survive a theme re-render unchanged` compared light keys
  against light keys after a dark round trip. The scenario does the same two
  switches rather than one, so the comparison is still light against light.

## Verification

- `npm test`: `SELFTEST: PASS`, five Python suites, zero `FAIL` lines.
- `npm run test:e2e`: `66 passed (25.3s)`, up from 32 at `1b05ea8`.
- `npm run build` then `git diff --exit-code` on the four generated files: 0.
- `node docs/skill-efficiency-audit/bench-runtime.mjs tests/fixtures/clean.html`
  from its new path prints its metrics JSON.
- Every new scenario run three or four times with `--repeat-each` before its
  commit. No flakes.
- After the final run: no `server.py` from this worktree, and no `arev-home-*`,
  `arev-artifact-*` or `artifact review selftest.*` left in `$TMPDIR`.
