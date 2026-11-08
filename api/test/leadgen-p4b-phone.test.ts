// P4b (register PC-A4) — NANP structural phone validation + E.164 normalization.
//
// The investigation ground: the old check was strip-digits count 7..15 with NO
// structure — "1111111111" passed, a 14-digit blob passed. This suite pins the
// replacement: NANP structure (area + exchange first digit 2–9), 10 or 11(w/1)
// digits, E.164 normal form, honest messages, and the error_text override.
//
// X09 (2026-11-08): the stored normal form is now the 10 national digits, not
// E.164. Owner, 2026-10-20: "The way I would like it is to remove the
// hardcoded additional "+1" from the code entirely, so the phone number is
// saved and sent as plain 10 digits, e.g. (707) 849 3710 --> 7078493710."
// "+1" is added per Offer field by the "Phone with country code" format. The
// accept/reject matrix below is unchanged — only the expected stored value.

import { describe, expect, it } from "vitest";
import { normalizeUsPhone, validateValue } from "../src/public/leadgen/runtime/validation";
import type { LgComponentConfig } from "../src/public/leadgen/runtime/state";

const phone = (extra: Record<string, unknown> = {}): LgComponentConfig =>
  ({
    type: "PhoneInputQuestion",
    question_id: "q_phone",
    internal_field: "phone",
    ...extra,
  }) as unknown as LgComponentConfig;

// [input, expected stored 10 digits | null, note]
const MATRIX: Array<[string, string | null, string]> = [
  // VALID
  ["4155551234", "4155551234", "bare 10-digit"],
  ["(415) 555-1234", "4155551234", "US formatting"],
  ["415.555.1234", "4155551234", "dotted"],
  ["14155551234", "4155551234", "11-digit with leading country 1"],
  ["+1 415 555 1234", "4155551234", "already E.164-ish with spaces"],
  ["2025551234", "2025551234", "area 202 / exchange 555 boundary-low area"],
  ["9999551234", "9999551234", "area/exchange high boundary 9"],
  // INVALID — the old false-accepts, now rejected
  ["1111111111", null, "area code 111 (first digit 1) — the headline false-accept"],
  ["12345678901234", null, "14-digit blob (was accepted by count 7..15)"],
  ["5551234", null, "7 digits (too short)"],
  ["415555123", null, "9 digits"],
  ["41555512345", null, "11 digits NOT starting with 1"],
  // INVALID — NANP structure
  ["1155551234", null, "area code first digit 1"],
  ["4151151234", null, "exchange code first digit 1 (115)"],
  ["4150551234", null, "exchange code first digit 0 (055)"],
  ["0155551234", null, "area code first digit 0"],
  ["", null, "empty (normalizer null; emptiness is required's job)"],
  ["abcdefghij", null, "no digits"],
];

describe("P4b PC-A4 — normalizeUsPhone (NANP structure; X09: 10 national digits)", () => {
  for (const [input, expected, note] of MATRIX) {
    it(`${JSON.stringify(input)} → ${expected} (${note})`, () => {
      expect(normalizeUsPhone(input)).toBe(expected);
    });
  }

  it("is idempotent on its own output, and an E.164 input gives the same 10 digits", () => {
    expect(normalizeUsPhone("4155551234")).toBe("4155551234");
    expect(normalizeUsPhone("+14155551234")).toBe("4155551234");
  });
});

describe("P4b PC-A4 — validateValue phone branch", () => {
  it("a valid number passes (no failure)", () => {
    expect(validateValue(phone(), "(415) 555-1234", false)).toEqual([]);
  });

  it("the headline false-accept 1111111111 now FAILS with an honest message", () => {
    const fails = validateValue(phone(), "1111111111", false);
    expect(fails.map((f) => f.code)).toEqual(["phone_format"]);
    expect(fails[0]?.message).toBe("Enter a valid US phone number.");
  });

  it("a 14-digit blob now FAILS (was accepted by the old count 7..15 rule)", () => {
    expect(validateValue(phone(), "12345678901234", false).map((f) => f.code)).toEqual([
      "phone_format",
    ]);
  });

  it("authored error_text overrides the phone_format copy", () => {
    const fails = validateValue(phone({ client_validation: { error_text: "We need a real number." } }), "111", false);
    expect(fails.map((f) => f.code)).toEqual(["phone_format"]);
    expect(fails[0]?.message).toBe("We need a real number.");
  });

  it("empty + not required → no failure (emptiness is required's job)", () => {
    expect(validateValue(phone(), "", false)).toEqual([]);
  });

  it("empty + required → required (not phone_format)", () => {
    expect(validateValue(phone({ required: true }), "", true).map((f) => f.code)).toEqual([
      "required",
    ]);
  });
});
