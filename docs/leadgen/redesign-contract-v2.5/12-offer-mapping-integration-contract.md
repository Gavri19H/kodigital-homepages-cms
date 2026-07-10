# 12 · Offer Mapping Integration Contract

The v2.4 mapping model (tables `leadgen_section_available_offers`, `leadgen_section_answer_maps`; states; rebuild-on-save; `validate-payload`) is PRESERVED VERBATIM. v2.5 binds it into the corrected authoring surfaces so Offer ↔ Section ↔ Quote ↔ Auction speak one language (`02 §2.4`).

## 12.1 Mapping panel (Section Builder bottom drawer — column contract)

| Column | Source | Display rule |
|---|---|---|
| Offer | `offer_name` | + provider chip |
| Provider | `provider` | plain text |
| Placement | placement label | default placement starred |
| Field | `offer_payload_field_path` | **shown as the schema’s field LABEL**; the raw path lives in a tooltip + Advanced |
| Expected type | `provider_expected_type` | plain words (“text”, “number”, “one of: …”) |
| Required | `required_for_offer` | ✓ / — |
| Mapped component | resolved from `internal_field` | component display name + slide chip |
| Status | `mapping_status` decode | complete / needs values / type mismatch / unlinked (orphaned) — colored chips, operator words |
| Fix | computed | one action: “Map…”, “Fill provider values…”, “Fix type…”, “Re-link…” — each opens the exact editor scoped to the row |

Direction A (question → field): quick-map dropdown on each answer component (type-compatible fields first, compatibility note inline). Direction B (field → question): **“Create question from field”** on unmapped rows spawns the right component type pre-bound to a new `internal_field` named from the field label (kept from v2.4 08 §8.7, re-affirmed binding).

## 12.2 Per-choice provider values — PER OFFER, never universal (C1)

A Section choice owns **display + normalization only** (label, internal normalized value, analytics label, icon/image/title/subtitle/badge, main/Other grouping — `08 §8.4`). The provider output value for a choice exists ONLY per (Offer, mapping), in that mapping’s `output_value_map` — the SAME normalized answer legitimately maps to DIFFERENT provider values on different Offers (e.g. `llc` → `"LLC"` for provider A, `"limited_liability_company"` for provider B).

- **The Mapping tab is the only editor:** opening a mapping row shows the v2.4 06 §6.3 value-map table for THAT Offer, rows = this component’s choice values.
- **The Choices tab is read-only for provider data:** each choice row ends with a “Provider values: k/n Offers” chip; expanding it lists **one row per selected Offer** (Offer name · that Offer’s provider value or “not set”), each row deep-linking into that Offer’s value-map table. No control on the Choices surface writes a provider value.
- Copy rule: the phrase “provider value” never appears without an Offer name adjacent to it.
- Test: `15 §15.1 per-offer-provider-values` — one Section answer mapped to two Offers with different provider values; each Offer’s payload preview emits its own.

## 12.3 Completeness surfacing

- Top-bar badge: “Mapping k/n Offers complete” (existing computation).
- Mapping overlay on canvas (toggle in preview drawer): each answer component gets a chip — mapped (n Offers) / required-missing (red) — clicking opens the Mapping tab scoped.
- Preview payload: “Preview generated payload” button per Offer calls existing `POST /sections/:id/validate-payload` with current sim answers; renders the redacted JSON in the debug drawer (Advanced surface — JSON allowed there).

## 12.4 Language alignment checks (mission §11)

Binding vocabulary: Offer side says *payload field, expected type, provider value, placement*; Section side says *question, answer, internal field, mapping*; Quote side says *slides, order, frame, theme*; Auction side unchanged. A grep-style lint over `ui-*.ts` copy (test `15 §15.2`) asserts forbidden synonym absence (“question key” outside Advanced, “schema path” outside Advanced, “slot” for placements, etc.).

## 12.5 API

No new mapping endpoints. Existing: `GET /sections/:id/offers`, `PATCH /sections/:id` (maps payload), `POST /sections/:id/validate-payload`, `GET /offers/:id/payload-schemas`. Additive response fields only where labels are needed (`field_label` on schema-field projections — derived from schema, no storage change).
