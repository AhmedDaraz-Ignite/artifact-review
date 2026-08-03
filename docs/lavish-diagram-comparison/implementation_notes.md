# Lavish vs arev: diagram handling comparison

Date: 2026-08-03. Task: user unhappy with arev diagram quality, asked how
lavish-axi (https://github.com/kunchenguid/lavish-axi) handles diagrams and
what actions close the gap. Analysis only, no code changed.

## How Lavish handles diagrams (verified in its source)

- `src/design-reference.js`: Mermaid snippet detects the actually rendered page
  background (1x1 canvas normalizes oklch/hsl/named colors, composites body over
  root, luminance test), picks Mermaid theme `dark`/`default` from that, and
  re-renders every diagram when the theme changes (MutationObserver on
  data-theme/class/style, matchMedia change, transitionend on background-color,
  document change events). Keeps original sources to re-run cleanly.
- Diagrams sit inside a full design system story: Tailwind 4 + DaisyUI 5
  reference, semantic color rules, and a strict design priority rule (user ask,
  then the subject project's own design system, then the DaisyUI fallback).
- `src/playbooks.js` diagram playbook: choose Mermaid vs CSS grid/SVG vs a
  hybrid (small overview diagram plus detail module cards) by content
  richness; separate topology from detail; top-down flow default; quote
  punctuated labels; "do not let default diagram colors clash with the page
  palette or dark mode".
- `src/layout-warnings.js`: passive browser diagnostic passes across three
  viewport classes (mobile/compact/desktop) prove layout failures (page
  horizontal overflow, clipped text/control, unreachable control/content,
  overlapping text). Findings live in a durable inbox with a conservative
  lifecycle (only positive evidence clears one) and can be queued as one
  batched fix prompt to the agent.
- `src/artifact-sdk.js`: dependency-free viewBox pan/zoom on every rendered
  Mermaid SVG (explore mode), frozen during annotate mode; hover and click
  resolve to the same `g.node` element.
- `src/mermaid-node.js`: node annotation targets anchored to Mermaid's stable
  node id plus rendered label (not a structural CSS path), so they survive
  re-renders; `<br>` in labels becomes a space instead of being dropped;
  targets normalized server-side to a fixed shape.
- `src/whiteboard-core.js` + `whiteboard-frame.js`: whiteboard feedback is
  auto-summarized per element by diffing baseline vs edited scene on stable ids
  ("Added arrow from X to Y", "Relabeled ... -> ...", "Moved by (dx, dy)"),
  sent as summary lines + stats + PNG + an optional typed note. Bound label
  text folds into its container so a rename reads as one relabel. Scene links
  from untrusted Mermaid `click` directives are sanitized to http/mailto.
- `src/mermaid-source.js`: server extracts diagram sources from the artifact
  file with HTML entity decoding, hashed for staleness checks (arev has an
  equivalent via data attributes and hashes).

## Where arev already matches

- Pinned offline Mermaid 11 rendering (better than Lavish's CDN dependency).
- Whiteboard font double-pass, duplicate id regeneration, baseline capture,
  source-hash staleness choice, PNG preview.
- Node-level annotation targets with id, label, selector.
- `arev check` authoring gates (fan-out, label length, render failure).

## Gaps in arev (ordered by user-visible impact)

1. Theme: one-shot `prefers-color-scheme` check at boot, default Mermaid theme,
   never re-renders on a page theme toggle, blind to data-theme/oklch pages.
2. No pan/zoom on rendered diagrams; large graphs are unexplorable.
3. Whiteboard feedback requires a hand-typed summary and sends only numeric
   stats; no per-element auto diff for the agent.
4. Node selector falls back to positional `g.nodes > g:nth-of-type(n)`, which a
   re-render or diagram edit invalidates.
5. Playbook bans everything but Mermaid, so rich systems get cramped into one
   auto-laid-out graph; no hybrid overview-plus-detail-cards shape, no
   palette-matching rule.
6. No browser-proven layout diagnostics (overflow/clip/overlap per viewport).
7. No sanitization of Mermaid `click` links entering whiteboard scenes.

## Action list given to the user

See the chat reply of this session; actions 1-8 mirror the gap list, with the
layout-warning system flagged as the only large build.
