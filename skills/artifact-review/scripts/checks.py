#!/usr/bin/env python3
"""Static checks that hold an authored artifact to its rules and its sources.

The browser audit in ``audit.js`` only sees what rendering produced, and it
only runs once a reviewer already has the page open. These checks read the
authored file instead, so three failures are caught before anyone looks at it:
a diagram built from styled boxes instead of Mermaid, a diagram drawn with the
wrong Mermaid type, and a source document whose sections the artifact silently
skipped.

Nothing here knows anything about a particular document. Sections come from the
source's own headings, and coverage is decided by the words those headings use.
"""

import json
import os
import re
from collections import Counter
from html.parser import HTMLParser

MAX_LISTED = 40
MAX_DISCOVERED_SOURCES = 3
# An explainer names the document it explains near the top. Reading only the
# opening text keeps discovery from picking up every file the body mentions.
INTRO_CHARS = 1200
# Shortest word allowed to match a longer one by prefix, so "arch" can satisfy
# "architecture" without "on" satisfying "onboarding".
PREFIX_MIN = 4

# Text that reads as a drawn connector rather than prose. Several of these
# outside a code block mean someone drew a diagram by hand.
CONNECTOR_RE = re.compile(
    r"(?:^|\s)(?:-{1,2}>|<-{1,2}|=>|\|>)(?:\s|$)|[→←↑↓"
    r"⇒⟶▶┌└├│]|─{2,}")
# Arrows only. Box-drawing characters are excluded because directory trees use
# them, and a directory tree is not a flow worth diagramming.
ARROW_RE = re.compile(r"(?:^|\s)(?:-{1,2}>|<-{1,2}|=>)(?:\s|$)|[→⇒⟶]")
MIN_ARROWS_FOR_FLOW = 5

# A heading using any of these words describes something with named steps or
# named states, which is what a diagram is for.
DIAGRAM_VOCAB = frozenset("""
    state states machine machines lifecycle lifecycles transition transitions
    flow flows saga sagas pipeline pipelines sequence sequences protocol
    protocols workflow workflows handshake handshakes phase phases stage stages
    process processes topology architecture model models loop loops
""".split())

STOPWORDS = frozenset("""
    a an and are as at be by for from how in into is it its of on or that the
    then to via with within without what when where which while our your their
    this these those not no all any each per some more most other another
""".split())

DIAGRAM_TYPES = (
    "flowchart", "graph", "statediagram-v2", "statediagram", "sequencediagram",
    "classdiagram", "erdiagram", "journey", "gantt", "pie", "mindmap",
    "timeline", "quadrantchart", "xychart-beta", "block-beta", "sankey-beta",
    "requirementdiagram", "gitgraph", "c4context", "packet-beta", "architecture-beta",
)

# Words in a diagram's heading or caption that mean it should have been drawn
# as a state diagram rather than a flowchart.
STATE_WORDS = frozenset(("state", "states", "lifecycle", "transition",
                         "transitions", "machine"))

_SHAPE = (r"\[\[.*?\]\]|\[\(.*?\)\]|\(\(.*?\)\)|\{\{.*?\}\}"
          r"|\[.*?\]|\(.*?\)|\{.*?\}")
_LABEL_RE = re.compile(_SHAPE + r"|\"(?:.*?)\"")
# A node is an identifier immediately followed by its shape, which is how a
# label is told apart from an edge label written between pipes.
_NODE_RE = re.compile(r"([A-Za-z_][\w.-]*)\s*(" + _SHAPE + r")")
_SECTION_NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)*\b")
_CITES_SECTION_RE = re.compile(r"section|§", re.IGNORECASE)
_FLOW_ARROW_RE = re.compile(
    r"-\.->|-\.-|<-->|==>|===|-->|---|--[xo]|->>|->|~~~")
_IDENT_RE = re.compile(r"[A-Za-z_][\w.-]*")
_HEADING_NUMBER_RE = re.compile(r"^\s*(?:\d+(?:\.\d+)*|[ivxlcdm]+|[a-z])[.)]\s+",
                                re.IGNORECASE)
