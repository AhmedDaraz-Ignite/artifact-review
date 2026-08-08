Feature: Feedback delivery

  The reviewer decides when feedback leaves the browser, and the composer tells
  the truth about where it is: Draft, Sending, Sent, Received, Answered, Failed.

  Background:
    Given a clean artifact
    And the reviewer has the review session open

  Scenario: Adding a note to the review does not deliver it
    When the reviewer types "tighten this paragraph" in chat
    And the reviewer chooses "Add to review"
    Then the composer shows "Draft"
    And the review holds 1 draft
    And the chat box is empty
    And the agent receives nothing

  Scenario: Repeated page choices keep only the last value
    When the reviewer picks page option b
    And the reviewer picks page option a
    And the reviewer picks page option b
    Then the review holds one page choice worth b

  Scenario: Send now delivers every draft as one batch
    Given the reviewer has turned annotation mode on
    When the reviewer selects "the first paragraph"
    And the reviewer writes "tighten this paragraph" in the annotation
    And the reviewer chooses "Add to review" in the annotation
    And the reviewer toggles annotation mode
    Then annotation mode is off
    When the reviewer types "a chat note" in chat
    And the reviewer chooses "Add to review"
    And the reviewer picks page option b
    Then the review holds 3 drafts
    When the reviewer chooses "Send now"
    Then the agent receives one feedback batch of kinds:
      | chat    |
      | control |
      | text    |
    And the batch carries the review event schema
    And the review holds 0 drafts
    And the newest feed entry shows "Received"

  Scenario: An annotation shows Sending while delivery is in flight
    Given the reviewer has turned annotation mode on
    And delivery is held in flight
    When the reviewer clicks "the table"
    And the reviewer writes "add a totals row" in the annotation
    And the reviewer chooses "Send now" in the annotation
    Then the annotation shows "Sending"
    And the annotation text box is disabled
    When delivery is released
    Then the agent receives feedback saying "add a totals row"

  Scenario: A failed send preserves everything the reviewer wrote
    Given delivery will fail with 503
    When the reviewer types "queued before retry" in chat
    And the reviewer chooses "Add to review"
    And the reviewer types "preserve this unsent note" in chat
    And the reviewer chooses "Send now"
    Then the composer shows "Failed"
    And the chat box still contains "preserve this unsent note"
    And the review holds 1 draft
    And the banner explains the feedback was preserved
    When delivery starts working again
    And the reviewer chooses "Send now"
    Then the composer shows "Sent"
    And the chat box is empty
    And the review holds 0 drafts
    And the agent receives 2 chat notes

  Scenario: An agent reply advances the delivery to Answered
    When the reviewer types "add a totals row" in chat
    And the reviewer chooses "Send now"
    Then the agent receives feedback saying "add a totals row"
    When the agent replies "Applied. Totals row added."
    Then the feed shows the agent reply "Applied. Totals row added."
    And the newest feed entry shows "Answered"
