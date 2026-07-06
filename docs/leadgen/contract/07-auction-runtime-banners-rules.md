# LeadGen CMS — Contract 07 · Auction, Runtime, Banners & Rules (v2.3.7)

Covers **§18 Auction tab**, **§19 Auction runtime**, **§20 Banner builder**, **§21 Offer/carrier/rule system**. The engine is a fresh re-implementation of the reference-funnel auction (banned product name never appears in source).

## 18. Auction tab

### 18.1 Config (`leadgen_auctions`)
`auction_name`; `quote_id` (required attribution) + optional `funnel_variant_id`/`funnel_name` (issue 8); `auction_type` static|dynamic; `banner_design_id`; `winner_logic`; floor (§18.3); surfacing/backfill (§18.5–18.6); `remove_clicked_offers` + `removal_scope` (§18.7); `timeout_ms`; `carrier_normalization_version`.

### 18.2 Auction type
- **Static:** no provider request; Offers ordered by `static_order`/`static_bid`.
- **Dynamic:** collected data sent to participating Offers; bids/carriers parsed; winner logic; banners rendered; all logged. Static/CPL-bid Offers (`bid_source=static`) that still call the API are **surfaced alongside** the CPC winner by bid desc when `surface_static_bid_offers=1` (CPL-merge default), deduped by `carrier_key`.

### 18.3 Floor (issue 17 — explicit type; UI labels match)
`floor_type` + `floor_value`:
- `percentage_of_max` — `floor = maxBid × (floor_value/100)`. UI label: **"Floor (% of top bid)"**, value input suffixed `%`.
- `absolute_bid` — `floor = floor_value` (currency). UI label: **"Floor (minimum bid)"**, value input prefixed with the currency.
Carriers with `bid < floor` are below-floor (available only for backfill), not qualified. The reference-funnel default is `percentage_of_max`, `floor_value=10`.

### 18.4 Winner logic (normative)
Per Offer, eligible carriers = passed floor + carrier rules; bids USD-normalized (`leadgen_fx_rates`). `highest_bid` = highest single carrier bid; `average_bid` = highest per-Offer mean; `sum_bids` = highest per-Offer sum. **Tie-breakers:** higher eligible sum → more eligible carriers → lexicographically smaller `offer_public_id`. Zero/invalid/missing bids parse to 0 and are excluded from avg/sum (all-zero Offer = `no_bid`).

Worked example (`percentage_of_max`, `floor_value=10`): X[A 12, B 3], Y[C 9, D 8, E 7.5], Z[F 11] → highest_bid→X, average_bid→Z, sum_bids→Y.

### 18.5 Multi-offer + surfacing + limits (issue 18)
`multi_offer`: `disabled` (winner only) | `enabled` (all carriers, bid order) | `enabled_unique` (all, deduped by `carrier_key`). Hard limits enforced during surfacing: `max_carriers_per_offer`, `max_total_carriers`, and `banner_slots_count` (rendered slots). `render_mode`: `all_at_once` | `progressive`.

### 18.6 Backfill (issue 18 — precise)
`backfill`: `disabled` | `enabled` | `enabled_unique` (dedupe by `carrier_key`). `backfill_source_offer_id` = designated source (NULL → all remaining Offers in bid order). `backfill_trigger`: `on_slot_exhaustion` | `on_click` | `on_dismiss`.
**"Exhausted" (normative):** at a trigger point, the number of eligible **and** unique (by `carrier_key`) carriers remaining — after rules, caps, floor, and already-rendered/clicked removal — is **less than** the number of empty banner slots (`banner_slots_count` minus rendered-unclicked). Backfill fills empty slots up to `max_total_carriers`; when no eligible+unique carrier remains and slots are empty, the auction is **unfilled** (reason `all_carriers_shown`).

### 18.7 Remove-clicked (issue 21)
`remove_clicked_offers` + `removal_scope` (default **`offer`** — a click suppresses the whole clicked Offer, not just one carrier; `carrier` suppresses only that `carrier_key`). Tracked in `leadgen_session_clicked_offers` (`carrier_key NOT NULL DEFAULT ''`, `''` when scope=offer). Consulted on backfill + subsequent instances in the session.

### 18.8 Carrier identity (issue 20 — normative)
Every parsed carrier gets a `carrier_key` used for `enabled_unique`, `backfill_unique`, and all carrier analytics:
- `carrier_key_source`: `provider_id` (provider supplied a stable id) | `slug` (derived) | `slug_logo` (slug + logo hash).
- `carrier_key`: the provider id if present; else `slug(carrier_name)` = lowercase, trim, non-alphanumerics→`-`; `+` first-8 hex of SHA-256(logo_url) when disambiguation needed.
- `carrier_normalization_version` (on the auction) versions the algorithm so a change is auditable and doesn't silently merge history.

### 18.9 Auction analytics
`auctions = countDistinct(auction_instance_id)` (issue 22). Metrics: impressions (`carrier_impression`), `avg_imp_per_auction`, `avg_bid` (bid_value_sum/eligible_bid_count), `avg_rpc`, `avg_clicks_per_auction`, `fill_rate`, `unfilled_rate`, `timeout_rate`, `below_floor_rate`, `malformed_response_rate`, `no_bid_rate`, `carrier_ctr`, `revenue`, `average_latency`, `provider_error_rate` — all NULLIF-guarded, ratios at read. Reasons come from dedicated columns (issue 31), never encoded in `answer_value_normalized`.

