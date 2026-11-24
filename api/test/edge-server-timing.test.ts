import { afterEach, expect, it, vi } from "vitest";
import { applyEdgeCacheHeaders } from "../src/cache/cache-control";
import { D1Timing, renderReadDb } from "../src/db/read-session";
import { gatewayFetch } from "../src/edge/gateway";
import { PublicPage } from "../src/edge/public-page";
import { buildSiteSnapshot } from "../src/edge/snapshot";
import type { PublicPageProps } from "../src/edge/types";
import type { Env } from "../src/env";
import * as app from "../src/index";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";
import { ctxCapture } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv } from "./helpers/x06-a2-sqlite";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

afterEach(() => vi.restoreAllMocks());

const host = "news.example";
const origin = "https://" + host;
const siteId = "news";
const headline = "雪 — Café";
const titleSql = "SELECT ? AS title";
const creditSql = "SELECT ? AS credit";

function countingDb() {
  const { db, calls } = makeFakeDb([
    { match: "FROM domains", row: { site_id: siteId, hostname: host, status: "active" } },
    { match: titleSql, row: { title: headline } },
  ], [
    { match: "FROM sites WHERE", rows: [{ content_version: 2, settings_version: 1, write_bookmark: "published" }] },
    { match: titleSql, rows: [{ title: headline }] },
    { match: creditSql, rows: [{ credit: "Zoë" }] },
  ]);
  const prepare = db.prepare.bind(db);
  const native = new WeakSet<D1PreparedStatement>();
  db.prepare = sql => {
    const stmt = prepare(sql);
    native.add(stmt);
    const all = stmt.all.bind(stmt);
    stmt.all = async <T>() => {
      const result = await all<T>();
      if (!sql.includes("FROM leadgen_site_quotes")) {
        const primary = sql === titleSql || sql.includes("FROM site_settings");
        Object.assign(result.meta, { served_by_primary: primary, served_by_region: primary ? "EEUR" : "WNAM" });
      }
      return result;
    };
    return stmt;
  };
  const batchSizes: number[] = [];
  db.batch = <T>(statements: D1PreparedStatement[]) => {
    if (!statements.every(stmt => native.has(stmt))) throw new Error("D1 batch requires native statements");
    batchSizes.push(statements.length);
    return Promise.all(statements.map(stmt => stmt.all<T>()));
  };
  const withSession = vi.fn((_anchor?: string): D1DatabaseSession => ({
    prepare: query => db.prepare(query), batch: statements => db.batch(statements), getBookmark: () => "published",
  }));
  db.withSession = withSession;
  return { db, calls, batchSizes, withSession };
}

// Model the Workers Cache boundary. A HIT replays the header stored on the MISS.
function cachedGateway() {
  const fixture = countingDb();
  const env = buildEnv(fixture.db);
  const { ctx } = ctxCapture();
  let clock = 100;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(Date, "now").mockReturnValue(1000);
  async function render(db: D1Database) {
    const title = () => db.prepare(titleSql).bind(headline);
    const parallel = Promise.all([title().first<{ title: string }>(), title().all<{ title: string }>()]);
    clock += 13;
    const [row, list] = await parallel;
    clock += 7; // Renderer work between rounds.
    const batch = db.batch([title(), db.prepare(creditSql).bind("Zoë")]);
    clock += 5;
    const [titles, credits] = await batch;
    return new Response(JSON.stringify([row, list.results, titles!.results, credits!.results]), {
      headers: { "Content-Type": "application/json", ETag: '"v2"', "Server-Timing": "renderer;dur=1" },
    });
  }
  vi.spyOn(app, "honoFetch").mockImplementation((_request, bindings) => {
    if (!bindings || !("DB" in bindings)) throw new Error("missing render bindings");
    return render(bindings.DB);
  });
  const cache = new Map<string, Response>();
  Object.assign(ctx, { exports: {
    PublicPage: ({ props }: { props: PublicPageProps }) => ({
      async fetch(request: Request) {
        const stored = cache.get(props.variantKey);
        const response = stored?.clone() ?? await new PublicPage({ ...ctx, props }, env).fetch(request);
        if (!stored) cache.set(props.variantKey, response.clone());
        response.headers.set("cf-cache-status", stored ? "HIT" : "MISS");
        clock += props.variantKey === "snap" ? 3 : 2;
        return response;
      },
    }),
  } });
  const fallback = vi.fn(() => Response.redirect(origin + "/live", 302));
  const visit = (init?: RequestInit, path = "/article/story") =>
    gatewayFetch(new Request(origin + path, init), env, ctx, fallback);
  return { ...fixture, env, render, visit, cache, fallback };
}

