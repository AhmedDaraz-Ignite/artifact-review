# Artifact Review

Artifact Review gives an AI coding agent a local browser loop for reviewing the
HTML artifacts it creates. You can annotate content, edit text, make structured
choices, chat, revise diagrams, and watch the same artifact reload as the agent
applies your feedback.

## Quick start

You need Python 3.9 or newer, Node.js 22.20 or newer for installation, and a
modern browser.

1. Install Artifact Review in the current project:

   ```bash
   npx skills add arDaraz/artifact-review --skill artifact-review
   ```

2. Ask your coding agent to open an artifact for review:

   > Use `$artifact-review` to create or open this report for visual review,
   > then apply my feedback until I approve it.

3. Review the artifact in the browser. Add feedback, select **Send now**, and
   watch the page reload when the agent updates the source.

Artifact Review is installed as an [Agent
Skill](https://agentskills.io). Project installation is recommended for shared
workflows. See [Installation and maintenance](docs/installation.md) for global
installation, explicit agent selection, updates, and removal.

## What you can review

- **Text and elements:** select words, point to an element, or leave a precise
  comment.
- **Direct text edits:** rewrite or delete text yourself, then either save the
  edit to the artifact or send it to the agent.
- **Structured choices:** answer native form controls without translating the
  selection into prose.
- **Conversation:** send chat messages alongside visual feedback.
- **Diagrams:** annotate Mermaid output or convert supported diagrams into an
  editable whiteboard.

Multiple drafts are delivered as one feedback batch so related comments stay
together. The review rail labels drafts and activity as Draft, Sending, Sent,
Received, Answered, Applied, or Failed.

See the [User guide](docs/user-guide.md) for text-editing behavior, diagram
support, delivery states, reports, archives, and local review history.

## Remote and headless environments

Artifact Review can run behind an authenticated port forward when the browser
is not on the development host. It does not provide a tunnel, TLS, or access
control of its own, so never expose its listening port directly to the public
internet.

See [Remote and headless environments](docs/remote.md) for setup and portable
export fallback instructions.

## Documentation

| Guide | Use it for |
| --- | --- |
| [User guide](docs/user-guide.md) | Review workflow, text editing, diagrams, delivery states, reports, and history |
| [Installation and maintenance](docs/installation.md) | Install scopes, updates, uninstall, and local data |
| [CLI reference](docs/cli.md) | Manual operation, diagnostics, and command reference |
| [Remote environments](docs/remote.md) | Port forwarding, headless operation, and portable exports |
| [Architecture](docs/architecture.md) | Storage, runtime efficiency, and latency measurement |
| [Security](SECURITY.md) | Threat model, safe operation, and vulnerability reporting |
| [Contributing](CONTRIBUTING.md) | Development setup, tests, repository rules, and releases |

## Security and privacy

Artifact Review binds to `127.0.0.1` by default and protects each session with
a random token. Treat the full session URL as a bearer secret, and review only
HTML that you authored, generated, or otherwise trust. The browser sandbox
narrows access but does not make hostile HTML safe.

Read [SECURITY.md](SECURITY.md) before remote operation or when handling
sensitive artifacts.

## Contributing

Development setup, testing requirements, generated-asset rules, and release
instructions live in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Artifact Review is released under the [MIT License](LICENSE). Bundled
third-party components and their licenses are listed in
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
