import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheGet, cacheSet } from "../src/cache";
import { getCachedHtml, putCachedHtml } from "../src/cache/edge-cache";
import { readCacheStats } from "../src/cache/cache-stats";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

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

  beforeEach(() => {
    // Fetch-mock harness: any outbound fetch is recorded so the dry-run
    // zero-outbound assertion can inspect the targets. Returns a benign 200.
    fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("[api/test/cache-stats.test.ts] L2_AUTO_DISAMBIGUATION:T44-AC1:RC-072 after hits + misses the admin stats view reports the matching hit-rate, and reset clears it", async () => {
    const env = buildEnv();

    // Generate 2 hits + 1 miss through the shipped feed-cache helper.
    await cacheSet(env, "feed:rss", "<rss/>");
    expect(await cacheGet(env, "feed:rss")).toBe("<rss/>"); // hit 1
    expect(await cacheGet(env, "feed:rss")).toBe("<rss/>"); // hit 2
    expect(await cacheGet(env, "feed:absent")).toBeNull(); // miss 1

    // Admin stats view reflects the activity: 2/3 == 0.6667.
    const after = await getStats(env);
    expect(after.resource.hits).toBe(2);
    expect(after.resource.misses).toBe(1);
    expect(after.resource.total).toBe(3);
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
    expect(await getCachedHtml(env, key)).toBeNull();
    // Warm the entry, then read -> hit.
    await putCachedHtml(env, key, "<html>v1</html>", { etag: '"abc"' });
    const warm = await getCachedHtml(env, key);
    expect(warm?.body).toBe("<html>v1</html>");

    const stats = await readCacheStats(env);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.total).toBe(2);
    expect(stats.hit_rate).toBe(0.5);
  });

  it("[api/test/cache-stats.test.ts] L2_AUTO_DISAMBIGUATION:T44-AC1:RC-072 recording hits/misses + serving the stats view emits ZERO outbound fetches to api.cloudflare.com (dry-run)", async () => {
    const env = buildEnv();

    await cacheSet(env, "feed:rss", "<rss/>");
    await cacheGet(env, "feed:rss");
    await cacheGet(env, "feed:absent");
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
});
