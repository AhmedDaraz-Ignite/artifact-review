use_when: comparison table, data table, spreadsheet-like artifact, listing rows the human must review or pick from, tabular results

## Structure

- Real `<table>` with `<thead>`/`<tbody>`, not styled divs. Screen readers and the review tool both expect real table semantics.
- One clear header row. Don't merge header concepts across multiple rows unless the data genuinely nests (use `<caption>` for a title instead of jamming it into row 1).
- Wrap the table in its own `overflow-x: auto` container so a wide table scrolls internally, never the whole page.

## Sticky header

- For tables likely to scroll past one screen (roughly 15+ rows), make the header sticky: `position: sticky; top: 0;` on `th`, with a solid background color (not transparent, or text behind it bleeds through on scroll).
- Skip sticky header on short tables - it's dead weight.

## Numbers

- Any column of numbers (counts, prices, percentages, IDs) gets `font-variant-numeric: tabular-nums` so digits align vertically. Without it, "1,024" and "88" visually wobble against each other.
- Right-align numeric columns, left-align text columns.

## Row interaction

- Row hover: a subtle background change (`tr:hover { background: var(--row-hover) }`) so the human can track their place across a wide row.
- Zebra striping is optional; hover is not - always add hover feedback on any table with more than a few rows.

## Decision columns

- If a column represents a status or verdict (pass/fail, in/out, risk level), use a small colored badge or icon, not just plain text - it should be scannable at a glance down the column.
- Keep the badge's color meaning consistent with the rest of the artifact (same green/red/amber meaning everywhere).

## When the human must pick rows

- Add a leading checkbox column with real `<input type="checkbox">` per row, each with a stable `id`/`value` so state is readable.
- Add a "select all" checkbox in the header that toggles all row checkboxes.
- Give the checkbox column a fixed narrow width so it doesn't compete with content columns.
- If the pick is single-select instead of multi-select, use `<input type="radio">` with a shared `name`, not checkboxes.

## What to avoid

- Don't put interactive controls (buttons, selects) inside every cell of a large table unless the human genuinely needs a per-row action - it clutters scanning.
- Don't abbreviate header labels to save width; let `overflow-x: auto` handle width instead of sacrificing clarity.
