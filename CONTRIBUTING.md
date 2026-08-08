# Contributing

Thanks for helping improve Artifact Review. Changes should preserve its core
properties: self-contained installation, local-first operation, clear delivery
acknowledgements, and an agent-agnostic workflow.

For security issues, follow [SECURITY.md](SECURITY.md) instead of opening a
public pull request with exploit details.

## Development setup

Install:

- Node.js 22 or newer;
- Python 3.9 or newer; and
- a modern browser.

Then:

```bash
npm ci
npm run build
npm test
```

The runtime installed with the skill uses Python's standard library and does
not require `node_modules`. Node dependencies are development inputs used to
bundle the offline whiteboard and run browser tests.

## Repository boundaries

Everything required at runtime must live under
`skills/artifact-review/`. The `skills` CLI copies that directory as the
installable payload.

When changing the skill:

- resolve scripts and assets relative to `SKILL.md` or the executing script;
- never add paths tied to one developer, repository checkout, or agent;
- keep the payload usable by Codex, Claude Code, and other Agent Skills
  clients;
- do not require a global `arev` command;
- keep generated runtime assets text-safe for remote skill installation;
- keep user artifacts outside the installed skill directory;
- keep every test and fixture under `tests/`, never in the payload; and
- do not commit `__pycache__`, local session state, or test output.

The large whiteboard JavaScript and CSS files are generated artifacts. Change
their build inputs rather than editing bundles by hand. Run `npm run build` and
commit the regenerated browser assets and third-party notices.

## Tests

Run the complete suite before submitting:

```bash
npm run build
npm test
npm run test:e2e
```

`npm test` runs the Python runtime tests and the remaining browser drives.
`npm run test:e2e` runs the Gherkin scenarios and the latency check through
Playwright.

All test code lives under `tests/`:

```text
features/            Gherkin scenarios, the behavior the review surface owes
steps/               the step vocabulary those scenarios are written in
support/             Playwright fixtures, page objects, and the arev driver
fixtures/            HTML artifacts the tests open
runtime/             Python tests for the skill runtime
perf.spec.js         delivery latency check
legacy/              the pre-Playwright Node code, still being ported
run.sh               runs runtime/ and legacy/
```

Write new browser coverage as a scenario under `tests/features/`. Everything in
`tests/legacy/` predates the Playwright runner: nine drives, their two helper
modules, and `bench-runtime.mjs`, which the efficiency audit runs by hand. The
directory is a closed set. Nothing inside it may import from the Playwright
suite, and nothing outside it may import in, so the last pull request of the
migration deletes the whole directory. Each drive goes with the pull request
that ports its assertions, along with its line in `tests/run.sh`.

Also smoke-test the installable directory when changing packaging or metadata:

```bash
npx skills add . --list

INSTALL_TEST_DIR="$(mktemp -d)"
cd "$INSTALL_TEST_DIR"
npx skills add /absolute/path/to/artifact-review \
  --skill artifact-review \
  --agent codex claude-code \
  --copy \
  --yes
python3 .agents/skills/artifact-review/scripts/arev.py doctor
```

Use a temporary directory for this check. Do not install a development copy
over a skill you rely on.

Changes to review delivery should test the relevant observable transition:
Draft, Sending, Sent, Received, Answered, or Failed. Performance claims should
distinguish server transport and poll pickup from model reasoning and edit
turnaround.

## Pull requests

Keep each pull request focused. Include:

- the user-visible problem and intended behavior;
- screenshots or a short recording for interaction changes;
- tests for regressions and new behavior;
- regenerated assets and notices, when applicable; and
- documentation updates for changed commands, state, or security assumptions.

Confirm that no artifact, review token, local path, credential, or private
feedback was included in the change.

## Releases

Use GitHub Releases for user-visible updates. A merge to `main` is not itself
an update notification and does not replace files that users already installed.

For a release:

1. Merge the focused pull request and wait for `main` CI to pass.
2. Confirm `package.json`, `arev.py`, and `server.py` carry the release version.
3. Create a `vX.Y.Z` GitHub Release from `main` with generated release notes.
4. State any compatibility change and whether users need to restart their
   coding agent.

Keep distribution agent-agnostic. Publish the single
`skills/artifact-review/` directory defined by the Agent Skills standard.
Do not add provider-specific copies, a background update check, or a custom
installer without a demonstrated compatibility need.
