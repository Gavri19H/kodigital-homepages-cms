import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkInfraContract } from "../scripts/verify/infra-contract";
import { checkWorkerConfig } from "../scripts/verify/worker-config";
import { applyEdgeCacheHeaders } from "../src/cache/cache-control";
import { PublicPage } from "../src/edge/public-page";
import { buildSiteSnapshot } from "../src/edge/snapshot";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import type { Env } from "../src/env";
import { honoFetch } from "../src/index";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));
vi.mock("../src/edge/snapshot", () => ({ buildSiteSnapshot: vi.fn() }));
vi.mock("../src/index", () => ({ honoFetch: vi.fn() }));

const DAY = "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400";
const MINUTE = "public, max-age=0, s-maxage=60";
const PRIVATE = "private, no-store";

describe("applyEdgeCacheHeaders", () => {
  it.each([
    ["/", "listing:site-a"],
    ["/category/news", "listing:site-a"],
    ["/category/news/page/2", "listing:site-a"],
    ["/tag/tech", "listing:site-a"],
    ["/tag/tech/page/3", "listing:site-a"],
    ["/feed.xml", "listing:site-a"],
    ["/rss", "listing:site-a"],
    ["/%72ss", "listing:site-a"],
    ["/atom.xml", "listing:site-a"],
    ["/sitemap.xml", "listing:site-a"],
    ["/llms.txt", "listing:site-a"],
    ["/article/My-Story", "slug:site-a:my-story"],
    ["/art%69cle/best%2Dcars", "slug:site-a:best-cars"],
    ["/page/about", "slug:site-a:about"],
    ["/best-cars", "slug:site-a:best-cars"],
    ["/lg", "slug:site-a:lg"],
    ["/robots.txt", null],
    ["/ads.txt", null],
    ["/%61ds.txt", null],
    ["/favicon.ico", null],
    ["/site-icon.svg", null],
    ["/lg/quote", null],
    ["/article/story/extra", null],
    ["/rss-guide", "slug:site-a:rss-guide"],
  ] as const)("tags %s with the site's purge targets", (path, routeTag) => {
    const result = applyEdgeCacheHeaders(new Response(), { siteId: "Site-A", path });
    expect(result.headers.get("Cache-Tag")).toBe(routeTag ? `site:site-a,${routeTag}` : "site:site-a");
    expect(result.headers.get("Cache-Control")).toBe(DAY);
  });

  it.each([
    [200, DAY, "site:a,slug:a:story"],
    [301, DAY, "site:a,slug:a:story"],
    [308, DAY, "site:a,slug:a:story"],
    [404, MINUTE, "site:a,slug:a:story,nf:a"],
    [201, PRIVATE, null],
    [204, PRIVATE, null],
    [302, PRIVATE, null],
    [304, PRIVATE, null],
    [307, PRIVATE, null],
    [403, PRIVATE, null],
    [429, PRIVATE, null],
    [500, PRIVATE, null],
    [503, PRIVATE, null],
  ] as const)("applies the cache policy for status %i", (status, control, tags) => {
    const original = new Response(null, { status, headers: { "Cache-Control": "max-age=10", "Cache-Tag": "old" } });
    const response = applyEdgeCacheHeaders(original, { siteId: "a", path: "/story" });
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe(control);
    expect(response.headers.get("Cache-Tag")).toBe(tags);
    expect(original.headers.get("Cache-Tag")).toBe("old");
  });

  it.each([200, 301, 308, 404])("keeps status %i private when Set-Cookie is present", status => {
    const cookie = "sid=test; Path=/; HttpOnly";
    const original = new Response(null, { status, headers: { "Set-Cookie": cookie, "Cache-Tag": "old" } });
    const response = applyEdgeCacheHeaders(original, { siteId: "a", path: "/" });
    expect(response.headers.get("Cache-Control")).toBe(PRIVATE);
    expect(response.headers.get("Cache-Tag")).toBeNull();
    expect(response.headers.get("Set-Cookie")).toBe(cookie);
  });

  it("returns a mutable response for an immutable redirect and preserves its location", () => {
    const location = "https://tenant.example/new-story";
    const original = Response.redirect(location, 301);
    const response = applyEdgeCacheHeaders(original, { siteId: "a", path: "/old-story" });
    expect(response).not.toBe(original);
    expect(response.headers.get("Location")).toBe(location);
    response.headers.set("x-edge-cache", "HIT");
    expect(original.headers.has("x-edge-cache")).toBe(false);
  });
});

