import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serveStatic } from "../src/edge/static-cache";
import worker from "../src/index";
import { renderLayout } from "../src/public/templates/layout";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";
import { ctxCapture } from "./helpers/leadgen-analytics-harness";

// SHA-256 of the seven original Fontsource 5.3.0 Latin files, independent of the generated module.
const fonts = [
  ["Nunito", 700, "fa89300b9bbb3bd0f60d6991aa055965d98e2ccca27bf8688fe0c39cdc796846"],
  ["Nunito", 800, "2363d3ed037283ebb961e8c4b4917e40a8bc8853cf9965cf1ea7b4daa1df630a"],
  ["Nunito", 900, "9ca32f5d8334579387361096944286df451272a557bb09bd906254a623aba99e"],
  ["Nunito Sans", 400, "d9976dd1dc9c0d65046b52810e7cc69cfc229ee9939628ffe637e17efe4ef1ed"],
  ["Nunito Sans", 600, "e03e312b8b7abd8b69ecef4060ded626f80e45723becd13676ad8273cf568a6e"],
  ["Nunito Sans", 700, "cb84238e7b852f2d22b91a598289f13b31cbc7a2d618fd2c0628ecb69459fbeb"],
  ["Nunito Sans", 800, "4c839e56cbef1bbdfd509670f523730e24298aaf9a7791e0151031b023c12e4c"],
] as const;
const files = fonts.map(([family, weight, sha256]) => ({
  family, weight, sha256,
  path: `/assets/fonts/${family.toLowerCase().replace(" ", "-")}-${weight}.${sha256.slice(0, 16)}.woff2`,
}));
const origin = "https://tenant.example";
const { db, calls } = makeFakeDb();
const env = buildEnv(db);
const html = renderLayout({ site: { name: "Test", hostname: "tenant.example" }, meta: { title: "Test" }, body: "" });
const head = html.match(/<head>([\s\S]*?)<\/head>/)![1]!;
const links = head.match(/<link\b[^>]*>/g) ?? [];
const href = (link: string) => link.match(/\bhref="([^"]+)"/)?.[1] ?? "";
const wrongHash = "/assets/fonts/nunito-700.0000000000000000.woff2";

afterEach(() => {
  vi.unstubAllGlobals();
  expect(calls.splice(0)).toEqual([]);
});

describe("self-hosted public fonts", () => {
  it("loads stylesheets from the tenant origin and removes both Google Fonts hosts", () => {
    expect(html).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/i);
    for (const link of links.filter(tag => tag.includes('rel="stylesheet"'))) {
      expect(new URL(href(link), origin).origin).toBe(origin);
    }
  });

  it("preloads the body and display heading files with matching anonymous font requests", () => {
    const preloads = links.filter(tag => tag.includes('rel="preload"') && tag.includes('as="font"'));
    const expected = files.filter(font =>
      (font.family === "Nunito Sans" && font.weight === 400) || (font.family === "Nunito" && font.weight === 800));
    expect(preloads.map(href).sort()).toEqual(expected.map(font => font.path).sort());
    for (const link of preloads) {
      expect(link).toContain('type="font/woff2"');
      expect(link).toMatch(/\scrossorigin(?:="anonymous")?(?=\s|>)/);
    }
  });

  it("declares each family and weight inline with a same-origin WOFF2 URL and swap", () => {
    const css = Array.from(head.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g), match => match[1]).join("\n");
    const faces = Array.from(css.matchAll(/@font-face\s*\{([^}]+)\}/g), match => match[1]!);
    expect(faces).toHaveLength(files.length);
    expect(css).not.toContain("data:font/");
    for (const { path, family, weight } of files) {
      const rule = faces.find(face => face.match(/\bsrc:\s*url\(["']?([^"')]+)["']?\)/)?.[1] === path);
      expect(rule, path).toMatch(new RegExp(`font-family:\\s*["']${family}["']`));
      expect(rule).toMatch(new RegExp(`font-weight:\\s*${weight}\\b`));
      expect(rule).toMatch(/font-display:\s*swap\b/);
    }
  });

  it.each(files)("serves the original $family $weight bytes with a one-year immutable lifetime", async ({ path, sha256 }) => {
    const response = await worker.fetch(new Request(origin + path), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("font/woff2");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
  });

  it.each([wrongHash, files[0]!.path.replace("/nunito-", "/unknown-")])("returns 404 for %s", async path => {
    const response = await worker.fetch(new Request(origin + path), env);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control") ?? "").not.toContain("immutable");
  });

  it("fills the edge cache once and serves the same bytes on the next request", async () => {
    const entries = new Map<string, Response>();
    const match = vi.fn<Cache["match"]>(async key => entries.get(new Request(key).url)?.clone());
    const put = vi.fn<Cache["put"]>(async (key, response) => { entries.set(new Request(key).url, response); });
    vi.stubGlobal("caches", { default: { match, put } });
    const { ctx, promises } = ctxCapture();
    const url = origin + files[0]!.path;
    const cold = await worker.fetch(new Request(url), env, ctx);
    expect(cold.headers.get("x-edge-cache")).toBe("MISS");
    await Promise.all(promises);
    const warm = await worker.fetch(new Request(url + "?v=again"), env, ctx);
    expect(warm.headers.get("x-edge-cache")).toBe("HIT");
    expect(await warm.arrayBuffer()).toEqual(await cold.arrayBuffer());
    expect(put).toHaveBeenCalledTimes(1);
    expect([...entries.keys()]).toEqual([url]);
  });

  it("bypasses unrelated paths and unknown font files before consulting the edge cache", async () => {
    const match = vi.fn();
    const upstream = vi.fn();
    vi.stubGlobal("caches", { default: { match } });
    for (const path of ["/article/news", "/assets/fonts-extra/test.woff2", "/assets/fonts/notes.txt", wrongHash]) {
      expect(await serveStatic(new Request(origin + path), env, undefined, upstream)).toBeNull();
    }
    expect(match).not.toHaveBeenCalled();
    expect(upstream).not.toHaveBeenCalled();
  });
});
