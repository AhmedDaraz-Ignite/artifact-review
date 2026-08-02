use_when: architecture diagram, flow chart, sequence diagram, system design artifact, explaining how something flows, pipeline visualization, state machine

## Structure

- One idea per diagram. If you're tempted to add a second concern (e.g. both the happy path and every error branch), split it into a second diagram instead.
- Keep it to 2-4 diagrams per section. A rich artifact with many sections carries many diagrams; what it must not do is stack five pictures under one heading.
- Give each diagram a one-line caption above it stating what it shows, in plain words.

## Markup

- Always `<pre class="mermaid" id="stable-id">...</pre>`, never a `<div>`. `pre` preserves the whitespace mermaid's parser needs, and the stable id keeps reviewer annotations attached across edits.
- Never approximate a diagram with styled divs and arrow characters. Only Mermaid blocks render as real diagrams under review, open in the editable Excalidraw whiteboard, and accept node-level annotations.
- Do not load mermaid.js yourself - no CDN script, no initialize call. The review server renders every Mermaid block offline with its own pinned Mermaid. Outside a review session the block shows its readable source text, which is the intended degraded form.
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

## Check the result

- Run `arev check FILE`. It fails a diagram that cannot render, one drawn as a flowchart while the text calls it a state machine, a node with more than four outgoing edges, and a label over five words.
- Naming the source section in a caption ("Sections 19.4 and 22.3") is how the check knows which part of the source a diagram covers. Caption every diagram that way when the artifact explains a numbered document.
