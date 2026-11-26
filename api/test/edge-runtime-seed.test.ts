import { afterEach, expect, it, vi } from "vitest";
import { LEADGEN_TEMPLATE_VERSION } from "../src/cache/cache-keys";
import { gatewayFetch } from "../src/edge/gateway";
import type { LeadgenSnapshotEntry } from "../src/edge/leadgen-select";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import { honoFetch } from "../src/index";
import { PUBLIC_FONT_FILES } from "../src/public/assets/public-fonts.generated";
import { LEADGEN_FONT_FILES } from "../src/public/leadgen/designs/fonts.generated";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";

const runtimePath = `/lg/runtime/${LEADGEN_TEMPLATE_VERSION}.js`;
const assetCount = 3 + PUBLIC_FONT_FILES.size + LEADGEN_FONT_FILES.size;
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
  return { ctx, entries, match, put, app, networkFetch, visit, finish };
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
  expect(put).toHaveBeenCalledTimes(assetCount);
  const runtimeWrites = put.mock.calls.filter(([request]) => new Request(request).url === key);
  expect(runtimeWrites).toHaveLength(1);
  const [writeKey, stored] = runtimeWrites[0]!;
  expect(new Request(writeKey).url).toBe(key);
  const seedLookups = match.mock.calls.slice(1).map(([request]) => new Request(request)).filter(request => request.url === key);
  expect(seedLookups).toHaveLength(1);
  const lookup = seedLookups[0]!;
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

it("holds overlapping shells during the first lookup and skips cache I/O on subsequent shells", async () => {
  const { ctx, visit, finish, match, put } = harness();
  const origin = "https://overlap.example";
  let release!: () => void;
  match.mockReturnValueOnce(new Promise(resolve => { release = () => resolve(undefined); }));
  const returned = vi.fn((response: Response) => response.status);
  const first = visit(origin + "/lg").then(returned);
  const second = visit(origin + "/lg/home").then(returned);
  await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(assetCount - 1));
  expect(match).toHaveBeenCalledTimes(assetCount);
  expect(returned).not.toHaveBeenCalled();
  expect(ctx.waitUntil).not.toHaveBeenCalled();
  release();
  expect(await Promise.all([first, second])).toEqual([200, 200]);
  await finish();
  expect((await visit(origin + "/lg")).status).toBe(200);
  expect(ctx.waitUntil).not.toHaveBeenCalled();
  expect(match).toHaveBeenCalledTimes(assetCount);
  expect(put).toHaveBeenCalledTimes(assetCount);
});

it("recognizes an already cached runtime and fills a different host independently", async () => {
  const { visit, finish, entries, match, put } = harness();
  entries.set("https://warm.example" + runtimePath, new Response("already cached"));
  for (const host of ["warm.example", "warm.example", "another.example"]) {
    expect((await visit(`https://${host}/lg`)).status).toBe(200);
    await finish();
  }
  expect(match).toHaveBeenCalledTimes(assetCount * 2);
  expect(put).toHaveBeenCalledTimes(assetCount * 2 - 1);
  const runtimeKeys = (calls: [RequestInfo | URL, ...unknown[]][]) => calls
    .map(([key]) => new Request(key).url).filter(key => key.endsWith(runtimePath));
  expect(runtimeKeys(match.mock.calls)).toEqual([
    "https://warm.example" + runtimePath, "https://another.example" + runtimePath,
  ]);
  expect(runtimeKeys(put.mock.calls)).toEqual(["https://another.example" + runtimePath]);
});

it("serves the shell through a failed cache write and completes the fill on the next shell", async () => {
  const { visit, finish, entries, match, put } = harness();
  let failRuntime = true;
  put.mockImplementation(async (key, file) => {
    const url = new Request(key).url;
    if (url.endsWith(runtimePath) && failRuntime) {
      failRuntime = false;
      throw new Error("cache unavailable");
    }
    entries.set(url, file);
  });
  for (let i = 0; i < 3; i++) {
    expect((await visit("https://recover.example/lg")).status).toBe(200);
    await finish();
  }
  expect(match).toHaveBeenCalledTimes(2 * assetCount);
  expect(put).toHaveBeenCalledTimes(assetCount + 1);
  expect(put.mock.calls.filter(([key]) => new Request(key).url.endsWith(runtimePath))).toHaveLength(2);
});

it.each([
  ["HEAD", "/lg", 200, "text/html", 200],
  ["GET", "/lg/home", 404, "text/html", 404],
  ["GET", "/lg/home", 200, "text/html", 304],
  ["GET", "/lg/home", 200, "application/json", 200],
  ["GET", "/article/news", 200, "text/markdown", 200],
] as const)("skips seeding for %s %s with inner %i %s and final status %i", async (method, path, status, type, final) => {
  const { ctx, visit, match, put } = harness(status, type);
  const headers = final === 304 ? { "If-None-Match": '"shell"' } : undefined;
  expect((await visit("https://skip.example" + path, { method, headers })).status).toBe(final);
  expect(ctx.waitUntil).not.toHaveBeenCalled();
  expect(match).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});
