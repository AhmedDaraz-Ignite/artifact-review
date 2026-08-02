# Review workspace foundation

Date: 2026-08-02
Status: user-approved design, pending written-spec review

## Objective

Begin the full Artifact Review improvement program with a reliable workspace
foundation. This slice adds a collapsible review pane that always stays on the
right, and fixes the session, process, polling, and reload defects that would
otherwise make the improved workspace unreliable.

This is the first of several implementation slices. The remaining findings are
preserved in the program roadmap at the end of this document.

## Scope

This slice includes:

- a persistent expanded/collapsed state for the right-side review pane;
- a Chrome-style 64px collapsed icon dock with accessible section controls and
  review counts;
- a docked desktop pane and a right-side overlay drawer on narrow screens;
- a real server-side reopen operation for live ended sessions;
- IPv4- and IPv6-correct control and browser URLs;
- registry updates that are safe across concurrent CLI processes;
- authenticated server health and shutdown instead of trusting PID liveness;
- listening heartbeats during long agent polls; and
- coalesced artifact reloads that cannot lose a rapid second save.

It does not yet include lazy whiteboard loading, state-store replacement,
artifact asset serving, export rewriting, annotation upgrades, or the expanded
browser matrix. Those are explicit later slices, not omitted requirements.

## Workspace interaction design

### Desktop and tablet

The workspace remains a horizontal layout. The artifact stage occupies all
remaining width and the review pane remains on the right.

- Expanded pane width: the existing 360px.
- Collapsed pane width: 64px, leaving room for 44px controls plus 10px side
  spacing in the same proportions as Chrome's collapsed side panel.
- The stage flexes immediately into the released 296px.
- A persistent icon dock stays visible on the far right in both states. In the
  expanded state, the full review content opens immediately to its left, just
  as Chrome's side panel opens beside its icon rail.
- The dock stacks an expand/collapse control, Draft feedback, Activity, and New
  feedback controls. A divider separates navigation from the compose action.
- The selected section uses a quiet filled square treatment matching the
  reference behavior; hover and keyboard focus never rely on color alone.
- Draft and unread activity counts appear as compact badges without changing
  button geometry.
- Activating a section control expands the pane, scrolls its existing section
  into view, and moves focus to the section heading or composer as appropriate.
- The toggle exposes `aria-controls="reviewRail"` and an accurate
  `aria-expanded` value.
- The collapsed body is inert and hidden from the accessibility tree, but its
  DOM is not destroyed. Drafts, typed text, scroll positions, and delivery
  state survive collapse and expansion.
- The preference is stored in local storage under a versioned Artifact Review
  key and is restored before the first meaningful paint to avoid a width flash.
- The pane never changes sides.

No automatic collapse occurs when a diagram enters fullscreen. The reviewer
controls the workspace and can expand the pane without losing diagram work.

### Narrow screens

At widths at or below the current 780px breakpoint, the stage remains full
height and the review pane becomes a right-side overlay drawer. The drawer is
360px wide or the available viewport width minus the 64px dock, whichever is
smaller.

The collapsed 64px dock remains attached to the right edge. Expanding overlays
the artifact rather than squeezing it into an unusably narrow column. A subtle
scrim closes the drawer when activated, while the explicit toggle remains the
primary control. Focus stays inside the drawer only when a keyboard user enters
it; closing returns focus to the toggle. The pane never moves below or left of
the artifact.

### Motion and failure handling

Width and transform transitions are short and use only compositor-friendly
properties where possible. `prefers-reduced-motion` disables them. Failure to
read or write local storage leaves the pane expanded and does not affect review
delivery.

## Session and process reliability

### Live reopen

The session server gains an authenticated `POST /reopen` endpoint. It clears
`ended` and `ended_by`, removes obsolete ended/layout events, resets the audit
to pending, preserves feedback history and drafts, persists the new state, and
wakes browser and agent waiters.

`arev open FILE --reopen` calls this endpoint when the registered server is
healthy. A successful command must leave `/state` writable, not merely print a
URL. Reopening a live active session is idempotent. Reopening a stopped session
continues to use the existing restore path.

### Server identity and shutdown

PID existence is not treated as proof of ownership. Each registry record keeps
the authenticated control URL and a random server instance identifier returned
by `GET /health`. Reuse requires a successful health response whose identifier
matches the registry.

Stopping uses authenticated `POST /shutdown`. If health verification fails,
the CLI removes the stale registry entry but does not signal the recorded PID,
eliminating the reused-PID hazard. Startup failure may still terminate the
fresh child process because the CLI owns that `Popen` handle directly.

### Concurrent registry access

Registry read-modify-write operations execute under a cross-platform lock file:
`fcntl.flock` on POSIX and `msvcrt.locking` on Windows. The lock covers loading,
mutation, atomic replacement, and stale-entry cleanup. Read-only commands take
a shared lock where supported and otherwise use the same short exclusive lock.

