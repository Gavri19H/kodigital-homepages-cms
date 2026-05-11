# Deployment Runbook — `kodigital-homepages-cms`

This runbook is the end-to-end procedure for taking a green main-branch
build to staging and then to production. It is the canonical pre-flight
+ flight checklist; every other phase 1.5 doc is referenced from here.

The runbook assumes the operator has already completed the one-time
setup runbooks listed under "Prerequisites" below. After Phase 1.5 is
verified, only the **Pre-flight**, **Flight**, and **Post-flight**
sections need to be re-read for each subsequent deploy.

## Phase 1.5 acceptance gate

Phase 1.5 is complete when the following five commands ALL exit 0
on a clean checkout of `main`:

```bash
cd api
npm run typecheck
npm test
npm run verify:no-legacy-prod-refs
npm run verify:infra
npm run verify:worker-config
```

`verify:infra` and `verify:worker-config` are introduced in T11 and
assert that `wrangler.toml` declares the contract names from
`docs/cloudflare-resources-setup.md` and `docs/cloudflare-worker-setup.md`
(D1 `kodigital-homepages-cms-db`, Worker `kodigital-homepages-cms-worker`,
hostname `cms.kodigital.app`, etc.). A failure in `verify:infra` or
`verify:worker-config` is ALWAYS a config drift — fix the config, never
relax the verifier.

## Prerequisites (one-time setup)

Complete these *before* attempting your first deploy:

1. `docs/cloudflare-worker-setup.md` — create both Worker scripts
   (staging + production) in the dashboard.
2. `docs/cloudflare-resources-setup.md` — create both D1 databases,
   KV namespaces, and R2 buckets; paste IDs into `api/wrangler.toml`.
3. `docs/cms-domain-setup.md` — wire `cms.kodigital.app` and
   `staging-cms.kodigital.app` as Worker custom domains.
4. `docs/cloudflare-access-setup.md` — create the Access applications
   and capture `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`.
5. `docs/cloudflare-access-service-token-setup.md` — create
   `KODIGITAL_CMS_SMOKE_TESTS` and store its credentials in GitHub
   Actions and `api/.dev.vars`.
6. `docs/cloudflare-worker-secrets-setup.md` — set every Worker secret
   per env via `wrangler secret put`.
7. `docs/github-secrets-setup.md` — set repository secrets for CI.

The first six produce values that the Worker / smoke tests consume at
request time; the seventh produces values that GitHub Actions consumes
at deploy time.

## Pre-flight (every deploy)

Run from a clean main checkout:

```bash
git switch main
git pull --ff-only

cd api
npm install
npm run typecheck
npm test
npm run verify:no-legacy-prod-refs
npm run verify:infra
npm run verify:worker-config
```

If any of the above exits non-zero, **STOP**. Diagnose locally; do not
deploy. The verifier output names the offending file/line — fix the
source, re-run, then continue.

Confirm the working tree is clean:

```bash
git status --porcelain
```

Expected: empty output. A non-empty working tree means uncommitted
config changes that would NOT be deployed; commit and re-push first.

## Flight — Staging

Staging is the rehearsal env. Always deploy staging first; never
production-first.

1. Apply outstanding D1 migrations (no-op when none pending):
   ```bash
   cd api
   npx wrangler d1 migrations apply kodigital-homepages-cms-db-staging --remote
   ```
2. Deploy the Worker:
   ```bash
   cd api
   npx wrangler deploy --env staging
   ```
   This is the canonical `wrangler deploy` invocation: `--env staging`
   resolves the staging block in `wrangler.toml` (Worker name,
   bindings, vars) and pushes the bundled build to Cloudflare's edge.
3. Smoke-test:
   ```bash
   cd api
   npm run smoke:cms-domain
   # or directly:
   curl -I https://staging-cms.kodigital.app/health
   curl -fsS \
       -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
       -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
       https://staging-cms.kodigital.app/api/admin/auth/status
   ```
   Expected: `/health` → 200, `/api/admin/auth/status` →
   `{authenticated:true, mode:"service-token", common_name:"KODIGITAL_CMS_SMOKE_TESTS"}`.
