import { describe, it, expect } from "vitest";
import { cacheGet, cacheSet, cacheDel, invalidateFeeds } from "../src/cache";
import type { Env } from "../src/env";

// In-memory KV mock that supports get/put/delete and list({ prefix, cursor }).
// list() returns at most 2 keys per page so the invalidateFeeds() pagination
// loop is exercised end-to-end (cursor handoff between calls).
function makeKvMock(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const PAGE_SIZE = 2;

  const kv = {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(opts?: { prefix?: string; cursor?: string }) {
      const prefix = opts?.prefix ?? "";
      const cursorKey = opts?.cursor ?? "";
      // Cursor is the last-seen key name (not a numeric index); this matches
      // KV's documented semantics and survives deletes between list() calls.
      const all = [...store.keys()]
        .filter((k) => k.startsWith(prefix) && k > cursorKey)
        .sort();
      const slice = all.slice(0, PAGE_SIZE);
      const list_complete = slice.length >= all.length;
      const keys = slice.map((name) => ({ name }));
      const lastKey = slice[slice.length - 1];
      return list_complete
        ? { keys, list_complete: true, cacheStatus: null }
        : { keys, list_complete: false, cursor: lastKey ?? "", cacheStatus: null };
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace;

  return { kv, store };
}

function buildEnv(overrides: Partial<Env> = {}): { env: Env; store: Map<string, string> } {
  const { kv, store } = makeKvMock();
  const env: Env = {
    DB: {} as D1Database,
    CACHE: kv,
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
    ...overrides,
  };
  return { env, store };
}

describe("cache module: feed-key invalidation + KV roundtrip", () => {
  it("cacheGet returns null for a missing key", async () => {
    const { env } = buildEnv();
    expect(await cacheGet(env, "nope")).toBeNull();
  });

  it("cacheSet then cacheGet returns the stored body", async () => {
    const { env } = buildEnv();
    await cacheSet(env, "feed:rss", "<rss>body</rss>");
    expect(await cacheGet(env, "feed:rss")).toBe("<rss>body</rss>");
  });

  it("cacheDel removes the key", async () => {
    const { env } = buildEnv();
    await cacheSet(env, "k1", "v1");
    await cacheDel(env, "k1");
    expect(await cacheGet(env, "k1")).toBeNull();
  });

  it("cacheSet honours expirationTtl when provided", async () => {
    const { env } = buildEnv();
    let observedTtl: number | undefined;
    const original = env.CACHE.put.bind(env.CACHE);
    env.CACHE.put = async (
      key: string,
      value: string,
      opts?: KVNamespacePutOptions,
    ) => {
      observedTtl = opts?.expirationTtl;
      await original(key, value, opts);
    };
    await cacheSet(env, "k", "v", { expirationTtl: 60 });
    expect(observedTtl).toBe(60);
  });

  it("invalidateFeeds deletes every feed: prefixed key (BEHAVIORAL: AC T4.AC3)", async () => {
    // BEHAVIORAL: cacheSet("feed:rss", body), then invalidateFeeds(),
    // then cacheGet("feed:rss") MUST return null. Also confirm:
    //   - non-feed keys are NOT touched
    //   - pagination is exercised (mock pages at 2 keys per list call)
    const { env } = buildEnv();
    await cacheSet(env, "feed:rss", "<rss/>");
    await cacheSet(env, "feed:atom", "<atom/>");
    await cacheSet(env, "feed:sitemap", "<urlset/>");
    await cacheSet(env, "page:home", "<html/>");

    await invalidateFeeds(env);

    expect(await cacheGet(env, "feed:rss")).toBeNull();
    expect(await cacheGet(env, "feed:atom")).toBeNull();
    expect(await cacheGet(env, "feed:sitemap")).toBeNull();
    // Non-feed key untouched.
    expect(await cacheGet(env, "page:home")).toBe("<html/>");
  });

  it("cacheDel does NOT reach caches.default when CACHE_API_ENABLED is false", async () => {
    const { env } = buildEnv({ CACHE_API_ENABLED: "false" });
    // If the gate were broken, accessing caches.default in a Node test runtime
    // would throw a ReferenceError; cacheDel should swallow that path entirely.
    await expect(cacheDel(env, "k")).resolves.toBeUndefined();
  });
});
