import { afterEach, describe, expect, it, vi } from "vitest";
import { gatewayFetch } from "../src/edge/gateway";
import type { LeadgenSnapshotEntry } from "../src/edge/leadgen-select";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import type { Env } from "../src/env";
import worker from "../src/index";
import { readCookie } from "../src/public/listicle/experiment-pick";
import { createDb, env as sqliteEnv, hasSqlite } from "./helpers/x06-a2-sqlite";

const origin = "https://tenant.example";
const mintedSid = "6bcfd486-e75e-46ff-8510-000000000001";
const rootVariant = "lgn_00000000000000000000000001";
const lifeVariant = "lgn_00000000000000000000000002";
const quoteId = "lgq_00000000000000000000000001";
const sessionAttrs = "; Path=/; Max-Age=1800; SameSite=Lax";
const privateControl = "private, no-store";
const visitorHtmlControl = "public, max-age=300, stale-while-revalidate=86400";
const shell = '<html><head><script data-lst="selector"></script></head><body><!--LG_ASSIGN--></body></html>';

function quote(public_id: string): LeadgenSnapshotEntry {
  return {
    quoteId, defaultFunnelId: 1, rules: [], offerLocations: {},
    funnels: [{ id: 1, abTest: null, variants: [{ public_id, variant_label: "A", traffic_allocation_bp: 10000 }] }],
  };
}

const control = { public_id: "ver_A", variant_label: "A", is_control: 1, traffic_allocation: 65 };
const alternate = { public_id: "ver_Z", variant_label: "Z", is_control: 0, traffic_allocation: 35 };
const listicle = {
  listicleId: "art_11", publishedVersion: control, experiment: { publicId: "exp_11", versions: [alternate, control] },
};
const snapshot: SiteSnapshot = {
  v: 1, siteId: "site-a", hostname: "tenant.example", status: "active",
  contentVersion: 9, settingsVersion: 2, writeBookmark: "last-write", timeZone: "UTC", language: "en", builtAt: 123,
  listicles: { guide: listicle, rss: listicle, lg: listicle },
  leadgen: { "/lg": quote(rootVariant), life: quote(lifeVariant) },
};

const readDb = vi.fn((): D1Database => { throw new Error("gateway accessed D1"); });
const env = { ADMIN_HOST: "cms.example", get DB() { return readDb(); } } as Env;

interface PageCall { props: PublicPageProps; request: Request }
type PageHandler = (call: PageCall) => Response | Promise<Response>;

function testContext(exports: Cloudflare.Exports): ExecutionContext {
  return {
    props: {}, exports, waitUntil() {}, passThroughOnException() {},
    get tracing(): never { throw new Error("unexpected tracing access"); },
  };
}

function harness({
  snap = () => Response.json(snapshot),
  render = () => new Response(shell, { headers: {
    "Content-Type": "text/html", ETag: '"v9"', "cf-cache-status": "HIT",
    "Cache-Control": "public, max-age=0, s-maxage=86400", "Content-Length": String(shell.length),
  } }),
}: { snap?: PageHandler; render?: PageHandler } = {}) {
  const calls: PageCall[] = [];
  const exports: Cloudflare.Exports = {
    PublicPage: ({ props }: { props: PublicPageProps }) => ({
      async fetch(request: Request) {
        const call = { props, request };
        calls.push(call);
        return (props.variantKey === "snap" ? snap : render)(call);
      },
    }),
  };
  const ctx = testContext(exports);
  const honoFetch = vi.fn<Parameters<typeof gatewayFetch>[3]>(() => new Response("live Hono"));
  const serve = (request: Request) => gatewayFetch(request, env, ctx, honoFetch);
  return { ctx, calls, honoFetch, serve };
}

function visit(path: string, init?: RequestInit): Request {
  return new Request(origin + path, init);
}

afterEach(() => {
  vi.restoreAllMocks();
  expect(readDb).not.toHaveBeenCalled();
});

