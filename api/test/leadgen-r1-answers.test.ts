// Section Builder v3.1 REMEDIATION — phase R1 (runtime answer integrity).
// Worker-program half: the pieces provable without the DOM-lib engine —
//   * Test A (i)(ii): EVERY answer-producing catalog type renders a runtime
//     RECORDING HOOK (data-lg-input OR data-lg-choice). Enumerated from
//     COMPONENT_CATALOG so a future answer type that renders NEITHER fails here
//     until it is wired (the register M5 anti-false-PASS discipline: prove the
//     hook exists in real preset output, never assume it). The engine-drive
//     half (iii — recordUserAnswer actually captures the value) is the DOM-lib
//     runtime program: test/leadgen-r1-runtime-recording.test.ts.
//   * E1-NEW-1 / S2-3 markup: the dropdown/searchable <select> and the range
//     <input> now carry data-lg-input (were mute before); the range wrapper
//     carries data-currency for the currency format so the runtime can rebuild
//     the live value text byte-identically.
//   * E1-NEW-3: MultiChoice min/max validate the SELECTION COUNT (array answer)
//     — validated nowhere before (the scalar leg skips arrays).
//   * E1-C1: the authored error_text is projected into client_validation and
//     overrides the generic per-rule copy on value-wrong failures.
//   * E1-C2: a letters/digits pattern_preset becomes the grounded client regex
//     (the SAME anchored shapes the server's §6.5 free-text preset leg uses).

import { describe, expect, it } from "vitest";
import { COMPONENT_CATALOG } from "../src/public/leadgen/components/registry";
import type { ComponentType } from "../src/public/leadgen/components/registry";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { toPublicComponent } from "../src/public/leadgen/config-dto";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { validateValue } from "../src/public/leadgen/runtime/validation";
import type { LgComponentConfig } from "../src/public/leadgen/runtime/state";

const DESIGN = defaultFunnelDesign;

const CHOICES = [
  { label: "Sole Proprietor", value: "sole_prop", analytics_id: "biz_sole" },
  { label: "Partnership", value: "partnership", analytics_id: "biz_part" },
];
const ICON_CHOICES = CHOICES.map((c, i) => ({ ...c, icon: i === 0 ? "🏢" : "🤝" }));
const IMAGE_CHOICES = CHOICES.map((c, i) => ({ ...c, imageMediaId: `m${i + 1}` }));

// A minimal VALID node for EVERY answer-producing catalog type (category
// "question"). The lockstep guard below fails if the catalog gains a question
// type not covered here — so the recording-hook enumeration can never silently
// skip a new type.
const ANSWER_NODE_SPECS: Partial<Record<ComponentType, LeadgenComponentNode>> = {
  RangeQuestion: { type: "RangeQuestion", question_id: "q", internal_field: "amt", props: { min: 0, max: 100, default: 50 } },
  CurrencyRangeQuestion: { type: "CurrencyRangeQuestion", question_id: "q", internal_field: "loan", props: { min: 10000, max: 1000000, default: 330000, currency: "$" } },
  NumberRangeQuestion: { type: "NumberRangeQuestion", question_id: "q", internal_field: "count", props: { min: 1, max: 9, default: 3 } },
  ButtonAnswerGroup: { type: "ButtonAnswerGroup", question_id: "q", internal_field: "pick", choices: CHOICES },
  TwoButtonYesNo: { type: "TwoButtonYesNo", question_id: "q", internal_field: "insured", props: {} },
  IconCardAnswerGrid: { type: "IconCardAnswerGrid", question_id: "q", internal_field: "biz", choices: ICON_CHOICES, props: { columns: 3 } },
  ImageCardAnswerGrid: { type: "ImageCardAnswerGrid", question_id: "q", internal_field: "carrier", choices: IMAGE_CHOICES, props: { columns: 4 } },
  MultiChoiceCardGroup: { type: "MultiChoiceCardGroup", question_id: "q", internal_field: "features", choices: CHOICES, props: { min: 1, max: 2 } },
  MultiQuestionGrid: { type: "MultiQuestionGrid", question_id: "q", choices: CHOICES, props: { rows: [{ label: "Homeowner", internal_field: "mqg_home", default: "sole_prop" }, { label: "Married", internal_field: "mqg_married" }] } },
  DropdownQuestion: { type: "DropdownQuestion", question_id: "q", internal_field: "insurer", choices: CHOICES, props: { placeholder: "Pick one" } },
  SearchableDropdownQuestion: { type: "SearchableDropdownQuestion", question_id: "q", internal_field: "make", choices: CHOICES, props: { placeholder: "Pick one" } },
  OtherGroupSelector: { type: "OtherGroupSelector", question_id: "q", internal_field: "carrier2", choices: CHOICES, choiceDisplay: { mainValues: ["sole_prop"], otherGroupEnabled: true, otherGroupLabel: "Other", searchableOther: false } },
  FreeTextQuestion: { type: "FreeTextQuestion", question_id: "q", internal_field: "note", props: { placeholder: "Type…" } },
  NumberInputQuestion: { type: "NumberInputQuestion", question_id: "q", internal_field: "age", props: { min: 18, max: 99 } },
  CurrencyInputQuestion: { type: "CurrencyInputQuestion", question_id: "q", internal_field: "income", props: { currency: "$" } },
  EmailInputQuestion: { type: "EmailInputQuestion", question_id: "q", internal_field: "email", required: true },
  PhoneInputQuestion: { type: "PhoneInputQuestion", question_id: "q", internal_field: "phone" },
  NameFieldsGroup: { type: "NameFieldsGroup", question_id: "q", internal_field: "name", required: true },
  DateQuestion: { type: "DateQuestion", question_id: "q", internal_field: "dob", props: {} },
  ZIPInputQuestion: { type: "ZIPInputQuestion", question_id: "q", internal_field: "zip", props: {} },
  AddressAutocompleteQuestion: { type: "AddressAutocompleteQuestion", question_id: "q", internal_field: "addr", props: { provider: "google" } },
};

