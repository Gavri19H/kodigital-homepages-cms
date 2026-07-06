# LeadGen CMS — Contract 08 · Tracking, ClickHouse, D1 Mirror, Revenue, S2S, GA4 (v2.3.7)

Covers **§22 Tracking**, **§23 ClickHouse**, **§24 D1 mirror**, **§25 Provider revenue**, **§26 S2S**, **§27 GA4**. Full Athena/ClickHouse DDL in `infra/`; this is the normative column/event contract.

## 22. Tracking & analytics

### 22.1 Pipeline
`POST /lg/track` → Firehose `leadgen-events` → S3 `leadgen/events/` → Athena DB **`leadgen`** (`events`/`sessions`/`dead_letter_records`, `record_kind` discriminator, `dt` projection). Var `LEADGEN_EVENTS_FIREHOSE_STREAM`; AWS creds are secrets; absent ⇒ no-op. Do NOT create a Listicles Athena DB.

### 22.2 Event dimensions (normative; issue-driven additions in **bold**)
Identity/context: `event_id`, `event_type`, `timestamp`, `received_at`, `session_id`, `page_view_id`, `site_id`, `quote_id`, `quote_name`, **`funnel_id`**, **`funnel_name`**, `funnel_variant_id`, `funnel_ab_test_id`, **`funnel_ab_test_revision`**, `assignment_bucket`, `assignment_reason`, **`funnel_attempt_id`**, **`section_order_hash`**.
Section/question: `section_id`, `section_name`, `section_index`, `question_id`, `question_key`, `answer_id`, `answer_value_normalized`, `answer_value_raw`(safe/allowed only), **`answer_source` ∈ `default_applied`|`user_selected`|`user_confirmed_default`**, `continue_mode`, `continued_to_next_section`, **`section_mapping_version`**, **`answer_mapping_version`**.
Auction/provider (issue 22 IDs): **`auction_config_id`**, **`auction_config_version`**, **`auction_instance_id`**, **`auction_request_id`**, **`provider_request_id`**, **`auction_result_id`**, **`banner_render_id`**, `auction_type`, `winner_logic`, `offer_id`, `offer_name`, `placement_id`, `payload_schema_version`, `offer_type`, `provider`, **`carrier_key`**, **`carrier_key_source`**, `carrier_name`, `carrier_position`, `bid_value`, `bid_currency`, `bid_source`, **`carrier_filtered_reason`**, **`provider_error_reason`**, **`auction_unfilled_reason`**.
Monetization: `click_id`, `conversion_id`, `revenue`, **`booking_trigger`**.
Acquisition/client/geo: `utm_*`, `traffic_source`, `placement`, `cpc`, `fbc`, `fbclid`, `sub1..5`, `device`, `os`, `os_version`, `browser`, `browser_version`, `country`, `state`, `city`, `zip`, `ip`, `ua`, `url`, `referer`, `language`.
Quality: `is_bot`, `is_internal`, `is_preview`, `traffic_quality_flag` (incl. `tampered`, §19.1).
**Reasons are dedicated fields (issue 31) — NEVER encoded in `answer_value_normalized`.**

### 22.3 Event types
`quote_view`, `opening_lander_view`, `opening_lander_cta_click`, `section_view`, `answer_click`, `answer_change`, `answer_default_applied`, `continue_click`, `section_continue`, `validation_error`, `address_autofill`, `address_validation_success`, `address_validation_error`, `quote_complete`, `auction_start`, `auction_offer_request`, `auction_offer_response`, `auction_offer_timeout`, `auction_offer_error`, `auction_carrier_eligible`, `auction_carrier_filtered`, `auction_filled`, `auction_unfilled`, `carrier_impression`, `carrier_click`, `offer_click`, `conversion`, `revenue_received`, `redirect_rule_triggered`, `direct_offer_redirect`.

### 22.4 Macros
32 canonical + `{response:<path>}` with required/optional behavior (§10.5). Same validation (`macros.ts`); no banned name in source.

### 22.5 Accuracy
`event_id` idempotency; `page_view_id` impression dedupe; every funnel event carries `funnel_id`/`funnel_name`/variant/`assignment_bucket`; config versions stamped (`answer_mapping_version`, `section_mapping_version`, `payload_schema_version`, `auction_config_version`); auction IDs persist across the chain; provider-txn dedupe; `sendBeacon`/`keepalive` + retry + dead-letter; raw PII suppressed by default.

