#!/usr/bin/env bash
# Phase8.AC T03: the Phase-8 behavioral vitest suites pass —
#   CH client (query shaping, no-op on missing creds, error isolation) ·
#   mirror-sync over REAL sqlite (idempotent §18 upsert, DEV-6 offer map,
#   window bound, per-table error isolation, fail-open) · read-path light-up
#   through the EXISTING Phase-2 endpoints (offer/section/article/drilldown +
#   §30.7 link-instances) with NULLIF ratios · rebuild-range endpoint ·
#   reconciliation ch_ingested wiring · the DDL structural lint · and the
#   Phase-7 reconciliation suite (unchanged behavior after ch_ingested wiring).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

cd "$API_DIR" || exit 1

if ! command -v npx >/dev/null 2>&1; then
  echo "NEEDS_RUNTIME [T03] npx not available"
  exit 2
fi

npx vitest run \
  test/listicles-clickhouse.test.ts \
  test/listicles-mirror-sync.test.ts \
  test/listicles-ch-ddl-lint.test.ts \
  test/listicles-reconciliation.test.ts
rc=$?

if [ "$rc" -ne 0 ]; then
  echo "FAIL [T03] phase-8 behavioral suites"
  exit 1
fi
echo "PASS [T03] phase-8 behavioral suites"
exit 0
