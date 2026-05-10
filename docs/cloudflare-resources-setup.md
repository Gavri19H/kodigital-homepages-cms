# Cloudflare Resources Setup — D1, KV, R2

This runbook is the click-level operator guide for creating the three
Cloudflare data-plane resources the `kodigital-homepages-cms` Worker
binds to: a D1 database, a KV namespace, and an R2 bucket. It assumes
the Worker itself already exists (see `docs/cloudflare-worker-setup.md`)
and that the operator is logged in to the Cloudflare dashboard for the
correct account.

The IDs produced by this runbook end up in `api/wrangler.toml` under the
`[[d1_databases]]`, `[[kv_namespaces]]`, and `[[r2_buckets]]` blocks for
the development environment, and are referenced by name (not ID) for
staging and production.

## Account context

All resources are created under the shared Cloudflare account whose
account ID is already pinned in `api/wrangler.toml` as `account_id`.
Resources MUST be tagged with the `kodigital-homepages-cms-` prefix so
they are visually distinct from sibling-project resources in the
dashboard listing. **Never reuse a sibling-project D1 / KV / R2 ID**;
the binding contract is enforced by `verify:no-legacy-prod-refs` and by
the wrangler-config verifier introduced in T11.

## Naming contract (must match `wrangler.toml` byte-for-byte)

| Resource type | Name (development)              | Name (staging)                          | Name (production)                  |
| ------------- | ------------------------------- | --------------------------------------- | ---------------------------------- |
| D1 database   | `kodigital-homepages-cms-db`    | `kodigital-homepages-cms-db-staging`    | `kodigital-homepages-cms-db`       |
| KV namespace  | `kodigital-homepages-cms-cache` | `kodigital-homepages-cms-cache-staging` | `kodigital-homepages-cms-cache`    |
| R2 bucket     | `kodigital-homepages-cms-media` | `kodigital-homepages-cms-media-staging` | `kodigital-homepages-cms-media`    |

The development bindings are placeholders the local dev loop reads via
`wrangler dev`; staging and production are the real per-env resources
created in this doc. **Production and the placeholder development
binding share a name on purpose** — `wrangler dev` runs against a local
SQLite shim, never the live production DB.

## Step 1 — Create the D1 databases

D1 is Cloudflare's serverless SQL database. The Worker reads/writes
homepage content through the `DB` binding declared in `wrangler.toml`.

1. Open the Cloudflare dashboard → **Workers & Pages** → **D1**.
2. Click **Create database**.
3. **Name**: `kodigital-homepages-cms-db-staging` (lowercase, exact).
4. **Location**: pick the same region as the Worker (e.g. WEUR — Western
   Europe). Region is permanent — pick once.
5. Click **Create**. Copy the resulting **Database ID** (UUID).
6. Repeat the dashboard flow for the production database, name
   `kodigital-homepages-cms-db`. Use the SAME region as staging so
   read-after-write semantics behave identically across envs.
7. Paste the two UUIDs into `api/wrangler.toml`:
   - The top-level `[[d1_databases]]` block uses the **production** UUID
     (this is the `wrangler dev` placeholder; local dev does not hit it).
   - `[env.staging]` adds its own `[[d1_databases]]` block with the
     `*-staging` name and staging UUID.
   - `[env.production]` adds its own `[[d1_databases]]` block with the
     production name + UUID.
8. Run `cd api && npx wrangler d1 list` to verify both databases appear
   in the account.

## Step 2 — Create the KV namespaces

KV holds the JWKS cache (24h TTL) for Cloudflare Access verification
plus rendered-HTML cache entries gated by `HTML_CACHE_TTL_SECONDS`. The
Worker reads/writes via the `CACHE` binding.

1. Dashboard → **Workers & Pages** → **KV**.
2. Click **Create a namespace**.
3. **Namespace name**: `kodigital-homepages-cms-cache-staging`. Click
   **Add**. Copy the resulting **Namespace ID**.
