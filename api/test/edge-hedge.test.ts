import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EDGE_CACHE_CONTROL } from "../src/cache/cache-control";
import { gatewayFetch } from "../src/edge/gateway";
import * as snapshots from "../src/edge/snapshot";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import type { Env } from "../src/env";
import * as app from "../src/index";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";
import { ctxCapture } from "./helpers/leadgen-analytics-harness";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const origin = "https://news.example";
const site = { site_id: "news", hostname: "news.example", vertical_slug: "home", status: "active" };
const versions = { content_version: 7, settings_version: 2, write_bookmark: "publish-7" };
const version = { public_id: "ver_A", variant_label: "A", is_control: 1, traffic_allocation: 100 };
const snapshot: SiteSnapshot = {
  v: 1, siteId: site.site_id, hostname: site.hostname, verticalSlug: site.vertical_slug, status: site.status,
  contentVersion: 7, settingsVersion: 2, writeBookmark: versions.write_bookmark, timeZone: "", language: "",
  listicles: { guide: { listicleId: "list-7", publishedVersion: version, experiment: null } }, leadgen: {}, builtAt: 123,
};
const etag = '"edition-7"';
const html = '<html><head><script data-lst="selector"></script></head><body>Café 雪</body></html>';
const snapHit = () => Response.json(snapshot, { headers: { "cf-cache-status": "HIT" } });
const pageHit = () => new Response("cached page", { headers: {
  "cf-cache-status": "HIT", "Cache-Control": EDGE_CACHE_CONTROL.publicPage, "Content-Type": "text/html", ETag: etag,
} });
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function signal() {
  let fire!: () => void;
  const promise = new Promise<void>(resolve => { fire = resolve; });
  return { promise, fire };
}

type CacheFetch = (request: Request, props: PublicPageProps) => Response | Promise<Response>;

function fixture(hedgeMs?: string) {
  const { db } = makeFakeDb([{ match: "FROM domains", row: site }], [
    { match: "FROM domains", rows: [site] },
    { match: "FROM sites WHERE", rows: [versions] },
    { match: "FROM listicle_articles", rows: [{ ...version, slug: "guide", listicle_id: "list-7", experiment_id: null }] },
  ]);
  const withSession = vi.fn((_anchor?: string): D1DatabaseSession => ({
    prepare: query => db.prepare(query),
    batch: <T>(stmts: D1PreparedStatement[]) => Promise.all(stmts.map(stmt => stmt.all<T>())),
    getBookmark: () => versions.write_bookmark,
  }));
  db.withSession = withSession;
  const env: Env = { ...buildEnv(db), EDGE_HEDGE_MS: hedgeMs, PERFSTAGE: "true" };
  const { ctx, promises } = ctxCapture();
  const snap = vi.fn<CacheFetch>(snapHit);
  const page = vi.fn<CacheFetch>(pageHit);
  const snapStarted = signal();
  const pageStarted = signal();
  Object.assign(ctx, { exports: { PublicPage: ({ props }: { props: PublicPageProps }) => ({
    async fetch(request: Request) {
      if (props.variantKey === "snap") {
        snapStarted.fire();
        return snap(request, props);
      }
      pageStarted.fire();
      return page(request, props);
    },
  }) } });
  const render = vi.spyOn(app, "honoFetch").mockImplementation(() => new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", ETag: etag, "X-Content-Type-Options": "nosniff" },
  }));
  const fallback = vi.fn<Parameters<typeof gatewayFetch>[3]>(() => new Response("live page"));
  const visit = (path = "/article/story", init?: RequestInit) =>
    gatewayFetch(new Request(origin + path, init), env, ctx, fallback);
  async function pageMiss(request: Request, props: PublicPageProps) {
    const response = await new app.PublicPage({ ...ctx, props }, env).fetch(request);
    response.headers.set("cf-cache-status", "MISS");
    return response;
  }
  return { visit, env, snap, snapStarted, page, pageStarted, pageMiss, promises, render, withSession, fallback };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  // Hold visitor attribution fixed and keep the independent sampled KV counter out of waitUntil.
  vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
  vi.spyOn(Math, "random").mockReturnValue(0.9);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("returns 5 ms snapshot and page HITs without starting either direct build", async () => {
  const { visit, snap, snapStarted, page, pageStarted, render, withSession, promises } = fixture();
  snap.mockImplementation(async () => { await delay(5); return snapHit(); });
  page.mockImplementation(async () => { await delay(5); return pageHit(); });
  const pending = visit();
  await snapStarted.promise;
  await vi.advanceTimersByTimeAsync(5);
  await pageStarted.promise;
  await vi.advanceTimersByTimeAsync(5);
  const response = await pending;
  expect(response.headers.get("x-edge-cache")).toBe("HIT");
  expect(response.headers.get("Server-Timing")).not.toContain("gw-hedge");
  expect(await response.text()).toBe("cached page");
  await vi.advanceTimersByTimeAsync(300);
  expect(render).not.toHaveBeenCalled();
  expect(withSession).not.toHaveBeenCalled();
  expect(promises).toHaveLength(0);
});

