# Phase Plan — kodigital-homepages-cms

Phase 0 is what this PR delivers: the Worker scaffolding, isolation
guardrails, and the verify/test pipeline. The phases below describe the
intended build-out after Phase 0 and exist so reviewers can spot when a
later PR drifts out of its phase.

## Phase 0 — Scaffold (this mission)

- Worker package under `api/` with TypeScript, Hono, Vitest, Wrangler.
- Placeholder `wrangler.toml` bindings (D1, R2, KV) — no real resources
  created yet.
- `/health` endpoint, `/admin` Access-gated stub, 404 handler.
- `verify:no-legacy-prod-refs` banned-string scanner + Vitest suite.
- Docs: this phase plan plus the no-touch / source-architecture /
  secrets / cost-model docs.

## Phase 1 — Real Cloudflare resources + Access wiring

- Create the kodigital-homepages-cms D1 database, R2 bucket, KV
  namespace; replace `PLACEHOLDER_*` IDs in `wrangler.toml`.
- Wire Cloudflare Access in front of the staging hostname; replace the
  Phase 0 presence-check middleware with full JWT signature
  verification using `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`.
- First end-to-end deploy to a staging hostname.

## Phase 2 — Core CMS schema + admin CRUD

- D1 migrations for sites, pages, articles, blocks, translations, audit
  log.
- Admin-only CRUD endpoints behind Access; minimal admin UI.
- KV-backed render cache and invalidation hooks.

## Phase 3 — Public render path + media pipeline

- Public site renderer: hydrate page from D1, fall back through KV
  cache, return HTML at the edge.
- R2 media upload + on-the-fly resize via Cloudflare Images.

## Phase 4 — AI authoring assistance

- OpenAI text + image generation behind admin endpoints (`OPENAI_API_KEY`
  scoped to admin requests). Caching, rate limits, audit log entries.

## Phase 5 — Multi-site onboarding flows

- Per-site provisioning: site record, default pages, default theme,
  starter articles. Admin tooling to onboard a new tenant in one flow.

## Phase 6 — Observability + SLOs

- Structured logs to Cloudflare Logpush, dashboards for cache hit rate,
  D1 latency, error rate. Define and start tracking SLOs.

## Phase 7 — Production cutover

- Move first production tenants from the legacy stack to
  kodigital-homepages-cms behind a feature-flagged DNS switch. Keep the
  no-touch-red-line in force throughout.

## Out-of-phase changes

Anything that adds real Cloudflare resource IDs, removes the
`DEV_BYPASS_AUTH` middleware path, or wires the public render path is
out of Phase 0 and belongs in the corresponding later phase.
