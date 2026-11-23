// X06 "SEO Fixes", Part C (owner decisions Q4/Q5, plan v3, 23 Nov 2026) —
// what Google and social sites read on the public pages.
//
//   fix 6: the homepage's structured data was wrapped in TWO <script> tags, so
//          Google could read none of it (live on all 3 homepages). Every
//          ld+json block on the homepage, a category and an Article must parse.
//   fix 8: Article and homepage share pictures were bare "/media/…" paths;
//          og:image / twitter:image are now full https:// addresses. X14's
//          logo fallback for pages with no picture stays as it was.
//   fix 9: Category, About, Contact and legal pages repeated the homepage's
//          description. With an empty field they get their own sentence; an
//          operator's own text still wins.
//
// Renders against a REAL schema (every migration before 0070, applied to
// node:sqlite) through the same render functions the public router calls.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderHomepageHtml,
  renderArticleHtml,
  renderCategoryHtml,
  renderPageHtml,
} from "../src/public/render-pages";
import { fetchCategory, fetchCategoryArticles, fetchPublishedPage } from "../src/public/queries";
import type { PublicSiteContext } from "../src/public/middleware";
import { renderLayout } from "../src/public/templates/layout";
import { loadDatabaseSync, d1FromSqlite, type SqliteDb } from "./helpers/leadgen-analytics-harness";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const HOST = "moneylantern.com";
const SITE_ID = "st_x06";
const HERO_KEY = "ai/st_x06/feature_image/hero.png";
const LOGO = "/media/2026/08/18/logo.png";

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function exec(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function newDb(): SqliteDb {
  const sdb = new DatabaseSync!(":memory:");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && Number(f.slice(0, 4)) < 70)
    .sort();
  for (const f of files) exec(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  exec(
    sdb,
    `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('${SITE_ID}', 'moneylantern', '${HOST}', 'jobs', 'active');
     INSERT INTO site_settings (site_id, key, value) VALUES
       ('${SITE_ID}', 'site_name', 'Money & Lantern'),
       ('${SITE_ID}', 'site_description', 'The homepage description.'),
       ('${SITE_ID}', 'logo_media_id', '${LOGO}');
     INSERT INTO media (id, filename, storage_key, mime_type, site_id) VALUES (501, 'hero.png', '${HERO_KEY}', 'image/png', '${SITE_ID}');
     INSERT INTO categories (id, slug, name, description) VALUES (901, 'x06-budgeting', 'Budgeting', NULL);
     INSERT INTO categories (id, slug, name, description) VALUES (902, 'x06-saving', 'Saving', 'Our own words about saving.');
     INSERT INTO categories (id, slug, name, description) VALUES (903, 'x06-blank', 'Blank', '   ');
     INSERT INTO articles (slug, title, content_json, content_html, category_id, status, published_at, featured_image_id, is_featured, site_id)
       VALUES ('how-to-budget', 'How to Build a Budget', '{}', '<p>Body</p>', 901, 'published', 1763800000, 501, 1, '${SITE_ID}');`,
  );
  const pages: Array<[string, string]> = [
    ["about", "About us"],
    ["privacy-policy", "Privacy Policy"],
    ["terms", "Terms of Use"],
    ["contact", "Contact"],
    ["do-not-sell", "Do Not Sell My Info"],
    ["press", "Press"],
  ];
  for (const [slug, title] of pages) {
    sdb
      .prepare(
        "INSERT INTO pages (slug, title, content_json, content_html, status, site_id) VALUES (?, ?, '{}', '<p>x</p>', 'published', ?)",
      )
      .run(slug, title, SITE_ID);
  }
  return sdb;
}

const CTX: PublicSiteContext = {
  siteId: SITE_ID,
  site_id: SITE_ID,
  hostname: HOST,
  vertical_slug: "jobs",
  status: "active",
  content_version: 1,
  settings_version: 1,
};

function ldJsonBlocks(html: string): string[] {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
}

function metaContent(html: string, attr: "name" | "property", key: string): string | null {
  const re = new RegExp(`<meta ${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" content="([^"]*)">`);
  return re.exec(html)?.[1] ?? null;
}

function expectReadableStructuredData(html: string): unknown[] {
  // No <script> ever opens inside another (the double-wrap Google can't read).
  expect(html).not.toMatch(/<script type="application\/ld\+json">\s*<script/);
  const blocks = ldJsonBlocks(html);
  expect(blocks.length).toBeGreaterThan(0);
  return blocks.map((b) => {
    expect(b).not.toContain("<script");
    return JSON.parse(b) as unknown;
  });
}

async function renderCategory(db: D1Database, slug: string): Promise<string> {
  const cat = await fetchCategory(db, slug);
  if (cat === null) throw new Error(`no category ${slug}`);
  const articles = await fetchCategoryArticles(db, cat.id, SITE_ID, 1);
  return renderCategoryHtml(db, CTX, cat, articles, 1, slug);
}

async function renderPage(db: D1Database, slug: string): Promise<string> {
  const row = await fetchPublishedPage(db, slug, SITE_ID);
  if (row === null) throw new Error(`no page ${slug}`);
  return renderPageHtml(db, CTX, row, `/page/${slug}`);
}

describeDb("fix 6: every structured data block parses, none is wrapped twice", () => {
  it("homepage: WebSite + Organization + ItemList, each its own readable block", async () => {
    const db = d1FromSqlite(newDb());
    const html = await renderHomepageHtml(db, CTX);
    const parsed = expectReadableStructuredData(html) as Array<{ "@type": string }>;
    expect(parsed.map((p) => p["@type"])).toEqual(["WebSite", "Organization", "ItemList"]);
    // X14's logo in the Organization entry is unchanged.
    const org = parsed[1] as { logo?: { url: string } };
    expect(org.logo?.url).toBe(`https://${HOST}${LOGO}`);
  });

  it("category and Article pages stay readable too", async () => {
    const db = d1FromSqlite(newDb());
    const cat = expectReadableStructuredData(await renderCategory(db, "x06-budgeting")) as Array<{ "@type": string }>;
    expect(cat.map((p) => p["@type"])).toEqual(["CollectionPage", "BreadcrumbList"]);
    const art = expectReadableStructuredData(await renderArticleHtml(db, CTX, "how-to-budget")) as Array<{ "@type": string }>;
    expect(art.map((p) => p["@type"])).toEqual(["Article", "BreadcrumbList"]);
  });
});

describeDb("fix 8: share pictures are full web addresses", () => {
  it("homepage: og:image and twitter:image are https://{host}/media/… of the hero picture", async () => {
    const db = d1FromSqlite(newDb());
    const html = await renderHomepageHtml(db, CTX);
    expect(metaContent(html, "property", "og:image")).toBe(`https://${HOST}/media/${HERO_KEY}`);
    expect(metaContent(html, "name", "twitter:image")).toBe(`https://${HOST}/media/${HERO_KEY}`);
  });

  it("Article: og:image and twitter:image are https://{host}/media/… of its own picture", async () => {
    const db = d1FromSqlite(newDb());
    const html = await renderArticleHtml(db, CTX, "how-to-budget");
    expect(metaContent(html, "property", "og:image")).toBe(`https://${HOST}/media/${HERO_KEY}`);
    expect(metaContent(html, "name", "twitter:image")).toBe(`https://${HOST}/media/${HERO_KEY}`);
  });

  it("an already full address is kept as it is; X14's logo fallback is unchanged", () => {
    const own = renderLayout({
      site: { name: "m", hostname: HOST, logoUrl: LOGO },
      meta: { title: "t", ogImage: "https://cdn.example.org/pic.png" },
      body: "",
    });
    expect(metaContent(own, "property", "og:image")).toBe("https://cdn.example.org/pic.png");
    const none = renderLayout({ site: { name: "m", hostname: HOST, logoUrl: LOGO }, meta: { title: "t" }, body: "" });
    expect(metaContent(none, "property", "og:image")).toBe(`https://${HOST}${LOGO}`);
    expect(metaContent(none, "name", "twitter:image")).toBe(`https://${HOST}${LOGO}`);
  });
});

describeDb("fix 9: each Page type and category has its own description (owner Q5 (a))", () => {
  const cases: Array<[string, string]> = [
    ["about", "About Money &amp; Lantern: who we are and how we write our guides on jobs &amp; employment."],
    ["privacy-policy", "How Money &amp; Lantern collects, uses and protects your personal information."],
    ["terms", "The terms for using Money &amp; Lantern."],
    ["contact", "How to reach the Money &amp; Lantern team."],
    ["do-not-sell", "How to opt out of the sale or sharing of your personal information on Money &amp; Lantern."],
  ];

  for (const [slug, sentence] of cases) {
    it(`${slug} with an empty SEO description gets its sentence (escaped), not the homepage's`, async () => {
      const db = d1FromSqlite(newDb());
      const html = await renderPage(db, slug);
      expect(metaContent(html, "name", "description")).toBe(sentence);
      expect(metaContent(html, "property", "og:description")).toBe(sentence);
      expect(html).not.toContain("The homepage description.");
    });
  }

  it("a filled SEO description still wins (X15), on About and a legal page", async () => {
    const sdb = newDb();
    sdb.prepare("UPDATE pages SET seo_description = ? WHERE slug IN ('about', 'terms')").run("Typed by an operator.");
    const db = d1FromSqlite(sdb);
    expect(metaContent(await renderPage(db, "about"), "name", "description")).toBe("Typed by an operator.");
    expect(metaContent(await renderPage(db, "terms"), "name", "description")).toBe("Typed by an operator.");
  });

  it("a blank (spaces only) SEO description counts as empty", async () => {
    const sdb = newDb();
    sdb.prepare("UPDATE pages SET seo_description = '   ' WHERE slug = 'contact'").run();
    const html = await renderPage(d1FromSqlite(sdb), "contact");
    expect(metaContent(html, "name", "description")).toBe("How to reach the Money &amp; Lantern team.");
  });

  it("About without a known Vertical leaves the Vertical out", async () => {
    const sdb = newDb();
    exec(sdb, "PRAGMA foreign_keys = OFF;");
    sdb.prepare("UPDATE sites SET vertical_slug = 'no-such-vertical' WHERE id = ?").run(SITE_ID);
    const html = await renderPage(d1FromSqlite(sdb), "about");
    expect(metaContent(html, "name", "description")).toBe(
      "About Money &amp; Lantern: who we are and how we write our guides.",
    );
  });

  it("any other Page keeps today's behavior (the site description)", async () => {
    const html = await renderPage(d1FromSqlite(newDb()), "press");
    expect(metaContent(html, "name", "description")).toBe("The homepage description.");
  });

  it("a category without a description gets its own sentence", async () => {
    const html = await renderCategory(d1FromSqlite(newDb()), "x06-budgeting");
    const sentence = "Budgeting: practical guides and tips from Money &amp; Lantern.";
    expect(metaContent(html, "name", "description")).toBe(sentence);
    expect(html).not.toContain("The homepage description.");
    // a spaces-only description counts as empty
    const blank = await renderCategory(d1FromSqlite(newDb()), "x06-blank");
    expect(metaContent(blank, "name", "description")).toBe("Blank: practical guides and tips from Money &amp; Lantern.");
  });

  it("a category's own description wins", async () => {
    const html = await renderCategory(d1FromSqlite(newDb()), "x06-saving");
    expect(metaContent(html, "name", "description")).toBe("Our own words about saving.");
  });
});
