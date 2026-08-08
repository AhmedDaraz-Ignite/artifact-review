Feature: Review panel

  The review panel collapses into a dock so the artifact gets the whole window.
  Collapsing hides the panel. It never throws away what the reviewer has
  already written or loaded, and on a phone it opens as a modal drawer.

  Background:
    Given a clean artifact
    And the reviewer has the review session open

  Scenario: The panel exposes one stable control set
    Then the review panel exposes its 5 stable controls

  Scenario: Collapsing keeps the live composer and the loaded history
    Given the agent has posted 125 activity entries
    And the review feed holds 125 entries
    And the reviewer types "preserve this unsent panel note" in chat
    When the reviewer collapses the review panel
    Then the review panel collapses from 360px into a right-aligned 64px dock
    And the collapsed panel still holds 125 activity entries
    And the chat box still contains "preserve this unsent panel note"

  Scenario Outline: A dock control expands the panel and focuses its section
    Given the reviewer has collapsed the review panel
    When the reviewer opens <section> from the dock
    Then the review panel expands with <section> selected and focused

    Examples:
      | section      |
      | drafts       |
      | activity     |
      | new feedback |

  Scenario: The collapsed preference survives a reload
    Given the reviewer has collapsed the review panel
    Then the collapsed panel preference is stored
    When the reviewer reloads the review page
    Then the review panel is still a 64px collapsed dock

  Scenario: The draft badge caps at 99 plus and the drafts keep their scroll
    When the agent queues 100 drafts
    Then the draft dock badge reads "99+" and names 100 drafts
    When the reviewer scrolls the draft list
    And the reviewer collapses the review panel
    And the reviewer opens drafts from the dock
    Then the draft list keeps its scroll position

  Scenario: The draft queue accepts its limit and refuses one more
    When the agent queues 500 drafts
    Then one more draft is refused and the queue still holds 500

  Scenario: The collapsed dock keeps full-size targets, a divider, and a tooltip
    Given the reviewer has collapsed the review panel
    When the reviewer hovers the drafts dock control
    Then the drafts dock control is a 44px square next to a 32px divider
    And the dock tooltip is fully visible

  Scenario: Reduced motion removes the review panel transitions
    When the reviewer prefers reduced motion
    Then the review panel has no transition

  Scenario: The narrow panel docks right and expands as an overlay
    Given the viewport is a phone
    And the reviewer has collapsed the review panel
    Then the narrow dock fills the workspace edge at 64px
    When the reviewer expands the review panel
    Then the drawer overlays the artifact at 326px without resizing it

  Scenario: The narrow drawer contains forward keyboard focus
    Given the viewport is a phone
    And the reviewer has the narrow drawer open
    When the reviewer focuses the last drawer control
    And the reviewer presses Tab
    Then focus stays inside the drawer on the panel toggle

  Scenario: Escape closes the narrow drawer without losing the composer text
    Given the viewport is a phone
    And the reviewer has the narrow drawer open
    And the reviewer types "preserve this narrow-screen note" in chat
    When the reviewer focuses the composer
    And the reviewer presses Escape
    Then the narrow drawer is closed with focus back on the panel toggle
    And the chat box still contains "preserve this narrow-screen note"

  Scenario: The narrow scrim closes the drawer without losing the composer text
    Given the viewport is a phone
    And the reviewer has the narrow drawer open
    And the reviewer types "preserve this narrow-screen note" in chat
    When the reviewer taps the scrim
    Then the narrow drawer is closed with focus back on the panel toggle
    And the chat box still contains "preserve this narrow-screen note"

  Scenario: An ended review keeps inspection and disables only new feedback
    When the agent ends the review
    Then the review surface is read-only
    And the review panel stays open for inspection
    And the new feedback dock control is disabled
