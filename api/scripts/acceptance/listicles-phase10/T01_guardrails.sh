#!/usr/bin/env bash
# Phase10.AC T01 — the §29 GUARDRAILS (every-PR row), grep/assert:
#   * verify:no-legacy-prod-refs green (§1 banned tokens absent in new files)
#   * NO existing table / route / cache / GA4 behavior changed (pillar-1):
#     the tracking ingest, homepage render, listicle serve/render, cache keys,
#     migrations, and env are byte-UNCHANGED vs HEAD.
#   * write-boundary: the only EXISTING product files this phase modified are
#     the two admin-UI files that carry the drilldown expander + rebuild control.
#   * ES5 byte-parse gate for all listicle inline scripts is present (run under
#     the vitest gate; asserted present here).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$API_DIR" || { echo "FAIL [T01] cannot cd to api dir"; exit 1; }

fail() { echo "FAIL [T01] $1"; exit 1; }

# 1) §1 banned tokens.
npm run --silent verify:no-legacy-prod-refs > /tmp/lst-p10-nolegacy.log 2>&1 \
  || { echo "FAIL [T01] verify:no-legacy-prod-refs"; tail -20 /tmp/lst-p10-nolegacy.log; exit 1; }

# 2) pillar-1 protected files unchanged vs HEAD (no destructive table/route/
#    cache/GA4 change). git resolves these paths relative to this cwd.
PROTECTED=(
  "src/analytics/events.ts"
  "src/analytics/router.ts"
  "src/public/router.ts"
  "src/public/listicle/serve.ts"
  "src/public/listicle/render.ts"
  "src/cache/cache-keys.ts"
  "src/env.ts"
)
for f in "${PROTECTED[@]}"; do
  if [ -e "$f" ]; then
    git diff --quiet HEAD -- "$f" || fail "protected pillar-1 file changed: $f"
  fi
done
# migrations directory untouched (no schema change this phase).
git diff --quiet HEAD -- migrations || fail "migrations changed (no schema change is permitted in Phase 10)"

# 3) write-boundary: the ONLY modified EXISTING files under src/ are the two
#    admin-UI files. (New untracked files — specs/tests/acceptance — are out of
#    scope for this diff by design.)
# NB: `git diff --name-only` prints paths relative to the REPO ROOT (this
# worktree keeps the worker under api/), hence the api/ prefix below.
CHANGED_SRC="$(git diff --name-only HEAD -- src | sort)"
ALLOWED=$'api/src/admin/listicles/ui-lists.ts\napi/src/admin/listicles/ui-shared.ts'
UNEXPECTED="$(comm -23 <(printf '%s\n' "$CHANGED_SRC" | sed '/^$/d') <(printf '%s\n' "$ALLOWED"))"
if [ -n "$UNEXPECTED" ]; then
  echo "FAIL [T01] unexpected modified src files (write-boundary):"
  printf '%s\n' "$UNEXPECTED"
  exit 1
fi

# 4) ES5 byte-parse gate present (the actual ES5 proof runs under vitest).
[ -f "test/listicles-ui-es5.test.ts" ] || fail "listicles-ui-es5.test.ts (ES5 byte-parse gate) missing"

echo "PASS [T01] §29 guardrails: no-legacy green; pillar-1 files byte-unchanged; write-boundary held; ES5 gate present"
echo "  changed src files: $(printf '%s' "$CHANGED_SRC" | tr '\n' ' ')"
exit 0
