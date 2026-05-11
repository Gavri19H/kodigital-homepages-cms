# Local `.dev.vars` setup

This runbook walks a developer through wiring up the local `api/.dev.vars`
file that `wrangler dev` reads when running the Worker on their laptop.
The file is gitignored and **MUST NEVER** be committed.

`api/.dev.vars` mirrors the production Worker-secret surface, plus a
single local-only flag (`DEV_BYPASS_AUTH=true`) that lets `/admin` work
without a real Cloudflare Access JWT during local development.

## Prerequisites

- A clone of `kodigital-homepages-cms` at a recent main / mission
  branch.
- `node` and `npm` installed; run `npm install` in `api/` once before
  starting (`wrangler` is a devDependency).
- Access to the values listed in `docs/secrets-manifest.md`. If you do
  not yet have those values, set up the upstream resources first:
  - `docs/cloudflare-access-setup.md` → produces
    `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`.
  - `docs/cloudflare-worker-secrets-setup.md` → produces
    `CLOUDFLARE_PROVISIONING_API_TOKEN` and `CLOUDFLARE_CACHE_API_TOKEN`
    (use the *staging* tokens locally; never paste production tokens
    into a developer laptop).
  - `https://platform.openai.com/api-keys` → produces `OPENAI_API_KEY`.

## Step 1 — Copy the template

From the repository root:

```bash
cp .dev.vars.example api/.dev.vars
```

`api/.dev.vars` is what `wrangler dev` reads at startup. The repo-root
`.dev.vars.example` is the template; copying it to `api/.dev.vars` is
the only supported workflow.

## Step 2 — Confirm gitignore coverage

```bash
git check-ignore -v api/.dev.vars
```

Expected output: a line referencing the `.gitignore` rule that covers
`.dev.vars`. If `git check-ignore` exits 1 (file is NOT ignored), STOP
— add the file to `.gitignore` before pasting any real value.

## Step 3 — Fill in each value

Open `api/.dev.vars` in an editor and replace each placeholder with a
real value. The placeholders are intentionally shaped like real
credentials so you can't confuse "still a placeholder" with "real
value":

| Key                                  | What to paste                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------ |
| `OPENAI_API_KEY`                     | A project-scoped key from platform.openai.com (starts with `sk-`).             |
| `CF_ACCESS_TEAM_DOMAIN`              | Your team domain — for kodigital, `kodigital2.cloudflareaccess.com` (note `2`).|
| `CF_ACCESS_AUD`                      | The 64-char AUD tag from the *staging* Access application Overview tab.        |
| `CLOUDFLARE_PROVISIONING_API_TOKEN`  | The staging provisioning token from `docs/cloudflare-worker-secrets-setup.md`. |
| `CLOUDFLARE_CACHE_API_TOKEN`         | The staging cache-purge token from the same doc.                               |
| `ALLOWED_CF_SERVICE_TOKEN_IDS`       | Leave as `KODIGITAL_CMS_SMOKE_TESTS` (matches the smoke service-token name).   |
| `DEV_BYPASS_AUTH`                    | Leave at `true` for local dev — `wrangler dev` does not present a CF JWT.      |

Do NOT paste production tokens into `api/.dev.vars`. Use staging tokens
locally; a leaked laptop should not be able to mutate production zones.

## Step 4 — Run the Worker

```bash
cd api
npm run dev
```

`wrangler dev` reads `api/.dev.vars` automatically. Test the endpoints:

```bash
# /health should be 200 regardless of auth
curl -i http://localhost:8787/health

# /admin should be 200 because DEV_BYPASS_AUTH=true AND APP_ENV != production
curl -i http://localhost:8787/admin

# /api/admin/auth/status returns the dev-bypass mode marker
curl -i http://localhost:8787/api/admin/auth/status
```

Expected `auth/status` body:
`{"authenticated":true,"mode":"dev-bypass"}` (note: dev-bypass mode is
local-only; staging/production return `identity` or `service-token`).

## Step 5 — Optional: simulate a real Access JWT locally

If you need to verify the JWT validation path on your laptop (rather
than the bypass path):

1. Set `DEV_BYPASS_AUTH=false` in `api/.dev.vars`.
2. Use the staging service token from
   `docs/cloudflare-access-service-token-setup.md`:

   ```bash
   curl -i http://localhost:8787/api/admin/auth/status \
        -H "CF-Access-Client-Id: <staging client id>" \
        -H "CF-Access-Client-Secret: <staging client secret>"
   ```

3. Note: this requires the local Worker to reach the staging
   `cloudflareaccess.com` JWKS endpoint, so you need internet access
   and the staging Access application must exist.

## `.dev.vars` vs `.env`

The repo ships an `.env.example` for non-secret config; that file is
NOT what `wrangler dev` reads. The Worker runtime only reads
`api/.dev.vars`. If you find yourself adding a Worker secret to `.env`,
that's the wrong file — put it in `api/.dev.vars` instead.

## Failure modes

- **`wrangler dev` startup error: "Could not parse .dev.vars"** → the
  file has a malformed line. Each line must be `KEY=value` with no
  surrounding quotes (unless the value itself contains spaces).
- **`/admin` returns 401 locally** → `DEV_BYPASS_AUTH` is not `true`,
  or `APP_ENV` is set to `production` in `wrangler.toml`'s top-level
  `[vars]` block. Confirm both.
- **Auth status returns `{"authenticated":false}` with HTTP 401** → the
  middleware is running in non-bypass mode and your local request has
  no JWT. Either set `DEV_BYPASS_AUTH=true` or pass service-token
  headers.
- **`/admin` returns 500 with "Failed to fetch JWKS"** → only happens
  in non-bypass mode; `CF_ACCESS_TEAM_DOMAIN` is unset or wrong.
  Re-check Step 3.
- **Accidentally committed `api/.dev.vars`** → STOP. Rotate every
  pasted value immediately (Cloudflare tokens, OpenAI key, Access AUD
  unchanged), then `git rm` the file and force-push the cleaned
  history if the commit has been pushed. Treat any pasted token as
  compromised.

## Never commit `.dev.vars`

The file `api/.dev.vars` is the only place real Worker-runtime
credentials touch your laptop. The repo's `.gitignore` already covers
the canonical names; verify with Step 2 every time you regenerate the
file or rename it.
