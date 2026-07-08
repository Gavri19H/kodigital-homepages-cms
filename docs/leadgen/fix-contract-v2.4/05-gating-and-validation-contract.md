# 05 · Gating & Validation Contract (Phase 1 · R4, R5, R9, R6; B7 rides in Phase 2)

Two contract-mandated MUST gates exist as code but are never called. This section wires them, hardens the anti-tamper tuple, and stamps versions.

## 5.1 Dynamic Offer auction-eligibility gate (R4 — §11.8/§35.1)

`dynamicAuctionEligibility()` (`leadgen/validation.ts:570–590`) already returns the contract verdict (`no_active_schema | schema_validation_errors | test_untested | test_failed`). Wire it at FOUR sites:

1. **Offer editor status** (`ui-offers.ts`): persistent eligibility banner on dynamic Offers — “Eligible for live auction” / “Blocked: <reasons>” with fix links (schema editor, Test tab). Offers LIST gains an eligibility badge column.
2. **Auction participating-Offer picker/save** (`auctions-handlers.ts` PUT): adding an ineligible dynamic Offer → per-offer warning payload `{offer_id, eligible:false, reasons[]}`; the save is accepted with `warnings[]` (draft auctions may reference not-yet-ready Offers) but the AUCTION cannot be attached to an ACTIVE Quote while any participating dynamic Offer is ineligible (enforced by §5.2’s activation gate).
3. **Auction runtime participation** (`auction/engine.ts:168–173`): BEFORE payload build, ineligible Offer → excluded with `carrier_filtered_reason` = the eligibility reason; emit `auction_carrier_filtered`; record in explainability. **Delete the EMPTY_SCHEMA degradation** — an empty payload must never be POSTed to a provider.
4. **Quote publish/activation validation** — participating dynamic Offers are checked in §5.2’s preflight.

Additional block conditions beyond the four codes (extend the eligibility fn additively): endpoint missing for the selected environment; invalid headers config; response parser (`carrier_parse_json`) missing/invalid; required mapping missing for a Section actually in the Quote (evaluated in §5.2, not per-Offer); cap reached (runtime-only exclusion, reason `cap_reached` — already engine behavior, now surfaced in explainability).

## 5.2 Quote publish / activation gate (R5 — §35.1/§12.11)

**Where:** (a) variant save (`quotes-handlers.ts:882–893` path) recomputes and stores a preflight verdict; (b) activation PUT (`quotes-handlers.ts:1588–1665`) HARD-BLOCKS with 409 when the verdict fails. Both call the EXISTING machinery: `sectionValidationStatus` (`leadgen/sections.ts:538–577`) + per-offer `validate-payload` (`sections-handlers.ts:1217–1352`). No new validation logic — new CALLERS.

**Block activation when any is true:** an active Section in the funnel order has selected-Offer mapping incomplete (`mapping_state` ≠ complete for a selected Offer); required provider fields unmapped; a mapped `offer_payload_field_path` no longer exists in the ACTIVE schema version (orphaned); type conversion invalid; payload schema version missing; a dependency references a missing field; the final auction config invalid; any participating dynamic Offer ineligible (§5.1).

**409 report shape (normative):**
```json
{ "error": "quote_activation_blocked",
  "quote_id": "lgq_…", "funnel_id": "lgf_…", "funnel_variant_id": "lgn_…",
  "blocks": [ { "section_id": "lgs_…", "section_name": "ZIP",
      "offer_id": "lgo_…", "offer_name": "NextInsure",
      "code": "missing_required_provider_fields",
      "fields": ["current_insurance.carrier", "current_insurance.carrier_months"],
      "fix_links": { "section_mapping": "/admin/leadgen/sections/lgs_…/edit#mapping",
                      "offer_schema": "/admin/leadgen/offers/lgo_…/edit#payload" } } ] }
```

**UI (Activation tab preflight panel):** renders the report as blocking cards — exactly the operator copy pattern: “Cannot activate this Quote. · Section: ZIP · Offer: NextInsure · Missing required provider fields: current_insurance.carrier, current_insurance.carrier_months · [Open Section Mapping] [Open Offer Payload Schema]”. Panel shows PASS state (green, itemized checks) when clean. The editor’s existing “Blocked from publish” badge now reflects the same server verdict (advisory → authoritative).

## 5.3 Anti-tamper tuple extension (R9 — §19.1)

Extend the signed tuple (`attempt.ts`) from `{funnel_variant_id, section_order_hash, content_version, funnel_attempt_id}` to ALSO bind: `session_id`, `answer_mapping_hash` (SHA-256 over ordered per-section answer_mapping_versions), `auction_config_version`. Token scheme bumps to `v2.` (mint v2; `/lg/auction` accepts v2 always, v1 only behind a dated grace flag `LEADGEN_ACCEPT_V1_TOKENS` for in-flight sessions during deploy; default off in tests). Keep: HMAC-SHA256, canonical key order, `unsigned.` dev fallback, fail-closed `requireSigned` on `/lg/auction`, constant-time compare, 422 + `tampered` traffic-quality flow. Tamper matrix test: each field mutated independently → reject.

## 5.4 Event version stamping (R6)

- `config-dto.ts` populates per-section `answer_mapping_version` (currently hard-`""`) from `leadgen_section_answer_maps` (max version per section at resolve time).
- Server stamps on every auction-path record/event: `payload_schema_version` (the ACTIVE schema version used for that Offer’s build), `auction_config_version`, `auction_instance_id`, `auction_request_id`, `provider_request_id`, `auction_result_id`.
- Engine beacons stamp: `section_mapping_version` + `answer_mapping_version` (from config) on section/answer events; `banner_render_id` on impression/click-adjacent events.
- `analytics/leadgen-events.ts:139,369,529` initializers stay `""` ONLY as the pre-parse default; event-shape tests assert non-empty on the paths above.

## 5.5 Test-tool validity gate (B7 — Phase 2, same family)

`payload-builder-handlers.ts:147–199`: before ANY test run, `validatePayloadSchema`; invalid → typed `400 {schema_errors[]}` rendered by the `06` §6.11 panel; a bare 500 on unreadable schema is a defect. Save and Test both blocked while P0/P1-class schema errors exist (warning-class errors don’t block).

## 5.6 Tests (definitions in `11` §11.2/§11.4)

Vitest/integration: eligibility fn extended-codes matrix; engine excludes ineligible Offer with typed reason (invalid schema / untested / failed test / missing parser / missing endpoint); EMPTY_SCHEMA path removed (no provider POST with empty payload — asserted via mock provider recording zero calls); auction-offers PUT returns warnings; activation 409 report shape (per-offer fields + fix links); clean activation 200; variant-save verdict recompute; signed-tuple v2 mint/verify + per-field tamper matrix + v1 grace flag off ⇒ reject; version stamps non-empty on auction events. Playwright: preflight panel renders blocks + fix links navigate; Offer editor banner reflects eligibility; simulate shows exclusions (with `07` §7.6).

## 5.7 Acceptance

No dynamic Offer with invalid/untested schema can participate in a live auction (excluded with visible reason); no Quote with incomplete required mappings can be activated (409 + actionable report; UI panel matches); tampering any bound field → 422 `tampered`; auction-path events carry non-empty versions; Test blocked on invalid schema with the standard error panel.
