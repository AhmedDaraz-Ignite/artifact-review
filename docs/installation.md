# Installation and maintenance

Artifact Review follows the open [Agent Skills](https://agentskills.io)
directory format. The `skills` CLI installs the complete
`skills/artifact-review/` directory, including its instructions, scripts,
playbooks, and browser assets.

## Requirements

- Python 3.9 or newer
- Node.js 22.20 or newer for installation through `npx skills`
- A modern browser for the interactive review surface

The installed runtime uses Python's standard library and bundled browser
assets. It does not require `npm install` or a global `arev` command.

## Choose an installation scope

### Project installation

Project scope is recommended when teammates should get the same review
workflow:

```bash
npx skills add arDaraz/artifact-review --skill artifact-review
```

To explicitly install for both Codex and Claude Code without interactive
prompts:

```bash
npx skills add arDaraz/artifact-review \
  --skill artifact-review \
  --agent codex claude-code \
  --yes
```

### Global installation

Use `--global` for a user-level installation:

```bash
npx skills add arDaraz/artifact-review \
  --skill artifact-review \
  --agent codex claude-code \
  --global \
  --yes
```

Reload the coding agent after installation so it discovers the skill.

## Update

Merging a repository change does not update existing installations. Watch the
GitHub repository with **Custom** → **Releases** to receive release
announcements.

After a release, update the scope where Artifact Review was installed:

```bash
# Project installation
npx skills update artifact-review --project

# Global installation
npx skills update artifact-review --global
```

Reload the coding agent after updating so it reads the refreshed `SKILL.md`,
scripts, playbooks, and browser assets. Artifact Review performs no background
update checks and has no agent-specific updater.

## Uninstall

Stop every running review server before removing the skill. The launcher is
removed with the installation, so it cannot stop an old server afterward.

First locate the installed `artifact-review/SKILL.md`, then run the launcher
next to it:

```bash
SKILL_ROOT="/absolute/path/to/artifact-review"
"$SKILL_ROOT/scripts/arev" stop --all
```

On Windows, use `scripts\arev.cmd`.

Then remove the skill from the relevant scope:

```bash
# Project installation
npx skills remove artifact-review

# Global installation
npx skills remove artifact-review --global
```

Project scope is the default, so `remove` has no `--project` flag. Running
`npx skills remove` without a skill name opens an interactive picker.

## Local review data

Removing the skill leaves review history in place. Sessions, replies, diagram
scenes, previews, and logs live under `~/.artifact-review`, or under the
directory selected by `ARTIFACT_REVIEW_HOME`.

Delete that directory separately only when you also want to remove the review
history. Do not point `ARTIFACT_REVIEW_HOME` at a shared or world-readable
directory.
