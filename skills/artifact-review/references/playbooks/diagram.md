use_when: architecture diagram, flow chart, sequence diagram, system design artifact, explaining how something flows, pipeline visualization, state machine

## Structure

- One idea per diagram. If you're tempted to add a second concern (e.g. both the happy path and every error branch), split it into a second diagram instead.
- Max 2-4 diagrams total in one artifact. More than that means the artifact needs sectioning, not more pictures.
- Give each diagram a one-line caption above it stating what it shows, in plain words.

## Markup

- Always `<pre class="mermaid">...</pre>`, never `<div class="mermaid">`. `pre` preserves the whitespace mermaid's parser needs.
- Load mermaid.js once, at the end of the body, and call `mermaid.initialize` after DOM content is present.
- Wrap the render call in try/catch or listen for mermaid's error event - a syntax error in one diagram shouldn't blank the rest of the page.
- Put each diagram's container in `overflow-x: auto` with a sane max-width so a wide graph scrolls internally instead of blowing out the page.

## Labels

- Node labels: 2-5 words, plain nouns/verbs. "Validate input" not "Perform validation of the incoming request payload".
- Edge labels only when the edge meaning isn't obvious from context (e.g. "on error", "retry"). Skip edge labels on plain sequential flow.
- No line breaks inside a label unless the diagram type requires it - let mermaid's auto-wrap or box sizing handle it.

## Fan-out

- Max 3-4 branches out of any single node. A decision node with 6 outgoing arrows is unreadable - group related branches under an intermediate node, or split into a second diagram scoped to that sub-decision.
- Prefer depth over width: a few short chained decisions read easier than one wide starburst.

## Diagram type choice

- Sequence diagram for "who calls whom, in what order."
- Flowchart (`graph TD`/`graph LR`) for decision trees and pipelines.
- State diagram for a thing with named states and transitions between them.
- Don't force a flowchart to do a sequence diagram's job (actors + time) - pick the type that matches the shape of the idea.

## What NOT to diagram

- Don't diagram something a short bullet list already says clearly. A diagram earns its space by showing branching, ordering, or parallelism that prose can't show cleanly.
- Don't restate the same flow in both a diagram and a paragraph directly below it - pick one.
