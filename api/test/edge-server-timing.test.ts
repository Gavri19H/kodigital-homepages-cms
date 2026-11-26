import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { applyEdgeCacheHeaders } from "../src/cache/cache-control";
import { D1Timing, renderReadDb } from "../src/db/read-session";
import { gatewayFetch } from "../src/edge/gateway";
import { PublicPage } from "../src/edge/public-page";
import * as snapshots from "../src/edge/snapshot";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
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
  const domain = { site_id: siteId, hostname: host, status: "active" };
  const { db, calls } = makeFakeDb([
    { match: "FROM domains", row: domain },
    { match: titleSql, row: { title: headline } },
  ], [
    { match: "FROM domains", rows: [domain] },
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
        const primary = sql === titleSql || sql.includes("FROM domains");
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
function cachedGateway(missStatus: string | null = "MISS") {
  const fixture = countingDb();
  const env = buildEnv(fixture.db);
  env.PERFSTAGE = "true";
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
    const body = `<pre>${JSON.stringify([row, list.results, titles!.results, credits!.results])}</pre>`;
    return new Response(body, {
      headers: { "Content-Type": "text/html; charset=utf-8", ETag: '"v2"', "Server-Timing": "renderer;dur=1" },
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
        const status = stored ? "HIT" : missStatus;
        if (status !== null) response.headers.set("cf-cache-status", status);
        clock += props.variantKey === "snap" ? 3 : 2;
        return response;
      },
    }),
  } });
  const fallback = vi.fn<Parameters<typeof gatewayFetch>[3]>(() => Response.redirect(origin + "/live", 302));
  const visit = (init?: RequestInit, path = "/article/story") => {
    const request = new Request(origin + path, init);
    if (init?.cf) request.cf = init.cf; // Node's Request omits Workers metadata.
    return gatewayFetch(request, env, ctx, fallback);
  };
  return { ...fixture, env, render, visit, cache, fallback };
}

function timingEntries(response: Response): string[] | undefined {
  return response.headers.get("Server-Timing")?.split(/,\s*/).sort();
}

const snapMetrics = [
  "snap-build;dur=0", 'snap-d1;dur=0;desc="rounds=2 calls=2 primary=1 replica=3 region=EEUR"',
];
const pageMetrics = [
  "renderer;dur=1", "build;dur=25", 'd1;dur=18;desc="rounds=2 calls=3 primary=3 replica=1 region=EEUR"',
];

it("reports each fresh build, overlapping D1 wall time and result locations without changing response bytes", async () => {
  const { db, env, render, visit, cache, calls, batchSizes, withSession } = cachedGateway();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const plainPage = applyEdgeCacheHeaders(await render(db), { siteId, path: "/article/story" });
  const plainSnap = Response.json(await snapshots.buildSiteSnapshot(env, host));
  calls.length = batchSizes.length = 0;
  withSession.mockClear();

  const miss = await visit();
  expect(miss.status).toBe(200);
  expect(miss.headers.get("x-edge-cache")).toBe("MISS");
  expect(timingEntries(miss)).toEqual([
    'gw-snap;dur=3;desc="MISS"', ...snapMetrics, "gw-inner;dur=27", ...pageMetrics, 'edge;desc="MISS"',
  ].sort());
  expect(miss.headers.get("Server-Timing")).toMatch(/, edge;desc="MISS"$/);
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
  expect(log).not.toHaveBeenCalled();
});

