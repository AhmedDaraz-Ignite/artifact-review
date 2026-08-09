Feature: Session security

  The review URL is a bearer secret. Static resources are served without it so
  the sandboxed artifact frame can load them, and everything that reads or
  changes review state demands it.

  Background:
    Given a clean artifact
    And the reviewer has the review session open

  Scenario: Reading or changing review state needs the token
    Then these tokenless requests are refused:
      | GET  | /      |
      | GET  | /state |
      | POST | /queue |

  Scenario: The artifact and its SDK are served without the token
    Then these tokenless requests succeed and leak no token:
      | /artifact |
      | /sdk.js   |
    And the artifact injects the SDK from a hashed URL with no token

  Scenario: Frame assets stay readable cross-origin without the token
    Then these tokenless requests are cross-origin readable assets:
      | /whiteboard.css   |
      | /whiteboard-frame |

  Scenario: A wrong token is refused and a right one earns no CORS grant
    Then a request to "/state" with a wrong token is refused
    And these requests with the session token succeed:
      | /state          |
      | /whiteboard.css |
    And the review state grants no cross-origin access

  Scenario: A forged Host header is refused even for tokenless resources
    Then a request to "/artifact" from another host is refused
    And a tokened request to "/state" from another host is refused

  Scenario: Encoded traversal cannot read outside the review assets
    Then requesting "/whiteboard.css/..%2f..%2fscripts%2fserver.py" with the session token returns 404
    And that response does not contain "ThreadingHTTPServer"

  Scenario: The artifact frame is sandboxed away from the review chrome
    Then the artifact frame runs scripts in an opaque origin
    And the artifact cannot read the parent review window
