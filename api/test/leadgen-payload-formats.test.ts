// LeadGen fix-contract v2.4 — G2 format matrices (11 §11.3, Phase 2):
//   * §6.7 boolean preset output shapes — all 6 presets through the REAL
//     buildPayload (the UI's preset select emits the value_map/mapBoolean
//     storage these fixtures use verbatim);
//   * §6.6 date format matrix — the picker's formats + custom tokens +
//     invalid-date→fallback through the formatDate transform;
//   * §6.9 default/fallback TYPED emission + the looseJson-normalization
//     contract (defaults are FINAL values, emitted verbatim);
//   * §6.8 array item schemas per SOURCE type — coverage of what the runtime
//     supports (static list / multi-select answer / repeated answer group),
//     plus the documented-unsupported sources (computed arrays, split
//     string) proven to route through the deterministic fallback path
//     rather than inventing behavior;
//   * B9 §6.4 mirrored choiceDisplay matrix on Section content
//     (content-schema.ts validation leg — the render leg shipped Phase 1).

import { describe, expect, it } from "vitest";
import {
  applyTransformPipeline,
  buildPayload,
  validatePayloadSchema,
  type LeadgenPayloadNode,
  type LeadgenPayloadSchema,
} from "../src/leadgen/payload";
import { validateSectionContent } from "../src/public/leadgen/components/content-schema";

function schemaWith(nodes: LeadgenPayloadNode[]): LeadgenPayloadSchema {
  return { version: 1, root: { type: "object", children: nodes } };
}

// ---------------------------------------------------------------------------
// §6.7 boolean output presets — all 6 through the REAL buildPayload
// ---------------------------------------------------------------------------

describe("§6.7 boolean preset output shapes (B10) — through buildPayload", () => {
  // The preset table exactly as the picker emits it: node type + value_map.
  const presets: Array<{
    name: string;
    type: "boolean" | "string" | "number";
    value_map: Record<string, unknown>;
    whenTrue: unknown;
    whenFalse: unknown;
  }> = [
    { name: "true / false (boolean)", type: "boolean", value_map: { true: true, false: false }, whenTrue: true, whenFalse: false },
    { name: '"1" / "0" (string)', type: "string", value_map: { true: "1", false: "0" }, whenTrue: "1", whenFalse: "0" },
    { name: "1 / 0 (number)", type: "number", value_map: { true: 1, false: 0 }, whenTrue: 1, whenFalse: 0 },
    { name: '"Y" / "N"', type: "string", value_map: { true: "Y", false: "N" }, whenTrue: "Y", whenFalse: "N" },
    { name: '"yes" / "no"', type: "string", value_map: { true: "yes", false: "no" }, whenTrue: "yes", whenFalse: "no" },
    { name: "custom (two type-aware inputs)", type: "string", value_map: { true: "ACCEPTED", false: "DECLINED" }, whenTrue: "ACCEPTED", whenFalse: "DECLINED" },
  ];

  for (const preset of presets) {
    it(`${preset.name}: emits both outputs, identically for boolean and string answers`, () => {
      const schema = schemaWith([
        {
          path: "home_own",
          name: "home_own",
          type: preset.type,
          source: "answer",
          internal_field: "homeowner",
          value_map: preset.value_map,
        },
      ]);
      // value_map lookup is String(value) — a real boolean answer and its
      // string spelling land on the same preset output.
      for (const yes of [true, "true"]) {
        expect(buildPayload(schema, { answers: { homeowner: yes } })).toEqual({
          home_own: preset.whenTrue,
        });
      }
      for (const no of [false, "false"]) {
        expect(buildPayload(schema, { answers: { homeowner: no } })).toEqual({
          home_own: preset.whenFalse,
        });
      }
    });
  }

  it("falsy preset outputs (0 / false / '0') survive cleanObject — never treated as empty", () => {
    const numberPreset = schemaWith([
      { path: "flag", name: "flag", type: "number", source: "answer", internal_field: "f", value_map: { true: 1, false: 0 } },
    ]);
    expect(buildPayload(numberPreset, { answers: { f: false } })).toEqual({ flag: 0 });
    const booleanPreset = schemaWith([
      { path: "flag", name: "flag", type: "boolean", source: "answer", internal_field: "f", value_map: { true: true, false: false } },
    ]);
    expect(buildPayload(booleanPreset, { answers: { f: "false" } })).toEqual({ flag: false });
  });

  it("the mapBoolean-transform route normalizes yes/no spellings BEFORE a preset map", () => {
    // §6.7 "emitting the value_map/mapBoolean transform": mapBoolean folds the
    // answer spellings to true/false; a preset value_map cannot see "Yes".
    const schema = schemaWith([
      {
        path: "insured",
        name: "insured",
        type: "string",
        source: "answer",
        internal_field: "insured",
        transform: [{ kind: "mapBoolean" }, { kind: "mapEnum", map: { true: "Y", false: "N" } }],
        fallback: "U",
      },
    ]);
    expect(buildPayload(schema, { answers: { insured: "Yes" } })).toEqual({ insured: "Y" });
    expect(buildPayload(schema, { answers: { insured: "n" } })).toEqual({ insured: "N" });
    expect(buildPayload(schema, { answers: { insured: "dunno" } })).toEqual({ insured: "U" });
  });
});

