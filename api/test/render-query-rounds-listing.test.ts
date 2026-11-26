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

// The "before" round counts were recorded with this seed and clock at 3e19664b.
// Stage 4 merge 66416747 under TZ=UTC, with only the P4-FX2 static asset URLs updated.
// P5-A adds the inline vitals meter and page type to the editorial HTML.
// P5-D adds the same meter to the /legacy listicle.
// SHA-256 covers the entire HTTP response body, including formatting and UTF-8.
const emptyBody = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const aboutBody = "87237248b1e125ed1046997ceae56bd614450eba7cdc50f13180bfb79b818a6c";
const notesBody = "0c7693b79ea41da45a164cf0234aba5adb59e6821041a6e962773d95ebfe3b6f";
const rssBody = "29e98df61029319406ee011660d3ebd1d47324d46b27a6e8dc6c1a1e8d2db1bb";
const notFoundBody = "4f97e379d8a66ac8592dc52983997102034e85d642bcb89a5d4fcff5a9854d1d";
const cases: RouteCase[] = [
  { path: "/category/guides", before: 6, after: 1, digest: "98d4ce69bfc8965a2d160ae729fd4955ecf65fd219d43e7a1a8a1e42f5871903" },
  { path: "/category/guides", variant: "bot", before: 6, after: 1, digest: "ff425c5a49263a344dd0ea4f75ae8f9dd756d0d53687c98738b20f76f683d6ef" },
  { path: "/category/guides/page/2", before: 6, after: 1, digest: "62d2c291fbbb4d8514a41959510d898025322b80120eb2fc80d28a047a15beb2" },
  { path: "/category/guides/page/3", before: 6, after: 1, digest: "9705e1e85931de69afd92c4fd368a6402b93c4719cc8a283cb2b776c0013850a" },
  { path: "/tag/hiking", before: 5, after: 1, digest: "a14ddfc40dcfbe1b32a56a700c8220cadb956f8979ccb115ebac0464f7d8adc4" },
  { path: "/tag/hiking/page/2", before: 5, after: 1, digest: "ce9fe7768c7f017c33523bc4ba7419790666ae24db244305b8b0001979acdac7" },
  { path: "/page/about", before: 4, after: 1, digest: aboutBody },
  { path: "/page/notes", before: 3, after: 1, digest: notesBody },
  { path: "/about", before: 6, after: 2, digest: aboutBody },
  { path: "/notes", before: 5, after: 2, digest: notesBody },
  { path: "/legacy", status: 302, location: "/new-home", before: 1, after: 1, digest: emptyBody },
  { path: "/legacy", variant: "lst:ver_legacy", withoutRedirect: true, before: 3, after: 1, digest: "0216fafcf5f4f989c596570d8b09ad6cec8e73d130360a580947c9780aa3b43e" },
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
  { path: "/category/guides/page/2", pageSize: "\u00a0+1story", before: 6, after: 1, digest: "0327fd9eae1536c60005a564aef87699cb17fb7ea1968f45335ec7b6b4fd8381" },
  { path: "/tag/hiking", pageSize: "9".repeat(310), before: 5, after: 1, digest: "f1c775a7459ef2f35f5a5a6283e55bb4ca92bcf08209a25f2fc1e4837bd5e2ce" },
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
