// LeadGen Rework (LEADGEN-REWORK-03) — P2 slice S2.1 schema/catalog/config-dto
// proofs. EVERY assertion runs through the REAL functions — no mocks, no
// hand-built consumer inputs:
//   * validateSectionContent  (the save gate — content-schema.ts)
//   * collectKnownAnswerFields (the field universe — content-schema.ts)
//   * parsePhoneMaskPattern    (the M8 mask grammar — content-schema.ts)
//   * toPublicComponent / expandPublicComponents (the /lg/config DTO — config-dto.ts)
//   * normalizeAnswers         (the answers.ts producer — the slider parity oracle)
//   * COMPONENT_CAPABILITIES   (the §6.2 matrix — registry.ts)
// Governing anchors: §6.2 (matrix), §6.3 (label/helper), §6.4 (choice defaults),
// §6.5 (Other), §6.6 (selected marker), §6.8/M7 (slider), M8 (mask), M9 (address),
// plus the §6 seam rule (legacy shapes keep validating; unknown types fail SAFE).

import { describe, expect, it } from "vitest";
import {
  validateSectionContent,
  collectKnownAnswerFields,
  parsePhoneMaskPattern,
  isDualRangeSlider,
  LEADGEN_PHONE_MASK_ERROR,
  LEADGEN_SLIDER_TYPES,
  LEADGEN_SELECTED_MARKERS,
  LEADGEN_ADDRESS_FIELD_KINDS,
  type LeadgenComponentNode,
} from "../src/public/leadgen/components/content-schema";
import { toPublicComponent, expandPublicComponents } from "../src/public/leadgen/config-dto";
import { COMPONENT_CATALOG, COMPONENT_CAPABILITIES } from "../src/public/leadgen/components/registry";
import { normalizeAnswers } from "../src/leadgen/answers";
import { validateValue } from "../src/public/leadgen/runtime/validation";
import type { LgComponentConfig } from "../src/public/leadgen/runtime/state";

// ---- tiny builders (loose typing — the validator/DTO accept `unknown`) ------
type Node = Record<string, unknown>;
const section = (components: Node[], extra: Record<string, unknown> = {}) => ({ components, ...extra });
const codes = (content: unknown): string[] => validateSectionContent(content).errors.map((e) => e.code);
const okOf = (content: unknown): boolean => validateSectionContent(content).ok;
const errAt = (content: unknown, code: string, needlePath?: string) =>
  validateSectionContent(content).errors.find(
    (e) => e.code === code && (needlePath === undefined || e.path.includes(needlePath)),
  );
const dto = (node: Node) => toPublicComponent(node as unknown as LeadgenComponentNode);

// A minimal valid single-select button group with two base choices.
const buttons = (extra: Node = {}): Node => ({
  type: "ButtonAnswerGroup",
  question_id: "q_btn",
  internal_field: "pick",
  choices: [
    { label: "A", value: "a", analytics_id: "a" },
    { label: "B", value: "b", analytics_id: "b" },
  ],
  ...extra,
});

