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

// Stage 4 merge 66416747 under TZ=UTC, with only the P4-FX1 home hero preload and background updated.
// The three documents share their layout and ad script, so compress them
// together to keep the inline fixture small. Comparison uses the complete text.
const preChangeHtml: Record<string, string> = JSON.parse(
  brotliDecompressSync(Buffer.from(`
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
`, "base64")).toString("utf8"),
);