it.each([undefined, "false", "TRUE"])("exposes only the current edge outcome in production with PERFSTAGE=%s", async flag => {
  const { db, env, render, visit, cache, calls, withSession, batchSizes } = cachedGateway();
  env.APP_ENV = "production";
  env.PERFSTAGE = flag;
  const baseline = applyEdgeCacheHeaders(await render(db), { siteId, path: "/article/story" });
  function expectedHeaders(status: "MISS" | "HIT") {
    const headers = new Headers(baseline.headers);
    headers.set("cf-cache-status", status);
    headers.set("x-edge-cache", status);
    headers.set("Server-Timing", `edge;desc="${status}"`);
    return [...headers];
  }
  calls.length = batchSizes.length = 0;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const measure = vi.spyOn(D1Timing.prototype, "measure");
  const miss = await visit({ headers: { "x-perfstage-direct": "1", "x-cms-build-colo": "forged" } },
    "/article/story?gclid=private-click");
  expect(miss.status).toBe(200);
  expect(miss.headers.get("x-edge-cache")).toBe("MISS");
  expect(miss.headers.get("Server-Timing")).toBe('edge;desc="MISS"');
  expect([...miss.headers]).toEqual(expectedHeaders("MISS"));
  const bytes = await miss.bytes();
  expect(bytes).toEqual(await baseline.bytes());
  expect(log.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
    { evt: "edge-build", host, path: "/__snap", variant: "snap", snap: true, build_ms: 0, d1_ms: 0,
      rounds: 2, calls: 2, primary: 0, replica: 3, region: "WNAM", colo: null },
    { evt: "edge-build", host, path: "/article/story", variant: "human", snap: false, build_ms: 25, d1_ms: 18,
      rounds: 2, calls: 3, primary: 2, replica: 1, region: "EEUR", colo: null },
  ]);
  expect(measure).toHaveBeenCalledTimes(5);
  expect(calls).toHaveLength(12);
  expect(batchSizes).toEqual([7, 2]);
  expect(withSession.mock.calls).toEqual([["first-primary"], ["published"]]);
  for (const key of ["snap", "human"]) {
    const stored = cache.get(key)!;
    expect(stored.status).toBe(200);
    expect(stored.headers.get("Server-Timing")).toBeNull();
    stored.headers.set("Server-Timing", 'd1;dur=12;desc="primary=1 region=EEUR"');
  }
  calls.length = 0;
  measure.mockClear();
  log.mockClear();
  withSession.mockClear();
  const hit = await visit();
  expect(hit.status).toBe(200);
  expect(hit.headers.get("x-edge-cache")).toBe("HIT");
  expect(hit.headers.get("Server-Timing")).toBe('edge;desc="HIT"');
  expect([...hit.headers]).toEqual(expectedHeaders("HIT"));
  expect(await hit.bytes()).toEqual(bytes);
  expect(measure).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
  expect(withSession).not.toHaveBeenCalled();
  expect(calls).toHaveLength(0);
});

it("carries the visitor colo to each fresh production build across the Workers Cache boundary", async () => {
  const { env, visit, cache } = cachedGateway();
  delete env.PERFSTAGE;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await visit({ cf: { colo: "EWR", country: "US" } });
  expect(log.mock.calls.map(([line]) => JSON.parse(line))).toEqual([
    expect.objectContaining({ snap: true, colo: "EWR" }), expect.objectContaining({ snap: false, colo: "EWR" }),
  ]);
  cache.delete("human");
  log.mockClear();
  await visit({ cf: { colo: "IAD", country: "US" } }, "/article/story?gclid=private-click");
  expect(log).toHaveBeenCalledTimes(1);
  expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ evt: "edge-build", path: "/article/story", snap: false, colo: "IAD" });
  const inner = vi.mocked(app.honoFetch).mock.lastCall![0];
  expect(inner.cf).toBeUndefined();
  expect(inner.headers.has("x-cms-build-colo")).toBe(false);
});

it.each([
  ["EXPIRED", 'edge;desc="MISS"'], ["DYNAMIC", 'edge;desc="MISS"'], ["BYPASS", 'edge;desc="MISS"'],
  [null, null], ["REVALIDATED", null],
] as const)("reports the page outcome for cf-cache-status %s", async (status, entry) => {
  const { env, visit, cache } = cachedGateway(status);
  delete env.PERFSTAGE;
  const page = await visit();
  expect(page.headers.get("x-edge-cache")).toBe(status ?? "none");
  expect(page.headers.get("Server-Timing")).toBe(entry);

  env.PERFSTAGE = "true";
  cache.delete("human");
  const staged = await visit();
  expect(timingEntries(staged)?.filter(metric => metric.startsWith("edge;"))).toEqual(entry ? [entry] : []);
});

