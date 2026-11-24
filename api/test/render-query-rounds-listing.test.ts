import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import publicRouter from "../src/public/router";
import { buildLeadgenEnv, d1FromSqlite, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, type SqliteDb } from "./helpers/x06-a2-sqlite";

const tenant = "journal";
const hostname = "journal.example";

function seed(sqlite: SqliteDb): void {
  addSite(sqlite, tenant, "Journal", "travel");
  addSite(sqlite, "neighbour", "Neighbour", "home");
  sqlite.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(tenant, hostname);
  const setting = sqlite.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
  const settings = {
    site_name: "Café & Field",
    site_description: "Stories from the field.",
    tagline: "Field notes",
    brand_tokens_json: '{"--tw-brand":"#123456","ignored":7}',
    logo_media_id: "brand/logo.svg",
    favicon_media_id: "brand/icon.png",
    social_instagram_url: "https://example.org/journal",
    ads_enabled: "1",
    ad_provider: "adsense",
    adsense_publisher_id: "ca-pub-1234567890123456",
    ad_unit_leaderboard: "123",
    custom_head_html: '<meta name="edition" content="evening">',
    consent_head_html: "<script>window.journalConsent=true;</script>",
    custom_footer_html: "<p>From the night desk.</p>",
    items_per_page: "2",
    ai_block_training: " True ",
    ads_txt_content: "example.net, journal, DIRECT\n",
  };
  for (const [key, value] of Object.entries(settings)) setting.run(tenant, key, value);
  setting.run("neighbour", "site_name", "Other publisher");
  setting.run("neighbour", "robots_txt_content", "Other tenant robots");

  sqlite.prepare("INSERT INTO categories (id, slug, name, description) VALUES (701, 'guides', 'Guides', 'Field guides.')").run();
  sqlite.prepare("INSERT INTO tags (id, site_id, slug, name) VALUES (701, NULL, 'hiking', 'Hiking'), (702, 'neighbour', 'foreign', 'Foreign')").run();
  sqlite.prepare("INSERT INTO media (id, site_id, filename, storage_key, mime_type, alt_text) VALUES (701, ?, 'ridge.jpg', 'guides/ridge.jpg', 'image/jpeg', 'A ridge')").run(tenant);
  const article = sqlite.prepare(
    "INSERT INTO articles (id, site_id, slug, title, category_id, featured_image_id, status, content_json, content_html, published_at, updated_at) " +
    "VALUES (?, ?, ?, ?, 701, 701, ?, '{}', ?, ?, 1700000000)",
  );
  const tag = sqlite.prepare("INSERT INTO article_tags (article_id, tag_id) VALUES (?, 701)");
  for (const [id, site, slug, title, status, date] of [
    [1, tenant, "ridge", "Ridge & river", "published", 100],
    [2, tenant, "notes", "Editor's article", "published", 200],
    [3, tenant, "legacy", "Archived URL's article", "published", 200],
    [4, tenant, "draft", "Hidden draft", "draft", 300],
    [5, "neighbour", "ridge", "Foreign article", "published", 400],
  ] as const) {
    article.run(id, site, slug, title, status, "<p>" + title + "</p>", 1700000000 + date);
    tag.run(id);
  }

  const page = sqlite.prepare(
    "INSERT INTO pages (site_id, slug, title, content_json, content_html, status, seo_title, seo_description, updated_at) " +
    "VALUES (?, ?, ?, '{}', ?, ?, ?, ?, ?)",
  );
  page.run(tenant, "about", "About", "<h1>Our team</h1><p>About the journal.</p>", "published", null, "  ", 1700000100);
  page.run(null, "notes", "Editorial notes", "<p>Café notes.</p>", "published", "Notes & letters", "Our notes.", 1700000200);
  page.run(tenant, "legacy", "Old page", "<p>Legacy.</p>", "published", null, null, 1700000300);
  page.run(tenant, "ridge", "Draft ridge page", "<p>Draft.</p>", "draft", null, null, 1700000400);
  page.run("neighbour", "about", "Foreign page", "<p>Other team.</p>", "published", null, null, 1700000500);

  // On /legacy the operator redirect outranks a listicle, a page and an article.
  sqlite.prepare("INSERT INTO redirects (site_id, source_path, destination_path, status_code) VALUES (?, '/legacy', '/new-home', 302)").run(tenant);
  sqlite.prepare("INSERT INTO listicle_articles (id, public_id, site_id, slug, article_name, status) VALUES (1, 'art_legacy', ?, 'legacy', 'Legacy', 'published')").run(tenant);
  sqlite.prepare("INSERT INTO listicle_article_versions (public_id, article_id, headline, intro_paragraph) VALUES ('ver_legacy', 1, 'Listicle guide', 'Introduction.')").run();
}

