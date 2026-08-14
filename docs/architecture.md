# Architecture notes

This document collects implementation details that are useful to maintainers,
performance investigators, and integrations but are not required for a first
review.

## Local session storage

Each artifact session uses a private normalized SQLite store with transactional
updates, legacy JSON migration, corruption quarantine, and bounded history.
The browser initially receives the newest 50 activity entries, loads older
entries on demand, and follows subsequent changes through compact revision
deltas.

Identical diagram scenes and previews reuse SHA-256-addressed blobs. Submitted
diagram feedback receives an immutable scene and PNG snapshot, while working
autosaves remain separate from delivered feedback.

`arev archive` writes a consistent database snapshot, versioned report, and
referenced blobs to a ZIP without copying the source artifact. `arev prune`
refuses symlinks or escaped paths and cleans unreferenced content-addressed
blobs when eligible sessions are removed.

## Browser runtime efficiency

Review assets are loaded once into the server's byte cache. Internal SDK,
whiteboard frame, stylesheet, and module URLs carry SHA-256 content versions.
Matching URLs are immutable, gzip-compressed when useful, and support ETag
revalidation. Dynamic controller and state responses remain `no-store`.

The build embeds Excalidraw's compact fonts and relies on the browser's
installed CJK fallback instead of bundling Xiaolai's 12 MB shard set. This
keeps the complete installable skill below 10 MB without making font network
requests.

The reproducible benchmark in `skill-efficiency-audit/bench.sh` records skill
and context bytes, CLI event bytes, local readiness time, browser requests, and
whiteboard transfer size. On the recorded 2026-08-02 run, the controller
reached the diagram-ready state with zero whiteboard runtime requests. Opening
one diagram created one editor frame and transferred the hashed runtime with
gzip.

Wall-clock results are environment-specific. Use request, frame, and byte
invariants for regressions instead of treating one machine's latency as a
universal target.

## Delivery and latency

The browser states are defined in the [User guide](user-guide.md#understand-review-states).
Their timestamps separate local transport from agent work:

- **Persistence transport** ends at `sent_at`.
- **Pickup latency** is `delivered_at - sent_at`.
- **Agent turnaround** is `answered_at - delivered_at`, or the subsequent
  artifact reload when measuring the visible edit.
- **End-to-end feedback time** is `answered_at - sent_at`.

`Sent` can be nearly immediate while `Received` waits for an active foreground
poll. A fast `Received` does not imply an instant `Answered`: model scheduling,
reasoning, tool calls, and file edits happen after transport has finished.
Measure these phases separately when investigating performance.

## Diagram isolation

The large Excalidraw and Mermaid runtime is requested only when a reviewer
opens a diagram. One sandboxed editor frame moves between diagram hosts rather
than mounting a copy for every diagram.

Working scenes store the normalized Mermaid source hash. When source changes,
Artifact Review requires an explicit re-convert-or-keep decision instead of
silently merging or discarding work. Flowchart, sequence, class, ER, and state
diagrams use the exactly pinned Mermaid conversion runtime in `package.json`;
other valid types use image annotation.

When an artifact already contains rendered Mermaid SVG, delivered element
feedback can include a constrained `mermaid-node` target with the diagram ID,
node ID, label, and selector.

## Security boundary

The artifact runs in a sandboxed opaque-origin iframe and does not receive the
session token. Inline whiteboards run in nested opaque-origin frames and use a
typed message channel to ask the authenticated controller to persist state.

These layers narrow access but do not make hostile HTML safe. See
[SECURITY.md](../SECURITY.md) for the authoritative threat model.