## 23. ClickHouse aggregation (`lg_*`)
External Athena→CH ingest (ops-owned). Worker only reads CH to fill D1 mirrors. Conventions: `ReplacingMergeTree`, `PARTITION BY toYYYYMM(dt)`, `LowCardinality`, `REFRESH EVERY 2 MINUTE ... TO`, explicit `AS` aliases, `clean`-only default views, ratios at read. Stable column names for the dashboard join (`traffic_source/utm_*/placement/click_id/offer_id`).

Tables (see `infra/clickhouse-ddl.sql`): `lg_events_raw` (+ `funnel_id`, `auction_instance_id`, `carrier_key`, `answer_source`, `*_reason`, mapping versions), `lg_sessions`, `lg_revenue_raw` (+ `booking_trigger`), `lg_revenue_attributed`, and daily MVs → `lg_offer_daily`, `lg_section_daily` (+ `continued`/`default_applied`/`user_confirmed_default`), `lg_answer_distribution_daily` (+ `continued_count`, 3-way `answer_source`), `lg_quote_daily`, **`lg_quote_drilldown_daily`** (funnel×site×source×device×state×section×question×answer — issue 30), `lg_auction_daily` (`auctions = uniqExact(auction_instance_id)` — issue 22), **`lg_auction_drilldown_daily`** (+ `carrier_filtered_reason`/`provider_error_reason`/`auction_unfilled_reason` — issues 30/31), `lg_carrier_daily` (keyed by `carrier_key` — issue 20), `lg_provider_diagnostics_daily` (+ `provider_error_reason`).

## 24. D1 analytics mirroring
`syncLeadgenAnalytics(env)` on the every-minute cron (own try/catch, fail-open). Reads each `lg_*_daily` (FINAL, bounded window) → `ON CONFLICT DO UPDATE` upsert into the **9** `leadgen_analytics_*` mirrors (§7.5): offer, section, answer_distribution, quote, quote_drilldown, auction, auction_drilldown, carrier, provider_diagnostics. Batch ≤80 rows; coerce/skip bad rows; `offer_id`→`offer_public_id`. CMS reads from D1; dashboard reads CH+D1.

## 25. Provider revenue ingestion + booking rules (issue 27)
Channels: real-time auction API; S2S postback (`/lg/pb/:provider`, token-gated `LEADGEN_PB_TOKEN_<PROVIDER>`, dedupe `(provider,external_txn_id)`); provider API pulls; scripts/imports; browser pixel (`/lg/px`, dedupe `leadgen_conversion_log`). All normalize into `leadgen_revenue_raw` → CH.

**Booking by `offer_type` × `conversion_tracking_method` (`booking_trigger`):**
- **CPC** — books on **click** *only if* the Offer/auction is explicitly configured to (`booking_trigger='click'`, e.g. a CPC feed that pays per click); otherwise waits for a conversion signal.
- **CPL / CPA / CPI** — book on **conversion** (postback/API/script), `booking_trigger='conversion'` — never on click — **unless** the conversion is an explicit **in-site** event (`source='in_site'`), which books immediately via the deduped conversion log.
Attribution by `click_id` → offer/carrier(`carrier_key`)/auction(`auction_instance_id`)/quote/funnel/site/source. Unmatched click_id queue (72h re-match), FX normalization, UTC `dt`, late-arriving backfill via the attribution MV, provider-total reconciliation (§29).

## 26. S2S / media platforms (issue 26 keys handled in §30)
`leadgen_media_platforms` (per platform: enabled, `postback_url_template`, `auth_secret_ref`, `event_name`, **`value_multiplier`**). On a matched conversion: match platform by `traffic_source`; resolve macros; **report `{value}` = revenue × `value_multiplier`** (the reference `fb_multiplier`); derive `fbc` from `fbclid`; fire on `waitUntil`; KV dedupe `(platform, click_id, event_name, conversion_id)`. Disabled row fires nothing; absent secret ⇒ tokenless per template.

## 27. Browser-side pixel (issue 28)
For `conversion_tracking_method='browser_side_pixel'`: a config (`pixel_id`, `event_name`, `value_source`) drives a client pixel/script. **Firing point:** on the in-site conversion event (or the configured post-click confirmation). **Dedupe:** `leadgen_conversion_log` `(click_id, dedupe_key)` — a replay is a no-op. **Cap:** increments `conversion_count` only when the booking row is newly created. **CSP/consent:** the pixel loads only after consent (if the site enforces it); the funnel shell's CSP allowlists the pixel host; no inline secrets. **GA4/dataLayer:** the pixel pushes to the site's existing `dataLayer` without overwriting it; independent of `/lg/track` (§28-GA4). Distinct from a server S2S postback (§26) — both may fire for the same conversion but the KV/`conversion_log` dedupe prevents double-booking.

