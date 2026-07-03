#!/usr/bin/env bash
# Phase7.AC T03: the Phase-7 behavioral vitest suites pass —
#   /lc resolver (§7.3 branches over REAL sqlite: unknown/paused → '/',
#   cap fallback one hop, depth guard, macro resolution incl. ko_ctx + cf
#   dims + {clickid} alias + unresolved-empty, pv passthrough, non-clean
#   skips the cap, no-store, scheme-gated fallback) · track endpoint (204
#   always, cap 20, KV dedupe, dead-letter, §31.8 flags, sessions record,
#   no reflection) · ES5 vm hash parity (frozen vectors + fuzz) · selector
#   semantics (sticky/single/ab/rule/fallback in vm) · ko_ctx round-trip ·
#   ctx-inject (KV pristine / response injected / sid reuse-vs-mint) ·
#   impression contract + dwell simulation · durable-delivery queue ·
#   reconciliation counter/report · the updated Phase-6 render/guard suites.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

cd "$API_DIR" || exit 1

if ! command -v npx >/dev/null 2>&1; then
  echo "NEEDS_RUNTIME [T03] npx not available"
  exit 2
fi

npx vitest run \
  test/listicles-resolver.test.ts \
  test/listicles-track.test.ts \
  test/listicles-es5-hash-parity.test.ts \
  test/listicles-selector.test.ts \
  test/listicles-ko-ctx.test.ts \
  test/listicles-ctx-inject.test.ts \
  test/listicles-impressions-contract.test.ts \
  test/listicles-durable-queue.test.ts \
  test/listicles-reconciliation.test.ts \
  test/listicles-macros.test.ts \
  test/listicles-payload-guard.test.ts \
  test/listicles-inline-es5.test.ts \
  test/listicles-routing.test.ts
rc=$?

if [ "$rc" -ne 0 ]; then
  echo "FAIL [T03] phase-7 behavioral suites"
  exit 1
fi
echo "PASS [T03] phase-7 behavioral suites"
exit 0
