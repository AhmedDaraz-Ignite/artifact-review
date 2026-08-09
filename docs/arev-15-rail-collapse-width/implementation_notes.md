# Collapsing the review rail gives the artifact no extra width

Issue: https://github.com/AhmedDaraz-Ignite/artifact-review/issues/15

## Root cause

The scaffold set a flat reading width:

```css
main { max-width: 880px; margin: 0 auto; padding: 40px 20px 80px; }
```

`.stage` is `flex: 1` and `#art` is `width: 100%`, so the iframe already grows by the full 296px the
rail gives up. The artifact document simply ignored the extra room and centred an 880px column in
it, turning every freed pixel into margin.

## The fix

Three rules in `skills/artifact-review/assets/artifact-template.html`:

```css
/* The column follows the window, so collapsing the review rail hands the freed space to
   diagrams, tables and code instead of the margins. Below 1200px nothing changes. */
main { max-width: clamp(880px, 100% - 320px, 1400px); margin: 0 auto; padding: 40px 20px 80px; }
/* 840px is the old fixed column minus its padding. Text keeps that measure, so a wider
   window never makes the lines hard to read. */
main > * { max-width: 840px; }
/* Wide content, and any box holding it, takes the whole column instead. Without this a
   table inside a note or a list keeps the scrollbar this width is meant to remove.
   Headings and the footer join them so their rules span the section, not the prose. */
main > :is(h1, h2, h3, footer, .scroll, pre, table, .cards, svg, img),
main > :has(.scroll, pre, table, .cards, svg, img) { max-width: none; }
```

Plus one word in `sdk.js`, covered under "The diagram editor board" below.

Measured on a scaffolded artifact at a 1636px viewport, matching the numbers in the issue:

| Rail state | Stage width | Rail width | Artifact column before | Artifact column after |
| --- | --- | --- | --- | --- |
| Expanded | 1276 | 360 | 880 | 956 |
| Collapsed | 1572 | 64 | 880 | 1252 |

All 296px now reach the content. The table in the demo artifact lost its horizontal scrollbar.

### Why the artifact's own CSS, and not a message from the chrome

The artifact is served into `<iframe sandbox="allow-scripts allow-modals">` with no
`allow-same-origin` (`chrome.html:619`), so the review chrome cannot reach into that document to set
a width. A channel does exist that could carry one: `chrome.html` already posts `{arev:true, type}`
messages the SDK listens for at `sdk.js:765`, and `server.py:874` injects `sdk.js` into every served
artifact, so an SDK-side width would even reach artifacts already on disk.

Rejected anyway. `server.py:876` states the invariant: "The disk file is untouched, so the artifact
opened directly stays identical." A width injected only during review would let a reviewer approve a
layout that `arev export` does not reproduce. And none of it is needed, because the iframe's own
viewport is what changes, so a percentage in the artifact's stylesheet already sees the new width.
Zero JavaScript, zero protocol.

### Why `clamp(880px, 100% - 320px, 1400px)`

- The lower bound is today's value, so every viewport under 1200px renders exactly as before. The
  boot audit's mobile pass at 360px cannot regress.
- `100%` resolves against `body`, which excludes the vertical scrollbar. `100vw` includes it and
  would have risked a hairline of sideways scroll that the layout gate checks for.
- `- 320px` keeps 160px of breathing room on each side, so the page never runs edge to edge.
- The 1400px cap stops the column stretching on a very large monitor, where the eye would have to
  travel the whole width to follow a table row.

### Why a deny-list, after a first attempt at an allow-list

The first version capped a list of prose tags and then carved an exception out of it:

```css
p, ul, ol, .note, fieldset { max-width: 840px; }
:is(.note, fieldset):has(.scroll, pre, table) { max-width: none; }
```

Two hand-maintained lists that both turned out to be incomplete. Measured at 1572px:

| Case | Allow-list | Deny-list |
| --- | --- | --- |
| `.scroll` holding a table, at top level | 1212 | 1212 |
| the same `.scroll` inside an `<li>` | 818, still scrolling | 1190 |
| `.note` holding a table | 1212 | 1212 |
| `.note` holding an `svg` diagram | 840, still scrolling | 1212 |
| `blockquote` | 1132, too wide to read | 840 |

The nested `.scroll` at 818px is the reported bug surviving one level down, which is the reason this
was reworked rather than left as polish. `main > *` plus one escape list covers every element an
author can write, including classes the shell has never heard of, and there is one list to keep in
sync instead of two.

### Why headings and the footer span the column

