// Listicles Phase 2 — Sections admin API integration over REAL sqlite:
// save renders content_html through the EXISTING editor pipeline, rebuilds
// listicle_section_link_instances (incl. the §30.7 "__headline__" row) +
// the derived listicle_section_offers in the same batch, refuses free-text
// URLs, and soft-archives on delete (409 while candidate-referenced).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// --- node:sqlite harness (repo pattern + transactional batch) ---------------

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  close(): void;
  [method: string]: unknown;
};
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return mod.DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        const mod = getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
        return mod.DatabaseSync;
      }
    } catch {
      /* fall through */
    }
    return null;
  }
}

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          const r = sdb.prepare(sql).get(...binds);
          return (r ?? null) as T | null;
        },
        async all<T = unknown>() {
          const rows = sdb.prepare(sql).all(...binds);
          return { results: rows as T[], success: true, meta: {} };
        },
        async run() {
          sdb.prepare(sql).run(...binds);
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const statement of statements) {
          results.push(await statement.run());
        }
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
  return db;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function createListiclesDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0032_listicles_core.sql"), "utf8"));
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0033_listicles_analytics_mirror.sql"), "utf8"));
  sdb.prepare("INSERT INTO sites (id, name) VALUES (?, ?)").run("st_test", "Test Site");
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  };
}

