// §31.2 canonical A/B hash — frozen vectors + distribution acceptance.
//
// FNV-1a 32-bit over UTF-8 `${sid}|${test_id}` → bps 0..9999. ONE
// implementation shared by the edge Version picker (Phase 6) and the client
// page selector (its ES5 twin is Phase 7).

import { describe, it, expect } from "vitest";
import { lstBucket, pickArmIndex } from "../src/public/listicle/ab-hash";

describe("§31.2 frozen test vectors", () => {
  // These integers were recorded on first implementation (2026-07-03) and
  // are CANONICAL FOREVER (§31.2: "record the exact integers on first
  // implementation and assert them forever — regression guard against
  // algorithm drift"). The Phase-7 ES5 client twin MUST reproduce them.
  it('lstBucket("s1","exp_A") === 6174 — canonical forever', () => {
    expect(lstBucket("s1", "exp_A")).toBe(6174);
  });

  it('lstBucket("s1","pg_2") === 3907 — canonical forever', () => {
    expect(lstBucket("s1", "pg_2")).toBe(3907);
  });

  it('lstBucket("abc","t") === 1875 — canonical forever', () => {
    expect(lstBucket("abc", "t")).toBe(1875);
  });

  it("hashes UTF-8 BYTES (multibyte input is well-defined and stable)", () => {
    const bucket = lstBucket("séssion-😀", "exp_ü");
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(10000);
    expect(lstBucket("séssion-😀", "exp_ü")).toBe(bucket); // deterministic
  });

  it("bucket is always within 0..9999 bps", () => {
    for (let i = 0; i < 1000; i++) {
      const bucket = lstBucket(`sid-${i}`, "exp_X");
      expect(bucket).toBeGreaterThanOrEqual(0);
      expect(bucket).toBeLessThan(10000);
    }
  });
});

describe("assignment: first arm whose cumulative allocation (bps) > bucket", () => {
  it("maps bucket boundaries per the §31.2 cumulative rule", () => {
    const arms = [{ allocation: 50 }, { allocation: 30 }, { allocation: 20 }];
    // cumulative bps: 5000, 8000, 10000
    expect(pickArmIndex(0, arms)).toBe(0);
    expect(pickArmIndex(4999, arms)).toBe(0);
    expect(pickArmIndex(5000, arms)).toBe(1); // 5000 > 5000 false → next arm
    expect(pickArmIndex(7999, arms)).toBe(1);
    expect(pickArmIndex(8000, arms)).toBe(2);
    expect(pickArmIndex(9999, arms)).toBe(2);
  });

  it("degenerate allocations fall through to the last arm (never a throw)", () => {
    expect(pickArmIndex(9999, [{ allocation: 50 }, { allocation: 40 }])).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// §31.2 distribution acceptance: 1,000,000 random sids → each arm within
// ±50 bps (±0.5%) of target; chi-square goodness-of-fit p > 0.01.
// ---------------------------------------------------------------------------

// Regularized upper incomplete gamma Q(a, x) via series / continued fraction
// (Numerical Recipes §6.2) — an HONEST chi-square p-value, not a threshold
// table lookup. p = Q(df/2, chi2/2).
function gammln(xx: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let x = xx;
  let y = xx;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) {
    y += 1;
    ser += (cof[j] ?? 0) / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function gammaQ(a: number, x: number): number {
  if (x < 0 || a <= 0) throw new Error("gammaQ: bad args");
  if (x < a + 1) {
    // series representation of P(a,x); Q = 1 - P
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 1; n <= 200; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
    }
    const p = sum * Math.exp(-x + a * Math.log(x) - gammln(a));
    return 1 - p;
  }
  // continued fraction for Q(a,x)
  let b = x + 1 - a;
  let c = 1 / 1e-30;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 200; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = b + an / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammln(a)) * h;
}

export function chiSquarePValue(observed: number[], expected: number[]): number {
  let chi2 = 0;
  for (let i = 0; i < observed.length; i++) {
    const e = expected[i] ?? 0;
    const o = observed[i] ?? 0;
    chi2 += ((o - e) * (o - e)) / e;
  }
  const df = observed.length - 1;
  return gammaQ(df / 2, chi2 / 2);
}

describe("§31.2 distribution acceptance (1,000,000 sids)", () => {
  it("50/30/20 arms: each within ±50 bps of target AND chi-square p > 0.01", () => {
    const arms = [{ allocation: 50 }, { allocation: 30 }, { allocation: 20 }];
    const N = 1_000_000;
    const counts = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const bucket = lstBucket(`sid-${i}-r`, "exp_dist");
      const arm = pickArmIndex(bucket, arms);
      counts[arm] = (counts[arm] ?? 0) + 1;
    }
    const targets = arms.map((arm) => (arm.allocation / 100) * N);
    for (let i = 0; i < arms.length; i++) {
      const observedBps = ((counts[i] ?? 0) / N) * 10000;
      const targetBps = (arms[i]?.allocation ?? 0) * 100;
      expect(
        Math.abs(observedBps - targetBps),
        `arm ${i}: observed ${observedBps}bps vs target ${targetBps}bps`,
      ).toBeLessThanOrEqual(50);
    }
    const p = chiSquarePValue(counts, targets);
    expect(p, `chi-square p=${p}`).toBeGreaterThan(0.01);
  });

  it("sanity: the chi-square helper rejects a blatantly skewed distribution", () => {
    // 60/40 observed against a 50/50 expectation over 100k draws must yield
    // p ≈ 0 — proves the p-value computation has teeth (not a stub).
    const p = chiSquarePValue([60000, 40000], [50000, 50000]);
    expect(p).toBeLessThan(1e-6);
  });
});
