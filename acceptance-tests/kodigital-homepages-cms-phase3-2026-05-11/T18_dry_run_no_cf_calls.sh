#!/usr/bin/env bash
# T18.AC: dry-run safety + CLOUDFLARE_PROVISIONING_API_TOKEN exclusively (no CLOUDFLARE_API_TOKEN ref).
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAIL=0
check() {
  local desc="$1"; shift
  if "$@"; then echo "PASS [T18] $desc"; else echo "FAIL [T18] $desc"; FAIL=1; fi
}
DIR="$REPO_ROOT/api/src/site-provisioning"
RUNNER="$DIR/runner.ts"
CFI="$DIR/cloudflare-interfaces.ts"
check "runner.ts exists" test -f "$RUNNER"
check "cloudflare-interfaces.ts exists" test -f "$CFI"
check "CLOUDFLARE_PROVISIONING_API_TOKEN declared" grep -qE 'CLOUDFLARE_PROVISIONING_API_TOKEN' "$CFI"
check "no bare CLOUDFLARE_API_TOKEN in site-provisioning" \
  bash -c '! grep -RnE "(^|[^A-Z_])CLOUDFLARE_API_TOKEN([^A-Z_]|$)" '"$DIR"' >/dev/null'
check "SITE_PROVISIONING_DRY_RUN gate" grep -qE "SITE_PROVISIONING_DRY_RUN" "$CFI"
check "cache_purge_log audit insert" grep -qE "INSERT INTO cache_purge_log" "$CFI"
check "completed_dry_run status emitted" grep -qE "completed_dry_run" "$CFI"
[ "$FAIL" -eq 0 ] || exit 1
exit 0
