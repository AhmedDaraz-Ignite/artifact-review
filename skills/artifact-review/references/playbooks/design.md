use_when: writing any HTML artifact, before first line of code, general artifact design

## Start from the shell

- Run `arev new <path>` and fill the region between `<!-- arev:content -->` and `<!-- /arev:content -->`.
- The shell already handles both color schemes, the reading column, the type scale, and horizontal overflow. Do not rewrite that CSS, and never hardcode a color that bypasses the `--fg` / `--bg` / `--border` / `--accent` / `--muted` variables.
- Wide content - tables, code blocks, diagrams - goes inside `<div class="scroll">`. The page itself must never scroll sideways.
- Add new CSS only for something the shell has no class for.

## Stay self-contained

- One file. No CDN scripts, fonts, or stylesheets for core content, and no external images. Offline and firewalled reviewers must still see it render.
- Exception: mermaid.js may load from a CDN with a local fallback message. Diagrams degrade to a code block and the rest of the page still works.

## Semantic HTML

- Use real `<button>`, `<input>`, `<label>`, `<select>` - never `<div onclick>`. The review tool captures interactions by querying real interactive elements, so divs-as-buttons are invisible to it.
- Every input has a bound `<label>` via `for`/`id` or wrapping. No placeholder-as-label.
- Use `<table>` for tabular data. Screen readers and the review tool both expect it.

## Human decisions go in controls, not prose

- If the artifact asks the human to choose, render a radio group or checkbox list. Never "Option A or B? Let me know which you prefer" as plain text.
- Each choice needs a `name`/`id` so its state is readable programmatically.
- Default-select the recommended option when there is one. Do not leave every choice blank.
- Any custom clickable control that is not a native form element must carry `data-arev-action="<specific-name>"` and be keyboard reachable.

## Mermaid diagrams

- Put diagrams in `<pre class="mermaid" id="stable-id">...</pre>`, not `<div>`. `pre` preserves the whitespace mermaid needs.
- Keep node labels to 2-5 words and fan out at most 3-4 branches from any node.
- One idea per diagram. Do not cram a whole system into one graph.

## General hygiene

- No lorem ipsum or placeholder text left in a shipped artifact.
- No auto-playing media, no unsolicited alerts or confirms.
- Keep JS defensive. A thrown error in an inline `<script>` must not blank the page.
