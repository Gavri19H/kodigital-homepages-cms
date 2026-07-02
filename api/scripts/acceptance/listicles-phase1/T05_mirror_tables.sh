#!/usr/bin/env bash
# Phase1.AC: five D1 analytics mirrors with version-revision PKs + rule dims
# (contract §6 "0032" + §30.7 link-instance mirror; v1.2.1 "five mirrors").
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
MIG="$REPO_ROOT/api/migrations/0033_listicles_analytics_mirror.sql"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "PASS [T05] $desc"
  else
    echo "FAIL [T05] $desc"
    FAIL=1
  fi
}

check "migration file exists" test -f "$MIG"
for t in listicle_analytics_offer listicle_analytics_section listicle_analytics_article \
         listicle_analytics_drilldown listicle_analytics_link_instance; do
  check "mirror $t declared" grep -q "CREATE TABLE IF NOT EXISTS $t\b" "$MIG"
done
COUNT=$(grep -c "^CREATE TABLE IF NOT EXISTS listicle_analytics_" "$MIG")
check "exactly 5 mirror tables (found $COUNT)" test "$COUNT" -eq 5

REV_COUNT=$(grep -c "article_version_revision" "$MIG")
check "article_version_revision appears in article+drilldown+link_instance (>=3, found $REV_COUNT)" \
  test "$REV_COUNT" -ge 3

for dim in selection_reason matched_rule_json_hash page_rule_set_id page_rule_priority; do
  check "drilldown rule dim $dim" grep -q "$dim" "$MIG"
done
check "drilldown index idx_lst_drill_article" grep -q "idx_lst_drill_article" "$MIG"

# PK shapes (revision inside the PK where v1.2.1 requires it)
check "article PK includes revision" \
  grep -q "PRIMARY KEY (article_public_id, article_version_id, article_version_revision, date)" "$MIG"
check "drilldown PK includes revision+page+candidate" \
  grep -q "PRIMARY KEY (article_public_id, article_version_id, article_version_revision, page_index, page_candidate_id, date)" "$MIG"
check "link_instance PK includes link_instance_id+revision" \
  grep -q "PRIMARY KEY (link_instance_id, article_public_id, article_version_id, article_version_revision, page_index, page_candidate_id, date)" "$MIG"

[ "$FAIL" -eq 0 ] || exit 1
exit 0
