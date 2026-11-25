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

// Re-pinned for P4-A2 under TZ=UTC; the Stage 2 byte-identity proof against 7dfb84fc is on perf/p2-fast-builds at ea001908
// The three documents share their layout and ad script, so compress them
// together to keep the inline fixture small. Comparison uses the complete text.
const preChangeHtml: Record<string, string> = JSON.parse(
  brotliDecompressSync(Buffer.from(`
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
K7qguaFVg/g2roIx2ohpRzYcsGIAwJbL3wE=
`, "base64")).toString("utf8"),
);