it("returns identical MISS bytes, headers and visitor cookies at 50 ms and keeps the 300 ms cache fetch alive through EOF", async () => {
  const { visit, page, pageStarted, pageMiss, promises, render, withSession, fallback } = fixture();
  const tail = signal();
  const reading = signal();
  page.mockImplementationOnce(async (request, props) => {
    await delay(300);
    const miss = await pageMiss(request, props);
    const bytes = await miss.bytes();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        reading.fire();
        controller.enqueue(bytes);
        await tail.promise;
        controller.close();
      },
    }, { highWaterMark: 0 });
    return new Response(body, miss);
  }).mockImplementationOnce(pageMiss);
  const requestGuide = () => visit("/guide?utm_source=visitor", { headers: {
    Cookie: "ko_sid=returning-reader", "If-None-Match": '"old"', "x-cms-bookmark": "forged",
    "x-cms-site-context": "forged", "x-cms-variant": "bot",
  } });

  const pending = requestGuide();
  await pageStarted.promise;
  await vi.advanceTimersByTimeAsync(49);
  expect(render).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  const direct = await pending;
  expect(direct.headers.get("x-edge-cache")).toBe("MISS");
  expect(direct.headers.get("Server-Timing")).toContain('gw-hedge;desc="direct"');
  expect(direct.headers.get("ETag")).toBe(etag);
  expect(direct.headers.getSetCookie()).toHaveLength(2);
  expect(render).toHaveBeenCalledOnce();
  expect(promises).toHaveLength(1);
  const finished = vi.fn();
  const fill = Promise.all(promises).then(finished);
  await vi.advanceTimersByTimeAsync(250);
  await reading.promise;
  expect(finished).not.toHaveBeenCalled();
  tail.fire();
  await fill;
  expect(render).toHaveBeenCalledTimes(2);
  expect(withSession.mock.calls).toEqual([["publish-7"], ["publish-7"]]);

  const [local] = render.mock.calls[0]!;
  const [cached] = render.mock.calls[1]!;
  for (const request of [local, cached]) {
    expect([request.url, request.method, request.redirect]).toEqual([origin + "/guide", "GET", "manual"]);
    expect(request.headers.get("x-cms-variant")).toBe("lst:ver_A");
    expect(request.headers.get("x-cms-bookmark")).toBe("publish-7");
    expect(request.headers.get("x-cms-snap-version")).toMatch(/^[a-f0-9]{64}$/);
    expect(request.headers.get("x-cms-site-context")).toBe(JSON.stringify({
      ...site, content_version: 7, settings_version: 2,
    }));
    expect(request.headers.has("Cookie")).toBe(false);
  }
  expect([...local.headers]).toEqual([...cached.headers]);
  const miss = await requestGuide();
  expect([direct.status, direct.statusText]).toEqual([miss.status, miss.statusText]);
  expect(miss.headers.get("Server-Timing")).not.toContain("gw-hedge");
  const headers = (response: Response) => [...response.headers].filter(([name]) => name !== "server-timing");
  expect(headers(direct)).toEqual(headers(miss));
  expect(direct.headers.getSetCookie()).toEqual(miss.headers.getSetCookie());
  const bytes = await direct.bytes();
  expect(new TextDecoder().decode(bytes)).toContain('"utm_source":"visitor"');
  expect(bytes).toEqual(await miss.bytes());
  expect(fallback).not.toHaveBeenCalled();
});

