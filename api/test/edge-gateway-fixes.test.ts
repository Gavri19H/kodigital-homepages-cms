import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCacheStats } from "../src/cache/cache-stats";
import { gatewayFetch } from "../src/edge/gateway";
import { PublicPage } from "../src/edge/public-page";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import type { Env } from "../src/env";
import worker, { honoFetch } from "../src/index";
import { makeFakeDb } from "./helpers/admin-test-kit";
import { ctxCapture, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv, type SqliteDb } from "./helpers/x06-a2-sqlite";

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

function gateway(render: PageFetch, env = { DB: makeFakeDb().db, CACHE: makeKvStub().kv, ADMIN_HOST: "cms.example" } as Env) {
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
  vi.spyOn(Math, "random").mockReturnValue(0.1); // Measure the serving path without a background counter sample.
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
    const prepare = vi.spyOn(env.DB, "prepare");
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
      expect(prepare.mock.calls).toEqual([
        [expect.stringContaining("INSERT INTO edge_hit_counts")],
        [expect.stringContaining("INSERT INTO edge_hit_counts")],
      ]);
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

describe("listicle and quote browser cache headers", () => {
  let db: SqliteDb;
  let env: Env;
  let ctx: ExecutionContext;

  beforeEach(() => {
    db = createDb();
    addSite(db, "news", "News", "health");
    db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run("news", "news.example");
    db.prepare(`INSERT INTO listicle_articles (id, site_id, public_id, slug, article_name, status)
      VALUES (1, 'news', 'art_guide', 'guide', 'Guide', 'published')`).run();
    db.prepare(`INSERT INTO listicle_article_versions (article_id, public_id, headline, intro_paragraph)
      VALUES (1, 'ver_guide', 'Guide', 'Intro')`).run();
    db.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
      VALUES (1, ?, 'Car quote', 'quote_funnel', '["auto"]', 'active')`).run("lgq_00000000000000000000000001");
    db.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled) VALUES ('news', 1, 1)").run();
    db.prepare(`INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status)
      VALUES (1, ?, 1, 'Car quote', 'active')`).run("lgf_00000000000000000000000001");
    db.prepare("INSERT INTO leadgen_funnel_variants (id, public_id, funnel_id) VALUES (1, ?, 1)")
      .run("lgn_00000000000000000000000001");

    env = sqliteEnv(db);
    env.DB.batch = <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(s => s.all<T>()));
    Object.assign(env.CACHE, { async getWithMetadata() { return { value: null, metadata: null }; } });
    ctx = ctxCapture().ctx;
    Object.assign(ctx, { exports: {
      PublicPage: ({ props }: { props: PublicPageProps }) => new PublicPage({ ...ctx, props }, env),
    } });
    vi.spyOn(crypto, "randomUUID").mockReturnValue("6bcfd486-e75e-46ff-8510-000000000001");
  });
  afterEach(() => db.close());

  async function compareWithHono(request: Request, status: number, cacheControl: string) {
    const live = await honoFetch(request.clone(), env);
    const edge = await worker.fetch(request, env, ctx);
    expect(live.status).toBe(status);
    expect(edge.status).toBe(status);
    expect(edge.headers.get("x-edge-cache")).toBe("none");
    expect(live.headers.get("Cache-Control")).toBe(cacheControl);
    expect(edge.headers.get("Cache-Control")).toBe(live.headers.get("Cache-Control"));
    expect(edge.headers.get("ETag")).toBe(live.headers.get("ETag"));
    expect(edge.headers.getSetCookie()).toEqual(live.headers.getSetCookie());
    return edge;
  }

  it.each([
    ["/guide", ""], ["/guide", "ko_sid=returning"], ["/lg", ""], ["/lg", "ko_sid=returning"],
  ])("matches Hono on GET and revalidation for %s with Cookie %j", async (path, cookie) => {
    const request = new Request(origin + path + "?utm_source=search");
    if (cookie) request.headers.set("Cookie", cookie);
    const cacheControl = "public, max-age=300, stale-while-revalidate=86400";
    const first = await compareWithHono(request, 200, cacheControl);
    const etag = first.headers.get("ETag");
    expect(etag).toBeTruthy();
    request.headers.set("If-None-Match", etag!);
    const conditional = await compareWithHono(request, 304, cacheControl);
    expect(conditional.headers.get("ETag")).toBe(etag);
    expect(conditional.body).toBeNull();
  });

  it("preserves the renderer's no-store for a quote with unavailable vehicle data", async () => {
    db.prepare(`INSERT INTO leadgen_sections (id, public_id, section_name, activity, vertical, headline_text, content_json)
      VALUES (1, ?, 'Car make', 'quote_funnel', 'auto', 'Select a make', ?)`).run("lgs_00000000000000000000000001",
      JSON.stringify({ components: [{
        type: "IconCardAnswerGrid", question_id: "q_make", question_key: "car_make", internal_field: "vehicle_make",
        props: { choice_source: "vehicle", vehicle_asks: "make" },
      }] }));
    db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (1, 1, 0)").run();
    Object.assign(env.MEDIA, { async get() { return null; } });
    const response = await compareWithHono(new Request(origin + "/lg"), 200, "no-store");
    expect(response.headers.has("ETag")).toBe(false);
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
