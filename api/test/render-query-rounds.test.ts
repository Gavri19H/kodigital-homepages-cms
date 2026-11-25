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

// Full UTF-8 HTML rendered at 7dfb84fc under TZ=UTC with the seed and fixed clock above.
// The three documents share their layout and ad script, so compress them
// together to keep the inline fixture small. Comparison uses the complete text.
const preChangeHtml: Record<string, string> = JSON.parse(
  brotliDecompressSync(Buffer.from(`
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
`, "base64")).toString("utf8"),
);
