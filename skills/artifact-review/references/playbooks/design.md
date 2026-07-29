use_when: writing any HTML artifact, before first line of code, general artifact design

## File shape

- One self-contained HTML file. Inline all CSS and JS.
- No CDN scripts/fonts/stylesheets for core content. Offline and firewalled reviewers must still see it render.
- Exception: mermaid.js may load from a CDN with a local fallback message if it fails - diagrams degrade to a code block, the rest of the page still works.
- No external images. Use inline SVG or omit.

## Theme

- Support both light and dark. Use CSS custom properties for every color (`--bg`, `--fg`, `--border`, `--accent`, `--muted`).
- Default via `@media (prefers-color-scheme: dark)`. Never hardcode a single theme.
- Check contrast in both modes - don't just invert one palette and assume it works.
- Never assume a white background. Every text color must have a `--fg` variable, not a literal hex.

## Layout

- Max content width ~800-900px, centered. Don't stretch prose or forms edge to edge on wide monitors.
- Type scale: body ~16-18px, line-height ~1.5-1.6. Headings clearly distinct in weight/size, not just bold.
- Generous vertical spacing between sections - a wall of text is a review-killer.

## Overflow

- The page itself must never scroll sideways. Anything that can be wide - tables, code blocks, long diagrams - goes inside its own `overflow-x: auto` container with a max-width matching the column.
- Test wide content mentally at 375px viewport width, not just desktop.

## Semantic HTML

- Use real `<button>`, `<input>`, `<label>`, `<select>` - not `<div onclick>`. The review tool captures interactions by querying real form/interactive elements, and divs-as-buttons are invisible to it.
- Every input has a bound `<label>` (via `for`/`id` or wrapping). No placeholder-as-label.
- Use `<table>` for tabular data, not divs styled as a grid - screen readers and the review tool both expect it.

## Human decisions go in controls, not prose

- If the artifact asks the human to choose between options, render a radio group or checkbox list - never "Option A or Option B? Let me know which you prefer" as plain text.
- Each choice needs a `name`/`id` so its state is readable programmatically.
- Default-select the recommended option when there is one; don't leave every choice blank.

## Custom interactive elements

- Any custom clickable control that isn't a native form element (a card, a toggle chip, a rating pill) must carry `data-arev-action="<name>"` so the review tool can wire it up as a feedback control.
- Keep the action name short and specific to what it does (`data-arev-action="approve-phase-2"`, not `data-arev-action="click"`).
- Give it a visible focus state and `tabindex="0"` if it's not already focusable - keyboard users and the review tool both need to reach it.

## Mermaid diagrams

- Put diagrams in `<pre class="mermaid">...</pre>` blocks, not `<div class="mermaid">` - `pre` preserves whitespace mermaid needs and avoids a common render bug.
- Keep node labels short: 2-5 words. Long labels wrap badly and blow out node boxes.
- Max 3-4 branches fanning out of any single node. If a node needs more, group into a sub-step or split into a second diagram.
- One idea per diagram. Don't cram a whole system into one graph.

## General hygiene

- No lorem ipsum, no placeholder text left in a shipped artifact.
- No auto-playing audio/video, no unsolicited alerts/confirms.
- Keep JS defensive - a thrown error in an inline `<script>` shouldn't blank the whole page. Wrap risky logic in try/catch.
- Print styles aren't required unless asked, but don't fight `overflow-x: auto` with `overflow: hidden` on print.
