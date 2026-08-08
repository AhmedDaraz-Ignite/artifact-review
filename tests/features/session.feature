Feature: Review session

  Opening an artifact gives the reviewer a working surface. Each scenario gets
  its own artifact copy and its own server, so these run in parallel.

  Scenario: A clean artifact opens for review
    Given a clean artifact
    And the reviewer has the review session open
    Then the artifact is visible in the review surface
    And the review rail is ready for feedback
    And the review server reports a healthy session

  Scenario: A themed artifact opens in its own session
    Given a themed artifact
    And the reviewer has the review session open
    Then the artifact is visible in the review surface
    And the review rail is ready for feedback
