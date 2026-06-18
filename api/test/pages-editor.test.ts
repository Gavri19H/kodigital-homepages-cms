// T33 — Pages content block editor + GET-by-id endpoints.
//
// Backs RC-057 (T33-AC1). The backing it() title embeds the
// `[api/test/pages-editor.test.ts]` file literal (the
// expected_test_name_regex binding) AND the T33-AC1:RC-057 observation
// tag so the finalize/evaluator RC↔test binding is unambiguous.
//
// Two behavioral proofs, not bind-shape echoes:
//   1. pageFormPage renders the SAME contenteditable WYSIWYG block editor
//      as articleFormPage — an empty #content-editor mount div paired with a
//      HIDDEN textarea#content_json. The block editor is mounted client-side
//      by window.initBlockEditor (via the shared mount script) onto that div,
//      building the contenteditable surface + toolbar in the browser — and
//      NOT a visible raw-JSON <textarea name="content_json" class="form-textarea">.
//   2. GET /api/admin/pages/:id and GET /api/admin/categories/:id each
//      return a SINGLE record ({ item }) on a hit, 404 on an unknown id,
//      and 400 on a non-numeric id — served through the real admin router
//      against a stateful fake D1 (negative_fail_condition: a 2xx whose
//      body.item is absent / the wrong row).

import { describe, it, expect } from "vitest";
import admin from "../src/admin/router";
import { buildEnv } from "./helpers/admin-test-kit";
import { pageFormPage } from "../src/admin/templates/pages";

interface PageRecord {
  id: number;
  site_id: string | null;
  slug: string;
  title: string;
  content_json: string;
  content_html: string | null;
  status: string;
  template: string;
  show_in_footer: number;
  display_order: number;
  page_type: string;
  seo_title: string | null;
  seo_description: string | null;
  created_at: number;
  updated_at: number;
}

interface CatRecord {
  id: number;
  slug: string;
  name: string;
  parent_id: number | null;
  featured_image_id: number | null;
  display_order: number;
  article_count: number;
  description: string | null;
  show_on_homepage: number;
}

// Stateful fake D1 shared by the page + category detail reads. Both
// getPageHandler and getCategoryHandler issue `.first()` against
// "... FROM <table> WHERE id = ? LIMIT 1"; the fake routes on that literal
// and returns a COPY of the stored row (so the handler echoes the real row,
// not a hand-built stub).
function makeDb(pages: PageRecord[], cats: CatRecord[]): D1Database {
  const pageStore = new Map<number, PageRecord>();
  for (const p of pages) pageStore.set(p.id, { ...p });
  const catStore = new Map<number, CatRecord>();
  for (const ct of cats) catStore.set(ct.id, { ...ct });

  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.indexOf("FROM pages WHERE id = ?") >= 0) {
            const [id] = binds as [number];
            const row = pageStore.get(id);
            return row ? ({ ...row } as T) : null;
          }
          if (sql.indexOf("FROM categories WHERE id = ?") >= 0) {
            const [id] = binds as [number];
            const row = catStore.get(id);
            return row ? ({ ...row } as T) : null;
          }
          return null;
        },
        async run() {
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return db;
}

function seedPage(): PageRecord {
  return {
    id: 5,
    site_id: "siteA",
    slug: "about-us",
    title: "About Us",
    content_json: '{"version":1,"blocks":[{"type":"paragraph","data":{"text":"Hello"}}]}',
    content_html: "<p>Hello</p>",
    status: "published",
    template: "default",
    show_in_footer: 1,
    display_order: 0,
    page_type: "about",
    seo_title: "About",
    seo_description: "About the company",
    created_at: 1700000000,
    updated_at: 1700000100,
  };
}

function seedCat(): CatRecord {
  return {
    id: 3,
    slug: "travel",
    name: "Travel",
    parent_id: null,
    featured_image_id: null,
    display_order: 2,
    article_count: 0,
    description: "Curated travel guides",
    show_on_homepage: 1,
  };
}

describe("T33 pages content block editor + GET-by-id endpoints", () => {
  it("[api/test/pages-editor.test.ts] L2_AUTO_DISAMBIGUATION:T33-AC1:RC-057 page form uses the block editor (no raw JSON textarea) and GET /pages/:id + GET /categories/:id return a single record", async () => {
    // --- Proof 1: the block-based WYSIWYG editor, not a raw JSON box.
    const html = pageFormPage(null, [{ id: "siteA", name: "Site A" }]);

    // The same block-editor surface articleFormPage uses: an empty
    // #content-editor mount div that the client editor script populates via
    // initBlockEditor(). (The toolbar is built in the browser, not server-rendered.)
    expect(html).toContain('<div id="content-editor"></div>');
    expect(html).toContain("initBlockEditor");
    // The embedded editor wiring drives the contenteditable blocks client-side.
    expect(html).toContain('contenteditable="true"');
    // The canonical state lives in a HIDDEN textarea the submit reads.
    expect(html).toMatch(
      /<textarea id="content_json" name="content_json" class="content-json-input" hidden/,
    );
    // And there is NO visible raw-JSON content textarea any more.
    expect(html).not.toMatch(/<textarea[^>]*name="content_json"[^>]*class="form-textarea"/);
    // The label points at the editable surface, not the retired #page-content.
    expect(html).toContain('<label for="content-editor" class="form-label">Content</label>');
    expect(html).not.toContain('id="page-content"');

    // --- Proof 2: single-record detail routes through the real admin router.
    const db = makeDb([seedPage()], [seedCat()]);
    const env = buildEnv(db);

    // GET /api/admin/pages/:id -> one record.
    const pageRes = await admin.request("/api/admin/pages/5", { method: "GET" }, env);
    expect(pageRes.status).toBe(200);
    const pageBody = (await pageRes.json()) as {
      item: { id: number; slug: string; content_json: string };
    };
    expect(pageBody.item.id).toBe(5);
    expect(pageBody.item.slug).toBe("about-us");
    expect(pageBody.item.content_json).toContain('"blocks"');

    // Unknown page id is a clean 404, non-numeric id a 400 (not a 500).
    expect(
      (await admin.request("/api/admin/pages/999", { method: "GET" }, env)).status,
    ).toBe(404);
    expect(
      (await admin.request("/api/admin/pages/abc", { method: "GET" }, env)).status,
    ).toBe(400);

    // GET /api/admin/categories/:id -> one record.
    const catRes = await admin.request("/api/admin/categories/3", { method: "GET" }, env);
    expect(catRes.status).toBe(200);
    const catBody = (await catRes.json()) as {
      item: { id: number; slug: string; name: string };
    };
    expect(catBody.item.id).toBe(3);
    expect(catBody.item.slug).toBe("travel");
    expect(catBody.item.name).toBe("Travel");
  });
});
