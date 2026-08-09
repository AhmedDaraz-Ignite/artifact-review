Feature: Editable diagrams

  A Mermaid block in the artifact becomes an editable scene on demand. The
  editor mounts only when the reviewer asks for it, one frame serves every
  diagram, and a source edit never silently throws saved work away.

  Background:
    Given a diagram-features artifact
    And the reviewer has the review session open

  Scenario: Diagram editors mount on demand and share one frame
    Given the "request-flow" diagram has mounted
    And the "review-er" diagram has mounted
    Then no diagram has mounted an editor frame
    When the reviewer opens the "request-flow" diagram editor
    And the reviewer opens the "review-er" diagram editor
    Then only the "review-er" diagram holds the one shared editor frame
    And the "review-er" editor canvas is at least as tall as the diagram
    And the "review-er" editor is labelled "ER diagram · Editable shapes"
    And the saved "review-er" scene holds more than 5 native shapes
    And the saved "request-flow" scene holds more than 3 native shapes
    And the "request-flow" diagram kept the Mermaid source it was rendered from
    And no saved scene repeats an element id

  Scenario: Sequence message labels keep their own arrow and their source order
    When the reviewer opens the "message-sequence" diagram editor
    Then the saved "message-sequence" scene holds more than 15 native shapes
    And the "message-sequence" message labels run top to bottom in source order
    And no "message-sequence" message arrow is bound to a participant box
    When the reviewer moves the "message-sequence" first participant box
    Then the "message-sequence" message labels run top to bottom in source order

  Scenario: Every supported Mermaid dialect converts to native shapes
    Then subgraph, state, and class diagrams convert to native shapes
    And the bundled Mermaid runtime is pinned to "11.16.0"

  Scenario: A rendered Mermaid node is an exact annotation target
    Given the reviewer has turned annotation mode on
    When the reviewer clicks the "API Service" diagram node
    Then the annotation names "API Service"
    When the reviewer writes "Rename this node to Review Gateway" in the annotation
    And the reviewer chooses "Add to review" in the annotation
    Then the review holds 1 draft
    And the queued diagram-node target names "API Service" and nothing more
    When the reviewer toggles annotation mode
    And the reviewer chooses "Send now"
    Then the agent receives feedback saying "Rename this node to Review Gateway"
    And the delivered diagram-node target still names "API Service"

  Scenario: A changed Mermaid source offers keep or re-convert
    Given the reviewer has opened the "request-flow" diagram editor
    When the agent adds a cache step to the "request-flow" diagram
    And the reviewer reopens the "request-flow" diagram editor
    Then the editor offers to keep the saved scene or re-convert it
    When the reviewer chooses "Keep editing saved scene" in the diagram editor
    Then the editor says the scene came from an older Mermaid source
    And the saved "request-flow" scene keeps the hash it was converted from
    When the agent adds a metrics edge to the "request-flow" diagram
    And the reviewer reopens the "request-flow" diagram editor
    And the reviewer chooses "Re-convert (discard saved edits)" in the diagram editor
    Then the saved "request-flow" scene is rebuilt from the latest source
