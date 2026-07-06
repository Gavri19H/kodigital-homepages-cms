# LeadGen CMS — Contract 09 · Performance, Data Accuracy & Security (v2.3.7)

Covers **§28 Performance / caching**, **§29 Data accuracy / reconciliation**, **§30 Security / auth / secrets / PII**.

## 28. Performance & caching

Funnels are paid-traffic landing pages — performance is a hard requirement. **Cache target ≈ 99.99%** for the static shell.

- **Static funnel shells** are pre-rendered/cached per `funnel_id` + `content_version` + `LEADGEN_TEMPLATE_VERSION` in KV (`env.CACHE`) with an optional Cache-API bridge, reusing the CMS key discipline (`site_id` first, versions as suffix). Namespaces: `lg-shell:{site_id}:{quote_slug}:{funnel_id}:{content_version}:{template_version}`, `lg-config:{funnel_id}:{content_version}`, `lg-section:{section_public_id}:{content_version}:{template_version}`.
- **A/B assignment** is a small deterministic edge/client hash (§16.2) — the shell is cached per variant, never a per-request origin render.
- **Answers** live in session/local state + the event stream; not written to D1 per keystroke. The server re-derives normalized answers at auction time.
- **The auction is the only required monetization-time synchronous dynamic call after the cached funnel shell loads.** Other dynamic calls are isolated: `/lg/attempt`, Google Maps only on address sections, client-mode provider requests only when explicitly configured, click resolver after click, and tracking/pixels async or no-store. Provider requests run in parallel with `timeout_ms` (`Promise.race` + `Promise.allSettled`); a slow provider is dropped at timeout and never blocks render.
- **Media** lazy-loaded; **no layout shift** (presets set fixed geometry); first interaction fast (defer non-critical JS); funnel runtime JS kept small (< 40 KB gzip, excluding the Maps SDK which loads only on sections that need it).
- **Cache headers:** shell + `lg-config` `public, max-age=300, stale-while-revalidate=86400` + ETag + nosniff; `/lg/track`, `/lg/auction`, `/lg/lc`, `/lg/pb`, `/lg/px` are `no-store`. **Version axes:** global `LEADGEN_TEMPLATE_VERSION` (shell-shape change → rolls all funnels forward) + per-variant `content_version` (running variants fork instead). Activation warms the shell cache; deactivation invalidates it (`invalidateOnQuoteActivation` / `invalidateOnVariantPublish`, per-`site_id` list+delete).
- **Budgets:** shell cache-hit TTFB < 200 ms at edge; LCP < 2.5 s on 4G mobile; CLS = 0; auction P95 bounded by `timeout_ms` + parse.

## 29. Data accuracy & reconciliation

- **Idempotency + dedupe:** `event_id` idempotency; `page_view_id` dedupes impressions (a `carrier_impression`/`section_impression` counts once per page view). In-site conversions dedupe on `(click_id, dedupe_key)` (`leadgen_conversion_log`); provider postbacks on `(provider, external_txn_id)` (`leadgen_postback_log`). A conversion with no stable dedupe key is **never booked** (the analytics event still emits).
- **Unmatched + late revenue:** postbacks whose `click_id` has no matching click land in `leadgen_revenue_unmatched` (`pending`), re-matched for 72 h → then `unattributed`; the attribution MV re-aggregates the bounded rolling window so late revenue is picked up; `rebuildRange` backfills wider windows.
- **Normalization:** FX (`leadgen_fx_rates` → `revenue_usd`); UTC `dt`; caps use the Offer's `cap_timezone`.
- **Reconciliation (daily cron, self-gated, fail-open):** Athena ↔ CH ↔ D1 clean-event counts for `dt = yesterday` (drift feeds the dashboard `ingestion_failed`/`revenue_gap` alerts); provider-total reconciliation (summed `leadgen_revenue_raw` per provider/day vs provider-reported totals). Events failing durable delivery → `leadgen_event_dead_letter` (+ S3 dead-letter prefix), queryable.
- **Traffic quality:** every event/session carries `is_bot`, `is_internal`, `is_preview`, `traffic_quality_flag` (incl. `tampered`, §19.1). Default analytics (all `lg_*_daily` MVs + D1 mirrors) filter `traffic_quality_flag = 'clean'`; a raw unfiltered audit view is retained. Preview/simulate traffic is flagged and never books revenue.
- **Config-version stamping:** `answer_mapping_version`, `section_mapping_version`, `payload_schema_version`, `auction_config_version`, `funnel_id`/`content_version` stamped on the relevant events so every metric attributes to the exact config that produced it, and a config change never silently corrupts a running comparison. **Reasons are dedicated event/mirror fields** (`carrier_filtered_reason`, `provider_error_reason`, `auction_unfilled_reason`) — never encoded in `answer_value_normalized` (issue 31).

