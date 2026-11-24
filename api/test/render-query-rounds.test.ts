process.env.TZ = "UTC";

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

// rendered at the Stage 4 merge under TZ=UTC; the Stage 2 byte-identity proof against 7dfb84fc is on perf/p2-fast-builds at ea001908
// The three documents share their layout and ad script, so compress them
// together to keep the inline fixture small. Comparison uses the complete text.
const preChangeHtml: Record<string, string> = JSON.parse(
  brotliDecompressSync(Buffer.from(`
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
VxGJVmKavgwHrRgAMHH5EQ==
`, "base64")).toString("utf8"),
);
