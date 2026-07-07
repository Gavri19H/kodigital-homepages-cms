// LeadGen Funnel A/B allocation + assignment engine — contract 06 §16.2.
//
// Proves the §16.2 engine (SHA-256 over the colon-joined triple → first-4-byte
// big-endian uint32 → % 10000; sort by variant_label; first cumulative bp
// STRICTLY GREATER than the bucket) — NOT the listicles FNV-1a. Covers frozen
// golden vectors (incl. revision re-bucketing), stickiness, the 100k-session
// ±1% distribution acceptance, the strict-greater boundary, the Σ==10000
// validation gate, and variant_label sort determinism.
//
// No RegExp.prototype.exec anywhere (repo rule) — no regex is needed here.

import { describe, expect, it } from "vitest";
import {
  abBucket,
  assignVariant,
  pickVariantByBucket,
  singleControlAssignment,
  validateAbAllocations,
  type AbVariantLike,
} from "../src/public/leadgen/ab-hash";

// ---------------------------------------------------------------------------
// Frozen golden vectors — CANONICAL FOREVER.
//
// These integers were recorded on first implementation (2026-07-07) from the
// real synchronous sha256Hex (api/src/public/leadgen/auction/parse.ts) via
// parseInt(sha256Hex(`${id}:${revision}:${session}`).slice(0,8), 16) % 10000.
// Any drift in the hash input format, the byte→uint32 read, or the modulus
// breaks them. The edge and any future client twin MUST reproduce them.
// ---------------------------------------------------------------------------

describe("§16.2 abBucket — frozen golden vectors", () => {
  it('abBucket("lgx_test1", 1, "sess-1") === 3493 — canonical forever', () => {
    expect(abBucket("lgx_test1", 1, "sess-1")).toBe(3493);
  });

  it('abBucket("lgx_test1", 1, "sess-2") === 454 — canonical forever', () => {
    expect(abBucket("lgx_test1", 1, "sess-2")).toBe(454);
  });

  it('abBucket("lgx_abcd", 1, "sess-1") === 212 — canonical forever', () => {
    expect(abBucket("lgx_abcd", 1, "sess-1")).toBe(212);
  });

  it("revision is part of the hash input: same (test, session), different revision → different bucket", () => {
    // SAME test + session, revision 1 vs 2 → a fresh, independent re-bucket
    // (§16.2: bumping the revision cleanly re-buckets without polluting the
    // prior comparison).
    expect(abBucket("lgx_test1", 1, "sess-1")).toBe(3493);
    expect(abBucket("lgx_test1", 2, "sess-1")).toBe(2277);
    expect(abBucket("lgx_test1", 1, "sess-1")).not.toBe(abBucket("lgx_test1", 2, "sess-1"));
  });

  it("bucket is always within 0..9999", () => {
    for (let i = 0; i < 2000; i++) {
      const bucket = abBucket("lgx_range", 1, `sess-${i}`);
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(10000);
    }
  });

  it("is deterministic (same inputs → same bucket on repeated calls)", () => {
    const first = abBucket("lgx_det", 7, "sess-det");
    for (let i = 0; i < 100; i++) {
      expect(abBucket("lgx_det", 7, "sess-det")).toBe(first);
    }
  });
});

// ---------------------------------------------------------------------------
// Assignment: stickiness + reason vocabulary
// ---------------------------------------------------------------------------

const AB_VARIANTS: AbVariantLike[] = [
  { variant_label: "A", traffic_allocation_bp: 6000 },
  { variant_label: "B", traffic_allocation_bp: 4000 },
];

describe("assignVariant — stickiness + ab_hash reason", () => {
  it("is sticky: same inputs → same variant across many calls", () => {
    const first = assignVariant("lgx_test1", 1, "sess-1", AB_VARIANTS);
    for (let i = 0; i < 500; i++) {
      const again = assignVariant("lgx_test1", 1, "sess-1", AB_VARIANTS);
      expect(again.variant.variant_label).toBe(first.variant.variant_label);
      expect(again.assignment_bucket).toBe(first.assignment_bucket);
      expect(again.assignment_reason).toBe("ab_hash");
    }
  });

  it("exposes the drawn bucket as assignment_bucket (a number 0..9999)", () => {
    const a = assignVariant("lgx_test1", 1, "sess-1", AB_VARIANTS);
    expect(a.assignment_bucket).toBe(3493); // the frozen vector
    // bucket 3493 < 6000 → the A arm (sorted first).
    expect(a.variant.variant_label).toBe("A");
    expect(a.assignment_reason).toBe("ab_hash");
  });
});

