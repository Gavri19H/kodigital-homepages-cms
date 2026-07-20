// Round-4 P2b — phone-format presets (A-6b) + composed-conditional authoring
// (A-4, P2a seam #1). Everything below drives the REAL producer→validate→consume
// flow, never a hand-built consumer input:
//   PRODUCER  config-dto.toPublicComponent → buildClientValidation → the
//             compiled `client_validation.phone` contract.
//   CONSUMER  runtime validation.validateValue reads that SAME contract.
// so a preset can never pass the test yet diverge live. The composed-conditional
// legs run the REAL save-time gate (content-schema.validateSectionContent) and
// the REAL config round-trip (config-dto.parseSectionContinueVisibleWhen).

import { describe, expect, it } from "vitest";
import { toPublicComponent, parseSectionContinueVisibleWhen } from "../src/public/leadgen/config-dto";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";
import { validateValue, normalizePhoneE164 } from "../src/public/leadgen/runtime/validation";
import type { LgComponentConfig } from "../src/public/leadgen/runtime/state";

// Author a PhoneInputQuestion carrying `phone_format`, run it through the REAL
// config producer, and hand the projected client shape to the REAL runtime
// consumer — exactly the live path (#lg-config → engine.validateSection).
function phoneField(phoneFormat?: unknown, extra: Record<string, unknown> = {}): LgComponentConfig {
  const props: Record<string, unknown> = {};
  if (phoneFormat !== undefined) props["phone_format"] = phoneFormat;
  const node = {
    type: "PhoneInputQuestion",
    question_id: "q_phone",
    internal_field: "phone",
    props,
    ...extra,
  } as never;
  return toPublicComponent(node) as unknown as LgComponentConfig;
}

const codes = (c: LgComponentConfig, v: string): string[] =>
  validateValue(c, v, false).map((f) => f.code);
const message = (c: LgComponentConfig, v: string): string | undefined =>
  validateValue(c, v, false)[0]?.message;

// ---------------------------------------------------------------------------
// Preset matrix — 4 presets × valid / invalid / edge (incl. the operator IL
// shapes). Each row: [input, valid?] under its preset's compiled contract.
// ---------------------------------------------------------------------------

interface Row {
  input: string;
  valid: boolean;
  note: string;
}

const NANP: Row[] = [
  { input: "(415) 555-1234", valid: true, note: "US formatting" },
  { input: "4155551234", valid: true, note: "bare 10-digit" },
  { input: "14155551234", valid: true, note: "11-digit w/ leading country 1" },
  { input: "1111111111", valid: false, note: "area code 111 (headline false-accept)" },
  { input: "12345678901234", valid: false, note: "14-digit blob" },
  { input: "5551234", valid: false, note: "7 digits" },
  { input: "0155551234", valid: false, note: "area first digit 0" },
];

const E164: Row[] = [
  { input: "+972541234567", valid: true, note: "IL intl E.164" },
  { input: "+14155551234", valid: true, note: "US intl E.164" },
  { input: "+972 54 123 4567", valid: true, note: "spaced intl → stripped to +digits" },
  { input: "0541234567", valid: false, note: "no + (national)" },
  { input: "4155551234", valid: false, note: "no + (US national)" },
  { input: "+123", valid: false, note: "only 3 digits (below E.164 floor)" },
  { input: "+1234567890123456", valid: false, note: "16 digits (above E.164 ceiling)" },
];

// The operator's IL examples (product truth A-6b: 0XX-XXXXXXX, 05X mobiles).
const IL: Row[] = [
  { input: "0541234567", valid: true, note: "05X mobile, 10 digits (operator shape)" },
  { input: "054-123-4567", valid: true, note: "05X mobile dashed" },
  { input: "052-1234567", valid: true, note: "05X mobile alt grouping" },
  { input: "02-123-4567", valid: true, note: "landline 9 digits (021234567)" },
  { input: "+972541234567", valid: false, note: "intl form (not national 0…)" },
  { input: "541234567", valid: false, note: "no leading 0" },
  { input: "0123456", valid: false, note: "7 digits (too short)" },
];

const CUSTOM_RULE = { custom: { regex: "^[0-9]{4}$", mask: "____", message: "Enter your 4-digit PIN." } };
const CUSTOM: Row[] = [
  { input: "1234", valid: true, note: "4 digits" },
  { input: "abc", valid: false, note: "letters" },
  { input: "12345", valid: false, note: "5 digits" },
  { input: "12", valid: false, note: "2 digits" },
];

