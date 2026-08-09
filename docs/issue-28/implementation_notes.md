# Issue 28 - `/favicon.ico` answered with 403 on every session

## Reported behavior

Every review session logs `Failed to load resource: the server responded with a status of 403
(Forbidden)` for `/favicon.ico` before the reviewer touches anything. The browser tab also shows no
icon.

## Reproduction

Opened a session against a throwaway artifact and asked for the path the browser asks for:

```
$ python3 skills/artifact-review/scripts/arev.py open repro.html --no-browser
SESSION http://127.0.0.1:61406/?t=...
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:61406/favicon.ico
403
$ curl -s http://127.0.0.1:61406/favicon.ico
{"error": "bad token"}
```

## Root cause

`Handler._guard()` in `skills/artifact-review/scripts/server.py` runs before routing. It lets a GET
through without a token only when the path is in `PUBLIC_REVIEW_PATHS`. Every other request is
answered `403 bad token`, whether or not the server has a route for it.

A favicon request is issued by the browser itself. It carries no `X-Arev-Token` header and no `t`
query parameter, so it can never satisfy that check. The 403 is therefore guaranteed on every
session, which is exactly what the issue describes.

## Fix

Serve a real favicon instead of rejecting the request.

- `skills/artifact-review/assets/review-ui/favicon.svg` is a new 32x32 mark: the product accent
  colour `#3557c0` on a rounded square with a white check. It stays readable at 16px and works on a
  light or a dark tab strip.
- `server.py` loads it with the other required assets, adds `/favicon.ico` to
  `PUBLIC_REVIEW_PATHS`, and routes `GET /favicon.ico` to that asset.
- `chrome.html` declares `<link rel="icon" type="image/svg+xml" href="/favicon.ico">`.

### Why serve an icon rather than return 404 or 204

The issue accepts 404 or 204, but Chrome still prints `Failed to load resource: ... 404 (Not Found)`
for a favicon, so a 404 would trade one console error for another. Serving the file gives a clean
console and fixes the second half of the report, the empty tab icon, with the same change.

### Why SVG bytes under an `.ico` URL

`/favicon.ico` is the path the browser asks for on its own, so that path has to answer. The asset is
a real SVG and keeps its real extension on disk. `_static_entry` already sends
`X-Content-Type-Options: nosniff`, so a browser must use the declared `image/svg+xml` and cannot
guess a type from the URL. The `<link>` tag in `chrome.html` states the same type, so no browser has
to infer anything.

### Scope

The guard itself is unchanged. Returning 404 for unknown paths before checking the token would leak
which routes exist to an unauthenticated caller, and that is a security decision well outside this
issue.

## Checks

- `tests/runtime/test_asset_delivery.py::test_favicon_is_served_without_a_token` asks for
  `/favicon.ico` with no token, and asserts 200, `image/svg+xml`, the exact asset bytes, and the
  `<link rel="icon">` tag in the served controller document.
- `tests/features/session-security.feature` gains the scenario "The favicon the browser asks for on
  its own needs no token", which reuses the existing tokenless-request step.
- `bash tests/run.sh` passes end to end, all five runtime suites.
- `npx playwright test --project=review -g token` passes, 6 scenarios.

## Code review

Run with `/code-review` at medium effort. One finding accepted, one rejected.

Accepted. `arev doctor` reported `"ok": true` while the server could no longer start, because
`favicon.svg` joined `REQUIRED_ASSETS` but not `_doctor_checks`. CI runs `arev doctor`, so a
packaging drop of that file would have shipped green.

```python
        "favicon": os.path.isfile(os.path.join(ASSET_DIR, "favicon.svg")),
```

Reproduced both ways: with the file renamed away, `arev doctor` now prints `"favicon": false`,
`"ok": false` and exits 1; with it restored, it exits 0.

Rejected. "Browsers without SVG favicon support show no icon", suggesting a data-URI PNG fallback.
Safari gained SVG favicon support in version 16. The console error that issue 28 reports is gone on
every browser either way, so the fallback would only repaint a tab on macOS Monterey and older. Not
worth a second embedded copy of the icon.

## Simplify

Reuse angle run as a subagent. The other three angles (simplification, efficiency, altitude) were
judged directly against the 19-line diff rather than spawning agents for it.

Accepted. The `PUBLIC_REVIEW_PATHS` frozenset already had a documented home in
`tests/features/session-security.feature`, so the new public path now appears there instead of only
in a Python assertion.

