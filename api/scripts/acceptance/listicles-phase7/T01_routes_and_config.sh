#!/usr/bin/env bash
# Phase7.AC T01 (§7.2/§7.3/§16/§24/§31.6): the Phase-7 tracking surface
# exists and is wired — /lc resolver + /api/lst/track registered on the
# public router BEFORE the site-context middleware, the §7.3 resolver
# mechanics present (depth guard, cap-before-redirect atomic upsert,
# no-store, fail-safe '/'), LISTICLE_EVENTS_FIREHOSE_STREAM in ALL THREE
# wrangler env blocks + env.ts, the reconciliation cron wired, the
# post-cache HTMLRewriter injection in place, and the homepage analytics
# pipeline byte-untouched (no listicle references inside it).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "PASS [T01] $desc"
  else
    echo "FAIL [T01] $desc"
    FAIL=1
  fi
}

ROUTER="$REPO_ROOT/api/src/public/router.ts"
RESOLVER="$REPO_ROOT/api/src/public/listicle/resolver.ts"
TRACK="$REPO_ROOT/api/src/analytics/listicle-track.ts"
EVENTS="$REPO_ROOT/api/src/analytics/listicle-events.ts"
QUALITY="$REPO_ROOT/api/src/analytics/listicle-quality.ts"
RECON="$REPO_ROOT/api/src/analytics/listicle-reconciliation.ts"
CTXINJ="$REPO_ROOT/api/src/public/listicle/ctx-inject.ts"
KOCTX="$REPO_ROOT/api/src/public/listicle/ko-ctx.ts"
SERVE="$REPO_ROOT/api/src/public/listicle/serve.ts"
MACROS="$REPO_ROOT/api/src/listicles/macros.ts"
WRANGLER="$REPO_ROOT/api/wrangler.toml"
ENVTS="$REPO_ROOT/api/src/env.ts"
INDEX="$REPO_ROOT/api/src/index.ts"

# --- routes (§7.2) ------------------------------------------------------------
check "GET /lc/:oid registered on the public router" \
  bash -c "grep -q '\"/lc/:oid\"' '$ROUTER' && grep -q 'handleListicleClick' '$ROUTER'"
check "POST /api/lst/track router mounted on the public router" \
  bash -c "grep -q 'listicleTrackRouter' '$ROUTER' && grep -q '\"/api/lst/track\"' '$TRACK'"
check "both register BEFORE publicSiteContextMiddleware (host-independent, catch-all-proof)" \
  bash -c "awk '/\"\\/lc\\/:oid\"/{lc=NR} /listicleTrackRouter\\)/{tr=NR} /router.use\\(\"\\*\", publicSiteContextMiddleware\\)/{mw=NR} END{exit !(lc>0 && tr>0 && mw>0 && lc<mw && tr<mw)}' '$ROUTER'"

# --- §7.3 resolver mechanics ----------------------------------------------------
check "depth guard: at most ONE fallback hop" \
  bash -c "grep -q 'MAX_FALLBACK_DEPTH = 1' '$RESOLVER' && grep -q 'depth > MAX_FALLBACK_DEPTH' '$RESOLVER'"
check "active-only offer lookup + fail-safe '/'" \
  bash -c "grep -q \"status = 'active'\" '$RESOLVER' && grep -q 'never 500 a click' '$RESOLVER'"
check "cap check BEFORE redirect + atomic counter upsert (click_count = click_count + 1)" \
  bash -c "grep -q 'isCapReached' '$RESOLVER' && grep -q 'click_count = click_count + 1' '$RESOLVER' && grep -q 'ON CONFLICT(offer_id, cap_date)' '$RESOLVER'"
check "§31.8: cap increment gated on CLEAN traffic" \
  bash -c "grep -q \"traffic_quality_flag === \\\"clean\\\"\" '$RESOLVER'"
check "click_id minted server-side (crypto.randomUUID) + Cache-Control: private, no-store" \
  bash -c "grep -q 'crypto.randomUUID()' '$RESOLVER' && grep -q 'private, no-store' '$RESOLVER'"
check "fallback URL scheme-gated (no javascript:/protocol-relative)" \
  bash -c "grep -q 'safeFallbackUrl' '$RESOLVER' && grep -q \"startsWith(\\\"//\\\")\" '$RESOLVER'"
check "runtime {clickid} alias + unresolved-macro→empty-string policy live in macros.ts" \
  bash -c "grep -q 'export function resolveMacros' '$MACROS' && grep -q 'normalizeTemplate(template)' '$MACROS' && grep -q 'EMPTY STRING' '$MACROS'"

