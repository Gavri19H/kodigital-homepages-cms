// P4b (register PC-A2 / PC-6) — error visibility by DEFAULT.
//
// The operator's "was it tested?" gap: before P4b a validation failure painted
// only an invisible red border unless the author hand-placed a ValidationError
// node bound to the field. This suite proves every answer-PRODUCING component
// now emits its own hidden [data-lg-error-for] slot in the SSR section markup
// (zero authoring), and that an authored ValidationError stays the deliberate
// override (no double slot). The live fill (error_text renders visibly on a
// format failure) is proven end-to-end in the Group-1 Playwright legs; here we
// pin the SSR contract + the render.ts fill/clear seam those legs rely on.

import { describe, expect, it } from "vitest";
import { COMPONENT_CATALOG } from "../src/public/leadgen/components/registry";
import type { ComponentType } from "../src/public/leadgen/components/registry";
import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { validateValue } from "../src/public/leadgen/runtime/validation";
import type { LgComponentConfig } from "../src/public/leadgen/runtime/state";

const DESIGN = defaultFunnelDesign;

// Count auto error slots in a section render.
const AUTO_SLOT_RE = /<p class="lg-error lg-error-auto"[^>]*><\/p>/g;
const autoSlots = (html: string): number => (html.match(AUTO_SLOT_RE) || []).length;
const slotFor = (html: string, field: string): boolean =>
  new RegExp(`<p class="lg-error lg-error-auto"[^>]*data-lg-error-for="${field}"[^>]*><\\/p>`).test(html);

// Every catalog type that PRODUCES an answer and carries a single internal_field
// must get an auto slot. NameFieldsGroup/AddressAutocomplete produce "object"
// with NO single internal_field (their subfields are handled separately) — they
// are the deliberate exception here. P5 MultiQuestionGrid is the same shape
// (produces "object", no single internal_field): it renders its OWN PER-ROW
// error slot (keyed to each row's internal_field, proven in the R1/Playwright
// legs), never a single node-level slot — so it joins the exception.
// Rework §10 removal (test repair, P2): OtherGroupSelector's render leg is
// RETIRED to a fail-safe extinct-type box (conductor ruling) that emits NO
// error slot at all (nor any answer markup) — by design, not a regression;
// it joins the exception list (own dedicated retirement coverage lives in
// leadgen-r1-answers.test.ts / leadgen-components-render.test.ts).
const SINGLE_FIELD_PRODUCERS: ComponentType[] = (
  Object.keys(COMPONENT_CATALOG) as ComponentType[]
).filter((t) => {
  const p = COMPONENT_CATALOG[t].produces;
  return (
    p !== null &&
    t !== "NameFieldsGroup" &&
    t !== "AddressAutocompleteQuestion" &&
    t !== "MultiQuestionGrid" &&
    t !== "OtherGroupSelector"
  );
});

function leaf(type: ComponentType, field: string, extra: Partial<LeadgenComponentNode> = {}): LeadgenComponentNode {
  return {
    type,
    question_id: `q_${field}`,
    internal_field: field,
    // give choice/range families a plausible bag so the renderers emit fully
    choices: [{ label: "A", value: "a" }, { label: "B", value: "b" }],
    props: { min: 0, max: 10, ...(extra.props ?? {}) },
    ...extra,
  } as LeadgenComponentNode;
}

describe("P4b PC-A2 — every answer-producing leaf emits its own hidden error slot", () => {
  it("each single-field producer renders exactly ONE auto slot bound to its internal_field", () => {
    for (const type of SINGLE_FIELD_PRODUCERS) {
      const html = renderSectionComponents([leaf(type, "the_field")], DESIGN, {
        headline_text: "",
        subheadline_text: null,
      });
      expect(autoSlots(html), `${type}: exactly one auto slot`).toBe(1);
      expect(slotFor(html, "the_field"), `${type}: slot bound to internal_field`).toBe(true);
    }
  });

  it("the auto slot ships HIDDEN and EMPTY (no error visible until the runtime fills it)", () => {
    const html = renderSectionComponents([leaf("EmailInputQuestion", "email")], DESIGN, {
      headline_text: "",
      subheadline_text: null,
    });
    expect(html).toContain('<p class="lg-error lg-error-auto" role="alert" aria-live="polite" hidden');
    // empty body — the runtime's setFieldError is the ONLY thing that fills it
    expect(html).toMatch(/data-lg-error-for="email"[^>]*><\/p>/);
  });

  it("chrome / controls / affordances (produces===null) get NO slot", () => {
    const html = renderSectionComponents(
      [
        { type: "QuestionHeadline", question_id: "h", props: { text: "Hi" } },
        { type: "ContinueButton", question_id: "c", props: { label: "Go" } },
        { type: "TrustBar", question_id: "t", props: { items: [] } },
      ] as LeadgenComponentNode[],
      DESIGN,
      { headline_text: "Hi", subheadline_text: null },
    );
    expect(autoSlots(html)).toBe(0);
  });

  it("nested producers inside containers each get their slot", () => {
    const content: LeadgenComponentNode[] = [
      {
        type: "Stack",
        question_id: "stk",
        container_id: "c1",
        children: [leaf("EmailInputQuestion", "email"), leaf("PhoneInputQuestion", "phone")],
      } as LeadgenComponentNode,
    ];
    const html = renderSectionComponents(content, DESIGN, { headline_text: "", subheadline_text: null });
    expect(autoSlots(html)).toBe(2);
    expect(slotFor(html, "email")).toBe(true);
    expect(slotFor(html, "phone")).toBe(true);
  });
});