describe("P2b A-6b — phone-format preset matrix (real config→runtime pipeline)", () => {
  const cases: Array<[string, unknown, Row[], string]> = [
    ["nanp", "nanp", NANP, "Enter a valid US phone number."],
    ["e164_intl", "e164_intl", E164, "Enter your phone number with the country code, like +972…"],
    ["il", "il", IL, "Enter a valid Israeli phone number."],
    ["custom", CUSTOM_RULE, CUSTOM, "Enter your 4-digit PIN."],
  ];
  for (const [name, preset, rows, msg] of cases) {
    describe(name, () => {
      const field = phoneField(preset);
      for (const { input, valid, note } of rows) {
        it(`${JSON.stringify(input)} → ${valid ? "PASS" : "FAIL"} (${note})`, () => {
          if (valid) {
            expect(codes(field, input)).toEqual([]);
          } else {
            expect(codes(field, input)).toEqual(["phone_format"]);
            expect(message(field, input)).toBe(msg);
          }
        });
      }
    });
  }

  it("a custom rule with NO message falls to the plain default copy", () => {
    const field = phoneField({ custom: { regex: "^[0-9]{4}$" } });
    expect(codes(field, "abc")).toEqual(["phone_format"]);
    expect(message(field, "abc")).toBe("Enter a valid phone number.");
  });
});

// ---------------------------------------------------------------------------
// Legacy byte-parity: no prop ⇒ identical DTO (no cv.phone) + identical
// validation results, AND explicit 'nanp' === the runtime NANP default exactly.
// ---------------------------------------------------------------------------

describe("P2b A-6b — legacy byte-parity + nanp==current-behavior-exactly", () => {
  it("a phone field WITHOUT phone_format emits NO cv.phone (byte-identical DTO)", () => {
    const plain = phoneField(undefined, { required: true });
    const cv = (plain as unknown as { client_validation?: Record<string, unknown> }).client_validation ?? {};
    expect("phone" in cv).toBe(false);
    // the only client_validation a required-but-preset-less phone carries.
    expect(JSON.stringify(cv)).toBe(JSON.stringify({ required: true }));
  });

  it("explicit phone_format:'nanp' emits a cv.phone contract (Approach Y)", () => {
    const nanp = phoneField("nanp");
    const cv = (nanp as unknown as { client_validation?: Record<string, unknown> }).client_validation ?? {};
    expect("phone" in cv).toBe(true);
  });

  // The battery the frozen p4b suite pins on normalizePhoneE164 — the no-prop
  // field, the explicit-nanp field, and the raw normalizer must all agree.
  const BATTERY = [
    "(415) 555-1234", "4155551234", "14155551234", "+1 415 555 1234", "2025551234",
    "1111111111", "12345678901234", "5551234", "415555123", "41555512345",
    "1155551234", "4151151234", "0155551234", "abcdefghij",
  ];

  it("no-prop, explicit-nanp, and normalizePhoneE164 agree on EVERY battery input", () => {
    const plain = phoneField(undefined);
    const nanp = phoneField("nanp");
    for (const input of BATTERY) {
      const plainCodes = codes(plain, input);
      const nanpCodes = codes(nanp, input);
      const rawValid = normalizePhoneE164(input) !== null;
      expect(plainCodes, `no-prop vs raw: ${input}`).toEqual(rawValid ? [] : ["phone_format"]);
      expect(nanpCodes, `explicit-nanp vs no-prop: ${input}`).toEqual(plainCodes);
      // the message copy is identical too (both the NANP US string).
      if (!rawValid) {
        expect(message(nanp, input)).toBe(message(plain, input));
        expect(message(plain, input)).toBe("Enter a valid US phone number.");
      }
    }
  });

  it("the frozen p4b error_text override still wins over the preset message", () => {
    // Authored as props.error_text — buildClientValidation projects it into
    // client_validation.error_text, which validateValue applies over the
    // phone_format copy (the p4b pin, unchanged by the generic checker).
    const node = {
      type: "PhoneInputQuestion",
      question_id: "q_phone",
      internal_field: "phone",
      props: { error_text: "We need a real number." },
    } as never;
    const withText = toPublicComponent(node) as unknown as LgComponentConfig;
    expect(message(withText, "111")).toBe("We need a real number.");
  });
});

// ---------------------------------------------------------------------------
// A-4 (P2a seam #1) — composed condition groups pass the REAL save-time
// authoring gate on ALL three slots; config round-trips the group untouched.
// ---------------------------------------------------------------------------