## 19. Auction runtime

`POST /lg/auction` (after the last section by position — issue 10):
```
 1. Validate anti-tamper binding (§19.1): funnel_attempt_id, section_order_hash, signed session/config
    binding, answer_mapping_version(s), auction_config_version. Reject on mismatch.
 2. Mint auction_instance_id (+ auction_result_id 1:1).
 3. Gather + re-normalize answers server-side (never trust client values).
 4. Evaluate funnel rules (redirect/skip/disqualify/auction_entry).
 5. Evaluate OFFER-LEVEL auction rules (answer-based include/exclude — issue 4) + Offer region rules + caps → candidate Offers (+ chosen placement).
 6. For each dynamic candidate: build payload (schema+maps+transforms+cleanObject), mint provider_request_id.
 7. Send provider requests in parallel with timeout (auction_request_id groups them); log redacted + debug_ref.
 8. Parse each response → COMMON Carrier fields via the Offer's carrier_parse_json (issue 19); assign carrier_key.
 9. Apply floor (§18.3) → eligible/below-floor.
10. Apply CARRIER-LEVEL rules (device/geo/answer/carrier_key). Record carrier_filtered_reason.
11. Winner logic (§18.4) + surface static/CPL-bid Offers by bid (§18.2).
12. Apply multi_offer + limits (max_carriers_per_offer/max_total_carriers/banner_slots_count).
13. Apply remove-clicked (removal_scope).
14. Render banners (banner design + field map) → banner_render_id; carrier_impression per slot.
15. Backfill on trigger (§18.6) → additional banner_render_id.
16. Click → GET /lg/lc → resolve URL (+ {response:*}, issue 7) → mint click_id → carrier_click/offer_click.
17. Provider revenue matches by click_id (§25); S2S with value×value_multiplier (§26).
```
Non-blocking writes on `ctx.waitUntil`.

### 19.1 Anti-tampering (issue 23)
`/lg/auction` requires a request body carrying: `funnel_attempt_id` (minted on `quote_view`), `section_order_hash` (hash of the ordered section public-ids the client was served), a **signed binding** (HMAC over `{funnel_variant_id, funnel_attempt_id, session_id, auction_config_version}` using a server secret, issued by the no-store /lg/attempt endpoint, never the cacheable /lg/config), the `answer_mapping_version` per section, and `auction_config_version`. The server recomputes/validates each; any mismatch (stale config, reordered sections, forged variant) ⇒ reject (422) + `traffic_quality_flag='tampered'`, no provider calls, no revenue.

### 19.2 Explainability
Per `auction_instance_id`: Offers considered / excluded (rule/cap/region + reason) / requested (payload + redacted headers) / responded (status/latency) / parsed carriers / carriers filtered (`carrier_filtered_reason`) / winner calc / final banners / `auction_unfilled_reason`. Surfaced by `/auctions/:id/simulate` (dry-run, no writes) and the recent `leadgen_provider_request_log`.

## 20. Banner builder / design registry
Banners render through a **banner visual design registry** (parallel to the funnel design registry; `banner_design_id`; unknown→default). Modes (`leadgen_auction_banners.mode`):
- **Manual:** static `banner_config_json` (headline/subheadline/logo/cta/legal).
- **Automatic:** the builder maps **only the canonical normalized Carrier fields**. Saved provider sample responses are used to configure each **Offer response parser** (`carrier_parse_json`), NOT to build raw auction-level mappings; every provider is normalized to the canonical Carrier shape first, then the one per-auction map applies. It maps the common normalized Carrier fields (issue 19) → banner slots via `field_map_json`. Because every provider response is normalized to the Carrier shape by the Offer's `carrier_parse_json` **before** the builder, banner mappings are **per-auction**, not per-provider-shape. Carrier fields: `carrier_key, carrier_name, carrier_logo, headline, subheadline, click_url, bid, bid_currency, tracking_id, disclaimer`. Missing `click_url` → resolve via the Offer `banner_url_template` + `{response:*}` (issue 7 / §10.5).

## 21. Offer / carrier / rule system
Two levels in `leadgen_auction_rules`:
- **Offer-level** (`rule_level='offer'`): participation, **including answer-based include/exclude** (moved here from the Offer modal — issue 4). E.g. "if `homeowner=false` exclude Offer X"; "if state=CA include_only Offer Y" (+`strictly_override`).
- **Carrier-level** (`rule_level='carrier'`): post-parse filtering by device/geo/answer/`carrier_key`/name (`carrier_match_json`).
Ordering: carrier **exclude** applied pre-floor (so excluded carriers don't set the floor); **include-only** applied post-winner. Region-block stays on the Offer (`leadgen_offer_region_rules`, issue 4).

### 21.4 Typed conditions (normative)
```jsonc
{ "groups": [
  { "field": "homeowner", "op": "eq", "value": false },
  { "field": "age", "op": "range", "from": 25, "to": 64 },
  { "field": "state", "op": "in", "values": ["CA","NY"] },
  { "field": "device", "op": "eq", "value": "mobile" }
] }
```
OR within a field, AND across fields. Ops `eq|neq|gt|lt|gte|lte|range|in|not_in`. Each rule stores `conditions_hash` (analytics `matched_rule_json_hash`) + `priority`; conflicts without deterministic priority flagged at save.
