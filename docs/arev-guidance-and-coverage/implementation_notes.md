# Enforcing artifact coverage and refreshing stale guidance

Date: 2026-08-02. Follows [../arev-diagram-quality/implementation_notes.md](../arev-diagram-quality/implementation_notes.md).

## Trigger

A user asked why `docs/crewboss-platform-review/spec-explainer.html` was missing
diagrams that its source spec plainly called for. Six diagrams covered a
2,011-line, 33-section spec, and only two of the spec's eight state machines
were drawn.

## Root causes, and which were already fixed

1. **A global diagram cap in the playbook.** Before `ff527a6`, `diagram.md`
   said "Max 2-4 diagrams total in one artifact". The artifact had six, right
   at the ceiling. Already fixed in `ff527a6`, which made the cap per section
   and added "Match the weight of the source" to `design.md`.
2. **Guidance is read once per session and never invalidated.** `SKILL.md`
   says to run `arev brief` once, and `cmd_brief` is the only place playbook
   text is printed. The CrewBoss session started around 17:56 and ran `brief`
   then. The playbook fix landed at 21:53. The artifact was edited at 22:07 by
   that same session, still working from the 17:56 rules. Editing files on disk
   does not reach a running agent. **Not fixed before this change.**
3. **No enforcement.** The new coverage rule was prose telling the model to
   list the source's sections itself, at the end of a long session, with no
   command behind it. **Not fixed before this change.**
4. **A workaround outlived its bug.** All six diagrams are `flowchart`, three
   of them state machines. The earlier `plan-review.html` used
   `stateDiagram-v2` and hit the mermaid-to-excalidraw id-prefix bug, so state
   diagrams fell back to flat images. The engine bug was fixed in `ff527a6`;
   nothing detected the leftover workaround. **Not fixed before this change.**

## What was built

### `arev check` (root causes 3 and 4)

`scripts/checks.py`, exposed as `arev check FILE [--source DOC]`. Exits
non-zero on an error or a coverage gap, so it is a gate rather than advice.
It knows nothing about any particular document: sections come from the source's
own headings.

Errors (mechanically certain): `div.mermaid` instead of `pre`, a missing or
duplicate diagram id, a Mermaid block with no recognised diagram type, a CDN
Mermaid loader, an unreadable source.

Coverage gaps: a source section whose words appear nowhere in the artifact, and
a heading describing states or flows that no diagram covers. Both gate.

Warnings (heuristics): a flowchart the prose calls a state machine, more than
four edges out of one node, a node label over five words, a page with drawn
connectors and no Mermaid at all.

Run against the artifact that started this, with no arguments, it independently
found the same gaps identified by hand: sections 13.3, 13.5, 13.6 and 13.7
undiagrammed, section 12's domain model uncovered, and the flowchart-for-state-
machine substitution in `joblife` and `returnstate`.

### Guidance version stamping (root cause 2)

`_guidance_version()` hashes `SKILL.md` plus every playbook. `brief` prints it,
`open` records it on the session, and `poll` compares. A session whose rules
moved gets a `GUIDANCE STALE` line naming both versions and what to run.

### Mermaid render failures (root cause 4, runtime half)

`audit.js` runs before the offline renderer, so a diagram that fails to render
was invisible to the agent. `mermaid-entry.mjs` now awaits rendering at the top
level, and `sdk.js` re-audits once the import resolves, reporting any block
that never became an SVG as a severe `mermaid-render-failed` finding through
the existing layout event path.

## Decisions and alternatives rejected

- **The stale-guidance notice goes to stderr, not into the poll event.** The
  first attempt added a `guidance` object to the event. That broke
  `test_event_envelope_has_one_fixed_public_shape`, which exists on purpose:
  the event envelope is a fixed public schema. stderr already carries this kind
  of out-of-band note (`REMOTE NOTE:` in `cmd_open`).
- **Source discovery reads only the artifact's opening 1,200 characters.**
  Scanning the whole page pulled in `SKILL.md` and `AGENTS.md`, mentioned once
  each in findings. Ranking by mention count is wrong too: `SKILL.md` is named
  four times and the actual spec once. An explainer names its subject up front.
- **A shared word like "state" does not prove diagram coverage.** Matching on
  any shared word let one job-state diagram claim every state machine section,
  which is the exact failure being detected. Words in the diagram vocabulary
  are excluded from the subject match, so "run state" and "endpoint state" need
  a diagram each.
- **Captions are excluded from a diagram's subject words but kept for section
  numbers.** Captions run long, and including their prose let one diagram claim
  every section sharing a word with it. A caption citing "Sections 19.4 and
  22.3" is the strongest coverage signal there is, so section numbers are still
  read from it.
- **Node labels are excluded from the state-machine type check.** A box reading
  "control socket, state DB, config" made an architecture diagram look like a
  state machine.
- **Not gating `arev end`.** Coverage is an authoring concern. Blocking the end
  of a review because the artifact has gaps overrides a human who already said
  they were done. The gate belongs before `open`.
- **No new dependency.** `html.parser` and `re` from the standard library.

## Verification

- `tests/test_checks.py`: 33 tests over Mermaid parsing, markup errors,
  coverage matching, discovery, CLI exit codes, and guidance versioning.
- `tests/selftest-mermaid-failure.mjs` with `tests/fixtures/mermaid-broken.html`:
  a headless browser drive proving a broken block is reported to the agent
  while a valid one still renders.
- Full suite `npm test`: **SELFTEST: PASS**, no FAIL lines.
- Guidance staleness proved end to end against a live session: polled clean,
  edited a playbook, polled and got the stale line, restored it, polled clean.
- `tests/fixtures/clean.html` gained an id on its Mermaid block. The new check
  correctly flagged the fixture for the rule the playbook already stated.

## Operational note

The installed copy under `~/.agents/skills/artifact-review` is a copy, not a
symlink. It needs reinstalling for these changes to reach a running agent, and
any review session open at that moment must be stopped and reopened. That is
the same trap as root cause 2, one level up.
