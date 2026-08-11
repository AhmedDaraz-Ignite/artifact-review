# Card holding a code block scrolls the page sideways on a phone

Issue: https://github.com/arDaraz/artifact-review/issues/16

## Root cause

`.cards` is a CSS grid. A grid item starts at `min-width: auto`, which resolves to the item's
min-content size. So a `.card` refuses to shrink below the widest unbreakable thing inside it. The
`pre { overflow-x: auto }` rule in the scaffold never gets a chance to scroll, because the card is
never squeezed.

## The fix

One rule in `skills/artifact-review/assets/artifact-template.html`:

```css
/* A grid item starts at min-width:auto, so a wide child stretches its column past the
   viewport. Zero lets the card shrink and the .scroll or pre inside it do the scrolling. */
.cards > * { min-width: 0; }
```

Measured page overflow, before and after, at three viewport widths:

| Card content | Position | 360px | 800px | 1200px |
| --- | --- | --- | --- | --- |
| Code in `.scroll` | either card | 224 to 0 | 0 to 0 | 0 to 0 |
| Code in `.scroll` | both cards | 224 to 0 | 361 to 0 | 121 to 0 |
| Bare `<pre>` | both cards | 222 to 0 | 357 to 0 | 117 to 0 |
| Table in `.scroll` | both cards | 260 to 0 | 434 to 0 | 194 to 0 |
| Plain prose | any | 0 to 0 | 0 to 0 | 0 to 0 |

The rule also makes the cards equal width. Before, at 800px, the first card was 326px and the second
413px, because the wider code block stole track space from its sibling. Both are 373px now, which is
what `references/playbooks/comparison.md` asks for.

### Why `.cards > *` and not `.card`

`min-width: 0` is a property of being a grid item, not of being a card. An author will put a
`<section>` or a plain `<div>` in a `.cards` row as readily as a `.card`. Putting the rule on `.card`
would miss those, and would be inert for a standalone card in normal flow, which already shrinks.
The rule also survives the single-column rewrite in the `max-width: 600px` media query, whereas the
other one-line form, `grid-template-columns: minmax(0,1fr) minmax(0,1fr)`, would need editing in
both places.

### Why `min-width: 0` and not `minmax(0, 1fr)`

Both measured identical in Chromium at 360px, 600px, 800px and 1200px. Only `min-width: 0` directly
overrides the automatic minimum size the spec assigns to a grid item. `1fr` is a flexible max track
sizing function, so the Grid spec clamp that would cap an item's automatic minimum size inside a
fixed track does not apply. `minmax(0, 1fr)` therefore leaves the item free to overflow its own track
in a stricter engine, while `min-width: 0` cannot.

## Rejected: `.card { overflow-x: auto }`

This was tried, measured, and removed. It makes every card a scroll container, which zeroes the grid
item's automatic minimum size on its own, so it fixed the issue too and made `min-width: 0`
redundant. It was rejected because it breaks a documented promise.

`references/playbooks/design.md:7` tells authors:

> Wide content - tables, code blocks, diagrams - goes inside `<div class="scroll">`. The page itself
> must never scroll sideways. The review gate proves this at phone (360px) and tablet (800px) widths
> as well as desktop, so a fixed-width element with no scroll container blocks the review even when
> it looks fine on your screen.

`references/playbooks/table.md:7` says the same for tables. A card that silently absorbs any width
would stop the gate from blocking exactly the case the docs guarantee it catches. The audit has no
other detector for it: `audit.js` reports page-level `h-overflow` only, and its `clipped-text` check
requires `overflow: hidden`, not `auto`. A reviewer on a phone would see a truncated table and the
agent would never be told.

Second cost: per CSS Overflow 3, setting `overflow-x` to a non-visible value makes `overflow-y`
compute to `auto`, so every card would become a scroll container in both axes and clip any
deliberately overhanging or sticky child.

## Content that still overflows, on purpose

Content that breaks the `.scroll` contract still overflows, which is the documented behavior:

| Card content | Position | 360px | 800px | 1200px |
| --- | --- | --- | --- | --- |
| Bare `<table>` | second card | 258 to 239 | 0 to 186 | 0 to 0 |
| Long unbreakable URL | second card | 225 to 206 | 0 to 153 | 0 to 0 |

The 800px column goes from 0 to a finding. That blocks nothing new. The audit runs 360px, 800px and
desktop and blocks on any severe finding, and both of these were already far past the 80px severe bar
at 360px before this change. The 800px finding adds evidence, not new blocking.

