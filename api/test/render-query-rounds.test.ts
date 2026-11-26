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
