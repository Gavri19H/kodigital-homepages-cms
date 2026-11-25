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
// The three documents share their layout and ad script, so compress them
// together to keep the inline fixture small. Comparison uses the complete text.
const preChangeHtml: Record<string, string> = JSON.parse(
  brotliDecompressSync(Buffer.from(`
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
ukZf2iD6l0j0pnaMzbQ9vMoAgMRLZw==
`, "base64")).toString("utf8"),
);
