Feature: Activity history

  A long review outgrows one payload. The opening state carries a bounded
  window of the newest entries, older pages arrive on demand, and no entry may
  be dropped or repeated along the way.

  Background:
    Given a clean artifact
    And the review server is running
    And the agent has posted 125 activity entries
    And the reviewer has the review session open

  Scenario: The opening state carries only the newest entries
    Then the opening state holds the newest 50 of 125 entries
    And the older activity pages join up with no gaps or overlaps

  Scenario: A queue-only change travels as a compact delta
    When the reviewer queues a draft through the review API
    Then the delta carries the queued draft and no activity feed
    When 260 agent status updates overrun the delta window
    Then a client behind the delta window gets one bounded reset

  Scenario: Load earlier activity restores the whole history
    When the reviewer loads every earlier activity page
    Then the review feed shows all 125 entries oldest first with nothing left to load
