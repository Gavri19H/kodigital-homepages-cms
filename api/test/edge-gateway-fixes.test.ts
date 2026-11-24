import { afterEach, describe, expect, it, vi } from "vitest";
import { readCacheStats } from "../src/cache/cache-stats";
import { gatewayFetch } from "../src/edge/gateway";
import { PublicPage } from "../src/edge/public-page";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import type { Env } from "../src/env";
import { ctxCapture, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv } from "./helpers/x06-a2-sqlite";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const origin = "https://news.example";
const snapshot: SiteSnapshot = {
  v: 1, siteId: "news", hostname: "news.example", status: "active",
  contentVersion: 7, settingsVersion: 2, writeBookmark: "bookmark-7", timeZone: "UTC", language: "en",
  builtAt: 123, listicles: {}, leadgen: {},
};
const day = "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400";

function html(body: string, headers: Record<string, string> = {}) {
  return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": day, ...headers } });
}

type PageFetch = (request: Request, props: PublicPageProps) => Response | Promise<Response>;

function gateway(render: PageFetch, env = { CACHE: makeKvStub().kv, ADMIN_HOST: "cms.example" } as Env) {
  const { ctx, promises } = ctxCapture();
  const page = vi.fn(render);
  const fallback = vi.fn(() => new Response("live Hono"));
  Object.assign(ctx, { exports: { PublicPage: ({ props }: { props: PublicPageProps }) => ({
    fetch: (request: Request) => props.variantKey === "snap"
      ? Response.json(snapshot, { headers: { "cf-cache-status": "HIT" } })
      : page(request, props),
  }) } });
  const visit = (path: string, init?: RequestInit) => gatewayFetch(new Request(origin + path, init), env, ctx, fallback);
  return { visit, env, ctx, page, fallback, promises };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("derives the inner Host from the tenant URL and removes forwarding and cache-key overrides", async () => {
  const { visit, page } = gateway(() => html("news"));
  const overrides = [
    "Forwarded", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Forwarded-For", "X-Forwarded-Port",
    "X-Forwarded-Scheme", "X-Host", "X-Original-Host", "X-Original-URL", "X-Rewrite-URL",
    "X-HTTP-Method-Override", "X-HTTP-Method", "X-Method-Override", "Cloudflare-Workers-Version-Key",
  ];
  const headers = new Headers({
    Host: "proxy.example", "CF-Connecting-IP": "192.0.2.5", "Accept-Language": "fr",
    Cookie: "ko_sid=visitor", "X-CMS-Bookmark": "client",
  });
  for (const name of overrides) headers.set(name, "proxy-value");
  await visit("/article/story?utm_source=email", { headers });
  const [inner, props] = page.mock.calls[0]!;
  expect(props).toEqual({ siteKey: "news", variantKey: "human" });
  expect(inner.url).toBe(origin + "/article/story");
  expect(inner.headers.get("Host")).toBe("news.example");
  expect(overrides.filter(name => inner.headers.has(name))).toEqual([]);
  expect(inner.headers.get("CF-Connecting-IP")).toBe("192.0.2.5");
  expect(inner.headers.get("Accept-Language")).toBe("fr");
  expect(inner.headers.get("x-cms-bookmark")).toBe("bookmark-7");
  expect(inner.headers.has("Cookie")).toBe(false);
});

it.each(["/lg", "/lg/missing", "/lg/constructor"])("serves a cached tenant 404 for %s", async path => {
  const db = createDb();
  try {
    addSite(db, "news", "News", "health");
    db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run("news", "news.example");
    const env = sqliteEnv(db);
    const prepare = vi.spyOn(env.DB, "prepare");
    const { ctx } = ctxCapture();
    const entries = new Map<string, Response>();
    const { visit, page, fallback } = gateway(async (request, props) => {
      const key = JSON.stringify([request.url, props]);
      const hit = entries.get(key);
      const response = hit?.clone() ?? await new PublicPage({ ...ctx, props }, env).fetch(request);
      if (!hit && response.headers.get("Cache-Control")?.includes("s-maxage=60")) entries.set(key, response.clone());
      response.headers.set("cf-cache-status", hit ? "HIT" : "MISS");
      return response;
    }, env);
    for (const outcome of ["MISS", "HIT"]) {
      prepare.mockClear();
      const response = await visit(path + "?click=" + outcome);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Not Found" });
      expect(response.headers.get("x-edge-cache")).toBe(outcome);
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=60");
      expect(response.headers.get("Cache-Tag")?.split(",")).toContain("nf:news");
      expect(response.headers.getSetCookie()).toEqual([]);
      const [inner, props] = page.mock.lastCall!;
      expect(props).toEqual({ siteKey: "news", variantKey: "human" });
      expect(inner.url).toBe(origin + path);
      if (outcome === "HIT") expect(prepare).not.toHaveBeenCalled();
      else expect(prepare).toHaveBeenCalled();
    }
    expect(fallback).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});

describe("gateway cache monitor", () => {
  it("returns HIT and MISS while their weighted counter writes are pending", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.099);
    let outcome = "HIT";
    const { visit, env, promises } = gateway(() => html("news", { "cf-cache-status": outcome }));
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const put = env.CACHE.put.bind(env.CACHE);
    vi.spyOn(env.CACHE, "put").mockImplementation(async (key, value) => {
      await gate;
      return put(key, value);
    });
    try {
      for (outcome of ["HIT", "MISS"]) {
        const response = await visit("/");
        expect(response.headers.get("x-edge-cache")).toBe(outcome);
        expect(await response.text()).toBe("news");
      }
      expect(promises).toHaveLength(2);
      expect((await readCacheStats(env)).total).toBe(0);
    } finally {
      release();
      await Promise.all(promises);
    }
    expect(await readCacheStats(env)).toEqual({ hits: 10, misses: 10, total: 20, hit_rate: 0.5 });
  });

  it("samples only the final HIT or MISS and skips unsampled requests", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    let headers: Record<string, string> = {};
    const { visit, env, promises } = gateway(() => html("news", headers));
    const read = vi.spyOn(env.CACHE, "get");
    await visit("/");
    headers = { "cf-cache-status": "BYPASS" };
    await visit("/");
    await visit("/lg/auction");
    random.mockReturnValue(0.1);
    headers = { "cf-cache-status": "HIT" };
    await visit("/");
    expect(promises).toHaveLength(0);
    expect(read).not.toHaveBeenCalled();
  });

  it("counts a static cache HIT once", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("caches", { default: { match: async () => new Response("asset") } });
    const { visit, env, page, promises } = gateway(() => html("news"));
    const response = await visit("/media/image.png");
    expect(response.headers.get("x-edge-cache")).toBe("HIT");
    expect(page).not.toHaveBeenCalled();
    expect(promises).toHaveLength(1);
    await Promise.all(promises);
    expect((await readCacheStats(env)).hits).toBe(10);
  });

  it("still serves the cache hit when the context rejects background work", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { visit, ctx, fallback } = gateway(() => html("news", { "cf-cache-status": "HIT" }));
    const schedule = vi.spyOn(ctx, "waitUntil").mockImplementation(() => { throw new Error("context closed"); });
    const response = await visit("/");
    expect(schedule).toHaveBeenCalledOnce();
    expect(response.headers.get("x-edge-cache")).toBe("HIT");
    expect(await response.text()).toBe("news");
    expect(fallback).not.toHaveBeenCalled();
  });
});