_MD_HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
_MD_FENCE_RE = re.compile(r"^\s*(?:```|~~~)")
_PATH_RE = re.compile(r"[\w.@+-]+(?:/[\w.@+-]+)*\.(?:md|markdown|rst|txt|html?)")


# ------------------------------------------------------------------- words

def _singular(word):
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def words_of(text):
    """Normalise free text into comparable content words."""
    raw = re.split(r"[^0-9A-Za-z]+", (text or "").lower())
    return {_singular(w) for w in raw
            if len(w) > 2 and w not in STOPWORDS and not w.isdigit()}


def heading_words(text):
    return words_of(_HEADING_NUMBER_RE.sub("", text or "", count=1))


# --------------------------------------------------------------- artifact

class _ArtifactParser(HTMLParser):
    """Collect the authored structure an artifact check needs.

    Text is gathered twice on purpose: once as one visible stream for coverage
    matching, and once per heading or Mermaid block so each diagram keeps the
    heading and caption that explain it.
    """

    SKIP = frozenset(("script", "style", "noscript"))
    HEADINGS = frozenset(("h1", "h2", "h3", "h4", "h5", "h6"))
    VERBATIM = frozenset(("pre", "code", "textarea", "samp", "kbd"))

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.open_tags = []
        self.visible = []
        self.headings = []
        self.diagrams = []
        self.scripts = []
        self.counts = Counter()
        self.connector_hits = 0
        self._capture = None
        self._capture_kind = None
        self._capture_depth = 0
        self._caption_for = None

    # -- helpers

    def _inside(self, names):
        return any(tag in names for tag, _ in self.open_tags)

    def _classes(self, attrs):
        return (dict(attrs).get("class") or "").split()

    def _is_mermaid(self, tag, attrs):
        return tag in ("pre", "div") and "mermaid" in self._classes(attrs)

    # -- parser hooks

    def handle_starttag(self, tag, attrs):
        mapping = dict(attrs)
        self.open_tags.append((tag, mapping))
        self.counts[tag] += 1

        if tag == "script" and mapping.get("src"):
            self.scripts.append(mapping["src"])
        if tag == "input" and mapping.get("type") not in ("hidden",):
            self.counts["control"] += 1
        if tag in ("button", "select", "textarea"):
            self.counts["control"] += 1

        if self._capture is not None:
            self._capture_depth += 1
            return
        if self._is_mermaid(tag, mapping):
            self._capture = []
            self._capture_kind = ("mermaid", mapping.get("id"), tag)
            self._capture_depth = 1
        elif tag in self.HEADINGS:
            self._capture = []
            self._capture_kind = ("heading", int(tag[1]), tag)
            self._capture_depth = 1

    def handle_startendtag(self, tag, attrs):
        self.counts[tag] += 1

    def handle_endtag(self, tag):
        for index in range(len(self.open_tags) - 1, -1, -1):
            if self.open_tags[index][0] == tag:
                del self.open_tags[index:]
                break

        if self._capture is None:
            return
        self._capture_depth -= 1
        if self._capture_depth > 0:
            return

        text = "".join(self._capture)
        kind = self._capture_kind
        self._capture = None
        self._capture_kind = None

        if kind[0] == "heading":
            self.headings.append({"level": kind[1], "text": text.strip()})
        else:
            self.diagrams.append({
                "id": kind[1],
                "tag": kind[2],
                "source": text.strip(),
                "heading": self.headings[-1]["text"] if self.headings else "",
                "caption": "",
            })
            self._caption_for = len(self.diagrams) - 1

    def handle_data(self, data):
        if self._capture is not None:
            self._capture.append(data)
        if self._inside(self.SKIP):
            return
        stripped = data.strip()
        if not stripped:
            return
        self.visible.append(stripped)
        if not self._inside(self.VERBATIM):
            self.connector_hits += len(CONNECTOR_RE.findall(data))
        if (self._caption_for is not None and self._capture is None
                and len(stripped) > 12):
            self.diagrams[self._caption_for]["caption"] = stripped[:400]
            self._caption_for = None


