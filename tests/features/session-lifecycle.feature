Feature: Ending and reopening a review

  Ending is deliberate and visible. A review that the reviewer closed does not
  quietly reopen because the agent ran a command again.

  Background:
    Given a clean artifact
    And the reviewer has the review session open

  Scenario: The end action names what it is about to do
    When the reviewer opens the composer menu
    Then the end action reads "End review"
    When the reviewer presses Escape
    And the reviewer types "approved, start implementing" in chat
    And the reviewer opens the composer menu
    Then the end action reads "Send and end review"

  Scenario: Send and end review delivers the pending note, then locks the surface
    When the reviewer types "approved, start implementing" in chat
    And the reviewer chooses "Send and end review"
    Then the reviewer was asked to confirm
    And the agent receives feedback saying "approved, start implementing"
    And the agent is told the review ended by the user
    And the review surface is read-only

  Scenario: A review the reviewer ended only reopens on purpose
    When the reviewer types "approved, start implementing" in chat
    And the reviewer chooses "Send and end review"
    Then the agent receives feedback saying "approved, start implementing"
    And the agent is told the review ended by the user
    And reopening the review is refused
    When the agent reopens the review explicitly
    Then the reopened session accepts feedback again
    And the reopened session keeps the earlier activity
    And the open browser re-audits the reopened session
    And reopening again keeps the review open and resets the layout check

  Scenario: An authenticated shutdown stops the server it names
    When the agent shuts the review server down
    Then the shutdown names the server that stopped
    And the review server is no longer reachable
