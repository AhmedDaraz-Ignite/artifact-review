Feature: Review layout

  The artifact stays primary at every width. The rail sits beside it on a
  desktop and overlays it on a phone, and neither one may scroll sideways.

  Background:
    Given a clean artifact
    And the reviewer has the review session open

  Scenario: A desktop keeps the review rail beside the artifact
    When the viewport is a desktop
    Then the review rail sits beside the artifact
    And the page does not scroll sideways

  Scenario: A phone overlays a fully reachable review panel
    When the viewport is a phone
    Then the review rail overlays the artifact from the right
    And the page does not scroll sideways
