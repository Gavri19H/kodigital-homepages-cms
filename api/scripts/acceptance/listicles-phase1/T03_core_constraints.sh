#!/usr/bin/env bash
# Phase1.AC: structural invariants of the core schema (contract §6, §15.8, v1.1.1 #12/#13).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
MIG="$REPO_ROOT/api/migrations/0032_listicles_core.sql"

FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "PASS [T03] $desc"
  else
    echo "FAIL [T03] $desc"
    FAIL=1
  fi
}

check "partial unique: one running experiment per article" \
  grep -q "uq_listicle_experiment_running" "$MIG"
check "partial unique WHERE clause" \
  grep -q "WHERE status = 'running'" "$MIG"
check "articles UNIQUE (site_id, slug)" \
  grep -q "UNIQUE (site_id, slug)" "$MIG"
check "articles site_id is TEXT (sites.id type, §28 Q2)" \
  grep -q "site_id TEXT NOT NULL" "$MIG"
check "pages UNIQUE (article_version_id, page_index)" \
  grep -q "UNIQUE (article_version_id, page_index)" "$MIG"
check "candidates UNIQUE (page_id, section_id)" \
  grep -q "UNIQUE (page_id, section_id)" "$MIG"
check "rules: candidate_id UNIQUE (1 rule per candidate, one direction)" \
  grep -q "candidate_id INTEGER NOT NULL UNIQUE REFERENCES listicle_page_section_candidates(id)" "$MIG"
check "cap counters PK (offer_id, cap_date)" \
  grep -q "PRIMARY KEY (offer_id, cap_date)" "$MIG"

# NEGATIVE: the candidates CREATE block must not contain a rule_id column
CAND_BLOCK=$(awk '/CREATE TABLE IF NOT EXISTS listicle_page_section_candidates/,/^\);/' "$MIG")
if printf '%s' "$CAND_BLOCK" | grep -q "rule_id"; then
  echo "FAIL [T03] candidates block contains rule_id (rules must FK to candidates, not vice versa)"
  FAIL=1
else
  echo "PASS [T03] candidates block contains no rule_id"
fi

[ "$FAIL" -eq 0 ] || exit 1
exit 0
