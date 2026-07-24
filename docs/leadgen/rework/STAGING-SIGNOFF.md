# LeadGen Rework — Staging Sign-off & Cutover Package

Program: LEADGEN-REWORK-03 (contract v2, owner-approved). Status at hand-off:
**complete, pending owner acceptance + deploy** — every traceability row is PASS with
executed evidence except the operator-owned rows listed in §4 below. Nothing in this
program was deployed to production by the mission; production deploy is owner-owned.

## 1. What ships

The full contract: independent question components (M6 grid removal), phone format mask
(M8), configurable address field set (M9), five slider types (M7/§6.8), authored "Other"
dropdown (§6.5), shared-path editor fixes (§6.1–6.7), and the Quotes rebuild — shared
first page, multi-funnel board with slot-level A/B + slot rules, quote-scoped multi-action
routing rules (M3), saved frame templates (M5), live-canvas Templates/Themes tabs
(§8.2–8.4), plus the §10 no-dead-code sweep. Engine bundle: 50,037 / 51,200 bytes
(owner cap D1, per-feature ledger in `byte-ledger.md`).

Branch chain (each phase adversarially reviewed to SHIP before entering the chain):

| Phase | Branch | Head |
|---|---|---|
| P0 design pack | merged to main | 989c54a (PR #131) |
| P1 data model & server | leadgen-rework/p1-data-server | 4c9b534 |
| P2 studio + runtime | leadgen-rework/p2-studio-runtime | 1f1ccf5 |
| P3a+P3b quotes split + board | leadgen-rework/p3b-board-rules | 6bfb05f (contains P3a) |
| P4 templates + themes | leadgen-rework/p4-templates-themes | 60972fc |
| P5 removal sweep + tests | leadgen-rework/p5-removals-tests | 701c14b |
| P6 acceptance | leadgen-rework/p6-acceptance | (this branch) |

PR numbers are assigned at cutover; PRs merge in chain order after a rebase +
foreign-file check + migration-number re-check against any parallel-mission PRs.

## 2. Cutover choreography — READ BEFORE MERGING ANYTHING

**Why this is time-critical:** staging and production share ONE D1 database
(`caa649b9-…4800`). Every merge to main auto-deploys the STAGING worker AND applies
migrations 0046–0054 to that shared database, while the PRODUCTION worker keeps running
the OLD code until someone dispatches a production deploy. Migration 0046 (M1) drops
`is_control`, which the old production worker's variant resolution `ORDER BY` still
reads — **live funnels degrade from the first migrating merge until the production
dispatch**. Migration 0054's compatibility index keeps the old worker's analytics
drilldown INSERTs alive through the window, but funnel serving is the hard constraint:
**the window must be minutes, not hours.**

Sequence (one sitting, owner present):

1. Conductor merges the PR chain in order: P1 → P2 (back-to-back, P2 immediately after
   P1) → P3b (carries P3a) → P4 → P5 → P6. Each merge triggers the staging deploy;
   the first one applies the migrations to the shared DB.
2. Owner runs the 10-minute staging validation (§3).
3. Owner dispatches the production deploy: GitHub → Actions → deploy.yml →
   **Run workflow** (workflow_dispatch) → production. This is the only production
   mutation in the program and it is owner-owned.
4. Post-deploy behavioral check (not just HTTP 200): open one live funnel URL — it
   serves and Continue advances; open admin → Quotes → a funnel board loads; analytics
   drilldown shows the `routed_to_funnel` and `feed_name` columns.

**If staging validation fails:** do NOT dispatch production, but note the DB is already
migrated — the old production worker is degraded either way. Fastest recovery is
roll-forward (fix, re-merge, dispatch); there is no in-place rollback of the shared DB.
This is why step 2 is brief and step 3 follows immediately.

## 3. Staging validation checklist (owner, ~10 minutes)

- Admin → Quotes: board renders (library left, board center, rules right); no horizontal
  page scroll at 1280.
- Create a funnel → **+ Add page** creates an empty page → **＋ section** popover stays
  open and adds a section → drag a chip between pages.
- Shared first page chip → kebab → **A/B this slot** and **Slot rule** open their editors.
- Rules rail → New rule → save a rule with ≥1 action; the plain-language sentence renders.
- Templates tab: live canvas renders a real section; apply-to-funnel shows
  preview-before-apply. Themes tab: live sample follows the selected theme.
- Open the composed live route for an activated quote (`/lg/<slug>`): shared page serves
  first; phone mask fills; a slider records; completing the funnel produces an outcome
  with `routed_to_funnel` (and `feed_name` if a rule stamps one) in analytics.

## 4. Operator-owned items (the register's BLOCKED rows)

| Item | Detail |
|---|---|
| OP-1 Production deploy | §2 step 3 above (workflow_dispatch). |
| OP-2 Site logos (owner ruling D4) | Upload real logo assets in Site settings (`site_settings.logo_media_id` per site). Until then the funnel header shows the honest placeholder chip: "No logo — set it in Site settings." (A-8). |
| OP-3 Manual visual QA | Auth-gated staging pass at 1280 + 375 (the §3 checklist is the minimum). |
| OP-4 Owner hands-on acceptance | §11 cross-cutting terminal gate — the mission ends at "complete, pending owner acceptance + deploy"; acceptance is yours to declare. |
| ClickHouse mirror extension | Whenever ops extends the analytics mirror for the new drilldown dimensions: update `api/src/leadgen/mirror-sync.ts`'s MirrorSpec + apply the matching ClickHouse DDL **and in the same change** DROP the compatibility index `uq_leadgen_quote_drilldown_legacy_upsert` (obligation documented in `api/migrations/0054_leadgen_analytics_routing_dims.sql`, lines 54–56). |

## 5. Disclosure — contractually surface-less frame axes

These stored frame-config values RENDER when present in `frame_config_json` but have NO
authoring UI (ruled in-program as contractually surface-less; the owner may name a
surface in a follow-up): `header.tagline`, `header.secure_badge`, `header.cta`,
`footer.links`, `footer.trust_text`, `footer.description`, `disclosure.location`,
`disclosure.text`, `trust_strip.*`, `benefit_bar.*`, per-arm frame-group override,
`compat.allow_section_chrome` (all in `api/src/public/leadgen/designs/frames.ts`).

## 6. CI facts (verified)

- deploy.yml runs on `pull_request` → the full vitest suite (`npm test` = `vitest run`,
  421 files / 6,920 tests incl. every rework suite) executes on Node 22 as the PR check
  for each cutover PR. Deliberately, CI runs NO Playwright — browser evidence lives in
  the per-phase conductor batteries and the P6 acceptance journey suites (run locally,
  both engines, counts recorded in `traceability.md`).
- All migrations 0046–0054 are anchored in `.github/workflows/deploy.yml` (grep-verified
  1× each; staging and production apply steps run the full directory).
