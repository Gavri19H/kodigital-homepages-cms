# Cloudflare Worker Secrets — click-level setup

This runbook explains how to set the Worker-runtime secrets that
`kodigital-homepages-cms-worker` (production) and
`kodigital-homepages-cms-worker-staging` (staging) consume at request
time. It is operator-facing — every step is either a `wrangler` command
run from a trusted workstation or a click in the Cloudflare dashboard.

Worker-runtime secrets are stored as Cloudflare **Worker Secrets**, NOT
in `wrangler.toml`. They are encrypted at rest by Cloudflare and made
available to the Worker as fields on the `Env` interface defined in
`api/src/env.ts`.

**Scope of this doc**: Worker-runtime secrets only. The CI deploy
credential is a separate concern; see `docs/github-secrets-setup.md`.

## Secrets reference

| Worker secret name                   | Source doc / value origin                                  | Required in   |
| ------------------------------------ | ---------------------------------------------------------- | ------------- |
| `OPENAI_API_KEY`                     | https://platform.openai.com/api-keys                       | staging, prod |
| `CF_ACCESS_TEAM_DOMAIN`              | `docs/cloudflare-access-setup.md` Step 1                    | staging, prod |
| `CF_ACCESS_AUD`                      | `docs/cloudflare-access-setup.md` Step 4                    | staging, prod |
| `CLOUDFLARE_PROVISIONING_API_TOKEN`  | Step 1 below — Cloudflare API Tokens dashboard             | staging, prod |
| `CLOUDFLARE_CACHE_API_TOKEN`         | Step 2 below — Cloudflare API Tokens dashboard             | staging, prod |
| `ALLOWED_CF_SERVICE_TOKEN_IDS`       | Comma-separated list of service-token names (e.g. `KODIGITAL_CMS_SMOKE_TESTS`) | optional |

## Step 1 — Create `CLOUDFLARE_PROVISIONING_API_TOKEN`

This token is used by the Worker at runtime to create or update
Cloudflare resources during site provisioning (zones, custom-domain
routes). It is gated by `SITE_PROVISIONING_DRY_RUN` and
`SITE_PROVISIONING_ALLOW_ROUTE_MUTATION` in `wrangler.toml` — even
with a valid token, mutations are blocked when those flags are off.

1. Open `https://dash.cloudflare.com/profile/api-tokens` in a logged-in
   browser session for the `kodigital` account.
2. Click **Create Token** → **Create Custom Token**.
3. **Token name**: `kodigital-homepages-cms-provisioning-staging` (or
   `-production`). Use a separate token per environment so a staging
   leak cannot mutate production zones.
4. **Permissions**:
   - Account → **Workers Routes** → **Edit**
   - Zone → **DNS** → **Edit**
   - Zone → **Zone Settings** → **Read**
   - Account → **Account Settings** → **Read**
5. **Account Resources**: Include → the `kodigital` account.
6. **Zone Resources**: Include → **Specific zone** → `kodigital.app`.
7. (Optional) **Client IP Address Filtering** — leave open; the Worker
   egress IPs are not stable, so an IP allowlist will break runtime
   calls.
8. **TTL**: set an explicit expiry 90–180 days out so rotation is
   prompted.
9. Click **Continue to summary** → **Create Token**.
10. **Copy the token value immediately.** Cloudflare shows it once.

## Step 2 — Create `CLOUDFLARE_CACHE_API_TOKEN`

This token is scoped narrowly to cache-purge operations. Keeping it
separate from the provisioning token means a bug in the cache-purge
path cannot escalate to mutating zones or routes.

1. Same dashboard as Step 1 → **Create Token** → **Create Custom Token**.
2. **Token name**: `kodigital-homepages-cms-cache-staging` (or
   `-production`).
3. **Permissions**:
   - Zone → **Cache Purge** → **Purge**
4. **Zone Resources**: Include → **Specific zone** → `kodigital.app`.
5. Click **Continue to summary** → **Create Token**.
6. **Copy the token value immediately.**

## Step 3 — Capture the OpenAI key

1. Open `https://platform.openai.com/api-keys` and create a project-
   scoped key for the kodigital CMS Worker.