def analyse_artifact(text):
    parser = _ArtifactParser()
    parser.feed(text)
    parser.close()
    visible = " ".join(parser.visible)
    for diagram in parser.diagrams:
        diagram.update(analyse_mermaid(diagram["source"]))
        # The subject of a diagram is its heading, its id, and what it draws.
        # The caption is left out here: captions run long and would let one
        # diagram claim every section that shares a word with its prose.
        diagram["context_words"] = heading_words(" ".join((
            diagram["heading"], (diagram["id"] or "").replace("-", " "),
            " ".join(diagram["labels"]))))
        # How the author describes the diagram, which is what decides whether
        # it should have been a state diagram. Node labels are excluded so a
        # box happening to say "state DB" does not count as a description.
        described = f"{diagram['heading']} {diagram['caption']}"
        diagram["described_words"] = words_of(described)
        diagram["cited_sections"] = (
            set(_SECTION_NUMBER_RE.findall(described))
            if _CITES_SECTION_RE.search(described) else set())
    return {
        "headings": parser.headings,
        "diagrams": parser.diagrams,
        "scripts": parser.scripts,
        "counts": dict(parser.counts),
        "connector_hits": parser.connector_hits,
        "text": visible,
        "words": words_of(visible),
        "word_count": len(visible.split()),
    }


# ---------------------------------------------------------------- mermaid

def analyse_mermaid(source):
    """Pull the declared type, node labels, and out-degree from Mermaid text.

    This is deliberately loose. Everything it feeds is a warning, so a line it
    fails to understand costs a missed hint and never a false failure.
    """
    lines = [line for line in source.splitlines() if line.strip()]
    declared = ""
    if lines:
        first = lines[0].strip().split()
        if first:
            candidate = first[0].lower()
            if candidate in DIAGRAM_TYPES:
                declared = candidate

    node_labels = {}
    out_degree = Counter()
    for line in lines[1:]:
        body = line.strip()
        if not body or body.startswith("%%"):
            continue
        body = body.replace("[*]", "START")

        for node_id, shape in _NODE_RE.findall(body):
            text = shape.strip("[](){}\"'<> ").strip()
            if text:
                node_labels.setdefault(node_id, text)

        # Blank every bracketed run first. Otherwise an edge label containing a
        # dash would be read as another arrow.
        stripped = _LABEL_RE.sub(" \x00 ", body)
        parts = _FLOW_ARROW_RE.split(stripped)
        if len(parts) < 2:
            continue
        for index in range(len(parts) - 1):
            left = _IDENT_RE.findall(parts[index])
            right = _IDENT_RE.findall(parts[index + 1])
            if left and right:
                out_degree[left[-1]] += 1

    busiest = out_degree.most_common(1)[0][0] if out_degree else ""
    return {
        "declared": declared,
        "labels": list(node_labels.values()),
        "max_fan_out": max(out_degree.values()) if out_degree else 0,
        "fan_out_node": node_labels.get(busiest, busiest),
        "edges": sum(out_degree.values()),
    }


# ----------------------------------------------------------------- source

def _markdown_headings(lines):
    headings = []
    fenced = False
    for line in lines:
        if _MD_FENCE_RE.match(line):
            fenced = not fenced
        elif not fenced:
            match = _MD_HEADING_RE.match(line)
            if match:
                headings.append({
                    "level": len(match.group(1)),
                    "text": match.group(2).strip(),
                    "_body_arrows": 0,
                })
                continue
        if headings:
            headings[-1]["_body_arrows"] += len(ARROW_RE.findall(line))
    return headings


def _html_headings(text):
    parser = _ArtifactParser()
    parser.feed(text)
    parser.close()
    return parser.headings


def _section_level(headings):
    """Pick the level that carries a document's real sections.

    A lone top heading is the document title, so the sections sit one level
    below it. Anything else is already the section level.
    """
    if not headings:
        return 0
    levels = sorted({h["level"] for h in headings})
    top = levels[0]
    if sum(1 for h in headings if h["level"] == top) > 1:
        return top
    return levels[1] if len(levels) > 1 else top


