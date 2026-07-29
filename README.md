# Artifact Review

Artifact Review gives an AI coding agent a local browser review loop for the
HTML artifacts it creates. A reviewer can annotate text or elements, make
structured choices, chat, edit diagram whiteboards, and watch the artifact
reload as the agent applies feedback.

The review server is local-first, has no cloud relay, and never edits the
artifact itself. The agent remains the author of the file on disk.

## Install

Artifact Review follows the open [Agent Skills](https://agentskills.io)
directory format. Install it into the current project with the `skills` CLI:

```bash
npx skills add AhmedDaraz-Ignite/artifact-review --skill artifact-review
```

To install explicitly for both Codex and Claude Code:

```bash
npx skills add AhmedDaraz-Ignite/artifact-review \
  --skill artifact-review \
  --agent codex claude-code \
  --yes
```

Use `--global` for a user-level installation:

```bash
npx skills add AhmedDaraz-Ignite/artifact-review \
  --skill artifact-review \
  --agent codex claude-code \
  --global \
  --yes
```

A project-level install is recommended when teammates should get the same
review workflow. The nested `skills/artifact-review/` layout is intentional:
the skill, scripts, playbooks, and browser assets are installed as one
self-contained directory.

Requirements:

- Python 3.9 or newer
- A modern browser for the interactive review surface
- Node.js 22.20 or newer for installation through `npx skills`

The installed review runtime itself uses only Python's standard library and
bundled browser assets. It does not need an npm install.

## Use from an agent

Ask the agent to invoke the skill by name:

> Use `$artifact-review` to create or open this report for visual review, then
> apply my feedback until I approve it.

The skill instructs the agent to locate its own `SKILL.md` and run the bundled
launcher relative to that file. This matters because different agents install
skills in different directories; a global `arev` command is neither installed
nor required.

The normal loop is:

1. The agent creates or updates an HTML artifact in your project.
2. Artifact Review opens a tokenized local review URL.
3. The agent waits in a foreground long poll.
4. You add review items and select **Send now**.
5. The agent receives the batch, edits the source artifact, and replies with a
   short summary.
6. The browser live-reloads the updated file and the loop continues.

Review items may be text selections, element annotations, native form choices,
chat messages, or diagram whiteboard edits. Multiple queued items are sent as
one feedback event so related comments reach the agent together.

## Manual CLI

For diagnostics or manual operation, first locate the installed
`artifact-review/SKILL.md`. Use the launcher next to it:

```bash
SKILL_ROOT="/absolute/path/to/artifact-review"
AREV="$SKILL_ROOT/scripts/arev"
ARTIFACT="/absolute/path/to/report.html"

"$AREV" doctor
"$AREV" open "$ARTIFACT"
"$AREV" poll "$ARTIFACT" --timeout 300
"$AREV" reply "$ARTIFACT" "Applied the requested changes."
```

On Windows, use `scripts\arev.cmd`. `ARTIFACT_REVIEW_HOME` can override the
default local state directory, `~/.artifact-review`.

Useful commands:

```text
arev doctor                  verify the installed runtime and browser assets
arev design                  print general artifact design guidance
arev playbook                list artifact-specific playbooks
arev sessions                list known local sessions
arev export FILE [-o FILE]   create a portable single-file HTML export
arev end FILE                end the review as the agent
arev stop FILE               stop one local server
arev stop --all              stop every local Artifact Review server
```

The agent should run `poll` in the foreground. Starting repeated `open`
commands or background polling loops makes delivery state ambiguous and can
delay feedback pickup.

## Delivery states and latency

The review rail exposes the complete lifecycle of a feedback batch:

| State | Meaning |
| --- | --- |
| Draft | Queued in the browser but not persisted as a feedback event |
| Sending | The browser request is in flight |
| Sent | The local server durably persisted the event |
| Received | The agent's foreground poll claimed and acknowledged the event |
| Answered | The agent posted a reply after handling the event |
| Failed | Sending failed; the draft remains available to retry |

Those states separate local transport from agent turnaround:

- **Persistence transport** ends at `sent_at`.
- **Pickup latency** is `delivered_at - sent_at`.
- **Agent turnaround** is `answered_at - delivered_at` (or the subsequent
  artifact reload when measuring the visible edit).
- **End-to-end feedback time** is `answered_at - sent_at`.

`Sent` can be nearly immediate while `Received` waits for an active foreground
poll. Likewise, a fast `Received` does not imply an instant `Answered`: model
scheduling, reasoning, tool calls, and file edits happen after transport has
finished. Measure these phases separately when investigating performance.

## Remote and headless environments

For a remote development host, choose the forwarded port and browser-facing
URL before the first `open`:

```bash
"$AREV" open "$ARTIFACT" \
  --no-browser \
  --bind 0.0.0.0 \
  --port 4173 \
  --public-url "https://your-authenticated-forward.example"
```

The command prints a `SESSION` URL containing the review token. Open that URL
through an authenticated port forward supplied by your development platform.
`--public-url` only changes the URL shown to the browser; it does not create a
tunnel, TLS, authentication, or access control.

If no browser endpoint can safely reach the review server, export a portable
HTML file:

```bash
"$AREV" export "$ARTIFACT" -o "$ARTIFACT.portable.html"
```

Share the export through an approved channel and collect feedback in the normal
agent conversation. Portable export is a fallback, not a live annotation
session.

## Security

Artifact Review binds to `127.0.0.1` by default and guards controller requests
with a random session token and Host validation. The artifact runs in a
sandboxed opaque-origin iframe and does not receive that token. Treat the full
session URL as a bearer secret. The sandbox narrows access; it does not make
hostile HTML safe, so review only content you authored, generated, or otherwise
trust.

Do not expose `--bind 0.0.0.0` directly to the public internet. Use a private,
authenticated port forward and stop the session when review is finished. See
[SECURITY.md](SECURITY.md) for the threat model, safe remote operation, state
storage, exports, and vulnerability reporting.

## Development

Clone the repository, then run:

```bash
npm ci
npm run build
npm test
```

`npm run build` bundles the offline whiteboard assets and regenerates
third-party notices. It embeds Excalidraw's compact fonts and uses the
browser's installed CJK fallback instead of adding Xiaolai's 12 MB shard set,
keeping the complete installable skill below 10 MB with no font network
requests. `npm test` exercises the Python server, browser review surface,
delivery lifecycle, export path, and installation assumptions.

Repository layout:

```text
skills/artifact-review/   the complete installable skill payload
tooling/                  asset and notice generation
tests/                    integration and browser tests
PRODUCT.md                product behavior and constraints
DESIGN.md                 interaction and visual design direction
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change.

## License

Artifact Review is released under the [MIT License](LICENSE). Bundled
third-party components and their licenses are listed in
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