it("evicts snapshot versions after eight builds and reuses each retained content hash", async () => {
  const { visit, cache, fallback } = cachedGateway();
  const build = vi.spyOn(snapshots, "buildSiteSnapshot");
  const entries: Response[] = [];
  const versions: string[] = [];
  const read = async () => {
    await visit({}, "/lg/attempt");
    return fallback.mock.lastCall?.[0].headers.get("x-cms-snap-version");
  };
  // These snapshots have the same site, timestamp and length, but differ in content.
  for (let i = 0; i < 9; i++) {
    const snapshot: SiteSnapshot = {
      v: 1, siteId, hostname: host, status: "active", builtAt: 500, contentVersion: 1, settingsVersion: 1,
      writeBookmark: null, timeZone: "UTC", language: String(i), leadgen: {}, listicles: {},
    };
    const { builtAt: _builtAt, ...content } = snapshot;
    const expected = createHash("sha256").update(JSON.stringify(content)).digest("hex");
    build.mockResolvedValueOnce(snapshot);
    cache.delete("snap");
    expect(await read()).toBe(expected);
    versions.push(expected);
    const entry = cache.get("snap")!;
    const hash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
    expect(entry.headers.get("ETag")).toBe('"' + hash + '"');
    entries.push(entry);
  }
  const digest = vi.spyOn(crypto.subtle, "digest");
  // Compression can weaken a stored ETag while preserving its digest.
  entries[1]!.headers.set("ETag", "W/" + entries[1]!.headers.get("ETag"));
  for (let i = 1; i < entries.length; i++) {
    cache.set("snap", entries[i]!);
    expect(await read()).toBe(versions[i]);
  }
  expect(digest).not.toHaveBeenCalled();
  cache.set("snap", entries[0]!);
  expect(await read()).toBe(versions[0]);
  expect(digest).toHaveBeenCalledTimes(1);
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
    env.PERFSTAGE = "true";
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
    rebuildPage ? 'edge;desc="MISS"' : 'edge;desc="HIT"',
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
    expect(timingEntries(response)).toEqual(['edge;desc="HIT"', "gw-inner;dur=2", 'gw-snap;dur=3;desc="HIT"']);
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

it.each([
  ["missing snapshot", false], ["inner 503", false], ["missing snapshot", true], ["inner 503", true],
] as const)("reports a live HTML MISS after %s with perfstage=%s", async (failure, staged) => {
  const { env, visit, fallback, calls } = cachedGateway();
  env.APP_ENV = staged ? "staging" : "production";
  env.PERFSTAGE = staged ? "true" : undefined;
  if (failure === "missing snapshot") vi.spyOn(snapshots, "buildSiteSnapshot").mockResolvedValueOnce(null);
  else vi.mocked(app.honoFetch).mockReturnValueOnce(new Response(null, { status: 503 }));

  const bytes = new TextEncoder().encode(`<h1>${headline}</h1>`);
  const live = new Response(bytes, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Server-Timing": "live;dur=4",
    "Cache-Control": "private, no-store", "Set-Cookie": "ko_sid=original",
  } });
  fallback.mockReturnValueOnce(live);
  const get = vi.spyOn(env.CACHE, "get");
  const put = vi.spyOn(env.CACHE, "put");
  const response = await visit();
  expect(fallback).toHaveBeenCalledTimes(1);
  expect(response.status).toBe(200);
  expect(await response.bytes()).toEqual(bytes);
  expect(live.headers.get("Server-Timing")).toBe("live;dur=4");
  const headers = new Headers(response.headers);
  const timing = headers.get("Server-Timing");
  if (staged) {
    const entries = timing?.split(", ");
    expect(entries?.slice(0, 2)).toEqual(["live;dur=4", 'gw-snap;dur=3;desc="MISS"']);
    expect(entries).toContain(failure === "missing snapshot" ? "gw-inner;dur=0" : "gw-inner;dur=2");
    expect(entries?.at(-1)).toBe('edge;desc="MISS"');
  } else {
    expect(timing).toBe('edge;desc="MISS"');
  }
  headers.set("Server-Timing", "live;dur=4");
  expect([...headers]).toEqual([...live.headers]);
  expect(calls).toHaveLength(failure === "missing snapshot" ? 0 : 8);
  expect(get).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});