The on-disk format remains compatible for this slice. A later state-store slice
may replace it after behavior is covered by tests.

### IPv4 and IPv6 URLs

Registry entries distinguish:

- `control_url`, used by the local CLI; and
- `base_url`, used by the browser or authenticated forward.

Wildcard IPv4 binds use `127.0.0.1` for control. Wildcard or loopback IPv6
binds use bracketed `[::1]`. Explicit local addresses use a valid bracketed or
unbracketed URL as appropriate. `_api` never hardcodes `127.0.0.1`.

Without `--public-url`, the printed browser URL uses the reachable control URL.
A non-root path in `--public-url` is rejected with a clear explanation until
the later transport slice adds path-prefix routing.

### Poll heartbeat

The CLI refreshes `listening` after every server-side poll chunk. Therefore a
570-second foreground poll continues to appear live under the browser's
125-second stale threshold. An error attempts a final offline status update
without masking the original failure.

## Reload correctness

Reload requests are keyed by artifact version rather than guarded by a
fixed-duration boolean. The controller keeps the newest requested version and
runs one reload at a time. If another save arrives while the iframe is loading,
the controller performs one additional reload for the newest version after the
current load settles.

One reload operation:

1. flushes diagram autosaves with the existing bounded wait;
2. captures scroll position;
3. resets audit and diagram controller state;
4. reloads the iframe;
5. waits for `load`, `error`, or a bounded timeout;
6. restores scroll and annotation mode; and
7. checks whether a newer version still needs loading.

This preserves coalescing without losing rapid atomic-save or formatter writes.

## Error behavior

- Reopen, health, shutdown, and registry errors return actionable CLI messages.
- A stale or corrupt registry record is quarantined or removed; it is never
  used to terminate a process.
- A failed drawer preference read/write is non-fatal.
- A failed iframe reload leaves the existing review chrome responsive, reports
  the failure, and accepts the next artifact version.
- Closing the mobile drawer never discards unsent composer text.

## Verification

### Browser tests

Extend the main Playwright drive to prove:

- the expanded pane is right-aligned and 360px wide;
- the collapsed dock is right-aligned and 64px wide;
- the stage gains the released width;
- drafts, composer text, activity, and scroll positions survive a round trip;
- the Draft, Activity, and New feedback icons expand and focus their sections;
- active, hover, tooltip, divider, and count-badge behavior matches the
  Chrome-style dock references without moving the pane from the right;
- `aria-expanded`, inert state, keyboard focus, and reduced motion are correct;
- the preference survives a controller reload;
- a diagram remains usable while the pane changes state; and
- at narrow width the pane overlays from the right and never moves below or
  left of the artifact.

### CLI/server tests

Add focused drives proving:

- `open --reopen` changes an ended live session back to writable;
- `::1` emits and uses a reachable bracketed IPv6 URL when IPv6 is available;
- long polls refresh their listening heartbeat;
- concurrent registry mutations preserve every session entry;
- a stale registry PID is never signalled;
- authenticated shutdown stops the matching server; and
- two rapid file versions both settle on the newest rendered content.

The full existing suite remains required.

## Program roadmap for all reviewed findings

### Slice 2: runtime and agent efficiency

- Lazy-mount one shared whiteboard editor instead of one editor per diagram.
- Add content-hashed immutable caching, ETags, compression, and server-side
  asset-byte caching.
- Reduce the always-loaded skill to a compact router with lazy references.
- Add compact `brief` and agent-event output plus browser-ready performance
  benchmarks.

### Slice 3: durable and reusable reviews

- Replace full-state rewrites with SQLite or an append-only event store.
- Return revision deltas and paginate activity.
- Add quotas, snapshot deduplication, retention, archive, prune, and automatic
  post-end shutdown.
- Add supported JSON and Markdown review reports with artifact and optional Git
  revision identity.
- Introduce a single version manifest and versioned public event schema.

### Slice 4: arbitrary artifacts and export

- Serve a path-confined local artifact asset root.
- Replace regex SDK injection with robust HTML rewriting.
- Replace regex portable export with a tested bundler that preserves module,
  style, and media semantics.
- Add strict unresolved/external-resource manifests and export regression tests.

### Slice 5: annotation, audit, compatibility, and release quality

- Generate unique durable selectors and text-position anchors.
- Add opt-in/ignore control capture and rectangular visual annotations.
- Re-audit on meaningful resize/mutation/font events and configured viewports.
- Add Firefox, WebKit, functional macOS/Windows, accessibility, concurrency,
  corrupted-state, and remote-routing coverage.
- Automate releases and expose build/protocol identity plus opt-in update
  checks.

Completion of the overall objective requires every roadmap slice to be
implemented and verified; completing this foundation alone is not completion.
