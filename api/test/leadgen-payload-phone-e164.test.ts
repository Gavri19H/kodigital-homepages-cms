// X09 — payload builder Output format "Phone with country code (+17078493710)".
//
// Owner, 2026-10-20 (AmOne rejected "17078493710", accepted "7078493710"):
// "The way I would like it is to remove the hardcoded additional "+1" from the
// code entirely, so the phone number is saved and sent as plain 10 digits,
// e.g. (707) 849 3710 --> 7078493710."
// Owner, 2026-11-08 (after talking with Guy): "the fix should not just remove
// the +1 in the phone field, it also needs to set the conditions in which the
// +1 should be sent, so what I'd like you to do is to add the option to send
// it in the Format field of the CMS (Under payload)".
//
// So the visitor runtime stores a US phone as 10 digits
// (test/leadgen-rework-runtime.test.ts), and the `formatPhoneE164` transform
// kind is the ONLY place "+1" is added: strip non-digits, drop a leading "1"
// from 11 digits, exactly 10 must remain, then "+1". Anything else is INVALID
// (→ the node's fallback). The builder island's preview mirror is pinned
// against this in test/leadgen-payload-builder-ui.test.ts; the real admin
// route → provider bytes in test/leadgen-payload-remove-special.test.ts.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyTransformPipeline,
  buildPayload,
  LEADGEN_TRANSFORM_KINDS,
  validatePayloadSchema,
  type LeadgenPayloadSchema,
} from "../src/leadgen/payload";
import { hashMetaValue, normalizeMetaPhone } from "../src/leadgen/meta-hash";
import { normalizeUsPhone } from "../src/public/leadgen/runtime/validation";

const e164 = (value: unknown): unknown => applyTransformPipeline(value, [{ kind: "formatPhoneE164" }]);

describe("formatPhoneE164 — the emitted string", () => {
  it('the plan\'s four examples: 7078493710, (707) 849 3710, +17078493710 → "+17078493710"; +44 20 7946 0958 → INVALID', () => {
    expect(e164("7078493710")).toBe("+17078493710");
    expect(e164("(707) 849 3710")).toBe("+17078493710");
    expect(e164("+17078493710")).toBe("+17078493710");
    expect(e164("+44 20 7946 0958")).toBeUndefined();
  });

  it("an 11-digit number starting with 1 and a number answer are accepted", () => {
    expect(e164("17078493710")).toBe("+17078493710");
    expect(e164("+1 (707) 849-3710")).toBe("+17078493710");
    expect(e164(7078493710)).toBe("+17078493710");
  });

  it("is IDEMPOTENT on its own output", () => {
    for (const raw of ["7078493710", "(707) 849 3710", "+17078493710", "17078493710"]) {
      const once = e164(raw);
      expect(e164(once), raw).toBe(once);
    }
  });

  it("INVALID (→ the node's fallback) for anything that is not a US/Canada number", () => {
    for (const bad of ["12345", "27078493710", "707849371", "", "abc", "+972 52 123 4567", true, null, undefined, {}, []]) {
      expect(e164(bad), JSON.stringify(bad) ?? String(bad)).toBeUndefined();
    }
  });
});

describe("formatPhoneE164 — buildPayload (one answer, three Offer fields, three formats)", () => {
  // The same stored answer reaches each Offer field in that field's own format:
  // "+1" only where the operator picked "Phone with country code".
  const schema = {
    version: 1,
    root: {
      type: "object",
      children: [
        { path: "with_plus", name: "with_plus", type: "string", source: "answer", transform: [{ kind: "formatPhoneE164" }] },
        { path: "as_entered", name: "as_entered", type: "string", source: "answer" },
        { path: "stripped", name: "stripped", type: "string", source: "answer", transform: [{ kind: "removeSpecial" }] },
        {
          path: "with_fallback",
          name: "with_fallback",
          type: "string",
          source: "answer",
          transform: [{ kind: "formatPhoneE164" }],
          fallback: "unknown",
        },
      ],
    },
  } as unknown as LeadgenPayloadSchema;
  const bindings = {
    with_plus: [{ internal_field: "phone" }],
    as_entered: [{ internal_field: "phone" }],
    stripped: [{ internal_field: "phone" }],
    with_fallback: [{ internal_field: "phone" }],
  };

  it('the runtime-stored "7078493710" → "+17078493710" / "7078493710" / "7078493710"', () => {
    const stored = normalizeUsPhone("(707) 849 3710");
    expect(stored).toBe("7078493710");
    const payload = buildPayload(schema, { answers: { phone: stored }, answer_bindings: bindings });
    expect(JSON.stringify(payload)).toBe(
      '{"with_plus":"+17078493710","as_entered":"7078493710","stripped":"7078493710","with_fallback":"+17078493710"}',
    );
  });

  it("a non-US answer drops the field, or takes its fallback", () => {
    const payload = buildPayload(schema, { answers: { phone: "+44 20 7946 0958" }, answer_bindings: bindings });
    expect(payload["with_plus"]).toBeUndefined();
    expect(payload["with_fallback"]).toBe("unknown");
  });
});

describe("formatPhoneE164 — one allow-list, every validator", () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf8");

  it("is in the exported list, the type union, and the runtime switch", () => {
    expect([...LEADGEN_TRANSFORM_KINDS]).toContain("formatPhoneE164");
    const payloadSrc = read("../src/leadgen/payload.ts");
    expect(payloadSrc).toContain(`| { kind: "formatPhoneE164" }`);
    expect(payloadSrc).toContain(`case "formatPhoneE164":`);
  });

  it("validator #1 (payload.ts validatePayloadSchema) accepts it on a string answer field", () => {
    const res = validatePayloadSchema({
      version: 1,
      root: {
        type: "object",
        children: [
          { path: "lead.phone", name: "phone", type: "string", source: "answer", transform: [{ kind: "formatPhoneE164" }] },
        ],
      },
    });
    expect(res.errors.filter((e) => e.code === "transform_invalid")).toHaveLength(0);
    expect(res.ok).toBe(true);
  });

  it("validator #2 (admin answer-map check, sections-handlers parseTransformSteps) builds its allow-list FROM the exported list", () => {
    const adminSrc = read("../src/admin/leadgen/sections-handlers.ts");
    expect(adminSrc).toContain("new Set(LEADGEN_TRANSFORM_KINDS)");
    // no hand-copied kind list (the name appears only in the US-only warning)
    expect(adminSrc).not.toMatch(/new Set\(\[[^\]]*"formatPhoneE164"/);
  });
});

describe("X09 keeps the hashed phone sent to Meta the same", () => {
  it('the stored phone before ("+17078493710") and after ("7078493710") hash to the same value', async () => {
    const before = "+17078493710";
    const after = normalizeUsPhone("(707) 849 3710");
    expect(after).toBe("7078493710");
    expect(normalizeMetaPhone(after)).toBe("17078493710");
    expect(normalizeMetaPhone(before)).toBe(normalizeMetaPhone(after));
    expect(await hashMetaValue("ph", after)).toBe(await hashMetaValue("ph", before));
  });
});
