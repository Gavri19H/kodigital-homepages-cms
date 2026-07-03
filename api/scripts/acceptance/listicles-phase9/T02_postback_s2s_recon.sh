#!/usr/bin/env bash
# Phase9.AC T02 (§19/§20/§31.7/§9.3/§24): the postback STEPS, the S2S dispatcher,
# the dedupe UNIQUE, the 72h re-match window, FX revenue_usd, in-site payout, the
# conversion→S2S wiring, and the DEV-6 offer_public_id→offer_id shipper map are
# all present in the source.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

FAIL=0
check() { local desc="$1"; shift; if "$@"; then echo "PASS [T02] $desc"; else echo "FAIL [T02] $desc"; FAIL=1; fi; }

PB="$REPO_ROOT/api/src/public/listicle/postback.ts"
S2S="$REPO_ROOT/api/src/listicles/s2s-dispatch.ts"
ING="$REPO_ROOT/api/src/listicles/revenue-ingest.ts"
RECON="$REPO_ROOT/api/src/listicles/revenue-recon.ts"
FX="$REPO_ROOT/api/src/listicles/fx.ts"
TRACK="$REPO_ROOT/api/src/analytics/listicle-track.ts"
CH="$REPO_ROOT/api/src/listicles/clickhouse.ts"
MIG="$REPO_ROOT/api/migrations/0034_listicles_revenue_infra.sql"

# --- §19/§24 postback steps --------------------------------------------------
check "step 1 verifyToken (per-provider secret) + constant-time compare" \
  bash -c "grep -q 'verifyPostbackToken' '$PB' && grep -q 'timingSafeEqualStr' '$PB' && grep -q 'LISTICLE_PB_TOKEN_' '$PB'"
check "step 1 unknown provider → 404; bad token → 401" \
  bash -c "grep -q '\"unknown provider\"' '$PB' && grep -q '404' '$PB' && grep -q '\"unauthorized\"' '$PB' && grep -q '401' '$PB'"
check "step 2 strict payload adapters (generic + capi, sub-mapping)" \
  bash -c "grep -q 'genericAdapter' '$PB' && grep -q 'capiAdapter' '$PB' && grep -q 'POSTBACK_ADAPTERS' '$PB'"
check "step 3 dedupe via listicle_postback_log UNIQUE(provider, external_txn_id) → 200 no-op" \
  bash -c "grep -q 'listicle_postback_log' '$PB' && grep -q 'external_txn_id' '$PB' && grep -q 'duplicate' '$PB'"
check "step 4 revenue_raw insert source='s2s_postback' conversions:1" \
  bash -c "grep -q \"'s2s_postback'\" '$PB' && grep -q 'listicle_revenue_raw' '$PB'"
check "step 4 unmatched queue on no-match (§31.7 pending)" \
  bash -c "grep -q 'queueRevenueUnmatched' '$PB' && grep -q 'queueRevenueUnmatched' '$ING'"
check "step 5 conversion cap increment (clean-only via CH clean match)" \
  bash -c "grep -q 'bumpCapConversions' '$PB' && grep -q 'isConversionCapped' '$PB'"
check "step 6 fast 200 + heavy work on ctx.waitUntil + NO reflection" \
  bash -c "grep -q 'waitUntil' '$PB' && grep -q '\"accepted\"' '$PB'"
check "step 6 rate-limited (per-provider KV)" \
  bash -c "grep -q 'checkPostbackRateLimit' '$PB' && grep -q 'POSTBACK_RATE_LIMIT_PER_MINUTE' '$PB'"
check "FX revenue_usd computed from listicle_fx_rates on the unmatched row" \
  bash -c "grep -q 'computeRevenueUsd' '$PB' && grep -q 'listicle_fx_rates' '$FX' && grep -q 'revenue_usd' '$FX'"

# --- §20 outbound S2S dispatcher ---------------------------------------------
check "S2S: enabled platform lookup by traffic_source (enabled=1)" \
  bash -c "grep -q 'getEnabledPlatformByTrafficSource' '$S2S' && grep -q 'enabled = 1' '$S2S'"
check "S2S: postback_url_template macro resolution (reuse resolveMacros) incl fbc-from-fbclid" \
  bash -c "grep -q 'resolveMacros' '$S2S' && grep -q 'deriveFbc' '$S2S' && grep -q 'postback_url_template' '$S2S'"
check "S2S: fired on ctx.waitUntil, failures logged never thrown" \
  bash -c "grep -q 'ctx.waitUntil' '$S2S' && grep -q 'never block' '$S2S'"
check "S2S: prefer S2S; new platform = config row (no code change)" \
  bash -c "grep -q 'listicle_media_platforms' '$S2S'"
