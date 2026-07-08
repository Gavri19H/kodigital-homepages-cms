# 07 · Offer Management Contract (Phase 3 · A1, A2, A3, D1, D2, D3, S1)

Files: `admin/leadgen/offers-handlers.ts`, `router.ts`, `ui-offers.ts`, `leadgen/rules.ts` (labels only — semantics frozen), `leadgen/validation.ts` (region validators), `auctions-handlers.ts` + `auction/explain.ts` (simulate), `leadgen/redact.ts`.

## 7.1 Offers list actions (A1/A2 surface)

Row actions (kebab + inline): **Edit · Duplicate · Archive · Delete · Usage**. Delete visible always; guarded per §7.2 (blocked state explains itself — never hidden magic). List gains the R4 eligibility badge (dynamic Offers) and a Test-status chip.

## 7.2 Delete Offer — guarded hard delete (A1; Q2 resolved; contract erratum to v2.3.7 §9.6)

`DELETE /api/admin/leadgen/offers/:id?mode=hard` (existing DELETE=archive stays the default; `mode=hard` is the new path).

**Allowed only when the Offer has ZERO references across the FULL inventory** (explicit-query guard — D1 FKs are not enforced, so every check is a real query): placements referenced by auctions (`leadgen_auction_offers.offer_placement_id`); active payload schemas in use; `leadgen_section_available_offers`; `leadgen_section_answer_maps`; auction participating offers; auction rules targeting the Offer/carriers; region rules (own children — cascade); cap counters with activity; `cap_fallback_offer_id` references from OTHER Offers; provider request logs; click/revenue attribution rows; analytics mirror rows (`leadgen_analytics_offer` etc.); postback/revenue raw rows.

**If referenced:** `409 {error:"offer_in_use", usage: <§7.4 report>}`; UI modal renders the usage report with links + “Archive instead” primary action. **If clean:** confirmation modal (type Offer name to confirm) → hard delete cascades OWN children only (placements, schema versions, region rules, own cap counter rows) in one batch; write an admin audit log row if the repo’s admin-audit pattern exists, else structured log. Logs/analytics are never deleted (their absence is what made the Offer deletable).

## 7.3 Duplicate Offer (A2; Q3 resolved)

`POST /api/admin/leadgen/offers/:id/duplicate` — batch-clone in one transaction:
- New `lgo_` public_id; **status = draft/inactive**; name from modal (required, default “<name> (copy)”).
- **New default placement ID = required modal input** (source placement ids are NOT copied verbatim — two Offers must never serve the same provider feed id by accident); additional placements copied as rows with BLANK placement ids flagged “needs value”.
- Copy: ACTIVE payload schema **as new version 1** (fresh `lgp_` id; no version history); response parser (`carrier_parse_json` + version); banner URL template + response-macro fallbacks; region rules (checkbox, default ON).
- Copy behind explicit checkboxes (default OFF unless stated): endpoints/headers/token REFS (“Copy endpoint & request config” — refs only, secrets never move) default ON; cap settings default OFF (copied disabled when checked).
- Never copied: analytics, cap counters, provider logs, Test results/sample responses, revenue. **Test status = untested** (schema untested ⇒ R4 gate blocks live auction until tested — by design).

**Modal fields:** New Offer name · New default placement ID · ☑ Copy region rules · ☐ Copy cap settings (copied disabled) · ☑ Copy endpoint/request config · [Create draft]. Response returns the new Offer; UI navigates to its editor with a “Duplicated from <name>” banner listing what was/wasn’t copied.

## 7.4 Usage endpoint — full inventory (A3)

`GET /api/admin/leadgen/offers/:id/usage` (extends `offers-handlers.ts:1177–1227`) returns every reference kind, each `{kind, count, items[{id, public_id, name, link}]} `:
`sections_available` · `answer_maps` (with section + field counts) · `quotes_indirect` (Quotes/Funnels whose Sections select the Offer) · `auctions_participating` (via placements) · `region_rules` (own) · `auction_rules_targeting` · `cap_counters_active` · `cap_fallback_referenced_by` · `provider_request_logs` (count + latest ts; warning-only) · `revenue_attribution` (count; warning-only) · `analytics_mirror_rows` (count; warning-only) · `delete_eligibility: {eligible: boolean, blocking_kinds: string[]}`. The SAME payload drives the delete guard and the Usage panel — one query set, two consumers.

## 7.5 Region rules UX (D1, D2, D3)

- **Two visible behaviors** (D1): **“Allow only these regions”** (→ stored `include_only`; legacy `allow_list` rows display identically) and **“Block these regions”** (→ stored `exclude`; legacy `block_list` identical). Storage enum unchanged for compat; new rows write `include_only`/`exclude` only. Contract erratum recorded: v2.3.7 04 §10.4 never distinguished the aliases — the pairs are formally declared identical.
- **Priority field** (D2): label **“Evaluation order”**, help *“Rules run lowest number first; the first blocking rule wins. Default 100.”*
- Section header help: *“These are provider region-block rules only. Answer-based Offer participation rules are configured in Auction.”*
- **Region entry** (D3): Country = ISO-3166-1 alpha-2 dropdown; State = code dropdown filtered by country (US states + CA provinces baseline); City = chips (free text, trimmed, deduped); ZIP = chips validated `/^\d{5}$/`; **Paste multiple** (comma/newline split, per-token validation, invalid tokens listed + rejected). Server: per-dimension validators in `leadgen/validation.ts:411–471` with typed errors (`region_value_invalid`, dimension + token) — `zip:"not-a-zip"` can no longer save.

## 7.6 Simulate trace (S1)

Auction/Offer simulate (`auctions-handlers.ts:1591–1638`) response gains, per considered Offer: `payload_preview` (the EXACT generated payload, passed through `leadgen/redact.ts` — token/secret/PII fields masked) · `parser_id`/`carrier_parse_version` · `expected_response_fields` (from the parser spec) · `placement_id` used · `eligibility` verdict + `excluded_reason` where excluded (R4 vocabulary + region/cap reasons). Simulate remains **dry**: no provider call in dry-run (existing discipline preserved; live Test stays the Test tool’s job). `explain.ts:37–41,99` renders the new fields.

## 7.7 Tests (definitions in `11` §11.3)

API (Vitest/integration): duplicate → new `lgo_/lgpl_/lgp_` ids, draft status, single default placement, untested state, no counters/logs/analytics/revenue copied, blank-placement flags, checkbox matrix honored; delete unused → cascades own children (row-count proofs); delete used → 409 with the usage report; usage endpoint reports EVERY reference kind (fixture with all 12 kinds populated); region per-dimension validators (bad zip/state/country rejected; paste-multiple partial rejection); rule priority saved + evaluation-order regression (aliases still behave identically — semantics frozen). UI (Playwright): row actions visible; duplicate modal requires placement id; delete confirm + blocked-with-usage flows; region labels/help render; paste-multiple UX; simulate shows redacted payload + exclusion reasons.

## 7.8 Acceptance

Delete works only when safe (full-inventory guard, 409 report otherwise); Duplicate creates a safe draft with new unique placement and untested status; Usage reports every reference kind with links; region rules read as two plain actions with validated values and a labeled evaluation order; simulate explains per-offer payload (redacted), parser, expected fields, and exclusions — with zero provider calls in dry-run.
