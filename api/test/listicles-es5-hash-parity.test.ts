// §31.2 — the ES5 client hash twin is BYTE-PARITY with the edge
// implementation: the frozen canonical vectors (6174/3907/1875) hold on the
// ES5 source EXECUTED in node:vm, and a fuzz loop (ASCII + unicode +
// surrogate-pair + lone-surrogate inputs) proves lstBucket(es5) ===
// lstBucket(ts) — same UTF-8 bytes, same FNV-1a, same modulus.

import { describe, expect, it } from "vitest";
import vm from "node:vm";
import { lstBucket, pickArmIndex } from "../src/public/listicle/ab-hash";
import { LST_ES5_HELPERS } from "../src/public/listicle/runtime";

interface HelpersSandbox {
  lstBucket(sid: string, testId: string): number;
  lstPickArm(bucket: number, arms: Array<{ allocation: number }>): number;
  lstUtf8(s: string): number[];
}

function loadHelpers(): HelpersSandbox {
  const sandbox: Record<string, unknown> = { window: {}, document: { cookie: "" } };
  vm.createContext(sandbox);
  vm.runInContext(LST_ES5_HELPERS, sandbox);
  return sandbox as unknown as HelpersSandbox;
}

describe("§31.2 frozen vectors on the ES5 twin (vm-executed)", () => {
  const es5 = loadHelpers();

  it('lstBucket("s1","exp_A") === 6174 — canonical forever', () => {
    expect(es5.lstBucket("s1", "exp_A")).toBe(6174);
  });

  it('lstBucket("s1","pg_2") === 3907 — canonical forever', () => {
    expect(es5.lstBucket("s1", "pg_2")).toBe(3907);
  });

  it('lstBucket("abc","t") === 1875 — canonical forever', () => {
    expect(es5.lstBucket("abc", "t")).toBe(1875);
  });
});

describe("ES5 twin ≡ edge implementation (fuzz parity)", () => {
  const es5 = loadHelpers();

  it("UTF-8 encoder matches TextEncoder byte-for-byte (incl. surrogates)", () => {
    const cases = [
      "plain-ascii",
      "sid|exp",
      "üñïçødé",
      "日本語テスト",
      "emoji 👍🏽 pair 💯",
      "é́", // é + combining acute
      "😀", // valid surrogate pair
      "\ud800", // lone high surrogate → U+FFFD
      "\udc00", // lone low surrogate → U+FFFD
      "a\ud800b", // lone high mid-string
      "",
    ];
    for (const s of cases) {
      expect(es5.lstUtf8(s), JSON.stringify(s)).toEqual([...new TextEncoder().encode(s)]);
    }
  });

  it("1,000 fuzzed (sid, testId) pairs: es5 === ts", () => {
    const pool =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_|.~üñß日本語👍💯😀";
    const chars = [...pool]; // code-point split (keeps pairs together)
    function randomString(maxLen: number): string {
      const len = Math.floor(Math.random() * maxLen);
      let out = "";
      for (let i = 0; i < len; i++) {
        out += chars[Math.floor(Math.random() * chars.length)];
      }
      return out;
    }
    for (let i = 0; i < 1000; i++) {
      const sid = randomString(40);
      const testId = randomString(24);
      expect(es5.lstBucket(sid, testId), `sid=${JSON.stringify(sid)} t=${JSON.stringify(testId)}`).toBe(
        lstBucket(sid, testId),
      );
    }
  });

  it("lstPickArm ≡ pickArmIndex over random allocations/buckets", () => {
    for (let i = 0; i < 200; i++) {
      // 2-4 arms summing to 100.
      const armCount = 2 + Math.floor(Math.random() * 3);
      const cuts = Array.from({ length: armCount - 1 }, () => 1 + Math.floor(Math.random() * 98)).sort(
        (a, b) => a - b,
      );
      const allocations: number[] = [];
      let prev = 0;
      for (const cut of [...cuts, 100]) {
        allocations.push(Math.max(0, cut - prev));
        prev = cut;
      }
      const arms = allocations.map((allocation) => ({ allocation }));
      const bucket = Math.floor(Math.random() * 10000);
      expect(es5.lstPickArm(bucket, arms)).toBe(pickArmIndex(bucket, arms));
    }
  });
});
