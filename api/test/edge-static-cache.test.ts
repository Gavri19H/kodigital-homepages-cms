import { afterEach, describe, expect, it, vi } from "vitest";
import { LEADGEN_TEMPLATE_VERSION } from "../src/cache/cache-keys";
import { gatewayFetch } from "../src/edge/gateway";
import { serveStatic } from "../src/edge/static-cache";
import type { Env } from "../src/env";
import worker from "../src/index";
import { publicCss } from "../src/public/assets/public-css";
import { publicJs } from "../src/public/assets/public-js";
import { renderLayout } from "../src/public/templates/layout";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";

const origin = "https://tenant.example";
const immutable = "public, max-age=31536000, immutable";
const { db, calls: siteQueries } = makeFakeDb();
const env: Env = { ...buildEnv(db), ADMIN_HOST: "cms.example" };

function installCache() {
  const entries = new Map<string, Response>();
  const match = vi.fn<Cache["match"]>(async key => entries.get(new Request(key).url)?.clone());
  const put = vi.fn<Cache["put"]>(async (key, response) => {
    entries.set(new Request(key).url, response);
  });
  vi.stubGlobal("caches", { default: { match, put } });
  const ctx = {
    waitUntil: vi.fn<(promise: Promise<unknown>) => void>(),
    props: {}, exports: {}, passThroughOnException() {},
    get tracing(): never { throw new Error("Unexpected tracing access"); },
  } satisfies ExecutionContext;
  return { match, put, ctx };
}