// ===========================================================================
// §6.2 — the capability matrix (spec shape + faithful cells + exhaustiveness)
// ===========================================================================
describe("§6.2 capability matrix (COMPONENT_CAPABILITIES)", () => {
  it("is EXHAUSTIVE over the catalog (one spec per ComponentType)", () => {
    expect(Object.keys(COMPONENT_CAPABILITIES).sort()).toEqual(Object.keys(COMPONENT_CATALOG).sort());
  });

  it("every spec carries the full 12-flag shape", () => {
    const keys = [
      "label_helper", "required", "choices_editor", "other_editor", "default_kind",
      "selected_marker", "columns", "accept_type_swap", "mask_builder", "slider_type",
      "field_set_maps", "placeholder",
    ].sort();
    for (const [type, spec] of Object.entries(COMPONENT_CAPABILITIES)) {
      expect(Object.keys(spec).sort(), `spec shape for ${type}`).toEqual(keys);
    }
  });

  it("transcribes the §6.2 cells faithfully (representative rows/columns)", () => {
    // Other editor: single-select cards/buttons ✓; Dropdown ✗ (the #10 fix),
    // MultiChoice ✗, YesNo ✗.
    expect(COMPONENT_CAPABILITIES.ButtonAnswerGroup.other_editor).toBe(true);
    expect(COMPONENT_CAPABILITIES.IconCardAnswerGrid.other_editor).toBe(true);
    expect(COMPONENT_CAPABILITIES.ImageCardAnswerGrid.other_editor).toBe(true);
    expect(COMPONENT_CAPABILITIES.DropdownQuestion.other_editor).toBe(false);
    expect(COMPONENT_CAPABILITIES.SearchableDropdownQuestion.other_editor).toBe(false);
    expect(COMPONENT_CAPABILITIES.MultiChoiceCardGroup.other_editor).toBe(false);
    expect(COMPONENT_CAPABILITIES.TwoButtonYesNo.other_editor).toBe(false);
    // Default kind (§6.4).
    expect(COMPONENT_CAPABILITIES.ButtonAnswerGroup.default_kind).toBe("choice");
    expect(COMPONENT_CAPABILITIES.TwoButtonYesNo.default_kind).toBe("yesno");
    expect(COMPONENT_CAPABILITIES.DropdownQuestion.default_kind).toBe("dropdown");
    expect(COMPONENT_CAPABILITIES.NumberRangeQuestion.default_kind).toBe("range");
    expect(COMPONENT_CAPABILITIES.MultiChoiceCardGroup.default_kind).toBe(null);
    // Per-type control columns.
    expect(COMPONENT_CAPABILITIES.PhoneInputQuestion.mask_builder).toBe(true);
    expect(COMPONENT_CAPABILITIES.NumberRangeQuestion.slider_type).toBe(true);
    expect(COMPONENT_CAPABILITIES.AddressAutocompleteQuestion.field_set_maps).toBe(true);
    expect(COMPONENT_CAPABILITIES.FreeTextQuestion.accept_type_swap).toBe(true);
    expect(COMPONENT_CAPABILITIES.PhoneInputQuestion.accept_type_swap).toBe(true);
    // Nuanced cells: YesNo choices "labels_only"; Address/NameFields "per_field".
    expect(COMPONENT_CAPABILITIES.TwoButtonYesNo.choices_editor).toBe("labels_only");
    expect(COMPONENT_CAPABILITIES.AddressAutocompleteQuestion.required).toBe("per_field");
    expect(COMPONENT_CAPABILITIES.NameFieldsGroup.label_helper).toBe("per_field");
    expect(COMPONENT_CAPABILITIES.NameFieldsGroup.placeholder).toBe("per_field");
    // Selected-marker: the five choice types ✓; text/dropdown ✗.
    for (const t of ["TwoButtonYesNo", "ButtonAnswerGroup", "IconCardAnswerGrid", "ImageCardAnswerGrid", "MultiChoiceCardGroup"] as const) {
      expect(COMPONENT_CAPABILITIES[t].selected_marker, t).toBe(true);
    }
    expect(COMPONENT_CAPABILITIES.DropdownQuestion.selected_marker).toBe(false);
    // Containers: only the Columns control; chrome/text: nothing.
    expect(COMPONENT_CAPABILITIES.Stack.columns).toBe(true);
    expect(COMPONENT_CAPABILITIES.TextBlock).toEqual(COMPONENT_CAPABILITIES.ImageBlock); // both all-off
    expect(COMPONENT_CAPABILITIES.ProgressBar.label_helper).toBe(false);
  });
});

