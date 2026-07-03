#!/usr/bin/env bash
# Phase10.AC T03 — the §26 manual-QA + §22 perf/regression e2e specs are
# WIRED and COVER the checklist, and RUN when a dev server is available.
# Behavioral: exit 2 = NEEDS_RUNTIME (no dev server on :8787 — the real run is
# gate #5 `npm run seed:local && npx playwright test`); exit 0 = specs present +
# cover the required drives (+ green if a server was up); exit 1 = a covered
# drive is missing or the specs failed against a live server.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$API_DIR" || { echo "FAIL [T03] cannot cd to api dir"; exit 1; }

MQA="test-ui/listicles-manual-qa.spec.ts"
PERF="test-ui/listicles-perf-regression.spec.ts"

RC=0
need() { if grep -qs -- "$1" "$2"; then echo "  ok  $3"; else echo "  MISS $3 ('$1' in $2)"; RC=1; fi; }

[ -f "$MQA" ]  || { echo "FAIL [T03] missing $MQA"; exit 1; }
[ -f "$PERF" ] || { echo "FAIL [T03] missing $PERF"; exit 1; }

echo "[§26 manual-QA coverage]"
need "§26 Offers" "$MQA" "Offers group driven"
need "§26 Sections" "$MQA" "Sections group driven"
need "§26 Articles + experimentation" "$MQA" "Articles+experimentation group driven"
need "§26 Tracking & analytics" "$MQA" "Tracking & analytics group driven"
need "data-lst-drill-toggle" "$MQA" "drilldown EXPANDER driven (NEW §11 UI)"
need "85.00%" "$MQA" "rule_match_rate asserted in the expander"
need "data-lst-rebuild-run" "$MQA" "rebuild-range control driven (NEW §18 UI)"
need "/lc/" "$MQA" "click resolver 302 driven"
need "offer_impression" "$MQA" "impression beacons driven"
need "/api/track" "$MQA" "homepage isolation (POST /api/track 204)"

echo "[§22/§21 perf + regression coverage]"
need "largest-contentful-paint" "$PERF" "LCP measured"
need "layout-shift" "$PERF" "CLS measured"
need "If-None-Match" "$PERF" "cache 304 conditional GET"
need "googletagmanager.com/gtag" "$PERF" "GA4 loader asserted"
need "not_a_real_event" "$PERF" "homepage.events schema guard (unknown-type drop)"

if [ "$RC" -ne 0 ]; then
  echo "FAIL [T03] a required §26/§22 drive is not covered by the specs"
  exit 1
fi

# Behavioral run — only if a dev server is already up (do not start one here;
# gate #5 owns the seeded full run).
if curl -fsS --max-time 3 http://127.0.0.1:8787/health >/dev/null 2>&1; then
  echo "[T03] dev server detected — running the two Phase-10 e2e specs"
  if npx playwright test listicles-manual-qa listicles-perf-regression > /tmp/lst-p10-e2e.log 2>&1; then
    tail -4 /tmp/lst-p10-e2e.log
    echo "PASS [T03] §26 manual-QA + §22 perf specs green against the live dev server"
    exit 0
  fi
  echo "FAIL [T03] Phase-10 e2e specs failed (see /tmp/lst-p10-e2e.log)"
  tail -30 /tmp/lst-p10-e2e.log
  exit 1
fi

echo "NEEDS_RUNTIME [T03] specs present + cover every §26/§22 drive; no dev server on :8787 (run gate #5)"
exit 2