4. Browser smoke (incognito):
   - GET `https://staging-cms.kodigital.app/admin` → 302 to
     `kodigital2.cloudflareaccess.com` → SSO → 200 admin SPA.
   - GET `https://staging-cms.kodigital.app/unknown-path` → 404.
   - GET `https://staging-cms.kodigital.app/` → 302 to `/admin`.

If staging smoke fails, **STOP**. Do NOT proceed to production. Roll
back staging via `npx wrangler rollback --env staging` (Cloudflare
deployments list shows previous IDs) or fix-forward with another deploy.

## Flight — Production

Only after staging smoke passes:

1. Apply outstanding D1 migrations:
   ```bash
   cd api
   npx wrangler d1 migrations apply kodigital-homepages-cms-db --remote
   ```
2. Deploy the Worker:
   ```bash
   cd api
   npx wrangler deploy --env production
   ```
3. Smoke-test the live production hostname (same shape as staging):
   ```bash
   cd api
   curl -I https://cms.kodigital.app/health
   curl -fsS \
       -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
       -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
       https://cms.kodigital.app/api/admin/auth/status
   ```
4. Browser smoke (incognito), as for staging.

The CI workflow (`.github/workflows/deploy.yml`) deploys staging
automatically on push to `main`; production deploy is gated on
`workflow_dispatch` so that the operator must explicitly trigger it
after manual smoke.

## Post-flight

1. Tail logs for 5 minutes after each prod deploy:
   ```bash
   cd api
   npx wrangler tail --env production
   ```
2. Watch for non-200 spikes other than the expected 302→SSO flow.
3. If a regression appears, roll back:
   ```bash
   cd api
   npx wrangler rollback --env production
   ```
4. File a follow-up issue capturing the symptom, the offending
   deployment ID, and the rollback target.

## Rollback

`wrangler rollback` swaps the live Worker bundle to a previous
deployment without re-running CI. It does NOT roll back D1 migrations
— D1 migrations are forward-only, so any new migration shipped in the
faulty deploy must be reverted by writing a new migration that undoes
it. Always pair a `wrangler rollback` with a manual D1 inspection.

## Failure-mode triage

| Symptom (post-deploy)                                   | Likely cause                                            | Fix                                                          |
| ------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| `/health` returns 200 but `/admin` returns 401          | Worker secret `CF_ACCESS_AUD` mismatch on this env.     | Re-run `wrangler secret put CF_ACCESS_AUD --env <env>`.      |
| `/admin` returns 302 to `kodigital.cloudflareaccess.com` (no `2`) | `CF_ACCESS_TEAM_DOMAIN` set to wrong tenant.            | Re-run `wrangler secret put CF_ACCESS_TEAM_DOMAIN --env <env>` with `kodigital2.cloudflareaccess.com`. |
| `wrangler deploy` fails with `account_id mismatch`      | Local `wrangler.toml` `account_id` differs from CI key. | Confirm `account_id` in `wrangler.toml` matches the account the deploy token belongs to. |
| Smoke test 403 with `service token not allowed`         | `ALLOWED_CF_SERVICE_TOKEN_IDS` Worker secret not set.   | `wrangler secret put ALLOWED_CF_SERVICE_TOKEN_IDS --env <env>` with `KODIGITAL_CMS_SMOKE_TESTS`. |

## Cross-references

- `docs/cloudflare-worker-setup.md` — Worker creation.
- `docs/cloudflare-resources-setup.md` — D1 / KV / R2.
- `docs/cms-domain-setup.md` — DNS + custom domains.
- `docs/cloudflare-access-setup.md` — Access application setup.
- `docs/cloudflare-access-service-token-setup.md` — service-token
  smoke credentials.
- `docs/cloudflare-worker-secrets-setup.md` — Worker-runtime secrets.
- `docs/github-secrets-setup.md` — GitHub Actions secrets for CI.
- `docs/secrets-manifest.md` — canonical secret index.
- `docs/local-dev-vars.md` — local `.dev.vars` setup (not a deploy
  surface, but useful for diagnosing).
