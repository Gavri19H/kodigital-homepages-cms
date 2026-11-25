import { afterEach, expect, it, vi } from "vitest";
import { LEADGEN_TEMPLATE_VERSION } from "../src/cache/cache-keys";
import { gatewayFetch } from "../src/edge/gateway";
import type { LeadgenSnapshotEntry } from "../src/edge/leadgen-select";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import { honoFetch } from "../src/index";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";

const runtimePath = `/lg/runtime/${LEADGEN_TEMPLATE_VERSION}.js`;
const quote: LeadgenSnapshotEntry = {
  quoteId: "lgq_00000000000000000000000001", defaultFunnelId: 1, rules: [], offerLocations: {},
  funnels: [{ id: 1, abTest: null, variants: [
    { public_id: "lgn_00000000000000000000000001", variant_label: "A", traffic_allocation_bp: 10000 },
  ] }],
};
const shell = `<html><head><script src="${runtimePath}" defer></script></head><body><!--LG_ASSIGN--></body></html>`;
const { db } = makeFakeDb([{
  match: "FROM domains d INNER JOIN sites",
  row: { site_id: "site-a", hostname: "split.example", status: "active" },
}]);
const env = { ...buildEnv(db), EDGE_HEDGE_MS: "0" };

function harness(status = 200, contentType = "text/html; charset=utf-8") {
  const entries = new Map<string, Response>();
  const match = vi.fn<Cache["match"]>(async key => entries.get(new Request(key).url)?.clone());
  const put = vi.fn<Cache["put"]>(async (key, response) => { entries.set(new Request(key).url, response); });
  vi.stubGlobal("caches", { default: { match, put } });
  const networkFetch = vi.fn(() => { throw new Error("unexpected network request"); });
  vi.stubGlobal("fetch", networkFetch);
  vi.spyOn(Math, "random").mockReturnValue(0.5); // Skip sampled cache statistics.
  const ctx = {
    props: {}, passThroughOnException() {}, waitUntil: vi.fn<(task: Promise<unknown>) => void>(),
    get tracing(): never { throw new Error("unexpected tracing access"); },
    exports: {
      PublicPage: ({ props }: { props: PublicPageProps }) => ({
        async fetch(request: Request) {
          if (props.variantKey === "snap") return Response.json({
            v: 1, siteId: "site-a", hostname: new URL(request.url).hostname, status: "active",
            contentVersion: 1, settingsVersion: 1, writeBookmark: null, timeZone: null, language: null,
            builtAt: 1, listicles: {}, leadgen: { "/lg": quote, home: quote },
          } satisfies SiteSnapshot);
          return new Response(shell, { status, headers: {
            "Content-Type": contentType, ETag: '"shell"', "cf-cache-status": "HIT",
          } });
        },
      }),
    },
  } satisfies ExecutionContext;
  const app = vi.fn(honoFetch);
  const visit = (url: string, init?: RequestInit) => gatewayFetch(new Request(url, init), env, ctx, app);
  const finish = () => Promise.all(ctx.waitUntil.mock.calls.map(([task]) => task));
  return { ctx, match, put, app, networkFetch, visit, finish };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("seeds the exact immutable runtime for an older Worker whose route returns 404", async () => {
  const { ctx, visit, finish, match, put, app, networkFetch } = harness();
  const origin = "https://split.example";
  const key = origin + runtimePath;
  const oldRoute = vi.fn(() => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } }));
  const oldRuntime = () => gatewayFetch(new Request(key), env, ctx, oldRoute);
  const cold = await oldRuntime();
  expect(cold.status).toBe(404);
  expect(cold.headers.get("Cache-Control")).toBe("no-store");
  expect(put).not.toHaveBeenCalled();

  const response = await visit(origin + "/lg/home?utm_source=visitor", { headers: { Cookie: "ko_sid=visitor" } });
  expect(response.status).toBe(200);
  expect(response.headers.get("x-edge-cache")).toBe("HIT");
  expect(await response.text()).toContain(`src="${runtimePath}"`);
  await finish();
  expect(put).toHaveBeenCalledTimes(1);
  const [writeKey, stored] = put.mock.calls[0]!;
  expect(new Request(writeKey).url).toBe(key);
  const lookup = new Request(match.mock.calls[1]![0]);
  expect(lookup.url).toBe(key);
  expect([...lookup.headers]).toEqual([]);

  const route = await honoFetch(new Request(key), env);
  expect(route.status).toBe(200);
  expect(stored.status).toBe(route.status);
  expect(stored.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  expect([...stored.headers]).toEqual([...route.headers]);
  const bytes = Buffer.from(await route.arrayBuffer());
  expect(Buffer.from(await stored.clone().arrayBuffer()).equals(bytes)).toBe(true);

  const warm = await oldRuntime();
  expect(warm.status).toBe(200);
  expect(warm.headers.get("x-edge-cache")).toBe("HIT");
  expect(Buffer.from(await warm.arrayBuffer()).equals(bytes)).toBe(true);
  expect(oldRoute).toHaveBeenCalledTimes(1);
  expect(app).not.toHaveBeenCalled();
  expect(networkFetch).not.toHaveBeenCalled();
});

