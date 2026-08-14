# CLI reference

The CLI is primarily for agents, diagnostics, and manual operation. Artifact
Review does not install a global `arev` command.

## Locate the launcher

Find the installed `artifact-review/SKILL.md`, then use the launcher next to it:

```bash
SKILL_ROOT="/absolute/path/to/artifact-review"
AREV="$SKILL_ROOT/scripts/arev"
ARTIFACT="/absolute/path/to/report.html"
```

On Windows, use `scripts\arev.cmd`. Set `ARTIFACT_REVIEW_HOME` to override the
default local state directory, `~/.artifact-review`.

## Common review loop

```bash
"$AREV" doctor
"$AREV" open "$ARTIFACT"
"$AREV" poll "$ARTIFACT" --timeout 110
"$AREV" reply "$ARTIFACT" "Applied the requested changes."
```

The agent should run `poll` in the foreground. Repeated `open` commands or
background polling loops make delivery state ambiguous and can delay feedback
pickup.

Default poll output is compact, single-line JSON for agent consumption. Pass
`--pretty` only when a person needs expanded output.

## Commands

```text
arev doctor                  verify the installed runtime and browser assets
arev brief [PLAYBOOK ...]    print concise setup and selected guidance
arev new FILE --title TITLE  scaffold an audit-clean artifact shell
arev check FILE              audit diagrams and source coverage before opening
arev check FILE --source DOC --ignore "Section title"
arev design                  print general artifact design guidance
arev playbook                list artifact-specific playbooks
arev sessions                list known local sessions
arev export FILE [-o FILE]   create a portable single-file HTML export
arev report FILE             print a versioned JSON review report
arev report FILE --format markdown -o REVIEW.md
arev archive FILE -o REVIEW.zip
arev prune --older-than 30   preview old ended sessions
arev prune --older-than 30 --apply
arev end FILE                end the review as the agent
arev stop FILE               stop one local server
arev stop --all              stop every local Artifact Review server
```

`arev check` can compare the artifact with one or more source documents before
opening it. Use `--ignore "Section title"` only for a source section that is
intentionally absent from the artifact.

`arev export` creates a portable single-file HTML fallback. It is not a live
annotation session and can include sensitive content from referenced local
assets, so inspect it before sharing.

`arev prune` is a dry run unless `--apply` is present. It removes only eligible
ended, stopped sessions older than the selected threshold.

See the [User guide](user-guide.md) for the browser workflow and [Remote and
headless environments](remote.md) for port-forwarded operation.
