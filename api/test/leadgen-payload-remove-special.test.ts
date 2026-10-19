// Payload builder Output format "Remove special characters and spacing"
// (2026-10-19). Owner verbatim: "In the "Leadgen" --> Offers" --> "Payload" -->
// "Payload builder" --> "field" -->"Output Format" field, add a "Remove special
// characters and spacing" option. This should support a situation when a user
// fill a given pattern (Phone number for example) that includes special
// characters that we don't want to send. ... Assuming he's filling it out using
// an American format such as (707) 849 3710 --> AmOne requesting it to be sent
// as a simple string "7078493710""
//
// The `removeSpecial` transform kind: String(value) with every character that
// is not a letter or a digit removed (Unicode letters/digits kept); the output
// is a STRING; an empty result or a non string/number input is INVALID (→ the
// node's fallback), like the other formatters. Idempotent.
//
// This file is the runtime unit floor (the exact emitted strings + edge cases)
// plus the built provider payload for an answer-sourced field carrying the
// format, through the REAL answer-binding route the auction uses.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyTransformPipeline,
  buildPayload,
  LEADGEN_TRANSFORM_KINDS,
  validatePayloadSchema,
  type LeadgenPayloadSchema,
} from "../src/leadgen/payload";

const strip = (value: unknown): unknown => applyTransformPipeline(value, [{ kind: "removeSpecial" }] as never);

describe("removeSpecial — the emitted string", () => {
  it('"(707) 849 3710" → EXACTLY "7078493710" (the owner\'s AmOne example)', () => {
    expect(strip("(707) 849 3710")).toBe("7078493710");
  });

  it('"+1 (707) 849-3710" → "17078493710" (only special characters and spacing go; digits are never dropped)', () => {
    expect(strip("+1 (707) 849-3710")).toBe("17078493710");
  });

  it('Unicode letters survive: "José Núñez" → "JoséNúñez"', () => {
    expect(strip("José Núñez")).toBe("JoséNúñez");
  });

  it('a number answer is stringified first: 707.5 → "7075" (a STRING, never a number)', () => {
    expect(strip(707.5)).toBe("7075");
    expect(typeof strip(7078493710)).toBe("string");
    expect(strip(7078493710)).toBe("7078493710");
  });

  it("is IDEMPOTENT on its own output", () => {
    for (const raw of ["(707) 849 3710", "+1 (707) 849-3710", "José Núñez", 707.5, "a-b_c.d"]) {
      const once = strip(raw);
      expect(strip(once), String(raw)).toBe(once);
    }
  });

  it('INVALID (→ the node\'s fallback) when nothing is left or the input is not a string/number: "---", "", "   ", true, null, {}, []', () => {
    for (const bad of ["---", "", "   ", "()- .", true, null, undefined, {}, [], Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(strip(bad), JSON.stringify(bad) ?? String(bad)).toBeUndefined();
    }
  });
});

describe("removeSpecial — the built provider payload (answer-sourced field, the REAL binding route)", () => {
  // The node the Output-format control writes (type string + ONE removeSpecial
  // step) and the Section-tab binding that fills it — the same two halves the
  // auction's fetch.ts hands buildPayload.
  const schema = (extra: Record<string, unknown> = {}): LeadgenPayloadSchema =>
    ({
      version: 1,
      root: {
        type: "object",
        children: [
          {
            path: "lead.home_phone",
            name: "home_phone",
            type: "string",
            source: "answer",
            transform: [{ kind: "removeSpecial" }],
            ...extra,
          },
        ],
      },
    }) as unknown as LeadgenPayloadSchema;
  const bindings = { "lead.home_phone": [{ internal_field: "home_phone" }] };

  it('the business-loans home phone "(707) 849 3710" is sent as the string "7078493710"', () => {
    const payload = buildPayload(schema(), { answers: { home_phone: "(707) 849 3710" }, answer_bindings: bindings });
    expect(payload).toEqual({ lead: { home_phone: "7078493710" } });
    expect(JSON.stringify(payload)).toBe('{"lead":{"home_phone":"7078493710"}}');
  });

  it('an answer with nothing left ("---") takes the node\'s fallback', () => {
    const payload = buildPayload(schema({ fallback: "0000000000" }), {
      answers: { home_phone: "---" },
      answer_bindings: bindings,
    });
    expect(payload).toEqual({ lead: { home_phone: "0000000000" } });
  });

  it("an answer with nothing left and no fallback drops the field (never an empty string)", () => {
    expect(buildPayload(schema(), { answers: { home_phone: "" }, answer_bindings: bindings })).toEqual({});
    expect(buildPayload(schema(), { answers: { home_phone: "() -" }, answer_bindings: bindings })).toEqual({});
  });
});

describe("removeSpecial — one allow-list, every validator", () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf8");

  it("is in the exported list, the type union, and the runtime switch", () => {
    expect([...LEADGEN_TRANSFORM_KINDS]).toContain("removeSpecial");
    const payloadSrc = read("../src/leadgen/payload.ts");
    expect(payloadSrc).toContain(`| { kind: "removeSpecial" }`);
    expect(payloadSrc).toContain(`case "removeSpecial":`);
  });

  it("validator #1 (payload.ts validatePayloadSchema) accepts it on a string answer field", () => {
    const res = validatePayloadSchema({
      version: 1,
      root: {
        type: "object",
        children: [
          {
            path: "lead.home_phone",
            name: "home_phone",
            type: "string",
            source: "answer",
            transform: [{ kind: "removeSpecial" }],
          },
        ],
      },
    });
    expect(res.errors.filter((e) => e.code === "transform_invalid")).toHaveLength(0);
    expect(res.ok).toBe(true);
  });

  it("validator #2 (admin sections-handlers parseTransformSteps) builds its allow-list FROM the exported list", () => {
    const adminSrc = read("../src/admin/leadgen/sections-handlers.ts");
    expect(adminSrc).toContain("new Set(LEADGEN_TRANSFORM_KINDS)");
    expect(adminSrc).not.toContain(`"removeSpecial"`);
  });
});
