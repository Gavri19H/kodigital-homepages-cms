// R2 P5 S5b — the SRC-7B `formatCurrency` transform kind + the ONE transform-kind
// allow-list (contract §5.5 SRC-7B, owner A.1 #7B, ruling D9).
//
// The BEHAVIORAL proof for these clauses is the driven product
// (test-ui/leadgen-r2p5-payload-seam-drive.spec.ts: one visitor, three per-offer
// payloads read back from leadgen_provider_request_log). This file is the unit
// floor underneath it: the exact emitted string (D9), the edge cases the drive
// cannot reach (negatives, decimals, garbage → fallback), and the STRUCTURAL
// invariants that stop the two hand-copied kind lists from ever drifting apart
// again — the very defect the owner called "low level slopy logic".

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyTransformPipeline,
  buildPayload as buildPayloadRaw,
  LEADGEN_TRANSFORM_KINDS,
  validatePayloadSchema,
  type LeadgenPayloadSchema,
} from "../src/leadgen/payload";
import { withLiftedBindings } from "./helpers/leadgen-answer-bindings";
// OWNER RULING 2026-08-12 — a payload node carries no binding of its own; the
// Section row does (leadgen_section_answer_maps → ctx.answer_bindings). These
// cases author the pre-ruling node shorthand and their SUBJECT is the build
// pipeline, so the shim lifts that shorthand onto the real binding route with
// every expectation unchanged. See test/helpers/leadgen-answer-bindings.ts.
function buildPayload(
  schema: Parameters<typeof buildPayloadRaw>[0],
  ctx: Parameters<typeof buildPayloadRaw>[1],
): ReturnType<typeof buildPayloadRaw> {
  return buildPayloadRaw(...withLiftedBindings(schema, ctx));
}


const currency = (value: unknown): unknown => applyTransformPipeline(value, [{ kind: "formatCurrency" }]);

describe("SRC-7B formatCurrency — the D9 emitted string", () => {
  it("170000 → EXACTLY \"$170,000\" (owner D9 / Image10)", () => {
    expect(currency(170000)).toBe("$170,000");
  });

  it("groups every magnitude in threes, no forced decimals", () => {
    expect(currency(0)).toBe("$0");
    expect(currency(37)).toBe("$37");
    expect(currency(1000)).toBe("$1,000");
    expect(currency(500000)).toBe("$500,000");
    expect(currency(1234567)).toBe("$1,234,567");
  });

  it("accepts a numeric STRING answer and is IDEMPOTENT on its own output", () => {
    expect(currency("170000")).toBe("$170,000");
    expect(currency("$170,000")).toBe("$170,000");
    expect(currency(currency(170000))).toBe("$170,000");
  });

  it("keeps a fractional part as-is and puts a sign OUTSIDE the symbol", () => {
    expect(currency(1234.5)).toBe("$1,234.5");
    expect(currency(-2500)).toBe("-$2,500");
  });

  it("INVALID (→ the node's fallback) for anything that is not a finite plain amount", () => {
    for (const bad of ["", "   ", "abc", "12a", true, null, undefined, {}, [], Number.NaN, Number.POSITIVE_INFINITY, 1e21]) {
      expect(currency(bad)).toBeUndefined();
    }
  });
});

describe("SRC-7B — the three output formats are all expressible on ONE answer", () => {
  // The §12.11 per-Offer leg: the SAME internal answer, three provider fields,
  // three transform chains. (buildPayload is the exact function the auction's
  // fetch.ts calls with the Offer's active payload schema.)
  const schema = (path: string, type: "string" | "number", kind: string): LeadgenPayloadSchema =>
    ({
      version: 1,
      root: {
        type: "object",
        children: [
          {
            path,
            name: path.split(".").slice(-1)[0] ?? path,
            type,
            source: "answer",
            internal_field: "amount",
            transform: [{ kind }],
          },
        ],
      },
    }) as unknown as LeadgenPayloadSchema;

  it("currency-passed | number | number-as-string, from the same 170000", () => {
    const answers = { amount: 170000 };
    expect(buildPayload(schema("lead.a", "string", "formatCurrency"), { answers })).toEqual({ lead: { a: "$170,000" } });
    expect(buildPayload(schema("lead.a", "number", "toNumber"), { answers })).toEqual({ lead: { a: 170000 } });
    expect(buildPayload(schema("lead.a", "string", "toString"), { answers })).toEqual({ lead: { a: "170000" } });
  });

  it("a currency string into a NUMBER provider field is INVALID → the node's fallback", () => {
    // The format is a display shape: it belongs on a string-typed provider
    // field. Declared on a number field the coercion rejects it, so the node
    // takes its fallback instead of shipping a mangled amount.
    const s = schema("lead.a", "number", "formatCurrency") as unknown as {
      root: { children: Array<Record<string, unknown>> };
    };
    s.root.children[0]!["fallback"] = -1;
    expect(buildPayload(s as unknown as LeadgenPayloadSchema, { answers: { amount: 170000 } })).toEqual({ lead: { a: -1 } });
  });
});

describe("the transform-kind allow-list has exactly ONE source of truth", () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf8");

  it("formatCurrency is in the exported list, the type union, and the runtime switch", () => {
    expect([...LEADGEN_TRANSFORM_KINDS]).toContain("formatCurrency");
    const payloadSrc = read("../src/leadgen/payload.ts");
    expect(payloadSrc).toContain(`| { kind: "formatCurrency" }`);
    expect(payloadSrc).toContain(`case "formatCurrency":`);
  });

  it("validator #1 (payload.ts validatePayloadSchema) accepts it", () => {
    const res = validatePayloadSchema({
      version: 1,
      root: {
        type: "object",
        children: [
          { path: "lead.a", name: "a", type: "string", source: "answer", internal_field: "amount", transform: [{ kind: "formatCurrency" }] },
        ],
      },
    });
    expect(res.errors.filter((e) => e.code === "transform_invalid")).toHaveLength(0);
    expect(res.ok).toBe(true);
  });

  it("validator #2 (admin sections-handlers) IMPORTS the list — no second literal Set", () => {
    const adminSrc = read("../src/admin/leadgen/sections-handlers.ts");
    expect(adminSrc).toContain("LEADGEN_TRANSFORM_KINDS");
    expect(adminSrc).toContain("new Set(LEADGEN_TRANSFORM_KINDS)");
    // the hand-copied literal is GONE (it listed the kinds inline)
    expect(adminSrc).not.toMatch(/TRANSFORM_KINDS[^=]*=\s*new Set\(\[/);
    // and no other module re-declares its own kind list
    expect(read("../src/leadgen/payload.ts").match(/"mapBoolean",/g) ?? []).toHaveLength(1);
    expect(adminSrc).not.toContain(`"mapBoolean"`);
  });
});
