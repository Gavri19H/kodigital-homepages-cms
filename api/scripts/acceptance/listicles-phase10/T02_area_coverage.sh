#!/usr/bin/env bash
# Phase10.AC T02 — the §29 per-area boxes cross-checked: every checklist area
# (schema / API / admin-UI / editor / builder / render+cache / tracking+exp /
# analytics / revenue) has its implementation AND a test suite present. A
# structural completeness sweep — not a behavioral run (that is T03 + the
# vitest/playwright gates).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$API_DIR" || { echo "FAIL [T02] cannot cd to api dir"; exit 1; }

RC=0
need_file() { if [ -e "$1" ]; then echo "  ok  file $1"; else echo "  MISS file $1 ($2)"; RC=1; fi; }
need_grep() { if grep -rqs -- "$1" "$2" 2>/dev/null; then echo "  ok  grep '$1' in $2"; else echo "  MISS grep '$1' in $2 ($3)"; RC=1; fi; }

echo "[schema §6/§27] migrations + phase1 acceptance"
need_file "migrations/0032_listicles_core.sql" "core tables"
need_file "migrations/0033_listicles_analytics_mirror.sql" "mirrors"
need_file "migrations/0034_listicles_revenue_infra.sql" "revenue infra"
need_file "migrations/0035_listicles_conversion_dedupe.sql" "conversion dedupe"
need_file "scripts/acceptance/listicles-phase1/run_all.sh" "schema acceptance"

echo "[API §7.1] routes + field-keyed errors + drilldown + rebuild-range"
need_file "src/admin/listicles/router.ts" "admin router"
need_grep "articles/:id/drilldown" "src/admin/listicles/router.ts" "§11 drilldown endpoint"
need_grep "analytics/rebuild-range" "src/admin/listicles/router.ts" "§18 backfill endpoint"
need_grep "articles/:id/link-instances" "src/admin/listicles/router.ts" "§30.7 link-instance read"
need_file "src/listicles/validation.ts" "field-keyed validators"
need_grep "/lc" "src/public/router.ts" "click resolver mount"
need_grep "/api/lst/track" "src/public/router.ts" "beacon ingest mount"

echo "[admin-UI §8/§11 + Phase-10 new surfaces]"
need_file "src/admin/listicles/ui-offers.ts" "offers UI"
need_file "src/admin/listicles/ui-lists.ts" "lists UI"
need_grep "data-lst-drill-toggle" "src/admin/listicles/ui-lists.ts" "§11 drilldown EXPANDER (NEW)"
need_grep "data-lst-rebuild-run" "src/admin/listicles/ui-lists.ts" "§18 rebuild-range control (NEW)"
need_file "test/listicles-phase10-ui.test.ts" "Phase-10 UI render test"

echo "[editor §12] governed grammar + offer modal"
need_file "src/editor/listicle-blocks.ts" "block grammar"
need_file "src/admin/listicles/ui-section-editor.ts" "section editor"
need_file "src/admin/listicles/ui-offer-picker.ts" "§13 offer modal"

echo "[builder §5/§15] versions + rules + conflict matrix"
need_file "src/admin/listicles/ui-article-builder.ts" "builder UI"
need_file "src/listicles/rules.ts" "rule engine + §15.5 conflict"
need_grep "conflict" "src/listicles/rules.ts" "conflict guard"

echo "[render+cache §6/§22] layout + serve + keys + fan-out"
need_file "src/public/listicle/render.ts" "render"
need_file "src/public/listicle/serve.ts" "serve/cache"
need_file "src/cache/cache-keys.ts" "listicleKey()"
need_file "src/listicles/invalidate.ts" "fan-out invalidation"

echo "[tracking+experimentation §7.3/§15.3/§16/§31] runtime + resolver + ingest"
need_file "src/public/listicle/runtime.ts" "pre-paint selector + impressions"
need_file "src/public/listicle/resolver.ts" "/lc resolver"
need_file "src/analytics/listicle-track.ts" "beacon ingest + durable delivery"

echo "[analytics §17/§18] CH DDL + mirror sync + read handlers"
need_file "src/listicles/mirror-sync.ts" "CH→D1 sync + rebuildRange"
need_file "src/admin/listicles/analytics-admin-handlers.ts" "rebuild + link-instance"
need_file "../infra/listicles/clickhouse-ddl.sql" "CH DDL (repo-root infra/)"

echo "[revenue §19/§20] postback + attribution + S2S"
need_file "src/public/listicle/postback.ts" "provider postback"
need_file "src/listicles/revenue-ingest.ts" "in-site payout + dedupe"
need_file "src/listicles/s2s-dispatch.ts" "outbound S2S"

echo "[tests present per area]"
for suite in \
  "test/listicles-offers.test.ts:offers" \
  "test/listicles-sections.test.ts:sections" \
  "test/listicles-articles.test.ts:articles" \
  "test/listicles-rules.test.ts:rules" \
  "test/listicles-render.test.ts:render" \
  "test/listicles-track.test.ts:tracking" \
  "test/listicles-mirror-sync.test.ts:analytics" \
  "test/listicles-postback.test.ts:revenue" ; do
  f="${suite%%:*}"; label="${suite##*:}"
  if [ -f "$f" ]; then echo "  ok  test $label ($f)"; else
    # tolerate naming drift: any test file mentioning the area keyword.
    if ls test/listicles-*"$label"*.test.ts >/dev/null 2>&1; then echo "  ok  test $label (glob)"; else
      echo "  MISS test $label"; RC=1; fi
  fi
done

if [ "$RC" -eq 0 ]; then
  echo "PASS [T02] every §29 area has implementation + tests present"
else
  echo "FAIL [T02] one or more §29 areas missing implementation or tests (see MISS lines)"
fi
exit "$RC"
