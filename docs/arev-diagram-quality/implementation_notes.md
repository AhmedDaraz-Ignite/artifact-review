# Broken diagrams and shallow design artifacts

Date: 2026-08-02. Trigger: reviewing the CrewBoss platform spec through arev produced
flat box diagrams that never opened in Excalidraw, and a 343-line artifact for a
1,918-line spec.

## Root causes found

1. **Guidance steered agents away from Mermaid.** `design.md` said "No CDN scripts"
   and framed Mermaid as a degradable CDN exception. An agent optimizing for
   self-containment built diagrams from styled divs and arrow characters
   (`spec-explainer.html`, comment in its CSS said exactly that). The whiteboard
   attaches only to `pre.mermaid` blocks, so those diagrams could not open in
   Excalidraw at all. Live reviewer feedback confirmed it: "Where is the full
   diagram in Excalidraw?"
2. **The artifact page had no offline Mermaid renderer.** The runtime bundles
   Mermaid 11.16.0 inside whiteboard.js for the editor, but the reviewed page
   itself needed a CDN import to render diagrams. Offline or blocked, the reviewer
   saw raw Mermaid text.
3. **mermaid-to-excalidraw 2.2.2 lookups miss the Mermaid 11 id prefix.** Mermaid
   11 renders DOM ids as `<svgId>-<id>`. The converter queried the id alone, threw,
   and fell back to a flat image for: flowcharts with `subgraph`, all state
   diagrams (nodes and edges), and all class diagrams. `plan-review.html`'s
   `cb-job-state` and `cb-run-state` are state diagrams, so "not expanding in
   Excalidraw" reproduced even with correct Mermaid markup. Proved empirically by
   dumping rendered cluster ids (`arev-page-mermaid-0-S` vs queried `S`).
4. **No coverage rule for explaining a source document.** Playbooks capped
   diagrams ("max 2-4 total") and gave only form rules, so a huge spec became a
   one-screen skim.

## Fixes applied

- New `tooling/mermaid-entry.mjs` built to `assets/review-ui/mermaid.js` (3.5MB,
  same pinned mermaid 11.16.0). Served tokenless at `/mermaid.js`. `sdk.js` imports
  it at boot when any Mermaid block is still unrendered, marks blocks
  `data-processed` first so a CDN copy loaded by old artifacts skips them.
- `build-whiteboard.mjs`: new `mermaid11IdPrefixCompatibility` esbuild plugin
  patches four converter lookups (flowchart subgraph, state node resolver, state
  edge, class findByPrefix regex) with svg-id-prefixed fallbacks, mirroring the
  existing ER patch. Build fails if a patch target count changes.
- Playbooks rewritten: diagrams are always `pre.mermaid`, never div boxes, never a
  CDN loader; per-section diagram cap instead of a global one; new "Match the
  weight of the source" section in `design.md` requiring coverage to scale with
  the source document. `SKILL.md` and `runtime.md` updated to match.
- `arev doctor` now checks `offline_mermaid`.

## Alternatives rejected

- Baking rendered SVG into the artifact at export time only: does not fix the live
  review page, and keeps the CDN dependency during review.
- Auto-re-converting saved image-fallback scenes after the engine fix: reviewer
  drawings live on those scenes, silently replacing them loses data. A stale scene
  re-converts only through the existing hash-mismatch choice.

## Verification

- TDD: added the offline page-render assertion first and watched it fail, then
  implemented. Added a native-conversion regression check (subgraph, state, class)
  to `selftest-diagram-features.mjs`.
- Full suite `tests/run.sh`: SELFTEST: PASS (all drives, twice after changes).
- Headed browser run on a scratch copy of the CrewBoss diagrams with zero script
  tags: 3 SVGs rendered offline, zero external requests, isolation subgraph
  diagram opened as "Flowchart · Editable shapes" (was "Image annotation
  fallback"). Screenshots in the session scratchpad.
- Conversion counts before -> after: isolation 1 image -> 24 native elements,
  state 1 -> 10, class 1 -> 11, nested state 1 -> 8.

## Operational notes

- Running review servers keep old assets in memory. The live CrewBoss session on
  port 65214 must be stopped and reopened to pick up the new runtime.
- A diagram whose editor was opened before the fix keeps its autosaved image
  scene while the source hash is unchanged. Any source edit triggers the normal
  re-convert choice.