function countRounds(sqlite: SqliteDb) {
  const rounds: string[][] = [];
  let wave: string[] | undefined;
  const db = d1FromSqlite({
    // The shim prepares in SQLite only when first/all/run dispatches.
    prepare(sql) {
      if (!wave) {
        wave = [];
        rounds.push(wave);
        queueMicrotask(() => { wave = undefined; });
      }
      wave.push(sql);
      return sqlite.prepare(sql);
    },
    close: () => sqlite.close(),
  });
  db.batch = <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map((s) => s.all<T>()));
  return { db, rounds };
}

interface RouteCase {
  before: number;
  after: number;
  digest: string;
  path: string;
  variant?: string;
  robots?: string;
  pageSize?: string;
  withoutRedirect?: boolean;
  status?: number;
  location?: string;
}

// Recorded with this seed and clock against the unmodified router at 3e19664b.
// SHA-256 covers the entire HTTP response body, including formatting and UTF-8.
const emptyBody = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const aboutBody = "6e8f7acd5e298e225cf226594e6f38676e0dfefbfa0e30bca0b0cf23ab2697b0";
const notesBody = "6b4950e8025550f16298e27ba74a5d90b21e2bedd69beda9475e401ce0201e13";
const rssBody = "29e98df61029319406ee011660d3ebd1d47324d46b27a6e8dc6c1a1e8d2db1bb";
const notFoundBody = "ff6ea7886039872acaea4fa7aaa0bab88bbb8547f87f68c12e74897852c30875";
const cases: RouteCase[] = [
  { path: "/category/guides", before: 6, after: 1, digest: "f0a86b9f797a9aa316c1091262347fe7286f1004a13829adb5e3efe246cf3a6d" },
  { path: "/category/guides", variant: "bot", before: 6, after: 1, digest: "185c09749107ef36ed34bc23f17e24686807b7710feb31d0793d02e8a7504a23" },
  { path: "/category/guides/page/2", before: 6, after: 1, digest: "71d11c279ac87f4b0c7d986c00ddaac24905a954c7c093cc3ecdab362544a50b" },
  { path: "/category/guides/page/3", before: 6, after: 1, digest: "a33c4547b4cb512587bb671acdc329be6f84a854cece170801a960a8e66adf59" },
  { path: "/tag/hiking", before: 5, after: 1, digest: "19aa7b112afcbaa944a195af3f9b2db58ebe633e4e57448445b7329286a4ede3" },
  { path: "/tag/hiking/page/2", before: 5, after: 1, digest: "9b2e4f605f6b285173afd53d9545c03f0e810b12d7c2aad826e03e8d4298bd22" },
  { path: "/page/about", before: 4, after: 1, digest: aboutBody },
  { path: "/page/notes", before: 3, after: 1, digest: notesBody },
  { path: "/about", before: 6, after: 2, digest: aboutBody },
  { path: "/notes", before: 5, after: 2, digest: notesBody },
  { path: "/legacy", status: 302, location: "/new-home", before: 1, after: 1, digest: emptyBody },
  { path: "/legacy", variant: "lst:ver_legacy", withoutRedirect: true, before: 3, after: 3, digest: "002194669c9ebf0ab4bca2e43739889727c4b7cf4e33cc6b517f28562ca4ce6f" },
  { path: "/ridge", status: 301, location: "/article/ridge", before: 4, after: 2, digest: emptyBody },
  { path: "/feed.xml", before: 1, after: 1, digest: rssBody },
  { path: "/rss", before: 1, after: 1, digest: rssBody },
  { path: "/atom.xml", before: 1, after: 1, digest: "30f3a8fe1df756cd3d5936f1c6d867f55f850aa8150137a731934ebeaae8089b" },
  { path: "/sitemap.xml", before: 2, after: 1, digest: "e7548e5e9022b6fabe22755805554f84ea242d000bba3c758eb061dee6ce8bc6" },
  { path: "/robots.txt", before: 2, after: 1, digest: "304be09b9f01a7c45e491fbcc9e8bf6b30639fc36b6d1f38d1a3a10f73b0ca08" },
  { path: "/robots.txt", robots: "User-agent: *\nSitemap: https://{{DOMAIN}}/sitemap.xml\n", before: 1, after: 1, digest: "9172d5a23864778fa0666793ad062a85a7ea50f1e82ec8f0a1fa5e665c9d0ed6" },
  { path: "/robots.txt", robots: "", before: 1, after: 1, digest: emptyBody },
  { path: "/ads.txt", before: 1, after: 1, digest: "ae085b1af3dceb78af0582dc83cf073198589f1c34b7fa1215cd569101d012b1" },
  { path: "/llms.txt", before: 1, after: 1, digest: "593721a648a6c9b11c41f4a60df691754bea3e34cb6c6c6af99719c85453e25b" },
  { path: "/category/guides/page/2", pageSize: "\u00a0+1story", before: 6, after: 1, digest: "3f0db3dafbd79ff7ea566bc7c3f2f0f8d5779c1ee4e0c47cf2950e2f48f26150" },
  { path: "/tag/hiking", pageSize: "9".repeat(310), before: 5, after: 1, digest: "200b67eb5a352a36636190f4b3918dd6e0c2955d8eb1d2597ef04cc3053ca8f1" },
  { path: "/tag/foreign", status: 404, before: 2, after: 1, digest: notFoundBody },
  { path: "/page/draft", status: 404, before: 2, after: 1, digest: notFoundBody },
  { path: "/draft", status: 404, before: 5, after: 2, digest: notFoundBody },
];

