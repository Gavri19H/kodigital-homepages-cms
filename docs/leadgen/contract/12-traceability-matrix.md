# LeadGen CMS — Contract 12 · v2 Traceability Matrix & Status

Deliverable → design section → data model → API route → UI surface → tracking event → analytics table → test → status. **Status is `Specified` only when fully specified**; anything needing operator input is `BLOCKED <id>` (see `00-repository-findings-evidence.md` BLOCKERS B1–B5).

| # | Deliverable | Design § (file) | Data model | API / route | UI surface | Tracking event | Analytics table | Test | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Repository Findings Evidence | `00` | — | — | — | — | — | (evidence) | Specified |
| 2 | Existing Patterns to Reuse | `01`§3 | — | — | — | — | — | — | Specified |
| 3 | Anti-Patterns / Guardrails | `00`§Guardrails, `09`§30.3 | — | — | — | — | — | `verify:no-legacy-prod-refs` | Specified |
| 4 | Product Architecture | `01`§4 | module layout | `/lg/*`, `/api/admin/leadgen/*` | — | — | — | typecheck | Specified |
| 5 | Namespace Plan | `01`§3, `00` | `leadgen_*`, `lg_*`, Athena `leadgen` | routes `leadgen` | nav | dims | mirrors | `verify:infra` | Specified |
| 6 | CMS Navigation | `01`§5 | — | `/admin/leadgen*` | LeadGen nav + 4 tabs | — | — | UI: nav+tabs | Specified |
| 7 | Ownership + Site Activation | `02`§6.1, `06`§17 | `leadgen_site_quotes` | `/quotes/:id/activation*` | Quotes→Activation | `quote_view`(site_id) | `analytics_quote` | activation resolution | Specified |
| 8 | Data Model | `02`§6 | all 26 tables | — | — | — | — | — | Specified |
| 9 | Full D1 Migration DDL | `02`§7 + `migrations/0036–0039` | all tables | — | — | — | — | migrations tests | Specified |
| 10 | Full API Route Contract | `03`§8 | all | `/api/admin/leadgen/*` + `/lg/*` | — | — | — | integration: routes+auth | Specified |
| 11 | Admin UI Contract | `03`§9 | all | admin GETs | 4 tab shells + editors | — | mirrors | UI flows | Specified |
| 12 | Offers Tab | `04`§10 | `leadgen_offers` | `/offers*` | Offers editor | `offer_click` | `analytics_offer` | Offers CRUD | Specified |
| 13 | Dynamic Payload Builder | `04`§11 (+§11.8–11.10) | `leadgen_offer_payload_schemas`, `_headers` | `/offers/:id/payload-schemas*` | payload tree editor | `auction_offer_request` | `provider_diagnostics` | payload build + auto-from-example | Specified |
| 14 | Offer Test Tool | `04`§11.6 | `leadgen_provider_request_log` | `/offers/:id/test` | Test drawer | — | — | Test proxy + secret mask | Specified |
| 15 | Provider Response Parser | `04`§11.7, `07`§21.6 | `provider_request_log.parsed_carriers_json` | (runtime `auction/parse.ts`) | Test→parsed carriers | `auction_offer_response` | `analytics_carrier` | parse + malformed | Specified |
| 16 | Static Banner URL + Response Macro | `04`§10.5, `07`§16 | `leadgen_offers.banner_url_template` | `/lg/lc` | banner URL + macro chips | `carrier_click` | — | macro + `{response:*}` | Specified |
| 17 | Offer Rules + Cap | `04`§10.4/§10.6 | `leadgen_offer_region_rules`, `_cap_counters` | `/offers/:id/cap` | Offer→Rules | `redirect_rule_triggered` | `analytics_offer` | rules + cap unit | Specified |
| 18 | Sections / Quote Slides | `05`§12 | `leadgen_sections`, `_section_offers` | `/sections*` | Section editor | `section_view` | `analytics_section` | Section CRUD + rebuild | Specified |
| 19 | Rich Question Builder | `05`§13 | `content_json` | `/sections/preview` | builder canvas | `answer_click` | `answer_distribution` | UI: each preset | Specified |
| 20 | Rich Styling / Design Token | `05`§14 | `design_overrides_json` | (runtime designs) | inspector controls | — | — | visual + computed-style | Specified |
| 21 | Reference Design Audit | `docs/default-funnel-design-audit.md` + `-desktop/-mobile.json` | — | — | — | — | — | visual regression | Specified (measured from insureprimo funnel) |
| 22 | Default Design Token File | `src/public/leadgen/designs/default-funnel/tokens.ts` | — | — | design registry | — | — | computed-style | Specified (insureprimo-measured tokens shipped) |
| 23 | Question Component Presets | `05`§14.3 | `content_json` components | — | preset renderers | per-preset events | `answer_distribution` | preset render tests | Specified (net-new presets provisional, finalized at first build) |
| 24 | Dependencies / Conditional Logic | `05`§12.3 | `content_json.conditional` | `/sections/preview` | IF/THEN builder | `answer_change` | — | dependency preview | Specified |
| 25 | Answer Normalization + Value Mapping | `05`§12.7, §16 | `section_answer_maps.output_value_map/transform` | — | value-map grid | `answer_click`(normalized) | `answer_distribution` | normalization unit | Specified |
| 26 | Answer-to-Offer Payload Mapping | `05`§12.4/§12.11 | `leadgen_section_answer_maps` | `/sections/:id/validate-payload` | mapping grid + errors | — | — | mapping + preview | Specified |
| 27 | Google Maps Address/ZIP Validation | `05`§12.8 | `sections.address_validation_enabled` | (runtime) | address/ZIP presets | `address_validation_*` | `analytics_section` | ZIP + autofill | Specified (net-new; needs Maps key at deploy) |
| 28 | Quote/Funnel Builder | `06`§15 | `leadgen_quotes`, `_quote_variants`, `_variant_sections` | `/quotes*`, `/variants/:id` | Funnel builder | `quote_view` | `analytics_quote` | funnel builder + validate | Specified |
| 29 | Opening Lander | `06`§15.2 | `quote_variants.lander_*` | `/variants/:id` | lander editor | `opening_lander_view/_cta_click` | `analytics_quote` | lander render | Specified |
| 30 | Funnel Rules | `06`§15.5 | `leadgen_funnel_rules` | `/variants/:id` | IF/THEN builder | `redirect_rule_triggered`,`direct_offer_redirect` | — | rules unit | Specified |
| 31 | Funnel A/B | `06`§16 | `leadgen_funnel_ab_tests`, `_variants.traffic_allocation` | `/quotes/:id/experiments`, `/experiments/:id/{start,stop}` | A/B panel | `quote_view`(variant, bucket) | `analytics_quote` | golden vectors + distribution | Specified |
| 32 | Site Activation | `06`§17 | `leadgen_site_quotes` | `/quotes/:id/activation/:site_id` | Activation panel | — | `analytics_quote`(site_id) | activation resolution | Specified |
| 33 | Auction Config | `07`§18 | `leadgen_auctions`, `_auction_offers` | `/auctions*` | Auction editor | `auction_start` | `analytics_auction` | Auction CRUD | Specified |
| 34 | Auction Runtime | `07`§19 (+§19.2) | `provider_request_log`, `session_clicked_offers` | `/lg/auction`, `/auctions/:id/simulate` | Simulate panel | `auction_offer_*`,`auction_filled/unfilled` | `analytics_auction`,`provider_diagnostics` | runtime branches + simulate | Specified |
| 35 | Banner Builder / Design Registry | `07`§20 | `leadgen_auction_banners` | `/auctions/:id/banner` | banner builder | `carrier_impression` | `analytics_carrier` | banner manual/auto | Specified |
| 36 | Carrier Identity + Carrier Rules | `07`§21 (+§21.5) | `leadgen_auction_rules`(carrier) | `/auctions/:id/rules` | carrier rules | `auction_carrier_eligible/_filtered` | `analytics_carrier` | carrier identity + rules | Specified |
| 37 | Multi-Offer / Backfill / Remove-Clicked | `07`§18.5–18.7 | `auctions.multi_offer/backfill/remove_clicked`, `session_clicked_offers` | `/lg/auction` | Auction settings | `carrier_impression/_click` | `analytics_auction` | 3 modes + backfill + remove | Specified |
| 38 | Tracking Event Schema | `08`§22 | — | `/lg/track` | 31 event types + dims | — | (all) | event-schema tests | Specified |
| 39 | Athena Tables | `08`§22, `infra/athena-ddl.sql` | Athena `leadgen.events/sessions/dead_letter` | — | — | all | — | (manual apply) + recon | Specified (DDL ready; ingest ops-owned) |
| 40 | ClickHouse Tables + MVs | `08`§23, `infra/clickhouse-ddl.sql` | `lg_*` raw+attributed+9 daily targets | — | — | — | `lg_*_daily` | mirror tests (mocked CH) | Specified (ingest ops-owned) |
| 41 | D1 Analytics Mirrors | `08`§24, `02`§7.5 | 9 `leadgen_analytics_*` | `/analytics/rebuild-range` | (read by tabs) | — | mirrors | mirror-sync tests | Specified |
| 42 | Revenue Ingestion / Reconciliation | `08`§25, `09`§29 | `revenue_raw/_unmatched/_conversion_log/_fx_rates/_postback_log` | `/lg/pb/:provider`, `/lg/px` | — | `conversion`,`revenue_received` | `analytics_offer`(revenue) | dedupe/attribution/recon | Specified |
| 43 | S2S Media Platform Reporting | `08`§26 | `leadgen_media_platforms` | `/media-platforms*` | media-platforms admin | (fires on `conversion`) | — | S2S fire/dedupe | Specified |
| 44 | GA4 Validation | `08`§27 | (site settings) | `/lg/*` shell | — | (GA4 dataLayer) | — | GA4 UI tests | Specified |
| 45 | Performance / Caching | `09`§28 | `content_version`,`LEADGEN_TEMPLATE_VERSION` | `/lg/*` (cached), `/lg/config` | — | — | — | perf regression | Specified |
| 46 | Data Accuracy / Dedup / Reconciliation | `09`§29 | dedupe UNIQUEs, `event_dead_letter` | — | — | idempotency dims | — | recon + dedupe tests | Specified |
| 47 | Security / PII / Secrets | `09`§30 | `*_secret_ref` cols | (all) | masked token UI | — | — | auth + secret-mask + PII | Specified |
| 48 | Testing Plan | `10`§31 | — | — | — | — | — | (all suites) | Specified |
| 49 | Manual QA Checklist | `10`§32 | — | — | — | — | — | operator run | Specified |
| 50 | Implementation Phases | `10`§33 | — | — | — | — | — | per-phase gates | Specified |
| 51 | Risks / Open Questions | `10`§34, `00` BLOCKERS | — | — | — | — | — | — | Specified |
| 52 | Final Traceability Matrix | this file | — | — | — | — | — | — | Specified |

---

## v2 status

**Status: v2.3.7 — READY TO BUILD — v2.3.7 — READY TO BUILD.**

All 52 deliverables are specified — data model, migrations, API routes, UI surfaces, tracking events, analytics tables, and tests are specified. The design is grounded in existing code:

- **Default funnel design** = the insureprimo funnel, measured 1:1 into `designs/default-funnel/tokens.ts` (§21).
- **Admin / control screens** = the Listicles admin design language applied to Offers/Sections/Quotes/Auction (§9); insureprimo admin templates are the logic reference.
- **Funnel + auction logic** = re-implemented fresh from the insureprimo engine with the sharper logic in this contract (§7/§11/§18–21).

Three **implementation-time inputs** remain — these are implementation-time inputs or design sign-off:

| Input | When | Note |
|---|---|---|
| Google Maps key | at deploy | address/ZIP auto-suggest is net-new (insureprimo used ZIP regex + KV city/state) |
| Athena→ClickHouse feed | Phase 12 | data-ops-owned; mirror-sync tested vs seeded D1 + mocked CH meanwhile |
| Per-provider example payloads | per-provider onboarding | captured via the built-in Test tool; generic builder covers the common case |

Build in the phase order of `10`§33.
