# Dead code cleanup

## Scope

Full repository on `main` at `1a6ac2b`. Discovery covered unreachable statements, unused
imports, locals, private symbols, files, dependencies, exported APIs, feature flags, routes,
and jobs. Consumer searches ran across every tracked file.

## Result

One candidate qualified: the direct `playwright` devDependency.

`@playwright/test@1.55.1` already depends on `playwright@1.55.1` and provides the `playwright`
binary, so the direct entry adds nothing. No source file imports `playwright`, and
`playwright-bdd` peers on `@playwright/test`, not on `playwright`.

Removing the entry leaves `node_modules/playwright@1.55.1` installed through
`@playwright/test`. The `package-lock.json` diff is a single line and `npx playwright install`
still resolves.

## Rejected candidates

| Candidate | Why it stays |
| --- | --- |
| `EVENT_SCHEMA` import in `arev.py` | Tests read it as `arev.EVENT_SCHEMA`. The import is the re-export. |
| `_ArtifactParser.handle_*`, `Handler.do_PUT`, `Handler.do_POST` | Framework dispatch in `HTMLParser` and `BaseHTTPRequestHandler`. |
| `inlined` in `export.py` | A `nonlocal` counter that the enclosing function returns. |
| `PUBLISHED_STATE`, `ASSET_HASHES` in `server.py` | Module globals rebound under a `global` statement. |
| `address_family` in `server.py` | A class attribute on the IPv6 server subclass. |
| Unittest classes and test methods | Discovered by name, never called directly. |
| `React`, `createRoot`, `Excalidraw`, `exportToBlob`, `exportToSvg` re-exports in `whiteboard-entry.mjs` | A public bundle surface served over HTTP with CORS. The consumer boundary is open. |
| `.b-ok`, `.b-warn`, `.b-bad` in `artifact-template.html` | An authoring surface the template offers to agents. |
| `tests/fixtures/diagram-features.html` | Loaded by name without its extension from `session.steps.js`. |

## Verification

Baseline and post-change runs used the same commands.

| Check | Baseline | After |
| --- | --- | --- |
| `npm run build` plus the generated-file diff gate | pass | pass |
| `skills/artifact-review/scripts/arev doctor` | pass | pass |
| `npm test` | pass, 6 of 6 | pass, 6 of 6 |
| `npm run test:e2e` | 88 passed, 2 failed | 88 passed, 2 failed |

Two end-to-end scenarios fail on `main` before any edit and fail the same way after it:

- `tests/features/diagram-audit.feature` - `A diagram that never rendered reaches the agent on its own`
- `tests/features/whiteboard-offline.feature` - `The whiteboard works with nothing but the review server`

Both report `bddTestData not found for test`. Repeated baseline runs, including runs after
deleting `.bdd-gen`, produced the same pair, so the failures are stable rather than flaky. GitHub
Actions runs the same scenarios green, so the cause is local to this machine. They are unrelated
to this change and are not fixed here.

## Rollback

Revert the commit. Nothing else in the repository changed.
