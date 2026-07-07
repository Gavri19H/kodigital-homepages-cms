# 04 · Runtime Context, Macros & Computed Contract (Phase 1 · R2, R3, R8, B3, M1; UI halves in Phase 2 · B5, B8, M2)

**Problem:** provider payloads, Test, click resolution, and banner URLs all depend on a runtime context that is never assembled (R2/R3/B3/R8). This section defines ONE canonical builder used everywhere.

## 4.1 Canonical context type (normative)

New file `api/src/leadgen/runtime-context.ts`:

```ts
export type LeadGenRuntimeContext = {
  session_id: string;
  page_view_id: string;
  funnel_attempt_id: string;
  quote_id: string;
  funnel_id: string;
  funnel_variant_id: string;
  auction_config_id?: string;

  request: { ip: string; ua: string; url: string; referer: string; language: string; };
  cloudflare: { country?: string; region?: string; state?: string; city?: string;
                postalCode?: string; timezone?: string; colo?: string; };
  traffic: { utm_source?: string; utm_medium?: string; utm_content?: string;
             traffic_source?: string; placement?: string;
             sub1?: string; sub2?: string; sub3?: string; sub4?: string; sub5?: string;
             cpc?: string; fbclid?: string; fbc?: string; };
  offer?: { offer_id?: string; offer_name?: string; placement_id?: string; };

  computed: Record<string, unknown>;   // populated from COMPUTED_REGISTRY (§4.4)
  macros: Record<string, string>;      // the 32 canonical macros, resolved (§4.3)
};
```

Builder: `buildLeadgenRuntimeContext(c: HonoContext, opts: { session_id, page_view_id, funnel_attempt_id, quote, funnel, variant, auction_config_id?, offer?, placement?, overrides? }): LeadGenRuntimeContext`. Pure given its inputs; `overrides` exists ONLY for the Test tool’s simulated context (B5) and is rejected on public routes.

## 4.2 Construction sources (binding)

| Context slice | Source |
|---|---|
| `request.ip / ua / referer / language / url` | `cf-connecting-ip`, `user-agent`, `referer` (accept `referrer` — M1), `accept-language` (first tag), full request URL |
| `cloudflare.*` | `request.cf`: `country`, `regionCode`→region/state, `city`, `postalCode`, `timezone`, `colo` — the SAME `readCfSignals` values the rules engine already reads (`serve-auction.ts:61–80`); bridged, not duplicated |
| `traffic.*` | URL query params of the funnel page (persisted into the attempt context at `/lg/attempt` time so auction/click see the ORIGINAL landing params, not the current URL); `fbc` derived from `fbclid` when absent (existing `fb.1.<ts>.<fbclid>` derivation) |
| `session_id / page_view_id` | `ko_sid` session cookie · client-minted page_view_id (beacon envelope); server paths use the values POSTed to `/lg/auction` after binding verification |
| `funnel_attempt_id, quote/funnel/variant ids` | `/lg/attempt` + resolved activation (`resolver.ts`) |
| `offer.*` | the Offer being built for: `offer_id`/`offer_name` from the participating Offer row; `placement_id` per §4.5 |
| `computed` | `COMPUTED_REGISTRY` resolvers over `(now, cloudflare.timezone)` (§4.4) |
| `macros` | projection table §4.3 — built LAST from the slices above |

## 4.3 Macro projection (32 canonical macros → context)

`leadgen/macros.ts` registry is unchanged (M1 adds alias `referrer→referer` at `MACRO_ALIASES`). Projection (`contextToMacros(ctx)`):

- **Request/Cloudflare:** `ip`←request.ip · `ua`←request.ua · `url`←request.url · `referer`←request.referer · `language`←request.language · `country`/`state`/`city`←cloudflare (state=regionCode)
- **Device (derived from UA once, shared with event enrichment):** `device`, `os`, `os_version`, `browser`, `browser_version` (reuse `parseClientUa`)
- **Traffic/URL:** `utm_source`, `utm_medium`, `utm_content`, `traffic_source`, `placement`†, `sub1`–`sub5`, `cpc`, `fbclid`, `fbc`
- **Session:** `session_id`, `click_id` (click-scoped; minted at `/lg/lc` only — empty elsewhere), `page`←pathname, `lander_v`←variant_label
- **Offer/Auction:** `offer_id`, `offer_name`
- † `placement` — see §4.5; the traffic-param `placement` is used ONLY when no Offer placement is in scope (documented in the UI help)

Unresolved-macro policy unchanged: canonical macro with no value → empty string, encodeURIComponent on substitution. `{response:*}` resolution stays in the click resolver (required-missing drops the carrier; optional→safe_fallback).

## 4.4 Computed variable registry (R3/B8)

New file `api/src/leadgen/computed.ts` — `COMPUTED_REGISTRY: Record<string, ComputedVar>` with `{ key, label, description, outputType, example, resolver(ctx) }`:

