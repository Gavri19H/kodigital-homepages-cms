#!/usr/bin/env bash
# Phase8.AC T01 (§17.1/§17.2/§17.3/§31.8): the ClickHouse DDL is complete and
# convention-correct — 3 raw tables, the revenue-attribution MV + target, the
# 5 daily targets + MVs, all IF NOT EXISTS, every default MV filters
# traffic_quality_flag='clean', and the offer MV's WHERE notEmpty(offer_id)
# FOLLOWS the JOIN and is never `= ''`.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T01] $desc"; else echo "FAIL [T01] $desc"; FAIL=1; fi
}

DDL="$REPO_ROOT/infra/listicles/clickhouse-ddl.sql"

check "clickhouse-ddl.sql exists" test -f "$DDL"

# --- §17.1 raw tables --------------------------------------------------------
for t in lst_events_raw lst_sessions lst_revenue_raw; do
  check "raw table $t (IF NOT EXISTS)" grep -q "CREATE TABLE IF NOT EXISTS $t" "$DDL"
done
# v1.2.2 + link-instance dims present on the raw event table
check "lst_events_raw carries page_view_id + quality flags + offer/click dims" \
  bash -c "grep -q 'page_view_id' '$DDL' && grep -q 'is_bot' '$DDL' && grep -q 'is_internal' '$DDL' && grep -q 'is_preview' '$DDL' && grep -q 'traffic_quality_flag' '$DDL' && grep -q 'link_instance_id' '$DDL' && grep -q 'analytics_label' '$DDL'"

# --- §17.2 revenue attribution ----------------------------------------------
check "revenue-attributed target table" grep -q "CREATE TABLE IF NOT EXISTS lst_revenue_attributed " "$DDL"
check "revenue-attributed MV REFRESH EVERY 2 MINUTE TO target" \
  grep -q "REFRESH EVERY 2 MINUTE TO lst_revenue_attributed AS" "$DDL"
check "revenue MV joins offer_click by click_id" \
  bash -c "grep -q \"event_type = 'offer_click'\" '$DDL' && grep -q 'ON r.click_id = c.click_id' '$DDL'"
check "revenue MV carries link-instance dims" \
  bash -c "grep -q 'c.link_instance_id' '$DDL' && grep -q 'c.link_role' '$DDL'"

# --- §17.3 five daily targets + MVs -----------------------------------------
for t in lst_offer_daily lst_section_daily lst_article_daily lst_drilldown_daily lst_link_instance_daily; do
  check "daily target $t (IF NOT EXISTS)" grep -q "CREATE TABLE IF NOT EXISTS $t " "$DDL"
  check "daily MV ${t}_mv REFRESH EVERY 2 MINUTE TO target" \
    grep -q "REFRESH EVERY 2 MINUTE TO $t AS" "$DDL"
done

# offer impressions from offer_impression; article total_visits from page_view
check "offer MV impressions = count(offer_impression)" \
  grep -q "sumIf(1, e.event_type='offer_impression')" "$DDL"
check "article MV total_visits = count(page_view)" \
  grep -q "sumIf(1, e.event_type='page_view')" "$DDL"
check "drilldown MV matched/fallback via uniqExactIf(selection_reason)" \
  bash -c "grep -q \"selection_reason='rule_match'\" '$DDL' && grep -q \"selection_reason='fallback'\" '$DDL'"

# --- §31.8 clean filter on every MV (>= 6 occurrences) -----------------------
CLEAN_COUNT="$(grep -c "traffic_quality_flag = 'clean'" "$DDL")"
check "traffic_quality_flag='clean' on all six default MVs (>=6 occurrences)" \
  test "$CLEAN_COUNT" -ge 6

# --- §17.3 notEmpty(offer_id) FOLLOWS the JOIN, never `= ''` ------------------
check "offer MV: notEmpty(e.offer_id) present" grep -q "notEmpty(e.offer_id)" "$DDL"
check "offer MV: never offer_id = '' (banned form)" \
  bash -c "! grep -Eq \"offer_id[[:space:]]*=[[:space:]]*''\" '$DDL'"
# ordering: within the offer MV block the LEFT JOIN line precedes the notEmpty line
OFFER_BLOCK="$(awk '/REFRESH EVERY 2 MINUTE TO lst_offer_daily AS/,/;/' "$DDL")"
JOIN_LINE="$(printf '%s\n' "$OFFER_BLOCK" | grep -n 'LEFT JOIN' | head -1 | cut -d: -f1)"
NE_LINE="$(printf '%s\n' "$OFFER_BLOCK" | grep -n 'notEmpty(e.offer_id)' | head -1 | cut -d: -f1)"
check "offer MV: WHERE notEmpty(offer_id) FOLLOWS the JOIN" \
  bash -c "[ -n '$JOIN_LINE' ] && [ -n '$NE_LINE' ] && [ '$NE_LINE' -gt '$JOIN_LINE' ]"

# --- conventions -------------------------------------------------------------
check "every CREATE TABLE is IF NOT EXISTS" \
  bash -c "! grep -E 'CREATE TABLE' '$DDL' | grep -qv 'IF NOT EXISTS'"
check "every CREATE MATERIALIZED VIEW is IF NOT EXISTS" \
  bash -c "! grep -E 'CREATE MATERIALIZED VIEW' '$DDL' | grep -qv 'IF NOT EXISTS'"
check "ReplacingMergeTree + PARTITION BY toYYYYMM(dt) used" \
  bash -c "grep -q 'ReplacingMergeTree' '$DDL' && grep -q 'PARTITION BY toYYYYMM(dt)' '$DDL'"

# --- record_kind feeding assumption documented -------------------------------
check "DDL documents the record_kind / Athena->CH feeding assumption" \
  bash -c "grep -qi 'record_kind' '$DDL' && grep -qi 'Athena' '$DDL'"

# --- no §1 banned tokens -----------------------------------------------------
# Regex tokens use [x] class breaks so THIS script never embeds a contiguous
# banned literal (verify:no-legacy-prod-refs scans .sh too); they still match
# the full identifier at runtime.
check "no banned §1 tokens in the DDL" \
  bash -c "! grep -Eq 'insure[p]rimo|psychic[-]quiz|rental[-]booking|quotes[R]outes|theiwise[.]com|a2z-cf-cms-[v]1' '$DDL'"

exit $FAIL