**Full definition (issue 13/23):** *Storage* — pixel config (`pixel_id`, `event_name`, `value_source`) on the Offer; fires client-side. *Firing point* — the in-site conversion event (or configured post-click confirmation). *conversion_id* — client-generated stable id; carried on the event and into `leadgen_conversion_log.dedupe_key`. *Dedupe* — `(click_id, dedupe_key)` UNIQUE; a replay is a no-op. *Cap increment* — `conversion_count` increments only when the booking row is newly created (never on replay). *Consent/CSP* — the pixel loads only after consent (if the site enforces it); the funnel shell CSP allowlists the pixel host; no inline secrets. *GA4/dataLayer* — pushes to the site’s existing `dataLayer` without overwriting it; independent of `/lg/track`. *S2S conflict* — if a server S2S postback (§26) also fires for the same conversion, the shared `conversion_id` + `leadgen_conversion_log` + the S2S KV dedupe key `(platform, click_id, event_name, conversion_id)` guarantee the platform is notified at most once.

## 28. GA4 validation
Funnel shell loads the site's existing GA4 (measurement id from settings) unchanged; `/lg/track` never strips `window.dataLayer`/`gtag`. Tests: `dataLayer` exists + grows (not reset); `gtag('config', <site id>)` fires; no GA4 console errors on the funnel; the LeadGen path preserves GA4 on a GA4-configured site.

## 24b. Public config DTO (issue 24 — `/lg/config`)
`/lg/config/:funnel_variant_id` returns **only**: `funnel_id`, `funnel_name`, `quote_id`, `funnel_design_id` + resolved design tokens, ordered **sections** (public content + component types + client validation rules + `question_key`/`internal_field` + `answer_source` defaults), `section_order_hash`, the per-attempt token from no-store /lg/attempt (§24c) — NOT returned by /lg/config, A/B `assignment_reason`, GA4 measurement id, and public copy. It **NEVER** returns: provider endpoints, `api_token_secret_ref`/secret headers, `bid_source`/bid strategy, raw payload schemas, `carrier_parse_json`, auction rules, region rules, or any secret. The auction runs server-side (`/lg/auction`); the client only posts collected answers + the signed binding.

```ts
// /lg/config/:funnel_variant_id response (public). Server-only fields are NEVER included.
interface LeadgenPublicConfig {
  quote_id: string; funnel_id: string; funnel_name: string; funnel_variant_id: string;
  funnel_ab_test_id: string; funnel_ab_test_revision: number; assignment_reason: string;
  funnel_design_id: string; design_tokens: Record<string, unknown>;   // resolved visual design only
  section_order_hash: string;   // the session-specific signed_config_token is NOT here — fetched from no-store GET /lg/attempt (§24c)
  ga4_measurement_id: string | null;
  sections: Array<{
    section_public_id: string; section_index: number; headline: string; subheadline?: string;
    components: Array<{ type: string; question_key?: string; internal_field?: string;
      answer_type?: string; props: Record<string, unknown>; client_validation?: Record<string, unknown>;
      default_answer?: { value: unknown; answer_source: "default_applied" } }>;
    continue_mode: "button" | "auto_advance"; address_validation_enabled: boolean;
    section_mapping_version: number; answer_mapping_version: string;
  }>;
}
// STRIPPED (server-only, never sent): endpoint_production/staging, api_token_secret_ref, secret headers,
// bid_source / calls_provider_api / static_bid_value / winner_logic / floor_*, schema_json,
// carrier_parse_json / carrier_parse_version, leadgen_auction_rules, leadgen_offer_region_rules,
// payload builder internals, provider names, placement ids, any secret ref.
// EXCEPTION (client-mode Offers, §10.3): a `client_safe_provider_request_config` MAY be included
// (CORS-safe https endpoint + non-secret params only, NEVER a token/secret) so the browser can make
// the call; server-mode Offers expose nothing. If client-mode is deferred, mark it FUTURE.
```

### 24c. Per-attempt binding — `GET /lg/attempt` (no-store)
The **signed_config_token** and `funnel_attempt_id` are **session-specific** and MUST NOT sit in the cacheable `/lg/config`. A separate **`GET /lg/attempt`** (`no-store`) mints/returns `{ funnel_attempt_id, signed_config_token }` per session on first funnel view; the client sends both to `/lg/auction` (§19.1). `/lg/config/:funnel_variant_id` stays fully cacheable (no per-session data).
