# Cloudflare Access — Service Token Setup (`KODIGITAL_CMS_SMOKE_TESTS`)

This document gives **click-level** Zero Trust dashboard instructions for
creating the `KODIGITAL_CMS_SMOKE_TESTS` service token, attaching it to
the Access application that protects `cms.kodigital.app`, and wiring the
resulting credentials into GitHub Actions and a local `.dev.vars` file so
that smoke tests can authenticate non-interactively.

Service tokens are the **non-human** equivalent of identity-based login.
A request that presents a valid `CF-Access-Client-Id` /
`CF-Access-Client-Secret` header pair satisfies the Access policy
attached to the application and reaches the Worker without an SSO
redirect. The Worker then sees the JWT in `cf-access-jwt-assertion` with
a `common_name` claim (no `email`), which the auth middleware treats as
service-token mode and gates against `ALLOWED_CF_SERVICE_TOKEN_IDS`.

## Prerequisites

- The Cloudflare Access **application** for `cms.kodigital.app` already
  exists. If it does not, follow `docs/cloudflare-access-setup.md`
  first — that doc creates the application, captures the AUD tag, and
  sets `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`.
- You are signed into the Cloudflare dashboard with permission to manage
  the Zero Trust organization (`Admin` or `Cloudflare Zero Trust:Edit`).
- The Worker is deployed (staging or production) so the application URL
  responds. Phase 1.5 does NOT require this — the setup steps below can
  be completed before first deploy.

## Step 1 — Create the service token

1. Open the Cloudflare dashboard → **Zero Trust** → **Access** →
   **Service Auth** → **Service Tokens**.
2. Click **Create Service Token** (top right).
3. **Service Token name**: type `KODIGITAL_CMS_SMOKE_TESTS` exactly.
   The token name is the value the Worker matches against
   `ALLOWED_CF_SERVICE_TOKEN_IDS`, so the spelling must match
   character-for-character. Do not add a suffix or environment marker.
4. **Duration**: select `Non-expiring`. Smoke tests run from CI and
   refresh would require a coordinated secret rotation; non-expiring
   tokens are rotated on demand instead. (If your organization policy
   forbids non-expiring tokens, choose `1 year` and add a calendar
   reminder for rotation.)
5. Click **Generate token**.
6. The dashboard now displays the **only** time you will see the secret:
   - `Client ID` — looks like `<uuid>.access`
   - `Client Secret` — long opaque string
   Copy **both** values into a password manager **immediately**. Closing
   this dialog discards the secret permanently.
7. Click **Save** to close the dialog.

The credentials are referenced throughout this repo as:

- `CF_ACCESS_CLIENT_ID` — the Client ID from step 6.
- `CF_ACCESS_CLIENT_SECRET` — the Client Secret from step 6.

These names match the headers Cloudflare expects (`CF-Access-Client-Id`,
`CF-Access-Client-Secret`); the env-var spelling uses underscores so it
is shell-safe.

## Step 2 — Attach the service token to the Access policy

A service token is **inert** until it is added as an `Include` rule on
the Access policy that guards the application. Without this step, a
request bearing the headers still receives a 302 redirect to the SSO
login.

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications**.
2. Click the application that protects `cms.kodigital.app`. (Created
   per `docs/cloudflare-access-setup.md`. If you also have a staging
   application protecting `staging-cms.kodigital.app`, repeat these
   steps there too with the same `KODIGITAL_CMS_SMOKE_TESTS` token.)
3. Open the **Policies** tab.
4. Either edit the existing primary policy or click **Add a policy**:
   - **Policy name**: `Allow smoke tests` (or append to the existing
     `Allow team` policy as a second `Include` rule).
   - **Action**: `Allow`.
   - Under **Configure rules** → **Include**, click **Add include**.
     - Selector: **Service Token**.
     - Value: select `KODIGITAL_CMS_SMOKE_TESTS` from the dropdown.
5. Click **Save**.
6. Within ~60 seconds the policy is live globally. The application now
   accepts both identity-based logins (existing rule) **and** the
   service token (new rule).

