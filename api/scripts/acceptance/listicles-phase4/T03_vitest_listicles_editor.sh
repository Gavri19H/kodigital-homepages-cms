#!/usr/bin/env bash
# Phase4.AC (behavioral): the Phase-4 vitest suites run for real —
# renderers/sanitizer/presets (§12/§30.5), extractor + enrichment parity +
# lnk_ stability (§30.7/§30.9), tokens→CSS (§30.1/§30.6), the section save
# pipeline round-trip + preview endpoint, the editor page routes/anatomy/
# no-URL-field, and the ES5 byte-parse discipline for the new pages.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"

cd "$API_DIR" || exit 1

if ! command -v npx >/dev/null 2>&1; then
  echo "NEEDS_RUNTIME [T03] npx is not available"
  exit 2
fi

npx vitest run \
  test/listicles-editor-blocks.test.ts \
  test/listicles-default-editor-isolation.test.ts \
  test/listicles-link-extraction.test.ts \
  test/listicles-tokens-css.test.ts \
  test/listicles-section-save.test.ts \
  test/listicles-section-editor-page.test.ts \
  test/listicles-editor-es5.test.ts \
  test/listicles-ui-es5.test.ts \
  test/listicles-ui.test.ts
rc=$?
if [ "$rc" -eq 0 ]; then
  echo "PASS [T03] listicles Phase-4 vitest suites green"
  exit 0
fi
echo "FAIL [T03] listicles Phase-4 vitest suites failed (rc=$rc)"
exit 1
