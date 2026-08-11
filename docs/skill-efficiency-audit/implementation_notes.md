# Artifact Review efficiency audit - implementation notes

Task: find where the artifact-review skill burns tokens and wall clock, and plan the fix.
Deliverable: `efficiency-plan.html`, reviewed in Artifact Review itself.

## What was audited, and why that copy

Two copies of the skill exist in this tree:

- `skills/artifact-review` - the repo source. SKILL.md 7,809 bytes, server.py 767 lines.
- `.claude/skills/artifact-review` - the installed copy, gitignored, resolved from
  `skills-lock.json` (source `arDaraz/artifact-review`). SKILL.md 9,368 bytes,
  server.py 997 lines.

The installed copy is what actually runs, and local `main` is **3 commits behind
`origin/main`**, so the repo source is an older build. Everything was measured against the
installed copy. Phase 0 of the plan is `git pull`, because fixes written against the stale
source would land in a version nobody runs.

## Method

No subagents, no workflows - the surface is small enough to read directly. Every number came
from running the installed CLI, not from reading code and estimating. Two findings remain
explicitly labelled as estimates in the artifact (artifact boilerplate size, whiteboard PNG
cost) and the measurement table says how each becomes a real number.

Harness: `bench.sh`, captured to `baseline.txt`. Written before the artifact's measurement
section, so the section quotes real output.

## Findings

Eight, ranked in the artifact. The ones worth recording here:

1. **Boilerplate regenerated per artifact** (High, estimated). `design.md` describes theme
   variables, dark mode, layout width, overflow containers and focus states in prose, so the
   model retypes them as CSS for every artifact. Fix is `arev new` scaffolding from a Python
   template - zero model output tokens.
2. **Poll default outlives the harness timeout** (High, measured). `arev poll` defaults to
   `--timeout 300`; Claude Code's Bash tool defaults to 120s and kills the call.
3. **Playbook index hides `use_when`** (High, measured). Every playbook carries `use_when:`
   on line 1; `cmd_playbook` prints only the ids. The agent's cheapest safe move is dumping
   all 16,386 bytes. Five-line fix.
8. **Idle polls overrun by ~4s** (Medium, measured). Found while building the harness.

## Finding 8 root cause, isolated not guessed

First observations were inconsistent (6.11s, then 10.12s for the same `--timeout 6`), so it
looked like noise. Isolating client from server settled it:

```
curl -> /next?timeout=6   6.01, 6.01, 6.01
arev poll --timeout 6    10.13, 10.13, 10.14
```

The server is honest. `cmd_poll` is not:

```python
chunk = min(90, max(5, deadline - time.time()))
event = _api(entry, "GET", f"/next?timeout={int(chunk)}", ...)
```

`deadline - time.time()` is `5.999…`; `int()` truncates it to **5**, so the first chunk is a
second short. The leftover ~1s is then floored back up to **5** by `max(5, ...)`, and the
deadline is only checked after the blocking call returns - so a second full chunk always
runs. Arithmetic matches every measurement: 5+5 = 10.13s, and `--timeout 12` gives 11+5 =
16.16s. Deterministic, not noise.

## Corrections made during review

- Estimated "~7,000 bytes" for two matched playbooks. Measured value is **4,731**, which
  moves the typical session total from 20,532 to **17,869**. Artifact corrected.
- `bench.sh` initially counted 1 prepare-phase call instead of 4 - the grep anchored on
  leading whitespace, but SKILL.md writes three of the four inside a numbered list. Fixed.

## Reviewer feedback and what changed

1. *"I am confused about what the phases below refer to."* The section jumped straight into
   "Phase 0" without saying the phases are batches of edits to the skill itself, and the
   findings table referenced them before they existed. Rewrote the intro, added a phase
   overview table, renamed the column to "Fixed in phase".
2. *"I have four checkboxes and I am not understanding what should I pick from... it's not
   clear if the fourth checkbox is only tied to finding number two."* Each phase listed
   findings in bullets and then a flat, unattributed checkbox list. Restructured every phase
   into per-finding blocks, each with its own "Done when" list. Added a note that the
   checkboxes are verification steps, not a menu, and that the scope controls at the bottom
   are where work is chosen.
3. *"You did not mention how you are going to test the measurement improvements in terms of
   time and in terms of tokens."* Fair - the plan asserted savings with no method. Wrote
   `bench.sh`, ran it, and added the measurement table with baseline and target per metric.

## Decisions recorded from the artifact controls

- **Scope: all phases** (`input[name=scope]` = `all`).
- **Poll fix: option A** - lower the default to 110s and document raising it. The radio was
  preselected as the recommendation and never changed, so this is an assumed default rather
  than an explicit pick. Worth confirming before phase 1 lands.

## Implementation

