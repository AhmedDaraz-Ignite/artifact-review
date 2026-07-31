#!/usr/bin/env bash
# arev selftest. Runs the acceptance drives against fresh artifact copies.
set -uo pipefail
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
A="$ROOT/skills/artifact-review"
AREV="$A/scripts/arev"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/artifact review selftest.XXXXXX")"
OUT="$WORK/results.txt"
export ARTIFACT_REVIEW_HOME="$WORK/state"

cleanup() {
  "$AREV" stop --all >/dev/null 2>&1 || true
}
trap cleanup EXIT

run() {
  local name="$1" script="$2" fixture="$3"
  local art="$WORK/$name artifact.html"
  if [ "$fixture" = "-scaffold-" ]; then
    # Prove the shipped shell passes the layout gate before any content exists.
    if ! "$AREV" new "$art" --title "Scaffold check" --force >/dev/null; then
      echo "FAIL $name could not scaffold the artifact" | tee -a "$OUT"
      return
    fi
  else
    cp "$ROOT/tests/fixtures/$fixture" "$art"
  fi
  if [ "$name" = "loop" ]; then
    # the loop test needs a page tall enough to genuinely scroll
    python3 - "$art" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
open(p, "w").write(s.replace("</body>", '<div style="height:1800px"></div></body>'))
PY
  fi
  echo "== $name"
  local raw="$WORK/$name.log"
  node "$ROOT/tests/$script" "$art" > "$raw" 2>&1
  local code=$?
  grep -E "^(PASS|FAIL|pageerrors)" "$raw" | tee -a "$OUT"
  # A crashed drive prints no FAIL lines. Count the crash itself as one.
  if [ $code -ne 0 ] && ! grep -q "^FAIL" "$raw"; then
    echo "FAIL $name drive crashed (exit $code) - see $raw" | tee -a "$OUT"
    tail -5 "$raw"
  fi
}

run loop selftest-loop.mjs clean.html
run gate selftest-gate.mjs clean.html
run scaffold selftest-gate.mjs -scaffold-
run security selftest-security.mjs clean.html
run wb   selftest-whiteboard.mjs clean.html
run wboff selftest-whiteboard-offline.mjs clean.html
run diagrams selftest-diagram-features.mjs diagram-features.html

echo
if grep -q "^FAIL" "$OUT"; then
  echo "SELFTEST: FAIL"
  exit 1
fi
echo "SELFTEST: PASS"
