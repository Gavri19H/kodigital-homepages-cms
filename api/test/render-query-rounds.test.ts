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

// Stage 4 merge 66416747 under TZ=UTC, with the P4-FX1 hero changes and P4-FX2 static asset URLs.
// The three documents share their layout and ad script, so compress them
// together to keep the inline fixture small. Comparison uses the complete text.
const preChangeHtml: Record<string, string> = JSON.parse(
  brotliDecompressSync(Buffer.from(`
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
`, "base64")).toString("utf8"),
);
