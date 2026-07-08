// LeadGen Phase 5 — the pure Section domain logic (src/leadgen/sections.ts).
// No DB: every referential check takes injected Offer/schema info. Covers
// validateSection (§12.1), the §12.4 mapping-reference block, the §12.11
// per-edge mappingCompleteness (all four states), the §12.1 derived-index
// rebuild, and the §12.11/§35.1 publish gate.

import { describe, expect, it } from "vitest";
import {
  edgeValidationStatus,
  mappingCompleteness,
  rebuildDerivedIndexes,
  sectionValidationStatus,
  toMappingStatusColumn,
  validateMappingReferences,
  validateSection,
  type LeadgenAnswerMapEdge,
  type OfferSchemaInfo,
} from "../src/leadgen/sections";
import type { LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";
import type { LeadgenPayloadNodeType } from "../src/leadgen/payload";

const CONTENT: LeadgenSectionContent = {
  components: [
    { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
  ],
};

function offerSchema(overrides: Partial<OfferSchemaInfo> = {}): OfferSchemaInfo {
  return {
    status: "active",
    activity: "quote_funnel",
    vertical: "life",
    active_schema_id: 10,
    active_schema_public_id: "lgp_TEST",
    fieldTypes: new Map<string, LeadgenPayloadNodeType>([
      ["data.insured", "boolean"],
      ["data.name", "string"],
    ]),
    requiredFieldPaths: ["data.insured"],
    ...overrides,
  };
}

function edge(overrides: Partial<LeadgenAnswerMapEdge> = {}): LeadgenAnswerMapEdge {
  return {
    question_id: "q1",
    question_key: "insured_q",
    internal_field: "currently_insured",
    answer_type: "boolean",
    offer_id: 1,
    offer_payload_field_path: "data.insured",
    provider_expected_type: "boolean",
    output_value_map: null,
    value_transform: null,
    required_for_offer: true,
    default_value: null,
    fallback_value: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateSection (§12.1)
// ---------------------------------------------------------------------------

describe("validateSection — §12.1 fields + content", () => {
  function baseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      section_name: "Insured?",
      activity: "quote_funnel",
      vertical: "life",
      headline_text: "Are you insured?",
      content_json: JSON.stringify(CONTENT),
      ...overrides,
    };
  }

  it("accepts a well-formed Section", () => {
    const { errors, value } = validateSection(baseBody());
    expect(errors).toEqual({});
    expect(value).not.toBeNull();
    expect(value?.continue_mode).toBe("button");
    expect(value?.status).toBe("active");
    expect(value?.content.components).toHaveLength(1);
  });

  it("rejects each missing required §12.1 field", () => {
    for (const field of ["section_name", "activity", "vertical", "headline_text"]) {
      const body = baseBody();
      delete body[field];
      const { value, errors } = validateSection(body);
      expect(value, `missing ${field}`).toBeNull();
      expect(errors[field]).toBeTruthy();
    }
  });

  it("surfaces Stage-A content errors under content.* paths", () => {
    const { value, errors } = validateSection(baseBody({ content_json: JSON.stringify({ components: [] }) }));
    expect(value).toBeNull();
    expect(Object.keys(errors).some((k) => k.startsWith("content."))).toBe(true);
  });

  it("rejects a malformed content_json", () => {
    const { value, errors } = validateSection(baseBody({ content_json: "{not json" }));
    expect(value).toBeNull();
    expect(errors["content_json"]).toContain("valid JSON");
  });

  it("rejects a non-curated design override key (§14.8)", () => {
    const { value, errors } = validateSection(baseBody({ design_overrides: { evilCss: "x" } }));
    expect(value).toBeNull();
    expect(errors["design_overrides.evilCss"]).toBeTruthy();
  });

  it("rejects arbitrary CSS in a curated override value (§14.10)", () => {
    const { value, errors } = validateSection(baseBody({ design_overrides: { iconColor: "red;}body{display:none" } }));
    expect(value).toBeNull();
    expect(errors["design_overrides.iconColor"]).toBeTruthy();
  });

  it("rejects an invalid continue_mode", () => {
    const { value, errors } = validateSection(baseBody({ continue_mode: "teleport" }));
    expect(value).toBeNull();
    expect(errors["continue_mode"]).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// §12.4 mapping-reference guards
// ---------------------------------------------------------------------------

describe("validateMappingReferences — §12.4 archived / mismatched / schema-less", () => {
  const section = { activity: "quote_funnel", vertical: "life" };

  it("passes for an active, matching Offer with an active schema", () => {
    const errors = validateMappingReferences(section, [edge()], new Map([[1, offerSchema()]]));
    expect(errors).toEqual({});
  });

  it("blocks an unknown Offer", () => {
    const errors = validateMappingReferences(section, [edge()], new Map());
    expect(errors["answer_maps[0].offer_id"]).toContain("unknown offer");
  });

  it("blocks an archived Offer", () => {
    const errors = validateMappingReferences(section, [edge()], new Map([[1, offerSchema({ status: "archived" })]]));
    expect(errors["answer_maps[0].offer_id"]).toContain("archived");
  });

  it("blocks an activity/vertical mismatch", () => {
    const errors = validateMappingReferences(section, [edge()], new Map([[1, offerSchema({ vertical: "auto" })]]));
    expect(errors["answer_maps[0].offer_id"]).toContain("does not match");
  });

  it("blocks an Offer with no active payload schema", () => {
    const errors = validateMappingReferences(
      section,
      [edge()],
      new Map([[1, offerSchema({ active_schema_id: null })]]),
    );
    expect(errors["answer_maps[0].offer_id"]).toContain("no active payload schema");
  });
});

// ---------------------------------------------------------------------------
// §12.11 per-edge completeness — all four states
// ---------------------------------------------------------------------------

describe("mappingCompleteness — §12.11 four states", () => {
  it("complete: field exists, types line up, required field bound", () => {
    expect(mappingCompleteness(edge(), offerSchema())).toBe("complete");
  });

  it("missing_required: a required edge with no bound internal_field", () => {
    expect(mappingCompleteness(edge({ internal_field: "" }), offerSchema())).toBe("missing_required");
  });

  it("type_mismatch: the edge provider type disagrees with the schema node", () => {
    expect(mappingCompleteness(edge({ provider_expected_type: "string" }), offerSchema())).toBe("type_mismatch");
  });

  it("orphaned: the field path no longer exists in the active schema (or no schema)", () => {
    expect(mappingCompleteness(edge({ offer_payload_field_path: "data.ghost" }), offerSchema())).toBe("orphaned");
    expect(mappingCompleteness(edge(), null)).toBe("orphaned");
    expect(mappingCompleteness(edge(), offerSchema({ active_schema_id: null }))).toBe("orphaned");
  });

  it("a value_map makes any answer_type coercible (no type_mismatch)", () => {
    // answer boolean → provider number would mismatch, but a map bridges it.
    const withMap = edge({ provider_expected_type: "number", offer_payload_field_path: "data.name", output_value_map: { true: 1 } });
    // data.name is a string node → still a schema-type disagreement → mismatch.
    expect(mappingCompleteness(withMap, offerSchema())).toBe("type_mismatch");
    // aligned to a number node → complete via the map.
    const numSchema = offerSchema({
      fieldTypes: new Map<string, LeadgenPayloadNodeType>([["data.score", "number"]]),
      requiredFieldPaths: [],
    });
    expect(mappingCompleteness(edge({ provider_expected_type: "number", offer_payload_field_path: "data.score", output_value_map: { true: 1 }, required_for_offer: false }), numSchema)).toBe("complete");
  });

  it("toMappingStatusColumn maps missing_required → the DDL-storable incomplete", () => {
    expect(toMappingStatusColumn("missing_required")).toBe("incomplete");
    expect(toMappingStatusColumn("complete")).toBe("complete");
    expect(toMappingStatusColumn("type_mismatch")).toBe("type_mismatch");
    expect(toMappingStatusColumn("orphaned")).toBe("orphaned");
    expect(edgeValidationStatus("complete")).toBe("ok");
    expect(edgeValidationStatus("orphaned")).toBe("error");
  });
});

// ---------------------------------------------------------------------------
// §12.1 derived-index rebuild
// ---------------------------------------------------------------------------

describe("rebuildDerivedIndexes — §12.1 server rebuild from content_json", () => {
  const offerSchemas = new Map([[1, offerSchema()]]);

  it("produces a complete answer-map row + available-offer row, schema pinned", () => {
    const result = rebuildDerivedIndexes({ content: CONTENT, answerMaps: [edge()], offerSchemas });
    expect(result.answerMaps).toHaveLength(1);
    const row = result.answerMaps[0];
    expect(row?.mapping_completeness).toBe("complete");
    expect(row?.mapping_status).toBe("complete");
    expect(row?.validation_status).toBe("ok");
    expect(row?.payload_schema_id).toBe(10);
    expect(row?.payload_schema_public_id).toBe("lgp_TEST");

    expect(result.availableOffers).toHaveLength(1);
    const off = result.availableOffers[0];
    expect(off?.offer_id).toBe(1);
    expect(off?.mapping_state).toBe("complete");
    expect(off?.required_fields_total).toBe(1);
    expect(off?.required_fields_mapped).toBe(1);
    expect(off?.selected).toBe(true);
  });

  it("drops an edge whose question_id is not in content_json", () => {
    const result = rebuildDerivedIndexes({ content: CONTENT, answerMaps: [edge({ question_id: "ghost" })], offerSchemas });
    expect(result.answerMaps).toHaveLength(0);
    expect(result.availableOffers).toHaveLength(0);
  });

  it("missing_required edge → mapping_status incomplete + offer mapping_state incomplete", () => {
    const result = rebuildDerivedIndexes({ content: CONTENT, answerMaps: [edge({ internal_field: "" })], offerSchemas });
    expect(result.answerMaps[0]?.mapping_status).toBe("incomplete");
    expect(result.answerMaps[0]?.validation_status).toBe("error");
    expect(result.availableOffers[0]?.mapping_state).toBe("incomplete");
    expect(result.availableOffers[0]?.required_fields_mapped).toBe(0);
  });

  it("type_mismatch edge → offer mapping_state invalid", () => {
    const result = rebuildDerivedIndexes({
      content: CONTENT,
      answerMaps: [edge({ provider_expected_type: "string" })],
      offerSchemas,
    });
    expect(result.answerMaps[0]?.mapping_status).toBe("type_mismatch");
    expect(result.availableOffers[0]?.mapping_state).toBe("invalid");
  });

  it("a selected-but-unmapped Offer is 'selected' with 0 mapped", () => {
    const result = rebuildDerivedIndexes({
      content: CONTENT,
      answerMaps: [],
      offerSchemas,
      selectedOfferIds: new Set([1]),
    });
    expect(result.availableOffers).toHaveLength(1);
    expect(result.availableOffers[0]?.mapping_state).toBe("selected");
    expect(result.availableOffers[0]?.required_fields_total).toBe(1);
    expect(result.availableOffers[0]?.required_fields_mapped).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §12.11 / §35.1 publish gate
// ---------------------------------------------------------------------------

describe("sectionValidationStatus — §12.11 publish gate", () => {
  const offerSchemas = new Map([[1, offerSchema()]]);

  it("ok + publishable when every required field is completely mapped", () => {
    const rebuilt = rebuildDerivedIndexes({ content: CONTENT, answerMaps: [edge()], offerSchemas });
    const verdict = sectionValidationStatus(rebuilt);
    expect(verdict.status).toBe("ok");
    expect(verdict.publishable).toBe(true);
  });

  it("error + not publishable when an Offer has a type_mismatch row", () => {
    const rebuilt = rebuildDerivedIndexes({
      content: CONTENT,
      answerMaps: [edge({ provider_expected_type: "string" })],
      offerSchemas,
    });
    const verdict = sectionValidationStatus(rebuilt);
    expect(verdict.status).toBe("error");
    expect(verdict.publishable).toBe(false);
    expect(verdict.offers[0]?.reasons.length).toBeGreaterThan(0);
  });

  it("error when a selected Offer has an unmapped required field (§35.1)", () => {
    const rebuilt = rebuildDerivedIndexes({
      content: CONTENT,
      answerMaps: [],
      offerSchemas,
      selectedOfferIds: new Set([1]),
    });
    const verdict = sectionValidationStatus(rebuilt);
    expect(verdict.status).toBe("error");
    expect(verdict.publishable).toBe(false);
  });

  it("publishable when a selected Offer has 0 required fields (nothing to map)", () => {
    const noRequired = new Map([[1, offerSchema({ requiredFieldPaths: [] })]]);
    const rebuilt = rebuildDerivedIndexes({
      content: CONTENT,
      answerMaps: [],
      offerSchemas: noRequired,
      selectedOfferIds: new Set([1]),
    });
    const verdict = sectionValidationStatus(rebuilt);
    expect(verdict.status).toBe("ok");
    expect(verdict.publishable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §8.5 layout containers — the rebuild's mappable-question universe is the
// canonical flattened projection: an edge bound to a question NESTED inside a
// container survives; a container's own question_id is NOT mappable.
// ---------------------------------------------------------------------------

describe("rebuildDerivedIndexes — §8.5 nested content", () => {
  const offerSchemas = new Map([[1, offerSchema()]]);
  const NESTED_CONTENT: LeadgenSectionContent = {
    components: [
      {
        type: "CardPanel",
        question_id: "panel",
        children: [
          {
            type: "Stack",
            question_id: "stk",
            children: [
              {
                type: "TwoButtonYesNo",
                question_id: "q1",
                question_key: "insured_q",
                internal_field: "currently_insured",
                answer_type: "boolean",
              },
            ],
          },
        ],
      },
    ],
  } as LeadgenSectionContent;

  it("keeps an edge bound to a question nested inside containers (flat-equivalent rebuild)", () => {
    const nested = rebuildDerivedIndexes({ content: NESTED_CONTENT, answerMaps: [edge()], offerSchemas });
    const flat = rebuildDerivedIndexes({ content: CONTENT, answerMaps: [edge()], offerSchemas });
    expect(nested.answerMaps).toHaveLength(1);
    expect(nested.answerMaps[0]?.mapping_completeness).toBe("complete");
    expect(nested).toEqual(flat);
  });

  it("a container's own question_id is NOT a mappable question (edge dropped)", () => {
    const result = rebuildDerivedIndexes({
      content: NESTED_CONTENT,
      answerMaps: [edge({ question_id: "panel" })],
      offerSchemas,
    });
    expect(result.answerMaps).toHaveLength(0);
  });
});
