# Secrets Manifest

This document lists every secret the `kodigital-homepages-cms` Worker
needs, where the value lives, and how it is delivered to each
environment. **No secret value appears in this repository.** The
manifest names the keys only.

## Secrets used by the Worker

| Key                      | Purpose                                          | Required in     |
| ------------------------ | ------------------------------------------------ | --------------- |
| `OPENAI_API_KEY`         | Calls to OpenAI text/image models from `/admin`. | staging, prod   |
| `CF_ACCESS_TEAM_DOMAIN`  | Cloudflare Access team domain for JWT issuer.    | staging, prod   |
| `CF_ACCESS_AUD`          | Cloudflare Access application AUD claim.         | staging, prod   |
| `CLOUDFLARE_API_TOKEN`   | Used by CI (`wrangler deploy`) — NOT by Worker.  | CI only         |
| `DEV_BYPASS_AUTH`        | Local dev escape hatch. Set `true` in `.dev.vars`. | local only    |

`OPENAI_API_KEY`, `CF_ACCESS_TEAM_DOMAIN`, and `CLOUDFLARE_API_TOKEN`
are the three keys the project depends on operationally; they appear in
this table and in `.dev.vars.example` as placeholder names so a new
contributor can wire them up locally without guessing.

## Where each value lives

- **Local development**: values are read from `api/.dev.vars`. This file
  is gitignored and is **never committed**. A scrubbed companion file
  `.dev.vars.example` ships in the repo with placeholder values only.
- **Cloudflare staging / production**: values are stored as Worker
  Secrets in the Cloudflare Dashboard under the
  `kodigital-homepages-cms-worker` Worker, set via
  `wrangler secret put <KEY> --env staging|production`. They are NOT
  declared in `wrangler.toml` (only non-secret vars belong there).
- **GitHub Actions (CI)**: `CLOUDFLARE_API_TOKEN` is stored as a
  repository secret in the GitHub Settings → Secrets and Variables
  Dashboard. `OPENAI_API_KEY` and the Access secrets are NOT exposed to
  CI — CI only deploys; it does not exercise the Worker against OpenAI.

## Delivery rules

1. Secret values are **never committed** to git, in any form.
2. `.dev.vars` is in `.gitignore`. Verify with `git check-ignore`.
3. `.dev.vars.example` contains placeholder strings only (no real keys,
   no high-entropy tokens) and is the source of truth for which keys a
   developer needs locally.
4. Production secrets are rotated through the Cloudflare Dashboard;
   staging secrets are rotated via `wrangler secret put` from a trusted
   workstation.
5. CI workflows reference `${{ secrets.CLOUDFLARE_API_TOKEN }}` via the
   GitHub Actions Dashboard; the token is scoped to the `kodigital`
   account and to deploy/edit-Worker permissions only.

## Adding a new secret

1. Add the key to the table above with its purpose and which envs need it.
2. Add a placeholder line to `.dev.vars.example`.
3. Set the value in each target environment via `wrangler secret put` or
   the Cloudflare Dashboard. Never commit the value.
4. If the secret is consumed by CI, add it as a GitHub repository secret
   and reference it in the workflow file.