2. Copy the value (starts with `sk-`). Treat as production-sensitive.

## Step 4 — Capture Access values

1. Run `docs/cloudflare-access-setup.md` if you have not already. That
   runbook produces `CF_ACCESS_TEAM_DOMAIN` (e.g.
   `kodigital2.cloudflareaccess.com`) and `CF_ACCESS_AUD` (per-app
   64-char hex tag).
2. The values are NOT the same across staging and production —
   capture each Access application's AUD separately.

## Step 5 — Set each secret via wrangler

From the repo root, with a trusted workstation logged in to wrangler
via `wrangler login`:

```bash
cd api

# Staging — repeat each line and paste the value when prompted.
wrangler secret put OPENAI_API_KEY --env staging
wrangler secret put CF_ACCESS_TEAM_DOMAIN --env staging
wrangler secret put CF_ACCESS_AUD --env staging
wrangler secret put CLOUDFLARE_PROVISIONING_API_TOKEN --env staging
wrangler secret put CLOUDFLARE_CACHE_API_TOKEN --env staging
wrangler secret put ALLOWED_CF_SERVICE_TOKEN_IDS --env staging   # optional

# Production — repeat with production tokens captured in Steps 1–4.
wrangler secret put OPENAI_API_KEY --env production
wrangler secret put CF_ACCESS_TEAM_DOMAIN --env production
wrangler secret put CF_ACCESS_AUD --env production
wrangler secret put CLOUDFLARE_PROVISIONING_API_TOKEN --env production
wrangler secret put CLOUDFLARE_CACHE_API_TOKEN --env production
wrangler secret put ALLOWED_CF_SERVICE_TOKEN_IDS --env production
```

Wrangler prompts for each value on stdin — paste, press Enter. The
value is NOT echoed and is NOT written to shell history.

## Step 6 — Verify

1. List the Worker secrets for each env to confirm names without
   exposing values:

   ```bash
   cd api
   wrangler secret list --env staging
   wrangler secret list --env production
   ```

   Each list MUST include every required key from the reference table
   above. If a key is missing, re-run `wrangler secret put` for that
   key in that env.

2. Deploy and probe:

   ```bash
   cd api
   wrangler deploy --env staging
   curl -i https://staging-cms.kodigital.app/api/admin/auth/status \
        -H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
        -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}"
   ```

   Expected: HTTP 200 with JSON
   `{"authenticated":true,"mode":"service-token","common_name":"KODIGITAL_CMS_SMOKE_TESTS"}`.
   A 401 means the Access secrets are wrong; a 500 with
   `Failed to fetch JWKS` in `wrangler tail` means
   `CF_ACCESS_TEAM_DOMAIN` is unset or wrong.

## Failure modes

- **`wrangler secret put` errors with "Authentication error"** → the
  workstation `wrangler login` session has expired. Re-run
  `wrangler login`.
- **Worker `tail` shows `Provisioning token not set`** → the secret is
  missing from THIS environment. Re-run Step 5 for the missing env.
- **Worker `tail` shows `Cache purge 403`** → the cache token is set
  but does not include the zone in its Zone Resources scope. Recreate
  the token following Step 2.
- **Provisioning succeeds even though `SITE_PROVISIONING_DRY_RUN=true`** →
  this is a Worker-code bug, not a secret-setup bug. Open an issue;
  the safety flag MUST gate the API call.

## Rotation

Rotate each token at least quarterly, or immediately after any
contractor offboarding:

1. Cloudflare dashboard → My Profile → API Tokens → **Roll** the
   existing token (or create a replacement and delete the old token).
2. `cd api && wrangler secret put <KEY> --env <staging|production>` →
   paste new value.
3. `wrangler deploy --env <staging|production>` so the Worker picks up
   the new secret version.
4. Confirm the deploy with a smoke request to
   `/api/admin/auth/status`.

The OpenAI key rotates via `platform.openai.com/api-keys` and is
re-stored via Step 5. The Access secrets rotate via the procedure in
`docs/cloudflare-access-setup.md` (recreating the Access application
produces a new AUD).
