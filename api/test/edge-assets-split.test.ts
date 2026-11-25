import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gatewayFetch } from "../src/edge/gateway";
import { minifiedPublicCss, minifiedPublicJs } from "../src/public/assets/public-assets.generated";
import { publicCss } from "../src/public/assets/public-css";
import { publicJs } from "../src/public/assets/public-js";
import publicRouter from "../src/public/router";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";

// Stage 1 (c38f5840) reads /lg/runtime/* by origin + pathname. Its public
// router serves its own unminified bytes even under another release's hash.
const previousRelease = new Hono()
  .get("/lg/runtime/*", async c => {
    const url = new URL(c.req.url);
    return await caches.default.match(url.origin + url.pathname) ?? c.notFound();
  })
  .get("/assets/public.css", () => new Response(publicCss, {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  }))
  .get("/assets/public.js", () => new Response(publicJs, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  }))
  .get("/assets/:file{public\\.[a-z0-9]+\\.(?:css|js)}", c => {
    const css = c.req.path.endsWith(".css");
    return new Response(css ? publicCss : publicJs, { headers: {
      "Content-Type": css ? "text/css; charset=utf-8" : "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    } });
  });

// Derive the expected version from the bytes using the original rollout hash.
function contentVersion(body: string): string {
  let hash = 5381;
  for (let i = 0; i < body.length; i++) {
    hash = (33 * hash + body.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

describe("public assets during a gradual release", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([
    ["css", /<link rel="stylesheet" href="([^"]+)">/, minifiedPublicCss, publicCss, "text/css"],
    ["js", /<script src="([^"]+)" defer><\/script>/, minifiedPublicJs, publicJs, "text/javascript"],
  ] as const)("loads the new homepage's %s from the previous worker", async (ext, link, currentBody, previousBody, type) => {
    const hostname = ext + ".split.example";
    const { db } = makeFakeDb([{ match: "FROM domains d INNER JOIN sites", row: {
      site_id: "site-a", hostname, status: "active",
    } }]);
    const env = buildEnv(db);
    Object.assign(env.CACHE, { getWithMetadata: async () => ({ value: null, metadata: null }) });
    const files = new Map<string, Response>();
    vi.stubGlobal("caches", { default: {
      match: async (key: RequestInfo) => files.get(new Request(key).url)?.clone(),
      put: async (key: RequestInfo, file: Response) => { files.set(new Request(key).url, file); },
    } });
    const homepageUrl = `https://${hostname}/`;
    const page = await gatewayFetch(new Request(homepageUrl), env, undefined, publicRouter.fetch);
    expect(page.status).toBe(200);
    const path = (await page.text()).match(link)?.[1];
    const version = contentVersion(currentBody);
    expect(path).toBe(`/lg/runtime/assets/public.${version}.${ext}`);

    const asset = await previousRelease.request(new URL(path!, homepageUrl).href);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Content-Type")).toBe(type + "; charset=utf-8");
    expect(asset.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(await asset.text()).toBe(currentBody);

    for (const [oldUrl, control] of [
      [`/assets/public.${ext}?v=${version}`, "public, max-age=86400"],
      [`/assets/public.${version}.${ext}`, "public, max-age=31536000, immutable"],
    ] as const) {
      const legacy = await previousRelease.request(oldUrl);
      expect(legacy.status).toBe(200);
      expect(legacy.headers.get("Content-Type")).toBe(type + "; charset=utf-8");
      expect(legacy.headers.get("Cache-Control")).toBe(control);
      expect(await legacy.text()).toBe(previousBody);
    }
  });
});