def read_source(path):
    with open(path, encoding="utf-8", errors="replace") as handle:
        text = handle.read()
    lines = text.splitlines()
    suffix = os.path.splitext(path)[1].lower()
    if suffix in (".html", ".htm"):
        headings = _html_headings(text)
    else:
        headings = _markdown_headings(lines)

    level = _section_level(headings)
    sections = []
    for heading in headings:
        heading["words"] = heading_words(heading["text"])
        heading["number"] = _leading_number(heading["text"])
        heading["diagrammable"] = _is_diagrammable(
            heading["words"], heading.pop("_body_arrows", 0))
        if heading["level"] == level:
            sections.append(heading)
    return {
        "path": path,
        "lines": len(lines),
        "words": len(text.split()),
        "headings": headings,
        "sections": sections,
        "section_level": level,
    }


def _leading_number(text):
    match = re.match(r"\s*(\d+(?:\.\d+)*)[.)]?\s", text or "")
    return match.group(1) if match else ""


def _is_diagrammable(words, body_arrows=0):
    """Decide whether a source heading describes something worth drawing.

    Two signals only: the heading names a thing with states or steps, or its
    body already draws arrows in plain text.
    """
    return bool(words & DIAGRAM_VOCAB) or body_arrows >= MIN_ARROWS_FOR_FLOW


def discover_sources(artifact_path, intro_text):
    """Find the documents an artifact names in its opening text.

    An explainer almost always cites the thing it explains up front, so this
    keeps the check usable with no arguments at all. Only the intro is read,
    because a file mentioned once in a finding is not the subject.
    """
    artifact_real = os.path.realpath(artifact_path)
    roots = [os.path.dirname(artifact_real)]
    for _ in range(4):
        parent = os.path.dirname(roots[-1])
        if parent == roots[-1]:
            break
        roots.append(parent)
    roots.append(os.getcwd())

    found = []
    for candidate in _PATH_RE.findall(intro_text):
        for root in roots:
            resolved = os.path.realpath(os.path.join(root, candidate))
            if resolved == artifact_real or resolved in found:
                continue
            if os.path.isfile(resolved):
                found.append(resolved)
                break
        if len(found) >= MAX_DISCOVERED_SOURCES:
            break
    return found


# ----------------------------------------------------------------- checks

def _finding(severity, kind, message, **extra):
    value = {"severity": severity, "kind": kind, "message": message}
    value.update(extra)
    return value


def _check_diagram_markup(artifact):
    findings = []
    seen_ids = set()
    for index, diagram in enumerate(artifact["diagrams"]):
        label = diagram["id"] or f"diagram {index + 1}"
        if diagram["tag"] != "pre":
            findings.append(_finding(
                "error", "diagram-not-pre",
                f"{label} uses <{diagram['tag']} class=\"mermaid\">. Use "
                "<pre class=\"mermaid\"> so the source keeps its whitespace."))
        if not diagram["id"]:
            findings.append(_finding(
                "error", "diagram-missing-id",
                f"Diagram {index + 1} has no id. Reviewer annotations attach "
                "to the id, so an unnamed diagram loses them on every edit."))
        elif diagram["id"] in seen_ids:
            findings.append(_finding(
                "error", "diagram-duplicate-id",
                f"Diagram id \"{diagram['id']}\" is used more than once."))
        else:
            seen_ids.add(diagram["id"])
        if not diagram["declared"]:
            findings.append(_finding(
                "error", "diagram-unknown-type",
                f"{label} does not start with a Mermaid diagram type, so it "
                "cannot render."))

    for src in artifact["scripts"]:
        if "mermaid" in src.lower():
            findings.append(_finding(
                "error", "mermaid-cdn-script",
                f"Remove the Mermaid loader {src}. The review server renders "
                "Mermaid offline with its own pinned copy."))
        elif "://" in src:
            findings.append(_finding(
                "warn", "external-script",
                f"External script {src} breaks the offline guarantee."))

    if artifact["connector_hits"] >= 3 and not artifact["diagrams"]:
        findings.append(_finding(
            "warn", "hand-built-diagram",
            f"{artifact['connector_hits']} drawn connectors appear outside "
            "code blocks but the page has no Mermaid. A diagram made of boxes "
            "and arrows cannot open in the whiteboard.",
            count=artifact["connector_hits"]))
    return findings