describe("public page cache keys", () => {
  it.each([
    ["/", "human"], ["/article/guide", "human"], ["/category/news", "human"], ["/category/news/page/2", "human"],
    ["/tag/local", "human"], ["/tag/local/page/1", "human"], ["/page/guide", "human"],
    ["/feed.xml", "human"], ["/rss", "human"], ["/atom.xml", "human"], ["/sitemap.xml", "human"],
    ["/robots.txt", "human"], ["/ads.txt", "human"], ["/llms.txt", "human"],
    ["/favicon.ico", "human"], ["/site-icon.svg", "human"], ["/ordinary", "human"],
    ["/constructor", "human"], ["/health-news", "human"], ["/guide", "lst:ver_A"], ["/%67uide", "lst:ver_A"],
    ["/lg", "lg:" + rootVariant], ["/lg/life", "lg:" + lifeVariant],
  ])("fetches %s under its site and %s variant", async (path, variantKey) => {
    const { serve, calls, honoFetch } = harness();
    const response = await serve(visit(path + "?utm_source=ad&other=value", {
      headers: { Cookie: "ko_sid=desktop-1", Accept: "*/*", "Accept-Language": "fr" },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-edge-cache")).toBe("HIT");
    expect(honoFetch).not.toHaveBeenCalled();
    expect(calls.map(({ props, request }) => [props, request.url, request.method])).toEqual([
      [{ siteKey: "host:tenant.example", variantKey: "snap" }, origin + "/__snap", "GET"],
      [{ siteKey: "site-a", variantKey }, origin + path, "GET"],
    ]);
    expect([...calls[0]!.request.headers]).toEqual([]);
    const headers = calls[1]!.request.headers;
    expect(headers.has("Cookie")).toBe(false);
    expect(headers.get("Accept")).toBe("text/html");
    expect(headers.get("Accept-Language")).toBe("fr");
    expect(headers.get("x-cms-bookmark")).toBe("last-write");
    if (variantKey === "human") {
      expect(headers.has("x-cms-tags")).toBe(false);
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it("keeps ad clicks out of the cache key while preserving attribution for each visit", async () => {
    const { serve, calls } = harness();
    const headers = { Cookie: "ko_sid=desktop-1" };
    const first = await serve(visit("/guide?utm_source=first", { headers }));
    const next = await serve(visit("/guide?utm_source=second&utm_medium=cpc&utm_content=video&utm_campaign=sale" +
      "&fbclid=click&gclid=google&sub1=one&sub2=two&sub3=three&sub4=four&sub5=five&unused=1", { headers }));
    expect(calls.slice(2).map(c => [c.props, c.request.url])).toEqual(calls.slice(0, 2).map(c => [c.props, c.request.url]));
    expect(calls.map(c => new URL(c.request.url).search)).toEqual(["", "", "", ""]);
    expect(await first.text()).toContain('"utm_source":"first"');
    const body = await next.text();
    expect(body).toContain('"utm_source":"second"');
    expect(body).toContain('"sub5":"five"');
    expect(next.headers.getSetCookie()).toHaveLength(2);
  });

  it("uses distinct snapshot and page keys for two tenants requesting the same path", async () => {
    const { serve, calls, honoFetch } = harness({
      snap: ({ request }) => {
        const hostname = new URL(request.url).hostname;
        return Response.json({ ...snapshot, hostname, siteId: hostname === snapshot.hostname ? "site-a" : "site-b" });
      },
      render: ({ props }) => new Response(props.siteKey),
    });
    const first = await serve(visit("/article/shared?gclid=a"));
    const second = await serve(new Request("https://other.example/article/shared?gclid=b"));
    expect([await first.text(), await second.text()]).toEqual(["site-a", "site-b"]);
    expect(calls.map(c => c.props.siteKey)).toEqual(["host:tenant.example", "site-a", "host:other.example", "site-b"]);
    expect(honoFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["/article/news", "text/html, text/markdown;q=0.8", "human", "text/html"],
    ["/article/news", "text/html;q=0.5, text/markdown;q=0.8", "md", "text/markdown"],
    ["/page/news", "text/html;q=0.5, text/markdown;q=0.8", "human", "text/html"],
  ])("normalizes %s with Accept %s", async (path, requested, variantKey, accept) => {
    const { serve, calls } = harness();
    await serve(visit(path, { headers: { Accept: requested } }));
    expect(calls[1]!.props).toEqual({ siteKey: "site-a", variantKey });
    expect(calls[1]!.request.headers.get("Accept")).toBe(accept);
  });

  it("strips all client and response x-cms headers and preserves ordinary headers", async () => {
    const { serve, calls } = harness({
      snap: () => Response.json({ ...snapshot, writeBookmark: null }),
      render: () => new Response("body", { headers: { "x-cms-debug": "one", "X-CMS-Site": "two", "x-public": "ok" } }),
    });
    const request = visit("/page/news", { headers: {
      "X-CMS-Variant": "md", "x-cms-tags": "site:b", "x-cms-bookmark": "forged", "x-cms-other": "extra",
      "x-cms-snap-built-at": "forged", Cookie: "ko_sid=visitor", "x-public": "request",
    } });
    const response = await serve(request);
    expect(await response.text()).toBe("body");
    expect(calls[1]!.props.variantKey).toBe("human");
    for (const { props, request: forwarded } of calls) {
      const internal = [...forwarded.headers].filter(([k]) => k.startsWith("x-cms-") || k === "cookie");
      expect(internal).toEqual(props.variantKey === "snap" ? [] : [["x-cms-snap-built-at", String(snapshot.builtAt)]]);
    }
    expect(calls[1]!.request.headers.get("x-public")).toBe("request");
    expect([...response.headers.keys()].filter(k => k.startsWith("x-cms-"))).toEqual([]);
    expect(response.headers.get("x-public")).toBe("ok");
    expect(response.headers.get("x-edge-cache")).toBe("none");
    expect(request.headers.get("X-CMS-Variant")).toBe("md");
  });
});

describe("visitor-specific responses", () => {
  it("injects the selected listicle arm, session, geo and acquisition context into the outgoing page", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mintedSid);
    const { serve, calls } = harness();
    const request = Object.assign(visit("/guide?utm_source=search", {
      headers: { Cookie: "ko_ctx=" + encodeURIComponent('{"sub1":"prior"}'), "x-cms-variant": "lst:forged" },
    }), { cf: { regionCode: "CA" } });
    const first = await serve(request);
    const second = await serve(visit("/guide", { headers: { Cookie: "ko_sid=desktop-1" } }));
    expect(calls[1]!.props.variantKey).toBe("lst:ver_Z");
    expect(calls[3]!.props.variantKey).toBe("lst:ver_A");
    expect(calls[1]!.request.headers.get("x-cms-tags")).toBe("listicle:art_11");
    expect(calls[1]!.request.headers.has("Cookie")).toBe(false);
    const cookies = first.headers.getSetCookie();
    expect(cookies).toHaveLength(3);
    expect(cookies.slice(0, 2)).toEqual(["ko_sid=" + mintedSid + sessionAttrs, "ko_ver=ver_Z" + sessionAttrs]);
    expect(cookies[2]).toMatch(/; Path=\/; Max-Age=2592000; SameSite=Lax$/);
    expect(JSON.parse(readCookie(cookies[2], "ko_ctx"))).toEqual({
      sub1: "prior", utm_source: "search", traffic_source: "search", language: "en", lander_v: "ver_Z",
    });
    expect(first.headers.get("Cache-Control")).toBe(visitorHtmlControl);
    expect(first.headers.has("Content-Length")).toBe(false);
    const html = await first.text();
    expect(html).toContain('window._LST_SID="' + mintedSid + '"');
    expect(html).toContain('"state":"CA"');
    expect(html).toContain('"variant_id":"ver_Z"');
    expect(html.indexOf('data-lst="ctx"')).toBeLessThan(html.indexOf('data-lst="selector"'));
    expect(second.headers.getSetCookie().map(c => c.split("=")[0])).toEqual(["ko_ver", "ko_ctx"]);
    expect(await second.text()).toContain('window._LST_SID="desktop-1"');
  });

  it.each([false, true])("injects the selected leadgen assignment with returning session %s", async returning => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mintedSid);
    const { serve, calls } = harness();
    const res = await serve(visit("/lg/life", { headers: returning ? { Cookie: "ko_sid=returning" } : {} }));
    expect(calls[1]!.request.headers.get("x-cms-tags")).toBe("quote:site-a:" + quoteId);
    expect(res.headers.getSetCookie()).toEqual(returning ? [] : ["ko_sid=" + mintedSid + sessionAttrs]);
    const html = await res.text();
    expect(html).toContain("window.__LG_ASSIGNMENT__=");
    expect(html).toContain('"funnel_variant_id":"' + lifeVariant + '"');
    expect(html).not.toContain("<!--LG_ASSIGN-->");
    expect(res.headers.get("Cache-Control")).toBe(visitorHtmlControl);
    expect(res.headers.get("Content-Length")).toBe(String(new TextEncoder().encode(html).length));
  });

  it.each([false, true])("returns an entry-rule redirect before fetching the shell, returning session %s", async returning => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mintedSid);
    const root = quote(rootVariant);
    const location = "https://partner.example/quote?source=paid";
    root.rules.push({
      public_id: "rule", hash: "paid", priority: 1, conditions: { groups: [{ field: "utm_medium", op: "eq", value: "paid" }] },
      entry_only: true, match_mode: "all", target_funnel_id: null, target_offer_id: null, force_offer_id: null,
      feed_name: null, value_multiplier: null, redirect_pct: 100, redirect_url: location, redirect_url_allowlisted: true,
    });
    const { serve, calls, honoFetch } = harness({ snap: () => Response.json({ ...snapshot, leadgen: { "/lg": root } }) });
    const headers = new Headers({ "If-None-Match": '"v9"' });
    if (returning) headers.set("Cookie", "ko_sid=returning");
    const res = await serve(visit("/lg?utm_medium=paid", { headers }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(location);
    expect(res.headers.get("Cache-Control")).toBe(privateControl);
    expect(res.headers.getSetCookie()).toEqual(returning ? [] : ["ko_sid=" + mintedSid + sessionAttrs]);
    expect(calls).toHaveLength(1);
    expect(honoFetch).not.toHaveBeenCalled();
  });

  it.each(["/guide", "/lg"])("preserves the GET cookies on HEAD and a matching conditional request for %s", async path => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(mintedSid);
    const { serve, calls } = harness();
    const get = await serve(visit(path));
    const head = await serve(visit(path, { method: "HEAD" }));
    const match = await serve(visit(path, { headers: { "If-None-Match": '"v9"' } }));
    expect(get.status).toBe(200);
    expect(head.status).toBe(200);
    expect(match.status).toBe(304);
    for (const res of [head, match]) {
      expect(res.body).toBeNull();
      expect(res.headers.getSetCookie()).toEqual(get.headers.getSetCookie());
      expect(res.headers.get("Cache-Control")).toBe(visitorHtmlControl);
      expect(res.headers.get("ETag")).toBe('"v9"');
      expect(res.headers.get("x-edge-cache")).toBe("HIT");
    }
    expect(calls).toHaveLength(6);
    for (const { request } of calls) {
      expect(request.method).toBe("GET");
      expect(request.headers.has("If-None-Match")).toBe(false);
    }
  });

  it("sends the full page for an unmatched ETag", async () => {
    const { serve } = harness();
    const res = await serve(visit("/", { headers: { "If-None-Match": '"old"' } }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(shell);
  });

  it.each([301, 404])("preserves a renderer's %i over a stale listicle entry and a matching validator", async status => {
    const { serve } = harness({ render: () => new Response(null, { status, headers: { ETag: '"v9"', Location: "/new" } }) });
    const res = await serve(visit("/guide", { headers: { "If-None-Match": '"v9"' } }));
    expect(res.status).toBe(status);
    expect(res.headers.get("Location")).toBe("/new");
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe("Hono fallbacks and private paths", () => {
  it.each([
    "/health", "/newsletter", "/lc", "/lst-cand", "/preview", "/media", "/assets", "/api", "/admin", "/static", "/v",
    "/lg/attempt", "/lg/ck", "/lg/auction", "/lg/track", "/lg/lc", "/lg/pb", "/lg/runtime", "/lg/config", "/lg/px",
    "/api/track", "/preview/x", "/media/x", "/assets/public.js", "/lc/ad", "/lst-cand/id", "/v/x",
    "/lg/runtime/v1.js", "/lg/config/one", "/lg/pb/provider", "/lg/lc/offer", "/lg/px/token",
    "/article/news/", "/page/about/extra", "/tag/local/page/two", "/category/news/page/2/extra", "/other/path",
    "/%68ealth", "/lg/%61ttempt",
  ])("hands %s to Hono with its original URL, method and ordinary headers", async path => {
    const { serve, calls, honoFetch, ctx } = harness({ snap: () => new Response(null, { status: 404 }) });
    const request = visit(path + "?keep=1", { headers: { Cookie: "visitor=1", "x-public": "untouched" } });
    expect(await (await serve(request)).text()).toBe("live Hono");
    expect(honoFetch).toHaveBeenCalledExactlyOnceWith(request, env, ctx);
    expect(honoFetch.mock.calls[0]![0]).toBe(request);

    const marked = request.clone();
    marked.headers.set("X-CMS-Variant", "bot");
    marked.headers.set("X-CMS-Bookmark", "client");
    marked.headers.set("X-CMS-Tags", "client");
    marked.headers.set("X-CMS-Other", "private");
    expect(await (await serve(marked)).text()).toBe("live Hono");
    expect(honoFetch).toHaveBeenCalledTimes(2);
    const [live, liveEnv, liveCtx] = honoFetch.mock.calls[1]!;
    expect(liveEnv).toBe(env);
    expect(liveCtx).toBe(ctx);
    expect(live.url).toBe(request.url);
    expect(live.method).toBe(request.method);
    expect([...live.headers]).toEqual([...request.headers]);
    const attempt = decodeURI(path) === "/lg/attempt";
    expect(calls.map(call => call.props.variantKey)).toEqual(attempt ? ["snap", "snap"] : []);
  });

  it.each([
    new Request("https://CmS.Example./?keep=1"),
    visit("/lg", { method: "POST", body: "original body" }),
    visit("/article/news", { method: "PUT", body: "original body" }),
  ])("bypasses the cache for $method $url", async request => {
    const { serve, calls, honoFetch } = harness();
    expect(await (await serve(request)).text()).toBe("live Hono");
    expect(calls).toHaveLength(0);
    expect(honoFetch.mock.calls[0]![0]).toBe(request);

    const marked = request.clone();
    marked.headers.set("X-CMS-Variant", "human");
    marked.headers.set("X-CMS-Bookmark", "client");
    marked.headers.set("X-CMS-Tags", "client");
    expect(await (await serve(marked)).text()).toBe("live Hono");
    expect(calls).toHaveLength(0);
    const [live] = honoFetch.mock.calls[1]!;
    expect(live.url).toBe(request.url);
    expect(live.method).toBe(request.method);
    expect([...live.headers]).toEqual([...request.headers]);
    if (request.body) {
      expect(await request.text()).toBe("original body");
      expect(await live.text()).toBe("original body");
    }
  });

  it.each(["/__snap", "/__snap/", "/__snap/child", "/%5F_snap/child"])("keeps external %s private", async path => {
    const { serve, calls, honoFetch } = harness();
    const res = await serve(visit(path + "?debug=1"));
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe(privateControl);
    expect(calls).toHaveLength(0);
    expect(honoFetch).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", () => new Response(null, { status: 404 })],
    ["unavailable", () => new Response(null, { status: 503 })],
    ["invalid JSON", () => new Response("{")],
    ["incomplete", () => Response.json({ siteId: "site-a" })],
    ["wrong tenant", () => Response.json({ ...snapshot, hostname: "other.example", siteId: "site-b" })],
    ["inactive", () => Response.json({ ...snapshot, status: "disabled" })],
    ["binding failure", () => { throw new Error("unavailable"); }],
  ] as const)("uses Hono for a %s snapshot", async (_name, snap) => {
    const { serve, calls, honoFetch } = harness({ snap });
    const request = visit("/guide?utm_medium=live", { method: "HEAD", headers: { Cookie: "ko_sid=live" } });
    expect(await (await serve(request)).text()).toBe("live Hono");
    expect(calls).toHaveLength(1);
    expect(honoFetch.mock.calls[0]![0]).toBe(request);
  });

  it.each(["/guide", "/lg", "/lg/life"])("falls back when %s has a malformed selection", async path => {
    const { serve, calls, honoFetch } = harness({
      snap: () => Response.json({ ...snapshot, listicles: { guide: null }, leadgen: { "/lg": {}, life: null } }),
    });
    const request = visit(path);
    expect(await (await serve(request)).text()).toBe("live Hono");
    expect(calls).toHaveLength(1);
    expect(honoFetch.mock.calls[0]![0]).toBe(request);
  });

  it.each([
    ["server error", () => new Response(null, { status: 502 })],
    ["fetch rejection", () => Promise.reject(new Error("binding failed"))],
    ["live cookies from a stale selection", () => new Response(shell, { headers: { "Set-Cookie": "ko_sid=inner" } })],
    ["unreadable leadgen shell", () => new Response(new ReadableStream({ start(c) { c.error(new Error("body failed")); } }))],
  ] as const)("uses the original visitor request after %s", async (_name, render) => {
    const { serve, calls, honoFetch } = harness({ render });
    const request = visit("/lg?utm_source=paid", { headers: { Cookie: "ko_sid=original" } });
    expect(await (await serve(request)).text()).toBe("live Hono");
    expect(calls).toHaveLength(2);
    expect(honoFetch.mock.calls[0]![0]).toBe(request);
  });

  it("keeps internal headers out of the live renderer on a cached-path fallback", async () => {
    const { serve, honoFetch } = harness({ snap: () => new Response(null, { status: 404 }) });
    const request = visit("/guide?utm_source=live", {
      method: "HEAD", headers: { Cookie: "ko_sid=live", "x-cms-variant": "lst:forged", "x-cms-bookmark": "forged" },
    });
    await serve(request);
    const [live] = honoFetch.mock.calls[0]!;
    expect(live.url).toBe(request.url);
    expect(live.method).toBe("HEAD");
    expect([...live.headers]).toEqual([["cookie", "ko_sid=live"]]);
  });

  it("hands requests without a PublicPage binding to Hono and keeps app.request working", async () => {
    const { honoFetch } = harness();
    const request = visit("/page/news?keep=1");
    for (const ctx of [undefined, {} as ExecutionContext, testContext({})]) {
      expect(await (await gatewayFetch(request, env, ctx, honoFetch)).text()).toBe("live Hono");
      expect(honoFetch).toHaveBeenLastCalledWith(request, env, ctx);
    }
    const res = await worker.request(origin + "/health", {}, env);
    expect(await res.json()).toEqual({ ok: true, app: "kodigital-homepages-cms" });
  });

  it("runs the gateway through the default Worker fetch", async () => {
    const { ctx, calls } = harness();
    const res = await worker.fetch(visit("/article/news?keep=0"), env, ctx);
    expect(await res.text()).toBe(shell);
    expect(calls.map(c => c.props.variantKey)).toEqual(["snap", "human"]);
  });
});

it.skipIf(!hasSqlite)("drains due edge purges through the default Worker's scheduled handler", async () => {
  const db = createDb();
  try {
    const bindings = sqliteEnv(db);
    const tags = ["snap:site-a", "nf:site-a"];
    await bindings.DB.prepare("INSERT INTO cache_purge_log (action, status, payload) VALUES (?, ?, ?)")
      .bind("purge_tags_second", "pending", JSON.stringify({ tags, due_after: 0 })).run();
    const purgeTags = vi.fn().mockResolvedValue({ success: true, errors: [] });
    const exports: Cloudflare.Exports = { PublicPage: { purgeTags } };
    const ctx = testContext(exports);
    await worker.scheduled({} as ScheduledController, bindings, ctx);
    expect(purgeTags).toHaveBeenCalledExactlyOnceWith(tags);
    expect(db.prepare("SELECT status FROM cache_purge_log WHERE action = ?").all("purge_tags_second"))
      .toEqual([{ status: "completed" }]);
  } finally {
    db.close();
  }
});