4. Repeat for `kodigital-homepages-cms-cache` (production).
5. Update `api/wrangler.toml`:
   - Top-level `[[kv_namespaces]]` uses the production ID (development
     placeholder).
   - `[env.staging]` adds a `[[kv_namespaces]]` block with the staging
     ID.
   - `[env.production]` adds a `[[kv_namespaces]]` block with the
     production ID.
6. Run `cd api && npx wrangler kv namespace list` to verify.

## Step 3 — Create the R2 buckets

R2 holds uploaded media (images, PDFs) referenced from a homepage. The
Worker reads/writes via the `MEDIA` binding.

1. Dashboard → **R2** (left nav).
2. Click **Create bucket**.
3. **Bucket name**: `kodigital-homepages-cms-media-staging`. Region:
   match D1 / Worker. Click **Create bucket**.
4. Repeat for `kodigital-homepages-cms-media` (production).
5. In `api/wrangler.toml`, add `[[r2_buckets]]` blocks under
   `[env.staging]` and `[env.production]` referencing the matching
   bucket names. R2 binds by **bucket name**, not by ID — there is no
   UUID to capture.
6. Run `cd api && npx wrangler r2 bucket list` to verify both buckets
   appear.

## Step 4 — Apply migrations

After the staging and production D1 databases exist, apply the
schema migrations from `api/migrations/` (created in a later phase):

```bash
cd api
npx wrangler d1 migrations apply kodigital-homepages-cms-db-staging --remote
npx wrangler d1 migrations apply kodigital-homepages-cms-db        --remote
```

The `--remote` flag targets the live D1; `--local` targets the
in-memory dev shim. Production migrations always run before deploy
(see `docs/deployment-runbook.md`).

## Step 5 — Verification

From `api/`:

```bash
npm run verify:infra
```

This script (added in T11) reads `wrangler.toml` and asserts:

- `[[d1_databases]]` `database_name = "kodigital-homepages-cms-db"`
  for the dev/prod blocks and `kodigital-homepages-cms-db-staging`
  for staging.
- `[[kv_namespaces]]` and `[[r2_buckets]]` follow the same naming
  contract.
- No banned legacy resource name appears anywhere in `wrangler.toml`.

If `verify:infra` fails, the names in `wrangler.toml` drift from this
runbook — do NOT relax the verifier; rename the resource.

## Failure modes

| Symptom                                                    | Likely cause                                                      | Fix                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `wrangler dev` exits with `Couldn't find a database with ID …` | Top-level `[[d1_databases]]` UUID was not updated after dashboard create. | Paste the production UUID into the top-level block (used as the dev placeholder). |
| Worker boots but `DB.prepare(...)` returns `Error: no such table` | Migrations not applied to that env's D1.                          | Run `wrangler d1 migrations apply <db-name> --remote` for the offending env.              |
| `verify:infra` fails with `unexpected db name`             | DB created with sibling-project naming or with a typo.            | Rename the D1 in the dashboard (or recreate; D1 names are immutable on some plans).        |
| `R2 binding MEDIA is not authorized`                       | Bucket name in `wrangler.toml` does not match the dashboard.      | Compare the bucket name byte-for-byte; R2 is case-sensitive.                              |

## Rotation / decommission

D1 / KV / R2 resources are not credentials and do not rotate on a
schedule. They are decommissioned only when the project itself is
deleted. **Do NOT delete a resource to "reset" — drop tables / purge
keys / delete objects instead** to preserve the account-level binding.

## Cross-references

- `docs/cloudflare-worker-setup.md` — Worker creation (must exist before
  bindings resolve at deploy time).
- `docs/cms-domain-setup.md` — DNS + custom-domain wiring for the admin
  hostname.
- `docs/deployment-runbook.md` — full deploy procedure that consumes
  these resources.
- `docs/secrets-manifest.md` — Worker-runtime secrets (separate concern
  from data-plane resources).
