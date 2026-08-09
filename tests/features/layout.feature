Feature: Review layout

  The artifact stays primary at every width. The rail sits beside it on a
  desktop and overlays it on a phone, and neither one may scroll sideways.

  Scenario: A desktop keeps the review rail beside the artifact
    Given a clean artifact
    And the reviewer has the review session open
    When the viewport is a desktop
    Then the review rail sits beside the artifact
    And the page does not scroll sideways

  Scenario: A phone overlays a fully reachable review panel
    Given a clean artifact
    And the reviewer has the review session open
    When the viewport is a phone
    Then the review rail overlays the artifact from the right
    And the page does not scroll sideways

  Scenario: Collapsing the rail hands the freed width to the artifact
    Given a scaffolded artifact
    And the reviewer has the review session open
    When the viewport is a wide desktop
    Then the artifact column is 956px wide
    When the reviewer collapses the review panel
    Then the artifact column is 1252px wide
    And the artifact prose is 840px wide
