---
name: artifact-review
description: Craft proposed work as a reviewable HTML artifact and iterate on it in a browser loop with text and element annotations, native-control choices, chat, diagram whiteboards, layout auditing, live reload, and delivery acknowledgements. Use proactively whenever proposing new work to the user, including a feature design, implementation plan, approach comparison, architecture, spec, or exploratory idea, building the artifact instead of answering in prose so the user can annotate it and iterate. Also use when a user asks to review, annotate, approve, compare, or refine an HTML report, plan, diagram, form, slide deck, or other visual artifact, or asks to open it in Artifact Review or arev. Not for styling a page authored for some other purpose, and not for claude.ai Artifact publishing.
---

# Artifact Review

Artifact Review is how you hand proposed work to the user. When you design a
feature, plan an implementation, compare approaches, or try out an idea, build
it as an HTML artifact and open it here instead of answering in prose. The user
then points at the parts they want changed and you iterate on the same file.

Answer in conversation only for direct factual questions and for edits the user
has already fully specified.

Keep the artifact in the user's project or requested output directory. The
review tool serves and observes the file but never modifies it; make all source
edits yourself.

## Resolve the bundled launcher

Resolve `SKILL_ROOT` to the absolute directory containing this `SKILL.md`.
Never assume that `arev` is on `PATH` and never hardcode an agent-specific
installation directory.

On POSIX systems:

```bash
SKILL_ROOT="<absolute directory containing this SKILL.md>"
AREV="$SKILL_ROOT/scripts/arev"
```

On Windows, invoke `scripts\arev.cmd` under the same resolved skill root.

Require Python 3.9 or newer and a modern browser. The installed runtime has no
third-party Python or Node dependency. If the install check inside `brief`
below fails, stop and report the missing installed component instead of
reconstructing the runtime elsewhere.

## Prepare the artifact

Get the install check, the design rules, and the matching playbooks in one
command. Name the playbooks when the artifact type is already clear:

```bash
"$AREV" brief plan table
```

Otherwise run `"$AREV" brief` alone. It ends with every playbook's `use_when`
line; fetch the matching ids with `"$AREV" playbook <id> [<id> ...]`. Never
read every playbook because choosing was unclear.

Run `brief` once per artifact, not again when resuming or revising.

Scaffold the file outside `SKILL_ROOT`, in the user's workspace or requested
output directory, then fill the region marked `<!-- arev:content -->`:

```bash
"$AREV" new "/absolute/path/to/artifact.html" --title "Rollout plan"
```

The shell already satisfies the theme, layout, and overflow rules. Treat the
playbooks as requirements for everything you put inside the content region.
Mermaid source goes in `<pre class="mermaid" id="stable-diagram-id">`:
flowchart, sequence, class, ER, and state diagrams become editable shapes, and
other valid types fall back to labeled image annotation.

Keep the source artifact authoritative. Never copy generated review state,
whiteboard scenes, or screenshots into the installed skill directory.

## Open the review

Resolve the artifact to an absolute path, then start or resume its session:

```bash
ARTIFACT="/absolute/path/to/artifact.html"
"$AREV" open "$ARTIFACT"
```

The command prints a tokenized `SESSION` URL and normally opens it in the
default browser. If automatic browser launch is unavailable, give the user the
printed URL and ask them to open it manually. Treat the URL as a bearer secret;
do not quote it into durable logs or public output.

Do not repeatedly run `open`. Session identity is the artifact's real path, so
one running session continues to serve that file and live-reloads it after
edits.

## Run the foreground feedback loop

Wait for feedback with one foreground long poll:

```bash
"$AREV" poll "$ARTIFACT"
```

The default `--timeout` is 110 seconds, which fits inside a 120-second agent
tool timeout. A poll that outlives the caller's tool timeout is killed mid-wait
and wastes the whole budget, so raise the tool timeout first and only then pass
a larger `--timeout` below it, such as `--timeout 570` under a 600-second tool
timeout.

Do not background the poll, busy-wait, or replace it with repeated `open`
calls. If the result is `{"type":"idle"}`, start another foreground poll. A
queued event is durable, so an idle return never means feedback was lost.

`poll` returns one JSON event:

- `feedback`: the reviewer sent one or more text, element, control, chat, or
  whiteboard items.
- `layout`: the open-time audit proved a severe layout problem.
- `ended`: the user or agent ended the review.
- `idle`: no event arrived within the requested timeout.