// ===========================================================================
// §6.3 — per-question label + helper
// ===========================================================================
describe("§6.3 label + helper on answer components", () => {
  it("accepts a label + helper on choice / dropdown / slider / phone / address", () => {
    for (const node of [
      buttons({ props: { label: "Pick one", helper: "choose carefully" } }),
      { type: "DropdownQuestion", question_id: "q", internal_field: "d", choices: [{ label: "A", value: "a", analytics_id: "a" }], props: { label: "Credit score", helper: "estimate" } },
      { type: "NumberRangeQuestion", question_id: "q", internal_field: "n", props: { min: 0, max: 9, label: "How much?", helper: "in $k" } },
      { type: "PhoneInputQuestion", question_id: "q", internal_field: "p", props: { label: "Phone", helper: "mobile" } },
      { type: "AddressAutocompleteQuestion", question_id: "q", props: { label: "Address" } },
    ]) {
      expect(okOf(section([node])), JSON.stringify(node.type)).toBe(true);
    }
  });

  it("rejects a label over 120 chars (§6.3) — and the DTO carries label/helper through props", () => {
    const long = "x".repeat(121);
    expect(errAt(section([buttons({ props: { label: long } })]), "invalid_field_prop", "props.label")?.message).toContain("120");
    expect(okOf(section([buttons({ props: { label: "x".repeat(120), helper: "ok" } })]))).toBe(true);
    // config-dto passthrough — renderers (S2.2) consume label/helper from props.
    const c = dto(buttons({ props: { label: "Pick one", helper: "hint" } }));
    expect(c.props["label"]).toBe("Pick one");
    expect(c.props["helper"]).toBe("hint");
  });
});

// ===========================================================================
// §6.4 — defaults for choice groups
// ===========================================================================
describe("§6.4 choice-group defaults", () => {
  it("accepts a defaultValue that is one of the choices (Buttons / IconCards / ImageCards)", () => {
    expect(okOf(section([buttons({ props: { defaultValue: "b" } })]))).toBe(true);
    const icon = { type: "IconCardAnswerGrid", question_id: "q", internal_field: "i", choices: [{ icon: "star", label: "A", value: "a", analytics_id: "a" }, { icon: "home", label: "B", value: "b", analytics_id: "b" }], props: { defaultValue: "a" } };
    expect(okOf(section([icon]))).toBe(true);
    // config-dto projects props.defaultValue → default_answer.
    expect(dto(buttons({ props: { defaultValue: "b" } })).default_answer).toEqual({ value: "b", answer_source: "default_applied" });
  });

  it("rejects a defaultValue that is NOT one of the choices", () => {
    expect(errAt(section([buttons({ props: { defaultValue: "zzz" } })]), "invalid_choice", "defaultValue")?.message).toContain("not one of");
  });

  it("rejects a default on a multi-select (MultiChoiceCardGroup has no default in v1)", () => {
    const multi = { type: "MultiChoiceCardGroup", question_id: "q", internal_field: "m", choices: [{ label: "A", value: "a", analytics_id: "a" }], props: { defaultValue: "a" } };
    expect(errAt(section([multi]), "invalid_field_prop", "defaultValue")?.message).toContain("multi-select");
  });
});

// ===========================================================================
// §6.5 — authored "Other" values (single-select choice groups only)
// ===========================================================================
describe("§6.5 authored Other values", () => {
  const withOther = (other: unknown, base?: Node) =>
    section([buttons({ ...(base ?? {}), props: { other } })]);

  it("accepts a valid Other list; DTO merges other values into valid_values (join the answer domain)", () => {
    const other = { enabled: true, label: "Other", choices: [
      { label: "Progressive", value: "prog", analytics_id: "prog" },
      { label: "Allstate", value: "all", analytics_id: "all" },
    ] };
    expect(okOf(withOther(other))).toBe(true);
    const c = dto(buttons({ props: { other } }));
    expect(c.valid_values).toEqual(["a", "b", "prog", "all"]); // base ∪ other
    // The node's own answer field stays the universe entry (other adds VALUES,
    // not new field names).
    expect(collectKnownAnswerFields(section([buttons({ props: { other } })]).components).has("pick")).toBe(true);
  });

  it("rejects an Other value that duplicates a base choice value (unique vs base)", () => {
    const other = { choices: [{ label: "Dup", value: "a", analytics_id: "dup" }] };
    expect(errAt(withOther(other), "invalid_choice", "other.choices[0].value")?.message).toContain("duplicates a base");
  });

  it("rejects more than 50 Other values", () => {
    const choices = Array.from({ length: 51 }, (_, i) => ({ label: `o${i}`, value: `o${i}`, analytics_id: `o${i}` }));
    expect(errAt(withOther({ choices }), "invalid_field_prop", "other.choices")?.message).toContain("at most 50");
  });

  it("rejects Other on a Dropdown (matrix #10) and on MultiChoice", () => {
    const dropdown = { type: "DropdownQuestion", question_id: "q", internal_field: "d", choices: [{ label: "A", value: "a", analytics_id: "a" }], props: { other: { choices: [{ label: "X", value: "x", analytics_id: "x" }] } } };
    expect(errAt(section([dropdown]), "invalid_field_prop", "props.other")?.message).toContain("single-select");
    const multi = { type: "MultiChoiceCardGroup", question_id: "q", internal_field: "m", choices: [{ label: "A", value: "a", analytics_id: "a" }], props: { other: { choices: [{ label: "X", value: "x", analytics_id: "x" }] } } };
    expect(codes(section([multi]))).toContain("invalid_field_prop");
  });
});