describe("public HTML revalidation", () => {
  it.each(['"edition-7"', 'W/"edition-7"'])("preserves the opaque value of inner ETag %s across compression", async innerTag => {
    const { visit, page } = gateway(() => html("current story", { ETag: innerTag, "cf-cache-status": "HIT" }));
    const headers = { "Accept-Encoding": "br, gzip" };
    const first = await visit("/article/story", { headers });
    expect(first.status).toBe(200);
    expect(first.headers.get("ETag")).toBe('W/"edition-7"');
    expect(await first.text()).toBe("current story");
    for (const [method, validator] of [["GET", '"old", W/"edition-7"'], ["HEAD", '"edition-7"']] as const) {
      const response = await visit("/article/story", {
        method, headers: { ...headers, "If-None-Match": validator, "If-Modified-Since": "Tue, 24 Nov 2026 00:00:00 GMT" },
      });
      expect(response.status).toBe(304);
      expect(response.body).toBeNull();
      expect(response.headers.get("ETag")).toBe(first.headers.get("ETag"));
      expect(response.headers.get("Cache-Control")).toBe(day);
      expect(response.headers.get("x-edge-cache")).toBe("HIT");
    }
    for (const [inner] of page.mock.calls) {
      expect(inner.headers.get("Accept-Encoding")).toBe("identity");
      expect(inner.headers.has("If-None-Match")).toBe(false);
      expect(inner.headers.has("If-Modified-Since")).toBe(false);
    }
  });

  it("revalidates public HTML when the cached response has no ETag and serves edits immediately", async () => {
    let story = "original story";
    const { visit } = gateway(() => html(story, { "cf-cache-status": "HIT" }));
    const first = await visit("/article/story");
    expect(await first.text()).toBe(story);
    const validator = first.headers.get("ETag");
    expect(validator).toMatch(/^W\/"[^"]+"$/);
    const headers = { "If-None-Match": validator! };
    const current = await visit("/article/story", { headers });
    expect(current.status).toBe(304);
    expect(current.body).toBeNull();
    expect(current.headers.get("ETag")).toBe(validator);
    story = "updated story";
    const edited = await visit("/article/story", { headers });
    expect(edited.status).toBe(200);
    expect(await edited.text()).toBe(story);
    expect(edited.headers.get("ETag")).not.toBe(validator);
  });
});