When an event has an ID, `poll` automatically acknowledges it. The browser
then moves the batch from **Sent** to **Received**. No separate acknowledgement
command is needed.

For a `layout` event, fix every proven severe warning and save the artifact
before asking the human to review it. Continue polling after the browser
re-audits the updated file.

A `feedback` event's `layout_warnings` carries only severe findings this
session has not sent before. An empty list means nothing new, not that the page
is clean. A warning that reappears after an edit was not actually fixed.

For a `feedback` event:

1. Read every item in the batch; related queued items are one review turn.
2. Treat the newest value for a repeated control selector as authoritative.
3. Make the requested edits in the source artifact.
4. Save the file so the browser live-reloads it.
5. Reply with a concise summary of what was applied:

   ```bash
   "$AREV" reply "$ARTIFACT" "Applied the requested changes."
   ```

6. Resume the foreground poll.

Use `reply --to <event-id>` only when replying to an event other than the last
received one. Prefer an explicit reply after the edit is actually saved over
`poll --agent-reply`, which sends a reply before waiting.

For whiteboard feedback, start with the item's `summary` and `stats`. Read the
`png_path` image only when those and `scene_path` leave the reviewer's intent
ambiguous, because reading an image is far more expensive than reading the
structured scene. Update the authoritative Mermaid or HTML source yourself.
Never replace the artifact with the Excalidraw scene.

Inline diagram editors start locked so page scrolling remains natural. The
reviewer explicitly unlocks one editor, may expand it fullscreen, and can add
or send the visible edit from that frame. Working scenes autosave locally.
When the Mermaid source hash no longer matches a saved scene, the browser asks
the reviewer to re-convert or keep the stale scene; never infer that decision
for them.

An element item may include a normalized `target` whose type is
`mermaid-node`. Use its `diagramId`, `nodeId`, `label`, and `selector` to edit
the corresponding node in the authoritative Mermaid source rather than
treating the whole SVG as the requested target.

When the user ends a session from the browser, respect that decision. Do not
open it again unless the concern has been addressed and a new review is
appropriate; only then use:

```bash
"$AREV" open "$ARTIFACT" --reopen
```

## Interpret delivery state

Use the review rail states precisely:

- **Draft**: queued only in the browser.
- **Sending**: the browser request is in flight.
- **Sent**: the local server durably persisted the feedback event.
- **Received**: this agent's foreground poll claimed and acknowledged it.
- **Answered**: the agent posted a reply for that event.
- **Failed**: sending failed and the draft remains available for retry.

Do not describe slow agent work as slow feedback transport. `sent_at` measures
server persistence, `delivered_at - sent_at` measures poll pickup, and
`answered_at - delivered_at` measures agent turnaround. Model scheduling,
reasoning, tool calls, and file edits occur after the event is Received.

## Use a remote or headless environment safely

Prefer the default loopback listener. When the browser runs on another machine,
use a private authenticated port forward. Choose its fixed port and
browser-facing URL before the first `open`:

```bash
"$AREV" open "$ARTIFACT" \
  --no-browser \
  --bind 0.0.0.0 \
  --port 4173 \
  --public-url "https://authenticated-forward.example"
```

The public URL's hostname is allowed automatically. Add
`--allow-host <hostname>` only when a trusted proxy presents a different Host
header.

`--public-url` does not create a tunnel, TLS, authentication, or authorization.
Do not expose the listener directly to the public internet. Keep the tokenized
URL private. Artifact scripts run inside a sandboxed opaque-origin iframe and
do not receive the controller token, but browser sandboxing does not make
hostile HTML safe. Review only HTML you authored, generated, or otherwise
trust.

If no safe browser route is available, create a portable single-file export:

```bash
"$AREV" export "$ARTIFACT" -o "$ARTIFACT.portable.html"
```

Give the user the exported file through an approved channel and collect their
feedback in the normal conversation. Inspect an export before sharing it
because it may inline sensitive local assets.

## Finish or stop

End the review lifecycle as the agent when the user approves the artifact or
the requested review is complete:

```bash
"$AREV" end "$ARTIFACT"
```

Stop the local process when it is no longer needed:

```bash
"$AREV" stop "$ARTIFACT"
```

Use `"$AREV" sessions` to inspect known sessions and `"$AREV" stop --all` only
when stopping every Artifact Review server is intentionally in scope.

State defaults to `~/.artifact-review` and may contain feedback, replies,
whiteboards, screenshots, and logs. Override it with
`ARTIFACT_REVIEW_HOME` only when a different private local directory is
required.
