// X15 — Pages → "Save changes" / "Create page" update what visitors see.
//
// Before X15 the Page form sent only content_json while the public site
// renders only content_html, so every save changed the editor copy and left
// the live page as it was. These tests pin, against the REAL handlers / form
// script / renderer:
//   1. PATCH + POST rebuild content_html from the editor document; a
//      non-block record (the site setup's legal_template_rendered JSON) or an
//      explicit content_html never gets overwritten by the rebuild.
//   2. htmlToBlocks round-trips the setup's stored page HTML (visible text
//      word for word), so the editor opens with the real text.
//   3. The edit screen fills the editor from the live text, shows the help
//      text, and marks setup-made Pages (site-owned + one of the five setup
//      slugs) for the warning.
//   4. The warning appears on EVERY "Save changes" of a setup page; "Keep
//      editing", Escape and the overlay save nothing; "Save to live site"
//      saves once. Other Pages save straight away.
//   5. D2: the live page uses seo_title / seo_description when filled.

import { describe, it, expect, vi } from "vitest";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import { buildEnv } from "./helpers/admin-test-kit";
import { miniDocument, type MiniNode } from "./helpers/mini-dom";
import { pageFormPage, PAGE_FORM_SCRIPT } from "../src/admin/templates/pages";
import { htmlToBlocks, editorJsonForPage, hasEditorBlocks } from "../src/editor/html-to-blocks";
import { blocksToHtml } from "../src/editor/blocks-to-html";
import { isSetupPage, SETUP_PAGE_SLUGS } from "../src/site-provisioning/legal-renderer";
import { renderPageHtml } from "../src/public/render-pages";
import type { PublicPageRow } from "../src/public/queries";

// ---------------------------------------------------------------- sqlite D1
type SqliteDb = {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  close(): void;
  [method: string]: unknown;
};
type DatabaseSyncCtor = new (path: string) => SqliteDb;

async function loadDatabaseSync(): Promise<DatabaseSyncCtor | null> {
  try {
    const { createRequire } = await import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    return null;
  }
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
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
  } as unknown as D1Database;
}

const SCHEMA = `
CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, vertical_slug TEXT, activity TEXT, status TEXT DEFAULT 'active', settings_version INTEGER DEFAULT 0, last_provisioned_at INTEGER, created_at INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0, content_version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  content_html TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  template TEXT NOT NULL DEFAULT 'default',
  show_in_footer INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  site_id TEXT REFERENCES sites(id),
  page_type TEXT NOT NULL DEFAULT 'generic',
  seo_title TEXT,
  seo_description TEXT
);`;

// Shape of the site setup's stored legal page (legal-renderer.ts).
const LEGAL_RECORD = JSON.stringify({ kind: "legal_template_rendered", slug: "terms", schema_version: 1, vars: {} });
const LIVE_TERMS =
  '<h1>Terms of Use</h1><p><em>Last updated: 2026-06-23</em></p><p>By using Playtrail you agree to these terms.</p>' +
  '<h2>Using the site</h2><h3>Accounts</h3><p>You must be 18 or older.</p><ul><li>Be respectful.</li><li>No spam.</li></ul>' +
  '<p>Questions? Write to "legal" at playtrail.net.</p>';

const EDITOR_DOC = JSON.stringify({
  version: 1,
  blocks: [
    { id: "a", type: "heading", data: { text: "New heading", level: 2 } },
    { id: "b", type: "paragraph", data: { text: "Edited body & more" } },
    { id: "c", type: "list", data: { style: "unordered", items: ["One", "Two"] } },
  ],
});
const EDITOR_DOC_HTML = "<h2>New heading</h2><p>Edited body &amp; more</p><ul><li>One</li><li>Two</li></ul>";