function file(body: string): Response {
  return new Response(body, { headers: { "Cache-Control": immutable, ETag: '"asset"', "Content-Length": String(body.length) } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  expect(siteQueries.splice(0)).toEqual([]);
});

describe("version-independent static cache", () => {
  it("returns a MISS while the independent cache copy is still being written", async () => {
    const { match, put, ctx } = installCache();
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    put.mockReturnValueOnce(pending);
    const upstream = file("photo");
    const honoFetch = vi.fn(() => upstream);
    const key = origin + "/media/upload/photo.jpg";
    const request = new Request(key + "?campaign=first");
    const response = await serveStatic(request, env, ctx, honoFetch);
    expect(response!.headers.get("x-edge-cache")).toBe("MISS");
    expect(response!.headers.get("ETag")).toBe('"asset"');
    expect(await response!.text()).toBe("photo");
    expect(honoFetch).toHaveBeenCalledExactlyOnceWith(request, env, ctx);
    expect(new Request(match.mock.calls[0]![0]).url).toBe(key);
    expect(ctx.waitUntil).toHaveBeenCalledExactlyOnceWith(pending);
    const [writeKey, copy] = put.mock.calls[0]!;
    expect(new Request(writeKey).url).toBe(key);
    expect(copy).not.toBe(upstream);
    expect(copy.headers.has("x-edge-cache")).toBe(false);
    expect(await copy.text()).toBe("photo");
    finish();
  });

  it("fills a cold HEAD with the complete file and serves GET and HEAD across query strings", async () => {
    const { put, ctx } = installCache();
    const key = origin + "/media/photo.png";
    const mediaEnv = buildEnv(db);
    const readObject = vi.fn(async () => ({
      body: new Response("photo").body, httpEtag: '"photo"', size: 5, httpMetadata: { contentType: "image/png" },
    }));
    Object.assign(mediaEnv.MEDIA, { get: readObject });
    const first = await worker.fetch(new Request(key + "?a", { method: "HEAD" }), mediaEnv, ctx);
    expect(first.headers.get("x-edge-cache")).toBe("MISS");
    expect(first.headers.get("Cache-Control")).toBe(immutable);
    expect(first.headers.get("Content-Length")).toBe("5");
    expect(first.body).toBeNull();
    await ctx.waitUntil.mock.calls[0]![0];
    const get = await worker.fetch(new Request(key + "?b"), mediaEnv, ctx);
    expect(get.headers.get("x-edge-cache")).toBe("HIT");
    expect(get.headers.get("Content-Type")).toBe("image/png");
    expect(get.headers.get("ETag")).toBe('"photo"');
    expect(await get.text()).toBe("photo");
    const head = await worker.fetch(new Request(key, { method: "HEAD" }), mediaEnv, ctx);
    expect(head.headers.get("x-edge-cache")).toBe("HIT");
    expect(head.headers.get("Content-Length")).toBe("5");
    expect(head.body).toBeNull();
    expect(readObject).toHaveBeenCalledExactlyOnceWith("photo.png");
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("passes validators to the Cache API and returns its 304 hit", async () => {
    const { match, put, ctx } = installCache();
    match.mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"asset"' } }));
    const honoFetch = vi.fn();
    const response = await serveStatic(new Request(origin + "/media/image.png?v=2", {
      headers: { "If-None-Match": '"asset"' },
    }), env, ctx, honoFetch);
    const key = new Request(match.mock.calls[0]![0]);
    expect(key.url).toBe(origin + "/media/image.png");
    expect(key.headers.get("If-None-Match")).toBe('"asset"');
    expect(response!.status).toBe(304);
    expect(response!.headers.get("x-edge-cache")).toBe("HIT");
    expect(response!.body).toBeNull();
    expect(honoFetch).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it.each([
    [404, immutable, null], [500, immutable, null], [206, immutable, null], [304, immutable, null],
    [200, "public, max-age=86400", null], [200, "public, x-immutable", null],
    [200, "private, immutable", null], [200, "no-store, immutable", null], [200, immutable, "id=private"],
  ] as const)("leaves the cache empty for %i, %s, cookie %s", async (status, control, cookie) => {
    const { ctx, put } = installCache();
    const headers = new Headers({ "Cache-Control": control });
    if (cookie) headers.set("Set-Cookie", cookie);
    const body = status === 304 ? null : "origin response";
    const response = await serveStatic(new Request(origin + "/lg/runtime/1.js"), env, ctx,
      () => new Response(body, { headers, status }));
    expect(response!.status).toBe(status);
    expect(response!.headers.get("Set-Cookie")).toBe(cookie);
    expect(response!.headers.get("x-edge-cache")).toBe("MISS");
    expect(await response!.text()).toBe(body ?? "");
    expect(put).not.toHaveBeenCalled();
    expect(ctx.waitUntil).not.toHaveBeenCalled();
  });

  it("ignores legacy URLs, non-static paths, writes and the admin host", async () => {
    const { ctx, match } = installCache();
    const honoFetch = vi.fn();
    for (const request of [
      new Request(origin + "/assets/public.css?v=old"), new Request(origin + "/assets/public.js"),
      new Request(origin + "/assets/public.a.css/other"), new Request(origin + "/lg/track"),
      new Request(origin + "/article/news"), new Request(origin + "/media/photo.png", { method: "POST" }),
      new Request("https://cms.example/media/photo.png"),
    ]) {
      expect(await serveStatic(request, env, ctx, honoFetch)).toBeNull();
    }
    expect(match).not.toHaveBeenCalled();
    expect(honoFetch).not.toHaveBeenCalled();
  });

  it("falls through to Hono when the Cache API is missing or its lookup fails", async () => {
    const { ctx, match } = installCache();
    const request = new Request(origin + "/media/photo.png?original");
    const honoFetch = vi.fn(() => file("photo"));
    match.mockRejectedValueOnce(new Error("cache unavailable"));
    expect(await (await gatewayFetch(request, env, ctx, honoFetch)).text()).toBe("photo");
    vi.stubGlobal("caches", undefined);
    expect(await serveStatic(request, env, ctx, honoFetch)).toBeNull();
    expect(honoFetch).toHaveBeenCalledExactlyOnceWith(request, env, ctx);
    expect(await (await gatewayFetch(request, env, ctx, honoFetch)).text()).toBe("photo");
    expect(honoFetch).toHaveBeenCalledTimes(2);
  });
});

describe("public files through the gateway", () => {
  it.each([
    ["css", /href="(\/assets\/public\.[a-z0-9]+\.css)"/, "text/css", publicCss],
    ["js", /src="(\/assets\/public\.[a-z0-9]+\.js)" defer/, "text/javascript", publicJs],
  ] as const)("serves the layout's hashed %s and its legacy URL with their respective lifetimes", async (ext, pattern, type, body) => {
    const { ctx, put } = installCache();
    const html = renderLayout({ site: { name: "Test", hostname: "tenant.example" }, meta: { title: "Test" }, body: "" });
    const path = html.match(pattern)?.[1];
    expect(path).toBeDefined();
    const request = (suffix: string) => worker.fetch(new Request(origin + suffix), env, ctx);
    const fresh = await request(path!);
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("x-edge-cache")).toBe("MISS");
    expect(fresh.headers.get("Cache-Control")).toBe(immutable);
    expect(fresh.headers.get("Content-Type")).toBe(type + "; charset=utf-8");
    expect(await fresh.text()).toBe(body);
    await ctx.waitUntil.mock.calls[0]![0];
    const warm = await request(path + "?another-visit");
    expect(warm.headers.get("x-edge-cache")).toBe("HIT");
    expect(await warm.text()).toBe(body);
    const legacy = await request("/assets/public." + ext + "?v=old");
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(legacy.headers.get("Content-Type")).toBe(type + "; charset=utf-8");
    expect(await legacy.text()).toBe(body);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("serves a previous release's bytes only on the host that cached them", async () => {
    const { ctx, put } = installCache();
    const path = "/assets/public.oldhash.js";
    const oldOrigin = vi.fn(() => file("previous release"));
    await gatewayFetch(new Request(origin + path), env, ctx, oldOrigin);
    await ctx.waitUntil.mock.calls[0]![0];
    const old = await worker.fetch(new Request(origin + path + "?v=previous"), env, ctx);
    expect(old.headers.get("x-edge-cache")).toBe("HIT");
    expect(await old.text()).toBe("previous release");
    const cold = await worker.fetch(new Request("https://other.example" + path), env, ctx);
    expect(cold.status).toBe(404);
    expect(cold.headers.get("Cache-Control")).toBe("no-store");
    expect(cold.headers.get("x-edge-cache")).toBe("MISS");
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("keeps the versioned quote runtime at the edge after the first origin request", async () => {
    const { ctx } = installCache();
    const { db } = makeFakeDb([{ match: "FROM domains d INNER JOIN sites", row: {
      site_id: "site-a", hostname: "tenant.example", status: "active",
    } }]);
    const url = origin + "/lg/runtime/" + LEADGEN_TEMPLATE_VERSION + ".js";
    const fresh = await worker.fetch(new Request(url), buildEnv(db), ctx);
    expect(fresh.status).toBe(200);
    expect(fresh.headers.get("x-edge-cache")).toBe("MISS");
    expect(fresh.headers.get("Cache-Control")).toBe(immutable);
    await ctx.waitUntil.mock.calls[0]![0];
    const hit = await worker.fetch(new Request(url), env, ctx);
    expect(hit.headers.get("x-edge-cache")).toBe("HIT");
    expect(await hit.text()).toBe(await fresh.text());
  });
});
