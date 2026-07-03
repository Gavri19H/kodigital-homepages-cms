#!/usr/bin/env bash
# Phase6.AC T03: the Phase-6 behavioral vitest suites pass —
#   registry (unknown→default) · ab-hash frozen §31.2 vectors + 1M
#   distribution + honest chi-square · experiment-pick stickiness ·
#   listicleKey shape · routing (published-200 / draft-fallthrough /
#   precedence / cache-HIT / 304 / cookies) · fan-out over real sqlite
#   (bump + invalidate + warm; publish TODO replaced) · payload guard ·
#   governed URLs · document assembly + XSS · inline-script ES5 +
#   node --check · measured-token conformance.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

cd "$API_DIR" || exit 1

if ! command -v npx >/dev/null 2>&1; then
  echo "NEEDS_RUNTIME [T03] npx not available"
  exit 2
fi

npx vitest run \
  test/listicles-registry.test.ts \
  test/listicles-ab-hash.test.ts \
  test/listicles-experiment-pick.test.ts \
  test/listicles-cache-key.test.ts \
  test/listicles-governed-url.test.ts \
  test/listicles-measured-values.test.ts \
  test/listicles-payload-guard.test.ts \
  test/listicles-render-document.test.ts \
  test/listicles-routing.test.ts \
  test/listicles-fanout.test.ts \
  test/listicles-inline-es5.test.ts
rc=$?

if [ "$rc" -eq 0 ]; then
  echo "PASS [T03] Phase-6 behavioral vitest suites green"
  exit 0
fi
echo "FAIL [T03] Phase-6 behavioral vitest suites (exit $rc)"
exit 1
