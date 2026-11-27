process.env.TZ = "UTC";

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PublicSiteContext } from "../src/public/middleware";
import publicRouter from "../src/public/router";
import { API_ROOT, buildLeadgenEnv, d1FromSqlite, loadDatabaseSync, makeKvStub, type SqliteDb } from "./helpers/leadgen-analytics-harness";

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
  sqlite.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(site.siteId, site.hostname);

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

describe("public router cache-MISS reads", () => {
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
    "%s serves the pre-change HTML byte for byte in one whole-route D1 round",
    async (slug) => {
      const { db, reads } = countReads(sqlite);
      const env = buildLeadgenEnv(db, makeKvStub().kv, { extra: { EDGE_INNER: "1" } });
      const path = slug === "/" ? "/" : "/article/" + slug;
      const response = await publicRouter.request("https://" + site.hostname + path, {
        headers: { "x-cms-site-context": JSON.stringify(site), "x-cms-variant": "human" },
      }, env);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(reads).toHaveLength(1);
      expect(reads.flat().filter((sql) => sql.includes("FROM site_settings"))).toHaveLength(1);
      expect(html).toBe(preChangeHtml[slug]);
    },
  );

  it.each([
    { slug: "ridge-walk", variant: "bot", accept: "text/html", status: 200 },
    { slug: "ridge-walk", variant: "md", accept: "text/markdown", status: 200 },
    { slug: "draft", variant: "human", accept: "text/html", status: 404 },
    { slug: "unknown", variant: "md", accept: "text/markdown", status: 404 },
  ])("$variant /article/$slug matches the direct response in one round", async ({ slug, variant, accept, status }) => {
    async function visit(inner: boolean) {
      const { db, reads } = countReads(sqlite);
      const env = buildLeadgenEnv(db, makeKvStub().kv);
      const headers = new Headers({ accept, "x-cms-variant": variant });
      if (inner) {
        env.EDGE_INNER = "1";
        headers.set("x-cms-site-context", JSON.stringify(site));
      }
      const response = await publicRouter.request("https://" + site.hostname + "/article/" + slug, { headers }, env);
      return { response, body: await response.text(), reads };
    }
    const direct = await visit(false);
    const inner = await visit(true);
    expect(direct.response.status).toBe(status);
    expect(inner.response.status).toBe(status);
    expect(inner.response.headers.get("Content-Type")).toBe(direct.response.headers.get("Content-Type"));
    expect(inner.body).toBe(direct.body);
    expect(inner.reads).toHaveLength(1);
  });
});

// Stage 4 merge 66416747 under TZ=UTC, with the P4-FX1 hero changes and P4-FX2 static asset URLs and the article-only Nunito 900 preload.
// P4-FX6 re-pinned the home image priorities under TZ=UTC.
// P5-A adds the page type and inline vitals script to the pinned HTML.
// The three documents share their layout and ad script, so compress them
// together to keep the inline fixture small. Comparison uses the complete text.
const preChangeHtml: Record<string, string> = JSON.parse(
  brotliDecompressSync(Buffer.from(`
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
`, "base64")).toString("utf8"),
);
