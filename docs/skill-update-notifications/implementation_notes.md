# Implementation notes

## Decisions

- Keep `skills/artifact-review/` as the single installable Agent Skills
  payload.
- Use GitHub Releases for opt-in notifications.
- Use the existing `skills` CLI for project and global updates.
- Keep releases manual until repeated work justifies automation.

## Alternatives rejected

- A custom Artifact Review installer or updater would duplicate the standard
  `skills` CLI.
- A runtime update check would add network behavior to a local-first tool.
- Provider-specific copies would create drift without adding current
  compatibility value.

## User direction

- Keep the repository setup simple.
- Remain agent-agnostic and follow the Agent Skills standard.
- Ignore the QbDVision-specific PR generator.

## Verification

- Confirmed the standard directory and `SKILL.md` requirements against the
  Agent Skills specification.
- Confirmed project and global update flags against the current `skills` CLI
  documentation.
- `npm ci` completed with zero reported vulnerabilities.
- `npm run build` completed and left generated assets unchanged.
- `quick_validate.py skills/artifact-review` reported `Skill is valid!`.
- `npx --yes skills@1.5.19 add . --list` discovered `artifact-review`.
- `npm test` completed with `SELFTEST: PASS`.
- `git diff --check` passed.