it("returns a late cache HIT and releases the direct body when the cache wins the hedge", async () => {
  const { visit, page, pageStarted, render, promises } = fixture();
  const cancel = vi.fn();
  render.mockImplementation(async () => {
    await delay(100);
    return new Response(new ReadableStream<Uint8Array>({ cancel }));
  });
  page.mockImplementation(async () => { await delay(70); return pageHit(); });
  const pending = visit();
  await pageStarted.promise;
  await vi.advanceTimersByTimeAsync(70);
  const response = await pending;
  expect(render).toHaveBeenCalledOnce();
  expect(response.headers.get("x-edge-cache")).toBe("HIT");
  expect(response.headers.get("Server-Timing")).toContain('gw-hedge;desc="cache"');
  expect(await response.text()).toBe("cached page");
  await vi.advanceTimersByTimeAsync(80);
  await Promise.all(promises);
  expect(cancel).toHaveBeenCalledOnce();
});

it("waits for the cached answer when the direct render throws", async () => {
  const { visit, page, pageStarted, render, fallback } = fixture();
  page.mockImplementation(async () => { await delay(300); return pageHit(); });
  render.mockImplementation(() => { throw new Error("direct failed"); });
  const pending = visit();
  await pageStarted.promise;
  await vi.advanceTimersByTimeAsync(50);
  expect(render).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(250);
  const response = await pending;
  expect(response.headers.get("Server-Timing")).toContain('gw-hedge;desc="cache"');
  expect(await response.text()).toBe("cached page");
  expect(fallback).not.toHaveBeenCalled();
});

it("uses the original visitor request for live fallback if both builds fail", async () => {
  const { visit, page, pageStarted, render, fallback } = fixture();
  page.mockImplementation(async () => { await delay(75); throw new Error("cache failed"); });
  render.mockRejectedValue(new Error("direct failed"));
  const pending = visit("/article/story?from=ad", { headers: { Cookie: "ko_sid=reader" } });
  await pageStarted.promise;
  await vi.advanceTimersByTimeAsync(75);
  expect(await (await pending).text()).toBe("live page");
  expect(fallback).toHaveBeenCalledOnce();
  const [visitor] = fallback.mock.calls[0]!;
  expect(visitor.url).toBe(origin + "/article/story?from=ad");
  expect(visitor.headers.get("Cookie")).toBe("ko_sid=reader");
});

it("hedges a slow snapshot on the raw first-primary binding and forwards the same tenant, version and bookmark", async () => {
  const { visit, snap, snapStarted, page, env, render, promises, withSession } = fixture();
  const build = vi.spyOn(snapshots, "buildSiteSnapshot");
  const cached = snapHit();
  snap.mockImplementationOnce(async () => { await delay(300); return cached; });
  const pending = visit();
  await snapStarted.promise;
  await vi.advanceTimersByTimeAsync(49);
  expect(build).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  const response = await pending;
  expect(response.headers.get("Server-Timing")).toMatch(/gw-snap;dur=\d+;desc="MISS", gw-hedge;desc="direct"/);
  expect(response.headers.get("x-edge-cache")).toBe("HIT");
  expect(await response.text()).toBe("cached page");
  expect(build.mock.calls[0]![0].DB).toBe(env.DB);
  expect(withSession.mock.calls).toEqual([["first-primary"]]);
  expect(render).not.toHaveBeenCalled();
  expect(promises).toHaveLength(1);
  expect(cached.bodyUsed).toBe(false);
  await vi.advanceTimersByTimeAsync(250);
  await Promise.all(promises);
  expect(cached.bodyUsed).toBe(true);
  await visit();
  const [first, firstProps] = page.mock.calls[0]!;
  const [repeat, repeatProps] = page.mock.calls[1]!;
  expect(firstProps).toEqual({ siteKey: site.site_id, variantKey: "human" });
  expect(firstProps).toEqual(repeatProps);
  expect(first.headers.get("x-cms-bookmark")).toBe(versions.write_bookmark);
  expect([...first.headers]).toEqual([...repeat.headers]);
});

