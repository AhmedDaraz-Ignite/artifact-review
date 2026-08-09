Feature: Inline diagram whiteboard

  The whiteboard is heavy, so nothing about it loads until the reviewer asks to
  edit. Once it is open, edits autosave on a debounce, snapshots are content
  addressed, and the artifact's own Mermaid source is never touched.

  Background:
    Given a clean artifact
    And whiteboard requests are recorded
    And the reviewer has the review session open
    And the "clean-flow" diagram has mounted

  Scenario: The editor and its assets stay unloaded until the reviewer asks
    Then no diagram has mounted an editor frame
    And no whiteboard asset has been fetched
    And the "clean-flow" diagram offers an activation control
    When the reviewer opens the "clean-flow" diagram editor
    Then the "clean-flow" editor frame is sandboxed away from the review chrome
    And the "clean-flow" editor URL carries no session token
    And the "clean-flow" editor is labelled "Flowchart · Editable shapes"

  Scenario: A reviewer edit autosaves on the debounce, not before
    Given the reviewer has opened the "clean-flow" diagram editor
    And the converted "clean-flow" scene is saved
    When the reviewer draws a rectangle on the "clean-flow" diagram
    Then no scene save leaves the browser for 500ms
    And the scene save lands inside the 800ms debounce window
    And the saved "clean-flow" scene holds the drawn rectangle and its source identity
    And the "clean-flow" editor reports the autosave

  Scenario: Fullscreen survives the review panel opening and closing
    Given the reviewer has opened the "clean-flow" diagram editor
    When the reviewer expands the "clean-flow" editor to fullscreen
    Then the "clean-flow" diagram fills the window with one editor frame
    When the reviewer collapses the review panel
    Then the "clean-flow" diagram fills the window with one editor frame
    When the reviewer expands the review panel
    Then the "clean-flow" diagram fills the window with one editor frame

  Scenario: Drafted and current diagram feedback deliver as one batch
    Given the reviewer has opened the "clean-flow" diagram editor
    When the reviewer draws a rectangle on the "clean-flow" diagram
    And the reviewer summarizes the "clean-flow" edit as "added a large review rectangle"
    And the reviewer adds the "clean-flow" diagram edit to the review
    Then the queued whiteboard item has a scene file and a PNG preview
    When the reviewer summarizes the "clean-flow" edit as "confirmed the diagram edit"
    And the reviewer sends the "clean-flow" diagram edit now
    Then the agent receives one diagram batch summarizing:
      | added a large review rectangle |
      | confirmed the diagram edit     |
    And both snapshots reuse the same content-addressed blobs
    And every delivered preview is a valid PNG
    And the artifact source is unchanged
