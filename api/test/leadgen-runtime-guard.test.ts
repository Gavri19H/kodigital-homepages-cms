// LeadGen §30.4 runtime request guard (contract 09 §30.4) — blocklist → rate
// limit → bot detection → fail-open, plus the §30.4 ZIP validator. Pure unit
// tests: a Map-backed KV for the sliding-window rate limiter, a throwing KV for
// the fail-open path, and cf.botManagement / declared-bot UA for bot detection.

import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { runtimeRequestGuard, isValidZip } from "../src/public/leadgen/runtime-guard";

// --- harness -------------------------------------------------------------------

function makeKv(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string): Promise<string | null> {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

// A KV whose get() throws — exercises the guard's fail-OPEN posture.
const throwingKv = {
  async get(): Promise<string | null> {
    throw new Error("kv down");
  },
  async put(): Promise<void> {
    throw new Error("kv down");
  },
} as unknown as KVNamespace;

function makeEnv(kv: KVNamespace, extra: Record<string, unknown> = {}): Env {
  return { CACHE: kv, APP_ENV: "test", ...extra } as unknown as Env;
}

function req(headers: Record<string, string> = {}, cf?: unknown): Request {
  const r = new Request("https://tenant.example.com/lg/pb/testprov", { method: "POST", headers });
  if (cf !== undefined) (r as unknown as { cf: unknown }).cf = cf;
  return r;
}

// --- ZIP validator (§30.4) -----------------------------------------------------

describe("isValidZip (§30.4 /^\\d{5}$/)", () => {
  it("accepts a 5-digit ZIP", () => {
    expect(isValidZip("90210")).toBe(true);
  });
  it("rejects 4 digits / 6 digits / alpha", () => {
    expect(isValidZip("9021")).toBe(false);
    expect(isValidZip("902100")).toBe(false);
    expect(isValidZip("abcde")).toBe(false);
    expect(isValidZip("")).toBe(false);
    expect(isValidZip("9021a")).toBe(false);
  });
});

// --- blocklist -----------------------------------------------------------------

describe("runtimeRequestGuard — blocklist (§30.4)", () => {
  it("blocks a CF-Connecting-IP present in LEADGEN_BLOCKLIST → 403", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv, { LEADGEN_BLOCKLIST: "1.2.3.4, 9.9.9.9" });
    const out = await runtimeRequestGuard(env, req({ "CF-Connecting-IP": "1.2.3.4" }));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(403);
      expect(out.reason).toBe("blocklist");
    }
  });

  it("blocks a User-Agent substring present in the blocklist → 403", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv, { LEADGEN_BLOCKLIST: "evilscraper" });
    const out = await runtimeRequestGuard(env, req({ "User-Agent": "Mozilla/5.0 EvilScraper/1.0" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(403);
  });

  it("absent LEADGEN_BLOCKLIST ⇒ allow", async () => {
    const { kv } = makeKv();
    const out = await runtimeRequestGuard(makeEnv(kv), req({ "CF-Connecting-IP": "1.2.3.4" }));
    expect(out.ok).toBe(true);
  });
});

// --- rate limit ----------------------------------------------------------------

describe("runtimeRequestGuard — rate limit (§30.4 sliding window)", () => {
  it("blocks after the threshold (mock KV, pinned window) → 429", async () => {
    const { kv } = makeKv();
    const env = makeEnv(kv);
    const now = 1_000_000_000; // pinned so the sliding window does not roll
    const r = req({ "CF-Connecting-IP": "5.5.5.5" });
    // limit = 3 → calls 1-3 pass, call 4 is over the limit.
    for (let i = 1; i <= 3; i++) {
      const out = await runtimeRequestGuard(env, r, { now, rateLimitPerMinute: 3 });
      expect(out.ok, `call ${i} should pass`).toBe(true);
    }
    const blocked = await runtimeRequestGuard(env, r, { now, rateLimitPerMinute: 3 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.status).toBe(429);
      expect(blocked.reason).toBe("rate_limit");
    }
  });
});

// --- bot detection -------------------------------------------------------------

describe("runtimeRequestGuard — bot detection (§30.4, P11 signals)", () => {
  it("blocks a verified bot via cf.botManagement → 403", async () => {
    const { kv } = makeKv();
    const out = await runtimeRequestGuard(
      makeEnv(kv),
      req({ "CF-Connecting-IP": "6.6.6.6" }, { botManagement: { verifiedBot: true } }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(403);
      expect(out.reason).toBe("bot");
    }
  });

  it("blocks a declared-bot User-Agent → 403", async () => {
    const { kv } = makeKv();
    const out = await runtimeRequestGuard(
      makeEnv(kv),
      req({ "CF-Connecting-IP": "6.6.6.7", "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" }),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("bot");
  });

  it("skipBotDetection ⇒ a bot-flagged request is NOT bot-blocked (server-to-server /lg/pb revenue-loss regression, finding 1)", async () => {
    const botHeaders = { "CF-Connecting-IP": "6.6.6.7", "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" };
    // Without the flag the browser-IVT arm blocks it (proves the arm WOULD fire):
    const { kv } = makeKv();
    const blocked = await runtimeRequestGuard(makeEnv(kv), req(botHeaders));
    expect(blocked.ok).toBe(false);
    // With skipBotDetection (exactly what serveLeadgenPostback passes for /lg/pb)
    // the SAME request passes — a legitimate provider postback (datacenter IP +
    // non-browser UA) is never 403'd before its per-provider token gate runs.
    const { kv: kv2 } = makeKv();
    const allowed = await runtimeRequestGuard(makeEnv(kv2), req(botHeaders), { skipBotDetection: true });
    expect(allowed.ok).toBe(true);
  });

  it("skipBotDetection still enforces the blocklist (only the bot arm is skipped)", async () => {
    const { kv } = makeKv();
    const out = await runtimeRequestGuard(
      makeEnv(kv, { LEADGEN_BLOCKLIST: "6.6.6.7" }),
      req({ "CF-Connecting-IP": "6.6.6.7", "User-Agent": "Go-http-client/2.0" }),
      { skipBotDetection: true },
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("blocklist");
  });
});

// --- fail-open + clean ---------------------------------------------------------

describe("runtimeRequestGuard — fail-open + clean pass-through", () => {
  it("a KV that throws ⇒ ok:true (fail-OPEN, never drops real traffic)", async () => {
    const env = makeEnv(throwingKv);
    const out = await runtimeRequestGuard(env, req({ "CF-Connecting-IP": "7.7.7.7", "User-Agent": "Mozilla/5.0" }));
    expect(out.ok).toBe(true);
  });

  it("a clean human request under the limit ⇒ ok:true", async () => {
    const { kv } = makeKv();
    const out = await runtimeRequestGuard(
      makeEnv(kv),
      req({
        "CF-Connecting-IP": "8.8.8.8",
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605",
      }),
    );
    expect(out.ok).toBe(true);
  });
});