The reason 800px used to read clean is that the grid absorbed the wide card by making the tracks
unequal, 596px and 150px instead of 373px and 373px. That hid the problem rather than solving it.

Both shapes overflow just as badly outside a card, 220px and 187px at 360px, so the fix leaves them
exactly at parity with the non-card case. That parity is the bar the issue itself sets: "the way a
code block outside a card already does".

## Not changed: `.choice`

`.choice` is a flex container with the same class of weakness. Measured at 360px in the shipped
fieldset:

- A long unbreakable path in an inline `<code>` inside a `.choice label` does not overflow. Chrome
  breaks after `/`, so it wrapped across three line boxes.
- A `<pre>` inside a `.choice label` overflows by 379px.
- Adding `.choice > * { min-width: 0 }` changes that by exactly zero pixels. The binding constraint
  is the user agent rule `fieldset { min-inline-size: min-content }`, not the flex item.

So a blanket "min-width:0 on every flex and grid container" rule would have added a declaration that
measurably fixes nothing while looking like coverage. If the fieldset family is hardened later, the
missing declaration is `fieldset { min-width: 0 }`, and it belongs in its own change.

## Not changed: the audit severity threshold

The issue notes that `arev check` reports the overflow as minor rather than as an error. Two
corrections to that reading:

1. The message comes from the browser boot audit, `assets/review-ui/audit.js:91-102`, not from
   `arev check`. `arev check` is a static checker with no viewport pass at all.
2. `audit.js:99` grades an overflow `severe` above 80px and `minor` between 25px and 80px. The 37px
   in the report lands in that band, so the curtain does not block.

Lowering the threshold was rejected as the fix, because the scaffold was the source of the overflow.

There is a separate real defect here, left for its own issue: the 80px bar is absolute, but
`chrome.html:1079` runs the same audit at 360px, 800px and desktop. 80px is 5.5% of a 1440px desktop
and 22% of a 360px phone, so the phone pass is the least sensitive one. A 25px to 80px phone overflow
is plainly visible sideways scroll that neither blocks the curtain nor reaches the agent. A scaled
bar such as `Math.min(80, vw * 0.1)` would cut at 36px on a phone and stay at 80px on a desktop.

## Regression test

`tests/features/layout-gate.feature`, third row of the "A sound artifact opens straight into review"
Examples table, with the step in `tests/steps/gate.steps.js`.

The step drives the real `arev new` and fills the content region with the markup from the issue, so
the test reads the shipped template rather than a fixture copy that could go stale. That is the right
altitude here: the defect is in the scaffold, and a copied fixture would keep passing after someone
edited the template. The existing `tests/fixtures/*.html` serve the opposite purpose. They are
deliberately broken frozen inputs used to test the audit's own behavior, where stability is the point.

Proven both ways:

- With the fix: 3 passed.
- With the template change stashed: Example #3 failed, Examples #1 and #2 passed.

The two `Given` steps were folded into one regex step, matching the existing convention in
`tests/steps/session.steps.js:4`.

`tests/support/bdd.js` now makes `artifact.replace()` throw when the search text is absent. It used
to return the source unchanged and write it straight back. If someone renamed the
`<!-- arev:content -->` marker, the new step would have silently become a copy of the plain-scaffold
row and stayed green while guarding nothing. The two existing callers in `tests/steps/diagram.steps.js`
still pass, which proves their search text matches.

## Verification

- `npm test` (Python): 5 suites, `SELFTEST: PASS`.
- `npm run test:e2e`: 67 passed.
- Browser measurement of the shipped template at 360px, 800px and 1200px, with wide content in the
  first card, the second card, and both, for six content shapes. Table above.

## Review history

Two review passes changed the design, both on measured evidence.

1. The first `/code-review` found that `min-width: 0` alone caused a desktop overflow when the wide
   content sat in the second card, which the first measurement pass missed by only testing the first
   card. That led to adding `.card { overflow-x: auto }`.
2. `/simplify` then found that `overflow-x: auto` made `min-width: 0` redundant, and the altitude
   review found that it also silences the layout gate against the authoring contract in
   `design.md:7`. Re-measuring showed the 800px "regression" was the gate correctly reporting a
   contract violation that unequal grid tracks had been hiding, and that those artifacts were already
   blocked by the 360px pass. `overflow-x: auto` was removed and the fix returned to one rule.