## 30. Security / auth / secrets / PII

### 30.1 Auth + host isolation (inherited, MUST NOT weaken)
`/admin/leadgen*` + `/api/admin/leadgen/*` gated by the existing Cloudflare Access `accessAuth`; served **only on `ADMIN_HOST`** (any other host → flat 404, `no-store`, `noindex`); all admin responses `private, no-store` + nosniff. `/lg/*` runtime is public on tenant hosts (same trust boundary as the public content router); `/lg/pb/:provider` is token-gated per provider.

### 30.2 Secrets
All credentials are **encrypted wrangler secrets**, resolved by `readEnvSecret(env, name)`, masked after save, **never returned to the frontend**; absent secret ⇒ that leg no-ops. Secrets:
- `LEADGEN_PB_TOKEN_<PROVIDER>` — inbound postback shared secret per provider (absent ⇒ 401, never silently accepted).
- `LEADGEN_S2S_TOKEN_<PLATFORM>` — outbound S2S token per media platform (absent ⇒ `{auth_token}` resolves empty).
- Per-Offer provider API tokens — referenced by `api_token_secret_ref` / header `secret_ref` (the secret **name** only lives in D1).
- **Google Maps — split keys (issue 26):** `GOOGLE_MAPS_BROWSER_KEY` (a **referrer-restricted** browser key, injected per-request into the funnel shell for Places Autocomplete — never a server key, never long-lived in cache) and `GOOGLE_MAPS_SERVER_KEY` (server-side Address Validation / geocode only; **never enters the cached shell HTML**). Client-mode Offers (§10.3) reference no secret at all.

### 30.3 PII / log redaction (issue 25)
- Provider request/response logs are **redacted by default**. `leadgen_provider_request_log` stores, for admin view: `request_headers_redacted_json` (secrets → `[REDACTED]`), `request_payload_redacted_json` and `response_redacted_json` (PII hashed or removed), and `parsed_carriers_json`. The **full** request/response is stored **only** as an encrypted-at-rest blob (R2/KV) referenced by an opaque `debug_ref`; every `debug_ref` read is **access-audited**.
- **Postback payloads** are likewise stored as `payload_redacted_json` + `debug_ref` (never raw PII in the admin-visible column).
- **Raw answer PII / free-text** is suppressed from the event stream by default (only normalized/hashed values); an explicit, audited allow-flag is required to emit raw. Google-Maps-normalized address fields are **payload-only**, not analytics dimensions.
- **Retention:** redacted `leadgen_provider_request_log` rows pruned after 7 days; encrypted `debug_ref` blobs after 72 h; `leadgen_session_clicked_offers` after 24 h. A bounded cron performs the prune.
- **PII hashing** (S2S/CAPI): email/zip/country/name hashed SHA-256 (lowercased, trimmed) before dispatch; access tokens redacted in all logs.

### 30.4 Public surface + runtime hardening
- **`/lg/config` DTO (issue 24)** returns only static public funnel content + design tokens + `section_order_hash` + GA4 id (NO `signed_config_token`, NO `funnel_attempt_id` — those come from no-store `/lg/attempt`, §24c) (full allow/deny list in §24b). It **never** exposes provider endpoints, token refs, `bid_source`/bid strategy, raw payload schemas, `carrier_parse_json`, or secret headers. The auction runs server-side.
- **`/lg/auction` anti-tampering (§19.1):** validates `funnel_attempt_id`, `section_order_hash`, the HMAC-signed session/config binding, `answer_mapping_version`(s), and `auction_config_version`; any mismatch ⇒ 422 + `traffic_quality_flag='tampered'`, no provider calls, no revenue.
- **Runtime request guard** on `/lg/auction` + `/lg/pb`: blocklist → rate limit → bot detection → diagnostic log, before any provider fetch or money write; ZIP validated `/^\d{5}$/`. Fallback/backfill carriers are XOR-obfuscated in the HTML (cosmetic).
- **All admin writes validated server-side**; all runtime answers re-normalized + re-validated at auction time; macros validated at save (no host-position macros, no control chars, unknown rejected).

### 30.5 Guardrails
LeadGen source (files, comments, constants, tests, token metadata) contains **no banned product name** — the design lineage is `reference-funnel` / `default-funnel` in source; only docs prose cites the reference for grounding. Additive migrations only; forward-only; the implementation agent never runs `wrangler deploy` / `secret put`. Nothing existing (CMS / Listicles / GA4) is broken.