function timingEntries(response: Response): string[] | undefined {
  return response.headers.get("Server-Timing")?.split(/,\s*/).sort();
}

const snapMetrics = [
  "snap-build;dur=0", 'snap-d1;dur=0;desc="rounds=2 calls=2 primary=1 replica=2 region=WNAM"',
];
const pageMetrics = [
  "renderer;dur=1", "build;dur=25", 'd1;dur=18;desc="rounds=2 calls=3 primary=2 replica=1 region=EEUR"',
];

it("reports each fresh build, overlapping D1 wall time and result locations without changing response bytes", async () => {
  const { db, env, render, visit, cache, calls, batchSizes, withSession } = cachedGateway();
  const plainPage = applyEdgeCacheHeaders(await render(db), { siteId, path: "/article/story" });
  const plainSnap = Response.json(await buildSiteSnapshot(env, host));
  calls.length = batchSizes.length = 0;
  withSession.mockClear();

  const miss = await visit();
  expect(miss.status).toBe(200);
  expect(miss.headers.get("x-edge-cache")).toBe("MISS");
  expect(timingEntries(miss)).toEqual([
    'gw-snap;dur=3;desc="MISS"', ...snapMetrics, "gw-inner;dur=27", ...pageMetrics,
  ].sort());
  expect(timingEntries(cache.get("snap")!)).toEqual([...snapMetrics].sort());
  expect(timingEntries(cache.get("human")!)).toEqual([...pageMetrics].sort());
  expect(await miss.bytes()).toEqual(await plainPage.bytes());
  expect(await cache.get("snap")!.clone().bytes()).toEqual(await plainSnap.bytes());
  for (const name of ["Cache-Control", "Cache-Tag", "Content-Type", "ETag"]) {
    expect(miss.headers.get(name)).toBe(plainPage.headers.get(name));
  }
  expect(calls).toHaveLength(12); // Eight snapshot statements and four page statements.
  expect(batchSizes).toEqual([7, 2]);
  expect(withSession.mock.calls).toEqual([["first-primary"], ["published"]]);
});