// ===========================================================================
// §6.6 — ✓-in-selected marker (per-choice AND per-node axes)
// ===========================================================================
describe("§6.6 selected marker", () => {
  it("accepts a per-NODE marker on choice types; rejects a bad value; rejects it on a non-choice type", () => {
    for (const m of LEADGEN_SELECTED_MARKERS) {
      expect(okOf(section([buttons({ props: { selected_marker: m } })])), m).toBe(true);
    }
    expect(errAt(section([buttons({ props: { selected_marker: "glow" } })]), "invalid_field_prop", "selected_marker")?.message).toContain("wash|mark");
    // A text input has no selected-marker control (matrix) → reject.
    const text = { type: "FreeTextQuestion", question_id: "q", internal_field: "t", props: { selected_marker: "mark" } };
    expect(errAt(section([text]), "invalid_field_prop", "selected_marker")?.message).toContain("only valid");
  });

  it("accepts a per-CHOICE marker in choice.style; rejects a bad value", () => {
    const good = buttons({ choices: [{ label: "A", value: "a", analytics_id: "a", style: { selected_marker: "mark" } }, { label: "B", value: "b", analytics_id: "b" }] });
    expect(okOf(section([good]))).toBe(true);
    const bad = buttons({ choices: [{ label: "A", value: "a", analytics_id: "a", style: { selected_marker: "bogus" } }, { label: "B", value: "b", analytics_id: "b" }] });
    expect(errAt(section([bad]), "invalid_choice_style", "selected_marker")?.message).toContain("wash|mark");
  });
});

// ===========================================================================
// §6.8 / M7 — slider types (single, dual_range, stepper, from_to, radial)
// ===========================================================================
describe("§6.8 slider types", () => {
  const slider = (props: Node): Node => ({ type: "NumberRangeQuestion", question_id: "q_s", internal_field: "amt", props: { min: 0, max: 100, ...props } });

  it("accepts all five slider_type values", () => {
    for (const st of LEADGEN_SLIDER_TYPES) {
      expect(okOf(section([slider({ slider_type: st, step: 1 })])), st).toBe(true);
    }
  });

  it("rejects an unknown slider_type and rejects slider_type on a non-slider type", () => {
    expect(errAt(section([slider({ slider_type: "wheel" })]), "invalid_field_prop", "slider_type")?.message).toContain("single|dual_range");
    const notSlider = { type: "FreeTextQuestion", question_id: "q", internal_field: "t", props: { slider_type: "single" } };
    expect(errAt(section([notSlider]), "invalid_field_prop", "slider_type")?.message).toContain("only valid on a Slider");
  });

  it("stepper REQUIRES a numeric step", () => {
    expect(codes(section([slider({ slider_type: "stepper" })]))).toContain("invalid_field_prop");
    expect(okOf(section([slider({ slider_type: "stepper", step: 5 })]))).toBe(true);
  });

  it("currency_affix is a display-only boolean (never touches type/answer_type — the Image9 fix)", () => {
    expect(okOf(section([slider({ slider_type: "single", currency_affix: true })]))).toBe(true);
    expect(okOf(section([slider({ slider_type: "single", currency_affix: false })]))).toBe(true);
    expect(errAt(section([slider({ slider_type: "single", currency_affix: "yes" })]), "invalid_field_prop", "currency_affix")).toBeDefined();
  });

  it("a dual_range / from_to slider MAY carry answer_type 'object'; single MUST NOT", () => {
    expect(okOf(section([{ ...slider({ slider_type: "dual_range" }), answer_type: "object" }]))).toBe(true);
    expect(okOf(section([{ ...slider({ slider_type: "from_to" }), answer_type: "object" }]))).toBe(true);
    // object on a single slider is still the catalog mismatch (carve-out is scoped to dual/from_to).
    expect(codes(section([{ ...slider({ slider_type: "single" }), answer_type: "object" }]))).toContain("answer_type_mismatch");
  });

  it("PARITY: a dual_range slider's field universe == answers.ts fieldsOf output ({base}_min/{base}_max, no base)", () => {
    const dual: Node = { ...slider({ slider_type: "dual_range" }), answer_type: "object" };
    // content-schema field universe.
    const universe = collectKnownAnswerFields(section([dual]).components);
    expect(universe.has("amt_min")).toBe(true);
    expect(universe.has("amt_max")).toBe(true);
    expect(universe.has("amt")).toBe(false); // base excluded (no single answer)
    expect(isDualRangeSlider(dual)).toBe(true);
    // config-dto projected universe (expandPublicComponents → collectKnownAnswerFields) == raw.
    const projected = collectKnownAnswerFields(section([dual]).components.flatMap((n) => expandPublicComponents(n as unknown as LeadgenComponentNode)));
    expect([...projected].sort()).toEqual([...universe].sort());
    // answers.ts fieldsOf oracle: normalizeAnswers expands to amt_min/amt_max exactly.
    const norm = normalizeAnswers(section([dual]) as never, { amt_min: 5, amt_max: 40 });
    expect(Object.keys(norm.answers).sort()).toEqual(["amt_max", "amt_min"]);
  });

  it("PARITY: a single slider keeps its scalar internal_field on BOTH sides", () => {
    const single = slider({ slider_type: "single" });
    expect(collectKnownAnswerFields(section([single]).components).has("amt")).toBe(true);
    expect(isDualRangeSlider(single)).toBe(false);
    const norm = normalizeAnswers(section([single]) as never, { amt: 50 });
    expect(Object.keys(norm.answers)).toEqual(["amt"]);
  });
});