it("preserves D1 results and errors when metadata or the clock is unavailable", async () => {
  const { db } = makeFakeDb();
  const native = db.prepare("SELECT ? AS value").bind(1);
  vi.spyOn(db, "prepare").mockReturnValue(native);
  const row = { meta: { served_by_primary: true, served_by_region: "row data" } };
  native.raw = vi.fn();
  vi.mocked(native.raw).mockResolvedValueOnce([["value"], [1]]).mockResolvedValueOnce([[1]]);
  const result: D1Result = { success: true, results: [{ value: row }], get meta(): D1Meta & Record<string, unknown> {
    throw new Error("unavailable metadata");
  } };
  const all = vi.spyOn(native, "all").mockResolvedValue(result);
  const error = new Error("D1 failed");
  vi.spyOn(native, "run").mockResolvedValueOnce(result).mockRejectedValueOnce(error);
  vi.spyOn(performance, "now").mockImplementation(() => { throw new Error("unavailable clock"); });

  const timing = new D1Timing();
  const stmt = renderReadDb(db, "bookmark", timing).prepare("SELECT ? AS value").bind(1);
  expect(await stmt.first("value")).toBe(row);
  expect(all).toHaveBeenCalledExactlyOnceWith();
  expect(await stmt.raw({ columnNames: true })).toEqual([["value"], [1]]);
  expect(native.raw).toHaveBeenCalledExactlyOnceWith({ columnNames: true });
  expect(await stmt.raw()).toEqual([[1]]);
  expect(await stmt.run()).toBe(result);
  await expect(stmt.run()).rejects.toBe(error);
  expect(timing).toMatchObject({ calls: 5, rounds: 5, wallMs: 0, primary: 0, replica: 0, regions: new Set() });
});

it("records the first read's location for a row, a null column, a missing column and an empty result", async () => {
  const { db } = countingDb();
  const timing = new D1Timing();
  const reads = renderReadDb(db, "published", timing);
  const stmt = reads.prepare(titleSql).bind(headline);
  expect(await stmt.first()).toEqual({ title: headline });
  expect(await stmt.first("title")).toBe(headline);
  await expect(stmt.first("missing")).rejects.toThrow("D1_COLUMN_NOTFOUND: Column not found (missing)");
  expect(await reads.prepare("SELECT 1 WHERE 0").first("missing")).toBeNull();
  const { db: nullDb } = makeFakeDb([], [{ match: "SELECT NULL", rows: [{ value: null }] }]);
  expect(await renderReadDb(nullDb, null, timing).prepare("SELECT NULL AS value").first("value")).toBeNull();
  expect(timing).toMatchObject({ calls: 5, rounds: 5, primary: 3, replica: 1, regions: new Set(["EEUR", "WNAM"]) });
});

it("records raw query metadata without losing duplicate columns, column order or empty-result headers", async () => {
  const columns = ["name", "1", "name"];
  const rows = [["first", 0, null]];
  const reply = (values: unknown[][], primary: boolean) => ({
    results: { columns, rows: values }, meta: { served_by_primary: primary, served_by_region: primary ? "EEUR" : "WNAM" },
  });
  const populated = reply(rows, false);
  const query = vi.fn<() => Promise<typeof populated | [typeof populated]>>()
    .mockResolvedValueOnce(populated).mockResolvedValueOnce([populated]).mockResolvedValueOnce(reply([], true));
  const session = { _sendOrThrow: query };
  const { db } = makeFakeDb();
  const native = Object.assign(db.prepare("SELECT 1"), {
    dbSession: session,
    // Model workerd's projection of a single query reply into positional rows.
    async raw(this: { dbSession: typeof session }, options?: { columnNames?: boolean }) {
      const response = await this.dbSession._sendOrThrow();
      const { results } = Array.isArray(response) ? response[0] : response;
      return options?.columnNames ? [results.columns, ...results.rows] : results.rows;
    },
  });
  vi.spyOn(db, "prepare").mockReturnValue(native);
  const timing = new D1Timing();
  const stmt = renderReadDb(db, "published", timing).prepare("SELECT 1");
  expect(await stmt.raw({ columnNames: true })).toEqual([columns, ...rows]);
  expect(await stmt.raw()).toEqual(rows);
  expect(await stmt.raw({ columnNames: true })).toEqual([columns]);
  expect(query.mock.contexts).toEqual([session, session, session]);
  expect(native.dbSession).toBe(session);
  expect(timing).toMatchObject({ calls: 3, rounds: 3, primary: 1, replica: 2, regions: new Set(["WNAM", "EEUR"]) });
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