Branch `arev-efficiency`, worktree based on `origin/main` - which is also how Phase 0 got
settled, since the worktree starts from the synced source rather than the stale checkout.
Verified byte-identical to the installed skill before touching anything.

### What changed

- `scripts/arev.py`: `cmd_poll` chunk arithmetic and deadline check; `--timeout` default
  300 to 110; `cmd_playbook` index prints `use_when`; new `cmd_brief` and `cmd_new`;
  `_doctor_checks` extracted so `brief` reuses it; `template` added to doctor.
- `assets/artifact-template.html`: the themed shell, new file, kept out of
  `assets/review-ui` so the server cannot serve it.
- `scripts/server.py`: `_undelivered_warnings_locked` replaces the raw findings list on
  feedback events; `STATE["warned"]` clears when the artifact changes.
- `references/playbooks/design.md`: trimmed to rules the scaffold cannot enforce.
- `SKILL.md`: `brief` and `new` flow, poll timeout guidance, the two Phase 3 rules.
- `tests/run.sh`: new `scaffold` drive running the existing gate against `arev new` output.

### Verified, not assumed

- Poll: 10.13s to 6.10s at `--timeout 6`, 16.16s to 12.10s at `--timeout 12`.
- Layout dedupe: driven end to end against a live server. First batch carried only the
  severe finding, second batch on an unchanged page carried `[]`. The minor finding never
  appeared in either.
- Scaffold: `tests/run.sh` scaffold drive reports `status=clear`, so the shell passes the
  layout gate with zero severe findings before any content exists.
- Full suite green after each phase and at the end.

### Estimates that turned out wrong

- **Boilerplate saving over-estimated 2-3x.** Claimed 2,500-4,000 output tokens per
  artifact. The template is 4,938 bytes and the hand-written shell it replaces was 5,051,
  so the real figure is about 1,250 output tokens.
- **`design.md` fell 34%, not the 50%** the acceptance criterion named. What remains is all
  unenforceable-by-scaffold guidance. Cutting further would delete rules, not duplication,
  so the criterion was left missed rather than gamed.
- **`SKILL.md` grew.** My first pass added 1,429 bytes and wiped out the entire `design.md`
  saving. Caught it in the after-measurement, went back and compressed to +672, mostly by
  deleting a requirements bullet list that duplicated `design.md` - which `brief` now prints
  in the same call anyway.

### Net result

Fixed context per session moved only 2% (17,869 to 17,521 bytes). The real wins are wall
clock and round trips: prepare went from 4 blocking calls to 1, killed polls are gone, and
each idle poll is ~4s shorter. Per artifact, the model writes ~1,250 fewer output tokens.

The largest remaining lever is `SKILL.md` itself at 10,040 bytes, loaded on every trigger.
That was offered as an option in the review artifact and the user did not select it, so it
stays out of scope.

## 2026-08-02 runtime follow-up

The later whole-tool review explicitly brought the previously deferred lever back into
scope and added browser/runtime costs that the first audit did not measure.

### Changes

- The always-loaded `SKILL.md` is now a compact event router. Detailed lifecycle,
  feedback, whiteboard, and remote guidance lives in three lazy references whose exact
  routes are checked by `tests/test_cli_foundation.py`.
- Default `poll` output is one compact JSON line; `--pretty` preserves expanded output for
  manual diagnostics. A successful `brief` emits one install summary line instead of the
  full private path-bearing doctor object.
- Diagram discovery creates lightweight hosts only. The 8.9 MB whiteboard module is not
  requested before activation, and one shared frame moves between any number of diagrams
  after a bounded autosave flush.
- Static runtime bytes and SHA-256 hashes are loaded once per server. Gzip variants are
  created lazily on first request and retained in memory. Hashed URLs are immutable and
  conditional requests use representation-specific strong ETags.

### Measured results

`runtime-after.txt` is the raw output from:

```bash
docs/skill-efficiency-audit/bench.sh
```

Compared with the earlier `after.txt`:

- always-loaded `SKILL.md`: **10,040 → 3,704 bytes** (63% smaller);
- typical brief-flow context: **17,521 → 10,884 bytes** (38% smaller);
- representative event JSON: **126 bytes pretty → 84 bytes default** (33% smaller);
- whiteboard module: **8,938,928 raw bytes → 2,916,787 gzip bytes**;
- pre-activation whiteboard frame/script/style requests: **0**;
- post-activation editor frames: **1**; and
- initial controller transfer in the recorded Chromium run: **76,260 bytes**.

The recorded local controller-ready time was 351.1 ms and `arev open` was 0.18 s. Those
wall-clock values describe this machine and run, not a cross-machine promise. Request count,
frame count, byte size, caching headers, and lazy-load behavior are deterministic acceptance
contracts in the test suite.
