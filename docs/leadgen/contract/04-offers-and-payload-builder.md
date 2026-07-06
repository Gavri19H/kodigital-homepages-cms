# LeadGen CMS — Contract 04 · Offers & Dynamic Payload Builder (v2.3.7)

Covers **§10 Offers tab** and **§11 Dynamic payload builder**.

## 10. Offers tab
Global monetization unit. Tab: Create / Manage / Analyze. `Create an Offer` (top-left) opens a **modal** for required business fields (issue 6); the advanced payload / Test / rules editors open **after** the draft Offer is created.

### 10.1 Create-Offer modal — business fields (issue 6)
**Required:** `offer_name`, `activity`, `vertical`, `conversion_tracking_method` (`s2s_postback`|`browser_side_pixel`|`script`), `offer_type` (`cpc`|`cpl`|`cpa`|`cpi`), at least one **placement** (`leadgen_offer_placements`; provider placement/feed id — issue 29), `calls_provider_api` (toggle), `bid_source` (`response`|`static`), `cap_enabled` (toggle).
**Optional:** `tag`, `provider`, static bid fields.
On **Create**, a draft Offer + its default placement are saved; the editor then opens with tabs: **Payload** (§11), **Request** (headers/endpoints/token/execution mode), **Test**, **Region rules** (§10.4), **Cap**, **Analytics**. The heavy config is never crammed into the create modal.

### 10.2 Bid model — three Offer kinds
Two flags: `calls_provider_api` (does it call a provider at auction time?) and `bid_source` (`response` = bid from the provider response, CPC; `static` = admin fixed bid). Kinds: **CPC dynamic** (`calls_provider_api=1`,`bid_source=response`); **CPL** (`calls_provider_api=1`,`bid_source=static` — calls the API for carriers/slug, bid is the admin value, URL is response-derived e.g. `sub5={response:slug}`); **pure static** (`calls_provider_api=0`,`bid_source=static`,`banner_url_template`).

### 10.3 Request execution mode (issue 5)
`request_execution_mode` on the Offer, distinct from `conversion_tracking_method`:
- **`server`** (default): the Worker makes the provider request; secrets/token resolved server-side; full payload builder + Test available.
- **`client`**: the request runs in the browser (some providers require a client-side call). **No secret is ever exposed** — client mode Offers may not reference an `api_token_secret_ref` or a `secret_ref` header; the endpoint must be CORS-enabled and validated as browser-safe at save (scheme https, no wildcard secret headers, response parsed client-side then posted back for scoring). This is **not** the `browser_side_pixel` conversion method (post-click tracking, §28). **Reconciliation with `/lg/config`:** for a client-mode Offer, `/lg/config` includes a `client_safe_provider_request_config` (endpoint, method, non-secret headers, CORS-safe metadata — NO token/secret) so the browser can make the call; server-mode Offers expose nothing. (If client mode is deferred, mark it FUTURE — it is not contradictory either way.)

### 10.4 Offer rules = provider region-block ONLY (issue 4)
The Offer modal/editor carries **region-block** rules (`leadgen_offer_region_rules`): `dimension` ∈ country|state|city|zip, `action` ∈ include_only|exclude|allow_list|block_list, `values_json`. Examples: "exclude when state=CA"; "include_only when ZIP ∈ list". **Answer-based include/exclude lives in Auction rules** (§21, offer-level). An Offer-level answer default is **advanced / not the v1 main path** and, if used, is treated as an auction-rule default.

### 10.5 Banner URL + response macros (issue 7)
When no dynamic click URL is returned, `banner_url_template` resolves the 32 canonical macros + `{response:<dotted.path>}` from the winning Offer's parsed response. **Required vs optional response macros:**
- Author marks each `{response:path}` **required** or **optional** (a `?` suffix = optional, e.g. `{response:slug}` required, `{response:promo?}` optional).
- **Required missing** at runtime ⇒ the carrier is **dropped** (not rendered), `carrier_filtered_reason='missing_required_response_field'`, logged — it never silently resolves to empty.
- **Optional missing** ⇒ resolves to the configured `safe_fallback` for that macro (default empty), and the carrier still renders.
Validation guards unchanged: absolute http(s), no macro in host/authority, no control chars, unknown canonical macros rejected. The Test tool lists discovered response fields as macro chips and flags required macros with no source.

