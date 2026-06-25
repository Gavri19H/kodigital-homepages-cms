// rescue-6 (agent-readiness M4.2): deterministic unit coverage for the
// best-effort KV fixed-window rate limiter (the privacy write endpoints' abuse
// backstop). Uses an in-memory KV mock + an injected clock.
import { describe, it, expect } from "vitest";
import { checkRateLimit } from "../src/safety/rate-limit";

function mockKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      store.set(k, v);
    },
  };
}

type Kv = Parameters<typeof checkRateLimit>[0];

describe("checkRateLimit (agent-readiness M4.2)", () => {
  const now = 1_000_000_000_000;

  it("allows up to the limit, then blocks with a positive Retry-After", async () => {
    const kv = mockKv();
    const opts = { limit: 3, windowSeconds: 60, now };
    expect((await checkRateLimit(kv as unknown as Kv, "rl:t:a", opts)).allowed).toBe(true);
    expect((await checkRateLimit(kv as unknown as Kv, "rl:t:a", opts)).allowed).toBe(true);
    expect((await checkRateLimit(kv as unknown as Kv, "rl:t:a", opts)).allowed).toBe(true);
    const blocked = await checkRateLimit(kv as unknown as Kv, "rl:t:a", opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.remaining).toBe(0);
  });

  it("resets in the next time window", async () => {
    const kv = mockKv();
    const base = { limit: 1, windowSeconds: 60 };
    expect((await checkRateLimit(kv as unknown as Kv, "rl:t:b", { ...base, now })).allowed).toBe(true);
    expect((await checkRateLimit(kv as unknown as Kv, "rl:t:b", { ...base, now })).allowed).toBe(false);
    // next window (>60s later) is a fresh key -> allowed again
    expect(
      (await checkRateLimit(kv as unknown as Kv, "rl:t:b", { ...base, now: now + 61_000 })).allowed,
    ).toBe(true);
  });

  it("keys are independent per base key", async () => {
    const kv = mockKv();
    const opts = { limit: 1, windowSeconds: 60, now };
    expect((await checkRateLimit(kv as unknown as Kv, "rl:t:x", opts)).allowed).toBe(true);
    expect((await checkRateLimit(kv as unknown as Kv, "rl:t:y", opts)).allowed).toBe(true);
  });

  it("FAILS OPEN when the KV store throws (a cache hiccup never blocks)", async () => {
    const badKv = {
      get: async () => {
        throw new Error("kv down");
      },
      put: async () => {},
    };
    const res = await checkRateLimit(badKv as unknown as Kv, "rl:t:c", {
      limit: 1,
      windowSeconds: 60,
      now,
    });
    expect(res.allowed).toBe(true);
  });
});
