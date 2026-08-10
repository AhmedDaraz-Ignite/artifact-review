Feature: Annotating the artifact

  Pointing at a phrase or an element is the fastest feedback the reviewer can
  give, so it must work from the keyboard and survive the agent's next edit.

  Background:
    Given a clean artifact
    And the reviewer has the review session open

  Scenario: The annotation toggle reports its own state
    Then annotation mode is off
    When the reviewer toggles annotation mode
    Then annotation mode is on
    When the reviewer toggles annotation mode
    Then annotation mode is off

  Scenario: The annotation menu is reachable from the keyboard
    Given the reviewer has turned annotation mode on
    When the reviewer selects "the first paragraph"
    And the reviewer writes "tighten this paragraph" in the annotation
    And the reviewer opens the annotation menu with the keyboard
    Then the annotation menu focuses "Send now"
    When the reviewer presses ArrowDown
    Then the annotation menu focuses "Add to review"
    When the reviewer presses Enter
    Then the review holds 1 draft
    And the annotation composer is closed

  Scenario: Switching the annotation target keeps the note already typed
    Given the reviewer has turned annotation mode on
    When the reviewer clicks "the table"
    And the reviewer writes "this needs a caption" in the annotation
    And the reviewer clicks "the heading"
    Then the annotation targets "<h1> Clean artifact fixture"
    And the annotation holds "this needs a caption"

  Scenario: A delivered annotation leaves the next one empty
    Given the reviewer has turned annotation mode on
    When the reviewer clicks "the table"
    And the reviewer writes "this needs a caption" in the annotation
    And the reviewer chooses "Add to review" in the annotation
    And the reviewer clicks "the heading"
    Then the annotation holds ""

  Scenario: A pick that lands mid-delivery cannot steal the note in flight
    Given the reviewer has turned annotation mode on
    And delivery is held in flight
    When the reviewer clicks "the table"
    And the reviewer writes "this needs a caption" in the annotation
    And the reviewer chooses "Send now" in the annotation
    And the reviewer clicks "the heading"
    Then the annotation shows "Sending"
    And the annotation holds "this needs a caption"
    When delivery is released
    Then the annotation composer is closed
    And the agent receives feedback saying "this needs a caption"

  Scenario: A text annotation carries an anchor the agent can resolve
    Given the reviewer has turned annotation mode on
    When the reviewer selects "the first paragraph"
    And the reviewer writes "tighten this paragraph" in the annotation
    And the reviewer chooses "Send now" in the annotation
    Then the agent receives feedback saying "tighten this paragraph"
    And the text annotation carries a durable anchor
