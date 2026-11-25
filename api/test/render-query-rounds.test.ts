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
// The three documents share their layout and ad script, so compress them
// together to keep the inline fixture small. Comparison uses the complete text.
const preChangeHtml: Record<string, string> = JSON.parse(
  brotliDecompressSync(Buffer.from(`
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
`, "base64")).toString("utf8"),
);