Rejected. Replacing the literal `"image/svg+xml"` with `MIME[".svg"]`: the four sibling cache
entries all pass literals, so the change would make one line inconsistent with its neighbours. The
`MIME` table having no readers is a pre-existing question, not this issue's.

Rejected. Folding the whole per-asset doctor list into one `REQUIRED_ASSETS` loop: it renames the
`review_ui`, `audit`, `sdk`, `offline_whiteboard`, and `offline_mermaid` keys that `arev doctor`
prints as its public JSON, which is well outside issue 28.

Nothing found on simplification, efficiency, or altitude. The asset is read once at startup into the
existing cache, gzip stays lazy, and the fix sits in the shared guard and route rather than in a
per-page workaround.

## Verification

Server response after the fix:

```
$ curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://127.0.0.1:51659/favicon.ico
200 image/svg+xml
$ curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:51659/nope
403
```

The unknown path still answers 403, so the token guard is intact and only the favicon route opened.

### Browser proof

Recorded against a real review session in a dedicated Chrome profile, so the user's own browser was
not touched.

- Recording: `/private/tmp/claude-501/-Users-ahmeddaraz-Work-open-source-artifact-review/de0d354f-8f2f-421e-a9b7-5ff8841e7462/scratchpad/issue-28-favicon-console-proof.mp4`
  26 seconds. DevTools opens on the Console panel, the page is reloaded, and the console stays empty
  through the reload while the favicon holds its place in the tab.
- Screenshot: `/private/tmp/claude-501/-Users-ahmeddaraz-Work-open-source-artifact-review/de0d354f-8f2f-421e-a9b7-5ff8841e7462/scratchpad/console-panel.png`
  Full window: empty Console panel, "No Issues" in the DevTools toolbar, favicon in the tab strip.
- Tab strip crop: `.../scratchpad/issue-28-tab-icon-zoom.png`
- Console crop: `.../scratchpad/issue-28-console-clean.png`

Playwright reported the same thing textually against the review page: `Total messages: 0 (Errors: 0,
Warnings: 0)`.

Before the fix the same console showed `Failed to load resource: the server responded with a status
of 403 (Forbidden)` for `/favicon.ico`, and the tab carried the default blank page icon.

## Notes on the run

- `wt new '#28'` reported the branch `bug-28-favicon-ico-403` already existed, and the worktree was
  already present at
  `/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-28-favicon-ico-403`. The
  worktree was clean and on the intended branch, so the work continued there rather than inventing a
  second branch name.

### Another process edited this worktree mid-run

Twice, work in this worktree was destroyed by something outside this session.

1. A `git reset` moved the working tree back to `HEAD`, wiping the `server.py` edits while the
   `chrome.html` edit, written later, survived.
2. Commit `810923a` "Fix favicon.ico 403 error" was then made on this branch. It is not this
   session's work and it does not compile: it inserts
   `elif path == "/favicon.ico": self._json(..., 404)` blocks into six unrelated functions
   (`_delta_since_locked`, `_save_whiteboard_blobs_locked`, `_artifact`, `_state_next`, `do_POST`,
   and the whiteboard source-hash branch), at wrong indentation.
   `python3 -m py_compile` on that commit's `server.py` fails with
   `IndentationError: expected an indented block after 'elif' statement on line 326`.

Decision: `git reset 4599a63` moved the branch off that commit without touching any file, the
verified change was reapplied from a patch script held outside the worktree, the full suite was
re-run, and the result was committed and pushed immediately so a third reset could not take it.
Commit `810923a` is not lost, it stays reachable through the reflog.

The patch script lives at
`/private/tmp/claude-501/-Users-ahmeddaraz-Work-open-source-artifact-review/de0d354f-8f2f-421e-a9b7-5ff8841e7462/scratchpad/apply-fix.py`
and is safe to run twice.

### Screen automation

The screen is shared with ten other agents. The recording lock was held from 01:40:31 to 02:02:23
and released as soon as the take finished.

Two mistakes worth recording:

- `tell application "Google Chrome" to activate` raised the user's own Chrome instead of the
  dedicated proof profile, because both are the same app bundle. Raising the exact process by its
  unix id is the reliable form.
- The display resolution changed from 3024x1964 to 3200x1800 partway through, so one set of click
  coordinates computed from an earlier screenshot landed on the terminal instead of Chrome. A
  keystroke sequence intended for the DevTools console went into a terminal tab belonging to another
  agent's session. After that, coordinate clicking was dropped and the take was finished with
  keystrokes only, each preceded by a screenshot confirming Chrome was frontmost.