// The recording MECHANISM each answer type uses (pins a regression that flips a
// type's path). data-lg-input → engine input/change → handleInputEvent;
// data-lg-choice → engine click → handleChoiceActivation. Dropdowns record via
// the <select> change (data-lg-input) even though their <option>s also carry
// data-lg-choice for selection-class restore.
const INPUT_MECHANISM = new Set<ComponentType>([
  "RangeQuestion", "CurrencyRangeQuestion", "NumberRangeQuestion",
  "DropdownQuestion", "SearchableDropdownQuestion",
  "FreeTextQuestion", "NumberInputQuestion", "CurrencyInputQuestion",
  "EmailInputQuestion", "PhoneInputQuestion", "NameFieldsGroup",
  "DateQuestion", "ZIPInputQuestion", "AddressAutocompleteQuestion",
]);
const CHOICE_MECHANISM = new Set<ComponentType>([
  "ButtonAnswerGroup", "TwoButtonYesNo", "IconCardAnswerGrid",
  "ImageCardAnswerGrid", "MultiChoiceCardGroup", "OtherGroupSelector",
  // P5 (PC-10): each row is a click-to-answer pill pair — records via
  // data-lg-choice (per-row [data-lg-question] wrapper), like the other choice
  // families.
  "MultiQuestionGrid",
]);

const ANSWER_TYPES = (Object.keys(COMPONENT_CATALOG) as ComponentType[]).filter(
  (t) => COMPONENT_CATALOG[t].category === "question",
);

function comp(partial: Partial<LgComponentConfig>): LgComponentConfig {
  return { type: "FreeTextQuestion", question_id: "q", props: {}, ...partial };
}

// ---------------------------------------------------------------------------
// Test A — answer-recording hook matrix (i)(ii): render every answer type,
// prove it exposes a real recording hook. No type may be skipped.
// ---------------------------------------------------------------------------