# --- ingest (§16/§24/§31.6/§31.8) ------------------------------------------------
check "track endpoint: 6-type allow-list, cap 20, always 204" \
  bash -c "grep -q 'MAX_LISTICLE_EVENTS_PER_REQUEST = 20' '$TRACK' && grep -q 'LISTICLE_EVENT_TYPES' '$EVENTS' && grep -q 'offer_impression' '$EVENTS' && grep -q 'c.body(null, 204)' '$TRACK'"
check "KV seen-set idempotency (short TTL) + dead-letter D1 row + record_kind=dead_letter" \
  bash -c "grep -q 'lst_seen:' '$TRACK' && grep -q 'LISTICLE_SEEN_TTL_SECONDS' '$TRACK' && grep -q 'INSERT INTO listicle_event_dead_letter' '$TRACK' && grep -q '\"dead_letter\"' '$EVENTS'"
check "sessions record on page_view with the record_kind discriminator" \
  bash -c "grep -q 'sessionFromPageView' '$TRACK' && grep -q 'record_kind: \"session\"' '$TRACK'"
check "§31.8 flags stamped (is_bot/is_internal/is_preview/traffic_quality_flag)" \
  bash -c "grep -q 'computeTrafficQuality' '$TRACK' && grep -q 'traffic_quality_flag' '$QUALITY' && grep -q 'ko_internal=1' '$QUALITY'"

# --- firehose wiring (no-op until provisioned) -------------------------------------
check "emitListicleRecords reuses sendToFirehose via import; homepage stream var untouched" \
  bash -c "grep -q 'import { sendToFirehose } from \"./firehose\"' '$EVENTS' && grep -q 'LISTICLE_EVENTS_FIREHOSE_STREAM' '$EVENTS' && grep -q 'status: \"noop\"' '$EVENTS'"
check "LISTICLE_EVENTS_FIREHOSE_STREAM = listicle-events in ALL THREE wrangler env blocks" \
  bash -c "[ \"\$(grep -c '^LISTICLE_EVENTS_FIREHOSE_STREAM = \"listicle-events\"' '$WRANGLER')\" = '3' ]"
check "env.ts declares the optional stream var" \
  bash -c "grep -q 'LISTICLE_EVENTS_FIREHOSE_STREAM?: string' '$ENVTS'"

# --- ko_ctx + post-cache injection (§9.4/§15.4/§31.3) --------------------------------
check "ko_ctx acquisition cookie: 30-day, merge semantics, fbc from fbclid" \
  bash -c "grep -q 'KO_CTX_MAX_AGE_SECONDS = 30 \\* 24 \\* 3600' '$KOCTX' && grep -q 'fb.1.' '$KOCTX' && grep -q 'buildKoCtx' '$SERVE'"
check "post-cache HTMLRewriter injection (sid + __LST_CTX + __LST_EXP) before the selector" \
  bash -c "grep -q 'HTMLRewriter' '$CTXINJ' && grep -q '_LST_SID' '$CTXINJ' && grep -q '__LST_CTX' '$CTXINJ' && grep -q 'injectListicleContext' '$SERVE'"
check "geo/device never in the cache key (listicleKey signature untouched)" \
  bash -c "grep -q 'listicleKey(siteContext.siteId, article.slug, version.public_id, version.content_version)' '$SERVE'"

# --- reconciliation cron (§31.6) -----------------------------------------------------
check "listicleDailyReconciliation wired into the scheduled handler (own try/catch)" \
  bash -c "grep -q 'listicleDailyReconciliation(env)' '$INDEX' && grep -q 'bumpListicleDailyAcceptCounter' '$RECON' && grep -q 'UNMEASURABLE_PRE_PHASE8' '$RECON'"

# --- homepage pipeline byte-untouched -------------------------------------------------
for f in events firehose router tracking-script; do
  check "analytics/$f.ts carries ZERO listicle references (extend-not-touch)" \
    bash -c "! grep -qi 'listicle' '$REPO_ROOT/api/src/analytics/$f.ts'"
done
check "infra docs for the conductor exist (aws-provision.md + athena-ddl.sql with every §16 column)" \
  bash -c "test -f '$REPO_ROOT/infra/listicles/aws-provision.md' && grep -q 'listicle-events' '$REPO_ROOT/infra/listicles/aws-provision.md' && grep -q 'matched_rule_json_hash' '$REPO_ROOT/infra/listicles/athena-ddl.sql' && grep -q 'record_kind' '$REPO_ROOT/infra/listicles/athena-ddl.sql' && grep -q 'traffic_quality_flag' '$REPO_ROOT/infra/listicles/athena-ddl.sql'"

exit $FAIL
