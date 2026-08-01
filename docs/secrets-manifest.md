# Secrets Manifest

This document lists every secret the `kodigital-homepages-cms` Worker
needs, where the value lives, and how it is delivered to each
environment. **No secret value appears in this repository.** The
manifest names the keys only.

## Secrets used by the Worker (runtime)

These secrets are consumed by `api/src/**` at request time and MUST be
set as Cloudflare Worker secrets in staging and production via
`wrangler secret put <KEY> --env staging|production`. For local
`wrangler dev` they live in `api/.dev.vars` (gitignored). See
`docs/cloudflare-worker-secrets-setup.md` for the click-level setup
runbook and `docs/local-dev-vars.md` for the local-setup runbook.

| Key                                  | Purpose                                                                        | Required in       |
| ------------------------------------ | ------------------------------------------------------------------------------ | ----------------- |
| `OPENAI_API_KEY`                     | Calls to OpenAI text/image models from `/admin`.                               | staging, prod     |
| `CF_ACCESS_TEAM_DOMAIN`              | Cloudflare Access team domain for JWT issuer + JWKS fetch.                     | staging, prod     |
| `CF_ACCESS_AUD`                      | Cloudflare Access application AUD claim (per-application, 64-char hex).        | staging, prod     |
| `CLOUDFLARE_PROVISIONING_API_TOKEN`  | Worker-runtime token used to create / update zones + routes during provisioning. | staging, prod   |
| `CLOUDFLARE_CACHE_API_TOKEN`         | Worker-runtime token scoped to Cache Purge only — used after a publish.        | staging, prod     |
| `CONVERSIONS_ACTOR_SIGNING_KEY_B64URL` | Signs permanent Conversions actor and operation-scope envelopes; identical raw key is bound to Core as `ACTOR_CONTEXT_HMAC_KEY_B64URL`. | staging, prod |
| `ALLOWED_CF_SERVICE_TOKEN_IDS`       | Optional CSV allowlist of Access service-token names (matched on `common_name`). | optional        |
| `DEV_BYPASS_AUTH`                    | Local dev escape hatch. Set `true` in `.dev.vars`. Double-gated on `APP_ENV != "production"`. | local only |
| `LEADGEN_S2S_TOKEN_FACEBOOK`         | Legacy outbound LeadGen media-platform token; usable only when explicitly allowlisted and bound. | optional; required before enabling its row |
| `LISTICLE_S2S_TOKEN_FACEBOOK`        | Legacy outbound Listicles media-platform token; usable only when explicitly allowlisted and bound. | optional; required before enabling its row |

`LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS` is a non-secret, comma-separated exact
allowlist in `api/wrangler.toml`, not a Worker secret. Database-selected
outbound references are resolved only when the name is safe, appears exactly in
that allowlist, and has a non-empty secret binding. Newly introduced names use
`OFFER_TOKEN_`; the two non-prefixed Facebook names above are legacy entries
that require planned renames. See the section 18.7 gate in
`docs/deployment-runbook.md`.

### Phase 1.5 token-split rationale

Phase 1.5 deliberately splits what used to be a single
`CLOUDFLARE_API_TOKEN` into three distinct credentials, each scoped to
the minimum permissions needed:

1. **`CLOUDFLARE_PROVISIONING_API_TOKEN`** (Worker runtime) — scoped to
   `Zone:Edit` + `Worker Routes:Edit` + `Account:Read`. Used by the
   site-provisioning code path that creates a custom-domain route for a
   newly published homepage. When `SITE_PROVISIONING_DRY_RUN=true` or
   `SITE_PROVISIONING_ALLOW_ROUTE_MUTATION=false`, this token is held
   but no mutation API calls are made.
2. **`CLOUDFLARE_CACHE_API_TOKEN`** (Worker runtime) — scoped to
   `Cache Purge` only. Used after a publish to purge rendered HTML and
   asset URLs. Separating it from the provisioning token means a bug or
   compromise in the cache-purge code path cannot escalate to zone or
   route mutation.
3. **GitHub Actions deploy token** (CI only) — scoped to
   `Worker Scripts:Edit` on the CMS Worker. Lives as a GitHub repository
   secret. See `docs/github-secrets-setup.md`. This token is intentionally
   absent from `.dev.vars.example` and from the Worker `Env` type because
   the Worker runtime does not consume it.

## Where each value lives

- **Local development**: values are read from `api/.dev.vars`. This file
  is gitignored and is **never committed**. A scrubbed companion file
  `.dev.vars.example` ships in the repo with placeholder values only.
  See `docs/local-dev-vars.md` for the step-by-step copy/paste runbook.
- **Cloudflare staging / production**: values are stored as Worker
  Secrets in the Cloudflare Dashboard under the
  `kodigital-homepages-cms-worker` (production) /
  `kodigital-homepages-cms-worker-staging` (staging) Workers, set via
  `wrangler secret put <KEY> --env staging|production`. They are NOT
  declared in `wrangler.toml` (only non-secret vars belong there).
- **GitHub Actions (CI)**: the deploy token is stored as a repository
  secret. `OPENAI_API_KEY`, the Access secrets, and the runtime
  provisioning / cache tokens are NOT exposed to CI — CI only deploys
  the Worker; it does not exercise OpenAI, Access, or runtime
  provisioning paths. See `docs/github-secrets-setup.md`.

## Delivery rules

1. Secret values are **never committed** to git, in any form.
2. `.dev.vars` is in `.gitignore`. Verify with `git check-ignore`.
3. `.dev.vars.example` contains placeholder strings only (no real keys,
   no high-entropy tokens) and is the source of truth for which keys a
   developer needs locally.
4. Production secrets are rotated through the Cloudflare Dashboard;
   staging secrets are rotated via `wrangler secret put` from a trusted
   workstation. After rotation, redeploy the Worker so the new secret
   version takes effect (`wrangler deploy --env <staging|production>`).
5. CI workflows reference the deploy token via the GitHub Actions
   Dashboard; the token is scoped to the `kodigital` account and to
   Worker-script edit permissions only — it cannot mutate zones,
   routes, or DNS.
6. Runtime tokens (`CLOUDFLARE_PROVISIONING_API_TOKEN`,
   `CLOUDFLARE_CACHE_API_TOKEN`) MUST be created per-environment.
   Re-using a production token in staging makes a staging bug capable
   of mutating production zones — treat tokens like passwords, not like
   shared library functions.
7. `CONVERSIONS_ACTOR_SIGNING_KEY_B64URL` and Core
   `ACTOR_CONTEXT_HMAC_KEY_B64URL` are two bindings of one environment-specific
   32-byte HMAC key. Provision Core first and CMS second so CMS cannot issue
   envelopes before Core can verify them. Confirm names only; never record the
   value in source, logs, evidence, tickets, or shell history.

## Adding a new secret

1. Add the key to the table above with its purpose and which envs need it.
2. Add a placeholder line to `.dev.vars.example`.
3. Add the field to the `Env` interface in `api/src/env.ts` (typed as
   `string` if always required, `string | undefined` if optional or
   environment-specific).
4. Set the value in each target environment via `wrangler secret put` or
   the Cloudflare Dashboard. Never commit the value.
5. If the secret is consumed by CI, add it as a GitHub repository secret
   and reference it in the workflow file. Document the click flow in
   `docs/github-secrets-setup.md`.

For a database-selected outbound partner token, also add the exact name to
`LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS`, use the `OFFER_TOKEN_` prefix, and
complete the value-free inventory plus staging checks in the deployment
runbook. Never add infrastructure, signing, storage, database, or inbound
authentication credentials to the outbound allowlist.
