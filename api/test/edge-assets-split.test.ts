import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { publicCss } from "../src/public/assets/public-css";
import { publicJs } from "../src/public/assets/public-js";
import publicRouter from "../src/public/router";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";

// The two literal Hono routes from 267a0b81 ignore the query string.
const previousRelease = new Hono()
  .get("/assets/public.css", () => new Response(publicCss, {
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  }))
  .get("/assets/public.js", () => new Response(publicJs, {
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  }));

// Derive the expected version from the bytes using the original rollout hash.
function contentVersion(body: string): string {
  let hash = 5381;
  for (let i = 0; i < body.length; i++) {
    hash = (33 * hash + body.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

describe("public assets during a gradual release", () => {
  it.each([
    ["css", /<link rel="stylesheet" href="(\/assets\/[^"]+)">/, publicCss, "text/css"],
    ["js", /<script src="(\/assets\/[^"]+)" defer><\/script>/, publicJs, "text/javascript"],
  ] as const)("loads the new homepage's %s from the previous worker", async (ext, link, body, type) => {
    const hostname = "tenant.example";
    const { db } = makeFakeDb([{ match: "FROM domains d INNER JOIN sites", row: {
      site_id: "site-a", hostname, status: "active",
    } }]);
    const env = buildEnv(db);
    Object.assign(env.CACHE, { getWithMetadata: async () => ({ value: null, metadata: null }) });
    const homepageUrl = `https://${hostname}/`;
    const page = await publicRouter.request(homepageUrl, {}, env);
    expect(page.status).toBe(200);
    const path = (await page.text()).match(link)?.[1];
    const version = contentVersion(body);
    expect(path).toBe(`/assets/public.${ext}?v=${version}`);

    const asset = await previousRelease.request(new URL(path!, homepageUrl).href);
    expect(asset.status).toBe(200);
    expect(asset.headers.get("Content-Type")).toBe(type + "; charset=utf-8");
    expect(asset.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(await asset.text()).toBe(body);
    expect((await previousRelease.request(`/assets/public.${version}.${ext}`)).status).toBe(404);
  });
});
