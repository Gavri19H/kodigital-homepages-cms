# Session Map v2 — kodigital-homepages-cms

This map tracks the 8 build sessions (0-indexed) that take this project
from initial scaffold to production cutover. Each session corresponds to
a coherent unit of work that lands as one PR (or a tight series of PRs)
and ends with a green CI + a green operator runbook step.

The session boundaries are deliberately wider than the phase boundaries
in `docs/phase-plan.md` because Phase 1.5 (this session) inserts a
hardening pass between the initial resource wiring (Phase 1) and the
core CMS schema work (Phase 2). The session numbering keeps Phase 1.5
as a first-class slot rather than collapsing it into Phase 1.

## Session 0 — Phase 0 scaffold

Status: completed in a prior mission.

Delivers the Worker package under `api/` with TypeScript, Hono, Vitest,
and Wrangler. Ships placeholder `wrangler.toml` bindings (D1, R2, KV)
that do NOT point at real Cloudflare resources yet. Adds the `/health`
endpoint, a presence-check `/admin` middleware, a 404 handler, and the
`verify:no-legacy-prod-refs` banned-string scanner. Documentation set:
phase-plan, source-architecture, no-touch-red-line, secrets-manifest,
storage-cost-model.

Exit gate: `npm run typecheck`, `npm test`, and
`npm run verify:no-legacy-prod-refs` all exit 0 against the scaffold.

## Session 1 — Phase 1 real Cloudflare resources + Access wiring

Status: completed in a prior mission.

Creates the kodigital-homepages-cms D1 database, R2 bucket, and KV
namespace in the Cloudflare dashboard. Replaces the `PLACEHOLDER_*`
binding IDs in `wrangler.toml` with the real resource IDs. Stands up
Cloudflare Access in front of the staging hostname. First end-to-end
deploy to staging.

Exit gate: a staging deploy returns the `/health` JSON over the real
staging hostname, and `/admin` returns the Access login redirect.

## Session 2 — Phase 1.5 infra / secrets / domain (CURRENT)

Status: in progress (this mission).

Hardens the contract surface between the Worker, GitHub Actions, and
Cloudflare Access before any persistent CMS data lands. Concretely:

- Pins the production + staging admin hostnames (`cms.kodigital.app`
  and `staging-cms.kodigital.app`) into per-env `[vars]` in
  `wrangler.toml` and into hostname-aware routing in `api/src/index.ts`.
- Splits the Cloudflare API token into three single-purpose secrets:
  `CLOUDFLARE_API_TOKEN` for GitHub Actions deploys only,
  `CLOUDFLARE_PROVISIONING_API_TOKEN` for Worker-runtime provisioning
  calls, and `CLOUDFLARE_CACHE_API_TOKEN` for Worker-runtime cache
  purges. Documents the split in `docs/secrets-manifest.md` plus four
  per-surface setup guides (GitHub, Worker, local dev, Access service
  token).
- Implements full JWT signature verification against the Cloudflare
  Access JWKS in `api/src/auth/access-auth.ts` (identity mode by email
  and service-token mode by `common_name`) with a double-gated
  `DEV_BYPASS_AUTH` escape hatch that refuses to fire when
  `APP_ENV === "production"`.
- Adds `api/src/safety/protected-domains.ts` as a runtime denylist that
  refuses to operate on the prior project's hostnames.
- Adds three new verifiers (`verify:infra`, `verify:required-secrets`,
  `verify:worker-config`) plus a `smoke:cms-domain` script and wires the
  five-step acceptance gate into `.github/workflows/deploy.yml`.

Exit gate: `npm run typecheck`, `npm test`,
`npm run verify:no-legacy-prod-refs`, `npm run verify:infra`, and
`npm run verify:worker-config` all exit 0; production deploy stays
behind `workflow_dispatch` (no auto-deploy on push).

## Session 3 — Phase 2 core CMS schema + admin CRUD

Status: planned.

Lands the D1 migrations for sites, pages, articles, blocks,
translations, and the audit log. Introduces admin-only CRUD endpoints
behind Access plus a minimal admin UI. Wires KV-backed render cache and
invalidation hooks against the CRUD endpoints so writes can purge
specific cache keys.

Exit gate: admin CRUD round-trip works end-to-end against staging; the
KV cache invalidation contract is exercised by tests.

## Session 4 — Phase 3 public render path + media pipeline

Status: planned.

Builds the public site renderer: hydrate a page from D1, fall back
through KV cache, return HTML at the edge under the
`HTML_CACHE_TTL_SECONDS` contract pinned in Session 2. Adds R2 media
upload plus on-the-fly resize via Cloudflare Images.

Exit gate: a public page renders from D1 with the expected
cache-control headers; uploaded images survive a round-trip through R2
+ Images.

## Session 5 — Phase 4 AI authoring assistance

Status: planned.

Adds OpenAI text + image generation behind admin endpoints
(`OPENAI_API_KEY` scoped to admin requests). Introduces per-tenant rate
limiting, response caching, and audit-log entries that record every AI
call by admin email or service-token `common_name`.

Exit gate: AI authoring endpoints are admin-gated, rate-limited, and
audit-logged; the OpenAI key is never reachable from a public render
request.

## Session 6 — Phase 5 multi-site onboarding + Phase 6 observability

Status: planned.

Two related slices land together because tenant onboarding is the first
workload that stresses the observability story. Per-tenant
provisioning creates the site record, default pages, default theme, and
starter articles in one flow. Structured logs go to Cloudflare Logpush;
dashboards cover cache hit rate, D1 latency, and error rate. Initial
SLOs are defined and started.

Exit gate: a new tenant can be onboarded in one admin flow and the
observability dashboards show the expected traffic shape from that
onboarding.

## Session 7 — Phase 7 production cutover

Status: planned.

Move the first production tenants onto kodigital-homepages-cms behind a
feature-flagged DNS switch. The no-touch-red-line documented in
`docs/no-touch-red-line.md` stays in force throughout — the prior
project keeps serving its own traffic on its own hostnames until those
tenants are explicitly migrated.

Exit gate: at least one production tenant is served by
kodigital-homepages-cms; rollback procedure documented in
`docs/deployment-runbook.md` has been dry-run from the operator's
side.

## How to use this map

- Reviewers: a PR that mixes work from two sessions is a smell — split
  it unless the sessions explicitly travel together (e.g. Session 6).
- Operators: each session ends with an exit gate that is the same
  command list you would run from the runbook. If the gate fails, the
  session is not done, regardless of what the PR description claims.
- Planners: when scoping a new mission, name the target session in the
  mission slug so the worktree path makes the session intent visible
  from `ls`.
