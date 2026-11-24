import { afterEach, expect, it, onTestFinished, vi } from "vitest";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import type { Env } from "../src/env";
import worker, * as app from "../src/index";
import { ctxCapture } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv } from "./helpers/x06-a2-sqlite";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

afterEach(() => vi.restoreAllMocks());

const snapshot: SiteSnapshot = {
  v: 1, siteId: "news", hostname: "news.example", status: "active", writeBookmark: "published-7",
  contentVersion: 7, settingsVersion: 1, timeZone: "UTC", language: "en", builtAt: 123, listicles: {}, leadgen: {},
};
const headline = "Café in the snow";
const path = "/article/story";

function fixture(perfstage: string | undefined) {
  const sql = createDb();
  const { ctx, promises } = ctxCapture();
  onTestFinished(async () => {
    await Promise.all(promises);
    sql.close();
  });
  addSite(sql, snapshot.siteId, "News", "home");
  sql.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(snapshot.siteId, snapshot.hostname);
  sql.prepare(`INSERT INTO articles (site_id, slug, title, content_json, status, published_at)
    VALUES (?, ?, ?, '{"blocks":[]}', 'published', 100)`).run(snapshot.siteId, "story", headline);
  const env = { ...sqliteEnv(sql), PERFSTAGE: perfstage, APP_ENV: perfstage === "true" ? "perfstage" : "production" };

  // Keep the host snapshot warm in both runs. Only page misses cross the binding into the real renderer.
  const entries = new Map<string, Response>();
  const put = vi.spyOn(entries, "set");
  const binding = vi.fn(({ props }: { props: PublicPageProps }) => ({
    async fetch(request: Request) {
      if (props.variantKey === "snap") return Response.json(snapshot, { headers: { "cf-cache-status": "HIT" } });
      const key = JSON.stringify([props, request.url]);
      const stored = entries.get(key);
      const response = stored?.clone() ?? await new app.PublicPage({ ...ctx, props }, env).fetch(request);
      if (!stored && response.headers.get("Cache-Control")?.startsWith("public,")) entries.set(key, response.clone());
      response.headers.set("cf-cache-status", stored ? "HIT" : "MISS");
      return response;
    },
  }));
  Object.assign(ctx, { exports: { PublicPage: binding } });
  const render = vi.spyOn(app, "honoFetch");
  function visit(direct?: string, accept = "text/html") {
    const host = perfstage === "true" ? "perfstage.workers.dev" : snapshot.hostname;
    const headers = new Headers({
      Host: host, Accept: accept, Cookie: "ko_sid=reader", "If-None-Match": '"old"',
      "x-cms-bookmark": "visitor", "x-cms-variant": "visitor", "x-cms-snap-version": "visitor",
    });
    if (host !== snapshot.hostname) headers.set("x-perfstage-host", snapshot.hostname);
    if (direct !== undefined) headers.set("x-perfstage-direct", direct);
    return worker.fetch(new Request(`https://${host}${path}?utm_source=probe`, { headers }), env, ctx);
  }
  return { visit, put, render, binding, sql };
}

it.each([["text/html", "human"], ["text/markdown", "md"]])(
  "builds the same %s article in-process without reading or populating the page cache", async (accept, variant) => {
    const { visit, put, render, binding, sql } = fixture("true");
    const direct = await visit("1", accept);
    expect(direct.status).toBe(200);
    expect(direct.headers.get("x-edge-cache")).toBe("DIRECT");
    expect(direct.headers.get("Cache-Control")).toBe("private, no-store");
    const timing = direct.headers.get("Server-Timing");
    expect(timing).toMatch(/gw-snap;dur=\d+;desc="HIT"/);
    expect(timing).toMatch(/gw-direct;dur=\d+/);
    expect(timing).toMatch(/\bbuild;dur=\d+/);
    expect(timing).toMatch(/\bd1;dur=\d+;desc="rounds=[1-9]\d* calls=[1-9]\d* /);
    expect(timing).not.toContain("gw-inner");
    expect(binding.mock.calls.map(([{ props }]) => props.variantKey)).toEqual(["snap"]);
    expect(put).not.toHaveBeenCalled();

    const miss = await visit(undefined, accept);
    expect(miss.headers.get("x-edge-cache")).toBe("MISS");
    const bytes = await miss.bytes();
    expect(new TextDecoder().decode(bytes)).toContain(headline);
    expect(await direct.bytes()).toEqual(bytes);
    expect(render).toHaveBeenCalledTimes(2);
    const [directRequest] = render.mock.calls[0]!;
    const [cachedRequest] = render.mock.calls[1]!;
    expect([directRequest.url, directRequest.method, directRequest.redirect]).toEqual([
      "https://news.example/article/story", "GET", "manual",
    ]);
    expect([...directRequest.headers]).toEqual([...cachedRequest.headers]);
    expect(directRequest.headers.get("x-cms-variant")).toBe(variant);
    expect(directRequest.headers.get("x-cms-bookmark")).toBe(snapshot.writeBookmark);
    expect(directRequest.headers.get("x-cms-snap-version")).toMatch(/^[0-9a-f]{64}$/);
    expect(directRequest.headers.has("x-perfstage-direct")).toBe(false);
    expect(directRequest.headers.has("Cookie")).toBe(false);

    // Leave the warm entry in place so a cache read or overwrite would be visible.
    sql.prepare("UPDATE articles SET title = ? WHERE site_id = ? AND slug = ?").run("New edition", snapshot.siteId, "story");
    const fresh = await visit("1", accept);
    expect(fresh.headers.get("x-edge-cache")).toBe("DIRECT");
    expect(await fresh.text()).toContain("New edition");
    const hit = await visit(undefined, accept);
    expect(hit.headers.get("x-edge-cache")).toBe("HIT");
    expect(await hit.bytes()).toEqual(bytes);
    expect(put).toHaveBeenCalledTimes(1);
  },
);

it.each([
  ["production with the header", undefined, "1"], ["a nonliteral PERFSTAGE value", "TRUE", "1"],
  ["perfstage without the header", "true", undefined], ["perfstage with a different header value", "true", "0"],
] as const)("uses the normal Workers Cache path for %s", async (_label, perfstage, direct) => {
  const { visit, put, render } = fixture(perfstage);
  for (const status of ["MISS", "HIT"]) {
    const response = await visit(direct);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-edge-cache")).toBe(status);
    expect(response.headers.get("Cache-Control")).toMatch(/^public,/);
    expect(response.headers.get("Server-Timing")).toMatch(/gw-inner;dur=\d+/);
    expect(response.headers.get("Server-Timing")).not.toContain("gw-direct");
    expect(await response.text()).toContain(headline);
  }
  expect(render).toHaveBeenCalledOnce();
  expect(render.mock.calls[0]![0].headers.has("x-perfstage-direct")).toBe(false);
  expect(put).toHaveBeenCalledOnce();
});