const env = { CACHE_API_ENABLED: "true" } as Env;
const snapProps = { siteKey: "host:tenant.example", variantKey: "snap" };
const snapUrl = "https://tenant.example/__snap";

function entrypoint(props: PublicPageProps, cache?: CacheContext) {
  const ctx = { props, cache } as ExecutionContext<PublicPageProps>;
  return { page: new PublicPage(ctx, env), ctx };
}

describe("PublicPage.fetch", () => {
  beforeEach(() => vi.resetAllMocks());

  it("forwards the assigned variant and returns the renderer body, validators and merged purge tags", async () => {
    const { page, ctx } = entrypoint({ siteKey: "Site-A", variantKey: "md" });
    const request = new Request("https://tenant.example/article/story", {
      headers: {
        Accept: "text/markdown",
        "x-cms-variant": "human",
        "x-cms-bookmark": "bookmark-123",
        "x-cms-tags": "listicle:L1, QUOTE:Q1, , quote:q1, site:SITE-A",
      },
    });
    const modified = "Mon, 23 Nov 2026 12:00:00 GMT";
    vi.mocked(honoFetch).mockResolvedValue(new Response("# Story", {
      headers: { "Content-Type": "text/markdown", ETag: '"rev-1"', "Last-Modified": modified },
    }));

    const response = await page.fetch(request);

    expect(honoFetch).toHaveBeenCalledTimes(1);
    const [forwarded, bindings, context] = vi.mocked(honoFetch).mock.calls[0]!;
    expect(bindings).toEqual({ ...env, EDGE_INNER: "1" });
    expect(env.EDGE_INNER).toBeUndefined();
    expect(context).toBe(ctx);
    expect(forwarded.url).toBe(request.url);
    expect(forwarded.headers.get("Accept")).toBe("text/markdown");
    expect(forwarded.headers.get("x-cms-bookmark")).toBe("bookmark-123");
    expect(forwarded.headers.get("x-cms-variant")).toBe("md");
    expect(request.headers.get("x-cms-variant")).toBe("human");
    expect(buildSiteSnapshot).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe(DAY);
    expect(response.headers.get("Cache-Tag")).toBe("site:site-a,slug:site-a:story,listicle:l1,quote:q1");
    expect(response.headers.get("ETag")).toBe('"rev-1"');
    expect(response.headers.get("Last-Modified")).toBe(modified);
    expect(response.headers.get("Content-Type")).toBe("text/markdown");
    expect(await response.text()).toBe("# Story");
  });

  it("serves a host-bound JSON snapshot tagged for the resolved site", async () => {
    const snapshot: SiteSnapshot = {
      v: 1, siteId: "Site-A", hostname: "tenant.example", status: "active",
      contentVersion: 5, settingsVersion: 2, writeBookmark: "bookmark-123",
      timeZone: "UTC", language: "en", builtAt: 1000, listicles: {}, leadgen: {},
    };
    vi.mocked(buildSiteSnapshot).mockResolvedValue(snapshot);
    const { page } = entrypoint(snapProps);
    const response = await page.fetch(new Request(snapUrl));
    expect(buildSiteSnapshot).toHaveBeenCalledWith({ ...env, EDGE_INNER: "1" }, "tenant.example");
    expect(env.EDGE_INNER).toBeUndefined();
    expect(honoFetch).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Cache-Control")).toBe(DAY);
    expect(response.headers.get("Cache-Tag")).toBe("site:site-a,snap:site-a");
    expect(await response.json()).toEqual(snapshot);
  });

  it("caches an unknown snapshot host for one minute under its host tag", async () => {
    vi.mocked(buildSiteSnapshot).mockResolvedValue(null);
    const { page } = entrypoint(snapProps);
    const response = await page.fetch(new Request(snapUrl));
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe(MINUTE);
    expect(response.headers.get("Cache-Tag")).toBe("host:tenant.example");
    expect(honoFetch).not.toHaveBeenCalled();
  });

  it("returns an uncacheable 503 when the snapshot builder throws", async () => {
    vi.mocked(buildSiteSnapshot).mockRejectedValue(new Error("read failed"));
    const { page } = entrypoint(snapProps);
    const response = await page.fetch(new Request(snapUrl));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe(PRIVATE);
    expect(response.headers.has("Cache-Tag")).toBe(false);
    expect(honoFetch).not.toHaveBeenCalled();
  });

  it.each(["host:other.example", "tenant.example"])("rejects mismatched snapshot key %s before lookup", async siteKey => {
    const { page } = entrypoint({ ...snapProps, siteKey });
    const response = await page.fetch(new Request(snapUrl));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe(PRIVATE);
    expect(response.headers.has("Cache-Tag")).toBe(false);
    expect(buildSiteSnapshot).not.toHaveBeenCalled();
    expect(honoFetch).not.toHaveBeenCalled();
  });
});

