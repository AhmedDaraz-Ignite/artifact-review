# Artifact Review events

## Feedback

A feedback event is one review turn. Apply every item in its `items` array
together, then save the authoritative artifact before replying.

1. Read the whole batch.
2. For repeated controls with the same selector, use the newest value.
3. Edit the source HTML or Mermaid; never edit generated review-state files.
4. Save and let the existing browser session reload.
5. Run `"$AREV" reply "$ARTIFACT" "Applied the requested changes."`.
6. Resume the foreground poll.

Item kinds include `chat`, `text`, `element`, `control`, `whiteboard`, and
`text-edit`. Text items carry selected text plus prefix/suffix and selector
anchors. Element items carry a durable selector and may carry a normalized
`target`.

A `text-edit` item is the reviewer rewriting or cutting the artifact's own
words. `action` is `edit` or `cut`, `label` names the line, and `before` and
`after` are the short pair the reviewer saw. `blocks` is the authoritative
payload: one `before`/`after` pair per block, holding that block's whole text.
An `after` of `""` means the line goes.

An event whose `applied` field is `true` reports edits the reviewer already
saved into the artifact. The file on disk already carries them, so confirm and
carry on rather than making the same change twice. Everything else in the event
still needs doing. Without `applied`, nothing was written and every `text-edit`
is a change to make.

A `mermaid-node` target identifies the exact node through `diagramId`,
`nodeId`, `label`, and `selector`; change that node in Mermaid source rather
than treating the SVG or entire diagram as the target.

For `whiteboard`, read the reviewer `note` and the auto-generated
`summary_lines` first: each line names one element-level edit ("Added arrow
from rectangle "API" to rectangle "Cache""), so most diagram feedback needs no
further inspection. Inspect `scene_path` when needed; inspect `png_path` only
if the structured data remains ambiguous. The scene and PNG are immutable
evidence, not replacement source.

`layout_warnings` contains only severe findings not sent earlier in this
session. An empty list means no new warnings, not necessarily a clean page. A
warning that returns after an edit was not fixed.

## Layout

A layout event is generated without waiting for human feedback when the open
browser proves a severe integrity problem. Fix every finding in the event,
save the artifact, and keep polling while the browser re-audits it. Do not ask
the user to review through a blocking curtain.

Warnings include a kind, selector, severity, and geometry/evidence fields, and
a `viewportClass` (`mobile`, `compact`, or `desktop`) naming the viewport the
failure was proven in; the audit runs at phone and tablet widths as well as
desktop. Fix a `mobile` finding with responsive layout (a scroll container,
`max-width:100%`), not by testing only on a wide screen. Use the evidence
rather than guessing from the label. Minor findings remain visible in the
browser but do not block the agent loop.

## Ended and idle

`ended` stops the loop. Respect who ended it and follow the reopen rule in
`runtime.md`. `idle` means the wait budget expired; it never means feedback was
lost, because unacknowledged events remain durable.
