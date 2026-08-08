# Lavish-parity diagram quality implementation

Date: 2026-08-03. Branch: `lavish-diagram-quality`. Implements all 8 findings
from the comparison in `docs/lavish-diagram-comparison/implementation_notes.md`
(arev vs github.com/kunchenguid/lavish-axi).

## What was built

1. **Theme-matched Mermaid rendering** (`tooling/mermaid-entry.mjs` rewrite).
   Page darkness comes from the actually rendered background: a 1x1 canvas
   normalizes any color syntax (oklch included), body composites over root,
   luminance decides. Re-renders every arev-owned block on theme changes
   (MutationObserver on html/body data-theme/class/style, matchMedia,
   change events, background-color transitionend). Blocks the artifact
   rendered itself are never touched. Dispatches `arev:mermaid-rendered` so
   the SDK re-attaches behavior.
2. **Palette-derived themeVariables** (same file). Mermaid theme `base` with
   variables mixed from page background toward page text color (surfaces 8%,
   borders 35%, lines 55%, edge-label chips 5%), page font family, page
   background. Goes further than Lavish, which only picks stock dark/default.
   `edgeLabelBackground` is set explicitly because Mermaid does not derive it
   and dark pages got black chips (found in headed verification).
3. **Stable node anchors** (`sdk.js`). Every rendered Mermaid node gets
   `data-arev-node-key`: `data-id`, else DOM id minus the svg-id prefix and
   the per-render counter. Targets and selectors
   (`#holder [data-arev-node-key="..."]`) survive theme re-renders. Bare
   author-rendered SVGs are tagged too (`allMermaidSvgs` filters every svg
   through `mermaidSvgFor`).
4. **Explore mode** (`sdk.js`). Dependency-free viewBox pan/zoom per Mermaid
   SVG: wheel zoom at cursor (bounds initial/40 to initial*8), drag pan with
   pointer capture, double-click reset. Frozen while annotate mode is on.
5. **Auto whiteboard edit summaries** (`tooling/whiteboard-entry.mjs`,
   `chrome.html`). Ported and adapted Lavish's `summarizeSceneEdits`:
   baseline-vs-edited diff on stable ids, bound labels fold into containers,
   arrow lines name their endpoints. The typed summary became an optional
   note; items now carry `summary` (note or stats fallback), `note`, and
   `summary_lines`. The old `sceneStats` was deleted, stats come from the
   diff.
6. **Scene link sanitization** (`whiteboard-entry.mjs`). After conversion,
   element links keep only http(s)/mailto, dropping hostile Mermaid `click`
   directives (javascript:, data:, file:, relative).
7. **Multi-viewport layout audit** (`chrome.html`, `sdk.js`). Behind the boot
   curtain the chrome narrows the artifact iframe to 360px and 800px, asks the
   SDK to re-run `__arevAudit` per width, tags findings with `viewportClass`
   plus a "[Mobile 360px]" evidence prefix, dedups by
   kind|selector|axis|class, and feeds the existing gate and layout-event
   pipeline. A phone-only overflow blocks review and reaches the agent with
   no human action.
8. **Playbooks, docs, static check**. `diagram.md`/`design.md`: hybrid
   overview-plus-detail-cards shape, topology vs detail, top-down default,
   quoted punctuated labels, never hardcode a Mermaid theme, phone-width gate
   warning. `runtime.md`/`events.md`/`SKILL.md` document the new behavior.
   `checks.py` gained `diagram-hardcoded-theme` (error when an init directive
   sets a theme, warn for any other init directive).

## Corrections found during verification

- Mermaid 11 bakes the svg render id (which carries my generation counter)
  into node DOM ids, so the first stable-key attempt still changed per
  render. Fixed by stripping the svg-id prefix before the counter.
- Headed screenshots showed dark-mode edge labels as black chips and the
  inline "Open diagram editor" cards as hardcoded white glare. Fixed with
  `edgeLabelBackground` and theme-neutral translucent CSS for the board host
  and unlock overlay. Headless assertions alone would not have caught either.
- The annotate-freeze test raced the chrome-to-iframe postMessage. The drive
  now waits for the frozen cursor state before dispatching wheel events.

## Verification

- New drives: `tests/selftest-diagram-quality.mjs` (17 checks: theme flip,
  palette typography, stable keys across re-render, pan/zoom/reset/freeze,
  summary diff wording and counts, link sanitization unit and end-to-end,
  note-free queue item) with `tests/fixtures/themed.html`, and
  `tests/selftest-viewport-audit.mjs` (7 checks) with
  `tests/fixtures/viewport-overflow.html`. Both wired into `tests/run.sh`.
- `python3 tests/test_checks.py`: 36 tests OK (3 new for the theme check).
- Full suite `bash tests/run.sh`: SELFTEST: PASS (all 16 groups) after the
  final rebuild.
- Headed browser verification with screenshots (light, dark, zoomed) in the
  session scratchpad; dark mode re-checked after the two visual fixes.

## Alternatives rejected

- svg-pan-zoom library for explore mode: the 90-line viewBox implementation
  covers wheel/drag/reset and keeps the runtime dependency-free.
- Lavish's full layout-warning inbox (durable statuses, queue-to-fix UI):
  arev already delivers proven findings to the agent through the audit gate
  and layout events, so only the multi-viewport passes and viewport tagging
  were missing. The inbox would duplicate the existing feedback queue.
- Re-rendering author-rendered Mermaid blocks on theme flips: their ids and
  markup belong to the artifact, and re-rendering could break author scripts.
  Only arev-rendered blocks re-render.
