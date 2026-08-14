# Remote and headless environments

Artifact Review can run on a remote development host when the review URL is
reachable through an authenticated port forward supplied by the development
platform.

The runtime does not provide a tunnel, TLS termination, authentication,
authorization, or public hosting. Configure those boundaries before opening a
session.

## Open a remote session

Choose the forwarded port and browser-facing URL before the first `open`:

```bash
"$AREV" open "$ARTIFACT" \
  --no-browser \
  --bind 0.0.0.0 \
  --port 4173 \
  --public-url "https://your-authenticated-forward.example"
```

The command prints a `SESSION` URL containing the review token. Open that URL
through the authenticated port forward.

`--public-url` changes only the URL presented to the browser. It does not
create a tunnel, add TLS, or restrict access to the listening port.

## Operate safely

1. Use an authenticated, access-controlled port forward.
2. Bind only to the interface required by that forward.
3. Keep the tokenized session URL private.
4. Review only HTML you authored, generated, or otherwise trust.
5. Stop the review server when the session is complete.

Do not expose `--bind 0.0.0.0` directly to the public internet. Anyone who can
reach the port and obtain the session URL can access the review.

Read [SECURITY.md](../SECURITY.md) for the complete threat model, state-storage
guidance, and safe remote-operation boundaries.

## Portable export fallback

If no browser endpoint can safely reach the review server, create a portable
HTML file:

```bash
"$AREV" export "$ARTIFACT" -o "$ARTIFACT.portable.html"
```

Share the export through an approved channel and collect feedback in the normal
agent conversation. Portable export is a static fallback, not a live
annotation session.

An export may inline local styles, scripts, images, or other referenced
content. Inspect it before sharing because it can contain sensitive information
that was not obvious in the rendered page.
