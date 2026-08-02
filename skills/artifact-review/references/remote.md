# Remote, headless, and portable review

Prefer loopback. When browser and agent are on different machines, create a
private authenticated port forward and choose its fixed port and browser URL
before the first open:

```bash
"$AREV" open "$ARTIFACT" \
  --no-browser \
  --bind 0.0.0.0 \
  --port 4173 \
  --public-url "https://authenticated-forward.example"
```

`--public-url` changes the browser-facing origin; it does not create a tunnel,
TLS, authentication, or authorization. It currently accepts an origin only,
not a path prefix. Add `--allow-host HOST` only when a trusted proxy presents a
different Host header. Never expose the listener directly to the public
internet, and keep the tokenized URL private.

The reviewed artifact runs in a sandboxed opaque-origin iframe and does not
receive the controller token. Tokenless SDK/editor assets remain Host-checked.
This boundary does not make hostile HTML safe: review only content you authored,
generated, or otherwise trust.

If no safe live route exists, build a portable copy:

```bash
"$AREV" export "$ARTIFACT" -o "$ARTIFACT.portable.html"
```

Inspect the export before sharing because local files may be inlined and could
contain sensitive data. Transfer it only through a channel the user approved,
then collect feedback in the normal conversation.