// ===========================================================================
// M8 (§6.9) — phone mask grammar
// ===========================================================================
describe("M8 phone mask grammar", () => {
  const VALID: Array<[string, number[], number]> = [
    ["(3) 3-4", [3, 3, 4], 10],
    ["10-5", [10, 5], 15],
    ["3.3.4", [3, 3, 4], 10],
    ["3 3 4", [3, 3, 4], 10],
    ["3/3/4", [3, 3, 4], 10],
    ["4", [4], 4],
    ["2-2", [2, 2], 4],
    ["14", [14], 14],
    ["3-3-3-3-3-3", [3, 3, 3, 3, 3, 3], 18],
  ];
  it("parses valid patterns into groups + scaffold + digit_count", () => {
    for (const [pattern, groups, digits] of VALID) {
      const parsed = parsePhoneMaskPattern(pattern);
      expect(parsed, pattern).not.toBeNull();
      expect(parsed!.groups, pattern).toEqual(groups);
      expect(parsed!.digit_count, pattern).toBe(digits);
    }
    // the canonical scaffold is pinned.
    expect(parsePhoneMaskPattern("(3) 3-4")!.scaffold).toBe("(___) ___-____");
    expect(parsePhoneMaskPattern("10-5")!.scaffold).toBe("__________-_____");
  });

  const INVALID: Array<[string, string]> = [
    ["", "empty"],
    ["()", "0 groups"],
    ["1-1-1-1-1-1-1", "7 groups (>6)"],
    ["15", "15-run (group >14)"],
    ["14-7", "21 total (>20)"],
    ["3a4", "letters"],
    ["3", "total 3 (<4)"],
    ["0", "group len 0"],
  ];
  it("rejects invalid patterns (parser returns null)", () => {
    for (const [pattern, why] of INVALID) {
      expect(parsePhoneMaskPattern(pattern), `${JSON.stringify(pattern)} — ${why}`).toBeNull();
    }
  });

  const phone = (phone_format: unknown): Node => ({ type: "PhoneInputQuestion", question_id: "q_p", internal_field: "phone", props: { phone_format } });

  it("save-gate accepts a valid mask; the DTO compiles {regex ^\\d{n}$, scaffold, digit_count, message A-7}", () => {
    expect(okOf(section([phone({ mask: { pattern: "(3) 3-4" } })]))).toBe(true);
    const cv = dto(phone({ mask: { pattern: "(3) 3-4" } })).client_validation as Record<string, unknown>;
    expect(cv["phone"]).toEqual({
      regex: "^\\d{10}$",
      normalize: "digits",
      message: "Enter a complete phone number.", // A-7 default
      scaffold: "(___) ___-____",
      digit_count: 10,
    });
    // an author message overrides the A-7 default.
    const cv2 = dto(phone({ mask: { pattern: "2-2", message: "Give us 4 digits." } })).client_validation as Record<string, unknown>;
    expect((cv2["phone"] as { message: string }).message).toBe("Give us 4 digits.");
  });

  it("save-gate rejects every invalid mask with the A-10 message VERBATIM", () => {
    for (const [pattern, why] of INVALID) {
      const err = errAt(section([phone({ mask: { pattern } })]), "invalid_field_prop", "phone_format.mask.pattern");
      expect(err, `${JSON.stringify(pattern)} — ${why}`).toBeDefined();
      expect(err!.message, `${JSON.stringify(pattern)} — ${why}`).toBe(LEADGEN_PHONE_MASK_ERROR);
    }
    // A-10 verbatim, pinned once more explicitly.
    expect(LEADGEN_PHONE_MASK_ERROR).toBe("Format must be digit groups with separators, like (3) 3-4.");
  });

  it("legacy presets nanp / e164_intl / il still validate AND compile a contract (the seam)", () => {
    for (const preset of ["nanp", "e164_intl", "il"] as const) {
      expect(okOf(section([phone(preset)])), preset).toBe(true);
      const cv = dto(phone(preset)).client_validation as Record<string, unknown>;
      expect(cv["phone"], preset).toBeDefined();
    }
    // a phone field with NO phone_format still validates (byte-identical legacy).
    expect(okOf(section([{ type: "PhoneInputQuestion", question_id: "q", internal_field: "p" }]))).toBe(true);
  });

  it("ROUND-TRIP producer→consumer: a masked phone gates on completeness at the runtime (real validateValue)", () => {
    // The SAME live path #lg-config → engine.validateSection: config-dto compiles
    // the mask, the runtime checker consumes it (strip to digits, test ^\d{n}$).
    const cfg = dto(phone({ mask: { pattern: "(3) 3-4" } })) as unknown as LgComponentConfig;
    // a complete number (any separators) passes; the recorded answer is raw digits.
    expect(validateValue(cfg, "(123) 456-7890", false)).toEqual([]);
    expect(validateValue(cfg, "1234567890", false)).toEqual([]);
    // an incomplete number is blocked with the A-7 completeness message.
    const incomplete = validateValue(cfg, "123-456", false);
    expect(incomplete.map((f) => f.code)).toEqual(["phone_format"]);
    expect(incomplete[0]?.message).toBe("Enter a complete phone number.");
  });

  it("SEAM: a stored custom raw-regex phone_format still validates on save AND compiles on read (tolerate)", () => {
    // Contract M8 removes custom from the EDITOR (S2.4), NOT from schema; a safe
    // custom pattern keeps saving + compiling so stored content stays valid.
    expect(okOf(section([phone({ custom: { regex: "^[0-9]{4}$", message: "PIN" } })]))).toBe(true);
    const cv = dto(phone({ custom: { regex: "^[0-9]{4}$", message: "PIN" } })).client_validation as Record<string, unknown>;
    expect((cv["phone"] as { regex: string }).regex).toBe("^[0-9]{4}$");
  });
});