check "conversion→S2S wiring in listicle-track.ts (both paths)" \
  bash -c "grep -q 'processConversionEvent' '$TRACK' && grep -q 'dispatchMatchedConversionS2S' '$TRACK'"

# --- §9.3/§19 in-site payout -------------------------------------------------
check "in-site payout records source='in_site' + conversion cap" \
  bash -c "grep -q 'recordInSitePayout' '$ING' && grep -q \"'in_site'\" '$ING' && grep -q \"payout_method !== \\\"in_site\\\"\" '$ING'"

# --- §31.7 reconciliation / backfill / shipper -------------------------------
check "72h re-match window constant" grep -q "UNMATCHED_WINDOW_MS = 72" "$RECON"
check "re-match runs against CH offer_click (clean) + age-out to unattributed" \
  bash -c "grep -q 'offer_click' '$RECON' && grep -q \"'unattributed'\" '$RECON' && grep -q \"'matched'\" '$RECON'"
check "attribution-MV backfill trigger (SYSTEM REFRESH VIEW)" \
  bash -c "grep -q 'SYSTEM REFRESH VIEW' '$RECON' && grep -q 'lst_revenue_attributed_mv' '$RECON'"
check "DEV-6 D1→CH shipper maps offer_public_id → offer_id" \
  bash -c "grep -q 'offer_id: r.offer_public_id' '$RECON' && grep -q 'synced_to_ch_at' '$RECON'"
check "daily provider reconciliation + honest null provider_report_total" \
  bash -c "grep -q 'dailyProviderReconciliation' '$RECON' && grep -q 'NO_PROVIDER_REPORT_SOURCE' '$RECON'"
check "§19 script/API channel skeleton (ingestProviderReports + stub adapter)" \
  bash -c "grep -q 'ingestProviderReports' '$RECON' && grep -q 'stubReportAdapter' '$RECON'"
check "CH client gained write path (insert JSONEachRow + command) — query byte-safe" \
  bash -c "grep -q 'FORMAT JSONEachRow' '$CH' && grep -q 'INSERTABLE_TABLES' '$CH' && grep -q 'lst_revenue_raw' '$CH'"

# --- D1 safety + migration 0034 dedupe UNIQUE --------------------------------
check "migration 0034 dedupe UNIQUE(provider, external_txn_id)" \
  bash -c "grep -q 'UNIQUE (provider, external_txn_id)' '$MIG'"
check "D1 .bind parameterized (no template interpolation in revenue SQL)" \
  bash -c "! grep -Eq 'prepare\(\`[^\`]*\\\$\{' '$PB' '$ING' '$RECON'"

# --- Adversarial-review hardening (FIX 1-5) ----------------------------------
MIG35="$REPO_ROOT/api/migrations/0035_listicles_conversion_dedupe.sql"
TRACK="$REPO_ROOT/api/src/analytics/listicle-track.ts"
check "FIX 1: migration 0035 listicle_conversion_log UNIQUE(click_id, dedupe_key)" \
  bash -c "test -f '$MIG35' && grep -q 'listicle_conversion_log' '$MIG35' && grep -q 'UNIQUE (click_id, dedupe_key)' '$MIG35'"
check "FIX 1: in-site payout is durably deduped (batch: gated revenue insert + conversion_log)" \
  bash -c "grep -q 'listicle_conversion_log' '$ING' && grep -q 'WHERE NOT EXISTS' '$ING' && grep -q 'db.batch' '$ING'"
check "FIX 1c: no durable booking key ⇒ never book (deriveConversionBookingKey)" \
  bash -c "grep -q 'deriveConversionBookingKey' '$TRACK' && grep -q 'no durable booking key' '$TRACK'"
check "FIX 1: booking key = client event_id captured BEFORE the server-mint" \
  bash -c "grep -q 'clientEventIds' '$TRACK'"
check "FIX 2: postback strips the token before persisting payload_json" \
  bash -c "grep -q 'delete payload\[authField\]' '$PB' && grep -q 'wrangler secret' '$PB'"
check "FIX 3: postback log + revenue_raw insert are ONE atomic db.batch (503 on rollback)" \
  bash -c "grep -q 'db.batch(' '$PB' && grep -q '503' '$PB'"
check "FIX 4: S2S dedup key includes the conversion identity" \
  bash -c "grep -q 'conversion_id' '$S2S'"
check "FIX 5: token compare hashes both sides (SHA-256, length-safe)" \
  bash -c "grep -q 'SHA-256' '$PB'"
check "deploy.yml anchors migration 0035" \
  bash -c "grep -q '0035_listicles_conversion_dedupe.sql' '$REPO_ROOT/.github/workflows/deploy.yml'"

exit $FAIL
