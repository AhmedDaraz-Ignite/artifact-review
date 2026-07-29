use_when: code review artifact, diff review, before/after code comparison, showing a patch, annotated code walkthrough

## Blocks

- Monospace font stack (`ui-monospace, "SF Mono", Consolas, monospace`), no syntax-highlighting library dependency - use flat, syntax-neutral styling (one background, one text color, maybe a muted color for comments) so it works without a CDN and stays readable in both themes.
- Every code block sits inside its own `overflow-x: auto` container. Do not wrap long lines - wrapping breaks indentation and makes diffs unreadable. Let it scroll.
- Preserve exact whitespace: use `<pre><code>...</code></pre>`, never let HTML collapse indentation.

## Before / after

- Two-column side-by-side layout for before/after on wide viewports (grid or flex, equal width), stacked vertically below ~700px.
- Label each pane clearly ("Before" / "After"), not just left/right position - position alone doesn't survive a screen reader or a narrow viewport.
- Keep line numbers if the source has them; align them so the human can cross-reference before/after at a glance.

## Line anchors

- Give every code line a stable `id` (e.g. `id="L42"` or `id="before-L42"`/`id="after-L42"`) so the human can annotate or reference a specific line.
- If the artifact supports inline comments/annotations, anchor them to that line's `id`, not to an approximate paragraph position.
- Keep the anchor scheme consistent across every code block in the artifact (same prefix pattern) so annotations don't collide between panes.

## Diff styling

- Added lines: subtle green-tinted background. Removed lines: subtle red-tinted background. Keep both muted enough to stay readable in dark mode too - test the tint isn't neon.
- Don't rely on color alone to signal added/removed - prefix with `+`/`-` characters as well, for colorblind readers and for when the artifact is printed or copy-pasted.

## What to avoid

- Don't pull in a full syntax-highlighting JS library from a CDN just for color - flat monospace with diff tinting reads perfectly well and doesn't depend on an external file loading.
- Don't truncate long lines with `...` - show them in full inside the scrollable container.
- Don't put code inside a table cell without its own `overflow-x: auto` - the table's overflow rule doesn't cascade to protect the page from one very long line.
