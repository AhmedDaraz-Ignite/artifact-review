use_when: writing any HTML artifact, before first line of code, general artifact design

## Start from the shell

- Run `arev new <path>` and fill the region between `<!-- arev:content -->` and `<!-- /arev:content -->`.
- The shell already handles both color schemes, the reading column, the type scale, and horizontal overflow. Do not rewrite that CSS, and never hardcode a color that bypasses the `--fg` / `--bg` / `--border` / `--accent` / `--muted` variables.
- The reading column tracks the window width. Text sits at a fixed measure inside it, and anything holding a `.scroll`, `pre`, `table`, `.cards`, `svg` or `img` widens to the whole column. So a wide block in a plain `<div>` of your own gets the measure, not the column. Put it in one of those, or wrap it in `<div class="scroll">`.
- Wide content - tables, code blocks, diagrams - goes inside `<div class="scroll">`. The page itself must never scroll sideways. The review gate proves this at phone (360px) and tablet (800px) widths as well as desktop, so a fixed-width element with no scroll container blocks the review even when it looks fine on your screen.
- Add new CSS only for something the shell has no class for.

## Stay self-contained

- One file. No CDN scripts, fonts, or stylesheets, and no external images. Offline and firewalled reviewers must still see it render.
- Diagrams need no script at all: the review server renders every `<pre class="mermaid">` block offline with its own bundled Mermaid. Do not add a CDN loader for Mermaid; outside a review session the block degrades to readable source text.

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

- Every diagram is a `<pre class="mermaid" id="stable-id">...</pre>` block. `pre` preserves the whitespace mermaid needs.
- Never build a diagram out of styled divs, flex rows, and arrow characters. The review tool attaches its editable Excalidraw whiteboard only to Mermaid blocks - a hand-built box diagram renders flat, cannot be opened as shapes, and the reviewer cannot annotate its nodes.
- Never set a Mermaid theme or `%%init%%` colors. The renderer derives the diagram palette from the page's `--fg`/`--bg` variables at render time and re-renders when the viewer flips the theme, so hardcoded diagram colors only ever clash.
- Keep node labels to 2-5 words and fan out at most 3-4 branches from any node.
- One idea per diagram. Do not cram a whole system into one graph - give each subsystem, flow, or state machine its own diagram instead of dropping it. For a large system, pair one small Mermaid topology overview with HTML detail cards per module (the hybrid shape in the diagram playbook).

## Match the weight of the source

- When the artifact explains, reviews, or walks through a source document, its coverage must scale with that source. A 2,000-line spec is not served by a one-screen summary: every major section of the source gets its own section, diagram, or table in the artifact.
- Diagram every state machine, lifecycle, and multi-actor flow the source defines. A reviewer should be able to point at any subsystem in the artifact, not just the top-level picture.
- Use `<details><summary>` for depth that would crowd the page: full schemas, per-release deliverables, long command tables. Collapsed depth is coverage; omitted depth is not.
- Run `arev check FILE` before opening the artifact and after every edit. It lists the source sections nothing in the artifact mentions and the states, flows, and lifecycles nothing draws. Fix them, or drop a section on purpose with `--ignore "Section title"` and say in the artifact that you did.

## General hygiene

- No lorem ipsum or placeholder text left in a shipped artifact.
- No auto-playing media, no unsolicited alerts or confirms.
- Keep JS defensive. A thrown error in an inline `<script>` must not blank the page.