// ---------------------------------------------------------------------------
// §6.6 date format matrix — through the formatDate transform + buildPayload
// ---------------------------------------------------------------------------

describe("§6.6 date format matrix (B11) — formatDate through buildPayload", () => {
  const dateNode = (format: string, extra: Partial<LeadgenPayloadNode> = {}): LeadgenPayloadSchema =>
    schemaWith([
      {
        path: "applicant.dob",
        name: "dob",
        type: "string",
        source: "answer",
        internal_field: "dob",
        transform: [{ kind: "formatDate", format }],
        ...extra,
      },
    ]);
  const DOB = "1990-04-15"; // a date input's value (parsed as UTC midnight)

  // The picker's formatDate-expressible formats (the UI emits these token
  // strings — no transform JSON typed). "Unix timestamp" is the 6th picker
  // option and has NO formatDate token — see the documented-unsupported test.
  const formats: Array<{ picker: string; tokens: string; expected: string }> = [
    { picker: "YYYY-MM-DD", tokens: "YYYY-MM-DD", expected: "1990-04-15" },
    { picker: "MM/DD/YYYY", tokens: "MM/DD/YYYY", expected: "04/15/1990" },
    { picker: "DD/MM/YYYY", tokens: "DD/MM/YYYY", expected: "15/04/1990" },
    { picker: "ISO-8601", tokens: "YYYY-MM-DDTHH:mm:ssZ", expected: "1990-04-15T00:00:00Z" },
    { picker: "Custom format", tokens: "DD.MM.YYYY HH:mm:ss", expected: "15.04.1990 00:00:00" },
  ];
  for (const f of formats) {
    it(`${f.picker} (tokens '${f.tokens}')`, () => {
      expect(buildPayload(dateNode(f.tokens), { answers: { dob: DOB } })).toEqual({
        applicant: { dob: f.expected },
      });
    });
  }

  it("custom tokens format a full datetime input (UTC) and accept epoch-ms input", () => {
    expect(
      applyTransformPipeline("2026-07-08T14:05:06Z", [{ kind: "formatDate", format: "YYYY/MM/DD HH-mm-ss" }]),
    ).toBe("2026/07/08 14-05-06");
    expect(
      applyTransformPipeline(Date.UTC(2026, 6, 8, 14, 5, 6), [{ kind: "formatDate", format: "MM/DD/YYYY" }]),
    ).toBe("07/08/2026");
  });

  it("an invalid date routes to the node fallback (§6.6 validation preview path)", () => {
    const schema = dateNode("YYYY-MM-DD", { fallback: "1900-01-01" });
    expect(buildPayload(schema, { answers: { dob: "not a date" } })).toEqual({
      applicant: { dob: "1900-01-01" },
    });
    // ...and with no fallback the field cleans away (no fabrication).
    expect(buildPayload(dateNode("YYYY-MM-DD"), { answers: { dob: "31/31/borked" } })).toEqual({});
  });

  it("DOCUMENTED-UNSUPPORTED: 'Unix timestamp' has no formatDate token (finding — 06 §6.6)", () => {
    // formatDate's token set is YYYY MM DD HH mm ss (payload.ts): there is no
    // epoch token, so a Unix-timestamp OUTPUT cannot be expressed. A token
    // string like "X" passes through as a literal — proving the gap rather
    // than inventing runtime behavior.
    expect(applyTransformPipeline(DOB, [{ kind: "formatDate", format: "X" }])).toBe("X");
  });
});

// ---------------------------------------------------------------------------
// §6.9 default / fallback typed emission + looseJson normalization
// ---------------------------------------------------------------------------

