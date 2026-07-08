// LeadGen computed variable registry (fix-contract v2.4 04 §4.4 — R3/B8):
// the 12-key COMPUTED_REGISTRY resolves deterministically over a fixed
// `now` + visitor timezone (EST pair DST-aware via America/New_York), and
// payload.ts save-time validation accepts ONLY registry keys
// (`computed_unknown_key` otherwise).

import { describe, expect, it } from "vitest";
import {
  COMPUTED_REGISTRY,
  isLeadgenComputedKey,
  LEADGEN_COMPUTED_KEYS,
  resolveAllComputed,
} from "../src/leadgen/computed";
import {
  buildPayload,
  validatePayloadSchema,
  type LeadgenPayloadNode,
  type LeadgenPayloadSchema,
} from "../src/leadgen/payload";

// 2026-07-08T14:00:00.123Z — a Wednesday; America/New_York is on EDT (UTC-4).
const JULY_NOW = 1783519200123;
// 2026-01-15T03:30:00.000Z — a Thursday UTC; America/New_York is on EST
// (UTC-5), i.e. Wednesday Jan 14, 22:30 local.
const JAN_NOW = 1768447800000;
// 2026-07-08T03:30:00.000Z — a Wednesday UTC; EDT (UTC-4) puts New York on
// Tuesday Jul 7, 23:30 local. Same 03:30Z wall clock as the January fixture
// but a DIFFERENT local hour (23 vs 22) — the DST proof.
const JULY_NIGHT_NOW = 1783481400000;

const ALL_12_KEYS = [
  "request_timestamp",
  "request_timestamp_ms",
  "unix_timestamp",
  "iso_timestamp",
  "today_date_utc",
  "current_date_utc",
  "current_datetime_utc",
  "current_hour_utc",
  "current_hour_est",
  "current_day_of_week_utc",
  "current_day_of_week_est",
  "timezone",
] as const;

function schemaWith(nodes: LeadgenPayloadNode[]): LeadgenPayloadSchema {
  return { version: 1, root: { type: "object", children: nodes } };
}

describe("COMPUTED_REGISTRY — the 12 keys (§4.4 table)", () => {
  it("contains exactly the 12 contract keys, in table order", () => {
    expect(LEADGEN_COMPUTED_KEYS).toEqual([...ALL_12_KEYS]);
    expect(Object.keys(COMPUTED_REGISTRY).sort()).toEqual([...ALL_12_KEYS].sort());
  });

  it("every entry carries key/label/description/outputType/example/resolver", () => {
    for (const key of ALL_12_KEYS) {
      const entry = COMPUTED_REGISTRY[key];
      expect(entry, key).toBeDefined();
      expect(entry?.key).toBe(key);
      expect(entry?.label.length).toBeGreaterThan(0);
      expect(entry?.description.length).toBeGreaterThan(0);
      expect(["string", "number"]).toContain(entry?.outputType);
      expect(entry?.example.length).toBeGreaterThan(0);
      expect(typeof entry?.resolver).toBe("function");
    }
  });

  it("resolved values match each entry's declared outputType", () => {
    const input = { now: JULY_NOW, timezone: "Europe/Berlin" };
    for (const key of ALL_12_KEYS) {
      const entry = COMPUTED_REGISTRY[key];
      expect(typeof entry?.resolver(input), key).toBe(entry?.outputType);
    }
  });

  it("isLeadgenComputedKey accepts all 12 and rejects everything else", () => {
    for (const key of ALL_12_KEYS) expect(isLeadgenComputedKey(key), key).toBe(true);
    for (const bad of ["quality_score", "request_time", "", "constructor", "__proto__", "Request_Timestamp"]) {
      expect(isLeadgenComputedKey(bad), bad).toBe(false);
    }
  });
});

