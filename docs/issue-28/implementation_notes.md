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
- `bash tests/run.sh` passes end to end.

## Verification

Server response after the fix:

```
$ curl -s -D - -o /dev/null http://127.0.0.1:61545/favicon.ico | head -1
HTTP/1.0 200 OK
```

Browser proof is recorded below under "Proof".

## Notes on the run

- `wt new '#28'` reported the branch `bug-28-favicon-ico-403` already existed, and the worktree was
  already present at
  `/Users/ahmeddaraz/Work/open-source/worktrees/artifact-review/bug-28-favicon-ico-403`. The
  worktree was clean and on the intended branch, so the work continued there rather than inventing a
  second branch name.
- Midway through, the edits to `server.py` were reverted outside this session while `chrome.html`
  kept its edit. The change was reapplied and confirmed with `git diff --stat` before and after the
  next full test run.
