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

Item kinds include `chat`, `text`, `element`, `control`, and `whiteboard`.
Text items carry selected text plus prefix/suffix and selector anchors. Element
items carry a durable selector and may carry a normalized `target`.

A `mermaid-node` target identifies the exact node through `diagramId`,
`nodeId`, `label`, and `selector`; change that node in Mermaid source rather
than treating the SVG or entire diagram as the target.

For `whiteboard`, read the summary and stats first. Inspect `scene_path` when
needed; inspect `png_path` only if the structured data remains ambiguous. The
scene and PNG are immutable evidence, not replacement source.

`layout_warnings` contains only severe findings not sent earlier in this
session. An empty list means no new warnings, not necessarily a clean page. A
warning that returns after an edit was not fixed.

## Layout

A layout event is generated without waiting for human feedback when the open
browser proves a severe integrity problem. Fix every finding in the event,
save the artifact, and keep polling while the browser re-audits it. Do not ask
the user to review through a blocking curtain.

Warnings include a kind, selector, severity, and geometry/evidence fields. Use
the evidence rather than guessing from the label. Minor findings remain
visible in the browser but do not block the agent loop.

## Ended and idle

`ended` stops the loop. Respect who ended it and follow the reopen rule in
`runtime.md`. `idle` means the wait budget expired; it never means feedback was
lost, because unacknowledged events remain durable.