| key | label | outputType | example | resolver |
|---|---|---|---|---|
| `request_timestamp` | Request timestamp (s) | number | `1783468800` | `floor(now/1000)` |
| `request_timestamp_ms` | Request timestamp (ms) | number | `1783468800123` | `now` |
| `unix_timestamp` | Unix timestamp | number | `1783468800` | alias of request_timestamp |
| `iso_timestamp` | ISO-8601 timestamp | string | `2026-07-08T14:00:00.000Z` | `new Date(now).toISOString()` |
| `today_date_utc` | Today’s date (UTC) | string | `2026-07-08` | ISO date part |
| `current_date_utc` | Current date (UTC) | string | `2026-07-08` | alias of today_date_utc |
| `current_datetime_utc` | Current datetime (UTC) | string | `2026-07-08 14:00:00` | `YYYY-MM-DD HH:mm:ss` |
| `current_hour_utc` | Current hour (UTC) | number | `14` | UTC hour 0–23 |
| `current_hour_est` | Current hour (EST) | number | `9` | hour in `America/New_York` via Intl |
| `current_day_of_week_utc` | Day of week (UTC) | string | `wednesday` | lowercase English day |
| `current_day_of_week_est` | Day of week (EST) | string | `wednesday` | day in `America/New_York` |
| `timezone` | Visitor timezone | string | `Europe/Berlin` | `cloudflare.timezone ?? ""` |

Rules: registry is the ONLY source of computed keys. `payload.ts:402–404` validation changes from “any non-empty key” to typed error `computed_unknown_key` (message names the key + lists valid keys). Runtime: `ctx.computed[key] = resolver(ctx)` for every key referenced by the active schema (lazy, per-request `now` captured once so all fields agree). Admin UI (Phase 2): dropdown grouped “Computed”, each option `label — description (example)`; free text removed.

## 4.5 Placement ID source (B3)

- Payload fields may target the placement id via the existing `placement` macro AND a new discoverable source option “Offer / Auction → Placement ID” (stored as `source:"placement"`; `payload.ts:605–613` adds the case — storage enum extension, backward-compatible).
- **Auction runtime:** the PARTICIPATING placement — `leadgen_auction_offers.offer_placement_id` joined at `engine.ts:190–206` — is threaded into `buildPayload` ctx (`fetch.ts:198–207` passes it; today it reaches only logs at `:304`).
- **Offer Test:** the operator-selected placement; default = the Offer’s `is_default` placement (`offers-handlers.ts:372–378`). When an Offer has >1 placement, the Test tab MUST show a placement picker (pre-selected to default) — running Test without choosing is allowed only because the default is explicit in the UI.
- **Explainability:** provider_request_log + simulate trace record which placement id was used.

## 4.6 Click-time macro resolution (R8)

- **Persist at auction:** additive migration `0040_leadgen_runtime_context.sql` adds `macro_context_json TEXT NOT NULL DEFAULT '{}'` to `leadgen_auction_result_log` — a REDACTED snapshot (session/traffic/offer/computed-scoped macros; NO raw ip/ua stored — request-scoped values are re-derived) written by `persistAuctionResult`.
- **At `/lg/lc`:** `click.ts` builds macros = persisted snapshot ⊕ fresh request-scoped values from the click request (ip, ua, url, referer, language, device family, geo) ⊕ freshly minted `click_id` (existing) ⊕ `{response:*}` from the persisted parsed winner response (existing plumbing at `click.ts:242` gains the full map instead of `canonical_macros: {}` at `runtime-routes.ts:277`).
- Ordering: persisted values win for session/traffic/offer keys; fresh values win for request keys; `click_id` always fresh.

## 4.7 Consumption sites (all five MUST use the one builder)

1. **Provider payload build** — `auction/engine.ts:767–778` constructs ctx via the builder; `fetch.ts:173` stops defaulting to `{}` (absence is now a programming error → typed exclusion, never a silent empty POST — pairs with R4).
2. **Offer Test tool** — `payload-builder-handlers.ts:204–234` builds a SIMULATED context (defaults mirror runtime; overridable fields per B5: country, state, city, postalCode, timezone, ip, ua, url, referer, language, utm_*, traffic_source, subs, cpc, fbclid) — Test and runtime can never drift because both call the same builder.
3. **Click resolver** — §4.6.
4. **Banner URL macros** — banner assembly (`auction/banner.ts`) resolves canonical macros with the auction-time context (response macros stay click-time).
5. **S2S dispatch + tracking enrichment** — read from the SAME persisted snapshot for attribution consistency (no behavioral change to existing S2S templates).

## 4.8 Tests (definitions in `11` §11.2/§11.3)

Vitest: per-macro resolution table (each of the 32 → expected source or documented-empty, incl. `referrer` alias); computed registry (all 12 resolve; unknown key rejected at save with `computed_unknown_key`; EST hour/day correct across DST boundary fixtures); placement resolution (participating in auction, default/selected in Test, multi-placement matrix); click-time merge precedence; snapshot redaction (no ip/ua persisted). Integration: live auction payload contains real geo/ip/ua/utm; Test payload parity for identical simulated context. E2E: banner URL template with `{session_id}`/`{utm_source}`/`{response:slug}` fully resolves on `/lg/lc` 302.

## 4.9 Acceptance

Macro fields carry real request/Cloudflare/session/traffic values in live payloads; computed values resolve at runtime AND Test; `placement_id` resolves per §4.5 in single- and multi-placement auctions; `/lg/lc` resolves every canonical macro in templates; unknown computed keys cannot be saved; `referrer` accepted; no secrets or raw request PII persisted in the snapshot.