describe("singleControlAssignment — the P7 no-running-test seam", () => {
  it("returns the given variant with a null bucket and single_control reason", () => {
    const control = { variant_label: "A", traffic_allocation_bp: 10000, extra: "kept" };
    const a = singleControlAssignment(control);
    expect(a.variant).toBe(control); // same object flows through (generic)
    expect(a.assignment_bucket).toBeNull();
    expect(a.assignment_reason).toBe("single_control");
  });
});

// ---------------------------------------------------------------------------
// §16.2 strict-greater boundary
// ---------------------------------------------------------------------------

describe("pickVariantByBucket — first cumulative bp STRICTLY GREATER than bucket", () => {
  // A=6000, B=4000 → cumulative bounds 6000, 10000.
  const two: AbVariantLike[] = [
    { variant_label: "A", traffic_allocation_bp: 6000 },
    { variant_label: "B", traffic_allocation_bp: 4000 },
  ];

  it("bucket below the first bound → first arm", () => {
    expect(pickVariantByBucket(0, two).variant_label).toBe("A");
    expect(pickVariantByBucket(5999, two).variant_label).toBe("A");
  });

  it("bucket EXACTLY on the cumulative bound → the NEXT arm (strict >)", () => {
    // 6000 > 6000 is false, so A is skipped; B's cumulative 10000 > 6000 → B.
    expect(pickVariantByBucket(6000, two).variant_label).toBe("B");
  });

  it("bucket in the last band → last arm", () => {
    expect(pickVariantByBucket(9999, two).variant_label).toBe("B");
  });

  it("three-way bounds 5000/8000/10000 map strict-greater", () => {
    const three: AbVariantLike[] = [
      { variant_label: "A", traffic_allocation_bp: 5000 },
      { variant_label: "B", traffic_allocation_bp: 3000 },
      { variant_label: "C", traffic_allocation_bp: 2000 },
    ];
    expect(pickVariantByBucket(4999, three).variant_label).toBe("A");
    expect(pickVariantByBucket(5000, three).variant_label).toBe("B"); // edge → next
    expect(pickVariantByBucket(7999, three).variant_label).toBe("B");
    expect(pickVariantByBucket(8000, three).variant_label).toBe("C"); // edge → next
    expect(pickVariantByBucket(9999, three).variant_label).toBe("C");
  });

  it("degenerate Σ<10000 allocations fall through to the last arm (never a throw)", () => {
    const short: AbVariantLike[] = [
      { variant_label: "A", traffic_allocation_bp: 5000 },
      { variant_label: "B", traffic_allocation_bp: 4000 },
    ];
    expect(pickVariantByBucket(9999, short).variant_label).toBe("B");
  });

  it("throws only on an empty variant set (caller contract violation)", () => {
    expect(() => pickVariantByBucket(0, [])).toThrow();
  });
});

// ---------------------------------------------------------------------------
// variant_label sort determinism — input order must not matter
// ---------------------------------------------------------------------------

