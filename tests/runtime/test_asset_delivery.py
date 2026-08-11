#!/usr/bin/env python3
"""HTTP contracts for hashed, compressed review runtime assets."""

import gzip
import hashlib
import http.client
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import unittest
import urllib.parse


ROOT = pathlib.Path(__file__).resolve().parents[2]
AREV = ROOT / "skills" / "artifact-review" / "scripts" / "arev.py"
ASSETS = ROOT / "skills" / "artifact-review" / "assets" / "review-ui"


class AssetDeliveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="arev-assets-")
        cls.state_root = cls.temporary.name
        cls.artifact = os.path.join(cls.state_root, "artifact.html")
        pathlib.Path(cls.artifact).write_text(
            "<!doctype html><html><body><h1>Assets</h1></body></html>",
            encoding="utf-8",
        )
        cls.environment = {
            **os.environ,
            "ARTIFACT_REVIEW_HOME": cls.state_root,
        }
        opened = subprocess.run(
            [
                sys.executable,
                str(AREV),
                "open",
                cls.artifact,
                "--no-browser",
            ],
            check=True,
            capture_output=True,
            text=True,
            env=cls.environment,
        )
        match = re.search(r"SESSION (\S+)", opened.stdout)
        if not match:
            raise RuntimeError(f"missing session URL: {opened.stdout}")
        cls.url = urllib.parse.urlsplit(match.group(1))
        cls.token = urllib.parse.parse_qs(cls.url.query)["t"][0]

    @classmethod
    def tearDownClass(cls):
        subprocess.run(
            [sys.executable, str(AREV), "stop", cls.artifact],
            check=False,
            capture_output=True,
            text=True,
            env=cls.environment,
        )
        cls.temporary.cleanup()

    @classmethod
    def request(cls, path, headers=None, authenticated=False):
        request_headers = dict(headers or {})
        if authenticated:
            request_headers["X-Arev-Token"] = cls.token
        connection = http.client.HTTPConnection(
            cls.url.hostname,
            cls.url.port,
            timeout=10,
        )
        try:
            connection.request("GET", path, headers=request_headers)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_versioned_bundle_is_gzipped_immutable_and_conditional(self):
        source = (ASSETS / "whiteboard.js").read_bytes()
        version = hashlib.sha256(source).hexdigest()
        status, headers, body = self.request(
            f"/whiteboard.js?v={version}",
            {"Accept-Encoding": "gzip"},
        )

        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Content-Encoding"), "gzip")
        self.assertEqual(
            headers.get("Cache-Control"),
            "public, max-age=31536000, immutable",
        )
        self.assertEqual(headers.get("Vary"), "Accept-Encoding")
        self.assertRegex(headers.get("ETag", ""), r'^"[0-9a-f]{64}"$')
        self.assertLess(len(body), len(source) * 0.6)
        self.assertEqual(gzip.decompress(body), source)

        repeat_status, repeat_headers, repeat_body = self.request(
            f"/whiteboard.js?v={version}",
            {
                "Accept-Encoding": "gzip",
                "If-None-Match": headers["ETag"],
            },
        )
        self.assertEqual(repeat_status, 304)
        self.assertEqual(repeat_body, b"")
        self.assertEqual(repeat_headers.get("ETag"), headers["ETag"])

        plain_status, plain_headers, plain_body = self.request("/whiteboard.js")
        self.assertEqual(plain_status, 200)
        self.assertEqual(
            plain_headers.get("Cache-Control"),
            "public, max-age=0, must-revalidate",
        )
        self.assertNotIn("Content-Encoding", plain_headers)
        self.assertEqual(plain_body, source)

    def test_favicon_is_served_without_a_token(self):
        status, headers, body = self.request("/favicon.ico")
        self.assertEqual(status, 200)
        self.assertEqual(headers.get("Content-Type"), "image/svg+xml")
        self.assertEqual(body, (ASSETS / "favicon.svg").read_bytes())

        controller_status, _, controller = self.request("/", authenticated=True)
        self.assertEqual(controller_status, 200)
        self.assertIn(b'<link rel="icon" type="image/svg+xml" '
                      b'href="/favicon.ico">', controller)

    def test_internal_documents_reference_hashed_tokenless_assets(self):
        artifact_status, _, artifact = self.request("/artifact")
        self.assertEqual(artifact_status, 200)
        sdk_match = re.search(
            rb'<script src="/sdk\.js\?v=([0-9a-f]{64})"></script>',
            artifact,
        )
        self.assertIsNotNone(sdk_match)
        self.assertNotIn(self.token.encode(), artifact)

        controller_status, _, controller = self.request("/", authenticated=True)
        self.assertEqual(controller_status, 200)
        self.assertRegex(controller, rb'"assets"\s*:\s*\{')
        self.assertRegex(controller, rb'"whiteboard-frame"\s*:\s*"[0-9a-f]{64}"')

        frame_source = (ASSETS / "whiteboard-frame.html").read_bytes()
        frame_version = hashlib.sha256(frame_source).hexdigest()
        frame_status, frame_headers, frame = self.request(
            f"/whiteboard-frame?v={frame_version}",
        )
        self.assertEqual(frame_status, 200)
        self.assertEqual(frame_headers.get("Access-Control-Allow-Origin"), "*")
        self.assertRegex(frame, rb'/whiteboard\.css\?v=[0-9a-f]{64}')
        self.assertRegex(frame, rb'/whiteboard\.js\?v=[0-9a-f]{64}')
        self.assertNotIn(self.token.encode(), frame)


if __name__ == "__main__":
    unittest.main(verbosity=2)