describe("P4b PC-A2 dedupe — an authored ValidationError is the deliberate override", () => {
  it("a field with an authored ValidationError gets NO auto slot (never a double)", () => {
    const content: LeadgenComponentNode[] = [
      leaf("EmailInputQuestion", "email"),
      { type: "ValidationError", question_id: "ve", internal_field: "email", props: { text: "Bad email" } },
      leaf("PhoneInputQuestion", "phone"),
    ];
    const html = renderSectionComponents(content, DESIGN, { headline_text: "", subheadline_text: null });
    // email: authored slot present, auto slot suppressed
    expect(slotFor(html, "email"), "no AUTO slot for the authored field").toBe(false);
    expect(html).toContain('data-lg-error-for="email"'); // the authored one still binds
    // phone: no authored override → its auto slot is present
    expect(slotFor(html, "phone")).toBe(true);
    // exactly ONE data-lg-error-for per field (no double)
    const emailBindings = (html.match(/data-lg-error-for="email"/g) || []).length;
    expect(emailBindings, "exactly one error slot for email").toBe(1);
  });
});

describe("P4b PC-6 — error_text now has a slot to render into (the structural join)", () => {
  // Before P4b, error_text ("If it's wrong, say …") could only render if the
  // author ALSO placed a ValidationError bound to the field — otherwise the
  // runtime computed the message but had NOWHERE to paint it (invisible border).
  // The runtime's setFieldError resolves the slot by internal_field; this proves
  // (a) validateValue emits error_text as the message on a format failure, and
  // (b) the SSR auto slot is keyed by the EXACT internal_field it reports on —
  // so setFieldError(field) now finds a slot with ZERO authoring. (The live DOM
  // fill/clear is covered by leadgen-hidden-visibility + the Playwright legs.)
  it("email format failure carries error_text AND a matching auto slot exists — no ValidationError authored", () => {
    const field = "email";
    const component: LgComponentConfig = {
      type: "EmailInputQuestion",
      question_id: "q_email",
      internal_field: field,
      client_validation: { error_text: "If it's wrong, say so." },
    } as unknown as LgComponentConfig;

    // (a) the runtime message IS the authored copy, on a real format failure
    const failures = validateValue(component, "not-an-email", false);
    expect(failures.map((f) => f.code)).toContain("email_format");
    expect(failures[0]?.message).toBe("If it's wrong, say so.");

    // (b) the SSR emits a slot bound to that SAME internal_field (no authoring)
    const html = renderSectionComponents(
      [leaf("EmailInputQuestion", field)],
      DESIGN,
      { headline_text: "", subheadline_text: null },
    );
    expect(slotFor(html, field), "auto slot keyed by the reported internal_field").toBe(true);
    // the field the runtime reports === the field the slot binds → setFieldError resolves it
    expect(failures.length).toBeGreaterThan(0);
  });

  it("required failure keeps its OWN copy (deliberately not overridden by error_text)", () => {
    const component: LgComponentConfig = {
      type: "FreeTextQuestion",
      question_id: "q1",
      internal_field: "name",
      required: true,
      client_validation: { required: true, error_text: "custom" },
    } as unknown as LgComponentConfig;
    const failures = validateValue(component, "", true);
    expect(failures.map((f) => f.code)).toEqual(["required"]);
    // required message is its own copy — the existing deliberate rule (P4b keeps it)
    expect(failures[0]?.message).toBe("This field is required.");
  });
});