describe("public route cache-MISS reads after the host lookup", () => {
  let sqlite: SqliteDb;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-15T00:00:00Z"));
    sqlite = createDb();
    seed(sqlite);
  });
  afterEach(() => {
    sqlite?.close();
    vi.useRealTimers();
  });

  it.each(cases)("$path [case %#] $before → $after rounds with identical bytes", async (route) => {
    if (route.robots !== undefined) {
      sqlite.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, 'robots_txt_content', ?)").run(tenant, route.robots);
    }
    if (route.pageSize !== undefined) {
      sqlite.prepare("UPDATE site_settings SET value = ? WHERE site_id = ? AND key = 'items_per_page'").run(route.pageSize, tenant);
    }
    if (route.withoutRedirect) sqlite.prepare("DELETE FROM redirects WHERE site_id = ?").run(tenant);
    const { db, rounds } = countRounds(sqlite);
    const env = buildLeadgenEnv(db, makeKvStub().kv, { extra: { EDGE_INNER: "1" } });
    const response = await publicRouter.request("https://" + hostname + route.path, {
      headers: { "x-cms-variant": route.variant ?? "human" },
    }, env);
    expect(response.status).toBe(route.status ?? 200);
    expect(response.headers.get("Location")).toBe(route.location ?? null);
    const [host, ...contentRounds] = rounds;
    expect(host).toEqual([expect.stringContaining("FROM domains")]);
    const digest = createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
    expect(digest).toBe(route.digest);
    expect(contentRounds).toHaveLength(route.after);
    if (route.path === "/page/about" || route.path === "/about") {
      expect(contentRounds.flat().filter((sql) => sql.includes("JOIN verticals"))).toEqual([
        expect.stringContaining("FROM pages"),
      ]);
    }
  });

  it("serves About when the optional vertical lookup fails", async () => {
    const { db } = countRounds(sqlite);
    const prepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (sql.includes("JOIN verticals")) throw new Error("Vertical lookup unavailable");
      return prepare(sql);
    };
    const env = buildLeadgenEnv(db, makeKvStub().kv, { extra: { EDGE_INNER: "1" } });
    for (const path of ["/page/about", "/about"]) {
      const response = await publicRouter.request("https://" + hostname + path, {}, env);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("About Café &amp; Field: who we are and how we write our guides.");
    }
  });

  it("retries the original scoped gates if a combined lookup fails", async () => {
    const { db } = countRounds(sqlite);
    const prepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (sql.startsWith("WITH taxonomy AS") || sql.startsWith("SELECT status FROM articles WHERE slug")) {
        throw new Error("Combined lookup unavailable");
      }
      return prepare(sql);
    };
    const env = buildLeadgenEnv(db, makeKvStub().kv, { extra: { EDGE_INNER: "1" } });
    const visit = (path: string) => publicRouter.request("https://" + hostname + path, {}, env);
    const redirect = await visit("/legacy");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("Location")).toBe("/new-home");
    const notes = await visit("/notes");
    expect(notes.status).toBe(200);
    expect(createHash("sha256").update(Buffer.from(await notes.arrayBuffer())).digest("hex")).toBe(notesBody);
    const category = await visit("/category/guides/page/2");
    expect(category.status).toBe(200);
    expect(await category.text()).toContain('href="/article/ridge"');
    expect((await visit("/tag/foreign")).status).toBe(404);
  });
});
