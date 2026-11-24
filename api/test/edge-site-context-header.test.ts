import { Hono } from "hono";
import { expect, it, onTestFinished, vi } from "vitest";
import { gatewayFetch } from "../src/edge/gateway";
import { PublicPage } from "../src/edge/public-page";
import { buildSiteSnapshot } from "../src/edge/snapshot";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import type { Env } from "../src/env";
import { publicSiteContextMiddleware, type PublicSiteVariables } from "../src/public/middleware";
import type { SiteContext } from "../src/site/site-context";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";
import { ctxCapture } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv } from "./helpers/x06-a2-sqlite";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const headerName = "x-cms-site-context";
const site: SiteContext = {
  site_id: "journal", hostname: "edition.example", vertical_slug: "travel", status: "active",
  content_version: 17, settings_version: 4,
};
const url = "https://EDITION.Example.:8443/";
const otherSite = { ...site, site_id: "neighbor" };
const probe = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
probe.use(publicSiteContextMiddleware);
probe.get("/", c => c.json({ site: c.var.site, siteContext: c.var.siteContext }));
const expectedVars = { site, siteContext: { ...site, siteId: site.site_id } };

it("uses the normalized request host and sets both context variables without a tenant read", async () => {
  const { db, calls } = makeFakeDb();
  const response = await probe.request(url, { headers: { [headerName]: JSON.stringify(site) } },
    { ...buildEnv(db), EDGE_INNER: "1" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(expectedVars);
  expect(calls).toHaveLength(0);
});

it.each([
  ["another hostname", "1", JSON.stringify({ ...otherSite, hostname: "neighbor.example" })],
  ["a non-active status", "1", JSON.stringify({ ...otherSite, status: "disabled" })],
  ["invalid JSON", "1", "{"],
  ["a non-object", "1", "null"],
  ["a blank site ID", "1", JSON.stringify({ ...otherSite, site_id: " " })],
  ["a missing vertical", "1", JSON.stringify({ ...otherSite, vertical_slug: undefined })],
  ["a nonnumeric content version", "1", JSON.stringify({ ...otherSite, content_version: "17" })],
  ["a missing settings version", "1", JSON.stringify({ ...otherSite, settings_version: undefined })],
  ["no EDGE_INNER", undefined, JSON.stringify(otherSite)],
  ["a nonliteral EDGE_INNER", "true", JSON.stringify(otherSite)],
] as const)("uses the registry row for %s", async (_reason, marker, header) => {
  const { db, calls } = makeFakeDb([{ match: "FROM domains", row: site }]);
  const response = await probe.request(url, { headers: { [headerName]: header } }, { ...buildEnv(db), EDGE_INNER: marker });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(expectedVars);
  expect(calls).toEqual([{ sql: expect.stringContaining("FROM domains"), binds: [site.hostname] }]);
});

it("keeps the admin host's safe 404 even with a matching active inner header", async () => {
  const { db, calls } = makeFakeDb();
  const env = { ...buildEnv(db), ADMIN_HOST: site.hostname, EDGE_INNER: "1" };
  const response = await probe.request(url, { headers: { [headerName]: JSON.stringify(site) } }, env);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "Not Found" });
  expect(calls).toHaveLength(0);
});

it("returns 410 when the fallback lookup finds a disabled site", async () => {
  const { db, calls } = makeFakeDb([{ match: "SELECT s.status AS status", row: { status: "disabled" } }]);
  const response = await probe.request(url, { headers: { [headerName]: JSON.stringify({ ...site, status: "draft" }) } },
    { ...buildEnv(db), EDGE_INNER: "1" });
  expect(response.status).toBe(410);
  expect(await response.json()).toEqual({ error: "Gone" });
  expect(calls.map(call => call.binds)).toEqual([[site.hostname], [site.hostname]]);
});

it("strips client context and builds byte-identical home HTML in one D1 round instead of two", async () => {
  const sql = createDb();
  const env = sqliteEnv(sql);
  const { ctx, promises } = ctxCapture();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 10, 24));
  onTestFinished(async () => {
    await Promise.all(promises);
    vi.restoreAllMocks();
    vi.useRealTimers();
    sql.close();
  });

  addSite(sql, site.site_id, "Journal", site.vertical_slug);
  sql.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(site.site_id, site.hostname);
  sql.prepare("UPDATE sites SET content_version = ?, settings_version = ? WHERE id = ?")
    .run(site.content_version, site.settings_version, site.site_id);
  const headline = "A café on the ridge";
  sql.prepare("INSERT INTO articles (site_id, slug, title, content_json, status, published_at) VALUES (?, ?, ?, ?, 'published', 100)")
    .run(site.site_id, "ridge", headline, '{"blocks":[]}');
  env.DB.batch = <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(stmt => stmt.all<T>()));
  const snapshot = await buildSiteSnapshot(env, site.hostname);
  if (!snapshot) throw new Error("Expected a snapshot for the seeded host");
  const { verticalSlug, ...legacy } = snapshot;
  expect(verticalSlug).toBe(site.vertical_slug);

  // Replay a warm host snapshot. Both requests execute the real PublicPage MISS and Hono homepage.
  let cachedSnapshot: SiteSnapshot = legacy;
  const forwarded: (string | null)[] = [];
  Object.assign(ctx, { exports: {
    PublicPage: ({ props }: { props: PublicPageProps }) => ({
      async fetch(request: Request) {
        if (props.variantKey === "snap") return Response.json(cachedSnapshot, { headers: { "cf-cache-status": "HIT" } });
        forwarded.push(request.headers.get(headerName));
        const page = await new PublicPage({ ...ctx, props }, env).fetch(request);
        page.headers.set("cf-cache-status", "MISS");
        return page;
      },
    }),
  } });
  const fallback = vi.fn(() => new Response("unexpected live fallback", { status: 500 }));
  const visit = () => gatewayFetch(new Request(url, { headers: { [headerName]: JSON.stringify(otherSite) } }), env, ctx, fallback);
  const executed = vi.spyOn(sql, "prepare");
  const tenantReads = () => executed.mock.calls.filter(([query]) => /\bFROM domains\b/i.test(query));

  const baseline = await visit();
  expect(baseline.status).toBe(200);
  expect(baseline.headers.get("x-edge-cache")).toBe("MISS");
  expect(forwarded).toEqual([null]);
  expect(tenantReads()).toHaveLength(1);
  expect(baseline.headers.get("Server-Timing")).toMatch(/\bd1;dur=\d+;desc="rounds=2 /);
  const bytes = await baseline.bytes();
  expect(new TextDecoder().decode(bytes)).toContain(headline);

  cachedSnapshot = snapshot;
  executed.mockClear();
  const optimized = await visit();
  expect(optimized.status).toBe(200);
  expect(optimized.headers.get("x-edge-cache")).toBe("MISS");
  expect(forwarded).toHaveLength(2);
  expect(JSON.parse(forwarded[1]!)).toEqual(site);
  expect(tenantReads()).toHaveLength(0);
  expect(optimized.headers.get("Server-Timing")).toMatch(/\bd1;dur=\d+;desc="rounds=1 /);
  expect(await optimized.bytes()).toEqual(bytes);
  expect(optimized.headers.get("ETag")).toBe(baseline.headers.get("ETag"));
  expect(fallback).not.toHaveBeenCalled();
});