describe("PublicPage.purgeTags", () => {
  it("purges once through the entrypoint cache with at most 100 distinct normalized tags", async () => {
    const purge = vi.fn<CacheContext["purge"]>().mockResolvedValue({ success: true, errors: [] });
    const { page } = entrypoint(snapProps, { purge });
    const tags = Array.from({ length: 105 }, (_, i) => `site:${i}`);
    expect(await page.purgeTags(["SITE:0", "", ...tags])).toEqual({ success: true, errors: [] });
    expect(purge).toHaveBeenCalledTimes(1);
    expect(purge).toHaveBeenCalledWith({ tags: tags.slice(0, 100) });
  });

  it("returns the platform's purge errors when the request is rate limited", async () => {
    const result = { success: false, errors: [{ code: 429, message: "rate limited" }] };
    const { page } = entrypoint(snapProps, { purge: vi.fn().mockResolvedValue(result) });
    expect(await page.purgeTags(["site:a"])).toEqual(result);
  });

  it("returns an error when the cache context is absent", async () => {
    const { page } = entrypoint(snapProps);
    expect(await page.purgeTags(["site:a"])).toEqual({ success: false, errors: ["no-cache-context"] });
  });

  it("returns a failure result when the purge rejects", async () => {
    const { page } = entrypoint(snapProps, { purge: vi.fn().mockRejectedValue(new Error("unavailable")) });
    expect(await page.purgeTags(["site:a"])).toEqual({ success: false, errors: ["unavailable"] });
  });
});

describe("Worker cache configuration", () => {
  it("passes both deployment contract checks against the repository's wrangler.toml", () => {
    const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
    expect(checkWorkerConfig(toml)).toEqual([]);
    expect(checkInfraContract(toml)).toEqual([]);
  });

  it.each([
    ["env.production.cache", "enabled = false"],
    ["exports.default", 'type = "worker"\ncache = { enabled = true }'],
    ["env.staging.exports.PublicPage", 'type = "worker"\ncache = { enabled = false }'],
    ["env.production.exports.PublicPage", 'type = "durable-object"\ncache = { enabled = true }'],
  ])("rejects incorrect declarations in [%s] in both checks", (section, settings) => {
    const toml = `[${section}]\n${settings}\n`;
    expect(checkWorkerConfig(toml).map(failure => failure.block)).toContain(`[${section}]`);
    expect(checkInfraContract(toml).map(failure => failure.name)).toContain(section);
  });
});
