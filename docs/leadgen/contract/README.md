# LeadGen CMS — Implementation Contract (package · v2)

**Status: v2.3.7 — READY TO BUILD — v2.3.7 — READY TO BUILD.** The design is grounded in existing code: the default funnel design is measured from the **insureprimo** funnel, the admin/control screens use the **Listicles admin** design, and the funnel + auction logic is re-implemented fresh from the insureprimo engine with the sharper logic specified here. All 52 deliverables are specified (`12-traceability-matrix.md`). Three implementation-time inputs remain (these are implementation-time inputs): a Google Maps key at deploy (address auto-suggest is net-new), the ops-owned Athena→ClickHouse feed, and per-provider example payloads captured via the Test tool at onboarding.

This folder is the complete, pre-implementation design contract for the **LeadGen** product — a new advertorial lead-generation quote-funnel CMS built inside `Gavri19H/kodigital-homepages-cms` (Worker `kodigital-homepages-cms-worker`), namespaced `leadgen_`, admin at `/admin/leadgen` + `/api/admin/leadgen`, runtime at `/lg/*`.

It is written to be handed to a separate implementation agent. It is grounded in the actual code of the target repo, its Listicles subsystem, the `a2z-agent-demo` quote-funnel reference, and the `kodigital-dashboard` analytics stack.

## How to use this package

1. Read `01-…` first (summary, findings, patterns, architecture, navigation). It sets the frame for everything.
2. Implement in the phase order of `10-…` §33. Each phase lists acceptance criteria; do not advance until its tests + the five verify gates are green.
3. The DDL in `migrations/` and `infra/` is normative and matches the schema/DDL sections of the body. Renumber the D1 migrations to `head+1..` at build time.
4. Track completion against the traceability checklist in `10-…` §35.3.

## File manifest

| File | Deliverable sections |
|---|---|
| `00-repository-findings-evidence.md` | Proof of investigation: exact files/functions/routes/tables across all 3 repos + guardrails + **BLOCKERS B1–B5** |
| `01-overview-architecture-navigation.md` | §1 Exec summary · §2 Repo findings · §3 Patterns to reuse · §4 Product architecture · §5 CMS navigation |
| `02-data-model-and-schema.md` | §6 Data model · §7 D1 schema/migrations (full DDL) |
| `03-api-and-admin-ui.md` | §8 API/route design · §9 Admin UI design |
| `04-offers-and-payload-builder.md` | §10 Offers tab (+ rules, banner URL, cap, analytics) · §11 Dynamic payload builder (+ headers, endpoints, token, Test tool) |
| `05-sections-question-builder-design-tokens.md` | §12 Sections (+ deps, mapping, normalization, continue, defaults, Google Maps, analytics) · §13 Question builder · §14 Design-token system |
| `06-quotes-funnel-ab-activation.md` | §15 Quote/funnel builder · §16 Funnel A/B · §17 Site activation (+ quote analytics) |
| `07-auction-runtime-banners-rules.md` | §18 Auction tab (+ analytics) · §19 Runtime flow · §20 Banner builder · §21 Offer/carrier/rule system |
| `08-tracking-clickhouse-mirror-revenue-s2s-ga4.md` | §22 Tracking · §23 ClickHouse · §24 D1 mirror · §25 Provider revenue · §26 S2S/media · §27 GA4 |
| `09-performance-accuracy-security.md` | §28 Performance/caching · §29 Reconciliation · §30 Security/secrets |
| `10-testing-qa-phases-risks-checklist.md` | §31 Testing · §32 Manual QA · §33 Phases · §34 Risks/open questions · §35 Final checklist |
| `12-traceability-matrix.md` | 52-row deliverable→design→data→route→UI→event→analytics→test→status matrix + **v2 status gate** |
| `docs/default-funnel-design-audit.md` + `reference-design-desktop.json` + `reference-design-mobile.json` | Component-by-component audit — the **insureprimo funnel measured as the default design**; screenshots are capability examples only |
| `src/public/leadgen/designs/default-funnel/tokens.ts` | Concrete default funnel token file — reference funnel, measured. |
| `infra/athena-ddl.sql` | Athena DB `leadgen` (events/sessions/dead_letter + views) |
| `infra/clickhouse-ddl.sql` | ClickHouse `lg_*` raw + revenue-attributed + 9 daily target MVs |
| `migrations/0036–0039_leadgen_*.sql` | Proposed additive D1 migrations (core, mirrors, revenue infra, conversion dedupe) |
| `docs/default-funnel-design-audit.md` | Measured default reference funnel design (audit) + component capability examples (OQ-2) |
| `docs/traceability.md` | Migration-numbering + measured-token-override tracker (filled during implementation) |

## Hard rules (non-negotiable)

- **Namespacing:** `leadgen_` tables, Athena DB `leadgen`, CH `lg_*`, routes `/admin/leadgen` + `/api/admin/leadgen` + `/lg/*`. Do **not** reuse `listicle_` names. Do **not** create a Listicles Athena DB for this product.
- **Guardrails:** LeadGen source must contain **no banned tokens** (the reference product name, `quotesRoutes`, `psychic-quiz`, `rental-booking`) — re-implement the auction/adapters fresh. Additive migrations only; forward-only. The agent must not run `wrangler deploy`/`secret put`.
- **Secrets:** all credentials are encrypted wrangler secrets, resolved by `readEnvSecret`, masked, never returned to the frontend; absent secret ⇒ that leg no-ops.
- **Analytics:** ratios computed at read (NULLIF), never stored; default analytics filter `traffic_quality_flag='clean'`; CH column names stable for the dashboard join.
