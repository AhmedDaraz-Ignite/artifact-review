Feature: Offline whiteboard

  A review runs on a laptop with no internet. Mermaid renders, the editor
  loads, and feedback delivers with every byte served by the review server
  itself.

  Background:
    Given a clean artifact
    And the review server is running
    And every request outside the review server is blocked
    And the reviewer has the review session open

  Scenario: The whiteboard works with nothing but the review server
    Then the artifact renders its Mermaid to SVG offline
    When the reviewer opens the "clean-flow" diagram editor
    And the reviewer draws a rectangle on the "clean-flow" diagram
    And the reviewer summarizes the "clean-flow" edit as "offline rectangle edit"
    And the reviewer sends the "clean-flow" diagram edit now
    Then the agent receives the diagram note "offline rectangle edit" with no draft left
    And the delivered scene holds the rectangle that was drawn
    And every delivered preview is a valid PNG
    And the whiteboard frame, script, and styles all came from the review server
    And no whiteboard asset URL carries the session token
    And nothing outside the review server was requested
    And the artifact source is unchanged
