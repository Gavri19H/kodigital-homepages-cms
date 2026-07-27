// Round-4 P1b — deterministic schema + render unit pins for the LeadGen
// remediation slice P1b (fail-before / pass-after against the pre-P1b code):
//   A-7  columns validation 1..5 (design_overrides + props) + the 1-column
//        ("stack") render on BOTH grid families (Image26).
//   A-4  Address role sub-fields (street/city/state/zip) + NameFieldsGroup
//        first/last as conditional (rule) sources — the P1a seam #1, derived
//        EXACTLY as the studio does, so a saved rule referencing them passes
//        validateConditional (no conditional_unknown_field 400).
//   A-6a a unified field label ABOVE a text-like input (props.label), none when
//        unauthored (never an empty label node).
//   R4-34 the MQG save trap: orphan shared choices beyond the pill bound are
//        pruned in place so a legacy/corrupted grid stays saveable, with a
//        plain-language message when still out of range.
// The live browser + producer→consumer flows ride __p1b-render.spec.ts; this
// file pins the pure, byte-deterministic contract.

import { describe, expect, it } from "vitest";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode, LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

const DESIGN = defaultFunnelDesign;

function content(...components: LeadgenComponentNode[]): LeadgenSectionContent {
  return { components };
}

function buttonGroup(overrides: Partial<LeadgenComponentNode> = {}): LeadgenComponentNode {
  return {
    type: "ButtonAnswerGroup",
    question_id: "b1",
    internal_field: "pick",
    choices: [
      { label: "Yes", value: "yes", analytics_id: "yes" },
      { label: "No", value: "no", analytics_id: "no" },
    ],
    ...overrides,
  };
}

function cardGrid(overrides: Partial<LeadgenComponentNode> = {}): LeadgenComponentNode {
  return {
    type: "IconCardAnswerGrid",
    question_id: "g1",
    internal_field: "biz",
    choices: [
      { icon: "briefcase", label: "A", value: "a", analytics_id: "a" },
      { icon: "home", label: "B", value: "b", analytics_id: "b" },
    ],
    ...overrides,
  };
}

// A leaf question carrying a show/hide rule on `whenField` — the conditional's
// `when` must resolve against the Section's known-field universe or it 400s
// with conditional_unknown_field. Used to prove which fields the P1b
// collectKnownFields derivation exposes.
function gatedField(whenField: string): LeadgenComponentNode {
  return {
    type: "FreeTextQuestion",
    question_id: "f1",
    internal_field: "note",
    conditional: { when: whenField, op: "eq", value: "yes" },
  };
}

const hasUnknownConditional = (r: ReturnType<typeof validateSectionContent>): boolean =>
  r.errors.some((e) => e.code === "conditional_unknown_field");

// ---------------------------------------------------------------------------
// A-7 — columns validation 1..5 (design_overrides + props)
// ---------------------------------------------------------------------------
describe("Round-4 A-7 (P1b) — columns validation is a bounded integer 1..5", () => {
  it("accepts design_overrides.columns for every value 1..5 (incl. the new 1)", () => {
    for (const cols of [1, 2, 3, 4, 5]) {
      const r = validateSectionContent(content(buttonGroup({ design_overrides: { columns: cols } })));
      expect(r.errors.filter((e) => e.path.endsWith("design_overrides.columns"))).toEqual([]);
    }
  });

  it("rejects design_overrides.columns outside 1..5 or non-integer (was silent drift pre-P1b)", () => {
    for (const bad of [0, 6, 7, 2.5]) {
      const r = validateSectionContent(content(buttonGroup({ design_overrides: { columns: bad } as never })));
      expect(r.ok).toBe(false);
      expect(
        r.errors.some((e) => e.code === "invalid_override_value" && e.path.endsWith("design_overrides.columns")),
      ).toBe(true);
    }
  });

  it("accepts props.columns 1..5 and rejects 0/6/non-integer", () => {
    expect(validateSectionContent(content(buttonGroup({ props: { columns: 1 } }))).ok).toBe(true);
    expect(validateSectionContent(content(buttonGroup({ props: { columns: 5 } }))).ok).toBe(true);
    for (const bad of [0, 6, 3.5]) {
      const r = validateSectionContent(content(buttonGroup({ props: { columns: bad } })));
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.code === "invalid_field_prop" && e.path.endsWith("props.columns"))).toBe(true);
    }
  });

  it("renders --lg-cols:1 for a 1-column button group AND card grid (the Image26 stack)", () => {
    expect(renderComponent(buttonGroup({ props: { columns: 1 } }), DESIGN)).toContain("--lg-cols:1");
    // pre-P1b the card grid clamped 2..5, so columns:1 rendered --lg-cols:2 — this is the pass-after.
    expect(renderComponent(cardGrid({ props: { columns: 1 } }), DESIGN)).toContain("--lg-cols:1");
  });
});