describe("assignment applies the variant_label sort (order-independent)", () => {
  it("shuffled input order produces the identical assignment", () => {
    const forward: AbVariantLike[] = [
      { variant_label: "A", traffic_allocation_bp: 3000 },
      { variant_label: "B", traffic_allocation_bp: 3000 },
      { variant_label: "C", traffic_allocation_bp: 4000 },
    ];
    const shuffled: AbVariantLike[] = [
      { variant_label: "C", traffic_allocation_bp: 4000 },
      { variant_label: "A", traffic_allocation_bp: 3000 },
      { variant_label: "B", traffic_allocation_bp: 3000 },
    ];
    for (let i = 0; i < 300; i++) {
      const a = assignVariant("lgx_sort", 1, `sess-${i}`, forward);
      const b = assignVariant("lgx_sort", 1, `sess-${i}`, shuffled);
      expect(a.variant.variant_label).toBe(b.variant.variant_label);
      expect(a.assignment_bucket).toBe(b.assignment_bucket);
    }
  });

  it("pickVariantByBucket is order-independent at a fixed bucket", () => {
    const forward: AbVariantLike[] = [
      { variant_label: "A", traffic_allocation_bp: 5000 },
      { variant_label: "B", traffic_allocation_bp: 5000 },
    ];
    const reversed: AbVariantLike[] = [
      { variant_label: "B", traffic_allocation_bp: 5000 },
      { variant_label: "A", traffic_allocation_bp: 5000 },
    ];
    for (const bucket of [0, 4999, 5000, 9999]) {
      expect(pickVariantByBucket(bucket, forward).variant_label).toBe(
        pickVariantByBucket(bucket, reversed).variant_label,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// §16.2 distribution acceptance — 100,000 sessions within ±1%
// ---------------------------------------------------------------------------

function drawDistribution(variants: AbVariantLike[]): Map<string, number> {
  const N = 100_000;
  const counts = new Map<string, number>();
  for (const v of variants) counts.set(v.variant_label, 0);
  for (let i = 0; i < N; i++) {
    const { variant } = assignVariant("lgx_dist", 1, `s${i}`, variants);
    counts.set(variant.variant_label, (counts.get(variant.variant_label) ?? 0) + 1);
  }
  return counts;
}

describe("§16.2 distribution acceptance (100,000 sessions, ±1%)", () => {
  const N = 100_000;

  it("60/40 two-way split lands within ±1 percentage point of target", () => {
    const variants: AbVariantLike[] = [
      { variant_label: "A", traffic_allocation_bp: 6000 },
      { variant_label: "B", traffic_allocation_bp: 4000 },
    ];
    const counts = drawDistribution(variants);
    for (const v of variants) {
      const observedPct = ((counts.get(v.variant_label) ?? 0) / N) * 100;
      const targetPct = v.traffic_allocation_bp / 100;
      expect(
        Math.abs(observedPct - targetPct),
        `arm ${v.variant_label}: observed ${observedPct}% vs target ${targetPct}%`,
      ).toBeLessThanOrEqual(1.0);
    }
  });

  it("50/30/20 three-way split lands within ±1 percentage point of target", () => {
    const variants: AbVariantLike[] = [
      { variant_label: "A", traffic_allocation_bp: 5000 },
      { variant_label: "B", traffic_allocation_bp: 3000 },
      { variant_label: "C", traffic_allocation_bp: 2000 },
    ];
    const counts = drawDistribution(variants);
    for (const v of variants) {
      const observedPct = ((counts.get(v.variant_label) ?? 0) / N) * 100;
      const targetPct = v.traffic_allocation_bp / 100;
      expect(
        Math.abs(observedPct - targetPct),
        `arm ${v.variant_label}: observed ${observedPct}% vs target ${targetPct}%`,
      ).toBeLessThanOrEqual(1.0);
    }
  });
});

// ---------------------------------------------------------------------------
// §16.2 validation gate — per-test Σ traffic_allocation_bp == 10000
// ---------------------------------------------------------------------------

describe("validateAbAllocations — the Σ==10000 gate", () => {
  it("accepts a two-arm split summing to exactly 10000", () => {
    const r = validateAbAllocations([
      { variant_label: "A", traffic_allocation_bp: 6000 },
      { variant_label: "B", traffic_allocation_bp: 4000 },
    ]);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("accepts a single 10000 arm and a three-arm split", () => {
    expect(validateAbAllocations([{ variant_label: "A", traffic_allocation_bp: 10000 }]).ok).toBe(true);
    expect(
      validateAbAllocations([
        { variant_label: "A", traffic_allocation_bp: 5000 },
        { variant_label: "B", traffic_allocation_bp: 3000 },
        { variant_label: "C", traffic_allocation_bp: 2000 },
      ]).ok,
    ).toBe(true);
  });

  it("rejects Σ == 9999 (one bp short)", () => {
    const r = validateAbAllocations([
      { variant_label: "A", traffic_allocation_bp: 5999 },
      { variant_label: "B", traffic_allocation_bp: 4000 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "allocation_sum_mismatch")).toBe(true);
  });

  it("rejects Σ == 10001 (one bp over)", () => {
    const r = validateAbAllocations([
      { variant_label: "A", traffic_allocation_bp: 6001 },
      { variant_label: "B", traffic_allocation_bp: 4000 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "allocation_sum_mismatch")).toBe(true);
  });

  it("rejects a negative allocation (out of range)", () => {
    const r = validateAbAllocations([
      { variant_label: "A", traffic_allocation_bp: -100 },
      { variant_label: "B", traffic_allocation_bp: 10100 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "allocation_out_of_range")).toBe(true);
  });

  it("rejects an allocation above 10000 (out of range)", () => {
    const r = validateAbAllocations([{ variant_label: "A", traffic_allocation_bp: 10001 }]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "allocation_out_of_range")).toBe(true);
  });

  it("rejects a non-integer allocation", () => {
    const r = validateAbAllocations([
      { variant_label: "A", traffic_allocation_bp: 6000.5 },
      { variant_label: "B", traffic_allocation_bp: 3999.5 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "allocation_not_integer")).toBe(true);
  });

  it("rejects an empty variant set", () => {
    const r = validateAbAllocations([]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === "no_variants")).toBe(true);
  });
});
