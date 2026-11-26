import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SEED_EPOCH, SEED_HOSTNAME, SEED_SITE_ID } from "../scripts/seed/seed-fixture";
import { buildSeedSql } from "../scripts/seed/seed-sql";
import { recordEdgeCacheStatus } from "../src/cache/cache-stats";
import { computeEtag } from "../src/cache/edge-cache";
import { gatewayFetch } from "../src/edge/gateway";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import { VITALS_BEACON } from "../src/edge/vitals";
import type { Env } from "../src/env";
import { honoFetch } from "../src/index";
import { buildLeadgenEnv, d1FromSqlite, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { createDb, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("../src/cache/cache-stats", { spy: true });

const origin = `https://${SEED_HOSTNAME}`;
const endpoint = origin + "/v/vitals";
const unknownEndpoint = "https://unregistered.example/v/vitals";
const snapshot: SiteSnapshot = {
  v: 1, siteId: SEED_SITE_ID, hostname: SEED_HOSTNAME, status: "active", contentVersion: 1, settingsVersion: 1,
  writeBookmark: null, timeZone: null, language: null, builtAt: SEED_EPOCH * 1000, listicles: {}, leadgen: {},
};
let sqlite: SqliteDb;
let env: Env;

beforeAll(() => {
  sqlite = createDb(); // Applies the actual migrations.
  (sqlite.exec as (sql: string) => void)(buildSeedSql());
  const db = d1FromSqlite(sqlite);
  db.batch = <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(stmt => stmt.all<T>()));
  env = buildLeadgenEnv(db, makeKvStub().kv, {
    extra: { EDGE_INNER: "1", DEV_BYPASS_AUTH: "true", CF_VERSION_METADATA: { id: "test-worker" } },
  });
});
afterAll(() => sqlite.close());

function gateway(snap: () => Response = () => Response.json(snapshot), bindings = env) {
  const calls: { props: PublicPageProps; request: Request }[] = [];
  const work: Promise<unknown>[] = [];
  const ctx: ExecutionContext = {
    props: {}, waitUntil(p) { work.push(p); }, passThroughOnException() {},
    get tracing(): never { throw new Error("unexpected tracing"); },
    exports: {
      PublicPage: ({ props }: { props: PublicPageProps }) => ({
        async fetch(request: Request) {
          calls.push({ props, request });
          return props.variantKey === "snap" ? snap() : new Response(null, { headers: { "cf-cache-status": "HIT" } });
        },
      }),
    },
  };
  const fallback = vi.fn(() => new Response("live fallback"));
  const serve = (request: Request) => gatewayFetch(request, bindings, ctx, fallback);
  return { calls, work, ctx, fallback, serve };
}

function post(body: string, headers?: HeadersInit): Request {
  return new Request(endpoint, { method: "POST", body, headers });
}
const rows = () => sqlite.prepare("SELECT * FROM vitals_samples ORDER BY id").all();

describe("uncached vitals ingestion", () => {
  const sampleBody = '{"page_type":"home","cls":0}';
  const clientIp = "203.0.113.7";

  beforeEach(() => {
    sqlite.prepare("DELETE FROM vitals_samples").run();
    vi.clearAllMocks();
  });

  it("indexes the alarm reader's site and time range and constrains page types and edge outcomes", () => {
    expect(sqlite.prepare("PRAGMA index_info('idx_vitals_samples_site_created')").all())
      .toMatchObject([{ name: "site_id" }, { name: "created_at" }]);
    expect(() => sqlite.prepare("INSERT INTO vitals_samples (created_at, site_id, page_type) VALUES (?, ?, ?)")
      .run(1, SEED_SITE_ID, "unknown-type")).toThrow(/CHECK constraint/);
    expect(() => sqlite.prepare("INSERT INTO vitals_samples (created_at, site_id, page_type, edge) VALUES (?, ?, ?, ?)")
      .run(1, SEED_SITE_ID, "home", "EXPIRED")).toThrow(/CHECK constraint/);
  });

  it.each(["HIT", "MISS"])("reads only the host snapshot and inserts the reported %s with edge-owned dimensions", async edge => {
    const { serve, calls, work, fallback } = gateway();
    const metrics = { ttfb_ms: 0.5, fcp_ms: 124.5, lcp_ms: 60_000, inp_ms: 16, cls: 5 };
    const request = post(JSON.stringify({ page_type: "quote", edge, ...metrics,
      site_id: "different-site", country: "AU", worker_version: "other", created_at: 1, device: "tablet", client_key: "forged",
    }), { "x-cms-site-id": "header-site", "CF-IPCountry": "CA", "X-Forwarded-Host": "other.example" });
    const before = Math.floor(Date.now() / 1000);
    const prepare = vi.spyOn(env.DB, "prepare");
    try {
      const response = await serve(Object.assign(request, { cf: { country: "GB" } }));
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.has("x-edge-cache")).toBe(false);
      expect(fallback).not.toHaveBeenCalled();
      expect(recordEdgeCacheStatus).not.toHaveBeenCalled();
      expect(calls.map(({ props, request: req }) => [props, req.method, req.url, [...req.headers]]))
        .toEqual([[{ siteKey: "host:" + SEED_HOSTNAME, variantKey: "snap" }, "GET", origin + "/__snap", []]]);
      expect(work).toHaveLength(1);
      await Promise.all(work);
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(rows()).toEqual([{ id: expect.any(Number), created_at: expect.any(Number), site_id: SEED_SITE_ID,
        page_type: "quote", edge, country: "GB", ...metrics, worker_version: "test-worker",
        device: "desktop", client_key: expect.stringMatching(/^[0-9a-f]{16}$/) }]);
      const { created_at } = rows()[0] as { created_at: number };
      expect(created_at).toBeGreaterThanOrEqual(before);
      expect(created_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
    } finally {
      prepare.mockRestore();
    }
  });

  it("stores NULL for a browser-cache visit's zero TTFB and keeps its other metrics", async () => {
    const { navigation, events, sendBeacon } = browser(0);
    navigation.transferSize = 0;
    navigation.responseStart = 0;
    navigation.activationStart = 0;
    events.dispatchEvent(new Event("pagehide"));
    const [url, body] = sendBeacon.mock.calls[0]!;
    expect(JSON.parse(await body.text())).toEqual({ page_type: "quote", ttfb_ms: 0, fcp_ms: 205, cls: 0 });

    const { serve, work } = gateway();
    expect((await serve(new Request(url, { method: "POST", body }))).status).toBe(204);
    await Promise.all(work);
    expect(rows()).toMatchObject([{ page_type: "quote", edge: null, ttfb_ms: null, fcp_ms: 205, cls: 0 }]);
  });

  it("returns an uncached 429 and schedules no insert when the limiter denies the client IP", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const { serve, work } = gateway(undefined, { ...env, VITALS_RATE_LIMITER: { limit } });
    const response = await serve(post(sampleBody, { "CF-Connecting-IP": clientIp }));
    expect(limit.mock.calls).toEqual([[{ key: clientIp }]]);
    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect([work, rows()]).toEqual([[], []]);
  });

  it("checks the limiter only after validating the sample and resolving the site", async () => {
    const limit = vi.fn().mockResolvedValue({ success: false });
    const { serve, work } = gateway(() => new Response(null, { status: 404 }), { ...env, VITALS_RATE_LIMITER: { limit } });
    expect((await serve(post("{}"))).status).toBe(400);
    expect((await serve(new Request(unknownEndpoint, { method: "POST", body: sampleBody }))).status).toBe(404);
    expect(limit).not.toHaveBeenCalled();
    expect((await serve(post(sampleBody, { "CF-Connecting-IP": clientIp }))).status).toBe(429);
    expect(limit.mock.calls).toEqual([[{ key: clientIp }]]);
    expect([work, rows()]).toEqual([[], []]);
  });

  it.each([null, "2001:db8:::1", "invalid-ip"])("uses the unknown limiter key for CF-Connecting-IP %j", async ip => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const { serve, work } = gateway(undefined, { ...env, VITALS_RATE_LIMITER: { limit } });
    const headers = new Headers({ "X-Forwarded-For": clientIp });
    if (ip) headers.set("CF-Connecting-IP", ip);
    const response = await serve(post(sampleBody, headers));
    expect(limit.mock.calls).toEqual([[{ key: "unknown" }]]);
    expect(response.status).toBe(204);
    await Promise.all(work);
    expect(rows()).toHaveLength(1);
  });

  it("accepts the sample and logs once without the IP when the limiter throws", async () => {
    const limit = vi.fn().mockRejectedValue(new Error(`limiter unavailable for ${clientIp}`));
    const { serve, work } = gateway(undefined, { ...env, VITALS_RATE_LIMITER: { limit } });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await serve(post(sampleBody, { "CF-Connecting-IP": clientIp }));
      expect(response.status).toBe(204);
      await Promise.all(work);
      expect(rows()).toMatchObject([{ site_id: SEED_SITE_ID, cls: 0 }]);
      expect(log.mock.calls).toEqual([["[vitals] rate limiter failed"]]);
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    ["iPad Mobile", undefined, "tablet"], ["Android Tablet", "?0", "tablet"],
    ["Mobi", undefined, "mobile"], ["Android", "?0", "mobile"],
    ["iPhone", undefined, "mobile"], ["iPod", undefined, "mobile"],
    ["Mozilla/5.0 (X11; Linux x86_64)", undefined, "desktop"], ["iPad", "?1", "mobile"],
  ] as const)("classifies UA %s with mobile hint %s as %s", async (ua, hint, device) => {
    const { serve, work } = gateway();
    const headers = new Headers({ "User-Agent": ua });
    if (hint) headers.set("Sec-CH-UA-Mobile", hint);
    expect((await serve(post(sampleBody, headers))).status).toBe(204);
    await Promise.all(work);
    expect(rows()).toMatchObject([{ device }]);
  });

  it("stores only the SHA-256 prefix for the client IP, UTC date and resolved site", async () => {
    const otherSite = "second-site";
    const send = async (siteId: string) => {
      const { serve, work } = gateway(() => Response.json({ ...snapshot, siteId }));
      expect((await serve(post(sampleBody, { "CF-Connecting-IP": clientIp }))).status).toBe(204);
      await Promise.all(work);
    };
    const expectedKey = (day: string, siteId: string) =>
      createHash("sha256").update(`${clientIp}|${day}|${siteId}`).digest("hex").slice(0, 16);

    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-24T23:59:59Z") });
    try {
      await send(SEED_SITE_ID);
      await send(SEED_SITE_ID);
      await send(otherSite);
      vi.setSystemTime(new Date("2026-11-25T00:00:00Z"));
      await send(SEED_SITE_ID);
      const stored = rows();
      const firstKey = expectedKey("2026-11-24", SEED_SITE_ID);
      expect(stored).toMatchObject([
        { site_id: SEED_SITE_ID, client_key: firstKey },
        { site_id: SEED_SITE_ID, client_key: firstKey },
        { site_id: otherSite, client_key: expectedKey("2026-11-24", otherSite) },
        { site_id: SEED_SITE_ID, client_key: expectedKey("2026-11-25", SEED_SITE_ID) },
      ]);
      expect(JSON.stringify(stored)).not.toContain(clientIp);
    } finally {
      vi.useRealTimers();
    }
  });

  it("groups IPv6 addresses by the same expanded /64 for the limiter and the daily client key", async () => {
    const prefix = "2001:0db8:0000:00ab";
    const cases = [
      ["2001:db8::AB:1:2:3:4", prefix],
      ["2001:0DB8:0000:00AB:fedc:ba98:7654:3210", prefix],
      ["2001:db8:0:ab::", prefix],
      ["2001:db8:0:ac::1", "2001:0db8:0000:00ac"],
      ["::ffff:192.0.2.1", "0000:0000:0000:0000"],
      ["::1", "0000:0000:0000:0000"],
    ] as const;
    const day = "2026-11-24";
    const limit = vi.fn().mockResolvedValue({ success: true });
    const { serve, work } = gateway(undefined, { ...env, VITALS_RATE_LIMITER: { limit } });
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(day + "T12:00:00Z") });
    try {
      for (const [ip] of cases) {
        expect((await serve(post(sampleBody, { "CF-Connecting-IP": ip }))).status).toBe(204);
        await Promise.all(work);
      }
      expect(limit.mock.calls).toEqual(cases.map(([, source]) => [{ key: source }]));
      expect(rows()).toMatchObject(cases.map(([, source]) => ({
        client_key: createHash("sha256").update(`${source}|${day}|${SEED_SITE_ID}`).digest("hex").slice(0, 16),
      })));
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs the resolved site when D1 rejects the background insert", async () => {
    const { serve, work } = gateway();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      sqlite.prepare("PRAGMA query_only = ON").run();
      expect((await serve(post(sampleBody, { "CF-Connecting-IP": clientIp }))).status).toBe(204);
      expect(work).toHaveLength(1);
      await Promise.all(work);
      expect(rows()).toEqual([]);
      expect(log.mock.calls).toEqual([["[vitals] insert failed", SEED_SITE_ID]]);
    } finally {
      sqlite.prepare("PRAGMA query_only = OFF").run();
      log.mockRestore();
    }
  });

  it.each(["home", "article", "category", "tag", "page", "listicle", "quote", "other"])(
    "stores an available zero for %s and SQL NULL for unavailable dimensions and metrics", async page_type => {
      const { serve, work } = gateway(undefined, { ...env, CF_VERSION_METADATA: undefined });
      const response = await serve(post(JSON.stringify({ page_type, cls: 0, inp_ms: null })));
      expect(response.status).toBe(204);
      await Promise.all(work);
      expect(rows()).toMatchObject([{ page_type, cls: 0, ttfb_ms: null, fcp_ms: null, lcp_ms: null,
        inp_ms: null, country: null, worker_version: null, edge: null }]);
    },
  );

  it.each(["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"])("rejects %s before reading a snapshot", async method => {
    const { serve, calls, work, fallback } = gateway();
    const response = await serve(new Request(endpoint, { method }));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect([calls, work, rows()]).toEqual([[], [], []]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each([
    "", "{", "null", "[]", "42", "{}", '{"page_type":"news","cls":0}', '{"cls":0}', '{"page_type":"home"}',
    '{"page_type":"article","ttfb_ms":-1}', '{"page_type":"category","fcp_ms":60001}', '{"page_type":"page","lcp_ms":1e500}',
    '{"page_type":"quote","inp_ms":"8","cls":0}', '{"page_type":"tag","cls":5.01}', '{"page_type":"other","cls":-0.1}',
    '{"page_type":"home","cls":0,"edge":"EXPIRED"}', '{"page_type":"home","cls":0,"edge":"hit"}',
    '{"page_type":"home","cls":0,"edge":null}', '{"page_type":"home","cls":0,"edge":1}', '{"page_type":"home","edge":"HIT"}',
  ])("rejects malformed or unmeasurable payload %j before doing any I/O", async body => {
    const { serve, calls, work } = gateway();
    const response = await serve(post(body));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect([calls, work, rows()]).toEqual([[], [], []]);
  });

  it("accepts exactly 1024 UTF-8 bytes and rejects an oversized declared or streamed body", async () => {
    const { serve, calls, work } = gateway();
    const json = JSON.stringify({ page_type: "page", fcp_ms: 120, ignored: "é" });
    const body = json + " ".repeat(1024 - Buffer.byteLength(json));
    const large = await serve(post(body, { "Content-Length": "1025" }));
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new TextEncoder().encode(body)); c.enqueue(new Uint8Array([32])); c.close(); },
    });
    const init = { method: "POST", body: stream, duplex: "half", headers: { "Content-Length": "1" } };
    const chunked = await serve(new Request(endpoint, init));
    for (const res of [large, chunked]) {
      expect(res.status).toBe(413);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
    expect([calls, work, rows()]).toEqual([[], [], []]);
    expect((await serve(post(body))).status).toBe(204);
    await Promise.all(work);
    expect(rows()).toHaveLength(1);
  });

  it("rejects the admin host even with a tenant override and a valid sample", async () => {
    const { serve, calls, work, fallback } = gateway(undefined, { ...env, PERFSTAGE: "true" });
    const request = new Request(`https://${env.ADMIN_HOST}./v/vitals`, { method: "POST",
      body: '{"page_type":"home","cls":0}', headers: { "x-perfstage-host": SEED_HOSTNAME } });
    expect((await serve(request)).status).toBe(404);
    expect([calls, work, rows()]).toEqual([[], [], []]);
    expect(fallback).not.toHaveBeenCalled();
  });

  const unusableSnapshots = [
    ["missing", () => new Response(null, { status: 404 })],
    ["malformed", () => new Response("{")],
    ["oversized", () => Response.json({ ...snapshot, siteId: "wrong-site", language: "x".repeat(1024 * 1024) })],
    ["mismatched", () => Response.json({ ...snapshot, siteId: "wrong-site", hostname: "other.example" })],
    ["inactive", () => Response.json({ ...snapshot, siteId: "wrong-site", status: "draft" })],
    ["unavailable", () => { throw new Error("snapshot unavailable"); }],
  ] as const;

  it.each(unusableSnapshots)("discards an unregistered host's sample when the snapshot is %s", async (_name, snap) => {
    const { serve, calls, work, fallback } = gateway(snap);
    const response = await serve(new Request(unknownEndpoint, { method: "POST", body: sampleBody }));
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(calls.map(c => c.props.variantKey)).toEqual(["snap"]);
    expect([work, rows()]).toEqual([[], []]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it.each(unusableSnapshots)("records a registered host's MISS when the snapshot is %s", async (_name, snap) => {
    const { serve, calls, work, fallback } = gateway(snap);
    const response = await serve(post('{"page_type":"home","edge":"MISS","cls":0}'));
    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(calls.map(c => c.props.variantKey)).toEqual(["snap"]);
    expect(work).toHaveLength(1);
    await Promise.all(work);
    expect(rows()).toMatchObject([{ site_id: SEED_SITE_ID, page_type: "home", edge: "MISS", cls: 0 }]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("uses the registry when the snapshot binding is absent", async () => {
    const response = await gatewayFetch(post(sampleBody), env, undefined, honoFetch);
    expect(response.status).toBe(204);
    expect(rows()).toMatchObject([{ site_id: SEED_SITE_ID, cls: 0 }]);
  });

  it("returns an uncached 503 when the fallback registry lookup throws", async () => {
    const db = d1FromSqlite(sqlite);
    const prepare = vi.spyOn(db, "prepare").mockImplementation(() => { throw new Error("registry unavailable"); });
    const { serve, calls, work, fallback } = gateway(() => new Response(null, { status: 404 }), { ...env, DB: db });
    const response = await serve(post(sampleBody));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(calls.map(c => c.props.variantKey)).toEqual(["snap"]);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("FROM domains"));
    expect([work, rows()]).toEqual([[], []]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("records a cached page outcome with just the bindings, status and request context", async () => {
    const { serve, ctx } = gateway();
    const res = await serve(new Request(origin, { method: "HEAD", headers: { "x-cms-site-id": "wrong-site" } }));
    expect(res.headers.get("x-edge-cache")).toBe("HIT");
    expect(recordEdgeCacheStatus).toHaveBeenCalledTimes(1);
    const args = vi.mocked(recordEdgeCacheStatus).mock.calls[0]!;
    expect(args).toHaveLength(3);
    const [bindings, status, requestContext] = args;
    expect(bindings).toBe(env);
    expect(status).toBe("HIT");
    expect(requestContext).toBe(ctx);
  });
});

describe("rendered vitals beacon", () => {
  beforeAll(() => {
    sqlite.prepare("INSERT INTO tags (site_id, slug, name) VALUES (?, 'news', 'News')").run(SEED_SITE_ID);
    sqlite.prepare(`INSERT INTO pages (site_id, slug, title, content_json, content_html, status, updated_at)
      VALUES (?, 'about-us', 'About us', '{}', '<p>About</p>', 'published', ?)`).run(SEED_SITE_ID, SEED_EPOCH);
    sqlite.prepare(`INSERT INTO listicle_articles (id, public_id, site_id, slug, article_name, status)
      VALUES (1, 'art_guide', ?, 'morning-guide', 'Morning guide', 'published')`).run(SEED_SITE_ID);
    sqlite.prepare(`INSERT INTO listicle_article_versions (public_id, article_id, headline, intro_paragraph)
      VALUES ('ver_guide', 1, 'Morning guide', 'A guide for readers.')`).run();
    const id = "0".repeat(25) + "1";
    sqlite.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
      VALUES (1, ?, 'Home', 'quote_funnel', '[]', 'active')`).run("lgq_" + id);
    sqlite.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES (?, 1, 1, 'home')")
      .run(SEED_SITE_ID);
    sqlite.prepare("INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status) VALUES (1, ?, 1, 'Home', 'active')")
      .run("lgf_" + id);
    sqlite.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp) VALUES (?, 1, 'A', 10000)")
      .run("lgn_" + id);
  });

  it.each([
    ["/", "home", 200], ["/article/morning-light-rituals", "article", 200], ["/category/wellness", "category", 200],
    ["/tag/news", "tag", 200], ["/page/about-us", "page", 200], ["/about-us", "page", 200],
    ["/article/missing", "other", 404], ["/lg/home", "quote", 200], ["/morning-guide", "listicle", 200],
  ] as const)("renders exactly one shared beacon at the end of %s", async (path, type, status) => {
    const response = await honoFetch(new Request(origin + path), env);
    expect(response.status).toBe(status);
    const html = await response.text();
    expect(html.match(/<html\b[^>]*>/i)?.[0]).toContain(`data-pt="${type}"`);
    expect(html.match(/\/v\/vitals/g)).toHaveLength(1);
    expect(html.slice(html.indexOf(VITALS_BEACON) + VITALS_BEACON.length).trim()).toMatch(/^<\/body>\s*<\/html>$/);
    expect(html).toContain(VITALS_BEACON);
  });

  it("serves the metered homepage to a browser holding its template v3 ETag", async () => {
    const page = { site_id: SEED_SITE_ID, path: "/", content_version: 1, settings_version: 1 };
    const previous = await computeEtag({ ...page, template_version: 3 });
    const current = await computeEtag(page);
    const revalidate = (etag: string) => honoFetch(new Request(origin, { headers: { "If-None-Match": etag } }), env);

    const refreshed = await revalidate(previous);
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get("ETag")).toBe(current);
    expect(await refreshed.text()).toContain(VITALS_BEACON);

    const matched = await revalidate(current);
    expect(matched.status).toBe(304);
    expect(matched.headers.get("ETag")).toBe(current);
    expect(await matched.text()).toBe("");
  });

  it.each(["/admin/pages", "/admin/tags"])("keeps the admin shell at %s free of the public beacon", async path => {
    const response = await honoFetch(new Request("https://" + env.ADMIN_HOST + path), env);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('data-area="admin"');
    expect(html).not.toContain("/v/vitals");
  });

  it("matches the 2029 bytes of the P5-W inline script that reports every page view", () => {
    const bytes = Buffer.byteLength(VITALS_BEACON);
    console.log(`Vitals beacon: ${bytes} bytes including script tags`);
    expect(bytes).toBe(2029);
    expect(createHash("sha256").update(VITALS_BEACON).digest("hex"))
      .toBe("9fe490e518b3648a42d9700e23ebfb384bf6d7612582a1e27ac6e912fbafcb51");
  });
});

// Drive the emitted code with queued and delivered PerformanceObserver entries.
// No browser, network, or wall-clock timing is needed.
type Entry = { startTime?: number; value?: number; hadRecentInput?: boolean; interactionId?: number; duration?: number };
function browser(
  random: number,
  types = ["event", "first-input", "largest-contentful-paint", "layout-shift"],
  visibilityState = "visible",
  hasSendBeacon = true,
) {
  const observers = new Map<string, Observer>();
  class Observer {
    static supportedEntryTypes = types;
    pending: Entry[] = [];
    constructor(readonly callback: (list: { getEntries(): Entry[] }) => void) {}
    observe(options: { type: string; buffered: boolean; durationThreshold?: number }) {
      expect(options.buffered).toBe(true);
      if (options.type === "event") expect(options.durationThreshold).toBe(16);
      observers.set(options.type, this);
    }
    takeRecords() { return this.pending.splice(0); }
    disconnect() {}
  }
  const events = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState, documentElement: { dataset: { pt: "quote" } } });
  const sendBeacon = vi.fn((_url: string, _body: Blob) => true);
  const navigation: {
    responseStart?: number;
    activationStart: number;
    transferSize?: number;
    serverTiming?: { name: string; description: string }[];
  } = { responseStart: 125, activationStart: 5, transferSize: 1024 };
  const performance = {
    interactionCount: 50,
    getEntriesByType: (name: string) => name === "navigation" ? [navigation] : [],
    getEntriesByName: (name: string, type: string) => name === "first-contentful-paint" && type === "paint" ? [{ startTime: 205 }] : [],
  };
  const script = VITALS_BEACON.slice(VITALS_BEACON.indexOf(">") + 1, -"</script>".length);
  runInNewContext(script, { document, performance, PerformanceObserver: Observer,
    navigator: hasSendBeacon ? { sendBeacon } : {}, Blob, location: { origin },
    addEventListener: events.addEventListener.bind(events), Math: Object.assign(Object.create(Math), { random: () => random }) });
  return { observers, document, events, sendBeacon, navigation };
}

it.each([0.19999, 0.2, 0.99999])("flushes pending entries and reports the five metrics once on the first hide with Math.random() = %s", async random => {
  const { observers, document, events, sendBeacon } = browser(random);
  observers.get("largest-contentful-paint")!.callback({ getEntries: () => [{ startTime: 300 }] });
  observers.get("largest-contentful-paint")!.pending.push({ startTime: 605 });
  observers.get("layout-shift")!.pending.push({ startTime: 200, value: 0.125 }, { startTime: 300, value: 0.25 },
    { startTime: 400, value: 1, hadRecentInput: true }, { startTime: 1500, value: 0.25 });
  observers.get("event")!.pending.push({ interactionId: 7, duration: 400 }, { interactionId: 7, duration: 320 },
    { interactionId: 14, duration: 160 }, { interactionId: 21, duration: 80 });
  observers.get("first-input")!.pending.push({ interactionId: 7, duration: 80 });
  document.dispatchEvent(new Event("visibilitychange"));
  expect(sendBeacon).not.toHaveBeenCalled();
  document.visibilityState = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  events.dispatchEvent(new Event("pagehide"));
  expect(sendBeacon).toHaveBeenCalledTimes(1);
  const [url, json] = sendBeacon.mock.calls[0]!;
  expect(url).toBe(endpoint);
  expect(json.type).toBe("application/json");
  expect(JSON.parse(await json.text())).toEqual({ page_type: "quote", ttfb_ms: 120, fcp_ms: 200, lcp_ms: 600, inp_ms: 160, cls: 0.375 });
});

it("skips observers and requests when sendBeacon is unavailable", () => {
  const { observers, events, sendBeacon } = browser(0, undefined, "visible", false);
  events.dispatchEvent(new Event("pagehide"));
  expect(observers.size).toBe(0);
  expect(sendBeacon).not.toHaveBeenCalled();
});

it("reports only supported metrics on pagehide", async () => {
  const partial = browser(0, []);
  partial.events.dispatchEvent(new Event("pagehide"));
  partial.document.visibilityState = "hidden";
  partial.document.dispatchEvent(new Event("visibilitychange"));
  expect(partial.sendBeacon).toHaveBeenCalledTimes(1);
  expect(JSON.parse(await partial.sendBeacon.mock.calls[0]![1].text())).toEqual({ page_type: "quote", ttfb_ms: 120, fcp_ms: 200 });
});

it("excludes background-tab paint delays from the real-visitor timings", async () => {
  const hidden = browser(0, ["largest-contentful-paint"], "hidden");
  hidden.observers.get("largest-contentful-paint")!.pending.push({ startTime: 65_000 });
  hidden.document.visibilityState = "visible";
  hidden.events.dispatchEvent(new Event("pagehide"));
  expect(JSON.parse(await hidden.sendBeacon.mock.calls[0]![1].text())).toEqual({ page_type: "quote", ttfb_ms: 120 });
});

it.each([
  ["HIT", 1, "HIT"], ["MISS", 1024, "MISS"], ["BYPASS", 1024, undefined],
  ["HIT", 0, undefined], ["MISS", 0, undefined], ["HIT", undefined, undefined],
] as const)("samples edge description %s with navigation transferSize %s", async (description, transferSize, edge) => {
  const { navigation, events, sendBeacon } = browser(0, []);
  navigation.transferSize = transferSize;
  navigation.serverTiming = [{ name: "gw-snap", description: "HIT" }, { name: "edge", description }];
  events.dispatchEvent(new Event("pagehide"));
  expect(sendBeacon).toHaveBeenCalledTimes(1);
  const [url, body] = sendBeacon.mock.calls[0]!;
  expect(url).toBe(endpoint);
  expect(JSON.parse(await body.text())).toEqual({ page_type: "quote", ttfb_ms: 120, fcp_ms: 200,
    ...(edge === undefined ? {} : { edge }) });
});

it("skips the beacon when only the edge outcome is available", () => {
  const { navigation, events, sendBeacon } = browser(0, [], "hidden");
  delete navigation.responseStart;
  navigation.serverTiming = [{ name: "edge", description: "HIT" }];
  events.dispatchEvent(new Event("pagehide"));
  expect(sendBeacon).not.toHaveBeenCalled();
});
