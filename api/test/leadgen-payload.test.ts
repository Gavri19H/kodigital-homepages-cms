// LeadGen Phase 4 — dynamic payload builder (contract 04 §11.1/§11.2/§11.5
// + 05 §12.7 pipeline): schema validation, runtime build per source kind,
// value_map + the normative transform set, default/fallback/conditional,
// cleanObject "no fabrication", token placement×mode matrix, and
// infer-from-example.

import { describe, expect, it } from "vitest";
import {
  applyTransformPipeline,
  buildPayload,
  cleanObject,
  inferSchemaFromExample,
  validatePayloadSchema,
  type LeadgenPayloadBuildContext,
  type LeadgenPayloadNode,
  type LeadgenPayloadSchema,
} from "../src/leadgen/payload";

// The 04 §11.5 normative example schema (verbatim node shapes).
function normativeSchema(): LeadgenPayloadSchema {
  return {
    version: 3,
    root: {
      type: "object",
      children: [
        {
          path: "data.home_own",
          name: "home_own",
          type: "boolean",
          required: true,
          source: "answer",
          internal_field: "homeowner",
          value_map: { true: true, false: false },
        },
        { path: "meta.click_id", name: "click_id", type: "string", source: "macro", macro: "click_id" },
        { path: "auth.api_token", name: "api_token", type: "string", source: "token" },
      ],
    },
  };
}

function schemaWith(nodes: LeadgenPayloadNode[]): LeadgenPayloadSchema {
  return { version: 1, root: { type: "object", children: nodes } };
}

function ctx(overrides: Partial<LeadgenPayloadBuildContext> = {}): LeadgenPayloadBuildContext {
  return { answers: {}, ...overrides };
}