describe("§6.9 default/fallback TYPED emission (B1 cluster)", () => {
  it("typed defaults emit VERBATIM as final values (number 0 / boolean false kept)", () => {
    const schema = schemaWith([
      { path: "score", name: "score", type: "number", source: "answer", internal_field: "score", default: 0 },
      { path: "insured", name: "insured", type: "boolean", source: "answer", internal_field: "insured", default: false },
    ]);
    expect(buildPayload(schema, { answers: {} })).toEqual({ score: 0, insured: false });
  });

  it("typed fallbacks emit VERBATIM on invalid values", () => {
    const schema = schemaWith([
      { path: "age", name: "age", type: "number", source: "answer", internal_field: "age", fallback: -1 },
      { path: "ok", name: "ok", type: "boolean", source: "answer", internal_field: "ok", fallback: false },
    ]);
    expect(buildPayload(schema, { answers: { age: "NaN-ish", ok: "kinda" } })).toEqual({
      age: -1,
      ok: false,
    });
  });

  it("looseJson normalization contract: a NORMALIZED typed default and its legacy loose-string twin emit differently", () => {
    // §6.9 kills the looseJson string-vs-JSON ambiguity ON THE UI SIDE: the
    // editor writes typed values and prompts to normalize legacy loose ones.
    // The RUNTIME contract these fixtures pin: default/fallback are FINAL
    // values — emitted verbatim, never re-coerced — so "true" (legacy loose
    // string) and true (normalized) are observably different payloads.
    const loose = schemaWith([
      { path: "flag", name: "flag", type: "boolean", source: "answer", internal_field: "f", default: "true" },
    ]);
    const normalized = schemaWith([
      { path: "flag", name: "flag", type: "boolean", source: "answer", internal_field: "f", default: true },
    ]);
    expect(buildPayload(loose, { answers: {} })).toEqual({ flag: "true" }); // legacy loose string, verbatim
    expect(buildPayload(normalized, { answers: {} })).toEqual({ flag: true }); // normalized typed value
    const looseNumber = schemaWith([
      { path: "n", name: "n", type: "number", source: "answer", internal_field: "n", default: "0" },
    ]);
    expect(buildPayload(looseNumber, { answers: {} })).toEqual({ n: "0" }); // "0" ≠ 0 — the ambiguity the UI normalizes
  });

  it("an empty-string default cleans away (no fabrication) — Disabled-default equivalent", () => {
    const schema = schemaWith([
      { path: "note", name: "note", type: "string", source: "answer", internal_field: "note", default: "" },
    ]);
    expect(buildPayload(schema, { answers: {} })).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// §6.9 computed default/fallback references — runtime, through buildPayload
// ---------------------------------------------------------------------------

describe("§6.9 computed default/fallback references — runtime", () => {
  const node = (extra: Partial<LeadgenPayloadNode>): LeadgenPayloadNode => ({
    path: "sent_at",
    name: "sent_at",
    type: "string",
    source: "answer",
    internal_field: "sent_at",
    ...extra,
  });

  it("ABSENT answer → the computed DEFAULT resolves from ctx.computed (the per-request context)", () => {
    const schema = schemaWith([node({ default: { source: "computed", key: "today_date_utc" } })]);
    expect(
      buildPayload(schema, { answers: {}, computed: { today_date_utc: "2026-07-08" } }),
    ).toEqual({ sent_at: "2026-07-08" });
    // per-request `now`: a later build (new context, new computed values)
    // resolves the NEW value — the ref is resolved at build, never baked in.
    expect(
      buildPayload(schema, { answers: {}, computed: { today_date_utc: "2026-07-09" } }),
    ).toEqual({ sent_at: "2026-07-09" });
  });

  it("INVALID answer → the computed FALLBACK resolves from ctx.computed", () => {
    const schema = schemaWith([
      node({
        path: "ts",
        name: "ts",
        internal_field: "ts",
        type: "number",
        fallback: { source: "computed", key: "request_timestamp" },
      }),
    ]);
    expect(
      buildPayload(schema, {
        answers: { ts: "not-a-number" },
        computed: { request_timestamp: 1783468800 },
      }),
    ).toEqual({ ts: 1783468800 });
    // a VALID answer never touches the fallback
    expect(
      buildPayload(schema, { answers: { ts: 5 }, computed: { request_timestamp: 1783468800 } }),
    ).toEqual({ ts: 5 });
  });

  it("computed value ABSENT/undefined → treated as NO default (the existing absent path)", () => {
    const schema = schemaWith([node({ default: { source: "computed", key: "today_date_utc" } })]);
    // key not populated in this build's context
    expect(buildPayload(schema, { answers: {}, computed: {} })).toEqual({});
    // no ctx.computed at all (e.g. answers.ts buildOfferPayload's per-Offer leg)
    expect(buildPayload(schema, { answers: {} })).toEqual({});
  });

  it("a malformed ref-shaped default (save-blocked) defends as no-default — never a throw", () => {
    const schema = schemaWith([
      node({ default: { source: "computed" } as unknown as LeadgenPayloadNode["default"] }),
    ]);
    expect(buildPayload(schema, { answers: {}, computed: { today_date_utc: "x" } })).toEqual({});
  });

  it("LITERAL defaults/fallbacks stay byte-identical alongside refs (incl. legacy looseJson strings)", () => {
    const schema = schemaWith([
      node({ path: "lit", name: "lit", internal_field: "lit", default: "web" }),
      node({ path: "loose", name: "loose", internal_field: "loose", type: "boolean", default: "true" }),
      node({ path: "obj", name: "obj", internal_field: "obj", type: "object", default: { a: 1 } }),
      node({ path: "ref", name: "ref", internal_field: "ref", default: { source: "computed", key: "timezone" } }),
    ]);
    expect(buildPayload(schema, { answers: {}, computed: { timezone: "Europe/Berlin" } })).toEqual({
      lit: "web",
      loose: "true", // legacy loose string, verbatim (§6.14)
      obj: { a: 1 }, // a literal object default is NOT a ref
      ref: "Europe/Berlin",
    });
  });
});

// ---------------------------------------------------------------------------
// §6.5 free-text constraints (B12 completion) — runtime, through buildPayload
// ---------------------------------------------------------------------------

describe("§6.5 free-text constraint matrix — runtime", () => {
  const freeText = (extra: Partial<LeadgenPayloadNode>): LeadgenPayloadNode => ({
    path: "first_name",
    name: "first_name",
    type: "string",
    source: "answer",
    internal_field: "first_name",
    fallback: "FALLBACK",
    ...extra,
  });
  const build = (nodeExtra: Partial<LeadgenPayloadNode>, answer: unknown): Record<string, unknown> =>
    buildPayload(schemaWith([freeText(nodeExtra)]), { answers: { first_name: answer } });

  it("max length: under and exactly-at pass (sanitized), over → fallback", () => {
    expect(build({ free_text_max_length: 10 }, "Alice")).toEqual({ first_name: "Alice" });
    expect(build({ free_text_max_length: 5 }, "Alice")).toEqual({ first_name: "Alice" });
    expect(build({ free_text_max_length: 4 }, "Alice")).toEqual({ first_name: "FALLBACK" });
  });

  it("sanitize runs BEFORE the check: control chars stripped + trimmed, the SANITIZED value is sent", () => {
    expect(build({ free_text_max_length: 5 }, "  Alice \u0000\u0007 ")).toEqual({
      first_name: "Alice",
    });
    expect(build({ free_text_pattern: "none" }, "\tAl\u001Fice\u007F ")).toEqual({
      first_name: "Alice",
    });
  });

  it("preset letters: letters+spaces pass, digits/symbols → fallback", () => {
    expect(build({ free_text_pattern: "letters" }, "Mary Jane")).toEqual({ first_name: "Mary Jane" });
    expect(build({ free_text_pattern: "letters" }, "abc123")).toEqual({ first_name: "FALLBACK" });
    expect(build({ free_text_pattern: "letters" }, "a-b")).toEqual({ first_name: "FALLBACK" });
  });

  it("preset digits: digits pass (numbers coerce to their string form first), the rest → fallback", () => {
    expect(build({ free_text_pattern: "digits" }, "90210")).toEqual({ first_name: "90210" });
    expect(build({ free_text_pattern: "digits" }, 90210)).toEqual({ first_name: "90210" });
    expect(build({ free_text_pattern: "digits" }, "90 210")).toEqual({ first_name: "FALLBACK" });
    expect(build({ free_text_pattern: "digits" }, "9021O")).toEqual({ first_name: "FALLBACK" });
  });

  it("preset none: sanitize only — no pattern check", () => {
    expect(build({ free_text_pattern: "none" }, "anything !@# 123")).toEqual({
      first_name: "anything !@# 123",
    });
  });

  it("custom pattern: match passes, mismatch → fallback; case-exact as authored", () => {
    const custom = { free_text_pattern: "custom" as const, free_text_pattern_custom: "^[A-Z]{2}[0-9]{4}$" };
    expect(build(custom, "CA1234")).toEqual({ first_name: "CA1234" });
    expect(build(custom, "ca1234")).toEqual({ first_name: "FALLBACK" });
    expect(build(custom, "CA12345")).toEqual({ first_name: "FALLBACK" });
  });

  // MAJOR-1 (adversarial, two-layer defense). buildPayload does NOT re-run
  // save validation, so a node here simulates a bomb that reached the money
  // path via legacy/pre-fix stored data or a direct DB edit — exactly the
  // at-cap exponential the re-review proved an input cap alone can't stop.
  it("ReDoS layer-2 (runtime screen): a stored EXPONENTIAL pattern is refused before .test() → fallback, no hang", () => {
    // ((a)+)+ evaded the old flat save-regex and hangs ~30-char input in ~seconds.
    // The runtime isCatastrophicRegexShape screen refuses it regardless of input length.
    const bomb = { free_text_pattern: "custom" as const, free_text_pattern_custom: "((a)+)+$" };
    for (const input of ["a".repeat(30) + "X", "a".repeat(40) + "X"]) {
      const started = performance.now();
      const out = build(bomb, input); // in-bounds length (≤4096) — the input cap does NOT save us here
      expect(out).toEqual({ first_name: "FALLBACK" }); // the runtime pattern screen does
      expect(performance.now() - started).toBeLessThan(250);
    }
  });

  it("ReDoS layer-1 (input cap): over-cap input against a linear custom pattern → fallback before .test(), even with max_length UNSET", () => {
    // a short in-bounds input still runs a benign custom pattern normally
    expect(build({ free_text_pattern: "custom", free_text_pattern_custom: "^a+$" }, "aaa")).toEqual({
      first_name: "aaa",
    });
    // >4096 chars, no max_length set → invalid before the regex → fallback, fast
    const started = performance.now();
    const out = build({ free_text_pattern: "custom", free_text_pattern_custom: "^a+$" }, "a".repeat(6000));
    expect(out).toEqual({ first_name: "FALLBACK" });
    expect(performance.now() - started).toBeLessThan(250);
  });

  it("violation with NO fallback → the node cleans away (standard invalid machinery, never a throw)", () => {
    const schema = schemaWith([
      {
        path: "zip",
        name: "zip",
        type: "string",
        source: "answer",
        internal_field: "zip",
        free_text_pattern: "digits",
      },
    ]);
    expect(buildPayload(schema, { answers: { zip: "not digits" } })).toEqual({});
  });

  it("combined max length + pattern: BOTH must hold", () => {
    const both = { free_text_max_length: 5, free_text_pattern: "digits" as const };
    expect(build(both, "12345")).toEqual({ first_name: "12345" });
    expect(build(both, "123456")).toEqual({ first_name: "FALLBACK" }); // too long
    expect(build(both, "12a45")).toEqual({ first_name: "FALLBACK" }); // pattern miss
  });

  it("§1.4 byte-compatibility: a plain node WITHOUT the fields passes the raw value through UNsanitized", () => {
    const plain = schemaWith([
      { path: "note", name: "note", type: "string", source: "answer", internal_field: "note" },
    ]);
    // control chars + padding survive exactly as before the §6.5 completion
    expect(buildPayload(plain, { answers: { note: " padded \u0007 " } })).toEqual({
      note: " padded \u0007 ",
    });
  });

  it("default/fallback still apply in their §1.4 order around the free-text leg", () => {
    // ABSENT answer → default (the free-text leg never runs on absence)
    expect(
      buildPayload(
        schemaWith([freeText({ default: "DEFAULT", free_text_pattern: "digits" })]),
        { answers: {} },
      ),
    ).toEqual({ first_name: "DEFAULT" });
    // violation → fallback may even be a §6.9 computed ref
    expect(
      buildPayload(
        schemaWith([
          freeText({
            fallback: { source: "computed", key: "timezone" },
            free_text_pattern: "digits",
          }),
        ]),
        { answers: { first_name: "not digits" }, computed: { timezone: "Europe/Berlin" } },
      ),
    ).toEqual({ first_name: "Europe/Berlin" });
  });
});

// ---------------------------------------------------------------------------
// §6.8 array item schemas per SOURCE type (B2 — runtime already correct)
// ---------------------------------------------------------------------------

describe("§6.8 array sources — what the runtime supports", () => {
  it("STATIC LIST: an array node with a static value emits the authored list", () => {
    const schema = schemaWith([
      { path: "coverage_types", name: "coverage_types", type: "array", source: "static", value: ["home", "auto"] },
    ]);
    expect(buildPayload(schema, { answers: {} })).toEqual({ coverage_types: ["home", "auto"] });
  });

  it("MULTI-SELECT ANSWER: an array answer (MultiChoiceCardGroup produces array) passes through", () => {
    const schema = schemaWith([
      { path: "coverages", name: "coverages", type: "array", source: "answer", internal_field: "coverages", fallback: [] },
    ]);
    expect(buildPayload(schema, { answers: { coverages: ["life", "burial"] } })).toEqual({
      coverages: ["life", "burial"],
    });
    // A non-array answer is INVALID for type array → fallback ([] cleans away).
    expect(buildPayload(schema, { answers: { coverages: "life" } })).toEqual({});
  });

  it("REPEATED ANSWER GROUP: driver_1_*/driver_2_* answers collect via numeric path segments", () => {
    // §6.8: the storage model for repeated groups IS the flat dotted-path
    // list with numeric segments (payload.ts setAtPath) — one node per
    // element field, each answer-sourced from its repeated internal_field.
    const schema = schemaWith([
      { path: "drivers.0.age", name: "age", type: "number", source: "answer", internal_field: "driver_1_age" },
      { path: "drivers.0.licensed", name: "licensed", type: "boolean", source: "answer", internal_field: "driver_1_licensed" },
      { path: "drivers.1.age", name: "age", type: "number", source: "answer", internal_field: "driver_2_age" },
      { path: "drivers.1.licensed", name: "licensed", type: "boolean", source: "answer", internal_field: "driver_2_licensed" },
    ]);
    expect(
      buildPayload(schema, {
        answers: { driver_1_age: 30, driver_1_licensed: true, driver_2_age: 44, driver_2_licensed: false },
      }),
    ).toEqual({
      drivers: [
        { age: 30, licensed: true },
        { age: 44, licensed: false },
      ],
    });
    // A missing second-driver answer set compacts (no fabricated holes).
    expect(buildPayload(schema, { answers: { driver_1_age: 30, driver_1_licensed: true } })).toEqual({
      drivers: [{ age: 30, licensed: true }],
    });
  });

  it("arrays of primitives via numeric segments (tags.0 / tags.1)", () => {
    const schema = schemaWith([
      { path: "tags.0", name: "0", type: "string", source: "static", value: "life" },
      { path: "tags.1", name: "1", type: "string", source: "answer", internal_field: "tag2" },
    ]);
    expect(buildPayload(schema, { answers: { tag2: "senior" } })).toEqual({ tags: ["life", "senior"] });
  });

  it("DOCUMENTED-UNSUPPORTED: a COMPUTED array source falls back (finding — 06 §6.8)", () => {
    // Every COMPUTED_REGISTRY resolver (04 §4.4) outputs string|number; type
    // "array" coercion rejects them → deterministic fallback path. No
    // registry key produces an array today, so "array source: Computed" has
    // no runtime leg — proven here, not invented.
    const schema = schemaWith([
      {
        path: "stamps",
        name: "stamps",
        type: "array",
        source: "computed",
        computed: "request_timestamp",
        fallback: ["fallback-stamp"],
      },
    ]);
    expect(validatePayloadSchema(schema).ok).toBe(true); // the key itself is valid
    expect(buildPayload(schema, { answers: {}, computed: { request_timestamp: 1783468800 } })).toEqual({
      stamps: ["fallback-stamp"],
    });
  });

  it("DOCUMENTED-UNSUPPORTED: SPLIT STRING has no transform step (finding — 06 §6.8)", () => {
    // The normative transform set (05 §12: mapBoolean/mapEnum/formatDate/
    // formatPhone/toNumber/toString/trim) contains no split(delimiter) step,
    // and a "split" kind is rejected at save. A comma-joined string answer
    // under type array is INVALID → fallback. Proven, not invented.
    const rejected = validatePayloadSchema(
      schemaWith([
        {
          path: "parts",
          name: "parts",
          type: "array",
          source: "answer",
          internal_field: "csv",
          transform: [{ kind: "split", delimiter: "," } as never],
        },
      ]),
    );
    expect(rejected.errors.some((e) => e.code === "transform_invalid")).toBe(true);

    const schema = schemaWith([
      { path: "parts", name: "parts", type: "array", source: "answer", internal_field: "csv", fallback: [] },
    ]);
    expect(buildPayload(schema, { answers: { csv: "a,b,c" } })).toEqual({}); // fallback [] cleans away
  });
});