async function seeded(): Promise<{ sdb: SqliteDb; env: ReturnType<typeof buildEnv> } | null> {
  const DatabaseSync = await loadDatabaseSync();
  if (!DatabaseSync) return null;
  const sdb = new DatabaseSync(":memory:");
  (sdb["exec"] as (s: string) => void)(SCHEMA);
  sdb.prepare("INSERT INTO sites (id, name) VALUES (?, ?)").run("site-pt", "Playtrail");
  sdb.prepare(
    "INSERT INTO pages (id, site_id, slug, title, content_json, content_html, status, page_type) VALUES (?, ?, ?, ?, ?, ?, 'published', ?)",
  ).run(64, "site-pt", "terms", "Terms of Use", LEGAL_RECORD, LIVE_TERMS, "terms");
  sdb.prepare(
    "INSERT INTO pages (id, site_id, slug, title, content_json, content_html, status, page_type) VALUES (?, ?, ?, ?, ?, ?, 'published', ?)",
  ).run(90, "site-pt", "x15-check", "X15 check", EDITOR_DOC, "<p>old live text</p>", "generic");
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

function liveHtml(sdb: SqliteDb, id: number): string | null {
  return (sdb.prepare("SELECT content_html FROM pages WHERE id = ?").get(id) as { content_html: string | null }).content_html;
}

async function patch(env: ReturnType<typeof buildEnv>, id: number, body: Record<string, unknown>): Promise<Response> {
  return admin.request(`/api/admin/pages/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, env);
}

describe("X15 save updates the live page", () => {
  it("PATCH with an editor document rebuilds content_html (the bug: it used to stay unchanged)", async () => {
    const s = await seeded();
    if (!s) return;
    const res = await patch(s.env, 90, { title: "X15 check", content_json: EDITOR_DOC, status: "published" });
    expect(res.status).toBe(200);
    expect(liveHtml(s.sdb, 90)).toBe(EDITOR_DOC_HTML);
    s.sdb.close();
  });

  it("PATCH carrying a non-block record (setup legal JSON) leaves the live text alone", async () => {
    const s = await seeded();
    if (!s) return;
    const res = await patch(s.env, 64, { title: "Terms of Use", content_json: LEGAL_RECORD });
    expect(res.status).toBe(200);
    expect(liveHtml(s.sdb, 64)).toBe(LIVE_TERMS);
    s.sdb.close();
  });

  it("an explicit content_html in the request still wins over the rebuild", async () => {
    const s = await seeded();
    if (!s) return;
    await patch(s.env, 90, { content_json: EDITOR_DOC, content_html: "<p>explicit</p>" });
    expect(liveHtml(s.sdb, 90)).toBe("<p>explicit</p>");
    s.sdb.close();
  });

  it("PATCH without content_json (e.g. a status change) keeps the live text", async () => {
    const s = await seeded();
    if (!s) return;
    await patch(s.env, 90, { status: "draft" });
    expect(liveHtml(s.sdb, 90)).toBe("<p>old live text</p>");
    s.sdb.close();
  });

  it("POST (Create page) stores the rendered live text, not an empty body", async () => {
    const s = await seeded();
    if (!s) return;
    const res = await admin.request("/api/admin/pages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New one", slug: "new-one", site_id: "site-pt", page_type: "generic", status: "published", content_json: EDITOR_DOC }),
    }, s.env);
    expect(res.status).toBeLessThan(300);
    const row = s.sdb.prepare("SELECT content_html FROM pages WHERE slug = 'new-one'").get() as { content_html: string };
    expect(row.content_html).toBe(EDITOR_DOC_HTML);
    s.sdb.close();
  });
});

describe("X15 editor opens with the real text", () => {
  const visible = (h: string): string =>
    h.replace(/<[^>]*>/g, " ").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

  it("htmlToBlocks round-trips the setup's page HTML word for word", () => {
    const doc = htmlToBlocks(LIVE_TERMS);
    expect(doc.blocks.map((b) => b.type)).toEqual([
      "heading", "paragraph", "paragraph", "heading", "heading", "paragraph", "list", "paragraph",
    ]);
    expect((doc.blocks[0]?.data as { level: number }).level).toBe(1);
    expect((doc.blocks[4]?.data as { level: number }).level).toBe(3);
    expect((doc.blocks[1]?.data as { html: string }).html).toBe("<em>Last updated: 2026-06-23</em>");
    expect(visible(blocksToHtml(doc))).toBe(visible(LIVE_TERMS));
  });

  it("text outside known blocks is kept, never dropped", () => {
    const doc = htmlToBlocks("loose words<p>para</p>");
    expect(visible(blocksToHtml(doc))).toBe("loose words para");
  });

  it("editorJsonForPage keeps an editor document and rebuilds a non-block record", () => {
    expect(editorJsonForPage(EDITOR_DOC, "<p>x</p>")).toBe(EDITOR_DOC);
    const filled = editorJsonForPage(LEGAL_RECORD, LIVE_TERMS);
    expect(hasEditorBlocks(filled)).toBe(true);
    expect(visible(blocksToHtml(filled))).toBe(visible(LIVE_TERMS));
    expect(editorJsonForPage(LEGAL_RECORD, "")).toBe(LEGAL_RECORD);
  });

  it("GET /admin/pages/:id/edit fills the editor from the live text, without writing", async () => {
    const s = await seeded();
    if (!s) return;
    const res = await admin.request("/admin/pages/64/edit", {}, s.env);
    expect(res.status).toBe(200);
    const doc = miniDocument(await res.text());
    const stored = (doc.getElementById("content_json") as MiniNode).value;
    expect(hasEditorBlocks(stored)).toBe(true);
    expect(stored).toContain("By using Playtrail you agree to these terms.");
    // nothing written
    expect((s.sdb.prepare("SELECT content_json FROM pages WHERE id = 64").get() as { content_json: string }).content_json).toBe(LEGAL_RECORD);
    s.sdb.close();
  });
});

describe("X15 help text and setup-page marking", () => {
  const HELP_IDS = [
    "page-slug-help", "page-type-help", "page-site-hint", "page-status-help", "page-template-help",
    "page-show-in-footer-help", "page-display-order-help", "page-content-help", "page-seo-title-help",
    "page-seo-description-help",
  ];

  it("every hard field carries its .form-help line (edit and new)", () => {
    for (const html of [pageFormPage({ id: "1", title: "T", slug: "t", site_id: "s" }), pageFormPage(null)]) {
      const doc = miniDocument(html);
      for (const id of HELP_IDS) {
        const el = doc.getElementById(id);
        expect(el, id).not.toBeNull();
        expect((el as MiniNode).className).toContain("form-help");
        expect((el as MiniNode).textContent.trim().length).toBeGreaterThan(10);
      }
    }
    expect(pageFormPage(null)).toContain("Not used by the homepage sites yet.");
  });

  it("the five setup slugs on a site are marked; global, new and other pages are not", () => {
    expect([...SETUP_PAGE_SLUGS].sort()).toEqual(["about", "contact", "do-not-sell", "privacy-policy", "terms"]);
    for (const slug of SETUP_PAGE_SLUGS) expect(isSetupPage("site-pt", slug)).toBe(true);
    expect(isSetupPage(null, "terms")).toBe(false);
    expect(isSetupPage("", "about")).toBe(false);
    expect(isSetupPage("site-pt", "x15-check")).toBe(false);

    const setup = pageFormPage({ id: "64", title: "Terms of Use", slug: "terms", site_id: "site-pt" }, [{ id: "site-pt", name: "Playtrail" }]);
    expect(setup).toContain('data-setup-page="1"');
    const modal = miniDocument(setup).getElementById("setup-page-modal") as MiniNode;
    expect(modal.textContent).toContain("Terms of Use");
    expect(modal.textContent).toContain("Playtrail");
    expect(pageFormPage({ id: "90", title: "X", slug: "x15-check", site_id: "site-pt" })).not.toContain('id="setup-page-modal"');
    expect(pageFormPage({ id: "7", title: "T", slug: "terms", site_id: null })).not.toContain('id="setup-page-modal"');
    expect(pageFormPage(null)).not.toContain('id="setup-page-modal"');
  });

  it("page and site names in the warning are escaped", () => {
    const html = pageFormPage({ id: "64", title: "<img src=x onerror=alert(1)>", slug: "about", site_id: "s" }, [{ id: "s", name: "<b>x</b>" }]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });
});

// ---------------------------------------------------------------- form script
class FakeFormData {
  private readonly values = new Map<string, string>();
  constructor(form: MiniNode) {
    for (const el of form.querySelectorAll("input, select, textarea")) {
      const name = el.getAttribute("name");
      if (!name) continue;
      if (el.getAttribute("type") === "checkbox" && !el.checked) continue;
      this.values.set(name, el.value);
    }
  }
  get(name: string): string | null { return this.values.has(name) ? (this.values.get(name) as string) : null; }
}

function bootForm(page: Parameters<typeof pageFormPage>[0]) {
  const doc = miniDocument(pageFormPage(page, [{ id: "site-pt", name: "Playtrail" }]));
  const fetches: Array<{ url: string; method: string; body: Record<string, unknown> }> = [];
  const fetchStub = vi.fn((url: string, init: RequestInit) => {
    fetches.push({ url, method: String(init.method), body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ item: {} }) });
  });
  const windowObj = { location: { href: "" } };
  runInNewContext(PAGE_FORM_SCRIPT, { window: windowObj, document: doc, fetch: fetchStub, FormData: FakeFormData, Object });
  const form = doc.getElementById("page-form") as MiniNode;
  const modal = doc.getElementById("setup-page-modal");
  const submit = (): void => { form.fire("submit"); };
  const open = (): boolean => modal !== null && modal.getAttribute("aria-hidden") === "false";
  return { doc, fetches, submit, open, modal };
}

describe("X15 warning appears right before every save of a setup page (owner D1)", () => {
  const SETUP = { id: "64", title: "Terms of Use", slug: "terms", site_id: "site-pt", page_type: "terms", status: "published", content_json: EDITOR_DOC };

  it("Save opens the warning and sends nothing; Keep editing / Escape / overlay save nothing", () => {
    const f = bootForm(SETUP);
    f.submit();
    expect(f.open()).toBe(true);
    expect(f.fetches).toHaveLength(0);
    (f.doc.getElementById("setup-page-cancel") as MiniNode).click();
    expect(f.open()).toBe(false);
    f.submit();
    expect(f.open()).toBe(true);
    f.doc.root.fire("keydown", { key: "Escape" });
    expect(f.open()).toBe(false);
    f.submit();
    (f.modal as MiniNode).fire("click");
    expect(f.open()).toBe(false);
    expect(f.fetches).toHaveLength(0);
  });

  it("Save to live site sends exactly one PATCH; the next Save asks again", () => {
    const f = bootForm(SETUP);
    f.submit();
    (f.doc.getElementById("setup-page-confirm") as MiniNode).click();
    expect(f.open()).toBe(false);
    expect(f.fetches).toHaveLength(1);
    expect(f.fetches[0]?.method).toBe("PATCH");
    expect(f.fetches[0]?.url).toBe("/api/admin/pages/64");
    expect(f.fetches[0]?.body.content_json).toBe(EDITOR_DOC);
    f.submit();
    expect(f.open()).toBe(true);
    expect(f.fetches).toHaveLength(1);
  });

  it("a Page the setup did not create saves straight away, with no warning", () => {
    const f = bootForm({ ...SETUP, id: "90", slug: "x15-check", page_type: "generic" });
    expect(f.modal).toBeNull();
    f.submit();
    expect(f.fetches).toHaveLength(1);
  });
});

describe("X15 D2: SEO fields reach the live page", () => {
  function fakeDb(): D1Database {
    return {
      prepare() {
        const stmt = {
          bind() { return stmt; },
          async first() { return null; },
          async all() { return { results: [], success: true, meta: {} }; },
          async run() { return { success: true, meta: {} }; },
        };
        return stmt;
      },
    } as unknown as D1Database;
  }
  const ctx = { siteId: "site-pt", hostname: "playtrail.net" } as Parameters<typeof renderPageHtml>[1];
  const base: PublicPageRow = { id: 1, slug: "x15-check", title: "X15 check", content_html: "<p>hi</p>", status: "published", updated_at: null, site_id: "site-pt" };

  it("uses seo_title and seo_description when filled", async () => {
    const html = await renderPageHtml(fakeDb(), ctx, { ...base, seo_title: "SEO Title X15", seo_description: "SEO desc X15" }, "/page/x15-check");
    expect(html).toMatch(/<title>[^<]*SEO Title X15/);
    expect(html).toContain('content="SEO desc X15"');
  });

  it("falls back to the page title when empty", async () => {
    const html = await renderPageHtml(fakeDb(), ctx, { ...base, seo_title: "  ", seo_description: null }, "/page/x15-check");
    expect(html).toMatch(/<title>[^<]*X15 check/);
    expect(html).not.toContain("SEO Title X15");
  });
});