it("returns the same article HTML bytes and cache headers as a direct Hono build", async () => {
  const sql = createDb();
  const { ctx, promises } = ctxCapture();
  try {
    addSite(sql, siteId, "News", "home");
    sql.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(siteId, host);
    sql.prepare("INSERT INTO articles (site_id, slug, title, content_json, status, published_at) VALUES (?, ?, ?, ?, 'published', ?)")
      .run(siteId, "story", headline, '{"blocks":[]}', 100);
    const env = sqliteEnv(sql);
    const request = new Request(origin + "/article/story", { headers: { "x-cms-variant": "human" } });
    const direct = await app.honoFetch(request.clone(), { ...env, EDGE_INNER: "1" }, ctx);
    const expected = applyEdgeCacheHeaders(direct, { siteId, path: "/article/story" });
    const page = new PublicPage({ ...ctx, props: { siteKey: siteId, variantKey: "human" } }, env);
    const measured = await page.fetch(request);
    expect([expected.status, measured.status]).toEqual([200, 200]);
    const bytes = await measured.bytes();
    expect(new TextDecoder().decode(bytes)).toContain(">" + headline + "</h1>");
    expect(bytes).toEqual(await expected.bytes());
    const headers = new Headers(measured.headers);
    expect(headers.get("Server-Timing")).toMatch(/\bd1;dur=\d+;desc="rounds=[1-9]\d* calls=[1-9]\d* /);
    headers.delete("Server-Timing");
    expect([...headers]).toEqual([...expected.headers]);
  } finally {
    await Promise.all(promises);
    sql.close();
  }
});

it.each([
  ["both cached", false, false],
  ["fresh snapshot only", true, false],
  ["fresh page only", false, true],
] as const)("forwards exactly the fresh entries with %s", async (_label, rebuildSnap, rebuildPage) => {
  const { visit, cache, calls } = cachedGateway();
  const first = await visit();
  const bytes = await first.bytes();
  if (rebuildSnap) cache.delete("snap");
  if (rebuildPage) cache.delete("human");
  calls.length = 0;

  const next = await visit();
  expect(timingEntries(next)).toEqual([
    rebuildSnap ? 'gw-snap;dur=3;desc="MISS"' : 'gw-snap;dur=3;desc="HIT"',
    ...(rebuildSnap ? snapMetrics : []),
    rebuildPage ? "gw-inner;dur=27" : "gw-inner;dur=2",
    ...(rebuildPage ? pageMetrics : []),
  ].sort());
  expect(next.headers.get("x-edge-cache")).toBe(rebuildPage ? "MISS" : "HIT");
  expect(await next.bytes()).toEqual(bytes);
  expect(calls).toHaveLength((rebuildSnap ? 8 : 0) + (rebuildPage ? 4 : 0));
});

it("keeps current gateway timings on bodyless HEAD and 304 hits", async () => {
  const { visit } = cachedGateway();
  await visit();
  const head = await visit({ method: "HEAD" });
  const validated = await visit({ headers: { "If-None-Match": '"v2"' } });
  expect([head.status, validated.status]).toEqual([200, 304]);
  for (const response of [head, validated]) {
    expect(response.body).toBeNull();
    expect(response.headers.get("ETag")).toBe('"v2"');
    expect(timingEntries(response)).toEqual(["gw-inner;dur=2", 'gw-snap;dur=3;desc="HIT"']);
  }
});

it("shows the failed snapshot build on a live fallback and skips unrelated routes", async () => {
  const { db, visit, fallback } = cachedGateway();
  db.withSession = () => { throw new Error("primary unavailable"); };
  const response = await visit();
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(origin + "/live");
  expect(timingEntries(response)).toEqual([
    'gw-snap;dur=3;desc="MISS"', "gw-inner;dur=0", "snap-build;dur=0",
    'snap-d1;dur=0;desc="rounds=0 calls=0 primary=0 replica=0 region=none"',
  ].sort());
  const live = await visit({}, "/health");
  expect(live.headers.has("Server-Timing")).toBe(false);
  expect(fallback).toHaveBeenCalledTimes(2);
});

it("preserves D1 results and errors when metadata or the clock is unavailable", async () => {
  const { db } = makeFakeDb();
  const native = db.prepare("SELECT ? AS value").bind(1);
  vi.spyOn(db, "prepare").mockReturnValue(native);
  const row = { meta: { served_by_primary: true, served_by_region: "row data" } };
  const first = vi.spyOn(native, "first").mockResolvedValue(row);
  native.raw = vi.fn();
  vi.mocked(native.raw).mockResolvedValueOnce([["value"], [1]]).mockResolvedValueOnce([[1]]);
  const result: D1Result = { success: true, results: [], get meta(): D1Meta & Record<string, unknown> {
    throw new Error("unavailable metadata");
  } };
  const error = new Error("D1 failed");
  vi.spyOn(native, "run").mockResolvedValueOnce(result).mockRejectedValueOnce(error);
  vi.spyOn(performance, "now").mockImplementation(() => { throw new Error("unavailable clock"); });

  const timing = new D1Timing();
  const stmt = renderReadDb(db, "bookmark", timing).prepare("SELECT ? AS value").bind(1);
  expect(await stmt.first("value")).toBe(row);
  expect(first).toHaveBeenCalledExactlyOnceWith("value");
  expect(await stmt.raw({ columnNames: true })).toEqual([["value"], [1]]);
  expect(native.raw).toHaveBeenCalledExactlyOnceWith({ columnNames: true });
  expect(await stmt.raw()).toEqual([[1]]);
  expect(await stmt.run()).toBe(result);
  await expect(stmt.run()).rejects.toBe(error);
  expect(timing).toMatchObject({ calls: 5, rounds: 5, wallMs: 0, primary: 0, replica: 0, regions: new Set() });
});

it("observes each batch result's region across a child session and keeps its bookmark", async () => {
  const { db, withSession } = countingDb();
  const timing = new D1Timing();
  const renderDb = renderReadDb(db, "published", timing);
  const child = renderDb.withSession("next");
  await child.batch([renderDb.prepare(titleSql).bind(headline), db.prepare(creditSql).bind("Zoë")]);
  expect(withSession.mock.calls).toEqual([["published"], ["next"]]);
  expect(child.getBookmark()).toBe("published");
  expect(timing).toMatchObject({ calls: 1, rounds: 1, primary: 1, replica: 1 });
  expect([...timing.regions]).toEqual(["EEUR", "WNAM"]);
});
