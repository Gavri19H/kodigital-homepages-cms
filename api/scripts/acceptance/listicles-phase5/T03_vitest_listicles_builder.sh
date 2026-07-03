#!/usr/bin/env bash
# Phase5.AC behavioral gate: the Phase-5 vitest suites — fork/new-revision/
# byline/lifecycle/search (listicles-version-fork), the §30.6 preview incl.
# rule simulation + CTA density (listicles-version-preview), and the builder
# page anatomy + ES5 byte-parse + §15.5 matrix model + shell routes
# (listicles-builder-page) — plus the Phase-2/3 listicles suites they touch
# (versions/articles/ui) to prove no regression.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

cd "$API_DIR" || exit 1

if [ ! -d node_modules ]; then
  echo "NEEDS_RUNTIME [T03] node_modules missing — run npm ci first"
  exit 2
fi

npx vitest run \
  test/listicles-version-fork.test.ts \
  test/listicles-version-preview.test.ts \
  test/listicles-builder-page.test.ts \
  test/listicles-articles-api.test.ts \
  test/listicles-ui.test.ts \
  test/listicles-ui-es5.test.ts \
  test/listicles-validation.test.ts
rc=$?
if [ "$rc" -eq 0 ]; then
  echo "PASS [T03] phase-5 vitest suites green"
  exit 0
fi
echo "FAIL [T03] vitest exited $rc"
exit 1
