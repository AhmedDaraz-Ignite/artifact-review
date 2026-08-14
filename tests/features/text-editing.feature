Feature: Editing the artifact's text in place

  A wrong word costs a full agent round trip to describe. The reviewer rewrites
  it where it stands instead, then either saves it into the artifact or hands
  the change to the agent.

  Background:
    Given a clean artifact
    And the reviewer has the review session open

  Scenario: The edit toggle reports its own state
    Then edit text mode is off
    When the reviewer toggles edit text mode
    Then edit text mode is on
    When the reviewer toggles edit text mode
    Then edit text mode is off

  Scenario: Only one of the two modes is ever on
    Given the reviewer has turned edit text mode on
    When the reviewer toggles annotation mode
    Then annotation mode is on
    And edit text mode is off

  Scenario: Edit text mode survives the artifact reloading under it
    Given the reviewer has turned edit text mode on
    When the agent rewrites the artifact
    Then edit text mode is on
    And the reviewer points at "well-formed paragraph"

  Scenario: A line offers a pencil and a bin where the pointer rests
    Given the reviewer has turned edit text mode on
    When the reviewer points at "well-formed paragraph"
    Then the line handles read "Edit this line" and "Mark this line for deletion"

  Scenario: The pencil opens the whole line holding its own text
    Given the reviewer has turned edit text mode on
    When the reviewer points at "well-formed paragraph"
    And the reviewer clicks the pencil handle
    Then the editor holds "This is a well-formed paragraph of readable text describing the artifact."
    And the editor is the paragraph itself

  Scenario: Clicking the highlighted line opens the same editor
    Given the reviewer has turned edit text mode on
    When the reviewer clicks the line "well-formed paragraph"
    Then the editor holds "This is a well-formed paragraph of readable text describing the artifact."

  Scenario: A saved edit is drafted, marked in the page, and listed in the rail
    Given the reviewer has turned edit text mode on
    When the reviewer clicks the line "well-formed paragraph"
    And the reviewer types " It reads better now."
    And the reviewer saves the edit
    Then the line is marked as edited
    And the review holds 1 draft
    And the draft chip reads "Edited"
    And the composer button reads "Save or send"

  Scenario: Saving into the artifact is offered only when there is an edit to save
    Given the reviewer has turned edit text mode on
    When the reviewer opens the composer menu
    Then the composer menu offers every delivery choice
    When the reviewer closes the composer menu
    And the reviewer clicks the line "well-formed paragraph"
    And the reviewer types " It reads better now."
    And the reviewer saves the edit
    And the reviewer opens the composer menu
    Then the composer menu also offers saving into the artifact

  Scenario: Cancelling an edit leaves the artifact's own words alone
    Given the reviewer has turned edit text mode on
    When the reviewer clicks the line "well-formed paragraph"
    And the reviewer types " throw this away"
    And the reviewer cancels the edit
    Then the artifact reads "This is a well-formed paragraph of readable text describing the artifact."
    And the review holds 0 drafts

  Scenario: Selecting words opens an editor already holding them
    Given the reviewer has turned edit text mode on
    When the reviewer selects "more context" inside "second paragraph"
    And the reviewer chooses "Edit text" for the selection
    Then the editor holds "more context"

  Scenario: A rewritten range drafts and saves like any other edit
    Given the reviewer has turned edit text mode on
    When the reviewer selects "more context" inside "second paragraph"
    And the reviewer chooses "Edit text" for the selection
    And the reviewer types " and detail"
    And the reviewer saves the edit
    Then the review holds 1 draft
    And the draft chip reads "Edited"
    When the reviewer chooses "Save edits to the artifact"
    Then the artifact file carries "more context and detail"

  Scenario: Undoing from the mark itself takes the draft with it
    Given the reviewer has turned edit text mode on
    When the reviewer selects "more context" inside "second paragraph"
    And the reviewer chooses "Delete" for the selection
    Then the review holds 1 draft
    When the reviewer clicks the marked text
    And the reviewer chooses "Undo this edit"
    Then the review holds 0 drafts
    And the artifact keeps the words "more context"

  Scenario: A selection crossing two lines opens both lines
    Given the reviewer has turned edit text mode on
    When the reviewer selects from "well-formed paragraph" to "second paragraph"
    And the reviewer chooses "Edit text" for the selection
    Then the editor holds every line of the range

  Scenario: Selected words can be cut without opening the editor
    Given the reviewer has turned edit text mode on
    When the reviewer selects "more context" inside "second paragraph"
    And the reviewer chooses "Delete" for the selection
    Then the cut words are struck through
    And the draft chip reads "Cut text"

  Scenario: The bin marks a whole line for deletion
    Given the reviewer has turned edit text mode on
    When the reviewer points at "second paragraph"
    And the reviewer clicks the bin handle
    Then the line is marked for deletion
    And the draft chip reads "Cut line"

  Scenario: Removing the draft puts the artifact's own text back
    Given the reviewer has turned edit text mode on
    When the reviewer clicks the line "well-formed paragraph"
    And the reviewer types " It reads better now."
    And the reviewer saves the edit
    And the reviewer removes the first draft
    Then the artifact reads "This is a well-formed paragraph of readable text describing the artifact."
    And the composer button reads "Send or add"

  Scenario: Saving writes the edits into the artifact and tells the agent
    Given the reviewer has turned edit text mode on
    When the reviewer clicks the line "well-formed paragraph"
    And the reviewer types " It reads better now."
    And the reviewer saves the edit
    And the reviewer chooses "Save edits to the artifact"
    Then the artifact file carries "It reads better now."
    And the review holds 0 drafts
    And the agent receives an edit carrying "It reads better now."
    And the delivered feedback is marked as already applied

  Scenario: Sending leaves the artifact untouched
    Given the reviewer has turned edit text mode on
    When the reviewer clicks the line "well-formed paragraph"
    And the reviewer types " It reads better now."
    And the reviewer saves the edit
    And the reviewer chooses "Send now"
    Then the artifact file still reads as the agent wrote it
    And the agent receives an edit carrying "It reads better now."
    And the delivered feedback is not marked as applied

  Scenario: Saving is refused when the agent changed the file underneath
    Given the reviewer has turned edit text mode on
    When the reviewer clicks the line "well-formed paragraph"
    And the reviewer types " It reads better now."
    And the reviewer saves the edit
    And the agent rewrites the artifact
    And the reviewer chooses "Save edits to the artifact"
    Then the composer shows "Failed"
    And the review holds 1 draft
