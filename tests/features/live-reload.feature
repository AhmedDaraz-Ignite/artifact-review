Feature: Live reload

  The agent edits the file on disk and the browser follows, without losing the
  reviewer's scroll position, their annotation mode, or the source itself.

  Background:
    Given a clean artifact
    And the artifact is tall enough to scroll
    And the reviewer has the review session open

  Scenario: A save reloads the artifact without losing the reviewer's place
    When the reviewer scrolls the artifact down
    And the agent appends "fresh-edit" to the artifact
    Then the artifact shows "fresh-edit"
    And the artifact keeps its scroll position
    And the "clean-flow" diagram still offers its edit control

  Scenario: Rapid saves coalesce instead of overlapping
    Given the reviewer has turned annotation mode on
    And the first artifact reload is held open
    When the reviewer scrolls the artifact down
    And the agent appends "rapid-save-a" to the artifact
    And the first artifact reload is in flight
    And the agent appends "rapid-save-b" to the artifact
    And the review server picks up that save
    Then the artifact has reloaded 1 time so far
    When the held artifact reload is released
    Then the artifact shows "rapid-save-b"
    And the artifact reloaded exactly 2 times
    And the artifact keeps its scroll position
    And annotation mode is on
    And the review tooling never rewrote the artifact source
