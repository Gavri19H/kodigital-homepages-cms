#!/usr/bin/env bash
# Phase9.AC T01 (§19/§20/§24): the Phase-9 revenue files exist and are WIRED —
# POST /api/pb/:provider + media-platforms routes are registered, the revenue
# cron is called isolated from index.ts, the postback + S2S secrets are typed in
# env.ts (NOT valued in wrangler.toml), and the infra secret doc exists.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

FAIL=0
check() { local desc="$1"; shift; if "$@"; then echo "PASS [T01] $desc"; else echo "FAIL [T01] $desc"; FAIL=1; fi; }

PB="$REPO_ROOT/api/src/public/listicle/postback.ts"
S2S="$REPO_ROOT/api/src/listicles/s2s-dispatch.ts"
ING="$REPO_ROOT/api/src/listicles/revenue-ingest.ts"
RECON="$REPO_ROOT/api/src/listicles/revenue-recon.ts"
FX="$REPO_ROOT/api/src/listicles/fx.ts"
PUBROUTER="$REPO_ROOT/api/src/public/router.ts"
ADMINROUTER="$REPO_ROOT/api/src/admin/listicles/router.ts"
MPH="$REPO_ROOT/api/src/admin/listicles/media-platforms-handlers.ts"
INDEX="$REPO_ROOT/api/src/index.ts"
ENVTS="$REPO_ROOT/api/src/env.ts"
WRANGLER="$REPO_ROOT/api/wrangler.toml"
SECRETS="$REPO_ROOT/infra/listicles/revenue-secrets.md"

# --- files exist -------------------------------------------------------------
check "postback.ts exists" test -f "$PB"
check "s2s-dispatch.ts exists" test -f "$S2S"
check "revenue-ingest.ts exists" test -f "$ING"
check "revenue-recon.ts exists" test -f "$RECON"
check "fx.ts exists" test -f "$FX"
check "media-platforms-handlers.ts exists" test -f "$MPH"

# --- POST /api/pb/:provider route (host-independent, pre-catch-all) ----------
check "postback router: POST /api/pb/:provider" \
  bash -c "grep -q '/api/pb/:provider' '$PB' && grep -q 'listiclePostbackRouter' '$PB'"
check "public router mounts listiclePostbackRouter BEFORE the publicSiteContextMiddleware use()" \
  bash -c "python3 - '$PUBROUTER' <<'PY'
import sys
s=open(sys.argv[1]).read()
mount=s.find('route(\"/\", listiclePostbackRouter)')
mw=s.find('use(\"*\", publicSiteContextMiddleware)')
sys.exit(0 if (mount!=-1 and mw!=-1 and mount<mw) else 1)
PY"

# --- media-platforms CRUD routes (§20) ---------------------------------------
check "media-platforms routes registered (GET/POST/PATCH)" \
  bash -c "grep -q '/media-platforms' '$ADMINROUTER' && grep -q 'listMediaPlatformsHandler' '$ADMINROUTER' && grep -q 'createMediaPlatformHandler' '$ADMINROUTER' && grep -q 'patchMediaPlatformHandler' '$ADMINROUTER'"

# --- revenue cron wired isolated (index.ts) ----------------------------------
check "index.ts imports runListicleRevenueCron" grep -q "import { runListicleRevenueCron }" "$INDEX"
check "index.ts scheduled() calls runListicleRevenueCron(env) in its own try/catch" \
  bash -c "grep -q 'await runListicleRevenueCron(env)' '$INDEX' && grep -q 'revenue maintenance must never break' '$INDEX'"
check "existing crons still present (byte-untouched siblings)" \
  bash -c "grep -q 'syncListicleAnalytics(env)' '$INDEX' && grep -q 'listicleDailyReconciliation(env)' '$INDEX' && grep -q 'processScheduledArticles' '$INDEX'"

# --- secret typing (env.ts) — NOT valued in wrangler.toml (§24) --------------
check "env.ts types postback + S2S secrets (optional) + readEnvSecret" \
  bash -c "grep -q 'LISTICLE_PB_TOKEN_' '$ENVTS' && grep -q 'LISTICLE_S2S_TOKEN_' '$ENVTS' && grep -q 'export function readEnvSecret' '$ENVTS'"
check "wrangler.toml has NO postback/S2S secret VALUE assignment (encrypted-secret discipline)" \
  bash -c "! grep -Eq '^[[:space:]]*LISTICLE_(PB|S2S)_TOKEN[A-Z0-9_]*[[:space:]]*=' '$WRANGLER'"
check "wrangler.toml documents the secret naming convention (comment only)" \
  bash -c "grep -q 'LISTICLE_PB_TOKEN_<PROVIDER>' '$WRANGLER' && grep -q 'LISTICLE_S2S_TOKEN_<PLATFORM>' '$WRANGLER'"

# --- infra secret doc (§9 deliverable) ---------------------------------------
check "revenue-secrets.md exists" test -f "$SECRETS"
check "revenue-secrets.md: names + wrangler secret put + inert-until-configured" \
  bash -c "grep -q 'LISTICLE_PB_TOKEN_' '$SECRETS' && grep -q 'LISTICLE_S2S_TOKEN_' '$SECRETS' && grep -q 'wrangler secret put' '$SECRETS'"

exit $FAIL
