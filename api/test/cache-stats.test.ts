import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheGet, cacheSet } from "../src/cache";
import { getCachedHtml, putCachedHtml } from "../src/cache/edge-cache";
import { readCacheStats, recordEdgeCacheStatus } from "../src/cache/cache-stats";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { makeFakeDb } from "./helpers/admin-test-kit";

// T44 [BCL-020] — Cache hit/miss monitoring + /api/admin/cache/stats.
//
// Backs RC-072 (T44-AC1). Every backing it() title embeds BOTH the literal
// [api/test/cache-stats.test.ts] and the L2_AUTO_DISAMBIGUATION:T44-AC1:RC-072
// observation pattern so the parse_test_output runner attributes the PASS.
//
// We drive REAL cache reads through the shipped helpers (cacheGet for feeds,
// getCachedHtml for HTML) so hits/misses are recorded by production code, then
// read them back through the shipped admin router (admin.request) — proving
// the monitor reflects activity and that reset clears it. A fetch spy asserts
// the dry-run zero-outbound contract (no api.cloudflare.com call).

// In-memory KV mock: get/put/delete with stateful storage so the counter
// read-increment-write cycle is exercised end-to-end. getWithMetadata + list
// are provided for the edge-cache / invalidate paths.
function makeKvMock(): KVNamespace {
  const store = new Map<string, string>();
  const metadataByKey = new Map<string, unknown>();
  const kv = {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string, opts?: KVNamespacePutOptions) {
      store.set(key, value);
      metadataByKey.set(key, opts?.metadata ?? null);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async getWithMetadata(key: string) {
      return {
        value: store.has(key) ? store.get(key)! : null,
        metadata: metadataByKey.get(key) ?? null,
        cacheStatus: null,
      };
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
  return kv;
}

function buildEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    CACHE: makeKvMock(),
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    ...overrides,
  } as Env;
}

interface StatsBody {
  resource: { hits: number; misses: number; total: number; hit_rate: number };
  reset?: boolean;
}