it("returns overlapping shells during the first lookup and skips cache I/O on subsequent shells", async () => {
  const { ctx, visit, finish, match, put } = harness();
  const origin = "https://overlap.example";
  let release!: () => void;
  match.mockReturnValueOnce(new Promise(resolve => { release = () => resolve(undefined); }));
  expect((await visit(origin + "/lg")).status).toBe(200);
  expect((await visit(origin + "/lg/home")).status).toBe(200);
  expect(match).toHaveBeenCalledTimes(1);
  expect(put).not.toHaveBeenCalled();
  expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  release();
  await finish();
  expect((await visit(origin + "/lg")).status).toBe(200);
  expect(ctx.waitUntil).toHaveBeenCalledTimes(1);
  expect(match).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledTimes(1);
});

it("recognizes an already cached runtime and fills a different host independently", async () => {
  const { visit, finish, match, put } = harness();
  match.mockResolvedValueOnce(new Response("already cached"));
  for (const host of ["warm.example", "warm.example", "another.example"]) {
    expect((await visit(`https://${host}/lg`)).status).toBe(200);
    await finish();
  }
  expect(match.mock.calls.map(([key]) => new Request(key).url)).toEqual([
    "https://warm.example" + runtimePath, "https://another.example" + runtimePath,
  ]);
  expect(put.mock.calls.map(([key]) => new Request(key).url)).toEqual(["https://another.example" + runtimePath]);
});

it("serves the shell through a failed cache write and completes the fill on the next shell", async () => {
  const { visit, finish, put } = harness();
  put.mockRejectedValueOnce(new Error("cache unavailable"));
  for (let i = 0; i < 3; i++) {
    expect((await visit("https://recover.example/lg")).status).toBe(200);
    await finish();
  }
  expect(put).toHaveBeenCalledTimes(2);
});

it.each([
  ["HEAD", "/lg", 200, "text/html", 200],
  ["GET", "/lg/home", 404, "text/html", 404],
  ["GET", "/lg/home", 200, "text/html", 304],
  ["GET", "/lg/home", 200, "application/json", 200],
  ["GET", "/article/news", 200, "text/html", 200],
] as const)("skips seeding for %s %s with inner %i %s and final status %i", async (method, path, status, type, final) => {
  const { ctx, visit, match, put } = harness(status, type);
  const headers = final === 304 ? { "If-None-Match": '"shell"' } : undefined;
  expect((await visit("https://skip.example" + path, { method, headers })).status).toBe(final);
  expect(ctx.waitUntil).not.toHaveBeenCalled();
  expect(match).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});
