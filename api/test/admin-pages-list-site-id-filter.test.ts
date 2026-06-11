// RX4 / MQAFIX-4 — GET /admin/pages MUST render the Site filter as a
// <select name="site_id"> element (NOT name="site"), per the T6.AC1 spec
// literal that calls for the wire name `site_id`.
//
// AC3 BEHAVIORAL contract (.ralph/execution_stories.json#RX4.AC3):
//   GIVEN GET /admin/pages
//   THEN  HTML response body contains literal substring '<select' AND
//         'name="site_id"' together (regex test), proving the Site
//         filter is wired with the canonical `site_id` wire name and not
//         the legacy `site` name.
//
// AC1 (grep contract) + AC2 (no name="site" double-render) are static
// greps against api/src/admin/templates/pages.ts and are independently
// satisfied by the file's current content. This file closes the
// HTTP-level wire contract that the static grep alone cannot prove.
//
// The route under test is `adminUi.get('/admin/pages', ...)` in
// api/src/admin/ui.ts. The renderer it calls is `pagesListPage` from
// api/src/admin/templates/pages.ts (the CANONICAL template — the legacy
// views/ peer was deleted with the final B-port fold, T33).
//
// T29 ([B8] Pages port + CRUD) adds the second describe block below:
// behavioral coverage for POST/PATCH/DELETE /api/admin/pages(:id)
// (api/src/admin/pages-crud-handlers.ts) — registration, mock-D1
// persistence, page_type retention on PATCH, the legal global-template
// path, and a real-SQLite (node:sqlite) migration-chain round-trip of
// show_in_footer/display_order through migration 0012.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

// vitest's bundled vite does not resolve a static runtime import of
// node:sqlite; the implementation is fetched through
// process.getBuiltinModule (Node >= 22.3) which bypasses the vite
// resolver (same pattern as test/migrations-0010-content-mode.test.ts).
const { DatabaseSync: SqliteDatabase } = process.getBuiltinModule("node:sqlite");

vi.mock("../src/admin/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/admin/data")>();
  return {
    ...actual,
    listAdminPages: vi.fn(),
    listAdminSites: vi.fn(),
  };
});

import { adminUi } from "../src/admin/ui";
import admin from "../src/admin/router";
import * as data from "../src/admin/data";
import type { Env } from "../src/env";