describe("R1 Test A — every answer-producing type exposes a recording hook", () => {
  it("every category:'question' type has produces!==null AND a spec (lockstep — a new answer type FAILS here until covered)", () => {
    for (const t of ANSWER_TYPES) {
      expect(COMPONENT_CATALOG[t].produces, `${t}.produces`).not.toBeNull();
      expect(ANSWER_NODE_SPECS[t], `add ${t} to ANSWER_NODE_SPECS + a mechanism set`).toBeDefined();
      expect(
        INPUT_MECHANISM.has(t) !== CHOICE_MECHANISM.has(t),
        `${t} must be in EXACTLY one mechanism set`,
      ).toBe(true);
    }
    // and the specs/sets carry no stale non-question entries
    expect(new Set([...INPUT_MECHANISM, ...CHOICE_MECHANISM])).toEqual(new Set(ANSWER_TYPES));
    expect(Object.keys(ANSWER_NODE_SPECS).sort()).toEqual([...ANSWER_TYPES].sort());
  });

  it.each(ANSWER_TYPES)(
    "%s renders a recording hook (data-lg-input OR data-lg-choice)",
    (t) => {
      const html = renderComponent(ANSWER_NODE_SPECS[t]!, DESIGN);
      const hasInput = html.includes("data-lg-input");
      const hasChoice = html.includes("data-lg-choice");
      expect(
        hasInput || hasChoice,
        `${t} renders NEITHER data-lg-input nor data-lg-choice — its answers can never record (register S2-3/E1-NEW-1 class)`,
      ).toBe(true);
    },
  );

  it.each(ANSWER_TYPES)("%s records via its expected mechanism", (t) => {
    const html = renderComponent(ANSWER_NODE_SPECS[t]!, DESIGN);
    if (INPUT_MECHANISM.has(t)) {
      expect(/data-lg-input/.test(html), `${t} must carry data-lg-input`).toBe(true);
    } else {
      expect(/data-lg-choice/.test(html), `${t} must carry data-lg-choice`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// E1-NEW-1 — dropdown + searchable dropdown <select> carry data-lg-input
// ---------------------------------------------------------------------------

describe("R1 E1-NEW-1 — dropdowns record via a data-lg-input <select>", () => {
  it("DropdownQuestion: the <select> carries data-lg-input (was mute before)", () => {
    const html = renderComponent(ANSWER_NODE_SPECS.DropdownQuestion!, DESIGN);
    expect(/<select[^>]*\bdata-lg-input\b[^>]*>/.test(html)).toBe(true);
    // per-option data-lg-choice kept (feeds applySelectionClasses on restore)
    expect(html).toContain('data-lg-choice="sole_prop"');
  });

  it("SearchableDropdownQuestion: exactly ONE data-lg-input, on the <select> — the search input is a filter only", () => {
    const html = renderComponent(ANSWER_NODE_SPECS.SearchableDropdownQuestion!, DESIGN);
    expect(/<select[^>]*\bdata-lg-input\b[^>]*>/.test(html)).toBe(true);
    expect(html.split("data-lg-input").length - 1).toBe(1);
    // the search box is data-lg-dropdown-search, NOT data-lg-input
    expect(/<input[^>]*data-lg-dropdown-search[^>]*>/.test(html)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S2-3 — range <input> carries data-lg-input + wrapper data-currency
// ---------------------------------------------------------------------------

describe("R1 S2-3 — slider records + carries the live-format hook", () => {
  it("range input carries data-lg-input", () => {
    const html = renderComponent(ANSWER_NODE_SPECS.RangeQuestion!, DESIGN);
    expect(/<input[^>]*type="range"[^>]*\bdata-lg-input\b/.test(html)).toBe(true);
  });

  it("currency range wrapper carries data-currency; number range does not", () => {
    const cur = renderComponent(ANSWER_NODE_SPECS.CurrencyRangeQuestion!, DESIGN);
    expect(/<div class="lg-range"[^>]*data-currency="\$"/.test(cur)).toBe(true);
    const num = renderComponent(ANSWER_NODE_SPECS.NumberRangeQuestion!, DESIGN);
    expect(num).not.toContain("data-currency");
  });
});

// ---------------------------------------------------------------------------
// E1-NEW-3 — MultiChoice min/max validate the selection COUNT (array answer)
// ---------------------------------------------------------------------------

describe("R1 E1-NEW-3 — array min/max validate selection count", () => {
  const multi = (cv: Record<string, unknown>, required = false): LgComponentConfig =>
    comp({ type: "MultiChoiceCardGroup", answer_type: "array", required, client_validation: cv });

  it("within [min,max] passes; below min → min_count; above max → max_count", () => {
    const c = multi({ min: 2, max: 3 });
    expect(validateValue(c, ["a", "b"], false)).toEqual([]);
    expect(validateValue(c, ["a", "b", "c"], false)).toEqual([]);
    expect(validateValue(c, ["a"], false).map((f) => f.code)).toEqual(["min_count"]);
    expect(validateValue(c, ["a", "b", "c", "d"], false).map((f) => f.code)).toEqual(["max_count"]);
  });

  it("human copy (no jargon): 'Select at least/most N options.'", () => {
    expect(validateValue(multi({ min: 2 }), ["a"], false)[0]?.message).toBe("Select at least 2 options.");
    expect(validateValue(multi({ max: 2 }), ["a", "b", "c"], false)[0]?.message).toBe("Select at most 2 options.");
  });

  it("an empty selection is 'required' when required, otherwise passes (no count failure)", () => {
    // isAnswered([]) === false → required short-circuits before the count leg
    expect(validateValue(multi({ required: true, min: 2 }, true), [], true).map((f) => f.code)).toEqual(["required"]);
    expect(validateValue(multi({ min: 2 }), [], false)).toEqual([]);
  });

  it("FAIL-BEFORE evidence: the scalar numeric leg never fired for arrays (asFiniteNumber(array)===null) — a min on an array under-count would previously return []", () => {
    // This is the behavior the branch FIXES; asserting the NEW behavior here.
    expect(validateValue(multi({ min: 3 }), ["a", "b"], false).map((f) => f.code)).toEqual(["min_count"]);
  });

  it("scalar min/max still behaves (no regression)", () => {
    const c = comp({ type: "NumberInputQuestion", client_validation: { min: 10, max: 20 } });
    expect(validateValue(c, 15, false)).toEqual([]);
    expect(validateValue(c, 5, false).map((f) => f.code)).toEqual(["min"]);
    expect(validateValue(c, 25, false).map((f) => f.code)).toEqual(["max"]);
  });
});

// ---------------------------------------------------------------------------
// E1-C1 — error_text surfaces (config-dto projection + validateValue override)
// ---------------------------------------------------------------------------

describe("R1 E1-C1 — authored error_text surfaces as the failure message", () => {
  it("config-dto projects props.error_text into client_validation (non-empty string only)", () => {
    const node: LeadgenComponentNode = { type: "EmailInputQuestion", question_id: "q", internal_field: "email", props: { error_text: "That email looks off." } };
    expect(toPublicComponent(node).client_validation?.["error_text"]).toBe("That email looks off.");
    const blank: LeadgenComponentNode = { type: "EmailInputQuestion", question_id: "q", internal_field: "email", props: { error_text: "   " } };
    expect(toPublicComponent(blank).client_validation?.["error_text"]).toBeUndefined();
  });

  it("validateValue uses error_text as the message for a format failure; falls back to generic copy when absent", () => {
    const withText = comp({ type: "EmailInputQuestion", client_validation: { error_text: "Double-check that email." } });
    const f = validateValue(withText, "not-an-email", false);
    expect(f.map((x) => x.code)).toEqual(["email_format"]);
    expect(f[0]?.message).toBe("Double-check that email.");
    const without = comp({ type: "EmailInputQuestion", client_validation: {} });
    expect(validateValue(without, "not-an-email", false)[0]?.message).toBe("Enter a valid email address.");
  });

  it("error_text overrides range + array-count messages too", () => {
    expect(
      validateValue(comp({ type: "NumberInputQuestion", client_validation: { min: 10, error_text: "Too small." } }), 5, false)[0]?.message,
    ).toBe("Too small.");
    expect(
      validateValue(comp({ type: "MultiChoiceCardGroup", answer_type: "array", client_validation: { min: 2, error_text: "Pick more." } }), ["a"], false)[0]?.message,
    ).toBe("Pick more.");
  });

  it("error_text does NOT override the 'required' (missing, not wrong) message", () => {
    const req = comp({ type: "FreeTextQuestion", required: true, client_validation: { required: true, error_text: "custom" } });
    const f = validateValue(req, "", true);
    expect(f.map((x) => x.code)).toEqual(["required"]);
    expect(f[0]?.message).toBe("This field is required.");
  });
});

// ---------------------------------------------------------------------------
// E1-C2 — pattern preset → regex (letters/digits) enforced client-side
// ---------------------------------------------------------------------------

describe("R1 E1-C2 — letters/digits pattern_preset becomes an enforceable regex", () => {
  const node = (props: Record<string, unknown>): LeadgenComponentNode => ({
    type: "FreeTextQuestion", question_id: "q", internal_field: "note", props,
  });

  it("config-dto translates the preset to the grounded server regex (letters/digits); custom wins; none/absent = no rule", () => {
    expect(toPublicComponent(node({ pattern_preset: "letters" })).client_validation?.["pattern"]).toBe("^[A-Za-z ]+$");
    expect(toPublicComponent(node({ pattern_preset: "digits" })).client_validation?.["pattern"]).toBe("^[0-9]+$");
    // custom keeps its authored regex (never overridden)
    expect(toPublicComponent(node({ pattern_preset: "custom", pattern: "^X+$" })).client_validation?.["pattern"]).toBe("^X+$");
    expect(toPublicComponent(node({ pattern_preset: "none" })).client_validation?.["pattern"]).toBeUndefined();
    expect(toPublicComponent(node({})).client_validation?.["pattern"]).toBeUndefined();
  });

  it("the projected regex actually enforces at validateValue (the preset's promise)", () => {
    const letters = comp({ type: "FreeTextQuestion", client_validation: { pattern: "^[A-Za-z ]+$" } });
    expect(validateValue(letters, "John Smith", false)).toEqual([]);
    expect(validateValue(letters, "John3", false).map((f) => f.code)).toEqual(["pattern"]);
    const digits = comp({ type: "FreeTextQuestion", client_validation: { pattern: "^[0-9]+$" } });
    expect(validateValue(digits, "12345", false)).toEqual([]);
    expect(validateValue(digits, "12a", false).map((f) => f.code)).toEqual(["pattern"]);
  });
});
