#!/usr/bin/env python3
"""Inline local img/link/script references in an HTML file into one portable file."""
import base64
import mimetypes
import os
import re
import sys

MIME_MAP = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
}

IMG_SRC_RE = re.compile(r'(<(?:img|source)\b[^>]*?\ssrc\s*=\s*)(["\'])(.*?)\2', re.IGNORECASE)
LINK_TAG_RE = re.compile(r"<link\b[^>]*>", re.IGNORECASE)
REL_STYLESHEET_RE = re.compile(r'\brel\s*=\s*(["\'])stylesheet\1', re.IGNORECASE)
HREF_ATTR_RE = re.compile(r'\bhref\s*=\s*(["\'])(.*?)\1', re.IGNORECASE)
SCRIPT_SRC_TAG_RE = re.compile(
    r'<script\b[^>]*\ssrc\s*=\s*(["\'])(.*?)\1[^>]*>\s*</script>', re.IGNORECASE
)
CSS_URL_RE = re.compile(r'url\(\s*(["\']?)(.*?)\1\s*\)')


def _guess_mime(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in MIME_MAP:
        return MIME_MAP[ext]
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


def _is_remote_or_data(url):
    u = url.strip()
    return u.startswith(("http://", "https://", "data:", "//"))


def _resolve_local(url, base_dir):
    clean = url.split("#", 1)[0].split("?", 1)[0]
    return clean if os.path.isabs(clean) else os.path.normpath(os.path.join(base_dir, clean))


def _read_as_data_uri(path, skipped):
    if not os.path.isfile(path):
        skipped.append(path)
        return None
    with open(path, "rb") as f:
        data = f.read()
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{_guess_mime(path)};base64,{b64}"


def _inline_css_urls(css_text, base_dir, skipped):
    def repl(m):
        quote, url = m.group(1), m.group(2)
        if _is_remote_or_data(url):
            return m.group(0)
        data_uri = _read_as_data_uri(_resolve_local(url, base_dir), skipped)
        return m.group(0) if data_uri is None else f"url({quote}{data_uri}{quote})"

    return CSS_URL_RE.sub(repl, css_text)


def export_html(src_path: str, out_path: str) -> dict:
    base_dir = os.path.dirname(os.path.abspath(src_path))
    with open(src_path, "r", encoding="utf-8") as f:
        html = f.read()

    skipped = []
    inlined = 0

    def img_repl(m):
        nonlocal inlined
        prefix, quote, url = m.group(1), m.group(2), m.group(3)
        if _is_remote_or_data(url):
            return m.group(0)
        data_uri = _read_as_data_uri(_resolve_local(url, base_dir), skipped)
        if data_uri is None:
            return m.group(0)
        inlined += 1
        return f"{prefix}{quote}{data_uri}{quote}"

    html = IMG_SRC_RE.sub(img_repl, html)

    def link_repl(m):
        nonlocal inlined
        tag = m.group(0)
        if not REL_STYLESHEET_RE.search(tag):
            return tag
        href_m = HREF_ATTR_RE.search(tag)
        if not href_m:
            return tag
        url = href_m.group(2)
        if _is_remote_or_data(url):
            return tag
        path = _resolve_local(url, base_dir)
        if not os.path.isfile(path):
            skipped.append(path)
            return tag
        with open(path, "r", encoding="utf-8") as f:
            css = f.read()
        css = _inline_css_urls(css, os.path.dirname(path), skipped)
        inlined += 1
        return f"<style>{css}</style>"

    html = LINK_TAG_RE.sub(link_repl, html)

    def script_repl(m):
        nonlocal inlined
        url = m.group(2)
        if _is_remote_or_data(url):
            return m.group(0)
        path = _resolve_local(url, base_dir)
        if not os.path.isfile(path):
            skipped.append(path)
            return m.group(0)
        with open(path, "r", encoding="utf-8") as f:
            js = f.read()
        inlined += 1
        return f"<script>{js}</script>"

    html = SCRIPT_SRC_TAG_RE.sub(script_repl, html)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    return {"inlined": inlined, "skipped": skipped}


def main():
    argv = sys.argv[1:]
    if not argv:
        print("usage: python3 export.py <input.html> [-o output.html]", file=sys.stderr)
        sys.exit(1)
    src = argv[0]
    if "-o" in argv:
        out = argv[argv.index("-o") + 1]
    else:
        base, ext = os.path.splitext(src)
        out = f"{base}.portable{ext or '.html'}"

    result = export_html(src, out)
    print(f"Wrote {out}")
    print(f"Inlined: {result['inlined']}")
    if result["skipped"]:
        print("Skipped:")
        for s in result["skipped"]:
            print(f"  {s}")


if __name__ == "__main__":
    main()
