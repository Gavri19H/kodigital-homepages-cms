import { afterEach, expect, it, vi } from "vitest";
import { LEADGEN_TEMPLATE_VERSION } from "../src/cache/cache-keys";
import { gatewayFetch } from "../src/edge/gateway";
import type { PublicPageProps, SiteSnapshot } from "../src/edge/types";
import { honoFetch } from "../src/index";
import { PUBLIC_FONT_FILES } from "../src/public/assets/public-fonts.generated";
import { LEADGEN_FONT_FILES } from "../src/public/leadgen/designs/fonts.generated";
import { PUBLIC_CSS_PATH, PUBLIC_JS_PATH, renderLayout } from "../src/public/templates/layout";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";
import { ctxCapture } from "./helpers/leadgen-analytics-harness";

const paths = [
  PUBLIC_CSS_PATH, PUBLIC_JS_PATH, ...PUBLIC_FONT_FILES.keys(), ...LEADGEN_FONT_FILES.keys(),
  `/lg/runtime/${LEADGEN_TEMPLATE_VERSION}.js`,
];

function installCache() {
  const files = new Map<string, Response>();
  const match = vi.fn<Cache["match"]>(async key => files.get(new Request(key).url)?.clone());
  const put = vi.fn<Cache["put"]>(async (key, response) => { files.set(new Request(key).url, response); });
  vi.stubGlobal("caches", { default: { match, put } });
  return { files, match, put };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("holds a cached article until Stage 1 can read every file with the current route's bytes and headers", async () => {
  const hostname = "editorial-split.example";
  const origin = "https://" + hostname;
  const { db, calls } = makeFakeDb([{ match: "FROM domains d INNER JOIN sites", row: {
    site_id: "editorial", hostname, status: "active",
  } }]);
  const env = { ...buildEnv(db), EDGE_HEDGE_MS: "0" };
  const { ctx } = ctxCapture();
  const html = renderLayout({ site: { name: "News", hostname }, meta: { title: "Article" }, body: "Story" });
  Object.assign(ctx, { exports: {
    PublicPage: ({ props }: { props: PublicPageProps }) => ({
      fetch: async () => props.variantKey === "snap" ? Response.json({
        v: 1, siteId: "editorial", hostname, status: "active", contentVersion: 1, settingsVersion: 1,
        writeBookmark: null, builtAt: 1, timeZone: null, language: null, listicles: {}, leadgen: {},
      } satisfies SiteSnapshot) : new Response(html, { headers: { "Content-Type": "text/html", "cf-cache-status": "HIT" } }),
    }),
  } });
  const network = vi.fn(() => { throw new Error("unexpected network fetch"); });
  vi.stubGlobal("fetch", network);
  const app = vi.fn(honoFetch);
  const { match, put, files } = installCache();
  let release!: () => void;
  const pendingWrite = new Promise<void>(resolve => { release = resolve; });
  put.mockImplementation(async (key, response) => {
    const url = new Request(key).url;
    if (url === origin + PUBLIC_CSS_PATH) await pendingWrite;
    files.set(url, response);
  });

  const returned = vi.fn((response: Response) => response);
  const page = gatewayFetch(new Request(origin + "/article/story?campaign=a", {
    headers: { Cookie: "ko_sid=visitor", Range: "bytes=0-3" },
  }), env, ctx, app).then(returned);
  try {
    await vi.waitFor(() => expect(files.size).toBe(paths.length - 1));
    expect(returned).not.toHaveBeenCalled();
  } finally {
    release();
  }
  const response = await page;
  expect(response.status).toBe(200);
  expect(response.headers.get("x-edge-cache")).toBe("HIT");
  expect(await response.text()).toBe(html);
  expect(app).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
  expect(match).toHaveBeenCalledTimes(paths.length);
  expect(put).toHaveBeenCalledTimes(paths.length);
  expect([...files.keys()].sort()).toEqual(paths.map(path => origin + path).sort());
  for (const [key] of match.mock.calls) expect([...new Request(key).headers]).toEqual([]);

  for (const path of paths) {
    // This is the /lg/runtime/ branch of c38f5840's serveStatic: on a hit
    // the old router never gets an opportunity to substitute its own bytes.
    expect(path).toMatch(/^\/lg\/runtime\//);
    const url = new URL(path + "?visit=old-version", origin);
    const hit = await caches.default.match(new Request(url.origin + url.pathname));
    const route = await honoFetch(new Request(url), env);
    expect(route.status, path).toBe(200);
    expect(hit?.status, path).toBe(200);
    expect(hit!.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect([...hit!.headers], path).toEqual([...route.headers]);
    expect(Buffer.from(await hit!.arrayBuffer()).equals(Buffer.from(await route.arrayBuffer())), path).toBe(true);
  }
  expect(network).not.toHaveBeenCalled();
});

it("seeds a live HTML fallback under the rewritten tenant origin", async () => {
  const { files } = installCache();
  const env = { ...buildEnv(makeFakeDb().db), PERFSTAGE: "true", ADMIN_HOST: "stage.example" };
  const request = new Request("https://stage.example/preview/story", { headers: { "x-perfstage-host": "news.example" } });
  const response = await gatewayFetch(request, env, undefined, () =>
    new Response("preview", { headers: { "Content-Type": "text/html; charset=utf-8" } }));
  expect(await response.text()).toBe("preview");
  expect([...files.keys()].sort()).toEqual(paths.map(path => "https://news.example" + path).sort());
});

it.each([
  ["HEAD", 200, "text/html"], ["POST", 200, "text/html"], ["GET", 302, "text/html"],
  ["GET", 304, "text/html"], ["GET", 404, "text/html"], ["GET", 500, "text/html"],
  ["GET", 200, "text/html-fragment"], ["GET", 200, "application/json"],
] as const)("skips asset seeding for a live %s with status %i and type %s", async (method, status, type) => {
  const { match, put } = installCache();
  const request = new Request("https://live-skip.example/preview/page", { method });
  const response = await gatewayFetch(request, buildEnv(makeFakeDb().db), undefined, () =>
    new Response(null, { status, headers: { "Content-Type": type } }));
  expect(response.status).toBe(status);
  expect(match).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
});
