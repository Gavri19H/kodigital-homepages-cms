import { brotliCompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SEED_EPOCH, SEED_HOSTNAME, SEED_SITE_ID } from "../scripts/seed/seed-fixture";
import { buildSeedSql } from "../scripts/seed/seed-sql";
import type { Env } from "../src/env";
import { VITALS_BEACON } from "../src/edge/vitals";
import { honoFetch } from "../src/index";
import { buildLeadgenEnv, d1FromSqlite, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { parseHtml, type MiniNode } from "./helpers/mini-dom";
import { createDb, type SqliteDb } from "./helpers/x06-a2-sqlite";

const origin = `https://${SEED_HOSTNAME}`;
const quoteId = (prefix: string) => prefix + "_" + "1".padStart(26, "0");

// Measured 2026-11-25 on c0254cfa568e under TZ=UTC. Each fixed limit is
// ceil(measured HTML bytes / 2048) * 2048, independently for raw and Brotli.
// P4-FX6 re-pinned home at 49,640 raw bytes under TZ=UTC.
// P5-A adds the inline vitals script. Only crossed 2 KiB buckets moved.
const budgets = [
  { page: "home",     raw: 53_248,  brotli: 8_192,  path: "/",                              content: ".picks-grid img" },
  { page: "article",  raw: 26_624,  brotli: 6_144,  path: "/article/morning-light-rituals", content: ".article-hero-img img" },
  { page: "category", raw: 20_480,  brotli: 6_144,  path: "/category/wellness",             content: ".home-grid--category .card" },
  { page: "tag",      raw: 18_432,  brotli: 4_096,  path: "/tag/editors-picks",             content: ".home-grid--tag .card" },
  { page: "page",     raw: 12_288,  brotli: 4_096,  path: "/page/our-desk",                 content: ".page-content p" },
  { page: "listicle", raw: 34_816,  brotli: 8_192,  path: "/morning-guide",                 content: ".lst-section h3", variant: "lst:ver_guide" },
  { page: "quote",    raw: 110_592, brotli: 18_432, path: "/lg/home",                       content: "[data-lg-section] .lg-headline", variant: "lg:" + quoteId("lgn") },
];

function seedEditorial(db: SqliteDb): void {
  // The shared local fixture includes photos and stories for every homepage section.
  (db.exec as (sql: string) => void)(buildSeedSql());
  const setting = db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
  for (const [key, value] of Object.entries({
    logo_media_id: "brand/header.png", ads_enabled: "1", ad_provider: "adsense",
    adsense_publisher_id: "ca-pub-1234567890123456", ad_unit_leaderboard: "123",
    ad_unit_in_feed: "234", ad_unit_rect: "345",
  })) setting.run(SEED_SITE_ID, key, value);

  const tag = db.prepare("INSERT INTO tags (site_id, slug, name) VALUES (?, 'editors-picks', 'Editors’ picks')")
    .run(SEED_SITE_ID).lastInsertRowid;
  db.prepare(`INSERT INTO article_tags (article_id, tag_id)
    SELECT id, ? FROM articles WHERE site_id = ? AND is_featured = 1`).run(tag, SEED_SITE_ID);
  db.prepare(`INSERT INTO pages (site_id, slug, title, content_json, content_html, status, updated_at)
    VALUES (?, 'our-desk', 'Our desk', '{}', '<p>Meet the café desk.</p>', 'published', ?)`).run(SEED_SITE_ID, SEED_EPOCH);
}

function seedListicle(db: SqliteDb): void {
  db.prepare(`INSERT INTO listicle_articles (id, public_id, site_id, slug, article_name, status)
    VALUES (1, 'art_guide', ?, 'morning-guide', 'Morning guide', 'published')`).run(SEED_SITE_ID);
  db.prepare(`INSERT INTO listicle_article_versions (id, public_id, article_id, headline, intro_paragraph, hero_media_url)
    VALUES (1, 'ver_guide', 1, 'A guide to mornings', 'Start the day outside.', '/media/guides/hero.jpg')`).run();
  db.prepare(`INSERT INTO listicle_sections (id, public_id, section_name, headline_text, image_json, content_json)
    VALUES (1, 'sec_walk', 'Walking', 'Take a walk', ?, ?)`).run(JSON.stringify({ url: "/media/guides/trail.jpg" }),
    JSON.stringify({ blocks: [{ type: "paragraph", data: { html: "Look for a quiet trail." } }] }));
  db.prepare("INSERT INTO listicle_pages (id, public_id, article_version_id, page_index) VALUES (1, 'pg_walk', 1, 0)").run();
  db.prepare("INSERT INTO listicle_page_section_candidates (public_id, page_id, section_id) VALUES ('cand_walk', 1, 1)").run();
}

const ga4 = "G-QUOTE123";
const meta = "123456789012345";

function seedQuote(db: SqliteDb): void {
  const frame = {
    version: 1, template: "header-footer", header: { enabled: true, logo_size: "m" }, mobile: { logo_size: "s" },
    brand_logos: { enabled: true, layout: "row", items: [
      { media_id: "partners/oak.png", alt: "Oak Insurance", size: "s" },
      { media_id: "partners/elm.png", alt: "Elm Mutual", size: "m" },
    ] },
  };
  const theme = { typography: { display: "poppins", body: "manrope" } };
  db.prepare(`INSERT INTO leadgen_quotes (id, public_id, quote_name, activity, verticals_json, status)
    VALUES (1, ?, 'Home insurance', 'quote_funnel', '[]', 'active')`).run(quoteId("lgq"));
  db.prepare(`INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug, settings_overrides_json)
    VALUES (?, 1, 1, 'home', ?)`).run(SEED_SITE_ID, JSON.stringify({ ga4_measurement_id: ga4 }));
  db.prepare(`INSERT INTO leadgen_funnels (id, public_id, quote_id, funnel_name, status, frame_config_json, theme_json, meta_pixel_id)
    VALUES (1, ?, 1, 'Home', 'active', ?, ?, ?)`).run(quoteId("lgf"), JSON.stringify(frame), JSON.stringify(theme), meta);
  db.prepare(`INSERT INTO leadgen_funnel_variants (id, public_id, funnel_id, variant_label, traffic_allocation_bp)
    VALUES (1, ?, 1, 'A', 10000)`).run(quoteId("lgn"));
  db.prepare(`INSERT INTO leadgen_sections (id, public_id, section_name, activity, vertical, headline_text, content_json)
    VALUES (1, ?, 'Home', 'quote_funnel', 'home', 'Do you own your home?', ?)`).run(quoteId("lgs"),
    JSON.stringify({ components: [
      { type: "QuestionHeadline", question_id: "q_home", bind: "section_headline" },
      { type: "TwoButtonYesNo", question_id: "q_own", question_key: "owner", internal_field: "owner", answer_type: "boolean" },
    ] }));
  db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (1, 1, 0)").run();
}

function checkImageUrls(doc: MiniNode, base: URL): void {
  for (const node of doc.querySelectorAll('img, picture source, link[as="image"]')) {
    const src = node.getAttribute("src") ?? node.getAttribute("href");
    const srcset = node.getAttribute("srcset") ?? node.getAttribute("imagesrcset") ?? "";
    // Transform options contain commas. Split at candidate boundaries and keep the full URL.
    const urls = srcset.trim().split(/\s+[\d.]+[wx]\s*,\s*|,\s+/).filter(Boolean)
      .map(candidate => candidate.trim().split(/\s+/)[0]!);
    if (src !== null) urls.push(src);
    expect(urls, `image sources on ${base.pathname}`).not.toHaveLength(0);
    const fallback = node.tagName === "SOURCE" ? node.closest("picture")?.querySelector("img") : null;
    for (const value of urls) {
      const url = new URL(value, base);
      if (url.origin !== origin) continue;
      const options = /^\/cdn-cgi\/image\/([^/]+)\/.+/.exec(url.pathname);
      expect(options, `untransformed image ${url.href}`).not.toBeNull();
      const params = new URLSearchParams(options![1]!.replaceAll(",", "&"));
      const width = params.get("width") ?? params.get("w");
      const height = params.get("height") ?? params.get("h");
      expect(width ?? height, `missing resize dimension in ${value}`).not.toBeNull();
      for (const [axis, size] of [["width", width], ["height", height]] as const) {
        if (size === null) continue;
        const pixels = Number(size) * Number(params.get("dpr") ?? 1);
        expect(pixels, `${axis} in ${value}`).toBeGreaterThan(0);
        const inline = node.getAttribute("style")?.match(new RegExp(`(?:^|;)\\s*${axis}\\s*:\\s*([\\d.]+)px\\b`, "i"));
        const display = inline?.[1] ?? node.getAttribute(axis) ?? fallback?.getAttribute(axis);
        if (display != null && /^\d+(?:\.\d+)?$/.test(display)) {
          expect(pixels, `${axis} in ${value}, displayed at ${display}px`).toBeLessThanOrEqual(2 * Number(display));
        }
      }
    }
  }
}

function checkResources(html: string, doc: MiniNode, pageUrl: URL): void {
  const base = new URL(doc.querySelector("base[href]")?.getAttribute("href") ?? pageUrl.href, pageUrl);
  expect(html).not.toMatch(/data:font|@font-face\s*\{[^}]*url\(\s*["']?data:/i);
  for (const link of doc.querySelectorAll("link[href]")) {
    if (link.getAttribute("rel")?.toLowerCase().split(/\s+/).includes("stylesheet")) {
      const url = new URL(link.getAttribute("href")!, base);
      expect(url.origin, `stylesheet ${url.href}`).toBe(pageUrl.origin);
    }
  }
  for (const script of doc.querySelectorAll("head script[src]")) {
    const url = new URL(script.getAttribute("src")!, base);
    if (url.origin !== pageUrl.origin) {
      const deferred = script.hasAttribute("async") || script.hasAttribute("defer") ||
        script.getAttribute("type")?.trim().toLowerCase() === "module";
      expect(deferred, `synchronous head script ${url.href}`).toBe(true);
    }
  }
  checkImageUrls(doc, base);
}

describe("public page weight budgets", () => {
  let sqlite: SqliteDb;
  let env: Env;
  const measurements: { page: string; raw: number; brotli: number }[] = [];

  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T12:00:00Z"));
    sqlite = createDb();
    seedEditorial(sqlite);
    seedListicle(sqlite);
    seedQuote(sqlite);
    const db = d1FromSqlite(sqlite);
    // The shared shim's write batches return change counts. The renderers batch SELECTs.
    db.batch = <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(stmt => stmt.all<T>()));
    env = buildLeadgenEnv(db, makeKvStub().kv, { extra: { EDGE_INNER: "1" } });
  });

  afterAll(() => {
    sqlite?.close();
    vi.useRealTimers();
    console.table(measurements);
  });

  it.each(budgets)("$page fits its HTML budgets and first-paint constraints", async budget => {
    const url = new URL(budget.path, origin);
    const response = await honoFetch(new Request(url, { headers: { "x-cms-variant": budget.variant ?? "human" } }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/html\b/i);
    const bytes = Buffer.from(await response.arrayBuffer());
    const raw = bytes.byteLength;
    const brotli = brotliCompressSync(bytes).byteLength;
    measurements.push({ page: budget.page, raw, brotli });
    expect.soft(raw, "raw HTML bytes").toBeLessThanOrEqual(budget.raw);
    expect.soft(brotli, "Brotli HTML bytes").toBeLessThanOrEqual(budget.brotli);

    const html = bytes.toString("utf8");
    const doc = parseHtml(html);
    expect(doc.querySelector(budget.content), `populated ${budget.path}`).not.toBeNull();
    if (budget.page === "home") {
      // Preserve the original homepage budget after accounting for the two
      // measured additions: image priority hints and the inline speed meter.
      const priorityBytes = doc.querySelectorAll('img[fetchpriority="low"]').length * Buffer.byteLength(' fetchpriority="low"');
      expect(html).toContain(' data-pt="home"');
      expect(html.split(VITALS_BEACON)).toHaveLength(2);
      const meterBytes = Buffer.byteLength(VITALS_BEACON + '\n data-pt="home"');
      expect.soft(raw - priorityBytes - meterBytes, "raw HTML excluding low image priority and vitals").toBeLessThanOrEqual(49_152);

      // A preload has no element width. Compare the actual transform with
      // its width descriptor, then bound the candidate used on a 375px phone.
      const widths = doc.querySelectorAll('head link[rel="preload"][as="image"]').map(link => {
        expect(link.getAttribute("imagesizes")).toBe("100vw");
        const candidate = link.getAttribute("imagesrcset") ?? "";
        const match = /^\/cdn-cgi\/image\/width=(\d+),quality=78,format=auto\/\S+ (\d+)w$/.exec(candidate);
        expect(match, `hero preload candidate: ${candidate}`).not.toBeNull();
        expect(match![1]).toBe(match![2]);
        return Number(match![1]);
      });
      expect(widths).toEqual([640, 1280, 1600]);
      expect(Math.min(...widths), "375px phone hero").toBeLessThanOrEqual(2 * 375);
    }
    if (budget.page === "quote") {
      expect(doc.querySelector('[data-frame-region="header"] img')).not.toBeNull();
      expect(doc.querySelectorAll('[data-frame-region="brand_logos"] img').map(img => img.getAttribute("alt")))
        .toEqual(["Oak Insurance", "Elm Mutual"]);
      for (const marker of ["/lg/runtime/lgfonts/poppins-", "/lg/runtime/lgfonts/manrope-", ga4, meta, "gtag/js", "fbevents.js"]) {
        expect(html, `quote shell with ${marker}`).toContain(marker);
      }
    }
    checkResources(html, doc, url);
  });
});