def _check_diagram_quality(artifact):
    findings = []
    for index, diagram in enumerate(artifact["diagrams"]):
        label = diagram["id"] or f"diagram {index + 1}"
        if (diagram["declared"] in ("flowchart", "graph")
                and diagram["described_words"] & STATE_WORDS):
            findings.append(_finding(
                "warn", "diagram-type-mismatch",
                f"{label} is described as a state machine but is drawn as a "
                f"{diagram['declared']}. Use stateDiagram-v2 so states and "
                "transitions convert to editable shapes."))
        if diagram["max_fan_out"] > 4:
            findings.append(_finding(
                "warn", "diagram-fan-out",
                f"{label} has {diagram['max_fan_out']} edges leaving "
                f"\"{diagram['fan_out_node']}\". Group them or split the "
                "diagram; more than four is unreadable."))
        long_labels = [text for text in diagram["labels"]
                       if len(text.split()) > 5]
        if long_labels:
            findings.append(_finding(
                "warn", "diagram-long-label",
                f"{label} has {len(long_labels)} label(s) over five words, "
                f"starting with \"{long_labels[0][:60]}\".",
                labels=long_labels[:5]))
    return findings


def _word_present(word, pool):
    """True when a word appears in a pool, allowing a prefix to stand in.

    Authors shorten. A diagram called "arch" is about the architecture, and a
    section on "scheduling" is covered by text that says "scheduler".
    """
    if word in pool:
        return True
    if len(word) < PREFIX_MIN:
        return False
    return any(
        other.startswith(word) or (len(other) >= PREFIX_MIN
                                   and word.startswith(other))
        for other in pool)


def _matches(section_words, artifact_words):
    if not section_words:
        return True, set()
    missing = {word for word in section_words
               if not _word_present(word, artifact_words)}
    return not missing, missing


def _diagram_covers(heading, diagrams):
    """True when some diagram is plainly about this source heading.

    A caption that cites the section by number is the strongest signal, since
    that is how authors tie a picture back to the document. Otherwise the
    diagram has to share a word that names the subject. Words like "state" and
    "flow" do not count: they say what kind of picture it is, not what it is
    of, so "run state" and "endpoint state" need more than one diagram between
    them.
    """
    distinctive = heading["words"] - DIAGRAM_VOCAB
    for diagram in diagrams:
        if heading["number"] and heading["number"] in diagram["cited_sections"]:
            return True
        if any(_word_present(word, diagram["context_words"])
               for word in distinctive):
            return True
    return False


def _check_coverage(artifact, sources, ignore):
    findings = []
    summary = []
    for source in sources:
        undiagrammed = []
        unmatched = []
        for section in source["sections"]:
            if _ignored(section["text"], ignore):
                continue
            ok, missing = _matches(section["words"], artifact["words"])
            if not ok:
                unmatched.append({"heading": section["text"],
                                  "missing": sorted(missing)})

        for heading in source["headings"]:
            if not heading["diagrammable"] or _ignored(heading["text"], ignore):
                continue
            if not _diagram_covers(heading, artifact["diagrams"]):
                undiagrammed.append(heading["text"])

        name = os.path.basename(source["path"])
        if unmatched:
            findings.append(_finding(
                "gap", "section-not-covered",
                f"{len(unmatched)} of {len(source['sections'])} sections in "
                f"{name} are not represented in the artifact.",
                source=source["path"],
                sections=[item["heading"] for item in unmatched][:MAX_LISTED],
                detail=unmatched[:MAX_LISTED]))
        if undiagrammed:
            findings.append(_finding(
                "gap", "section-not-diagrammed",
                f"{len(undiagrammed)} section(s) in {name} describe states, "
                "flows, or lifecycles that no diagram shows.",
                source=source["path"],
                sections=undiagrammed[:MAX_LISTED]))
        summary.append({
            "path": source["path"],
            "lines": source["lines"],
            "words": source["words"],
            "sections": len(source["sections"]),
            "sections_covered": len(source["sections"]) - len(unmatched),
            "diagrammable": sum(1 for h in source["headings"]
                                if h["diagrammable"]),
            "undiagrammed": len(undiagrammed),
        })
    return findings, summary


