Feature: Feedback delivery

  The reviewer decides when feedback leaves the browser. Adding to the review
  keeps it local; sending hands the whole batch to the agent.

  Background:
    Given a clean artifact
    And the reviewer has the review session open

  Scenario: Adding a note to the review does not deliver it
    When the reviewer types "tighten this paragraph" in chat
    And the reviewer chooses "Add to review"
    Then the composer shows "Draft"
    And the review holds 1 draft
    And the chat box is empty

  Scenario: Send now delivers the note to the agent
    When the reviewer types "add a totals row" in chat
    And the reviewer chooses "Send now"
    Then the composer shows "Sent"
    And the review holds 0 drafts
    And the agent receives a chat note saying "add a totals row"