it("uses the cached snapshot when the direct primary read fails", async () => {
  const { visit, snap, snapStarted, withSession, fallback } = fixture();
  withSession.mockImplementation(() => { throw new Error("primary unavailable"); });
  snap.mockImplementation(async () => { await delay(300); return snapHit(); });
  const pending = visit();
  await snapStarted.promise;
  await vi.advanceTimersByTimeAsync(300);
  const response = await pending;
  expect(withSession.mock.calls).toEqual([["first-primary"]]);
  expect(response.headers.get("Server-Timing")).toMatch(/gw-snap;dur=\d+;desc="HIT", gw-hedge;desc="cache"/);
  expect(await response.text()).toBe("cached page");
  expect(fallback).not.toHaveBeenCalled();
});

it("keeps both hedges disabled at zero despite client headers and query parameters", async () => {
  const { visit, env, snap, snapStarted, page, pageStarted, withSession, render } = fixture("0");
  delete env.PERFSTAGE;
  snap.mockImplementation(async () => { await delay(300); return snapHit(); });
  page.mockImplementation(async () => { await delay(300); return pageHit(); });
  const pending = visit("/article/story?EDGE_HEDGE_MS=1", { headers: {
    EDGE_HEDGE_MS: "1", "x-cms-hedge-ms": "1", "x-edge-hedge-ms": "1", "x-perfstage-direct": "1",
  } });
  await snapStarted.promise;
  await vi.advanceTimersByTimeAsync(300);
  await pageStarted.promise;
  await vi.advanceTimersByTimeAsync(300);
  const response = await pending;
  expect(response.headers.get("x-edge-cache")).toBe("HIT");
  expect(response.headers.get("Server-Timing")).toBe('edge;desc="HIT"');
  expect(withSession).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
});

it("honors the configured delay when the client asks to disable hedging", async () => {
  const { visit, page, pageStarted, render, promises } = fixture("80");
  page.mockImplementation(async () => { await delay(300); throw new Error("late cache failure"); });
  const pending = visit("/article/story?EDGE_HEDGE_MS=0", { headers: {
    EDGE_HEDGE_MS: "0", "x-cms-hedge-ms": "0", "x-edge-hedge-ms": "0",
  } });
  await pageStarted.promise;
  await vi.advanceTimersByTimeAsync(79);
  expect(render).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  const response = await pending;
  expect(response.headers.get("x-edge-cache")).toBe("MISS");
  expect(response.headers.get("Server-Timing")).toContain('gw-hedge;desc="direct"');
  expect(await response.text()).toBe(html);
  await vi.advanceTimersByTimeAsync(220);
  await Promise.all(promises);
});

it("keeps HEAD on the cache path even for slow snapshot and page responses", async () => {
  const { visit, snap, snapStarted, page, pageStarted, render, withSession } = fixture();
  snap.mockImplementation(async () => { await delay(300); return snapHit(); });
  page.mockImplementation(async () => { await delay(300); return pageHit(); });
  const pending = visit("/article/story", { method: "HEAD" });
  await snapStarted.promise;
  await vi.advanceTimersByTimeAsync(300);
  await pageStarted.promise;
  await vi.advanceTimersByTimeAsync(300);
  const response = await pending;
  expect(response.body).toBeNull();
  expect(response.headers.get("ETag")).toBe(etag);
  expect(response.headers.get("Server-Timing")).not.toContain("gw-hedge");
  expect(render).not.toHaveBeenCalled();
  expect(withSession).not.toHaveBeenCalled();
});

it("never hedges runtime routes, including their snapshot lookup, or a request without a context", async () => {
  const { visit, snap, snapStarted, page, render, withSession, fallback, env } = fixture();
  snap.mockImplementation(async () => { await delay(300); return snapHit(); });
  const attempt = visit("/lg/attempt");
  await snapStarted.promise;
  await vi.advanceTimersByTimeAsync(300);
  expect(await (await attempt).text()).toBe("live page");
  expect(fallback.mock.calls[0]![0].headers.get("x-cms-bookmark")).toBe(versions.write_bookmark);
  await visit("/lg/track", { method: "POST" });
  await gatewayFetch(new Request(origin + "/article/story"), env, undefined, fallback);
  expect(fallback).toHaveBeenCalledTimes(3);
  expect(snap).toHaveBeenCalledOnce();
  expect(page).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
  expect(withSession).not.toHaveBeenCalled();
});
