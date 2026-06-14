import { describe, it, expect } from "vitest";
import { cacheGet, cacheSet, cacheDel, invalidateFeeds } from "../src/cache";
import { computeEtag } from "../src/cache/edge-cache";
import { htmlKey } from "../src/cache/cache-keys";
import { publicHtmlCacheHeaders } from "../src/cache/cache-control";
import { servePublicHtml } from "../src/public/html-pipeline";
import type { PublicSiteContext } from "../src/public/middleware";
import type { Env } from "../src/env";

// In-memory KV mock that supports get/put/delete, getWithMetadata, and
// list({ prefix, cursor }). list() returns at most 2 keys per page so the
// invalidateFeeds() pagination loop is exercised end-to-end (cursor handoff
// between calls). put() retains opts.metadata so the edge-cache warm path
// (getWithMetadata -> stored ETag) is observable.
function makeKvMock(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const metadataByKey = new Map<string, unknown>();
  const PAGE_SIZE = 2;

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
    async getWithMetadata(key: string) {
      return {
        value: store.has(key) ? store.get(key)! : null,
        metadata: metadataByKey.get(key) ?? null,
        cacheStatus: null,
      };
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

describe("cache re-verify: ETag + 304 + KV warm path (T43 / F4)", () => {
  const siteContext: PublicSiteContext = {
    site_id: "site-1",
    siteId: "site-1",
    hostname: "example.com",
    vertical_slug: "finance",
    status: "active",
    content_version: 3,
    settings_version: 1,
  };

  function serve(
    env: Env,
    opts: { ifNoneMatch?: string | null; render?: () => string },
  ) {
    // Same wiring as the public router (router.ts): key built via
    // htmlKey(siteContext.siteId, ...), headers via publicHtmlCacheHeaders.
    return servePublicHtml(env, siteContext, {
      key: htmlKey(siteContext.siteId, "/", siteContext.content_version),
      path: "/",
      ifNoneMatch: opts.ifNoneMatch ?? null,
      render: opts.render ?? (() => "<html>v3</html>"),
      headersFactory: (etag) => publicHtmlCacheHeaders({ etag }),
    });
  }

  it("cd api && npx vitest run test/cache.test.ts — cold render warms KV, warm hit skips render, If-None-Match answers 304 (T43.AC1)", async () => {
    const { env, store } = buildEnv();
    const expectedEtag = await computeEtag({
      site_id: siteContext.siteId,
      path: "/",
      content_version: siteContext.content_version,
    });

    // 1. Cold cache: render runs once, 200 + strong ETag, KV is warmed.
    let renders = 0;
    const cold = await serve(env, {
      render: () => {
        renders += 1;
        return "<html>v3</html>";
      },
    });
    expect(cold.status).toBe(200);
    expect(await cold.text()).toBe("<html>v3</html>");
    expect(cold.headers.get("ETag")).toBe(expectedEtag);
    expect(renders).toBe(1);
    expect(
      store.get(htmlKey(siteContext.siteId, "/", siteContext.content_version)),
    ).toBe("<html>v3</html>");

    // 2. KV warm path: body served from cache, render thunk NOT invoked,
    //    stored ETag echoed.
    const warm = await serve(env, {
      render: () => {
        throw new Error("render must not run on a warm cache");
      },
    });
    expect(warm.status).toBe(200);
    expect(await warm.text()).toBe("<html>v3</html>");
    expect(warm.headers.get("ETag")).toBe(expectedEtag);

    // 3. Conditional GET: If-None-Match with the current ETag -> 304 with
    //    empty body and the ETag echoed back (RFC 7232 §3.2).
    const conditional = await serve(env, {
      ifNoneMatch: expectedEtag,
      render: () => {
        throw new Error("render must not run on a 304");
      },
    });
    expect(conditional.status).toBe(304);
    expect(await conditional.text()).toBe("");
    expect(conditional.headers.get("ETag")).toBe(expectedEtag);
  });

  it("stale If-None-Match falls through to the warm body, not 304", async () => {
    const { env } = buildEnv();
    await serve(env, {});
    const res = await serve(env, { ifNoneMatch: '"deadbeefdeadbeef"' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>v3</html>");
  });
});