function makeEnv(): Env {
  return {
    DB: {} as unknown as D1Database,
    CACHE: {} as unknown as KVNamespace,
    MEDIA: {} as unknown as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
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

async function fetchPages(): Promise<{ status: number; body: string }> {
  const res = await adminUi.fetch(
    new Request("http://cms.kodigital.app/admin/pages"),
    makeEnv(),
  );
  return { status: res.status, body: await res.text() };
}

describe("RX4 pages list site_id filter wire contract", () => {
  beforeEach(() => {
    vi.mocked(data.listAdminPages).mockReset();
    vi.mocked(data.listAdminSites).mockReset();
    vi.mocked(data.listAdminPages).mockResolvedValue([]);
    vi.mocked(data.listAdminSites).mockResolvedValue([
      { id: "siteA", name: "Site A" },
      { id: "siteB", name: "Site B" },
    ]);
  });

  it("RX4.AC3: GET /admin/pages renders <select name=\"site_id\"> Site filter", async () => {
    const { status, body } = await fetchPages();
    expect(status).toBe(200);
    // AC3 literal regex: `<select` AND `name="site_id"` together.
    expect(body).toMatch(/<select\s+name="site_id"/);
  });

  it("RX4.AC2: GET /admin/pages does NOT render legacy <select name=\"site\"> (double-render guard)", async () => {
    const { status, body } = await fetchPages();
    expect(status).toBe(200);
    // The legacy wire name MUST NOT appear on a <select element.
    // Use a tight regex that requires `<select ... name="site"` with a
    // word boundary so it does not accidentally match `name="site_id"`.
    expect(body).not.toMatch(/<select[^>]*\sname="site"[\s>]/);
  });

  it("RX4: GET /admin/pages exposes both Site filter and Page-type filter on the toolbar", async () => {
    const { status, body } = await fetchPages();
    expect(status).toBe(200);
    // Two distinct <select> elements, both named per the canonical wire
    // contract — this is the same shape pages-template.test.ts asserts
    // at the unit level, lifted to the route level.
    expect(body).toMatch(/<select\s+name="site_id"/);
    expect(body).toMatch(/<select\s+name="page_type"/);
  });

  it("RX4: GET /admin/pages renders site rows from data.listAdminSites into the Site filter options", async () => {
    vi.mocked(data.listAdminSites).mockResolvedValue([
      { id: "siteA", name: "Acme" },
      { id: "siteB", name: "Beta" },
    ]);
    const { status, body } = await fetchPages();
    expect(status).toBe(200);
    expect(data.listAdminSites).toHaveBeenCalledTimes(1);
    expect(body).toContain('<option value="siteA"');
    expect(body).toContain("Acme");
    expect(body).toContain('<option value="siteB"');
    expect(body).toContain("Beta");
  });
});

// ===========================================================================
// T29 ([B8] Pages port + CRUD) — POST/PATCH/DELETE /api/admin/pages(:id)
// ===========================================================================

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

interface PlantedRow {
  match: string;
  row: unknown | null;
}

// Recording fake D1 (same shape as test/admin-articles-post-site-id.test.ts):
// every prepare().bind().first/run/all() is captured; .first() resolves to
// the first planted row whose match substring appears in the SQL.
function makeFakeDb(planted: PlantedRow[] = []): {
  db: D1Database;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          calls.push({ sql, binds: captured });
          for (const entry of planted) {
            if (sql.indexOf(entry.match) >= 0) {
              return (entry.row ?? null) as T | null;
            }
          }
          return null;
        },
        async run() {
          calls.push({ sql, binds: captured });
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          calls.push({ sql, binds: captured });
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

// The pages write handlers call applyPageMutationCacheInvalidation for
// site-owned pages (content_version bump + KV prefix wipe), so the env
// needs a functioning KV fake (empty namespace).
function makeFakeKv(): KVNamespace {
  return {
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
    async delete() {},
  } as unknown as KVNamespace;
}

function buildCrudEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: makeFakeKv(),
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

function findCall(
  calls: RecordedCall[],
  substring: string,
): RecordedCall | undefined {
  return calls.find((c) => c.sql.indexOf(substring) >= 0);
}

const INSERTED_PAGE = {
  id: 11,
  site_id: "siteA",
  slug: "about-us",
  title: "About Us",
  content_json: '{"version":1,"blocks":[]}',
  content_html: null,
  status: "draft",
  template: "default",
  show_in_footer: 1,
  display_order: 7,
  page_type: "about",
  seo_title: null,
  seo_description: null,
  created_at: 1,
  updated_at: 1,
};

describe("T29 pages CRUD port (POST/PATCH/DELETE /api/admin/pages)", () => {
  it("page CRUD persists rows via mock-D1 db.prepare", async () => {
    // --- POST: INSERT goes through db.prepare + .bind (parameterized) ---
    const post = makeFakeDb([
      { match: "SELECT id FROM sites WHERE id = ?", row: { id: "siteA" } },
      { match: "INSERT INTO pages", row: INSERTED_PAGE },
    ]);
    const postRes = await admin.request(
      "/api/admin/pages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          site_id: "siteA",
          title: "About Us",
          slug: "about-us",
          page_type: "about",
          status: "draft",
          show_in_footer: 1,
          display_order: 7,
        }),
      },
      buildCrudEnv(post.db),
    );
    expect(postRes.status).toBe(201);
    const postBody = (await postRes.json()) as { page: typeof INSERTED_PAGE };
    expect(postBody.page.id).toBe(11);
    expect(postBody.page.show_in_footer).toBe(1);
    expect(postBody.page.display_order).toBe(7);
    const insert = findCall(post.calls, "INSERT INTO pages");
    expect(insert).toBeDefined();
    // Static SQL with positional placeholders only — no interpolation.
    expect(insert?.sql).toContain("VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    expect(insert?.sql.indexOf("${")).toBe(-1);
    expect(insert?.binds[0]).toBe("siteA");
    expect(insert?.binds[1]).toBe("about-us");
    expect(insert?.binds[2]).toBe("About Us");
    expect(insert?.binds[7]).toBe(1); // show_in_footer
    expect(insert?.binds[8]).toBe(7); // display_order
    // Site-owned write fires the per-site cache invalidation contract.
    const bump = findCall(
      post.calls,
      "UPDATE sites SET content_version = content_version + 1",
    );
    expect(bump).toBeDefined();
    expect(bump?.binds).toEqual(["siteA"]);

    // --- PATCH: allow-list UPDATE through db.prepare + .bind ---
    const patch = makeFakeDb([
      {
        match: "page_type FROM pages WHERE id = ?",
        row: { id: 11, site_id: "siteA", slug: "about-us", page_type: "about" },
      },
      {
        match: "title, content_json",
        row: {
          ...INSERTED_PAGE,
          title: "About Us v2",
          show_in_footer: 0,
          display_order: 3,
        },
      },
    ]);
    const patchRes = await admin.request(
      "/api/admin/pages/11",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "About Us v2",
          show_in_footer: 0,
          display_order: 3,
        }),
      },
      buildCrudEnv(patch.db),
    );
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as { page: typeof INSERTED_PAGE };
    expect(patchBody.page.show_in_footer).toBe(0);
    expect(patchBody.page.display_order).toBe(3);
    const update = findCall(patch.calls, "UPDATE pages SET");
    expect(update).toBeDefined();
    expect(update?.sql).toContain("updated_at = unixepoch()");
    expect(update?.binds).toEqual(["About Us v2", 0, 3, 11]);

    // --- DELETE: parameterized DELETE ---
    const del = makeFakeDb([
      {
        match: "SELECT id, site_id FROM pages WHERE id = ?",
        row: { id: 11, site_id: null },
      },
    ]);
    const delRes = await admin.request(
      "/api/admin/pages/11",
      { method: "DELETE" },
      buildCrudEnv(del.db),
    );
    expect(delRes.status).toBe(200);
    expect((await delRes.json()) as object).toEqual({ ok: true, id: 11 });
    const remove = findCall(del.calls, "DELETE FROM pages WHERE id = ?");
    expect(remove).toBeDefined();
    expect(remove?.binds).toEqual([11]);
  });

  it("T29.AC1: POST/PATCH/DELETE routes are registered and PATCH retains page_type when absent from the body", async () => {
    // Registration: malformed input reaches the handlers (400), it does
    // not fall through to Hono's 404.
    const reg = makeFakeDb();
    const env = buildCrudEnv(reg.db);
    const badPost = await admin.request(
      "/api/admin/pages",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{" },
      env,
    );
    expect(badPost.status).toBe(400);
    const badPatch = await admin.request(
      "/api/admin/pages/not-a-number",
      { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" },
      env,
    );
    expect(badPatch.status).toBe(400);
    const badDelete = await admin.request(
      "/api/admin/pages/not-a-number",
      { method: "DELETE" },
      env,
    );
    expect(badDelete.status).toBe(400);

    // page_type retention: a PATCH without page_type must not touch the
    // stored page_type — the UPDATE SET clause omits the column entirely.
    const patch = makeFakeDb([
      {
        match: "page_type FROM pages WHERE id = ?",
        row: {
          id: 3,
          site_id: null,
          slug: "privacy-policy",
          page_type: "privacy-policy",
        },
      },
      {
        match: "title, content_json",
        row: {
          ...INSERTED_PAGE,
          id: 3,
          site_id: null,
          slug: "privacy-policy",
          page_type: "privacy-policy",
          title: "Privacy v2",
        },
      },
    ]);
    const res = await admin.request(
      "/api/admin/pages/3",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Privacy v2" }),
      },
      buildCrudEnv(patch.db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { page: { page_type: string } };
    expect(body.page.page_type).toBe("privacy-policy");
    const update = findCall(patch.calls, "UPDATE pages SET");
    expect(update).toBeDefined();
    expect(update?.sql).not.toContain("page_type");
  });

  it("T29.AC1: legal page_type creates a global template (site_id NULL); non-legal requires site_id", async () => {
    const legal = makeFakeDb([
      {
        match: "INSERT INTO pages",
        row: {
          ...INSERTED_PAGE,
          id: 21,
          site_id: null,
          slug: "privacy-policy",
          title: "Privacy Policy",
          page_type: "privacy-policy",
        },
      },
    ]);
    const legalRes = await admin.request(
      "/api/admin/pages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Privacy Policy",
          page_type: "privacy-policy",
        }),
      },
      buildCrudEnv(legal.db),
    );
    expect(legalRes.status).toBe(201);
    const legalBody = (await legalRes.json()) as {
      page: { site_id: string | null; page_type: string };
    };
    expect(legalBody.page.site_id).toBeNull();
    expect(legalBody.page.page_type).toBe("privacy-policy");
    const insert = findCall(legal.calls, "INSERT INTO pages");
    expect(insert?.binds[0]).toBeNull(); // site_id bound as NULL
    // Global slug uniqueness probe ran against the global tier.
    expect(findCall(legal.calls, "site_id IS NULL")).toBeDefined();

    const nonLegal = makeFakeDb();
    const nonLegalRes = await admin.request(
      "/api/admin/pages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "About", page_type: "about" }),
      },
      buildCrudEnv(nonLegal.db),
    );
    expect(nonLegalRes.status).toBe(400);
    const err = (await nonLegalRes.json()) as { error: string };
    expect(err.error).toMatch(/site_id is required/i);
    expect(findCall(nonLegal.calls, "INSERT INTO pages")).toBeUndefined();
  });

  it("T29.AC1: pages list renders the legal Global template badge, the page_type cell, and the Delete row action", async () => {
    vi.mocked(data.listAdminPages).mockResolvedValue([
      {
        id: "3",
        title: "Privacy Policy",
        slug: "privacy-policy",
        site: "",
        site_id: null,
        page_type: "privacy-policy",
        status: "published",
        show_in_footer: true,
        updated_at: "2026-06-11",
      },
    ]);
    const { status, body } = await fetchPages();
    expect(status).toBe(200);
    expect(body).toContain("Global template");
    expect(body).toContain("<td>privacy-policy</td>");
    expect(body).toContain('data-delete-page="3"');
  });

  it("T29.AC2: migrations 0001..0012 round-trip show_in_footer/display_order on real SQLite", () => {
    const migrationsDir = resolve(__dirname, "..", "migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files).toContain("0012_phase9_pages_admin_crud_columns.sql");
    const sqlite = new SqliteDatabase(":memory:");
    sqlite.exec("PRAGMA foreign_keys = OFF;");
    for (const file of files) {
      sqlite.exec(readFileSync(join(migrationsDir, file), "utf8"));
    }

    // Schema: migration 0012 added the three admin CRUD columns.
    const cols = sqlite
      .prepare("PRAGMA table_info(pages)")
      .all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
    const displayOrder = cols.find((c) => c.name === "display_order");
    expect(displayOrder).toBeDefined();
    expect(displayOrder?.type.toUpperCase()).toBe("INTEGER");
    expect(displayOrder?.notnull).toBe(1);
    expect(displayOrder?.dflt_value).toBe("0");
    expect(cols.find((c) => c.name === "seo_title")?.type.toUpperCase()).toBe("TEXT");
    expect(cols.find((c) => c.name === "seo_description")?.type.toUpperCase()).toBe("TEXT");

    // Write -> read round-trip with the exact INSERT shape the create
    // handler issues (global legal template, site_id NULL).
    sqlite
      .prepare(
        "INSERT INTO pages (site_id, slug, title, content_json, content_html, status, template, show_in_footer, display_order, page_type, seo_title, seo_description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(null, "t29-footer", "T29", "{}", null, "draft", "default", 1, 7, "privacy-policy", null, null);
    const created = sqlite
      .prepare(
        "SELECT show_in_footer, display_order, page_type FROM pages WHERE slug = ?",
      )
      .get("t29-footer") as { show_in_footer: number; display_order: number; page_type: string };
    expect(created.show_in_footer).toBe(1);
    expect(created.display_order).toBe(7);
    expect(created.page_type).toBe("privacy-policy");

    sqlite
      .prepare(
        "UPDATE pages SET show_in_footer = ?, display_order = ? WHERE slug = ?",
      )
      .run(0, 3, "t29-footer");
    const updated = sqlite
      .prepare(
        "SELECT show_in_footer, display_order, page_type FROM pages WHERE slug = ?",
      )
      .get("t29-footer") as { show_in_footer: number; display_order: number; page_type: string };
    expect(updated.show_in_footer).toBe(0);
    expect(updated.display_order).toBe(3);
    // page_type untouched by the footer/order update — retained.
    expect(updated.page_type).toBe("privacy-policy");
    sqlite.close();
  });
});
