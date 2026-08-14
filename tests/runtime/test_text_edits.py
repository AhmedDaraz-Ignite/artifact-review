#!/usr/bin/env python3
"""Contract tests for writing reviewer text edits into the artifact."""

import pathlib
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "skills" / "artifact-review" / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import server as SERVER


ARTIFACT = """<!doctype html>
<html>
<body>
  <h1>Release plan</h1>
  <p>The first paragraph carries the summary.</p>
  <p>The second paragraph carries the risk.</p>
  <ul>
    <li>Filler that should not survive the review.</li>
    <li>A line worth keeping.</li>
  </ul>
  <p>Costs &lt; 5 dollars &amp; no more.</p>
  <p>Twin</p>
  <p>Twin</p>
</body>
</html>
"""


VERSION = 1_700_000_000_000_000_000


def edit(before, after, action="edit"):
    return {
        "kind": "text-edit",
        "action": action,
        "scope": "line",
        "blocks": [{"selector": "p", "before": before, "after": after}],
    }


class TextEditValidationTests(unittest.TestCase):
    def normalise(self, item):
        return SERVER._normalise_feedback_item(dict(item, kind="text-edit"))

    def test_accepts_a_well_formed_edit(self):
        item = self.normalise(edit("old", "new"))
        self.assertEqual(item["blocks"][0]["after"], "new")

    def test_rejects_an_edit_with_no_blocks(self):
        with self.assertRaises(ValueError):
            self.normalise({"action": "edit", "blocks": []})

    def test_rejects_an_unknown_action(self):
        with self.assertRaises(ValueError):
            self.normalise(dict(edit("old", "new"), action="rewrite"))

    def test_rejects_a_block_with_no_original_text(self):
        with self.assertRaises(ValueError):
            self.normalise({"action": "edit", "blocks": [{"before": "  "}]})

    def test_rejects_a_block_whose_replacement_is_not_text(self):
        with self.assertRaises(ValueError):
            self.normalise({"action": "edit",
                            "blocks": [{"before": "old", "after": 5}]})

    def test_rejects_more_blocks_than_the_limit(self):
        blocks = [{"before": f"line {index}", "after": "x"}
                  for index in range(SERVER.MAX_TEXT_EDIT_BLOCKS + 1)]
        with self.assertRaises(ValueError):
            self.normalise({"action": "edit", "blocks": blocks})

    def test_rejects_more_characters_than_the_limit(self):
        big = "x" * (SERVER.MAX_TEXT_EDIT_CHARS + 1)
        with self.assertRaises(ValueError):
            self.normalise(edit(big, "small"))


class ApplyTextEditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.temp.name) / "artifact.html"
        self.path.write_text(ARTIFACT, encoding="utf-8")
        self._saved_artifact = SERVER.ARTIFACT
        SERVER.ARTIFACT = str(self.path)

    def tearDown(self):
        SERVER.ARTIFACT = self._saved_artifact
        self.temp.cleanup()

    def source(self):
        return self.path.read_text(encoding="utf-8")

    def apply(self, items, version=VERSION):
        return SERVER._apply_text_edits(items, version)

    def test_a_rewrite_replaces_only_that_line(self):
        applied, refused = self.apply([
            edit("The first paragraph carries the summary.",
                 "The first paragraph now carries the plan."),
        ])
        self.assertEqual(len(applied), 1)
        self.assertEqual(refused, [])
        self.assertIn("The first paragraph now carries the plan.", self.source())
        self.assertIn("The second paragraph carries the risk.", self.source())

    def test_cutting_a_range_leaves_the_line_in_place(self):
        applied, _ = self.apply([
            edit("The second paragraph carries the risk.",
                 "The second paragraph carries.", action="cut"),
        ])
        self.assertEqual(len(applied), 1)
        self.assertIn("<p>The second paragraph carries.</p>", self.source())

    def test_cutting_a_whole_line_removes_its_tag(self):
        applied, _ = self.apply([
            edit("Filler that should not survive the review.", "", action="cut"),
        ])
        self.assertEqual(len(applied), 1)
        self.assertNotIn("Filler", self.source())
        self.assertNotIn("<li></li>", self.source())
        self.assertIn("<li>A line worth keeping.</li>", self.source())

    def test_cutting_a_line_does_not_leave_a_blank_line_behind(self):
        self.apply([
            edit("Filler that should not survive the review.", "", action="cut"),
        ])
        blanks = [line for line in self.source().splitlines() if not line.strip()]
        self.assertEqual(blanks, [])

    def test_text_the_file_escapes_is_still_found(self):
        applied, refused = self.apply([
            edit("Costs < 5 dollars & no more.", "Costs < 4 dollars & no more."),
        ])
        self.assertEqual(refused, [])
        self.assertEqual(len(applied), 1)
        self.assertIn("Costs &lt; 4 dollars &amp; no more.", self.source())

    def test_an_edit_the_file_repeats_is_refused_and_changes_nothing(self):
        before = self.source()
        applied, refused = self.apply([edit("Twin", "Triplet")])
        self.assertEqual(applied, [])
        self.assertEqual(len(refused), 1)
        self.assertIn("more than once", refused[0]["reason"])
        self.assertEqual(self.source(), before)

    def test_an_edit_the_file_does_not_carry_is_refused(self):
        applied, refused = self.apply([
            edit("A sentence the artifact never had", "something else"),
        ])
        self.assertEqual(applied, [])
        self.assertIn("one plain run", refused[0]["reason"])

    def test_one_refused_edit_does_not_stop_the_others(self):
        applied, refused = self.apply([
            edit("The first paragraph carries the summary.", "Rewritten."),
            edit("Twin", "Triplet"),
            edit("A line worth keeping.", "A line worth keeping, just."),
        ])
        self.assertEqual(len(applied), 2)
        self.assertEqual(len(refused), 1)
        self.assertIn("Rewritten.", self.source())
        self.assertIn("A line worth keeping, just.", self.source())
        self.assertEqual(self.source().count("<p>Twin</p>"), 2)

    def test_two_edits_on_one_line_apply_in_order(self):
        applied, refused = self.apply([
            edit("The first paragraph carries the summary.",
                 "The first paragraph carries the plan."),
            edit("The first paragraph carries the plan.",
                 "The first paragraph carries the whole plan."),
        ])
        self.assertEqual(len(applied), 2)
        self.assertEqual(refused, [])
        self.assertIn("carries the whole plan.", self.source())

    def test_writing_keeps_the_file_readable_and_its_mode(self):
        self.path.chmod(0o640)
        self.apply([
            edit("The first paragraph carries the summary.", "Rewritten."),
        ])
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o640)
        self.assertTrue(self.source().startswith("<!doctype html>"))

    def test_an_edit_drawn_on_an_older_artifact_is_refused(self):
        before = self.source()
        stale = dict(
            edit("The first paragraph carries the summary.", "Rewritten."),
            baseVersion=VERSION - 1_000_000)
        applied, refused = self.apply([stale])
        self.assertEqual(applied, [])
        self.assertIn("changed after this edit", refused[0]["reason"])
        self.assertEqual(self.source(), before)

    def test_an_edit_drawn_on_this_artifact_is_applied(self):
        fresh = dict(
            edit("The first paragraph carries the summary.", "Rewritten."),
            baseVersion=VERSION)
        applied, refused = self.apply([fresh])
        self.assertEqual(len(applied), 1)
        self.assertEqual(refused, [])

    def test_a_refused_batch_writes_nothing_at_all(self):
        before = self.source()
        applied, refused = self.apply([edit("Twin", "Triplet")])
        self.assertEqual(applied, [])
        self.assertEqual(self.source(), before)
        self.assertFalse(
            (self.path.parent / (self.path.name + ".arev-tmp")).exists())


if __name__ == "__main__":
    unittest.main(verbosity=2)
