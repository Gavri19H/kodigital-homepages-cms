import { readFileSync } from "node:fs";
import { brotliCompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import config from "../scripts/perf/speed-gate.config.json";
// @ts-expect-error The standalone Node ESM CLI has no TypeScript declaration file.
import { containsEmbeddedFont, evaluateBudgets, fixtureHtml, medianScore, validateConfig } from "../scripts/perf/speed-gate.mjs";
import { buildSeedSql } from "../scripts/seed/seed-sql";
import type { Env } from "../src/env";
import { honoFetch } from "../src/index";
import { buildLeadgenEnv, d1FromSqlite, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { parseHtml } from "./helpers/mini-dom";
import { createDb, type SqliteDb } from "./helpers/x06-a2-sqlite";

const quote = { ...config.pages.find(p => p.type === "quote")!, lighthouse: config.lighthouse };
const image = { url: "/media/hero.webp", width: "768", height: "512", broken: false };
const navigation = {
  url: "http://localhost:8787/lg/home", score: 100, htmlBytes: quote.htmlBytes, brotliBytes: quote.brotliBytes,
  quoteRuntimeBytes: 57_344, images: [image], embeddedFonts: [],
  lcp: { tag: "IMG", url: image.url, loading: "eager", fetchPriority: "high" },
  stylesheets: [{ url: "/site.css", blocking: true }, { url: "https://other.test/print.css", blocking: false }],
};

describe("speed gate configuration", () => {
  it("covers all seven page types with the contract scores and the quote runtime ceiling", () => {
    const pages = validateConfig(config);
    expect(pages.map((p: { type: string }) => p.type).sort())
      .toEqual(["article", "category", "home", "listicle", "page", "quote", "tag"]);
    for (const page of pages) expect(page.lighthouse).toEqual({ mobile: 95, desktop: 100 });
    expect(quote.quoteRuntimeBytes).toBe(57_344);
  });

  it("defaults to 95/100 and applies site-wide and per-page score thresholds", () => {
    expect(validateConfig({ pages: config.pages })[0].lighthouse).toEqual({ mobile: 95, desktop: 100 });
    const pages = validateConfig({
      lighthouse: { mobile: 96 },
      pages: config.pages.map(p => p.type === "quote" ? { ...p, lighthouse: { desktop: 99 } } : p),
    });
    expect(pages.find((p: { type: string }) => p.type === "quote").lighthouse).toEqual({ mobile: 96, desktop: 99 });
    expect(pages.find((p: { type: string }) => p.type === "home").lighthouse).toEqual({ mobile: 96, desktop: 100 });
  });

  it("rejects missing types and duplicate types or paths", () => {
    expect(() => validateConfig({ pages: [] })).toThrow("Missing page type");
    expect(() => validateConfig({ pages: [...config.pages, quote] })).toThrow("duplicate page type");
    expect(() => validateConfig({ pages: [...config.pages, { ...quote, type: "extra" }] })).toThrow("unique local path");
  });

  it.each(["https://other.test/", "//other.test/page", "/\\other.test", "lg/home"])("rejects non-local path %s", path => {
    expect(() => validateConfig({ pages: [{ ...quote, path }] })).toThrow("local path");
  });

  it.each([
    { htmlBytes: 0 }, { brotliBytes: -1 }, { quoteRuntimeBytes: undefined }, { selector: "" },
    { lighthouse: { mobile: "95" } }, { lighthouse: { desktop: 101 } }, { lighthouse: { moblie: 95 } },
  ])("rejects an unusable page budget %j", patch => {
    const pages = config.pages.map(page => page.type === "quote" ? { ...page, ...patch } : page);
    expect(() => validateConfig({ pages })).toThrow(/quote/);
  });
});

describe("speed gate verdict", () => {
  it.each(["mobile", "desktop"] as const)("passes exact inclusive score and byte limits on %s", profile => {
    expect(evaluateBudgets(quote, profile, { ...navigation, score: quote.lighthouse[profile] })).toEqual([]);
  });

  it.each([
    ["mobile", "score", 94, "mobile"], ["desktop", "score", 99, "desktop"],
    ["mobile", "score", null, "mobile"], ["mobile", "htmlBytes", quote.htmlBytes + 1, "htmlBytes"],
    ["mobile", "brotliBytes", quote.brotliBytes + 1, "brotliBytes"], ["mobile", "quoteRuntimeBytes", 57_345, "quoteRuntimeBytes"],
    ["mobile", "quoteRuntimeBytes", 0, "quoteRuntimeBytes"], ["mobile", "quoteRuntimeBytes", undefined, "quoteRuntimeBytes"],
  ] as const)("fails %s %s=%s with its metric", (profile, key, value, metric) => {
    expect(evaluateBudgets(quote, profile, { ...navigation, [key]: value })).toMatchObject([{ metric }]);
  });

  it("uses the numeric median of the measured Lighthouse runs and rejects incomplete scores", () => {
    expect(medianScore([100, 9, 95])).toBe(95);
    expect(medianScore([94, 100, 90])).toBe(94);
    for (const invalid of [[], [94, 100], [null], [NaN], [Infinity], [-1], [101]]) {
      expect(() => medianScore(invalid)).toThrow("Lighthouse scores");
    }
  });

  it("finds font data URIs in both HTML and CSS without rejecting image data URIs", () => {
    for (const css of [
      '<style>p{src:url("data:font/woff2;base64,AAAA")}</style>',
      "@font-face {font-family:x; src:url('data:application/octet-stream;base64,AA')}",
      "src:url(DATA:APPLICATION/X-FONT-WOFF;base64,AAAA)",
    ]) expect(containsEmbeddedFont(css)).toBe(true);
    expect(containsEmbeddedFont("p{background:url(data:image/png;base64,AA)}")).toBe(false);
    expect(evaluateBudgets(quote, "mobile", { ...navigation, embeddedFonts: ["/theme.css"] }))
      .toMatchObject([{ metric: "embeddedFonts", actual: ["/theme.css"] }]);
  });

  it("requires both intrinsic dimensions on each same-origin image and detects a broken fixture image", () => {
    const images = [
      { ...image, width: null }, { ...image, height: "0" }, { ...image, broken: true },
      { ...image, width: null, url: "https://other.test/pixel" },
    ];
    expect(evaluateBudgets(quote, "mobile", { ...navigation, images }))
      .toMatchObject([{ metric: "imageDimensions" }, { metric: "imageDimensions" }, { metric: "imageLoad" }]);
  });

  it("checks both priority hints on the actual LCP image", () => {
    for (const patch of [{ loading: "lazy" }, { loading: null }, { fetchPriority: "auto" }]) {
      expect(evaluateBudgets(quote, "mobile", { ...navigation, lcp: { ...navigation.lcp, ...patch } }))
        .toMatchObject([{ metric: "lcpImage" }]);
    }
  });

  it("accepts text LCP and preloaded background LCP and fails missing LCP evidence", () => {
    const background = { tag: "DIV", url: image.url, preloadedHigh: true };
    for (const lcp of [{ tag: "H1", url: "" }, background]) {
      expect(evaluateBudgets(quote, "mobile", { ...navigation, lcp })).toEqual([]);
    }
    expect(evaluateBudgets(quote, "mobile", { ...navigation, lcp: { ...background, preloadedHigh: false } }))
      .toMatchObject([{ metric: "lcpImage" }]);
    expect(evaluateBudgets(quote, "mobile", { ...navigation, lcp: null })).toMatchObject([{ metric: "lcpElement" }]);
  });

  it("reports a render-blocking third-party stylesheet even at an extensionless URL", () => {
    const url = "https://other.test/styles?v=42";
    const stylesheets = [...navigation.stylesheets, { url, blocking: true }];
    expect(evaluateBudgets(quote, "mobile", { ...navigation, stylesheets }))
      .toMatchObject([{ metric: "renderBlockingThirdPartyCss", actual: url }]);
  });

  it("fails the self-test's real heavy HTML and passes the same document with the blocking script removed", () => {
    const page = { ...config.pages.find(p => p.type === "page")!, lighthouse: config.lighthouse };
    function check(heavy: boolean) {
      const bytes = Buffer.from(fixtureHtml(heavy));
      return evaluateBudgets(page, "mobile", {
        ...navigation, htmlBytes: bytes.length, brotliBytes: brotliCompressSync(bytes).length,
      });
    }
    expect(check(true)).toMatchObject([{ metric: "htmlBytes" }]);
    expect(check(false)).toEqual([]);
  });
});

// Validate the paths against the very seed CI applies. A 200 error shell or
// an empty listing would otherwise give a convincing score on a cheap page.
describe("configured local Worker fixtures", () => {
  let sqlite: SqliteDb;
  let env: Env;
  beforeAll(() => {
    const workflow = readFileSync(new URL("../../.github/workflows/speed-gate.yml", import.meta.url), "utf8");
    const fixtureSql = /<<'SQL'\n([\s\S]*?)\n\s*SQL\n/.exec(workflow)?.[1];
    if (!fixtureSql) throw new Error("Missing local speed gate SQL fixture");
    sqlite = createDb();
    (sqlite.exec as (sql: string) => void)(buildSeedSql() + fixtureSql);
    const db = d1FromSqlite(sqlite);
    db.batch = <T>(stmts: D1PreparedStatement[]) => Promise.all(stmts.map(stmt => stmt.all<T>()));
    const kv = Object.assign(makeKvStub().kv, {
      getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
    });
    env = buildLeadgenEnv(db, kv, { extra: { IMAGE_TRANSFORMS: "off", ADMIN_HOST: "127.0.0.1" } });
  });
  afterAll(() => sqlite?.close());

  it.each(config.pages)("serves populated $type HTML within its configured byte limits", async page => {
    const response = await honoFetch(new Request("http://localhost:8787" + page.path), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/html\b/i);
    const body = Buffer.from(await response.arrayBuffer());
    expect(parseHtml(body.toString("utf8")).querySelector(page.selector)).not.toBeNull();
    expect(body.length).toBeLessThanOrEqual(page.htmlBytes);
    expect(brotliCompressSync(body).length).toBeLessThanOrEqual(page.brotliBytes);
  });
});
