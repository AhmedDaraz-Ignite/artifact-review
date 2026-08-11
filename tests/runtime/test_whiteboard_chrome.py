#!/usr/bin/env python3
"""The diagram editor's reduced chrome depends on Excalidraw internals.

Hiding Excalidraw's scene menu, library and help panel, and moving its lock and
pan controls out of the tool strip, needs selectors Excalidraw does not publish
as an API. An upgrade can rename any of them, and the failure is silent: the
editor keeps working while the hidden panels come back and the rail's controls
appear twice.

These tests fail loudly instead. The hooks are read out of the stylesheet rather
than listed here, so a rule added tomorrow is covered the moment it is written.
"""

import pathlib
import re
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
FRAME_CSS = ROOT / "tooling" / "whiteboard-frame.css"
ASSETS = ROOT / "skills" / "artifact-review" / "assets" / "review-ui"
BUNDLE_JS = ASSETS / "whiteboard.js"
BUNDLE_CSS = ASSETS / "whiteboard.css"
# Class names have to be checked against Excalidraw's own stylesheet. The built
# bundle contains this project's rules too, so every name would find itself
# there and the check would pass no matter what Excalidraw renamed.
EXCALIDRAW_CSS = (
    ROOT / "node_modules" / "@excalidraw" / "excalidraw" / "dist" / "prod" / "index.css"
)


def stylesheet_hooks():
    """Every Excalidraw hook the frame's stylesheet depends on."""
    # Comments name files such as whiteboard-entry.mjs, which would otherwise
    # read as class selectors.
    css = re.sub(r"/\*.*?\*/", "", FRAME_CSS.read_text(encoding="utf-8"), flags=re.S)
    test_ids = set(re.findall(r'data-testid="([a-z0-9-]+)"', css))
    # The frame prefixes its own classes with wb-; the rest are Excalidraw's.
    classes = {
        name
        for name in re.findall(r"\.([A-Za-z][A-Za-z0-9_-]*)", css)
        if not name.startswith("wb-")
    }
    return test_ids, classes


class WhiteboardChromeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_ids, cls.classes = stylesheet_hooks()
        cls.frame_css = FRAME_CSS.read_text(encoding="utf-8")
        cls.bundle_css = BUNDLE_CSS.read_text(encoding="utf-8")
        # A byte search over a minified build artifact. Decoding 9MB of it to
        # text costs more than the search and buys nothing.
        cls.bundle_js = BUNDLE_JS.read_bytes()

    def test_class_hooks_still_exist(self):
        if not EXCALIDRAW_CSS.exists():
            self.skipTest("Excalidraw's stylesheet needs node_modules. Run: npm ci")
        excalidraw_css = EXCALIDRAW_CSS.read_text(encoding="utf-8")
        self.assertTrue(self.classes, "no Excalidraw class hooks were found to check")
        for name in sorted(self.classes):
            with self.subTest(hook=name):
                self.assertIn(
                    name,
                    excalidraw_css,
                    f"Excalidraw no longer ships '.{name}'. The diagram editor's "
                    "reduced chrome targets it in tooling/whiteboard-frame.css.",
                )

    def test_test_id_hooks_still_exist(self):
        self.assertTrue(self.test_ids, "no data-testid hooks were found to check")
        for name in sorted(self.test_ids):
            with self.subTest(hook=name):
                self.assertIn(
                    f'"data-testid":"{name}"'.encode(),
                    self.bundle_js,
                    f"Excalidraw no longer ships data-testid '{name}'. The diagram "
                    "editor's reduced chrome targets it in "
                    "tooling/whiteboard-frame.css.",
                )

    def test_bundle_is_built_from_the_current_stylesheet(self):
        """The frame stylesheet is bundled, so a stale bundle hides every rule."""
        own = set(re.findall(r"\.(wb-[A-Za-z0-9_-]+)", self.frame_css))
        self.assertEqual(
            sorted(name for name in own if name not in self.bundle_css),
            [],
            "The built bundle predates the current tooling/whiteboard-frame.css. "
            "Run: node tooling/build-whiteboard.mjs",
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