## Step 3 — Store the secrets

The credentials are needed in two places:

### GitHub Actions (CI smoke tests)

1. Repository → **Settings** → **Secrets and variables** → **Actions**.
2. Click **New repository secret** twice and create:
   - Name: `CF_ACCESS_CLIENT_ID` — value: the Client ID from Step 1.
   - Name: `CF_ACCESS_CLIENT_SECRET` — value: the Client Secret.
3. The CI workflow (`.github/workflows/deploy.yml`) references these as
   `${{ secrets.CF_ACCESS_CLIENT_ID }}` and
   `${{ secrets.CF_ACCESS_CLIENT_SECRET }}` and passes them to the
   `smoke:cms-domain` script via env. See
   `docs/github-secrets-setup.md` for the complete list of GitHub
   secrets this repo expects.

### Local development (`api/.dev.vars`)

If you want to run `npm run smoke:cms-domain` from a workstation against
the staging or production Worker, add the following two lines to
`api/.dev.vars` (gitignored — never committed):

```
CF_ACCESS_CLIENT_ID="<paste Client ID from Step 1>"
CF_ACCESS_CLIENT_SECRET="<paste Client Secret from Step 1>"
```

The Worker itself does **not** read these values — they are presented
by the smoke-test client. `.dev.vars.example` carries the same key
names as placeholders so a fresh checkout shows what is required
without exposing a real secret.

## Step 4 — Verify with `curl`

After the policy save in Step 2 has propagated (~60 seconds), confirm
the service token works end-to-end. Replace the bracketed values with
the credentials from Step 1:

```bash
# Replace these with the values from your password manager.
export CF_ACCESS_CLIENT_ID="<Client ID from Step 1>"
export CF_ACCESS_CLIENT_SECRET="<Client Secret from Step 1>"

curl --silent --show-error --include \
  --header "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" \
  --header "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}" \
  "https://cms.kodigital.app/api/admin/auth/status"
```

Expected response: HTTP `200` with body
`{"authenticated":true,"mode":"service-token","common_name":"KODIGITAL_CMS_SMOKE_TESTS"}`.

Failure modes:

- HTTP `302` to `*.cloudflareaccess.com` — the service token is not on
  the policy. Redo Step 2.
- HTTP `401` with `invalid claims` — the service token reached the
  Worker but the `CF_ACCESS_AUD` / `CF_ACCESS_TEAM_DOMAIN` Worker
  secrets do not match the Access application. Confirm those values
  per `docs/cloudflare-access-setup.md`.
- HTTP `403` with `service token not allowed` — the token reached the
  Worker but `ALLOWED_CF_SERVICE_TOKEN_IDS` does not include
  `KODIGITAL_CMS_SMOKE_TESTS`. Set or update the Worker secret:
  `wrangler secret put ALLOWED_CF_SERVICE_TOKEN_IDS --env <staging|production>`.

## Rotation

When the service token must be rotated (compromise, scheduled rotation,
or personnel change):

1. Repeat Step 1 with the **same** name (`KODIGITAL_CMS_SMOKE_TESTS`).
   The dashboard issues a fresh Client ID and Client Secret.
2. Update the GitHub repository secrets (Step 3).
3. The new Client ID is automatically eligible under the existing
   Access policy because the policy matches the **token name**, not
   the token ID — no policy edit needed.
4. After confirming the new token works, delete the old token from
   **Service Auth** → **Service Tokens** to invalidate it.

## Notes

- Service tokens DO NOT carry an `email` claim. The Worker's
  `access-auth.ts` detects this and routes them through the
  service-token branch (`mode: "service-token"`). Identity-based logins
  carry `email` and are routed through the identity branch.
- The Worker's `/api/admin/auth/status` endpoint is the canonical health
  check for both branches: it returns the resolved `mode` so CI can
  assert that smoke traffic actually authenticated as a service token
  and not as a cached browser session.
- Never paste the Client Secret into a public PR description, issue, or
  Slack message. If it leaks, rotate immediately (steps above).
