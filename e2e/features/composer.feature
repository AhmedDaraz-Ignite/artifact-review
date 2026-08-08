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
