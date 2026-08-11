Feature: Composer controls

  Every way to deliver feedback lives behind one action, so there is never a
  second button that means something slightly different.

  Background:
    Given a clean artifact
    And the reviewer has the review session open

  Scenario: One composer action carries every delivery choice
    When the reviewer opens the composer menu
    Then the composer menu offers every delivery choice
    And there is no separate send button
    And ending the review lives only in the composer menu

  Scenario: An empty composer asks the reviewer to write, it does not report a failure
    When the reviewer chooses "Send now"
    Then the composer shows "Nothing to send"
    And the chat box has focus
    When the reviewer chooses "Add to review"
    Then the composer shows "Nothing to add"
    And the chat box has focus
    When the reviewer types "a" in chat
    Then the composer shows "Draft"

  Scenario: A draft from an annotation retires the empty send warning
    Given the reviewer has turned annotation mode on
    When the reviewer chooses "Send now"
    Then the composer shows "Nothing to send"
    When the reviewer selects "the first paragraph"
    And the reviewer writes "tighten this paragraph" in the annotation
    And the reviewer chooses "Add to review" in the annotation
    Then the review holds 1 draft
    And the composer shows "Draft"

  Scenario: The composer action keeps its label after a delivery choice
    When the reviewer types "tighten this paragraph" in chat
    And the reviewer chooses "Send now"
    Then the agent receives feedback saying "tighten this paragraph"
    And the composer button reads "Send or add"
