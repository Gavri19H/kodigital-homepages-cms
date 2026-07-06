// LeadGen Phase 5 — the §12.6/§12.7/§12.11 answer normalization pipeline
// (src/leadgen/answers.ts). PURE unit tests: no DB, no harness. Covers the §16
// worked example (UI `Yes` → true / "Y" / "yes" / 1 across four Offers),
// answer_source (§12.6), and every transform / value_map / coercion / default /
// fallback branch of the per-Offer leg.

import { describe, expect, it } from "vitest";
import {
  answerMappingToNode,
  buildOfferPayload,
  generateOfferPayload,
  normalizeAnswers,
  normalizeAnswerValue,
  providerNodeType,
  type LeadgenAnswerMapping,
} from "../src/leadgen/answers";
import type { LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";

// A single-question Section: "Are you insured?" → TwoButtonYesNo (boolean).
function yesNoContent(withDefault = false): LeadgenSectionContent {
  return {
    components: [
      {
        type: "TwoButtonYesNo",
        question_id: "q1",
        question_key: "insured_q",
        internal_field: "currently_insured",
        answer_type: "boolean",
        ...(withDefault ? { props: { default: false } } : {}),
      },
    ],
  };
}

function mapping(overrides: Partial<LeadgenAnswerMapping>): LeadgenAnswerMapping {
  return {
    internal_field: "currently_insured",
    offer_payload_field_path: "data.insured",
    provider_expected_type: "boolean",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// §12.7 Section-level normalization + §12.6 answer_source
// ---------------------------------------------------------------------------

describe("normalizeAnswers — §12.7 pivot + §12.6 answer_source", () => {
  it("normalizes a boolean UI answer (Yes → true) and marks user_selected", () => {
    const { answers, sources } = normalizeAnswers(yesNoContent(), { currently_insured: "Yes" });
    expect(answers["currently_insured"]).toBe(true);
    expect(sources["currently_insured"]).toBe("user_selected");
  });

  it("applies an untouched default as default_applied (§12.6)", () => {
    const { answers, sources } = normalizeAnswers(yesNoContent(true), {});
    expect(answers["currently_insured"]).toBe(false);
    expect(sources["currently_insured"]).toBe("default_applied");
  });

  it("distinguishes user_confirmed_default from user_selected (§12.6)", () => {
    // touched + equal to the default → confirmed.
    const confirmed = normalizeAnswers(yesNoContent(true), {
      currently_insured: { value: false, touched: true },
    });
    expect(confirmed.sources["currently_insured"]).toBe("user_confirmed_default");
    // touched + different from the default → user_selected.
    const changed = normalizeAnswers(yesNoContent(true), {
      currently_insured: { value: true, touched: true },
    });
    expect(changed.sources["currently_insured"]).toBe("user_selected");
    // present but untouched (echoed default) → default_applied.
    const echoed = normalizeAnswers(yesNoContent(true), {
      currently_insured: { value: false, touched: false },
    });
    expect(echoed.sources["currently_insured"]).toBe("default_applied");
  });

  it("omits an invalid raw value with no default (never fabricates)", () => {
    const { answers, sources } = normalizeAnswers(yesNoContent(), { currently_insured: "maybe" });
    expect(answers["currently_insured"]).toBeUndefined();
    expect(sources["currently_insured"]).toBeUndefined();
  });

  it("expands NameFieldsGroup + AddressAutocomplete sub-fields (§12.8)", () => {
    const content: LeadgenSectionContent = {
      components: [
        { type: "NameFieldsGroup", question_id: "n1" },
        { type: "AddressAutocompleteQuestion", question_id: "a1" },
      ],
    };
    const { answers } = normalizeAnswers(content, {
      first: "  Ada  ",
      last: "Lovelace",
      street: "1 Rue",
      city: "Paris",
      state: "IDF",
      zip: "75001",
    });
    expect(answers["first"]).toBe("Ada"); // trimmed
    expect(answers["last"]).toBe("Lovelace");
    expect(answers["zip"]).toBe("75001");
  });

  it("normalizeAnswerValue covers every answer_type branch", () => {
    expect(normalizeAnswerValue("no", "boolean")).toBe(false);
    expect(normalizeAnswerValue("1", "boolean")).toBe(true);
    expect(normalizeAnswerValue("42", "number")).toBe(42);
    expect(normalizeAnswerValue("$330,000", "currency")).toBe(330000);
    expect(normalizeAnswerValue("  llc ", "enum")).toBe("llc");
    expect(normalizeAnswerValue(3, "enum")).toBe(3);
    expect(normalizeAnswerValue(["a", "b"], "array")).toEqual(["a", "b"]);
    expect(normalizeAnswerValue({ x: 1 }, "object")).toEqual({ x: 1 });
    expect(normalizeAnswerValue(7, "string")).toBe("7");
    expect(normalizeAnswerValue("  hi  ", "string")).toBe("hi");
    // invalid inputs → undefined
    expect(normalizeAnswerValue("abc", "number")).toBeUndefined();
    expect(normalizeAnswerValue("nope", "boolean")).toBeUndefined();
    expect(normalizeAnswerValue("", "string")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// §16 worked example — the four-Offer proof
// ---------------------------------------------------------------------------

describe("§16 worked example — Yes → true / \"Y\" / \"yes\" / 1", () => {
  it("one normalized boolean answer yields the correct per-provider shape", () => {
    const { answers } = normalizeAnswers(yesNoContent(), { currently_insured: "Yes" });
    expect(answers["currently_insured"]).toBe(true);

    // Offer A — boolean, no map: the raw internal true coerces to true.
    const a = buildOfferPayload([mapping({ provider_expected_type: "boolean" })], answers);
    expect(a).toEqual({ data: { insured: true } });

    // Offer B — string, {true:"Y", false:"N"}.
    const b = buildOfferPayload(
      [mapping({ provider_expected_type: "string", output_value_map: { true: "Y", false: "N" } })],
      answers,
    );
    expect(b).toEqual({ data: { insured: "Y" } });

    // Offer C — string, {true:"yes"}.
    const cc = buildOfferPayload(
      [mapping({ provider_expected_type: "string", output_value_map: { true: "yes" } })],
      answers,
    );
    expect(cc).toEqual({ data: { insured: "yes" } });

    // Offer D — number, {true:1}.
    const d = buildOfferPayload(
      [mapping({ provider_expected_type: "number", output_value_map: { true: 1 } })],
      answers,
    );
    expect(d).toEqual({ data: { insured: 1 } });
  });

  it("generateOfferPayload runs both legs end-to-end from raw UI answers", () => {
    const result = generateOfferPayload(yesNoContent(), { currently_insured: "Yes" }, [
      mapping({ provider_expected_type: "string", output_value_map: { true: "Y", false: "N" } }),
    ]);
    expect(result.answers["currently_insured"]).toBe(true);
    expect(result.sources["currently_insured"]).toBe("user_selected");
    expect(result.payload).toEqual({ data: { insured: "Y" } });
  });
});

// ---------------------------------------------------------------------------
// Per-Offer leg — every transform / value_map / coercion / default / fallback
// ---------------------------------------------------------------------------

describe("buildOfferPayload — transform + coercion branches (§12.11 order)", () => {
  const run = (m: Partial<LeadgenAnswerMapping>, answers: Record<string, unknown>): unknown =>
    buildOfferPayload([{ internal_field: "f", offer_payload_field_path: "x", provider_expected_type: "string", ...m }], answers);

  it("mapBoolean transform", () => {
    expect(run({ provider_expected_type: "boolean", value_transform: [{ kind: "mapBoolean" }] }, { f: "yes" })).toEqual({ x: true });
  });
  it("mapEnum transform", () => {
    expect(run({ value_transform: [{ kind: "mapEnum", map: { sole: "SP" } }] }, { f: "sole" })).toEqual({ x: "SP" });
  });
  it("formatDate transform (UTC tokens)", () => {
    expect(run({ value_transform: [{ kind: "formatDate", format: "YYYY/MM/DD" }] }, { f: "2020-01-02T00:00:00Z" })).toEqual({ x: "2020/01/02" });
  });
  it("formatPhone transform (10 digits)", () => {
    expect(run({ value_transform: [{ kind: "formatPhone" }] }, { f: "(415) 555-1234" })).toEqual({ x: "4155551234" });
  });
  it("toNumber transform", () => {
    expect(run({ provider_expected_type: "number", value_transform: [{ kind: "toNumber" }] }, { f: "42" })).toEqual({ x: 42 });
  });
  it("toString transform", () => {
    expect(run({ value_transform: [{ kind: "toString" }] }, { f: 42 })).toEqual({ x: "42" });
  });
  it("trim transform", () => {
    expect(run({ value_transform: [{ kind: "trim" }] }, { f: "  hi  " })).toEqual({ x: "hi" });
  });

  it("provider type coercion without a map/transform (number ← string, string ← number)", () => {
    expect(run({ provider_expected_type: "number" }, { f: "5" })).toEqual({ x: 5 });
    expect(run({ provider_expected_type: "string" }, { f: 5 })).toEqual({ x: "5" });
    expect(run({ provider_expected_type: "boolean" }, { f: true })).toEqual({ x: true });
  });

  it("value_map MISS → fallback (a final value)", () => {
    // "maybe" is not a map key → invalid → fallback wins.
    expect(
      run({ provider_expected_type: "boolean", output_value_map: { yes: true }, fallback_value: false }, { f: "maybe" }),
    ).toEqual({ x: false });
  });

  it("absent answer → default (a final value)", () => {
    expect(run({ default_value: "D" }, {})).toEqual({ x: "D" });
  });

  it("absent answer, no default → the node cleans away (cleanObject)", () => {
    expect(run({}, {})).toEqual({});
  });

  it("answerMappingToNode maps the edge into a source:'answer' node", () => {
    const node = answerMappingToNode(
      mapping({ provider_expected_type: "number", offer_payload_field_path: "a.b.c", output_value_map: { true: 1 } }),
    );
    expect(node.source).toBe("answer");
    expect(node.path).toBe("a.b.c");
    expect(node.name).toBe("c");
    expect(node.type).toBe("number");
    expect(node.value_map).toEqual({ true: 1 });
  });

  it("providerNodeType coerces an unknown provider type to string", () => {
    expect(providerNodeType("number")).toBe("number");
    expect(providerNodeType("weird")).toBe("string");
  });

  it("multi-field payload: two edges write distinct paths", () => {
    const payload = buildOfferPayload(
      [
        { internal_field: "first", offer_payload_field_path: "contact.first_name", provider_expected_type: "string" },
        { internal_field: "zip", offer_payload_field_path: "contact.zip", provider_expected_type: "string" },
      ],
      { first: "Ada", zip: "75001" },
    );
    expect(payload).toEqual({ contact: { first_name: "Ada", zip: "75001" } });
  });
});
