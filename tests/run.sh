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
  # A passing run keeps nothing. A failing run keeps the logs it just named.
  [ -n "${KEEP_LOGS-}" ] || rm -rf "$WORK"
}
trap cleanup EXIT

run() {
  local name="$1" script="$2" fixture="$3"
  local art="$WORK/$name artifact.html"
  cp "$ROOT/tests/fixtures/$fixture" "$art"
  echo "== $name"
  local raw="$WORK/$name.log"
  node "$ROOT/tests/legacy/$script" "$art" > "$raw" 2>&1
  local code=$?
  grep -E "^(PASS|FAIL|pageerrors)" "$raw" | tee -a "$OUT"
  # A crashed drive prints no FAIL lines. Count the crash itself as one.
  if [ $code -ne 0 ] && ! grep -q "^FAIL" "$raw"; then
    echo "FAIL $name drive crashed (exit $code) - see $raw" | tee -a "$OUT"
    tail -5 "$raw"
  fi
}

echo "== cli-foundation"
CLI_RAW="$WORK/cli-foundation.log"
if python3 "$ROOT/tests/runtime/test_cli_foundation.py" > "$CLI_RAW" 2>&1; then
  echo "PASS CLI lifecycle, registry, URL, and heartbeat foundation" | tee -a "$OUT"
else
  echo "FAIL CLI foundation - see $CLI_RAW" | tee -a "$OUT"
  tail -20 "$CLI_RAW"
fi

echo "== asset-delivery"
ASSET_RAW="$WORK/asset-delivery.log"
if python3 "$ROOT/tests/runtime/test_asset_delivery.py" > "$ASSET_RAW" 2>&1; then
  echo "PASS hashed, compressed, conditional asset delivery" | tee -a "$OUT"
else
  echo "FAIL asset delivery - see $ASSET_RAW" | tee -a "$OUT"
  tail -20 "$ASSET_RAW"
fi

echo "== review-store"
STORE_RAW="$WORK/review-store.log"
if python3 "$ROOT/tests/runtime/test_review_store.py" > "$STORE_RAW" 2>&1; then
  echo "PASS normalized SQLite persistence, migration, and recovery" | tee -a "$OUT"
else
  echo "FAIL review store - see $STORE_RAW" | tee -a "$OUT"
  tail -20 "$STORE_RAW"
fi

echo "== reports-retention"
REPORT_RAW="$WORK/reports-retention.log"
if python3 "$ROOT/tests/runtime/test_reports_retention.py" > "$REPORT_RAW" 2>&1; then
  echo "PASS reusable reports, archives, retention, and delayed shutdown" | tee -a "$OUT"
else
  echo "FAIL reports and retention - see $REPORT_RAW" | tee -a "$OUT"
  tail -20 "$REPORT_RAW"
fi

echo "== artifact-checks"
CHECKS_RAW="$WORK/artifact-checks.log"
if python3 "$ROOT/tests/runtime/test_checks.py" > "$CHECKS_RAW" 2>&1; then
  echo "PASS artifact checks, source coverage, and guidance staleness" | tee -a "$OUT"
else
  echo "FAIL artifact checks - see $CHECKS_RAW" | tee -a "$OUT"
  tail -20 "$CHECKS_RAW"
fi

run rail selftest-rail.mjs clean.html
run wb   selftest-whiteboard.mjs clean.html
run wboff selftest-whiteboard-offline.mjs clean.html
run diagrams selftest-diagram-features.mjs diagram-features.html
run mermaidfail selftest-mermaid-failure.mjs mermaid-broken.html
run diagramquality selftest-diagram-quality.mjs themed.html

echo
if grep -q "^FAIL" "$OUT"; then
  KEEP_LOGS=1
  echo "SELFTEST: FAIL"
  echo "Logs: $WORK"
  exit 1
fi
echo "SELFTEST: PASS"
