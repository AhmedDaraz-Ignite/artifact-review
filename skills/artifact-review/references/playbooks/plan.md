use_when: implementation plan, spec document, project plan, phased rollout, RFC, technical proposal artifact

## Phases

- Number phases only when execution order actually matters (phase 2 depends on phase 1 shipping). If phases are independent workstreams, use plain headings instead of numbers - numbering implies sequence and misleads otherwise.
- Each phase: one-line goal at the top, then what changes, then how to verify it's done.
- Don't nest more than two levels of phase/sub-phase - if it needs a third level, the plan is trying to be a full spec and should be split.

## Acceptance criteria

- Render as real checkboxes (`<input type="checkbox">` with a bound `<label>`), one per criterion, not a bullet list of "should"/"must" prose.
- Each checkbox's label is a single testable statement ("user can export CSV from the table view"), not a paragraph.
- Group acceptance criteria under the phase or feature they belong to, not one giant undifferentiated list at the bottom.
- Leave them unchecked by default - they represent work to verify, not a status report.

## Open questions

- Any unresolved decision the human needs to weigh in on becomes a radio group (or checkbox group for multi-select), not a bolded question in prose.
- Phrase the question as the label above the group, options as the radio choices, so the human's answer is capturable.
- If there's a default/likely answer, preselect it and say why in a short line next to the group.

## Scope table

- Render explicit in/out scope as a two-column table: "In scope" / "Out of scope", each row a single item plus a short reason.
- A reason is required for out-of-scope rows ("out - depends on infra work not started") - a bare "no" doesn't help the reviewer trust the boundary.
- Keep in/out items at the same granularity (don't put "the whole auth system" in one column against "rename one button" in the other).

## What to avoid

- Don't write phases as a wall of prose paragraphs - bullets and short sentences only.
- Don't mix acceptance criteria and open questions in the same list - they need different controls (checkbox vs radio) and different follow-up.
- Don't skip the scope table on the theory that scope is "obvious" - the table is what stops scope creep arguments later.