// ===========================================================================
// M9 (§6.10) — address field set
// ===========================================================================
describe("M9 address field set", () => {
  const addr = (fields: unknown, extra: Node = {}): Node => ({ type: "AddressAutocompleteQuestion", question_id: "q_a", props: { fields }, ...extra });

  it("accepts the migration shape (street/city/state/zip, mode autofill, zip→zip5)", () => {
    const fields = [
      { field: "street", mode: "autofill", validation: "none" },
      { field: "city", mode: "autofill", validation: "none" },
      { field: "state", mode: "autofill", validation: "none" },
      { field: "zip", mode: "autofill", validation: "zip5" },
    ];
    expect(okOf(section([addr(fields, { required: true })]))).toBe(true);
    // config-dto carries props.fields[] verbatim (the per-field spec S2.3 consumes).
    expect((dto(addr(fields)).props["fields"] as unknown[]).length).toBe(4);
  });

  it("accepts arbitrary SUBSETS and per-field manual/zip5/{regex,message}", () => {
    expect(okOf(section([addr([{ field: "zip", mode: "manual", validation: "zip5" }])]))).toBe(true);
    expect(okOf(section([addr([{ field: "street", mode: "manual", validation: { regex: "^[A-Za-z ]+$", message: "letters only" } }])]))).toBe(true);
    expect(okOf(section([addr([{ field: "city", label: "Town", mode: "manual", validation: "none", required: true }])]))).toBe(true);
  });

  it("full_address may only appear ALONE", () => {
    expect(okOf(section([addr([{ field: "full_address", mode: "manual", validation: "none" }])]))).toBe(true);
    expect(errAt(section([addr([{ field: "full_address", mode: "manual" }, { field: "zip", mode: "manual" }])]), "invalid_field_prop")?.message).toContain("full_address");
  });

  it("requires ≥1 field and a valid field kind / mode / validation", () => {
    expect(errAt(section([addr([])]), "invalid_field_prop")?.message).toContain("non-empty");
    expect(errAt(section([addr([{ field: "county", mode: "manual" }])]), "invalid_field_prop", "[0].field")?.message).toContain(LEADGEN_ADDRESS_FIELD_KINDS.join("|"));
    expect(errAt(section([addr([{ field: "zip", mode: "sometimes" }])]), "invalid_field_prop", "[0].mode")).toBeDefined();
    expect(errAt(section([addr([{ field: "zip", mode: "manual", validation: "phone" }])]), "invalid_field_prop", "[0].validation")).toBeDefined();
  });

  it("a catastrophic custom validation regex is rejected (money-path ReDoS screen)", () => {
    expect(errAt(section([addr([{ field: "street", mode: "manual", validation: { regex: "^(a+)+$", message: "x" } }])]), "invalid_field_prop", "validation.regex")?.message).toContain("freeze");
  });

  it("SEAM: an Address WITHOUT props.fields[] still validates (byte-identical pre-M9)", () => {
    expect(okOf(section([{ type: "AddressAutocompleteQuestion", question_id: "q", props: { placeholder: "Address…" } }]))).toBe(true);
    // and its field universe is unchanged (the four role sub-fields).
    const u = collectKnownAnswerFields([{ type: "AddressAutocompleteQuestion", question_id: "q", internal_field: "home" } as unknown as LeadgenComponentNode]);
    expect(u.has("home_zip")).toBe(true);
  });
});

