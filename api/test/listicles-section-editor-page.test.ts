// Listicles Phase 4 — Section editor page routes + anatomy (§4/§10/§13/§30.6)
// over the REAL admin router + REAL migrations (node:sqlite harness, repo
// pattern from listicles-sections-api.test.ts).
//
//   * GET /admin/listicles/sections/new       → 200 + full §10 anatomy
//   * GET /admin/listicles/sections/:id/edit  → 200 (existing) / 404 shell
//   * the §13 Offer picker + inline Create-Offer modal are ON the page
//   * "no free-text URL field" — DOM-level assertion: outside the Offer
//     modal (whose offer_url_template/cap_fallback_url are the §9 Offer
//     DEFINITION, not a content link) there is no url-type/url-named input
//   * the CTA/Link Inventory panel + token-styled preview iframe render
//   * the Sections LIST wires Create/Edit to the new routes

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// --- node:sqlite harness (repo pattern) --------------------------------------

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
        return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
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
          return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
        },
        async all<T = unknown>() {
          return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
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
        for (const statement of statements) results.push(await statement.run());
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

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0032_listicles_core.sql"), "utf8"));
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0033_listicles_analytics_mirror.sql"), "utf8"));
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

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

function seedOffer(sdb: SqliteDb, publicId: string, name: string): number {
  sdb
    .prepare(
      `INSERT INTO listicle_offers
         (public_id, offer_name, provider, activity, vertical,
          conversion_tracking_method, offer_url_template, payout_method, status)
       VALUES (?, ?, 'prov', 'lead', 'pets', 's2s_postback',
               'https://t.example/c?c={click_id}', 'offsite', 'active')`,
    )
    .run(publicId, name);
  return (sdb.prepare("SELECT id FROM listicle_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
}

// Strip <script>/<style> so DOM-level assertions never match source code
// inside the inline scripts (e.g. the shared editor atom's string literals).
function domOnly(html: string): string {
  return html
    .replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
}

describeDb("Section editor page — routes + §10 anatomy (Phase 4)", () => {
  it("GET /admin/listicles/sections/new renders the full editor anatomy", async () => {
    const { env } = newHarness();
    const res = await admin.request("/admin/listicles/sections/new", {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const html = await res.text();
    const dom = domOnly(html);

    // §10 create structure
    expect(dom).toContain('id="lst-section-name"');
    expect(dom).toContain("Section image"); // reused hero-image card, relabeled
    expect(dom).toContain('id="hero-image-upload"');
    expect(dom).toContain('id="hero-ai-modal"'); // AI image via presets
    expect(dom).toContain('id="lst-headline-text"');
    expect(dom).toContain('id="lst-headline-clickable"'); // clickable toggle
    expect(dom).toContain('id="lst-ai-preset"'); // AI section presets
    expect(dom).toContain('id="content-editor"'); // the SHARED editor mount
    expect(dom).toContain('id="content_json"');

    // §13 Offer picker (the single link mechanism) + inline Create-Offer
    expect(dom).toContain('id="lst-offer-picker"');
    expect(dom).toContain('id="lst-offer-picker-search"');
    expect(dom).toContain("＋ New Offer");
    expect(dom).toContain('id="offer-modal"');

    // §30.6 CTA/Link Inventory + Section preview
    expect(dom).toContain('id="lst-inv-body"');
    expect(dom).toContain('id="lst-bulk-replace"');
    expect(dom).toContain('id="lst-section-preview"');
    expect(dom).toContain('id="lst-preview-desktop"');
    expect(dom).toContain('id="lst-preview-mobile"');

    // §8 states
    expect(dom).toContain('aria-live="polite"');
    expect(dom).toContain('id="lst-editor-toperror"');
  });

  it("no free-text URL field: outside the Offer modal no url input exists (§13/§26)", async () => {
    const { env } = newHarness();
    const res = await admin.request("/admin/listicles/sections/new", {}, env);
    const dom = domOnly(await res.text());

    // Remove the Create-Offer modal (its offer_url_template/cap_fallback_url
    // are the §9 Offer definition — not a content link input).
    const withoutOfferModal = dom.replace(
      /<div id="offer-modal"[\s\S]*?<\/form>\s*<\/div>\s*<\/div>/,
      "",
    );
    expect(withoutOfferModal).not.toMatch(/<input[^>]*type="url"/i);
    expect(withoutOfferModal).not.toMatch(/<input[^>]*name="[^"]*url[^"]*"/i);
    expect(withoutOfferModal).not.toMatch(/<textarea[^>]*name="[^"]*url[^"]*"/i);
    // The §13 picker itself carries only a SEARCH input.
    const picker = dom.match(/<div id="lst-offer-picker"[\s\S]*?<\/div>\s*<\/div>$/m)?.[0] ?? "";
    expect(picker).not.toMatch(/type="url"/i);
  });

  it("GET /sections/:id/edit renders the stored section; unknown id → 404 shell", async () => {
    const { sdb, env } = newHarness();
    const offerA = seedOffer(sdb, "off_edit0001", "Edit Offer");
    const created = await admin.request(
      "/api/admin/listicles/sections",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section_name: "Editable section",
          headline_text: "Clickable headline",
          headline_offer_id: offerA,
          content_json: {
            blocks: [
              { id: "p1", type: "paragraph", data: { text: "Body copy" } },
              {
                id: "g1",
                type: "choice_button_group",
                data: {
                  layout_binding: "default.choiceButtonGroup",
                  prompt: "Pick",
                  items: [
                    { id: "i1", link_instance_id: "", text: "Choice A", offer_id: "off_edit0001", style_id: "reference-choice-button" },
                  ],
                },
              },
            ],
          },
        }),
      },
      env,
    );
    expect(created.status).toBe(201);
    const section = ((await created.json()) as { section: { public_id: string } }).section;

    const res = await admin.request(
      `/admin/listicles/sections/${section.public_id}/edit`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('data-mode="edit"');
    expect(html).toContain(`data-section-id="${section.public_id}"`);
    expect(html).toContain("Editable section");
    // The boot payload carries the stored offer names for the chips/inventory.
    expect(html).toContain("_lstEditorBoot");
    expect(html).toContain("Edit Offer");

    const missing = await admin.request("/admin/listicles/sections/sec_missing/edit", {}, env);
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("Section not found");
  });

  it("the Sections list wires Create + Edit to the live editor routes", async () => {
    const { sdb, env } = newHarness();
    const offerA = seedOffer(sdb, "off_list0001", "List Offer");
    await admin.request(
      "/api/admin/listicles/sections",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          section_name: "Row section",
          headline_text: "H",
          content_json: {
            blocks: [{ id: "b1", type: "button", data: { text: "Go", offer_id: offerA } }],
          },
        }),
      },
      env,
    );
    const res = await admin.request("/admin/listicles/sections", {}, env);
    const html = await res.text();
    expect(html).toContain('href="/admin/listicles/sections/new"');
    expect(html).toMatch(/href="\/admin\/listicles\/sections\/\d+\/edit"/);
  });
});