describe("computed resolvers — fixed-now fixtures (exact values)", () => {
  it("resolves all 12 keys for 2026-07-08T14:00:00.123Z (EDT)", () => {
    expect(resolveAllComputed({ now: JULY_NOW, timezone: "Europe/Berlin" })).toEqual({
      request_timestamp: 1783519200,
      request_timestamp_ms: 1783519200123,
      unix_timestamp: 1783519200,
      iso_timestamp: "2026-07-08T14:00:00.123Z",
      today_date_utc: "2026-07-08",
      current_date_utc: "2026-07-08",
      current_datetime_utc: "2026-07-08 14:00:00",
      current_hour_utc: 14,
      current_hour_est: 10, // EDT = UTC-4
      current_day_of_week_utc: "wednesday",
      current_day_of_week_est: "wednesday",
      timezone: "Europe/Berlin",
    });
  });

  it("aliases can never drift: unix_timestamp≡request_timestamp, current_date_utc≡today_date_utc", () => {
    const values = resolveAllComputed({ now: JAN_NOW, timezone: "" });
    expect(values["unix_timestamp"]).toBe(values["request_timestamp"]);
    expect(values["current_date_utc"]).toBe(values["today_date_utc"]);
  });

  it("January fixture is EST (UTC-5): 03:30Z is Wednesday 22:30 in New York", () => {
    const values = resolveAllComputed({ now: JAN_NOW, timezone: "America/Chicago" });
    expect(values["iso_timestamp"]).toBe("2026-01-15T03:30:00.000Z");
    expect(values["current_hour_utc"]).toBe(3);
    expect(values["current_day_of_week_utc"]).toBe("thursday");
    expect(values["current_hour_est"]).toBe(22); // EST = UTC-5
    expect(values["current_day_of_week_est"]).toBe("wednesday"); // day rolls back across midnight
  });

  it("July fixture is EDT (UTC-4): the SAME 03:30Z wall clock is Tuesday 23:30 in New York", () => {
    const values = resolveAllComputed({ now: JULY_NIGHT_NOW, timezone: "" });
    expect(values["iso_timestamp"]).toBe("2026-07-08T03:30:00.000Z");
    expect(values["current_hour_utc"]).toBe(3);
    expect(values["current_day_of_week_utc"]).toBe("wednesday");
    expect(values["current_hour_est"]).toBe(23); // EDT = UTC-4 ≠ the January 22
    expect(values["current_day_of_week_est"]).toBe("tuesday");
  });

  it("timezone resolves the visitor timezone and falls back to \"\"", () => {
    expect(COMPUTED_REGISTRY["timezone"]?.resolver({ now: JULY_NOW, timezone: "Asia/Tokyo" })).toBe(
      "Asia/Tokyo",
    );
    expect(COMPUTED_REGISTRY["timezone"]?.resolver({ now: JULY_NOW, timezone: "" })).toBe("");
  });

  it("resolvers are pure: same input twice ⇒ identical output", () => {
    const input = { now: JULY_NOW, timezone: "Europe/Berlin" };
    expect(resolveAllComputed(input)).toEqual(resolveAllComputed(input));
  });
});

describe("payload.ts computed-key validation (§4.4: registry is the ONLY source)", () => {
  const computedNode = (key: string): LeadgenPayloadNode => ({
    path: "meta.ts",
    name: "ts",
    type: "string",
    source: "computed",
    computed: key,
  });

  it("rejects an unknown computed key with computed_unknown_key naming it + listing the valid keys", () => {
    const result = validatePayloadSchema(schemaWith([computedNode("quality_score")]));
    expect(result.ok).toBe(false);
    const error = result.errors.find((e) => e.code === "computed_unknown_key");
    expect(error).toBeDefined();
    expect(error?.path).toBe("meta.ts");
    expect(error?.message).toContain("'quality_score'");
    expect(error?.message).toContain(LEADGEN_COMPUTED_KEYS.join(", "));
  });

  it("accepts every registry key", () => {
    for (const key of ALL_12_KEYS) {
      const result = validatePayloadSchema(schemaWith([computedNode(key)]));
      expect(result.errors, key).toEqual([]);
      expect(result.ok, key).toBe(true);
    }
  });

  it("a missing/empty computed key is still computed_missing_key (unchanged behavior)", () => {
    const missing = schemaWith([{ path: "a", name: "a", type: "string", source: "computed" }]);
    expect(validatePayloadSchema(missing).errors.map((e) => e.code)).toContain("computed_missing_key");
    const empty = schemaWith([computedNode("  ")]);
    expect(validatePayloadSchema(empty).errors.map((e) => e.code)).toContain("computed_missing_key");
  });

  it("buildPayload resolves a registry-backed computed node end-to-end", () => {
    const schema = schemaWith([
      { path: "meta.ts", name: "ts", type: "number", source: "computed", computed: "request_timestamp" },
      { path: "meta.day", name: "day", type: "string", source: "computed", computed: "current_day_of_week_est" },
    ]);
    expect(validatePayloadSchema(schema).ok).toBe(true);
    const payload = buildPayload(schema, {
      answers: {},
      computed: resolveAllComputed({ now: JULY_NOW, timezone: "" }),
    });
    expect(payload).toEqual({ meta: { ts: 1783519200, day: "wednesday" } });
  });
});
