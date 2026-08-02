# Artifact Review runtime

Read this reference only for setup, lifecycle, delivery-state, whiteboard, or
recovery details. The compact workflow stays in `SKILL.md`.

## Installation and authoring

Artifact Review requires Python 3.9+ and a modern browser; its installed
runtime has no third-party Python or Node dependency. If `brief` reports a
failed install check, report the missing component instead of rebuilding the
runtime elsewhere. `doctor` prints the full diagnostic paths and checks.

Run `brief` once per artifact, then `new`. The scaffold already supplies theme,
dark mode, overflow, focus, and reading-width rules. Treat every selected
playbook as a requirement for content inside the marked region. Do not write
review state, generated whiteboard scenes, or screenshots into the skill.

Flowchart, sequence, class, ER, and state Mermaid diagrams become editable
shapes. Other valid Mermaid types use a labeled image-annotation fallback.

## Sessions and polling

Session identity is the artifact's real path. `open` starts or reuses its one
server and live-reloads source saves. `poll` long-waits for one durable event;
an event with an id is acknowledged automatically. The review panel then moves
that delivery from **Sent** to **Received**.

The default `poll --timeout 110` belongs under a tool timeout longer than 110
seconds. For example, use `--timeout 570` only under a 600-second tool timeout.
A killed poll wastes its wait but does not erase a queued event.

Prefer `reply` after the source edit is saved. `reply --to EVENT_ID` targets an
event other than the last received one. `poll --agent-reply` posts before it
waits, so use it only when that ordering is intended.

## Delivery states

- **Draft**: only in the browser queue.
- **Sending**: request in flight.
- **Sent**: local server persisted the event.
- **Received**: the foreground poll claimed and acknowledged it.
- **Answered**: the agent posted a reply for that event.
- **Failed**: sending failed; the browser kept the draft for retry.

`sent_at` measures persistence, `delivered_at - sent_at` measures poll pickup,
and `answered_at - delivered_at` measures agent turnaround. Agent scheduling,
reasoning, tools, and edits happen after Received.

## Whiteboard lifecycle

Diagram hosts are cheap until the reviewer activates one. One shared sandboxed
editor frame moves between diagrams; the active scene flushes before a switch
or artifact reload. Working scenes autosave privately. If Mermaid source and a
saved scene have different hashes, the browser asks the reviewer to re-convert
or keep the older scene. Never make that choice for them.

Whiteboard feedback contains a concise `summary`, structured `stats`, a
`scene_path`, and usually a `png_path`. Start with summary and stats, inspect
the structured scene if needed, and read the PNG only when intent is still
ambiguous. Update the authoritative Mermaid/HTML; never replace it with the
Excalidraw scene.

## End and reopen

Respect a browser-ended session. Do not reopen it until the concern has been
addressed and a new review is appropriate. Then use:

```bash
"$AREV" open "$ARTIFACT" --reopen
```

Agent completion uses `"$AREV" end "$ARTIFACT"`. Process cleanup uses
`"$AREV" stop "$ARTIFACT"`; use `stop --all` only when stopping every review
server is intentionally in scope.

State defaults to `~/.artifact-review` and may contain feedback, replies,
scenes, previews, and logs. Override `ARTIFACT_REVIEW_HOME` only for another
private local directory.