describe("validatePayloadSchema — §11.5 shape", () => {
  it("accepts the normative example schema", () => {
    const result = validatePayloadSchema(normativeSchema());
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects a non-object schema", () => {
    for (const bad of [null, "x", 3, [1]]) {
      const result = validatePayloadSchema(bad);
      expect(result.ok).toBe(false);
      expect(result.errors[0]?.code).toBe("schema_not_object");
    }
  });

  it("rejects a bad version and a bad root", () => {
    expect(
      validatePayloadSchema({ version: 0, root: { type: "object", children: [] } }).errors.some(
        (e) => e.code === "version_invalid",
      ),
    ).toBe(true);
    expect(validatePayloadSchema({ version: 1, root: { type: "array", children: [] } }).errors[0]?.code).toBe(
      "root_invalid",
    );
    expect(validatePayloadSchema({ version: 1 }).errors.some((e) => e.code === "root_invalid")).toBe(true);
  });

  it("rejects invalid paths, duplicate paths and scalar-prefix conflicts", () => {
    const bad = schemaWith([
      { path: "a..b", name: "b", type: "string", source: "static", value: "x" },
      { path: "ok", name: "ok", type: "string", source: "static", value: "x" },
      { path: "ok", name: "ok", type: "string", source: "static", value: "y" },
      { path: "s", name: "s", type: "string", source: "static", value: "x" },
      { path: "s.child", name: "child", type: "string", source: "static", value: "x" },
    ]);
    const codes = validatePayloadSchema(bad).errors.map((e) => e.code);
    expect(codes).toContain("path_invalid");
    expect(codes).toContain("path_duplicate");
    expect(codes).toContain("path_prefix_conflict");
  });

  it("rejects prototype-chain path segments (__proto__/constructor/prototype)", () => {
    for (const path of ["__proto__.polluted", "constructor.prototype.x", "a.__proto__", "prototype"]) {
      const res = validatePayloadSchema(
        schemaWith([{ path, name: path.split(".").pop()!, type: "string", source: "static", value: "y" }]),
      );
      expect(res.ok, `${path} must be rejected`).toBe(false);
      expect(res.errors.map((e) => e.code)).toContain("path_invalid");
    }
  });

  it("buildPayload never pollutes Object.prototype even from an unvalidated hostile path", () => {
    // The writer is defense-in-depth: fed a schema that skipped validation,
    // it must still refuse to walk into the prototype chain.
    const schema = schemaWith([
      { path: "__proto__.polluted", name: "polluted", type: "string", source: "static", value: "yes" },
    ]);
    buildPayload(schema, { answers: {} } as unknown as LeadgenPayloadBuildContext);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("inferSchemaFromExample skips prototype-chain keys so the inferred schema is valid", () => {
    const inferred = inferSchemaFromExample(JSON.parse('{"__proto__":{"x":1},"safe":"v"}'));
    const paths = inferred.root.children.map((c) => c.path);
    expect(paths.some((p) => p.split(".").includes("__proto__"))).toBe(false);
    expect(validatePayloadSchema(inferred).ok).toBe(true);
  });

  it("allows container-typed nodes as prefixes of nested paths", () => {
    const schema = schemaWith([
      { path: "drivers", name: "drivers", type: "array", source: "static", value: [] },
      { path: "drivers.0.age", name: "age", type: "number", source: "static", value: 30 },
    ]);
    expect(validatePayloadSchema(schema).ok).toBe(true);
  });

  it("rejects a missing name and a name/path-tail mismatch", () => {
    const bad = schemaWith([
      { path: "data.a", name: "", type: "string", source: "static", value: "x" },
      { path: "data.b", name: "not_b", type: "string", source: "static", value: "x" },
    ]);
    const codes = validatePayloadSchema(bad).errors.map((e) => e.code);
    expect(codes).toContain("name_invalid");
    expect(codes).toContain("name_path_mismatch");
  });

  it("rejects unknown type and unknown source", () => {
    const bad = {
      version: 1,
      root: {
        type: "object",
        children: [
          { path: "a", name: "a", type: "uuid", source: "static", value: "x" },
          { path: "b", name: "b", type: "string", source: "cookie" },
        ],
      },
    };
    const codes = validatePayloadSchema(bad).errors.map((e) => e.code);
    expect(codes).toContain("type_invalid");
    expect(codes).toContain("source_invalid");
  });

  it("enforces enum domain rules (§11.1 valid_values)", () => {
    const missingDomain = schemaWith([
      { path: "e", name: "e", type: "enum", source: "answer", internal_field: "x" },
    ]);
    expect(validatePayloadSchema(missingDomain).errors[0]?.code).toBe("enum_valid_values_required");

    const badDefault = schemaWith([
      {
        path: "e",
        name: "e",
        type: "enum",
        source: "answer",
        internal_field: "x",
        valid_values: ["a", "b"],
        default: "zzz",
      },
    ]);
    expect(validatePayloadSchema(badDefault).errors[0]?.code).toBe("enum_value_violation");

    const badValidValues = schemaWith([
      { path: "e", name: "e", type: "string", source: "static", value: "a", valid_values: "a,b" as unknown as [] },
    ]);
    expect(validatePayloadSchema(badValidValues).errors[0]?.code).toBe("valid_values_invalid");
  });

  it("enforces per-source integrity rules", () => {
    const bad = schemaWith([
      { path: "a", name: "a", type: "string", source: "answer" }, // no internal_field
      { path: "b", name: "b", type: "string", source: "static" }, // no value
      { path: "c", name: "c", type: "string", source: "computed" }, // no computed key
      { path: "d", name: "d", type: "string", source: "macro" }, // no macro
      { path: "e", name: "e", type: "string", source: "macro", macro: "not_a_macro" },
    ]);
    const codes = validatePayloadSchema(bad).errors.map((e) => e.code);
    expect(codes).toContain("answer_missing_internal_field");
    expect(codes).toContain("static_missing_value");
    expect(codes).toContain("computed_missing_key");
    expect(codes).toContain("macro_missing_name");
    expect(codes).toContain("macro_unknown");
  });

  it("rejects a bad value_map and bad transform steps", () => {
    const bad = schemaWith([
      {
        path: "a",
        name: "a",
        type: "string",
        source: "answer",
        internal_field: "x",
        value_map: "nope" as unknown as Record<string, unknown>,
      },
      {
        path: "b",
        name: "b",
        type: "string",
        source: "answer",
        internal_field: "x",
        transform: [{ kind: "reverse" } as never],
      },
      {
        path: "c",
        name: "c",
        type: "string",
        source: "answer",
        internal_field: "x",
        transform: [{ kind: "mapEnum" } as never],
      },
      {
        path: "d",
        name: "d",
        type: "string",
        source: "answer",
        internal_field: "x",
        transform: [{ kind: "formatDate" } as never],
      },
    ]);
    const errors = validatePayloadSchema(bad).errors;
    expect(errors.filter((e) => e.code === "transform_invalid")).toHaveLength(3);
    expect(errors.some((e) => e.code === "value_map_invalid")).toBe(true);
  });

  it("token node rules: exactly one, type string, no mapping machinery", () => {
    const twoTokens = schemaWith([
      { path: "auth.t1", name: "t1", type: "string", source: "token" },
      { path: "auth.t2", name: "t2", type: "string", source: "token" },
    ]);
    expect(validatePayloadSchema(twoTokens).errors.some((e) => e.code === "token_node_duplicate")).toBe(true);

    const badToken = schemaWith([
      {
        path: "auth.t",
        name: "t",
        type: "number",
        source: "token",
        value_map: { a: 1 },
      },
    ]);
    const codes = validatePayloadSchema(badToken).errors.map((e) => e.code);
    expect(codes).toContain("token_node_invalid");
  });

  it("validates conditionals (op set, range bounds, in values)", () => {
    const bad = schemaWith([
      {
        path: "a",
        name: "a",
        type: "string",
        source: "static",
        value: "x",
        conditional: { when: "age", op: "between" as never },
      },
      {
        path: "b",
        name: "b",
        type: "string",
        source: "static",
        value: "x",
        conditional: { when: "age", op: "range" },
      },
      {
        path: "c",
        name: "c",
        type: "string",
        source: "static",
        value: "x",
        conditional: { when: "state", op: "in" },
      },
      {
        path: "d",
        name: "d",
        type: "string",
        source: "static",
        value: "x",
        conditional: { when: "", op: "eq", value: 1 },
      },
    ]);
    expect(validatePayloadSchema(bad).errors.filter((e) => e.code === "conditional_invalid")).toHaveLength(4);
  });
});

describe("buildPayload — §11.5 source kinds", () => {
  it("builds the normative example end-to-end (answer + macro + token)", () => {
    const payload = buildPayload(normativeSchema(), {
      answers: { homeowner: "true" },
      macros: { click_id: "clk_1" },
      token: {
        value: "secret-token",
        api_token_placement: "payload",
        request_execution_mode: "server",
      },
    });
    expect(payload).toEqual({
      data: { home_own: true },
      meta: { click_id: "clk_1" },
      auth: { api_token: "secret-token" },
    });
  });

  it("resolves static and computed sources", () => {
    const schema = schemaWith([
      { path: "meta.source", name: "source", type: "string", source: "static", value: "leadgen" },
      { path: "meta.score", name: "score", type: "number", source: "computed", computed: "quality_score" },
    ]);
    const payload = buildPayload(schema, ctx({ computed: { quality_score: 87 } }));
    expect(payload).toEqual({ meta: { source: "leadgen", score: 87 } });
  });

  it("builds arrays from numeric path segments (drivers.0.age)", () => {
    const schema = schemaWith([
      { path: "drivers.0.age", name: "age", type: "number", source: "answer", internal_field: "driver_age" },
      { path: "drivers.0.licensed", name: "licensed", type: "boolean", source: "static", value: true },
      { path: "drivers.1.age", name: "age", type: "number", source: "static", value: 44 },
    ]);
    const payload = buildPayload(schema, ctx({ answers: { driver_age: 30 } }));
    expect(payload).toEqual({ drivers: [{ age: 30, licensed: true }, { age: 44 }] });
  });

  describe("token placement × execution-mode matrix (§11.5 + §10.3)", () => {
    const tokenSchema = schemaWith([
      { path: "auth.api_token", name: "api_token", type: "string", source: "token" },
    ]);
    const cases: Array<{
      placement: "header" | "payload" | "query";
      mode: "server" | "client";
      value: string | undefined;
      injected: boolean;
    }> = [
      { placement: "payload", mode: "server", value: "tok", injected: true },
      { placement: "payload", mode: "client", value: "tok", injected: false },
      { placement: "header", mode: "server", value: "tok", injected: false },
      { placement: "header", mode: "client", value: "tok", injected: false },
      { placement: "query", mode: "server", value: "tok", injected: false },
      { placement: "query", mode: "client", value: "tok", injected: false },
      { placement: "payload", mode: "server", value: undefined, injected: false },
    ];
    for (const c of cases) {
      it(`placement=${c.placement} mode=${c.mode} value=${c.value === undefined ? "absent" : "present"} → ${c.injected ? "injected" : "omitted"}`, () => {
        const payload = buildPayload(tokenSchema, ctx({
          token: {
            value: c.value,
            api_token_placement: c.placement,
            request_execution_mode: c.mode,
          },
        }));
        if (c.injected) {
          expect(payload).toEqual({ auth: { api_token: "tok" } });
        } else {
          expect(payload).toEqual({});
        }
      });
    }

    it("omits the token node when ctx carries no token at all", () => {
      expect(buildPayload(tokenSchema, ctx())).toEqual({});
    });
  });
});

describe("buildPayload — value_map + transform pipeline (05 §12.7)", () => {
  it("applies the value_map on hit; a map MISS is invalid → fallback", () => {
    const schema = schemaWith([
      {
        path: "home_own",
        name: "home_own",
        type: "string",
        source: "answer",
        internal_field: "homeowner",
        value_map: { true: "Y", false: "N" },
        fallback: "U",
      },
    ]);
    expect(buildPayload(schema, ctx({ answers: { homeowner: true } }))).toEqual({ home_own: "Y" });
    expect(buildPayload(schema, ctx({ answers: { homeowner: false } }))).toEqual({ home_own: "N" });
    expect(buildPayload(schema, ctx({ answers: { homeowner: "maybe" } }))).toEqual({ home_own: "U" });
  });

  it("mapBoolean maps yes/no spellings, 1/0 and booleans; garbage is invalid", () => {
    expect(applyTransformPipeline("Yes", [{ kind: "mapBoolean" }])).toBe(true);
    expect(applyTransformPipeline("y", [{ kind: "mapBoolean" }])).toBe(true);
    expect(applyTransformPipeline("TRUE", [{ kind: "mapBoolean" }])).toBe(true);
    expect(applyTransformPipeline(1, [{ kind: "mapBoolean" }])).toBe(true);
    expect(applyTransformPipeline("No", [{ kind: "mapBoolean" }])).toBe(false);
    expect(applyTransformPipeline("n", [{ kind: "mapBoolean" }])).toBe(false);
    expect(applyTransformPipeline(0, [{ kind: "mapBoolean" }])).toBe(false);
    expect(applyTransformPipeline(false, [{ kind: "mapBoolean" }])).toBe(false);
    expect(applyTransformPipeline("maybe", [{ kind: "mapBoolean" }])).toBeUndefined();
    expect(applyTransformPipeline(7, [{ kind: "mapBoolean" }])).toBeUndefined();
  });

  it("mapEnum maps via the provided map; a miss is invalid", () => {
    const steps = [{ kind: "mapEnum" as const, map: { single: "S", married: "M" } }];
    expect(applyTransformPipeline("married", steps)).toBe("M");
    expect(applyTransformPipeline("single", steps)).toBe("S");
    expect(applyTransformPipeline("divorced", steps)).toBeUndefined();
  });

  it("formatDate formats ISO strings and epoch-ms through YYYY/MM/DD tokens (UTC)", () => {
    expect(applyTransformPipeline("2026-07-06T12:30:00Z", [{ kind: "formatDate", format: "YYYY-MM-DD" }])).toBe(
      "2026-07-06",
    );
    expect(applyTransformPipeline("2026-07-06T12:30:00Z", [{ kind: "formatDate", format: "MM/DD/YYYY" }])).toBe(
      "07/06/2026",
    );
    expect(applyTransformPipeline(Date.UTC(2026, 0, 2, 3, 4, 5), [
      { kind: "formatDate", format: "YYYY-MM-DD HH:mm:ss" },
    ])).toBe("2026-01-02 03:04:05");
    expect(applyTransformPipeline("not a date", [{ kind: "formatDate", format: "YYYY-MM-DD" }])).toBeUndefined();
  });

  it("formatPhone normalizes to 10 digits; anything else is invalid", () => {
    expect(applyTransformPipeline("(555) 123-4567", [{ kind: "formatPhone" }])).toBe("5551234567");
    expect(applyTransformPipeline("1-555-123-4567", [{ kind: "formatPhone" }])).toBe("5551234567");
    expect(applyTransformPipeline("+1 555 123 4567", [{ kind: "formatPhone" }])).toBe("5551234567");
    expect(applyTransformPipeline(5551234567, [{ kind: "formatPhone" }])).toBe("5551234567");
    expect(applyTransformPipeline("12345", [{ kind: "formatPhone" }])).toBeUndefined();
    expect(applyTransformPipeline("22-555-123-4567", [{ kind: "formatPhone" }])).toBeUndefined();
  });

  it("toNumber / toString / trim behave and chain left-to-right", () => {
    expect(applyTransformPipeline("42.5", [{ kind: "toNumber" }])).toBe(42.5);
    expect(applyTransformPipeline("x", [{ kind: "toNumber" }])).toBeUndefined();
    expect(applyTransformPipeline(42, [{ kind: "toString" }])).toBe("42");
    expect(applyTransformPipeline(true, [{ kind: "toString" }])).toBe("true");
    expect(applyTransformPipeline({ a: 1 }, [{ kind: "toString" }])).toBeUndefined();
    expect(applyTransformPipeline("  pad  ", [{ kind: "trim" }])).toBe("pad");
    expect(applyTransformPipeline(7, [{ kind: "trim" }])).toBe(7); // no-op on non-strings
    // Chain: trim → mapEnum ("  yes  " would miss the map without trim).
    expect(
      applyTransformPipeline("  yes  ", [{ kind: "trim" }, { kind: "mapEnum", map: { yes: 1, no: 0 } }]),
    ).toBe(1);
  });

  it("a transform pipeline runs INSIDE the node build (answer source)", () => {
    const schema = schemaWith([
      {
        path: "phone",
        name: "phone",
        type: "string",
        source: "answer",
        internal_field: "phone",
        transform: [{ kind: "formatPhone" }],
        fallback: "0000000000",
      },
    ]);
    expect(buildPayload(schema, ctx({ answers: { phone: "(555) 123-4567" } }))).toEqual({
      phone: "5551234567",
    });
    expect(buildPayload(schema, ctx({ answers: { phone: "12" } }))).toEqual({ phone: "0000000000" });
  });
});

describe("buildPayload — default / fallback / conditional / coercion", () => {
  it("ABSENT answer → default; INVALID value → fallback; neither → omitted", () => {
    const schema = schemaWith([
      {
        path: "age",
        name: "age",
        type: "number",
        source: "answer",
        internal_field: "age",
        default: 18,
        fallback: -1,
      },
      { path: "zip", name: "zip", type: "string", source: "answer", internal_field: "zip" },
    ]);
    // absent → default
    expect(buildPayload(schema, ctx({ answers: {} }))).toEqual({ age: 18 });
    // invalid (non-coercible) → fallback
    expect(buildPayload(schema, ctx({ answers: { age: "not-a-number" } }))).toEqual({ age: -1 });
    // valid value passes through; zip without default/fallback stays absent
    expect(buildPayload(schema, ctx({ answers: { age: 30 } }))).toEqual({ age: 30 });
  });

  it("null answers count as ABSENT (default applies)", () => {
    const schema = schemaWith([
      { path: "a", name: "a", type: "string", source: "answer", internal_field: "a", default: "dflt" },
    ]);
    expect(buildPayload(schema, ctx({ answers: { a: null } }))).toEqual({ a: "dflt" });
  });

  it("enum nodes reject values outside valid_values (fallback path)", () => {
    const schema = schemaWith([
      {
        path: "tier",
        name: "tier",
        type: "enum",
        source: "answer",
        internal_field: "tier",
        valid_values: ["gold", "silver"],
        fallback: "silver",
      },
    ]);
    expect(buildPayload(schema, ctx({ answers: { tier: "gold" } }))).toEqual({ tier: "gold" });
    expect(buildPayload(schema, ctx({ answers: { tier: "bronze" } }))).toEqual({ tier: "silver" });
  });

  it("type coercion accepts representable values and rejects the rest", () => {
    const schema = schemaWith([
      { path: "s", name: "s", type: "string", source: "answer", internal_field: "s" },
      { path: "n", name: "n", type: "number", source: "answer", internal_field: "n" },
      { path: "b", name: "b", type: "boolean", source: "answer", internal_field: "b" },
      { path: "o", name: "o", type: "object", source: "answer", internal_field: "o" },
      { path: "arr", name: "arr", type: "array", source: "answer", internal_field: "arr" },
    ]);
    const payload = buildPayload(schema, ctx({
      answers: { s: 12, n: "34", b: "true", o: { k: "v" }, arr: ["x"] },
    }));
    expect(payload).toEqual({ s: "12", n: 34, b: true, o: { k: "v" }, arr: ["x"] });
    // Non-representable values clean away (no default/fallback declared).
    expect(
      buildPayload(schema, ctx({ answers: { s: { x: 1 }, n: "z", b: "kinda", o: 3, arr: "no" } })),
    ).toEqual({});
  });

  describe("conditional drop (§11.5) — every 07 §21.4 op", () => {
    const node = (conditional: LeadgenPayloadNode["conditional"]): LeadgenPayloadSchema =>
      schemaWith([{ path: "x", name: "x", type: "string", source: "static", value: "v", conditional }]);

    it("eq / neq", () => {
      expect(buildPayload(node({ when: "homeowner", op: "eq", value: true }), ctx({ answers: { homeowner: true } }))).toEqual({ x: "v" });
      expect(buildPayload(node({ when: "homeowner", op: "eq", value: true }), ctx({ answers: { homeowner: false } }))).toEqual({});
      expect(buildPayload(node({ when: "homeowner", op: "neq", value: true }), ctx({ answers: { homeowner: false } }))).toEqual({ x: "v" });
      expect(buildPayload(node({ when: "homeowner", op: "neq", value: true }), ctx({ answers: { homeowner: true } }))).toEqual({});
    });

    it("gt / lt / gte / lte", () => {
      expect(buildPayload(node({ when: "age", op: "gt", value: 21 }), ctx({ answers: { age: 22 } }))).toEqual({ x: "v" });
      expect(buildPayload(node({ when: "age", op: "gt", value: 21 }), ctx({ answers: { age: 21 } }))).toEqual({});
      expect(buildPayload(node({ when: "age", op: "lt", value: 65 }), ctx({ answers: { age: 64 } }))).toEqual({ x: "v" });
      expect(buildPayload(node({ when: "age", op: "lt", value: 65 }), ctx({ answers: { age: 65 } }))).toEqual({});
      expect(buildPayload(node({ when: "age", op: "gte", value: 21 }), ctx({ answers: { age: 21 } }))).toEqual({ x: "v" });
      expect(buildPayload(node({ when: "age", op: "gte", value: 21 }), ctx({ answers: { age: 20 } }))).toEqual({});
      expect(buildPayload(node({ when: "age", op: "lte", value: 65 }), ctx({ answers: { age: 65 } }))).toEqual({ x: "v" });
      expect(buildPayload(node({ when: "age", op: "lte", value: 65 }), ctx({ answers: { age: 66 } }))).toEqual({});
    });

    it("range is inclusive on both bounds; in / not_in use the values list", () => {
      const range = node({ when: "age", op: "range", from: 25, to: 64 });
      expect(buildPayload(range, ctx({ answers: { age: 25 } }))).toEqual({ x: "v" });
      expect(buildPayload(range, ctx({ answers: { age: 64 } }))).toEqual({ x: "v" });
      expect(buildPayload(range, ctx({ answers: { age: 24 } }))).toEqual({});
      expect(buildPayload(range, ctx({ answers: { age: 65 } }))).toEqual({});
      expect(buildPayload(node({ when: "state", op: "in", values: ["CA", "NY"] }), ctx({ answers: { state: "CA" } }))).toEqual({ x: "v" });
      expect(buildPayload(node({ when: "state", op: "in", values: ["CA", "NY"] }), ctx({ answers: { state: "TX" } }))).toEqual({});
      expect(buildPayload(node({ when: "state", op: "not_in", values: ["CA"] }), ctx({ answers: { state: "TX" } }))).toEqual({ x: "v" });
      expect(buildPayload(node({ when: "state", op: "not_in", values: ["CA"] }), ctx({ answers: { state: "CA" } }))).toEqual({});
    });

    it("an unanswered `when` field never satisfies a conditional", () => {
      expect(buildPayload(node({ when: "missing", op: "neq", value: "x" }), ctx())).toEqual({});
      expect(buildPayload(node({ when: "missing", op: "not_in", values: ["x"] }), ctx())).toEqual({});
    });
  });
});

describe("cleanObject — the §11.5 no-fabrication rule", () => {
  it("drops undefined / null / empty-string / empty-object / empty-array", () => {
    expect(cleanObject(undefined)).toBeUndefined();
    expect(cleanObject(null)).toBeUndefined();
    expect(cleanObject("")).toBeUndefined();
    expect(cleanObject({})).toBeUndefined();
    expect(cleanObject([])).toBeUndefined();
  });

  it("KEEPS 0 and false (valid payload values, never treated as empty)", () => {
    expect(cleanObject({ zero: 0, no: false, empty: "" })).toEqual({ zero: 0, no: false });
    expect(cleanObject([0, false, ""])).toEqual([0, false]);
  });

  it("cleans recursively and cascades emptiness upward", () => {
    expect(
      cleanObject({
        keep: { a: 1, junk: null },
        drop: { nested: { deeper: "" } },
        list: [{ x: null }, { y: "ok" }],
      }),
    ).toEqual({ keep: { a: 1 }, list: [{ y: "ok" }] });
  });

  it("compacts arrays (dropped members do not leave holes)", () => {
    expect(cleanObject(["a", null, "b", "", "c"])).toEqual(["a", "b", "c"]);
  });

  it("a payload that cleans away entirely yields {} from buildPayload", () => {
    const schema = schemaWith([
      { path: "a.b", name: "b", type: "string", source: "static", value: "" },
    ]);
    expect(buildPayload(schema, ctx())).toEqual({});
  });
});

describe("inferSchemaFromExample — §11.2 automatic generation", () => {
  it("infers flat dotted-path leaves from nested objects with primitive types", () => {
    const schema = inferSchemaFromExample({
      data: { home_own: true, age: 30, zip: "90210" },
      note: null,
    });
    const byPath = new Map(schema.root.children.map((n) => [n.path, n]));
    expect(byPath.get("data.home_own")?.type).toBe("boolean");
    expect(byPath.get("data.age")?.type).toBe("number");
    expect(byPath.get("data.zip")?.type).toBe("string");
    expect(byPath.get("note")?.type).toBe("string"); // null infers as string
    expect(byPath.get("data.zip")?.name).toBe("zip");
    expect(schema.version).toBe(1);
  });

  it("infers arrays through numeric path segments", () => {
    const schema = inferSchemaFromExample({ drivers: [{ age: 30 }, { age: 44 }] });
    const paths = schema.root.children.map((n) => n.path).sort();
    expect(paths).toEqual(["drivers.0.age", "drivers.1.age"]);
  });

  it("declares empty objects/arrays as container-typed nodes so paths survive", () => {
    const schema = inferSchemaFromExample({ meta: {}, tags: [] });
    const byPath = new Map(schema.root.children.map((n) => [n.path, n]));
    expect(byPath.get("meta")?.type).toBe("object");
    expect(byPath.get("tags")?.type).toBe("array");
  });

  it("the inferred schema is immediately VALID (editable starting point, never locks)", () => {
    const schema = inferSchemaFromExample({
      data: { home_own: true, drivers: [{ age: 30 }] },
      meta: {},
    });
    expect(validatePayloadSchema(schema).errors).toEqual([]);
    // Nodes default optional + static-sourced (the admin re-sources them).
    for (const node of schema.root.children) {
      expect(node.required).toBe(false);
      expect(node.source).toBe("static");
    }
  });

  it("an inferred node can be re-marked as enum and the domain then enforces", () => {
    const schema = inferSchemaFromExample({ plan: "gold" });
    const node = schema.root.children.find((n) => n.path === "plan");
    expect(node).toBeDefined();
    if (node === undefined) return;
    node.type = "enum";
    node.valid_values = ["gold", "silver"];
    node.source = "answer";
    node.internal_field = "plan";
    delete node.value;
    expect(validatePayloadSchema(schema).ok).toBe(true);
    node.default = "bronze"; // outside the domain → enum violation
    expect(validatePayloadSchema(schema).errors[0]?.code).toBe("enum_value_violation");
  });

  it("a bare primitive example yields an empty (but valid) schema", () => {
    const schema = inferSchemaFromExample("just text");
    expect(schema.root.children).toEqual([]);
    expect(validatePayloadSchema(schema).ok).toBe(true);
  });

  it("keys outside the dotted-path grammar are skipped, the rest survive", () => {
    const schema = inferSchemaFromExample({ ok_key: 1, "bad key": 2, "bad.dot": 3 });
    expect(schema.root.children.map((n) => n.path)).toEqual(["ok_key"]);
  });
});
