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
0T9Qpk0FxsG3M1cKAKXcFS8=
`, "base64")).toString("utf8"),
);