// ===========================================================================
// §6 seam — legacy/unknown shapes: keep validating OR fail SAFE (never 500)
// ===========================================================================
describe("§6 seam — legacy tolerance + fail-safe on unknown types", () => {
  it("a plain pre-rework choice group (no other/default/marker/label) validates unchanged", () => {
    expect(okOf(section([buttons()]))).toBe(true);
  });

  it("an UNKNOWN component type fails SAFE (unknown_component_type), never throws", () => {
    const run = () => validateSectionContent(section([{ type: "TotallyGoneType", question_id: "q1" }]));
    expect(run).not.toThrow();
    const r = run();
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.code)).toContain("unknown_component_type");
  });

  it("expandPublicComponents / toPublicComponent tolerate an unknown / extinct type (no 500)", () => {
    // A pre-migration grid/other-group shape hitting the config projection must
    // never throw — it projects 1:1 (fail-safe), exactly the L-192 seam.
    for (const type of ["MultiQuestionGrid", "OtherGroupSelector", "TotallyGoneType"]) {
      const node = { type, question_id: `q_${type}`, internal_field: "x", props: {} } as unknown as LeadgenComponentNode;
      expect(() => expandPublicComponents(node), type).not.toThrow();
      const projected = expandPublicComponents(node);
      expect(Array.isArray(projected), type).toBe(true);
    }
  });
});
