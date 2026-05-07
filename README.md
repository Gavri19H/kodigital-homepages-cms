# kodigital-homepages-cms

Standalone CMS that publishes lightweight per-site landing pages, built
as a single Cloudflare Worker. This repository is the new home of the
`kodigital-homepages-cms` project; it is intentionally isolated from the
sibling Cloudflare project `a2z-cf-cms-v1` and from any TheIWise
production resource (see `docs/no-touch-red-line.md`).

## Stack

- Runtime: Cloudflare Worker (Hono v4, TypeScript) — code lives in `api/`
- Storage: D1 (SQL), R2 (media), KV (`CACHE`) — Phase 0 declares the
  bindings only; real resource IDs are provisioned in a later phase
- Auth: `/admin` is gated by Cloudflare Access (`accessAuth` middleware)
- AI: OpenAI text + image models, called only from `/admin`
- CI/CD: GitHub Actions (`.github/workflows/deploy.yml`) →
  `wrangler deploy --env staging` on a green push to `main`

## Repository layout

```
api/                      Cloudflare Worker package
  package.json            Worker scripts (dev/test/typecheck/verify/deploy)
  wrangler.toml           Bindings + per-env vars
  src/                    Worker source
    env.ts                Typed Env interface + parse helpers
    index.ts              Hono app: /health, /admin
    auth/access-auth.ts   Cloudflare Access middleware (presence check)
  scripts/verify/         Banned-string scanner
  test/                   Vitest suite (health, admin-auth, verify-script)
docs/                     Architecture, secrets manifest, phase plan,
                          no-touch red line, storage cost model
.github/workflows/        CI pipeline
acceptance-tests/         Read-only AC scripts (managed by mission tools)
```

## Getting started

Prerequisites: Node 20+, npm, a Cloudflare account, and `wrangler` (the
project pins it as a devDependency, so `npx wrangler` works without a
global install).

```bash
# 1. Install
cd api
npm ci

# 2. Configure local secrets
cp ../.dev.vars.example .dev.vars
# Edit .dev.vars and fill in real values (see docs/secrets-manifest.md)

# 3. Run locally
npm run dev          # wrangler dev — serves /health and /admin
npm test             # Vitest suite
npm run typecheck    # tsc --noEmit
npm run verify:no-legacy-prod-refs   # banned-string scanner
```

`/health` returns `{ ok: true, app: "kodigital-homepages-cms" }`.
`/admin` is gated by Cloudflare Access; locally you can set
`DEV_BYPASS_AUTH=true` in `.dev.vars` to bypass the JWT presence check.

## Deployment

Pushes to `main` run typecheck, tests, and the verify scanner, then
deploy to staging via `wrangler deploy --env staging`. Production
deploys are gated and happen in a later phase per
`docs/phase-plan.md`. CI does not echo secrets; `CLOUDFLARE_API_TOKEN`
is read from GitHub Actions Secrets.

## Isolation contract

This project does NOT touch any legacy production resource. A list of
banned legacy identifiers is enforced in active source by the verify
scanner at `api/scripts/verify/assert-no-legacy-prod-refs.ts`, which
runs on every PR and push. See `docs/no-touch-red-line.md` for the
full red-line policy and the canonical list of banned tokens.

## Documentation

- `docs/source-architecture.md` — what we reuse vs. exclude from the legacy stack
- `docs/secrets-manifest.md` — every secret key, where its value lives
- `docs/storage-cost-model.md` — D1 / R2 / KV sizing
- `docs/phase-plan.md` — Phase 0 → Phase 7 roadmap
- `docs/no-touch-red-line.md` — isolation boundary