### 10.6 Cap
`cap_enabled` → `cap_amount`+`cap_timezone`+`cap_count_by`; enforced synchronously (`leadgen_offer_cap_counters`) before the Offer joins the auction / before a static redirect; on cap → `cap_fallback_offer_id`/`cap_fallback_url` or drop.

### 10.7 Offer analytics
From `leadgen_analytics_offer`: `offer_impressions, clicks, unique_clicks, conversions, ctr, cvr, revenue, rpc, rpm` — ctr=clicks/impressions, cvr=conversions/clicks, rpc=revenue/clicks, rpm=revenue/impressions×1000 (NULLIF-guarded). **Offer impressions = `offer_impression`, deduped by `(auction_instance_id, offer_id)`** (§6.4) — one per Offer per auction run; `ctr = clicks / offer_impressions`. Carrier analytics impressions = `carrier_impression` (exact slot).

## 11. Dynamic payload builder
When `calls_provider_api=1`: **Manual Builder** + **Automatic Generation**, producing a versioned immutable `leadgen_offer_payload_schemas` row.

### 11.1 Manual builder
Visual field tree (no raw JSON required): nested objects/arrays; per-field name/label/type (`string|number|boolean|enum|object|array`); required/optional; `valid_values`; default/fallback; **source** (`answer`|`static`|`computed`|`macro`|`token`); map to a Section internal field + `value_map` + transform pipeline; conditional show/hide. Panels: live JSON preview, validation panel, "Test with sample answers", copy, advanced raw-JSON (optional).

### 11.2 Automatic generation
Paste an example provider payload → infer structure/types/paths → editable schema (mark enum/free-text/required/optional, add mappings) → save version. Never locks.

### 11.3–11.4 Headers / endpoints / token
Headers with `value_kind` static|macro|secret_ref (secret = wrangler name, masked). `endpoint_production` (+ optional staging). Token placement header|payload|query via `api_token_secret_ref`+`api_token_param_name`, resolved server-side only (server mode); **client-mode Offers cannot use secret tokens**.

### 11.5 `schema_json` shape (normative)
```jsonc
{ "version": 3, "root": { "type":"object", "children": [
  { "path":"data.home_own", "name":"home_own", "type":"boolean", "required":true,
    "source":"answer", "internal_field":"homeowner", "value_map":{"true":true,"false":false} },
  { "path":"meta.click_id", "name":"click_id", "type":"string", "source":"macro", "macro":"click_id" },
  { "path":"auth.api_token", "name":"api_token", "type":"string", "source":"token" }
] } }
```
Runtime build: resolve each node by source (answer via maps+value_map+transform; static; computed; macro; token), apply default/fallback, drop unmet `conditional`, then `cleanObject` (recursively drop empty) — the "no fabrication" rule. Token node injected only when `api_token_placement='payload'` (server mode).

### 11.6 Test tool
`POST /api/admin/leadgen/offers/:id/test {environment, sample_answers}` — server-side (protects secrets): builds payload, sends with resolved headers/token, returns exact payload, response, status, latency, **masked** headers, parsing errors, extracted carriers, and available response fields (for macro chips). Persists `sample_response_json` (used to configure this Offer’s response parser `carrier_parse_json` → canonical Carrier fields; the automatic banner builder maps canonical fields only, never raw provider shapes); writes a redacted `leadgen_provider_request_log` row (+ encrypted `debug_ref`).

### 11.7 Response parsing → common Carrier (issue 19)
The Offer's `carrier_parse_json` normalizes the provider response into the **common Carrier shape** (`carrier_key, carrier_name, carrier_logo, bid, bid_currency, click_url, tracking_id, headline?, subheadline?, disclaimer?, pricing_model`) **before** the auction/banner layer sees it. Parsing failures increment `malformed_response_rate` and never throw into the auction.

### 11.8 Schema versioning + publish gate
Every save = a new immutable version (`public_id` = `payload_schema_version`, stamped on `auction_offer_request` events + answer-map rows). An Offer can't go live in a dynamic auction while its active schema has validation errors or an untested Test status.
