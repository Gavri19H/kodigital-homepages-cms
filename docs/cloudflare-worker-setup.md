# Cloudflare Worker Setup — `kodigital-homepages-cms-worker`

This runbook is the click-level operator guide for creating the Cloudflare
Worker that hosts the `kodigital-homepages-cms` admin SPA + API. It is
the *first* infrastructure step in Phase 1.5 — every other resource
(D1, KV, R2, custom domain, Access application, Worker secrets) binds
to a Worker that already exists.

The Worker is created *empty* via the dashboard, then deployed-into via
`wrangler deploy`. Creating it explicitly (rather than letting `wrangler
deploy` auto-create) lets the operator confirm the name, the account,
and the absence of any sibling-project bindings BEFORE first deploy.

## Worker name contract

| Environment | Worker script name                          | Source `wrangler.toml` block      |
| ----------- | ------------------------------------------- | --------------------------------- |
| development | `kodigital-homepages-cms-worker`            | top-level (`name = …`)            |
| staging     | `kodigital-homepages-cms-worker-staging`    | `[env.staging]` (`name = …`)      |
| production  | `kodigital-homepages-cms-worker`            | `[env.production]` (`name = …`)  |

The development placeholder shares its name with production on purpose:
`wrangler dev` runs locally and never publishes; `wrangler deploy --env
production` is the only path that actually writes to that script slot.
The verifier added in T11 (`npm run verify:worker-config`) asserts the
exact strings above appear in `api/wrangler.toml`.

## Step 1 — Confirm account context

1. Log in to the Cloudflare dashboard with an account that has
   **Workers Scripts:Edit** for the target account.
2. Open **Workers & Pages** in the left nav.
3. In the top-right account picker, confirm you are in the
   `kodigital` account (account ID matches the value already pinned in
   `api/wrangler.toml` as `account_id`).
4. If you see existing Workers from a sibling project in this account,
   that is expected — the account is shared. **Do NOT click into or
   modify any sibling-project Worker.** Sibling-project bindings are
   off-limits per `docs/no-touch-red-line.md`.

## Step 2 — Create the staging Worker

1. Click **Create application** → **Create Worker**.
2. **Name**: `kodigital-homepages-cms-worker-staging`. Lowercase,
   exact, no trailing whitespace. Cloudflare normalises hyphens — but
   case matters for `wrangler.toml` matching.
3. Leave the starter template at the default; the first real deploy
   from `wrangler deploy --env staging` overwrites the bundle.
4. Click **Deploy**. The dashboard shows a default `*.workers.dev`
   subdomain — leave it enabled for now; it is useful during
   bring-up before the custom domain is wired (Step 4 of
   `docs/cms-domain-setup.md`).
5. From the Worker overview tab, confirm the **Script name** matches
   the `wrangler.toml` `[env.staging]` `name` field exactly.

## Step 3 — Create the production Worker

Repeat Step 2 with name `kodigital-homepages-cms-worker`. Production
gets the un-suffixed name; staging carries the `-staging` suffix.

After both Workers exist, run from `api/`:

```bash
npx wrangler deployments list --name kodigital-homepages-cms-worker-staging
npx wrangler deployments list --name kodigital-homepages-cms-worker
```

Each command should list at least one deployment (the dashboard
template). If `wrangler` reports `Worker not found`, the name in
`wrangler.toml` does not match the Cloudflare-side script name —
correct one or the other before continuing.

## Step 4 — Bindings

The Worker has no bindings until `api/wrangler.toml` declares them and
`wrangler deploy` is run. Bindings are NOT created via the dashboard;
they are wrangler-managed so the source of truth lives in version
control. The data-plane resources themselves (D1, KV, R2) are created
in `docs/cloudflare-resources-setup.md`.

After Step 3 of `docs/cloudflare-resources-setup.md`, the next deploy
attaches:

| Binding name | Resource type | wrangler.toml block        |
| ------------ | ------------- | -------------------------- |
| `DB`         | D1            | `[[d1_databases]]`         |
| `CACHE`      | KV            | `[[kv_namespaces]]`        |
| `MEDIA`      | R2            | `[[r2_buckets]]`           |

## Step 5 — Worker-secret surface

Worker secrets (e.g. `OPENAI_API_KEY`, `CF_ACCESS_AUD`,
`CLOUDFLARE_PROVISIONING_API_TOKEN`) are set per-environment via
`wrangler secret put <KEY> --env staging|production`. They survive
across deploys and are never echoed back. See:

- `docs/cloudflare-worker-secrets-setup.md` — click-level secret
  creation runbook.
- `docs/secrets-manifest.md` — full canonical list of Worker-runtime
  secrets the project consumes.

## Step 6 — `*.workers.dev` subdomain disable

After the custom domain is wired (`docs/cms-domain-setup.md`) AND smoke
tests pass against `https://cms.kodigital.app/admin` and
`https://staging-cms.kodigital.app/admin`, disable the
`*.workers.dev` subdomain on each Worker:

1. Worker → **Settings** → **Triggers** → **Custom Domains** confirms
   the `cms.kodigital.app` (production) and `staging-cms.kodigital.app`
   (staging) routes are **Active**.
2. Same Settings page → **`workers.dev` subdomain** → toggle **Off**.
3. Verify with curl: `curl -I https://kodigital-homepages-cms-worker.<account>.workers.dev/`
   should return 404 (or DNS NXDOMAIN). The custom-domain URL is the
   ONLY public surface.

This step is mandatory — leaving the `*.workers.dev` subdomain enabled
exposes the Worker on a host that is NOT covered by the Cloudflare
Access JWT contract (T4) and the protected-domain hostname routing (T3).

## Failure modes

| Symptom                                                          | Likely cause                                                                              | Fix                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `wrangler deploy` exits with `Worker name conflict`              | Another Worker (sibling project) already owns this name in a different account.            | Confirm you are deploying into the correct account (Step 1); never rename to dodge. |
| `wrangler deploy` succeeds but `/admin` returns 404 from `*.workers.dev` | `wrangler.toml` `name` does not match the Cloudflare-side script name.                    | Compare byte-for-byte; rename one side to match.                                 |
| Custom domain shows 522 / 1016 errors                            | Worker exists but has no route binding yet.                                               | Complete `docs/cms-domain-setup.md` Step 3 (custom domain) and re-deploy.        |
| `verify:worker-config` fails with `unexpected worker name`       | Worker name drift in `wrangler.toml`.                                                     | Rename in `wrangler.toml` to match the contract; do NOT relax the verifier.      |

## Cross-references

- `docs/cloudflare-resources-setup.md` — D1 / KV / R2 creation.
- `docs/cms-domain-setup.md` — DNS + custom-domain wiring.
- `docs/cloudflare-worker-secrets-setup.md` — Worker-runtime secrets.
- `docs/cloudflare-access-setup.md` — Cloudflare Access application
  setup that gates the admin host.
- `docs/deployment-runbook.md` — end-to-end deploy procedure.
