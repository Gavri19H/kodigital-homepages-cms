import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PublicSiteContext } from "../src/public/middleware";
import { renderArticleHtml, renderHomepageHtml } from "../src/public/render-pages";
import { API_ROOT, d1FromSqlite, loadDatabaseSync, type SqliteDb } from "./helpers/leadgen-analytics-harness";

const site: PublicSiteContext = {
  siteId: "journal",
  site_id: "journal",
  hostname: "journal.example",
  vertical_slug: "travel",
  status: "active",
  content_version: 1,
  settings_version: 1,
};

function seedPages(): SqliteDb {
  const DatabaseSync = loadDatabaseSync();
  if (!DatabaseSync) throw new Error("The render query fixtures require node:sqlite");
  const sqlite = new DatabaseSync(":memory:");
  const migrations = join(API_ROOT, "migrations");
  for (const name of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
    (sqlite.exec as (sql: string) => void)(readFileSync(join(migrations, name), "utf8"));
  }
  const insertSite = sqlite.prepare(
    "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES (?, ?, ?, 'travel', 'active')",
  );
  insertSite.run(site.siteId, "Journal", site.hostname);
  insertSite.run("neighbour", "Neighbour", "neighbour.example");

  const settings = {
    site_name: "Field & Stream Journal",
    tagline: "Notes from the field",
    site_description: "Stories, maps and interviews.",
    logo_media_id: "brand/logo.svg",
    favicon_media_id: "brand/icon.png",
    brand_tokens_json: '{"--tw-brand":"#215e52","ignored":7}',
    hero_image_media_id: "brand/banner.jpg",
    newsletter_settings_json: '{"heading":"Field notes","description":"Our weekly dispatch."}',
    social_instagram_url: "https://example.org/journal",
    org_same_as: "https://example.org/journal, https://example.net/journal",
    ads_enabled: "1",
    ad_provider: "adsense",
    adsense_publisher_id: "ca-pub-1234567890123456",
    ad_unit_leaderboard: "123",
    ad_unit_in_feed: "234",
    ad_unit_rect: "345",
    custom_head_html: '<meta name="journal-edition" content="morning">',
    custom_footer_html: "<p>Filed by the night desk.</p>",
    consent_head_html: "<script>window.journalConsent=true;</script>",
  };
  const insertSetting = sqlite.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
  for (const [key, value] of Object.entries(settings)) insertSetting.run(site.siteId, key, value);
  insertSetting.run("neighbour", "site_name", "Other tenant");

  const category = sqlite.prepare("INSERT INTO categories (id, slug, name, show_on_homepage) VALUES (?, ?, ?, 1)");
  const attachCategory = sqlite.prepare("INSERT INTO site_categories (site_id, category_id, display_order) VALUES (?, ?, ?)");
  category.run(701, "field-guides", "Field Guides");
  category.run(702, "dispatches", "Dispatches");
  attachCategory.run(site.siteId, 701, 2);
  attachCategory.run(site.siteId, 702, 1);

  const media = sqlite.prepare(
    "INSERT INTO media (id, site_id, filename, storage_key, mime_type, alt_text) VALUES (?, ?, ?, ?, 'image/jpeg', ?)",
  );
  const article = sqlite.prepare(
    "INSERT INTO articles (id, site_id, slug, title, subtitle, content_json, content_html, category_id, status, " +
      "published_at, updated_at, author_name, featured_image_id, is_featured, is_trending) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1735689600, 'Lee Rivers', ?, ?, ?)",
  );
  // Equal dates exercise the id tie-break. The newer draft and same-slug
  // article on a different site must stay out of both related-article lists.
  const stories = [
    [1, "journal", "ridge-walk", "Ridge Walk", 701, "published", 100],
    [2, "journal", "camp-log", "Camp Log", 701, "published", 200],
    [3, "journal", "river-notes", "River Notes", 701, "published", 200],
    [4, "journal", "by-rail", "By Rail", 702, "published", 300],
    [5, "journal", "open-road", "Open Road", null, "published", 400],
    [6, "journal", "draft", "Unpublished", 701, "draft", 500],
    [7, "neighbour", "ridge-walk", "Neighbour's story", 702, "published", 600],
  ] as const;
  for (const [id, tenant, slug, title, categoryId, status, date] of stories) {
    const filename = `${slug}-${id}.jpg`;
    media.run(id, tenant, filename, `photos/${filename}`, `${title} photo`);
    const blocks = JSON.stringify({ blocks: [
      { type: "p", text: `A dispatch from ${title}.` },
      { type: "faq", question: "What did we see?", answer: "The first light." },
    ] });
    article.run(id, tenant, slug, title, `Notes on ${title}`, blocks, `<p>${title} in the field.</p>`,
      categoryId, status, 1700000000 + date, id, Number(id === 1), Number(id === 4));
  }
  return sqlite;
}

function countReads(sqlite: SqliteDb) {
  const reads: string[][] = [];
  let wave: string[] | undefined;
  const db = d1FromSqlite({
    // The D1 shim prepares SQLite statements when first/all/run execute.
    // Binding arguments alone never counts as a read.
    prepare(sql) {
      if (!wave) {
        wave = [];
        reads.push(wave);
        // A caller awaiting a result resumes after this microtask.
        queueMicrotask(() => { wave = undefined; });
      }
      wave.push(sql);
      return sqlite.prepare(sql);
    },
    close: () => sqlite.close(),
  });
  // The harness's write batch returns only change metadata. A D1 read
  // batch returns rows for each SELECT, all dispatched in the same round.
  db.batch = <T>(statements: D1PreparedStatement[]) =>
    Promise.all(statements.map((stmt) => stmt.all<T>()));
  return { db, reads };
}

describe("public HTML cache-MISS builders", () => {
  let sqlite: SqliteDb;
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-15T00:00:00Z"));
    sqlite = seedPages();
  });
  afterAll(() => {
    sqlite?.close();
    vi.useRealTimers();
  });

  it("counts a parallel wave and a subsequent batch as two rounds", async () => {
    const { db, reads } = countReads(sqlite);
    const select = () => db.prepare("SELECT ? AS value").bind(1);
    await Promise.all([select().first(), select().all()]);
    await db.batch([select(), select()]);
    expect(reads.map((round) => round.length)).toEqual([2, 2]);
  });

  it.each(["/", "ridge-walk", "open-road"])(
    "%s builds in one D1 round and matches the pre-change HTML byte for byte",
    async (slug) => {
      const { db, reads } = countReads(sqlite);
      // These are the router's render thunks, after host resolution and the
      // article's pre-cache publication check.
      const html = slug === "/"
        ? await renderHomepageHtml(db, site)
        : await renderArticleHtml(db, site, slug);
      expect(reads).toHaveLength(1);
      expect(reads.flat().filter((sql) => sql.includes("FROM site_settings"))).toHaveLength(1);
      expect(html).toBe(preChangeHtml[slug]);
    },
  );
});

// Full UTF-8 documents from the seed and fixed clock above were
// rendered at the Stage 4 merge (markup includes Stage 4 changes);
// the Stage 2 byte-identity proof against 7dfb84fc is on branch perf/p2-fast-builds at efc4d5a5.
// The three documents share their layout and ad script, so compress them
// together to keep the inline fixture small. Comparison uses the complete text.
const preChangeHtml: Record<string, string> = JSON.parse(
  brotliDecompressSync(Buffer.from(`
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
HwE=
`, "base64")).toString("utf8"),
);
