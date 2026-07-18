// P4b (register PC-A2, required completeness) — NameFieldsGroup + Address
// enforce `required` client-side across their sub-fields.
//
// Investigation ground: validateSection skipped any component with an empty
// internal_field (validation.ts ~230), so NameFieldsGroup / AddressAutocomplete
// (no single internal_field) were NEVER validated — a required name group could
// not block Continue. P4b extends validateSection to require EVERY sub-field
// (mirrors the server's answers.ts fieldsOf), keyed to the group's question_id
// so the (auto) error slot has somewhere to paint.

import { describe, expect, it } from "vitest";
import { validateSection, groupSubfields } from "../src/public/leadgen/runtime/validation";
import type { LgComponentConfig } from "../src/public/leadgen/runtime/state";
import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const vis = (question_id: string, required_now = false) => [{ question_id, visible: true, required_now }];

const nameGroup = (extra: Record<string, unknown> = {}): LgComponentConfig =>
  ({ type: "NameFieldsGroup", question_id: "qn", required: true, ...extra }) as unknown as LgComponentConfig;
const addressGroup = (extra: Record<string, unknown> = {}): LgComponentConfig =>
  ({ type: "AddressAutocompleteQuestion", question_id: "qa", required: true, ...extra }) as unknown as LgComponentConfig;

describe("P4b — groupSubfields (the sub-field enumeration)", () => {
  it("NameFieldsGroup defaults to [first,last]; Address to [street,city,state,zip]", () => {
    expect(groupSubfields(nameGroup())).toEqual(["first", "last"]);
    expect(groupSubfields(addressGroup())).toEqual(["street", "city", "state", "zip"]);
  });
  it("honors an authored fields / internal_fields override", () => {
    expect(groupSubfields(nameGroup({ props: { fields: ["given", "family"] } }))).toEqual(["given", "family"]);
    expect(groupSubfields(addressGroup({ props: { internal_fields: ["line1", "zip"] } }))).toEqual(["line1", "zip"]);
  });
  it("returns null for a normal single-field component", () => {
    expect(groupSubfields({ type: "EmailInputQuestion", question_id: "q", internal_field: "email" } as unknown as LgComponentConfig)).toBeNull();
  });
});

describe("P4b — validateSection enforces required across a NameFieldsGroup", () => {
  it("both sub-fields present → passes", () => {
    expect(validateSection([nameGroup()], { first: "Ada", last: "Lovelace" }, vis("qn"))).toEqual([]);
  });
  it("a missing sub-field → ONE required failure keyed to the group's question_id", () => {
    const fails = validateSection([nameGroup()], { first: "Ada" }, vis("qn"));
    expect(fails).toEqual([
      { code: "required", message: "This field is required.", question_id: "qn", internal_field: "qn" },
    ]);
  });
  it("both missing → still ONE group failure (not per sub-field)", () => {
    expect(validateSection([nameGroup()], {}, vis("qn")).length).toBe(1);
  });
  it("required via dependency (required_now) with no top-level required", () => {
    const grp = { type: "NameFieldsGroup", question_id: "qn" } as unknown as LgComponentConfig;
    expect(validateSection([grp], {}, vis("qn", true)).length).toBe(1);
    expect(validateSection([grp], { first: "A", last: "B" }, vis("qn", true))).toEqual([]);
  });
  it("NOT required → no failure even when empty", () => {
    const grp = { type: "NameFieldsGroup", question_id: "qn" } as unknown as LgComponentConfig;
    expect(validateSection([grp], {}, vis("qn"))).toEqual([]);
  });
  it("an authored fields override drives the requirement", () => {
    const grp = nameGroup({ props: { fields: ["given", "family"] } });
    expect(validateSection([grp], { given: "A" }, vis("qn")).length).toBe(1);
    expect(validateSection([grp], { given: "A", family: "B" }, vis("qn"))).toEqual([]);
  });
  it("a HIDDEN group is not validated", () => {
    expect(validateSection([nameGroup()], {}, [{ question_id: "qn", visible: false, required_now: false }])).toEqual([]);
  });
});

describe("P4b — validateSection enforces required across an AddressAutocomplete", () => {
  it("all parts present → passes; a missing part → one group failure", () => {
    const full = { street: "1 Main", city: "Town", state: "CA", zip: "90210" };
    expect(validateSection([addressGroup()], full, vis("qa"))).toEqual([]);
    expect(validateSection([addressGroup()], { street: "1 Main", city: "Town", state: "CA" }, vis("qa")).length).toBe(1);
  });
});

describe("P4b — presets emits a group error slot keyed by question_id", () => {
  it("a NameFieldsGroup section render carries [data-lg-error-for={question_id}]", () => {
    const html = renderSectionComponents(
      [{ type: "NameFieldsGroup", question_id: "qn", required: true, props: {} } as LeadgenComponentNode],
      defaultFunnelDesign,
      { headline_text: "", subheadline_text: null },
    );
    expect(html).toContain('data-lg-error-for="qn"');
    expect(html).toContain('class="lg-error lg-error-auto"');
  });
  it("an AddressAutocomplete section render carries its group slot", () => {
    const html = renderSectionComponents(
      [{ type: "AddressAutocompleteQuestion", question_id: "qa", required: true, props: {} } as LeadgenComponentNode],
      defaultFunnelDesign,
      { headline_text: "", subheadline_text: null },
    );
    expect(html).toContain('data-lg-error-for="qa"');
  });
});
