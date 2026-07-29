use_when: slide deck artifact, presentation, pitch deck, one-screen-at-a-time walkthrough, keynote-style artifact

## Structure

- One section per screen/slide: a full-viewport-height `<section>` per idea, stacked in document order.
- One idea per slide. If a slide needs two headings, it's two slides.
- Minimal text per slide: a headline plus at most 3-5 short bullets, or one big statement plus a supporting image/diagram. Not paragraphs.

## Navigation

- Support both keyboard and scroll navigation. Arrow keys / space bar move to next/previous slide (JS `keydown` listener scrolling to the next `<section>`); plain scroll/trackpad also works because slides are just stacked sections.
- Use `scroll-snap-type: y mandatory` on the container and `scroll-snap-align: start` on each section so scroll navigation lands cleanly on slide boundaries instead of stopping mid-slide.
- Show a minimal slide-position indicator (e.g. "3 / 8" or dots) so the human knows where they are and how much is left.

## Type and layout

- Headline type large: 2.5-4rem depending on slide role (title slide bigger than content slide).
- Body bullets large enough to read at a glance: at least 1.25rem, generous line-height.
- Center content vertically and horizontally within the slide by default; don't let text hug one corner of a full-height section.

## Visuals

- Prefer one diagram, chart, or big number per slide over dense bullet lists - slides are for the headline, not the detail (detail belongs in a doc artifact instead).
- Any diagram on a slide follows diagram.md rules (short labels, low fan-out) - a slide has even less room than a normal artifact page.

## What to avoid

- Don't put a scrolling table or code block inside a slide - if content needs `overflow-x: auto` to fit, it belongs in a doc-style artifact, not a slide.
- Don't autoplay transitions on a timer; navigation must be human-driven (key press or scroll), never forced.
- Don't shrink font size to fit more text on a slide - cut the text instead.