They were capped at 840px in the first deny-list version. That put `h2`'s `border-bottom` at 840px
above a code block running to 1212px, so the section rule read as truncated. A heading rule is a
section divider, not running text, so it spans what the section holds. `footer`'s `border-top` is
the same case.

### Why not break wide blocks out of a narrow column

The other shape was to leave `main` at 880px and pull `.scroll`, `pre` and `.cards` outside it with
`width: min(100vw - 48px, 1600px); margin-left: calc(50% - …)`. The inline diagram editor mounts its
board as a sibling of the diagram (`sdk.js:702`), so a broken-out `pre.mermaid` would sit above a
board still at the old width. Making the board follow would mean overriding `.arev-inline-board`,
`.arev-inline-active` and `.arev-inline-fullscreen`, the last of which positions itself with
`inset: 12px` and would be pushed off-centre by any inherited `margin-left`.

### The diagram editor board

Widening `main` avoids that, but `main > *` would still have capped the board, which is a `<section>`
holding only a button. Rather than teach the template about review chrome, the SDK now defends its
own element:

```js
".arev-inline-board{position:relative;width:100%;max-width:none;…}"
```

That also protects the board inside a hand-written artifact whose CSS caps widths, which the template
could never have done. Measured: board 1212px, diagram above it 1212px.

### What this does not fix

Every artifact already on disk carries its own frozen copy of the scaffold stylesheet. There is no
`arev` command that re-applies the shell, and `export.py:67` inlines whatever CSS the artifact
already carries, so only artifacts created by `arev new` after this change get the new behaviour.
This matches how issue #16 was handled in commit `8608e54`.

## Test

`tests/features/layout.feature`:

```gherkin
  Scenario: Collapsing the rail hands the freed width to the artifact
    Given a scaffolded artifact
    And the reviewer has the review session open
    When the viewport is a wide desktop
    Then the artifact column is 956px wide
    When the reviewer collapses the review panel
    Then the artifact column is 1252px wide
    And the artifact prose is 840px wide
```

The `Background` was removed so this scenario can open a scaffolded artifact while the other two keep
their clean fixture. `clean.html` has no `<main>`, so it could not carry the assertion.

Supporting changes:

- `tests/support/review-ui.js` gains `ReviewRail.artifactWidth(selector)`, which measures through the
  `frameLocator` because the frame is cross-origin.
- `tests/steps/layout.steps.js` gains a `wide desktop` viewport at 1636px. The default 1440px desktop
  leaves the expanded stage at 1080px, under the clamp's 1200px threshold, so the column would sit on
  its 880px floor and prove nothing.
- The viewport step now asserts it got the size it set. A headed browser silently clamps a viewport
  wider than the screen, which would fail the width scenario with a number that blames the CSS. This
  does add a new failure mode to the two older scenarios under `--headed` on a small screen, which is
  the honest outcome: a step named "the viewport is a desktop" that quietly got 1280 is lying.
- The assertion polls. `ReviewRail.settle()` only awaits animations on `#reviewRail`, and the
  cross-process iframe relayouts a frame later.

An earlier version asserted the 296px delta and stored `expandedColumn` on the page object from
inside `collapse()`. That ran a cross-frame measurement in all 10 collapse scenarios to serve one,
and re-asserted the 360 to 64 dock width that `review-panel.feature:19` already owns. Two absolute
widths need no stored state and read like the table in the issue.

## Propagation

`references/playbooks/design.md` said the shell owns "the reading column", singular. It now owns two
widths and a rule about which elements break out of the inner one, so that line gained a sentence.
This also moves the fingerprint in `arev.py:661` `_guidance_version()`, which hashes the reference
docs but not the template, so running sessions are told the guidance changed.

## Verification

- Scenario run against the unfixed template first: fails, column never moves off 880px. Then with
  the fix: passes.
- `npm run build` clean, `npm test` 5/5 suites pass, `npx playwright test` 68/68 pass, re-run after
  every rework.
- Measured every element class on a demo artifact at 1636px, rail collapsed: `main` 1252, `h1`/`h2`
  1212, `p`/`blockquote`/plain `.note` 840, diagram 1212, editor board 1212, top-level `.scroll`
  1212, `.scroll` nested in an `<li>` 1190, `.cards` 1212, `fieldset` holding a table 1212, page
  horizontal overflow 0.
- Screenshots in both rail states of an artifact holding a sequence diagram, a wide table, a code
  block, a card pair, two notes, two fieldsets, a nested table in a list, a blockquote and a footer.
