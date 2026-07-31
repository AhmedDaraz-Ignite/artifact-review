#!/usr/bin/env bash
# Baseline + after measurements for the artifact-review efficiency work.
# Run before any change, then again after each phase, and diff the two outputs.
#
#   docs/skill-efficiency-audit/bench.sh > baseline.txt
#   ... make changes ...
#   docs/skill-efficiency-audit/bench.sh > after-phase-1.txt
#   diff baseline.txt after-phase-1.txt
#
# Bytes are exact. Token figures are bytes/4, which is a proxy - the ratio
# between two runs is what this measures, not an absolute token count.

set -euo pipefail

SKILL="${AREV_SKILL:-$(cd "$(dirname "$0")/../.." && pwd)/.claude/skills/artifact-review}"
AREV="$SKILL/scripts/arev"
PROBE="${TMPDIR:-/tmp}/arev-bench-probe.html"

bytes() { wc -c < "$1" | tr -d ' '; }
tok()   { echo $(( $1 / 4 )); }
row()   { printf '%-42s %10s %10s\n' "$1" "$2" "$3"; }

echo "artifact-review bench - $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "skill: $SKILL"
echo
printf '%-42s %10s %10s\n' "METRIC" "BYTES" "~TOKENS"
printf '%-42s %10s %10s\n' "------------------------------------------" "----------" "----------"

# --- fixed per-session context cost -----------------------------------------
sk=$(bytes "$SKILL/SKILL.md");                       row "SKILL.md"                "$sk"  "$(tok "$sk")"
dg=$("$AREV" design | wc -c | tr -d ' ');            row "arev design"             "$dg"  "$(tok "$dg")"
ix=$("$AREV" playbook | wc -c | tr -d ' ');          row "arev playbook (index)"   "$ix"  "$(tok "$ix")"
tp=$("$AREV" playbook plan table | wc -c | tr -d ' '); row "arev playbook plan table" "$tp" "$(tok "$tp")"
ap=$("$AREV" playbook code comparison diagram input plan slides table | wc -c | tr -d ' ')
                                                     row "arev playbook (all 7)"   "$ap"  "$(tok "$ap")"
typ=$(( sk + dg + ix + tp ));                        row "TYPICAL SESSION, 4-call flow"  "$typ" "$(tok "$typ")"
wst=$(( sk + dg + ix + ap ));                        row "WORST CASE, dumps every playbook" "$wst" "$(tok "$wst")"

# 'brief' collapses doctor + design + playbooks into one call.
if "$AREV" brief plan table >/dev/null 2>&1; then
  br=$("$AREV" brief plan table | wc -c | tr -d ' ')
  row "arev brief plan table" "$br" "$(tok "$br")"
  bt=$(( sk + br ));                                 row "TYPICAL SESSION, brief flow"   "$bt" "$(tok "$bt")"
fi

echo
printf '%-42s %10s\n' "METRIC" "VALUE"
printf '%-42s %10s\n' "------------------------------------------" "----------"

# --- round trips prescribed before the first artifact byte ------------------
rt=$(grep -cE '\$AREV" (doctor|design|playbook|brief)' "$SKILL/SKILL.md" || true)
printf '%-42s %10s\n' "prepare-phase arev calls in SKILL.md" "$rt"

# --- poll default vs a 120s harness ceiling ---------------------------------
pd=$(grep -oE 'default=[0-9]+, metavar="SECONDS"' "$SKILL/scripts/arev.py" | grep -oE '[0-9]+' || echo "?")
printf '%-42s %10s\n' "arev poll default --timeout (s)" "$pd"
if [ "$pd" != "?" ] && [ "$pd" -gt 120 ]; then
  printf '%-42s %10s\n' "  killed under a 120s harness ceiling" "YES"
else
  printf '%-42s %10s\n' "  killed under a 120s harness ceiling" "no"
fi

# --- wall clock -------------------------------------------------------------
printf '<!doctype html><html><body><h1>probe</h1></body></html>' > "$PROBE"
t0=$(python3 -c 'import time;print(time.time())')
"$AREV" open "$PROBE" --no-browser > /dev/null
t1=$(python3 -c 'import time;print(time.time())')
printf '%-42s %10s\n' "arev open (s)" "$(python3 -c "print(f'{$t1-$t0:.2f}')")"

# Two polls in a row: the second exposes the chunk-floor overrun past the deadline.
for n in 1 2; do
  t0=$(python3 -c 'import time;print(time.time())')
  "$AREV" poll "$PROBE" --timeout 6 > /dev/null
  t1=$(python3 -c 'import time;print(time.time())')
  printf '%-42s %10s\n' "idle poll $n of 2, --timeout 6, actual (s)" \
    "$(python3 -c "print(f'{$t1-$t0:.2f}')")"
done

"$AREV" stop "$PROBE" > /dev/null
rm -f "$PROBE"

echo
echo "Not covered here, measure by hand:"
echo "  - artifact emitted bytes: rebuild the same artifact with and without 'arev new',"
echo "    compare the bytes the model had to write (content only, not final file size)."
echo "  - repeated layout warnings: send two feedback batches on an unchanged page with a"
echo "    known severe finding, compare the 'layout_warnings' bytes in each poll payload."
