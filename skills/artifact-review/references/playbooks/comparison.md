use_when: option A vs B vs C decision, choosing between approaches, tradeoff analysis, "which one should we pick" artifact, architecture decision record

## Layout

- One card per option, laid out side by side (CSS grid or flex), equal width. Stack vertically only below ~600px viewport width.
- Each card: name/title, one-line summary, then the detail (bullets, tradeoffs, cost).
- Keep cards visually equal weight even if one option has less to say - don't let a short option's card look unfinished next to a long one. Pad with whitespace, not filler text.

## Tradeoffs

- Render tradeoffs as an explicit row-per-dimension table underneath or beside the cards (e.g. rows: "setup cost", "runtime perf", "maintenance burden"; columns: option A/B/C) so the human compares like-for-like instead of re-reading three paragraphs.
- Use consistent language across rows for the same dimension - don't call it "speed" under option A and "performance" under option B.
- Mark clear wins/losses per row with a small icon or color, not just prose ("faster" in plain text is easy to skim past).

## Recommendation

- If the artifact has a recommendation, mark it visually on the card itself (a border accent, a badge like "Recommended", not just a mention in surrounding prose).
- State the one-line reason for the recommendation next to the badge, not buried in a paragraph elsewhere.
- Don't recommend more than one option - if it's genuinely a toss-up, say that instead of picking a soft favorite.

## The actual decision

- Give the human a real radio group to record their pick - one radio per option, sharing a `name`, ids matching the option names used in the cards.
- Preselect the recommended option's radio by default if there is one.
- Put the radio group right under the cards/tradeoff table, not at the top before the human has read anything.

## What to avoid

- Don't ask "which do you prefer, A or B?" as plain prose with no control - that's not reviewable or recordable.
- Don't bury the recommendation only in the conclusion paragraph; the visual badge on the card is what people actually see first.
- Don't use more than 4 options in one side-by-side layout - beyond that, switch to a table (see table.md) with options as rows.
