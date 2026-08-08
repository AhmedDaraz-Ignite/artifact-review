Feature: Diagram rendering

  Mermaid renders offline, in the page's own theme and font, with node identity
  that survives a re-render. The reviewer can explore a diagram until annotate
  mode freezes it, and whatever they draw is summarized for the agent.

  Background:
    Given a themed artifact
    And the reviewer has the review session open
    And the "themed-flow" diagram rendered offline

  Scenario: The offline render follows the page theme and font
    Then the "themed-flow" diagram reports the "light" page theme
    And the "themed-flow" diagram is typeset in "Georgia"
    When the reviewer switches the page theme
    Then the "themed-flow" diagram reports the "dark" page theme
    And the "themed-flow" diagram was rebuilt with restyled markup
    And the re-render announced itself to the review SDK

  Scenario: Rendered nodes keep a stable identity across a re-render
    Then the "themed-flow" diagram carries at least 4 node keys
    And the "themed-state" diagram carries at least 2 node keys
    And no "themed-flow" node key ends in a render counter
    When the reviewer switches the page theme
    Then the "themed-flow" diagram reports the "dark" page theme
    When the reviewer switches the page theme
    Then the "themed-flow" diagram reports the "light" page theme
    And the "themed-flow" node keys are unchanged

  Scenario: Explore mode zooms and resets the diagram view
    When the reviewer zooms the "themed-flow" diagram
    Then the "themed-flow" view has changed
    When the reviewer resets the "themed-flow" view
    Then the "themed-flow" view is back where it started

  Scenario: Annotate mode freezes the view so picks stay precise
    Given the reviewer has turned annotation mode on
    And the "themed-flow" diagram stops offering to pan
    When the reviewer zooms the "themed-flow" diagram
    Then the "themed-flow" view has not changed

  Scenario: Scene edits summarize as labeled sentences
    Then a moved, relabeled, and reconnected scene reads as per-element sentences
    And the scene diff counts fold bound labels into their containers

  Scenario: A saved scene drops hostile links and summarizes what was drawn
    Then scene link sanitizing keeps only web and mail links
    When the reviewer opens the "themed-links" diagram editor
    Then no hostile link reached the saved "themed-links" scene
    When the reviewer draws a rectangle on the "themed-links" diagram
    And the reviewer adds the "themed-links" diagram edit to the review
    Then the review holds 1 draft
    And the queued whiteboard item summarizes the drawing with no typed note
