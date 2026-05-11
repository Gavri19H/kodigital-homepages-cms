# Cloudflare Access — Application Setup for `cms.kodigital.app`

This document gives **click-level** Zero Trust dashboard instructions for
creating the Cloudflare Access application that protects
`cms.kodigital.app` (production) and `staging-cms.kodigital.app`
(staging), capturing the **AUD** tag emitted by Cloudflare, and wiring
the Worker secrets `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` so that
the auth middleware in `api/src/auth/access-auth.ts` can verify Access
JWTs.

This is the **prerequisite** for `docs/cloudflare-access-service-token-setup.md`
(which creates the `KODIGITAL_CMS_SMOKE_TESTS` service token and
attaches it to the application created here).

## What you are setting up

Cloudflare Access sits in front of the Worker. An unauthenticated
request to `https://cms.kodigital.app/admin` receives an **HTTP 302**
redirect to `https://kodigital2.cloudflareaccess.com/...` so the user
(or service token) can authenticate. After authentication, Cloudflare
forwards the original request to the Worker with a signed JWT in the
`cf-access-jwt-assertion` header. The Worker verifies the JWT against
the Access team's JWKS (cached in KV) and checks that:

- `iss` equals `https://kodigital2.cloudflareaccess.com` (built from
  `CF_ACCESS_TEAM_DOMAIN`).
- `aud` includes the application's **AUD tag** (the value stored in
  `CF_ACCESS_AUD`).

The 302 redirect is **expected** behavior. Any browser opened directly
to `https://cms.kodigital.app/admin` without an active Cloudflare Access
session will see the 302 and land on the SSO chooser. This is the
single intended unauthenticated entry path.

## Prerequisites

- You are signed into the Cloudflare dashboard with permission to manage
  the Zero Trust organization (`Admin` or `Cloudflare Zero Trust:Edit`).
- The DNS records for `cms.kodigital.app` (and, if used,
  `staging-cms.kodigital.app`) are proxied through Cloudflare (orange
  cloud). Access cannot protect a hostname whose traffic does not flow
  through Cloudflare's edge.
- The Worker route configuration documented in
  `docs/cms-domain-setup.md` is in place — the Worker must answer the
  hostname before Access has anything to protect.

## Step 1 — Confirm your team domain

1. Cloudflare dashboard → **Zero Trust** → **Settings** → **Custom
   Pages** (or **General**, depending on dashboard version).
2. The **Team domain** field shows your organization's Access subdomain.
   For this account it is `kodigital2.cloudflareaccess.com` (note the
   trailing `2` — the original `kodigital.cloudflareaccess.com` slot is
   held by a sibling tenant and is **not** the one to use).
3. Record the team domain. It is the value that becomes
   `CF_ACCESS_TEAM_DOMAIN` (Worker secret) — stored **without** scheme,
   exactly as the dashboard displays it.

If your team domain differs from `kodigital2.cloudflareaccess.com`,
stop and confirm you are signed into the correct Cloudflare account.
The Worker will reject JWTs whose `iss` does not equal
`https://${CF_ACCESS_TEAM_DOMAIN}`.

