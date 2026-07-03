#!/usr/bin/env bash
# Phase9.AC T03: the Phase-9 behavioral vitest suites pass on REAL node:sqlite +
# migration 0034 (postback steps, S2S dispatch + in-site payout, reconciliation
# + FX + media-platforms CRUD). Runs the three Phase-9 spec files.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

cd "$API_DIR" || { echo "FAIL [T03] cannot cd to api dir"; exit 1; }

npx vitest run \
  test/listicles-postback.test.ts \
  test/listicles-s2s-dispatch.test.ts \
  test/listicles-revenue-recon.test.ts \
  > /tmp/lst-p9-vitest.log 2>&1
rc=$?

if [ "$rc" -eq 0 ]; then
  tail -3 /tmp/lst-p9-vitest.log
  echo "PASS [T03] Phase-9 vitest behavioral suites green"
  exit 0
fi
echo "FAIL [T03] Phase-9 vitest behavioral suites (see /tmp/lst-p9-vitest.log)"
tail -25 /tmp/lst-p9-vitest.log
exit 1
