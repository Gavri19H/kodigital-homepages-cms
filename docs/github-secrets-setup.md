# GitHub Actions Secrets — click-level setup

This runbook explains how to wire the GitHub repository secrets that
`.github/workflows/deploy.yml` consumes. It is operator-facing — every
step is a literal click in the GitHub web UI, no scripting required.

The only secret CI needs is the **Cloudflare Workers deploy token**. CI
does NOT need OpenAI keys, Cloudflare Access secrets, or the Worker's
runtime provisioning / cache tokens — those live on the Worker side
(see `docs/cloudflare-worker-secrets-setup.md`).

## Secrets reference

| GitHub secret name        | Used for                                          | Scope                      |
| ------------------------- | ------------------------------------------------- | -------------------------- |
| `CLOUDFLARE_API_TOKEN`    | `wrangler deploy` in GitHub Actions only.         | CI deploy job              |
| `CLOUDFLARE_ACCOUNT_ID`   | Account id passed to `wrangler` when deploying.   | CI deploy job              |
| `CF_ACCESS_CLIENT_ID`     | Service-token id for end-to-end smoke tests.      | CI smoke-test job          |
| `CF_ACCESS_CLIENT_SECRET` | Service-token secret for end-to-end smoke tests.  | CI smoke-test job          |

> Note: `CLOUDFLARE_API_TOKEN` in **this table** is a **GitHub Actions**
> secret — it is the CI-only deploy token. The Worker runtime does NOT
> read this secret; the Worker reads `CLOUDFLARE_PROVISIONING_API_TOKEN`
> and `CLOUDFLARE_CACHE_API_TOKEN` instead. See
> `docs/cloudflare-worker-secrets-setup.md` for the Worker side.

## Step 1 — Create the Cloudflare deploy token

1. Open `https://dash.cloudflare.com/profile/api-tokens` in a logged-in
   browser session for the `kodigital` account.
2. Click **Create Token**.
3. Use the **Edit Cloudflare Workers** template (or create a custom
   token with exactly the permissions below — nothing more).
4. Configure permissions:
   - Account → **Workers Scripts** → **Edit**
   - User → **User Details** → **Read** (wrangler uses this to verify
     the token before deploying)
5. Configure account / zone resources:
   - Account Resources → Include → the `kodigital` account
   - Zone Resources → leave at the default (Include → All zones from
     the kodigital account) — wrangler needs this when binding the
     Worker to a custom-domain route during deploy.
6. (Optional) Add an IP-allowlist restriction if your CI runner has a
   fixed egress IP. GitHub-hosted runners do not, so skip in that case.
7. Click **Continue to summary** → **Create Token**.
8. **Copy the token immediately.** Cloudflare shows it ONCE; you cannot
   retrieve it later. If you lose it, delete the token and create a new
   one.

## Step 2 — Capture the Cloudflare account id

1. From the Cloudflare dashboard sidebar, copy the **Account ID** shown
   under the account name (32-char hex). For the `kodigital` account
   this is `a05d7505b71c6cd931e436defe670509` — confirm in the dashboard
   before pasting; do not copy from this doc.

## Step 3 — Store both values as GitHub repository secrets

1. Open `https://github.com/<org>/kodigital-homepages-cms` in a browser
   with admin or maintain access on the repository.
2. Click **Settings** (top-right of the repo) →
   **Secrets and variables** → **Actions** (in the left sidebar).
3. Click **New repository secret**.
4. Add the deploy token:
   - **Name**: `CLOUDFLARE_API_TOKEN`
   - **Value**: paste the token from Step 1.8.
   - Click **Add secret**.
5. Click **New repository secret** again.
6. Add the account id:
   - **Name**: `CLOUDFLARE_ACCOUNT_ID`
   - **Value**: paste the account id from Step 2.1.
   - Click **Add secret**.

Both names MUST match EXACTLY — they are referenced in
`.github/workflows/deploy.yml` as `${{ secrets.CLOUDFLARE_API_TOKEN }}`
and `${{ secrets.CLOUDFLARE_ACCOUNT_ID }}`.

## Step 4 — Wire the smoke-test service token

The CI smoke job hits `https://cms.kodigital.app/api/admin/auth/status`
behind Cloudflare Access using a service token created in
`docs/cloudflare-access-service-token-setup.md`. If you have not yet
done that runbook, do it first.

1. Open the GitHub Actions secrets page again
   (Settings → Secrets and variables → Actions).
2. Add `CF_ACCESS_CLIENT_ID` with the Client ID from the
   KODIGITAL_CMS_SMOKE_TESTS service token.
3. Add `CF_ACCESS_CLIENT_SECRET` with the Client Secret from the same
   token.

Both values are issued ONCE at token-creation time in the Cloudflare
Zero Trust dashboard; if you lose them, rotate via the procedure in
`docs/cloudflare-access-service-token-setup.md`.

## Step 5 — Verify the secrets

1. Open `Settings → Secrets and variables → Actions`.
2. Confirm all four names are listed exactly:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CF_ACCESS_CLIENT_ID`
   - `CF_ACCESS_CLIENT_SECRET`
3. Trigger a manual run of the deploy workflow against the staging env
   to confirm `wrangler deploy --env staging` succeeds with the new
   token. The smoke job at the end of the workflow validates Access.

## Failure modes

- **401 from wrangler during CI deploy** → the deploy token in
  `CLOUDFLARE_API_TOKEN` is wrong, expired, or scoped to the wrong
  account. Recreate the token and re-store the GitHub secret.
- **403 from wrangler during CI deploy** → the token is valid but
  missing the `Workers Scripts:Edit` permission, or the Account
  Resources scope doesn't include the kodigital account. Recreate the
  token with the correct scope.
- **CI smoke test returns 302 to *.cloudflareaccess.com** → the service
  token is not included as an `Include` rule on the Access policy
  guarding `cms.kodigital.app`. Re-check Step 2 of
  `docs/cloudflare-access-service-token-setup.md`.
- **CI smoke test returns 403** → the token name is not in
  `ALLOWED_CF_SERVICE_TOKEN_IDS` on the Worker. Update the Worker
  secret (see `docs/cloudflare-worker-secrets-setup.md`).

## Rotation

Rotate the Cloudflare deploy token quarterly or after any contractor
offboarding:

1. Cloudflare → My Profile → API Tokens → **Roll** on the existing
   token (or create a new one and delete the old one).
2. Copy the new value.
3. GitHub → Settings → Secrets and variables → Actions →
   `CLOUDFLARE_API_TOKEN` → **Update** → paste new value.
4. Trigger the deploy workflow against staging to confirm the new
   token works before relying on it for production.

Rotate the smoke service token via the procedure in
`docs/cloudflare-access-service-token-setup.md`; the Client ID and
Client Secret stored as GitHub Actions secrets must be updated in the
same window.
