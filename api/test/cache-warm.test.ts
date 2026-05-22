import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWarmTargets, warmSiteCache } from "../src/cache/warm";
import {
  feedAtomKey,
  feedRssKey,
  htmlKey,
  sitemapKey,
  TEMPLATE_VERSION,
} from "../src/cache/cache-keys";
import { computeEtag, getCachedHtml } from "../src/cache/edge-cache";
import type { Env } from "../src/env";

type Slot = { body: string; metadata: unknown; ttl?: number };

function buildEnv(overrides: Partial<Env> = {}): { env: Env; store: Map<string, Slot> } {
  const store = new Map<string, Slot>();
  const kv = {
    async get(k: string) { return store.get(k)?.body ?? null; },
    async put(k: string, v: string, opts?: KVNamespacePutOptions) {
      store.set(k, { body: v, metadata: opts?.metadata, ttl: opts?.expirationTtl });
    },
    async delete(k: string) { store.delete(k); },
    async list() { return { keys: [], list_complete: true, cacheStatus: null }; },
    async getWithMetadata(k: string) {
      const e = store.get(k);
      return e
        ? { value: e.body, metadata: e.metadata, cacheStatus: null }
        : { value: null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace;
  const env: Env = {
    DB: {} as D1Database, CACHE: kv, MEDIA: {} as R2Bucket,
    APP_ENV: "test", ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787", ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "", OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true", SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    ...overrides,
  };
  return { env, store };
}

function okResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

describe("warm.buildWarmTargets — wire shape pinning", () => {
  it("returns four targets in canonical order with canonical cache-key shapes", () => {
    const t = buildWarmTargets({ site_id: "st_abc", content_version: 7, originBaseUrl: "https://site.example.com" });
    expect(t.map((x) => x.kind)).toEqual(["homepage", "sitemap", "feed:rss", "feed:atom"]);
    expect(t[0]?.cacheKey).toBe(`html:st_abc:/:7:${TEMPLATE_VERSION}`);
    expect(t[0]?.cacheKey).toBe(htmlKey("st_abc", "/", 7));
    expect(t[1]?.cacheKey).toBe(sitemapKey("st_abc", 7));
    expect(t[2]?.cacheKey).toBe(feedRssKey("st_abc", 7));
    expect(t[3]?.cacheKey).toBe(feedAtomKey("st_abc", 7));
  });

  it("joins origin base with public router paths and strips trailing slash", () => {
    const a = buildWarmTargets({ site_id: "st_abc", content_version: 1, originBaseUrl: "https://site.example.com" });
    expect(a.map((x) => x.url)).toEqual([
      "https://site.example.com/",
      "https://site.example.com/sitemap.xml",
      "https://site.example.com/feed.xml",
      "https://site.example.com/atom.xml",
    ]);
    const b = buildWarmTargets({ site_id: "st_abc", content_version: 1, originBaseUrl: "https://site.example.com/" });
    expect(b[0]?.url).toBe("https://site.example.com/");
    expect(b[1]?.url).toBe("https://site.example.com/sitemap.xml");
  });
});

describe("warm.warmSiteCache — dry-run discipline (T5 negative_fail_condition)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("default env (SITE_PROVISIONING_DRY_RUN=true): every target dry_run + ZERO fetches + ZERO KV writes", async () => {
    const { env, store } = buildEnv({ SITE_PROVISIONING_DRY_RUN: "true" });
    const outcome = await warmSiteCache(env, {
      site_id: "st_abc", content_version: 7, originBaseUrl: "https://site.example.com",
    });
    expect(outcome.dry_run).toBe(true);
    expect(outcome.attempted).toBe(4);
    expect(outcome.warmed).toBe(0);
    expect(outcome.results.every((r) => r.status === "dry_run")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("caller dryRun=true OVERRIDES env=false (caller wins)", async () => {
    const { env, store } = buildEnv({ SITE_PROVISIONING_DRY_RUN: "false" });
    const outcome = await warmSiteCache(env, {
      site_id: "st_abc", content_version: 7, originBaseUrl: "https://site.example.com", dryRun: true,
    });
    expect(outcome.dry_run).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it("missing env var defaults to dry-run; CF-shaped originBaseUrl emits ZERO outbound (Q1 guard)", async () => {
    const { env, store } = buildEnv({ SITE_PROVISIONING_DRY_RUN: "" });
    const outcome = await warmSiteCache(env, {
      site_id: "st_abc", content_version: 1,
      originBaseUrl: "https://api.cloudflare.com/client/v4/zones/x/purge_cache",
    });
    expect(outcome.dry_run).toBe(true);
    const cfCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes("api.cloudflare.com"));
    expect(cfCalls).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
});

describe("warm.warmSiteCache — live mode (env=false + caller dryRun=false)", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("warms all four targets when origin returns 200 OK; KV holds bodies under canonical keys", async () => {
    const { env, store } = buildEnv({ SITE_PROVISIONING_DRY_RUN: "false" });
    const warmFetch = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/sitemap.xml")) return okResponse("<urlset/>");
      if (u.endsWith("/feed.xml")) return okResponse("<rss/>");
      if (u.endsWith("/atom.xml")) return okResponse("<feed/>");
      return okResponse("<html>home</html>");
    }) as unknown as typeof fetch;
    const outcome = await warmSiteCache(env, {
      site_id: "st_abc", content_version: 5,
      originBaseUrl: "https://site.example.com", dryRun: false, warmFetch,
    });
    expect(outcome.dry_run).toBe(false);
    expect(outcome.warmed).toBe(4);
    expect(outcome.failed).toBe(0);
    const homepage = await getCachedHtml(env, htmlKey("st_abc", "/", 5));
    expect(homepage?.body).toBe("<html>home</html>");
    expect(homepage?.etag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(store.get(sitemapKey("st_abc", 5))?.body).toBe("<urlset/>");
    expect(store.get(feedRssKey("st_abc", 5))?.body).toBe("<rss/>");
    expect(store.get(feedAtomKey("st_abc", 5))?.body).toBe("<feed/>");
    expect(warmFetch).toHaveBeenCalledTimes(4);
  });

  it("non-2xx origin response records status=skipped without throwing", async () => {
    const { env, store } = buildEnv({ SITE_PROVISIONING_DRY_RUN: "false" });
    const warmFetch = (vi.fn(async () => new Response("x", { status: 503 }))) as unknown as typeof fetch;
    const outcome = await warmSiteCache(env, {
      site_id: "st_abc", content_version: 5,
      originBaseUrl: "https://site.example.com", dryRun: false, warmFetch,
    });
    expect(outcome.warmed).toBe(0);
    expect(outcome.failed).toBe(0);
    expect(outcome.results.every((r) => r.status === "skipped" && r.http_status === 503)).toBe(true);
    expect(store.size).toBe(0);
  });

  it("fetch throw records status=failed but pass keeps going (best-effort)", async () => {
    const { env, store } = buildEnv({ SITE_PROVISIONING_DRY_RUN: "false" });
    let call = 0;
    const warmFetch = (vi.fn(async (url: unknown) => {
      call += 1;
      if (call === 1) throw new Error("ECONNRESET");
      return okResponse(`body for ${String(url)}`);
    })) as unknown as typeof fetch;
    const outcome = await warmSiteCache(env, {
      site_id: "st_abc", content_version: 5,
      originBaseUrl: "https://site.example.com", dryRun: false, warmFetch,
    });
    expect(outcome.failed).toBe(1);
    expect(outcome.warmed).toBe(3);
    expect(outcome.results[0]?.status).toBe("failed");
    expect(outcome.results[0]?.error).toContain("ECONNRESET");
    expect(store.get(sitemapKey("st_abc", 5))?.body).toContain("/sitemap.xml");
  });

  it("expirationTtl threads to KV.put for all target kinds", async () => {
    const { env, store } = buildEnv({ SITE_PROVISIONING_DRY_RUN: "false" });
    const warmFetch = (vi.fn(async () => okResponse("<body/>"))) as unknown as typeof fetch;
    await warmSiteCache(env, {
      site_id: "st_abc", content_version: 5,
      originBaseUrl: "https://site.example.com", dryRun: false, expirationTtl: 600, warmFetch,
    });
    expect(store.get(htmlKey("st_abc", "/", 5))?.ttl).toBe(600);
    expect(store.get(sitemapKey("st_abc", 5))?.ttl).toBe(600);
    expect(store.get(feedRssKey("st_abc", 5))?.ttl).toBe(600);
    expect(store.get(feedAtomKey("st_abc", 5))?.ttl).toBe(600);
  });

  it("homepage warm stores ETag matching computeEtag(site_id, '/', content_version)", async () => {
    const { env } = buildEnv({ SITE_PROVISIONING_DRY_RUN: "false" });
    const warmFetch = (vi.fn(async () => okResponse("<html>home</html>"))) as unknown as typeof fetch;
    await warmSiteCache(env, {
      site_id: "st_abc", content_version: 9,
      originBaseUrl: "https://site.example.com", dryRun: false, warmFetch,
    });
    const hit = await getCachedHtml(env, htmlKey("st_abc", "/", 9));
    const expected = await computeEtag({ site_id: "st_abc", path: "/", content_version: 9 });
    expect(hit?.etag).toBe(expected);
  });
});