def _ignored(text, ignore):
    lowered = text.lower()
    return any(pattern.lower() in lowered for pattern in ignore)


def run_checks(artifact_path, source_paths=(), ignore=(), discover=True):
    with open(artifact_path, encoding="utf-8", errors="replace") as handle:
        artifact_text = handle.read()
    artifact = analyse_artifact(artifact_text)

    paths = [os.path.realpath(p) for p in source_paths]
    if not paths and discover:
        paths = discover_sources(artifact_path, artifact["text"][:INTRO_CHARS])

    findings = _check_diagram_markup(artifact)
    findings.extend(_check_diagram_quality(artifact))

    sources = []
    for path in paths:
        if not os.path.isfile(path):
            findings.append(_finding(
                "error", "source-missing", f"No such source document: {path}"))
            continue
        sources.append(read_source(path))

    coverage, summary = _check_coverage(artifact, sources, ignore)
    findings.extend(coverage)

    counts = Counter(item["severity"] for item in findings)
    return {
        "artifact": os.path.realpath(artifact_path),
        "sources": summary,
        "discovered": bool(paths) and not source_paths,
        "findings": findings,
        "stats": {
            "diagrams": len(artifact["diagrams"]),
            "headings": len(artifact["headings"]),
            "tables": artifact["counts"].get("table", 0),
            "details": artifact["counts"].get("details", 0),
            "controls": artifact["counts"].get("control", 0),
            "words": artifact["word_count"],
        },
        "errors": counts.get("error", 0),
        "gaps": counts.get("gap", 0),
        "warnings": counts.get("warn", 0),
        "ok": not counts.get("error", 0) and not counts.get("gap", 0),
    }


# ----------------------------------------------------------------- output

_ORDER = {"error": 0, "gap": 1, "warn": 2}


def render_report(report):
    out = []
    stats = report["stats"]
    out.append(
        f"ARTIFACT {report['artifact']}\n"
        f"  {stats['words']} words, {stats['headings']} headings, "
        f"{stats['diagrams']} diagrams, {stats['tables']} tables, "
        f"{stats['details']} collapsed sections, {stats['controls']} controls")

    for source in report["sources"]:
        out.append(
            f"SOURCE {source['path']}\n"
            f"  {source['lines']} lines, {source['sections']} sections, "
            f"{source['sections_covered']}/{source['sections']} covered, "
            f"{source['undiagrammed']}/{source['diagrammable']} "
            "diagrammable headings without a diagram")
    if not report["sources"]:
        out.append("SOURCE none - pass --source PATH to check coverage")
    elif report["discovered"]:
        out.append("  (sources discovered from paths named in the artifact)")

    for item in sorted(report["findings"], key=lambda f: _ORDER[f["severity"]]):
        out.append(f"{item['severity'].upper()} [{item['kind']}] "
                   f"{item['message']}")
        missing_by_heading = {entry["heading"]: entry["missing"]
                              for entry in item.get("detail", [])}
        for heading in item.get("sections", []):
            missing = missing_by_heading.get(heading)
            if missing:
                out.append(f"    - {heading}  (no mention of: "
                           f"{', '.join(missing)})")
            else:
                out.append(f"    - {heading}")
        if len(item.get("sections", [])) == MAX_LISTED:
            out.append(f"    ... list truncated at {MAX_LISTED}")

    out.append(f"{report['errors']} error(s), {report['gaps']} coverage gap(s), "
               f"{report['warnings']} warning(s)")
    out.append("PASS" if report["ok"] else "FAIL")
    return "\n".join(out) + "\n"


def render_json(report):
    return json.dumps(report, indent=2, sort_keys=True) + "\n"