## Step 2 — Create the Access application

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications**.
2. Click **Add an application**.
3. Choose **Self-hosted**.
4. Fill in the form:
   - **Application name**: `KODigital CMS — Production` (use
     `KODigital CMS — Staging` for the staging application).
   - **Session duration**: `24 hours` (or your organization's default).
   - **Application domain**:
     - **Subdomain**: `cms` (or `staging-cms` for staging).
     - **Domain**: `kodigital.app`.
     - **Path**: leave blank — the Worker handles the path-level routing;
       Access protects the entire hostname.
5. Leave **Identity providers** at the default (`Accept all available
   identity providers`) unless your organization has a more restrictive
   default; the per-policy rules added in Step 4 are the real gate.
6. Click **Next** to continue to policy configuration.

## Step 3 — Configure the primary policy

1. **Policy name**: `Allow team`.
2. **Action**: `Allow`.
3. **Session duration**: leave at the application default (Step 2).
4. **Configure rules** → **Include**:
   - Selector: **Emails ending in**.
   - Value: `@kodigital.io` (or whatever domain your operators use).
   - Add additional `Include` rules for any explicit individual emails
     (`Selector: Emails`, `Value: alice@example.com`).
5. Leave **Require** and **Exclude** empty unless your organization
   requires MFA / country / device-posture gating.
6. Click **Next**.

The service token rule (`KODIGITAL_CMS_SMOKE_TESTS`) is added in
`docs/cloudflare-access-service-token-setup.md` — do **not** add it as
part of this step.

## Step 4 — Finalize and capture the AUD tag

1. The next screen lists Application Setup → CORS, cookie, and headers
   defaults. Leave everything at the defaults unless your team has a
   specific override.
2. Click **Add application**. The dashboard returns you to the
   Applications list and now shows the application you just created.
3. Click the application name to open its detail panel. In the
   **Overview** tab you will see the **Application Audience (AUD) Tag**
   — a 64-character hex string unique to this application.
4. Click the **Copy** icon next to the AUD tag and store the value in
   your password manager labeled
   `CF_ACCESS_AUD (cms.kodigital.app — production)` (or `staging` for
   the staging application).

The AUD tag is **not a secret** in the cryptographic sense — leaking
it does not compromise authentication — but it **must** match the
`CF_ACCESS_AUD` Worker secret exactly. A mismatch causes every
authenticated request to fail with HTTP `401 invalid claims` even
though the redirect-and-login flow looks healthy from a browser.

If your project uses **separate Access applications for staging and
production**, repeat Steps 2-4 with the `staging-cms.kodigital.app`
hostname and record the staging AUD separately. The team domain
(`CF_ACCESS_TEAM_DOMAIN`) is the same across both applications because
both live under the same Zero Trust organization; only the AUD tag
differs per application.

## Step 5 — Set the Worker secrets

The Worker reads two Cloudflare Access values from its runtime env:

| Secret | Value | Source |
| --- | --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | `kodigital2.cloudflareaccess.com` | Step 1 |
| `CF_ACCESS_AUD` | the 64-char AUD tag for the matching environment | Step 4 |

Set both for **each** environment that has its own Access application
(typically `staging` and `production`):

```bash
# Production
wrangler secret put CF_ACCESS_TEAM_DOMAIN --env production
# Paste: kodigital2.cloudflareaccess.com

wrangler secret put CF_ACCESS_AUD --env production
# Paste: the 64-char hex string from Step 4 (production application)

# Staging
wrangler secret put CF_ACCESS_TEAM_DOMAIN --env staging
# Paste: kodigital2.cloudflareaccess.com

wrangler secret put CF_ACCESS_AUD --env staging
# Paste: the 64-char hex string from Step 4 (staging application)
```

For local development, copy the same two values into `api/.dev.vars`
(gitignored). `.dev.vars.example` shows the expected key names without
exposing the real AUD. See `docs/local-dev-vars.md` for the complete
list of local-dev variables.

## Step 6 — Verify with a browser

After the Worker is deployed and the secrets above are set, confirm the
full flow:

1. Open an **incognito** window (no cached Cloudflare Access session)
   and navigate to `https://cms.kodigital.app/admin`.
2. The browser receives an **HTTP 302** redirect to
   `https://kodigital2.cloudflareaccess.com/...`. This is the expected
   unauthenticated behavior — Cloudflare is asking you to sign in.
3. Sign in with an identity that matches the `Allow team` policy from
   Step 3 (e.g. an `@kodigital.io` email).
4. Cloudflare redirects you back to `https://cms.kodigital.app/admin`
   with the `CF_Authorization` cookie set. The Worker now verifies the
   JWT and serves the admin response (HTTP `200`).

You can also confirm the authenticated identity by visiting
`https://cms.kodigital.app/api/admin/auth/status` after Step 6.3 — the
Worker returns JSON `{"authenticated":true,"mode":"identity","email":"..."}`.

## Failure modes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Browser stays on `cms.kodigital.app/admin` (no 302) and shows the Worker's 404 | DNS not proxied through Cloudflare, or the Access application's domain entry doesn't match the request hostname | Confirm the orange-cloud DNS proxy is on and the Application Domain (Step 2) is exactly `cms.kodigital.app` |
| Browser receives 302 to `kodigital2.cloudflareaccess.com` and login succeeds, but the post-login redirect returns HTTP `401 invalid claims` | `CF_ACCESS_AUD` Worker secret does not match the application's AUD tag, or `CF_ACCESS_TEAM_DOMAIN` is wrong (e.g. set to `kodigital.cloudflareaccess.com` without the `2`) | Re-run Step 5 with the values from Steps 1 and 4 |
| Login succeeds, request reaches Worker, but the response is `403` | The signed-in identity is not covered by an `Include` rule on the policy | Edit the policy from Step 3 to include the user (by email or group) |
| `wrangler tail` shows `Failed to fetch JWKS` | `CF_ACCESS_TEAM_DOMAIN` is unset or unreachable from the Worker | Re-run `wrangler secret put CF_ACCESS_TEAM_DOMAIN` and re-deploy |

## Notes

- The 302 redirect to `*.cloudflareaccess.com` is **always** the
  expected behavior for an unauthenticated request — never treat it as
  a bug. The Worker only sees authenticated traffic.
- The AUD tag is per-application. If you ever delete and recreate the
  Access application, the new AUD will differ from the old one and you
  **must** re-run Step 5 to update `CF_ACCESS_AUD` or all authenticated
  requests will start failing with 401.
- The Worker's JWKS cache (`access-auth.ts`) holds the team's public
  keys in KV for 24 hours. Rotating the team's signing keys (Cloudflare
  does this automatically) is invisible to the Worker because the
  middleware re-fetches the JWKS on a `kid` miss before failing.
- Never put `CF_ACCESS_AUD` or `CF_ACCESS_TEAM_DOMAIN` into
  `wrangler.toml` `[vars]` — they belong in `wrangler secret`. The
  AUD is not cryptographically sensitive, but keeping both values in
  the same channel keeps the deploy pipeline consistent.