async function getStats(env: Env): Promise<StatsBody> {
  const res = await admin.request(
    "/api/admin/cache/stats",
    { method: "GET" },
    env,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as StatsBody;
}

describe("T44-AC1 cache hit/miss monitoring + /api/admin/cache/stats", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let pending: Promise<unknown>[];
  const ctx = {
    waitUntil(promise: Promise<unknown>) {
      pending.push(promise);
    },
  };

  beforeEach(() => {
    pending = [];
    vi.spyOn(Math, "random").mockReturnValue(0.099);
    // Fetch-mock harness: any outbound fetch is recorded so the dry-run
    // zero-outbound assertion can inspect the targets. Returns a benign 200.
    fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("[api/test/cache-stats.test.ts] L2_AUTO_DISAMBIGUATION:T44-AC1:RC-072 after hits + misses the admin stats view reports the matching hit-rate, and reset clears it", async () => {
    const env = buildEnv();

    // Generate 2 hits + 1 miss through the shipped feed-cache helper.
    await cacheSet(env, "feed:rss", "<rss/>");
    expect(await cacheGet(env, "feed:rss", ctx)).toBe("<rss/>");
    await Promise.all(pending);
    expect(await cacheGet(env, "feed:rss", ctx)).toBe("<rss/>");
    expect(await cacheGet(env, "feed:absent", ctx)).toBeNull();
    expect(pending).toHaveLength(3);
    await Promise.all(pending);

    // Each sample represents ten reads. The hit rate is still 2/3.
    const after = await getStats(env);
    expect(after.resource.hits).toBe(20);
    expect(after.resource.misses).toBe(10);
    expect(after.resource.total).toBe(30);
    expect(after.resource.hit_rate).toBeCloseTo(0.6667, 4);

    // Reset zeroes every counter.
    const resetRes = await admin.request(
      "/api/admin/cache/stats/reset",
      { method: "POST" },
      env,
    );
    expect(resetRes.status).toBe(200);
    const resetBody = (await resetRes.json()) as StatsBody;
    expect(resetBody.reset).toBe(true);
    expect(resetBody.resource.hits).toBe(0);
    expect(resetBody.resource.misses).toBe(0);
    expect(resetBody.resource.total).toBe(0);
    expect(resetBody.resource.hit_rate).toBe(0);

    // A fresh read confirms the cleared state is durable, not just echoed.
    const cleared = await getStats(env);
    expect(cleared.resource.hits).toBe(0);
    expect(cleared.resource.misses).toBe(0);
    expect(cleared.resource.hit_rate).toBe(0);
  });

  it("[api/test/cache-stats.test.ts] L2_AUTO_DISAMBIGUATION:T44-AC1:RC-072 the public-HTML read path (getCachedHtml) also feeds the monitor — a cold miss then a warm hit", async () => {
    const env = buildEnv();
    const key = "html:site-1:/";

    // Cold read -> miss.
    expect(await getCachedHtml(env, key, ctx)).toBeNull();
    // Warm the entry, then read -> hit.
    await putCachedHtml(env, key, "<html>v1</html>", { etag: '"abc"' });
    const warm = await getCachedHtml(env, key, ctx);
    expect(warm?.body).toBe("<html>v1</html>");
    await Promise.all(pending);

    const stats = await readCacheStats(env);
    expect(stats.hits).toBe(10);
    expect(stats.misses).toBe(10);
    expect(stats.total).toBe(20);
    expect(stats.hit_rate).toBe(0.5);
  });

  it("[api/test/cache-stats.test.ts] L2_AUTO_DISAMBIGUATION:T44-AC1:RC-072 recording hits/misses + serving the stats view emits ZERO outbound fetches to api.cloudflare.com (dry-run)", async () => {
    const env = buildEnv();

    await cacheSet(env, "feed:rss", "<rss/>");
    await cacheGet(env, "feed:rss", ctx);
    await cacheGet(env, "feed:absent", ctx);
    await Promise.all(pending);
    await getStats(env);
    await admin.request(
      "/api/admin/cache/stats/reset",
      { method: "POST" },
      env,
    );

    const cloudflareCalls = fetchSpy.mock.calls.filter((args) => {
      const target = String(args[0] ?? "");
      return target.includes("api.cloudflare.com");
    });
    expect(cloudflareCalls.length).toBe(0);
  });

  it("returns HTML hits and feed misses while sampled counter writes are still pending", async () => {
    const env = buildEnv();
    await putCachedHtml(env, "html:site-1:/", "<html/>");
    const put = vi.spyOn(env.CACHE, "put").mockReturnValue(new Promise<void>(() => {}));

    await expect(getCachedHtml(env, "html:site-1:/", ctx)).resolves.toMatchObject({ body: "<html/>" });
    await expect(cacheGet(env, "feed:absent", ctx)).resolves.toBeNull();

    expect(pending).toHaveLength(2);
    await vi.waitFor(() => expect(put.mock.calls).toEqual([
      ["cachestat:hits", "10"],
      ["cachestat:misses", "10"],
    ]));
  });

  it("holds waitUntil for the site upsert and keeps the global sample when D1 fails", async () => {
    const { db } = makeFakeDb();
    const env = buildEnv({ DB: db });
    const statement = db.prepare("");
    vi.spyOn(db, "prepare").mockReturnValue(statement);
    let rejectWrite!: (reason: Error) => void;
    vi.spyOn(statement, "run").mockReturnValue(new Promise<never>((_, reject) => { rejectWrite = reject; }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    recordEdgeCacheStatus(env, "HIT", ctx, "site-1");
    expect(pending).toHaveLength(1);
    const finished = vi.fn();
    const work = Promise.all(pending).then(finished);
    try {
      await vi.waitFor(async () => expect((await readCacheStats(env)).hits).toBe(10));
      expect(finished).not.toHaveBeenCalled();
    } finally {
      rejectWrite(new Error("D1 unavailable"));
      await work;
    }
    expect(finished).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledExactlyOnceWith("[cache-stats] Site edge count write failed", "site-1", "HIT");
    expect(await readCacheStats(env)).toEqual({ hits: 10, misses: 0, total: 10, hit_rate: 1 });
  });

  it("skips counter reads and writes for unsampled requests and callers without waitUntil", async () => {
    const env = buildEnv();
    const get = vi.spyOn(env.CACHE, "get");
    const put = vi.spyOn(env.CACHE, "put");

    vi.mocked(Math.random).mockReturnValue(0.1);
    await getCachedHtml(env, "html:site-1:/", ctx);
    await cacheGet(env, "feed:rss", ctx);

    vi.mocked(Math.random).mockReturnValue(0);
    await getCachedHtml(env, "html:site-1:/");
    await cacheGet(env, "feed:rss");

    expect(pending).toHaveLength(0);
    expect(get.mock.calls).toEqual([["feed:rss"], ["feed:rss"]]);
    expect(put).not.toHaveBeenCalled();
  });
});