function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method };
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createListiclesDb(ctor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

// Seed an ACTIVE offer directly; returns its internal id.
function seedOffer(sdb: SqliteDb, publicId: string, name: string, status = "active"): number {
  sdb
    .prepare(
      `INSERT INTO listicle_offers
         (public_id, offer_name, provider, activity, vertical,
          conversion_tracking_method, offer_url_template, payout_method, status)
       VALUES (?, ?, 'prov', 'lead', 'pets', 's2s_postback',
               'https://t.example/c?c={click_id}', 'offsite', ?)`,
    )
    .run(publicId, name, status);
  const row = sdb.prepare("SELECT id FROM listicle_offers WHERE public_id = ?").get(publicId) as {
    id: number;
  };
  return row.id;
}

interface SectionBody {
  section: {
    id: number;
    public_id: string;
    section_name: string;
    content_html: string | null;
    content_version: number;
    status: string;
  };
}

interface LinkInstanceRow {
  public_id: string;
  block_id: string;
  link_role: string;
  position_index: number;
  offer_id: number;
  anchor_text: string | null;
}

function linkInstances(sdb: SqliteDb, sectionId: number): LinkInstanceRow[] {
  return sdb
    .prepare(
      "SELECT public_id, block_id, link_role, position_index, offer_id, anchor_text FROM listicle_section_link_instances WHERE section_id = ? ORDER BY position_index",
    )
    .all(sectionId) as LinkInstanceRow[];
}

function sectionOffers(
  sdb: SqliteDb,
  sectionId: number,
): Array<{ offer_id: number; link_role: string; occurrences: number }> {
  return sdb
    .prepare(
      "SELECT offer_id, link_role, occurrences FROM listicle_section_offers WHERE section_id = ? ORDER BY link_role",
    )
    .all(sectionId) as Array<{ offer_id: number; link_role: string; occurrences: number }>;
}

describeDb("section save — render + link graph rebuild (§10/§30.7)", () => {
  it("POST renders content_html via the editor pipeline and writes the __headline__ instance + derived section_offers", async () => {
    const { sdb, env } = newHarness();
    const offerA = seedOffer(sdb, "off_headline1", "Headline Offer");
    const offerB = seedOffer(sdb, "off_button01", "Button Offer");

    const res = await admin.request(
      "/api/admin/listicles/sections",
      jsonInit("POST", {
        section_name: "Top pick",
        headline_text: "The very best pick",
        headline_offer_id: offerA,
        content_json: {
          blocks: [
            { type: "paragraph", data: { text: "Why we love it" } },
            { type: "button", data: { text: "Get the deal", offer_id: offerB, style: "primary" } },
          ],
        },
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as SectionBody;
    expect(body.section.public_id.startsWith("sec_")).toBe(true);
    // Rendered through the EXISTING pipeline: the paragraph block's markup.
    expect(body.section.content_html).toContain("<p>Why we love it</p>");

    const instances = linkInstances(sdb, body.section.id);
    expect(instances).toHaveLength(2);
    // §30.7: the clickable headline row.
    expect(instances[0]).toMatchObject({
      block_id: "__headline__",
      link_role: "headline",
      position_index: 0,
      offer_id: offerA,
      anchor_text: "The very best pick",
    });
    expect(instances[0]?.public_id.startsWith("lnk_")).toBe(true);
    expect(instances[1]).toMatchObject({ link_role: "button", offer_id: offerB });

    // Derived summary rebuilt in the same save (§5.4).
    expect(sectionOffers(sdb, body.section.id)).toEqual([
      { offer_id: offerB, link_role: "button", occurrences: 1 },
      { offer_id: offerA, link_role: "headline", occurrences: 1 },
    ]);
  });

  it("rejects free-text-URL content: the legacy affiliate block and raw hrefs", async () => {
    const { env } = newHarness();
    const affiliate = await admin.request(
      "/api/admin/listicles/sections",
      jsonInit("POST", {
        section_name: "s",
        headline_text: "h",
        content_json: {
          blocks: [{ type: "affiliate", data: { title: "x", url: "https://leak.example.com" } }],
        },
      }),
      env,
    );
    expect(affiliate.status).toBe(400);
    const affiliateBody = (await affiliate.json()) as { fields: Record<string, string> };
    expect(affiliateBody.fields["content.blocks[0]"]).toContain("forbidden");

    const rawHref = await admin.request(
      "/api/admin/listicles/sections",
      jsonInit("POST", {
        section_name: "s",
        headline_text: "h",
        content_json: {
          blocks: [
            { type: "paragraph", data: { html: '<a href="https://leak.example.com">buy</a>' } },
          ],
        },
      }),
      env,
    );
    expect(rawHref.status).toBe(400);
    const rawHrefBody = (await rawHref.json()) as { fields: Record<string, string> };
    expect(rawHrefBody.fields["content.blocks[0]"]).toContain("free-text URLs are forbidden");
  });

  it("rejects references to unknown or non-active offers (§12)", async () => {
    const { sdb, env } = newHarness();
    const paused = seedOffer(sdb, "off_paused01", "Paused Offer", "paused");

    const unknown = await admin.request(
      "/api/admin/listicles/sections",
      jsonInit("POST", {
        section_name: "s",
        headline_text: "h",
        headline_offer_id: 9999,
        content_json: { blocks: [{ type: "paragraph", data: { text: "x" } }] },
      }),
      env,
    );
    expect(unknown.status).toBe(400);

    const inactive = await admin.request(
      "/api/admin/listicles/sections",
      jsonInit("POST", {
        section_name: "s",
        headline_text: "h",
        headline_offer_id: paused,
        content_json: { blocks: [{ type: "paragraph", data: { text: "x" } }] },
      }),
      env,
    );
    expect(inactive.status).toBe(400);
    const inactiveBody = (await inactive.json()) as { fields: Record<string, string> };
    expect(JSON.stringify(inactiveBody.fields)).toContain("active");
  });

  it("PATCH re-renders, rebuilds the link graph, bumps content_version on content change, and keeps lnk_ ids stable for surviving placements", async () => {
    const { sdb, env } = newHarness();
    const offerA = seedOffer(sdb, "off_a", "A");
    const offerB = seedOffer(sdb, "off_b", "B");

    const created = await admin.request(
      "/api/admin/listicles/sections",
      jsonInit("POST", {
        section_name: "Original",
        headline_text: "Headline",
        headline_offer_id: offerA,
        content_json: { blocks: [{ type: "paragraph", data: { text: "one" } }] },
      }),
      env,
    );
    const { section } = (await created.json()) as SectionBody;
    const headlineLnk = linkInstances(sdb, section.id)[0]?.public_id;

    // (1) Name-only PATCH: no content change → content_version stays, the
    // headline link instance keeps its public id (analytics identity).
    const renamed = await admin.request(
      `/api/admin/listicles/sections/${section.id}`,
      jsonInit("PATCH", { section_name: "Renamed" }),
      env,
    );
    expect(renamed.status).toBe(200);
    const renamedBody = (await renamed.json()) as SectionBody;
    expect(renamedBody.section.content_version).toBe(1);
    expect(linkInstances(sdb, section.id)[0]?.public_id).toBe(headlineLnk);

    // (2) Content PATCH: drop the clickable headline, add a button → re-render
    // + rebuild + bump.
    const updated = await admin.request(
      `/api/admin/listicles/sections/${section.id}`,
      jsonInit("PATCH", {
        headline_offer_id: null,
        content_json: {
          blocks: [
            { type: "paragraph", data: { text: "two" } },
            { type: "button", data: { text: "Go", offer_id: offerB } },
          ],
        },
      }),
      env,
    );
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as SectionBody;
    expect(updatedBody.section.content_version).toBe(2);
    expect(updatedBody.section.content_html).toContain("<p>two</p>");

    const instances = linkInstances(sdb, section.id);
    expect(instances).toHaveLength(1);
    expect(instances[0]?.link_role).toBe("button");
    expect(sectionOffers(sdb, section.id)).toEqual([
      { offer_id: offerB, link_role: "button", occurrences: 1 },
    ]);

    // (3) PATCHing via the `image` alias replaces the stored image_json (a
    // provided alias must not be shadowed by the existing *_json value).
    const withImage = await admin.request(
      `/api/admin/listicles/sections/${section.id}`,
      jsonInit("PATCH", { image: { type: "image", url: "https://cdn.example.com/pic.jpg" } }),
      env,
    );
    expect(withImage.status).toBe(200);
    const imageRow = sdb
      .prepare("SELECT image_json FROM listicle_sections WHERE id = ?")
      .get(section.id) as { image_json: string | null };
    expect(imageRow.image_json).toContain("cdn.example.com/pic.jpg");
  });
});

describeDb("section delete — 409 while candidate-referenced, else soft-archive (§5.3)", () => {
  it("blocks with usage rows while a page candidate references the section", async () => {
    const { sdb, env } = newHarness();
    const created = await admin.request(
      "/api/admin/listicles/sections",
      jsonInit("POST", {
        section_name: "Used",
        headline_text: "h",
        content_json: { blocks: [{ type: "paragraph", data: { text: "x" } }] },
      }),
      env,
    );
    const { section } = (await created.json()) as SectionBody;

    // Reference it from an article version page candidate.
    sdb
      .prepare(
        "INSERT INTO listicle_articles (public_id, site_id, slug, article_name) VALUES ('art_u1', 'st_test', 'used-article', 'Used Article')",
      )
      .run();
    const articleId = (sdb.prepare("SELECT id FROM listicle_articles WHERE public_id = 'art_u1'").get() as { id: number }).id;
    sdb
      .prepare(
        "INSERT INTO listicle_article_versions (public_id, article_id, headline, intro_paragraph) VALUES ('ver_u1', ?, 'H', 'I')",
      )
      .run(articleId);
    const versionId = (sdb.prepare("SELECT id FROM listicle_article_versions WHERE public_id = 'ver_u1'").get() as { id: number }).id;
    sdb
      .prepare(
        "INSERT INTO listicle_pages (public_id, article_version_id, page_index) VALUES ('pg_u1', ?, 0)",
      )
      .run(versionId);
    const pageId = (sdb.prepare("SELECT id FROM listicle_pages WHERE public_id = 'pg_u1'").get() as { id: number }).id;
    sdb
      .prepare(
        "INSERT INTO listicle_page_section_candidates (public_id, page_id, section_id) VALUES ('cand_u1', ?, ?)",
      )
      .run(pageId, section.id);

    const blocked = await admin.request(
      `/api/admin/listicles/sections/${section.id}`,
      { method: "DELETE" },
      env,
    );
    expect(blocked.status).toBe(409);
    const blockedBody = (await blocked.json()) as {
      usage: Array<{ public_id: string; version_public_id: string; page_index: number }>;
    };
    expect(blockedBody.usage[0]).toMatchObject({
      public_id: "art_u1",
      version_public_id: "ver_u1",
      page_index: 0,
    });

    // The usage endpoint reports the same §5.4 rows.
    const usage = await admin.request(
      `/api/admin/listicles/sections/${section.id}/usage`,
      {},
      env,
    );
    expect(((await usage.json()) as { usage: unknown[] }).usage).toHaveLength(1);

    // Still active — nothing was archived by the refused delete.
    const status = sdb
      .prepare("SELECT status FROM listicle_sections WHERE id = ?")
      .get(section.id) as { status: string };
    expect(status.status).toBe("active");
  });

  it("soft-archives an unreferenced section (row survives with status='archived')", async () => {
    const { sdb, env } = newHarness();
    const created = await admin.request(
      "/api/admin/listicles/sections",
      jsonInit("POST", {
        section_name: "Unused",
        headline_text: "h",
        content_json: { blocks: [{ type: "paragraph", data: { text: "x" } }] },
      }),
      env,
    );
    const { section } = (await created.json()) as SectionBody;

    const res = await admin.request(
      `/api/admin/listicles/sections/${section.id}`,
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; archived: boolean; section: { status: string } };
    expect(body.archived).toBe(true);
    expect(body.section.status).toBe("archived");
    // Soft: the row still exists.
    const row = sdb
      .prepare("SELECT status FROM listicle_sections WHERE id = ?")
      .get(section.id) as { status: string };
    expect(row.status).toBe("archived");
  });
});

describeDb("section extras — offers / analytics endpoints", () => {
  it("GET /:id/offers lists the §5.4 offer attribution; analytics returns zeros on an empty mirror", async () => {
    const { sdb, env } = newHarness();
    const offerA = seedOffer(sdb, "off_x1", "X1");
    const created = await admin.request(
      "/api/admin/listicles/sections",
      jsonInit("POST", {
        section_name: "S",
        headline_text: "h",
        headline_offer_id: offerA,
        content_json: { blocks: [{ type: "paragraph", data: { text: "x" } }] },
      }),
      env,
    );
    const { section } = (await created.json()) as SectionBody;

    const offers = await admin.request(
      `/api/admin/listicles/sections/${section.id}/offers`,
      {},
      env,
    );
    const offersBody = (await offers.json()) as {
      offers: Array<{ public_id: string; link_role: string; occurrences: number }>;
    };
    expect(offersBody.offers).toHaveLength(1);
    expect(offersBody.offers[0]).toMatchObject({
      public_id: "off_x1",
      link_role: "headline",
      occurrences: 1,
    });

    const analytics = await admin.request(
      `/api/admin/listicles/sections/${section.id}/analytics?from=2026-06-01&to=2026-06-30`,
      {},
      env,
    );
    expect(analytics.status).toBe(200);
    const analyticsBody = (await analytics.json()) as { analytics: Record<string, number | string> };
    expect(analyticsBody.analytics.impressions).toBe(0);
    expect(analyticsBody.analytics.ctr).toBe(0);
  });
});