// A section whose ONLY provider field is `f1`, plus a gated FreeText carrying
// `slot` = the composed-conditional under test on the given carrier.
function sectionWithConditional(
  carrier: "conditional" | "requiredWhen" | "continue_visible_when",
  cond: unknown,
): unknown {
  const provider = {
    type: "ButtonAnswerGroup",
    question_id: "q_src",
    internal_field: "f1",
    choices: [
      { label: "Yes", value: "yes", analytics_id: "yes" },
      { label: "No", value: "no", analytics_id: "no" },
    ],
  };
  const gated: Record<string, unknown> = { type: "FreeTextQuestion", question_id: "q_dep", internal_field: "f2" };
  if (carrier === "conditional") gated["conditional"] = cond;
  if (carrier === "requiredWhen") gated["props"] = { requiredWhen: cond };
  const content: Record<string, unknown> = { components: [provider, gated] };
  if (carrier === "continue_visible_when") content["continue_visible_when"] = cond;
  return content;
}

const GROUP_OK = { match: "all", conditions: [{ when: "f1", op: "eq", value: "yes" }] };
const GROUP_ANY = { match: "any", conditions: [{ when: "f1", op: "eq", value: "yes" }, { when: "f1", op: "eq", value: "no" }] };
const GROUP_UNKNOWN = { match: "any", conditions: [{ when: "ghost_field", op: "eq", value: "x" }] };
const GROUP_BAD_MATCH = { match: "sometimes", conditions: [{ when: "f1", op: "eq", value: "yes" }] };
const GROUP_BAD_INNER_OP = { match: "all", conditions: [{ when: "f1", op: "bogus", value: "yes" }] };

const errCodes = (content: unknown): string[] =>
  validateSectionContent(content).errors.map((e) => e.code);

describe("P2b A-4 — composed-conditional authoring on all three slots", () => {
  for (const slot of ["conditional", "requiredWhen", "continue_visible_when"] as const) {
    describe(slot, () => {
      it("a valid all/any group SAVES (ok, no conditional errors)", () => {
        const r1 = validateSectionContent(sectionWithConditional(slot, GROUP_OK));
        expect(r1.ok, JSON.stringify(r1.errors)).toBe(true);
        const r2 = validateSectionContent(sectionWithConditional(slot, GROUP_ANY));
        expect(r2.ok, JSON.stringify(r2.errors)).toBe(true);
      });

      it("a group whose inner `when` is unknown → conditional_unknown_field (plain-language)", () => {
        const r = validateSectionContent(sectionWithConditional(slot, GROUP_UNKNOWN));
        expect(r.ok).toBe(false);
        expect(errCodes(sectionWithConditional(slot, GROUP_UNKNOWN))).toContain("conditional_unknown_field");
        const err = r.errors.find((e) => e.code === "conditional_unknown_field");
        expect(err?.message).toContain("ghost_field");
      });

      it("a bad `match` value → conditional_invalid naming all/any", () => {
        const r = validateSectionContent(sectionWithConditional(slot, GROUP_BAD_MATCH));
        expect(r.ok).toBe(false);
        const err = r.errors.find((e) => e.code === "conditional_invalid");
        expect(err?.message).toContain("'all' or 'any'");
      });

      it("a bad inner op is caught recursively (bare-condition rules apply per inner)", () => {
        expect(errCodes(sectionWithConditional(slot, GROUP_BAD_INNER_OP))).toContain("conditional_invalid");
      });
    });
  }

  it("a bare (legacy) conditional still validates byte-identically", () => {
    const bareOk = sectionWithConditional("conditional", { when: "f1", op: "eq", value: "yes" });
    expect(validateSectionContent(bareOk).ok).toBe(true);
    const bareUnknown = sectionWithConditional("conditional", { when: "ghost", op: "eq", value: "x" });
    expect(errCodes(bareUnknown)).toContain("conditional_unknown_field");
  });

  it("config-dto round-trips a composed continue_visible_when UNTOUCHED", () => {
    const json = JSON.stringify({
      components: [{ type: "ButtonAnswerGroup", question_id: "q", internal_field: "f1", choices: [] }],
      continue_visible_when: GROUP_ANY,
    });
    const parsed = parseSectionContinueVisibleWhen(json);
    expect(parsed).toEqual(GROUP_ANY);
    // a bare continue_visible_when still round-trips too (unchanged path).
    const bareJson = JSON.stringify({ components: [], continue_visible_when: { when: "f1", op: "eq", value: "yes" } });
    expect(parseSectionContinueVisibleWhen(bareJson)).toEqual({ when: "f1", op: "eq", value: "yes" });
  });
});
