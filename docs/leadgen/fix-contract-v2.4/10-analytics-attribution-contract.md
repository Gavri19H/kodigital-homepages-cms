# 10 · Analytics & Attribution Contract (Phases 1+5 · R6, R7 downstream, T1 analytics proof)

**Frozen:** the event vocabulary (`analytics/leadgen-events.ts:42–74`, 31 types), the ingest pipeline (`analytics/leadgen-track.ts` — validation, enrichment, dead-letter, KV replay dedupe, GPC/opt-out), Athena `leadgen` domain, ClickHouse `lg_*` tables, and **exactly 9 D1 mirrors ↔ 9 ClickHouse daily targets**. No new mirrors. Ratios computed at read; default filter `traffic_quality_flag='clean'`; CH column names stable for the dashboard join.

## 10.1 The nine mirrors (unchanged — restated as binding)

`leadgen_analytics_offer` · `leadgen_analytics_section` · `leadgen_analytics_answer_distribution` · `leadgen_analytics_quote` · `leadgen_analytics_quote_drilldown` · `leadgen_analytics_auction` · `leadgen_analytics_auction_drilldown` · `leadgen_analytics_carrier` · `leadgen_analytics_provider_diagnostics`.

## 10.2 Event producer coverage (every type gets a producer — the fix closes the 29/31 gap)

| Producer | Events | Phase |
|---|---|---|
| Runtime engine (client beacons → `/lg/track`) | `quote_view`, `section_view`, `answer_click`, `answer_change`, `answer_default_applied`, `validation_error`, `continue_click`, `section_continue`, `address_autofill`, `address_validation_success`, `address_validation_error`, `quote_complete`, `carrier_impression`, `offer_impression` | 1 |
| Opening-lander surface (only when a funnel is configured with an opening lander) | `opening_lander_view`, `opening_lander_cta_click` | 1 |
| Auction path (server, `serve-auction.ts`/engine — client never owns auction truth) | `auction_start`, `auction_offer_request`, `auction_offer_response`, `auction_offer_timeout`, `auction_offer_error`, `auction_carrier_eligible`, `auction_carrier_filtered`, `auction_filled`, `auction_unfilled` | 1 |
| Click resolver (server, existing at `click.ts:316`) | `carrier_click`, `offer_click` | exists |
| Redirect/funnel rules (server, where the rule triggers) | `redirect_rule_triggered`, `direct_offer_redirect` | 1 |
| Postback / revenue ingest (server: `postback.ts`, `revenue-ingest.ts` — emit stream events alongside the existing D1 rows if not already emitted) | `conversion`, `revenue_received` | 1 |

Producer-coverage test (Phase 5): a generated assertion that every member of `LEADGEN_EVENT_TYPES` appears in the producer map above with a passing emission test — adding a 32nd type without a producer fails CI.

## 10.3 Attribution ID chain (must persist end-to-end)

`session_id · page_view_id · funnel_attempt_id · quote_id · funnel_id · funnel_variant_id · section_id · question_id · answer_mapping_version · payload_schema_version · section_mapping_version · auction_config_version · auction_instance_id · auction_request_id · provider_request_id · auction_result_id · banner_render_id · offer_id · placement_id · carrier_key · click_id · conversion_id · revenue`.

Chain proof (Phase 5 integration test): one scripted funnel pass produces events where — `quote_view.session_id == … == conversion.session_id`; `auction_result_id` on `auction_filled` == on impressions == resolvable from `click_id`; `banner_render_id` links impressions↔clicks; `provider_request_id` joins `auction_offer_request/response` ↔ provider_request_log; `placement_id` on impressions/clicks equals the participating placement; revenue rows join back via `click_id`+`conversion_id`. Version fields non-empty wherever `05` §5.4 stamps them.

## 10.4 A/B integrity

`funnel_ab_test_id`, `funnel_ab_test_revision`, `variant_label`, `traffic_allocation_bp`, `assignment_reason` ride `/lg/config` (existing); the engine stamps them on every beacon; the session bucket recomputation stays edge/client-parity per §16.2 — the engine uses the existing `ab-hash.ts` client recomputation contract. A/B identity must survive: reload mid-funnel (sessionStorage restore), back-nav, auction, click.

## 10.5 Quality flags & privacy (unchanged, restated)

Server enrichment OVERRIDES client claims (ip/ua/device/os/browser/geo, `is_bot/is_internal/is_preview/traffic_quality_flag`); `tampered` is owned by the §19.1 auction path; raw answer PII stays suppressed (`answer_value_raw` forced empty — §30.3); GPC / `ko_optout=1` drop batches silently; preview mode (`data-lg-preview`) never beacons to production ingest.

## 10.6 Acceptance

All 31 types have tested producers; the §10.3 chain proof passes; 9 mirrors unchanged (schema diff test); admin analytics tiles that read impressions/answers/auction stats show non-zero from a scripted live pass; GA4 behavior untouched (existing GA4 spec still green).
