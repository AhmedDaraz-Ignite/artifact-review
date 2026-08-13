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

  Scenario Outline: A long draft list never lets one rail section cover another
    Given a clean artifact
    And the reviewer has the review session open
    When the viewport is a <viewport>
    And the agent queues 40 drafts
    Then every rail section keeps its own space
    And the page does not scroll sideways

    Examples:
      | viewport        |
      | small phone     |
      | landscape phone |

  Scenario: A small phone still shows the activity the agent sent
    Given a clean artifact
    And the reviewer has the review session open
    And the agent has posted 6 activity entries
    When the viewport is a small phone
    Then the review feed holds 6 entries
    And the review feed shows at least 2 entries at once
    And every rail section keeps its own space

  Scenario: A phone with nothing drafted still reads its empty draft list
    Given a clean artifact
    And the reviewer has the review session open
    When the viewport is a small phone
    Then the draft list shows all of its empty state

  Scenario: Collapsing the rail hands the freed width to the artifact
    Given a scaffolded artifact
    And the reviewer has the review session open
    When the viewport is a wide desktop
    Then the artifact column is 956px wide
    When the reviewer collapses the review panel
    Then the artifact column is 1252px wide
    And the artifact prose is 840px wide
