import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { minifiedPublicCss, minifiedPublicJs } from "../src/public/assets/public-assets.generated";
import { publicCss } from "../src/public/assets/public-css";
import { publicJs } from "../src/public/assets/public-js";
import publicRouter from "../src/public/router";
import { renderLayout } from "../src/public/templates/layout";
import { miniDocument } from "./helpers/mini-dom";

const origin = "https://tenant.example";
const layout = miniDocument(renderLayout({
  site: { name: "News", hostname: "tenant.example" }, meta: { title: "News" }, body: "",
}));
const assets = [
  { file: "public.css", selector: 'link[rel="stylesheet"]', attr: "href", raw: publicCss, minified: minifiedPublicCss },
  { file: "public.js", selector: "script[src][defer]", attr: "src", raw: publicJs, minified: minifiedPublicJs },
];

// Recompute the deployed URL format independently of the hashes in the generated file.
function versionOf(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
  return hash.toString(36);
}

describe("build-time minification of public assets", () => {
  it("rebuilds the committed module byte-for-byte from the TypeScript sources", () => {
    const generator = fileURLToPath(new URL("../scripts/build-public-assets.mjs", import.meta.url));
    execFileSync(process.execPath, [generator, "--check"]);
  });

  it.each(assets)("loads $file once at its minified content hash with immutable caching", async asset => {
    const paths = layout.querySelectorAll(asset.selector).map(tag => tag.getAttribute(asset.attr));
    const path = `/lg/runtime/assets/public.${versionOf(asset.minified)}.${asset.file.split(".")[1]}`;
    expect(paths).toEqual([path]);
    const response = await publicRouter.request(origin + path);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(await response.text()).toBe(asset.minified);
    expect(Buffer.byteLength(asset.minified)).toBeLessThan(Buffer.byteLength(asset.raw));
  });

  it.each(assets)("serves $file to a page carrying its pre-minification hash", async asset => {
    const previousVersion = versionOf(asset.raw);
    expect(previousVersion).not.toBe(versionOf(asset.minified));
    const response = await publicRouter.request(`${origin}/assets/${asset.file}?v=${previousVersion}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=86400");
    expect(await response.text()).toBe(asset.minified);
  });

  it("keeps the single stylesheet within 14 KB with either transfer encoding", () => {
    expect(brotliCompressSync(minifiedPublicCss).length).toBeLessThanOrEqual(14_000);
    expect(gzipSync(minifiedPublicCss).length).toBeLessThanOrEqual(14_000);
    expect(minifiedPublicCss).not.toMatch(/@import\b/i);
  });

  it("retains the home and article selectors for their cards, heroes, header and reading layout", () => {
    const classes = [
      "site-header", "hero", "card", "article-hero", "article-shell", "article-sidebar", "share-rail", "reading-progress-bar",
    ];
    for (const name of classes) {
      expect(minifiedPublicCss).toMatch(new RegExp(`\\.${name}(?=[,{])`));
    }
  });

  it("initializes progress, sharing, saved stories and newsletter handlers in the minified script", () => {
    const document = miniDocument(`<body><article class="article-shell">
      <div class="reading-progress-bar"></div>
      <button data-share data-share-title="News"></button><button data-share-action="save"></button>
      <form class="newsletter__form" action="/api/newsletter/subscribe"></form>
    </article></body>`);
    const bar = document.querySelector(".reading-progress-bar")!;
    const setProperty = vi.fn();
    Object.assign(bar.style, { setProperty });
    const url = origin + "/article/news";
    const window = {
      innerHeight: 600, addEventListener: vi.fn(), location: { href: url },
      localStorage: { getItem: () => JSON.stringify([url]) },
    };
    const share = vi.fn().mockResolvedValue(undefined);
    expect(minifiedPublicJs).not.toMatch(/=>|\b(?:const|let)\b/);
    runInNewContext(minifiedPublicJs, { document, window, navigator: { share } });

    expect(window.addEventListener).toHaveBeenCalledWith("scroll", expect.any(Function), { passive: true });
    expect(setProperty).toHaveBeenCalledWith("transform-origin", "left center");
    expect(bar.style.transform).toBe("scaleX(0.0000)");
    document.querySelector("[data-share]")!.click();
    expect(share).toHaveBeenCalledWith({ title: "News", url });
    const save = document.querySelector('[data-share-action="save"]')!;
    expect(save.getAttribute("aria-pressed")).toBe("true");
    expect(save.listeners.get("click")).toHaveLength(1);
    expect(document.querySelector("form")!.listeners.get("submit")).toHaveLength(1);
  });
});