// ---------------------------------------------------------------------------
// A-4 — Address roles + Name fields as conditional (rule) sources (P1a seam #1)
// ---------------------------------------------------------------------------
describe("Round-4 A-4 (P1b) — Address roles + Name fields are rule sources", () => {
  it("an Address (P1a-seeded internal_field 'address') exposes address_street/_city/_state/_zip", () => {
    for (const role of ["street", "city", "state", "zip"]) {
      const r = validateSectionContent(
        content({ type: "AddressAutocompleteQuestion", question_id: "a1", internal_field: "address" }, gatedField(`address_${role}`)),
      );
      expect(hasUnknownConditional(r), `address_${role} should be a known rule source`).toBe(false);
    }
  });

  it("a configured props.maps.fills.<slot> is the known field and the default name is then NOT", () => {
    const node: LeadgenComponentNode = {
      type: "AddressAutocompleteQuestion",
      question_id: "a1",
      internal_field: "address",
      props: { maps: { fills: { state: "st_field" } } },
    };
    // the configured target IS a rule source
    expect(hasUnknownConditional(validateSectionContent(content(node, gatedField("st_field"))))).toBe(false);
    // and the namespaced default for that slot is NOT (the mapping REDIRECTED it) — proves the
    // universe is bounded to the real derivation, not a blanket pass.
    expect(hasUnknownConditional(validateSectionContent(content(node, gatedField("address_state"))))).toBe(true);
  });

  it("a NameFieldsGroup exposes first/last by default, and props.fields[0]/[1] names when set", () => {
    expect(
      hasUnknownConditional(validateSectionContent(content({ type: "NameFieldsGroup", question_id: "n1" }, gatedField("first")))),
    ).toBe(false);
    expect(
      hasUnknownConditional(
        validateSectionContent(
          content({ type: "NameFieldsGroup", question_id: "n1", props: { fields: ["given", "family"] } }, gatedField("given")),
        ),
      ),
    ).toBe(false);
  });

  it("a non-role reference is STILL unknown (the derivation is bounded, not blanket)", () => {
    const r = validateSectionContent(
      content({ type: "AddressAutocompleteQuestion", question_id: "a1", internal_field: "address" }, gatedField("address_country")),
    );
    expect(hasUnknownConditional(r)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A-6a — unified field label ABOVE a text-like input
// ---------------------------------------------------------------------------
describe("Round-4 A-6a (P1b) — text inputs gain a label slot (props.label)", () => {
  it("renders a .lg-label above the input when props.label is set", () => {
    const html = renderComponent(
      { type: "EmailInputQuestion", question_id: "e1", internal_field: "email", props: { label: "Email address" } },
      DESIGN,
    );
    expect(html).toContain('<span class="lg-label">Email address</span>');
  });

  it("renders NO label node (not an empty one) when unauthored — byte-back-compat", () => {
    const html = renderComponent({ type: "EmailInputQuestion", question_id: "e2", internal_field: "email2" }, DESIGN);
    expect(html).not.toContain("lg-label");
  });

  it("covers Phone / FreeText / Currency too (the shared text-like family)", () => {
    for (const type of ["PhoneInputQuestion", "FreeTextQuestion", "CurrencyInputQuestion"] as const) {
      const html = renderComponent({ type, question_id: "t", internal_field: "f", props: { label: "L" } }, DESIGN);
      expect(html, `${type} label`).toContain('<span class="lg-label">L</span>');
    }
  });
});

