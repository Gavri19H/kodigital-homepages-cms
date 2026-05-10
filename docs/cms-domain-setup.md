# CMS Domain Setup — `cms.kodigital.app` and `staging-cms.kodigital.app`

This runbook is the click-level operator guide for wiring the public
hostnames the CMS admin SPA serves under: `cms.kodigital.app` for
production and `staging-cms.kodigital.app` for staging. It covers the
Cloudflare zone, DNS records, the Worker custom-domain route, and the
post-wire smoke test.

The hostname contract is enforced by the Worker itself (T3 routing) and
by the Cloudflare Access application gating each host (T6 setup). Both
upstream contracts assume `cms.kodigital.app` and
`staging-cms.kodigital.app` are the **only** routes that serve `/admin`
and `/api/admin` — anything else gets a 404. **Do NOT** add the Worker
to additional hostnames; Phase 1.5 is single-host-per-env by design.

## Prerequisites

- The `kodigital.app` zone is already created in Cloudflare (Account →
  **Websites** → `kodigital.app`). If the zone is not yet present, add
  it before continuing — registrar-side nameserver delegation is a
  separate ticket.
- The Worker scripts `kodigital-homepages-cms-worker` and
  `kodigital-homepages-cms-worker-staging` already exist (see
  `docs/cloudflare-worker-setup.md`).
- Cloudflare Access applications for both hostnames already exist (see
  `docs/cloudflare-access-setup.md`). Access is applied **before** the
  Worker route activates so there is no window where the admin SPA is
  publicly reachable.

## Step 1 — DNS records

Cloudflare Workers Custom Domains create the underlying DNS record for
you when you click "Add" — but creating the records explicitly first
gives the operator a chance to confirm proxy state and TTL.

1. Dashboard → **Websites** → `kodigital.app` → **DNS** → **Records**.
2. Click **Add record**:
   - **Type**: `AAAA`
   - **Name**: `staging-cms`
   - **IPv6 address**: `100::` (Cloudflare's discard address — overridden
     by the Worker custom-domain route)
   - **Proxy status**: **Proxied** (orange cloud) — required for
     Workers routing.
   - **TTL**: Auto.
3. Click **Save**.
4. Repeat for production:
   - **Type**: `AAAA`
   - **Name**: `cms`
   - **IPv6 address**: `100::`
   - **Proxy status**: **Proxied**.
5. Verify with `dig`:
   ```bash
   dig +short cms.kodigital.app A
   dig +short staging-cms.kodigital.app A
   ```
   Both should return Cloudflare anycast IPv4 addresses (the proxied
   record returns Cloudflare IPs, NOT the discard `100::`).

## Step 2 — Worker custom domain (staging)

1. Dashboard → **Workers & Pages** →
   `kodigital-homepages-cms-worker-staging` → **Settings** → **Triggers**.
2. Under **Custom Domains**, click **Add Custom Domain**.
3. **Domain**: `staging-cms.kodigital.app`. Click **Add Custom Domain**.
4. Wait for the status to flip from **Initializing** to **Active**
   (typically <60s). Active status confirms the SSL certificate has
   been issued by Cloudflare's edge.
5. Browser-test:
   ```bash
   curl -I https://staging-cms.kodigital.app/health
   ```
   Expected: HTTP 200 with `content-type: application/json`.
   If 522 / 1016 / 525, wait another 60s for cert provisioning.

## Step 3 — Worker custom domain (production)

Repeat Step 2 against `kodigital-homepages-cms-worker` with domain
`cms.kodigital.app`.

```bash
curl -I https://cms.kodigital.app/health
```

Expected: HTTP 200. The `/health` route returns `{ "ok": true }` and is
deliberately *not* gated by Cloudflare Access — it's the only un-gated
route on the admin host, used by uptime probes. Every other path on
`cms.kodigital.app` is either covered by Access or hostname-404'd.

## Step 4 — Confirm hostname routing contract

The Worker's T3 routing contract (`api/src/index.ts`) decides what each
hostname/path combination returns. Confirm the live behavior matches:

```bash
# 1. Admin host root → 302 to /admin
curl -I https://cms.kodigital.app/

# 2. Admin host /unknown → 404
curl -I https://cms.kodigital.app/unknown-path

# 3. Admin host /admin → either 200 (authed) or 302 to *.cloudflareaccess.com
curl -I https://cms.kodigital.app/admin
```

Anything other than the three behaviors above means either the routing
code or the custom-domain wiring drifted. Diagnose by tailing
`wrangler tail --env production` while reproducing.

## Step 5 — `*.workers.dev` lockdown

After Step 3 succeeds for both envs, complete Step 6 of
`docs/cloudflare-worker-setup.md` to disable the
`*.workers.dev` subdomain for each Worker. The custom domain is the
*only* supported public surface; leaving the workers.dev surface
enabled is a Phase 1.5 contract violation (admin SPA reachable on a
host not covered by the Access application).

## Verification

From `api/`:

```bash
npm run smoke:cms-domain
```

This script (added in T11) curls the live endpoints listed in Step 4
plus `/api/admin/auth/status` against both staging and production. It
exits non-zero on any unexpected status code or response shape.

The script is run manually after each new domain wire — it is NOT in
CI because it requires a service-token secret pair (see
`docs/cloudflare-access-service-token-setup.md`) and live network.

## Failure modes

| Symptom                                                                   | Likely cause                                                              | Fix                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `cms.kodigital.app` resolves but `/health` returns 1016 / 522            | DNS record exists but Worker custom-domain route is **Initializing**.    | Wait 60–120s; Cloudflare provisions an Edge cert lazily.                                       |
| `curl -I https://cms.kodigital.app/admin` returns 200 in incognito       | Cloudflare Access application is missing or not applied to this host.    | Run `docs/cloudflare-access-setup.md` Steps 2–3.                                              |
| `dig +short cms.kodigital.app` returns no answer                          | DNS record was added unproxied or under wrong zone.                       | Recreate the record under `kodigital.app` zone with proxy ON.                                  |
| `wrangler tail --env production` shows requests on `*.workers.dev`        | `*.workers.dev` subdomain is still enabled.                               | Disable per Step 6 of `docs/cloudflare-worker-setup.md`.                                       |
| `curl -I https://staging-cms.kodigital.app/admin` 302s to a `cloudflareaccess.com` host that is NOT `kodigital2.cloudflareaccess.com` | Access team-domain mismatch; the wrong tenant claimed the application.    | Recreate the Access application under the correct team (see `docs/cloudflare-access-setup.md`). |

## Cross-references

- `docs/cloudflare-worker-setup.md` — Worker creation (Step 6 disables
  `*.workers.dev`).
- `docs/cloudflare-access-setup.md` — Access application + AUD capture.
- `docs/cloudflare-resources-setup.md` — D1 / KV / R2 (decoupled from
  domain wiring but required for full deploy).
- `docs/deployment-runbook.md` — end-to-end deploy.
