# Artifact Review skill trigger polarity

Date: 2026-07-31

## Problem

The user asked why the agent kept confusing `artifact-review` with the built-in
`artifact-design` skill, and sometimes mentioned both in one reply.

Initial diagnosis was a name collision. That was wrong, or at least shallow. The
user clarified the actual intent: Artifact Review is meant to be the medium the
agent uses whenever it designs a new feature or tries a new idea, so the user can
annotate the result and iterate. It is not a document reviewer that waits to be
called.

## Root cause

The skill description was written reactively:

> Use when a user asks to review, annotate, approve, compare, or refine an HTML
> report, plan, diagram, form, slide deck, or other visual artifact.

That only fires when the user names the skill or names an existing HTML file.
Users do not ask for "an HTML report", they ask for a feature. So the skill sat
idle during exactly the work it was built for, and any skill with a broader
description won the match instead.

`artifact-design`'s description is just "Design guidance and fundamentals for
Artifacts", with no scope boundary, and the Artifact tool description carries a
hard "you MUST load the artifact-design skill" mandate. A skill that has
surrendered every trigger except its own literal name cannot compete with that.

The name collision was a symptom. Fixing the polarity fixes the collision,
because the two skills no longer claim the same territory: one owns proposing new
work, the other owns styling a page.

## Decision

Scope was ambiguous, so it was put to the user via AskUserQuestion. Options were
broad (any proposed work), medium (non-trivial proposals only), and narrow
(visual and UI work only).

User chose **broad**: any proposed work. Every feature design, implementation
plan, approach comparison, architecture, spec, or exploratory idea should be
built as an artifact and opened in arev rather than answered in prose. Chat prose
is reserved for direct factual answers and edits the user already specified.

Rejected: the narrow "visual or UI only" option, which was closest to the
existing wording and would have left the original problem in place.

## Changes

- `skills/artifact-review/SKILL.md` frontmatter description rewritten to lead
  with the proactive trigger. The old reactive triggers were kept, not replaced,
  so explicit requests still match. An anti-trigger was appended naming the two
  cases that belong to `artifact-design` and to claude.ai Artifact publishing.
- `skills/artifact-review/SKILL.md` opening paragraph rewritten. It previously
  assumed an HTML artifact already existed and that HTML had already been chosen
  as the medium. It now states that the artifact is how proposed work is handed
  to the user, and names the narrow exceptions that stay in conversation.
- `README.md` "Use from an agent" section now leads with the self-triggering
  behavior and demotes invoke-by-name to a secondary path.

Anti-trigger tradeoff, noted for the record: naming a sibling skill's territory
in a description can occasionally pull matches toward that sibling. Phrasing it
as "not for X" rather than "artifact-design does X" keeps the boundary without
seeding the collision.

## Verification

Grepped for the old description text and the old opening sentence across all
markdown, Python, mjs, and JSON in the repo. Both lived in exactly one place, so
there was no duplicated framing to propagate to.

Checked `tests/` for anything that parses `SKILL.md` or validates frontmatter.
Nothing does, so the suite does not cover this change and was not run for it. No
behavior change to the runtime.

Not verified: whether the new description actually wins the match at runtime.
That needs the skill installed and a real session, and the skill is currently not
installed for this agent. See below.

## Open item

`artifact-review` is not installed in `~/.claude/skills/` or as a plugin, so it
does not appear in the agent's available-skills list at all. The description fix
has no effect until it is installed:

```bash
npx skills add AhmedDaraz-Ignite/artifact-review \
  --skill artifact-review \
  --agent codex claude-code \
  --global \
  --yes
```

Installing from the local checkout instead of the published repo would be needed
to exercise these edits before release.
