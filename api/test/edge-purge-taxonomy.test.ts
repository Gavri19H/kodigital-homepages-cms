import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import { onPublicChange } from "../src/edge/public-change";
import type { Env } from "../src/env";
import { fetchSiteVerticalName } from "../src/public/queries";
import { addSite, createDb, env, hasSqlite, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("../src/edge/public-change", () => ({ onPublicChange: vi.fn() }));

const owner = "Site-A";
const other = "Site-B";
const allSites = ["site:site-a", "site:site-b"];
const pageAndOwner = ["slug:site-a:guide", "site:site-a"];
const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {}, exports: {} };

describe.skipIf(!hasSqlite)("public cache scope of admin page and taxonomy writes", () => {
  let db: SqliteDb;
  let bindings: Env;

  beforeEach(() => {
    db = createDb();
    addSite(db, owner, "A", "home");
    addSite(db, other, "B", "finance");
    db.prepare("UPDATE sites SET status = 'disabled' WHERE id = ?").run(other);
    bindings = env(db);
    vi.mocked(onPublicChange).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => db.close());

  function write(method: string, path: string, body?: unknown) {
    return admin.request("/api/admin/" + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, bindings, ctx);
  }

  function expectChange(siteId: string | null, tags: string[], reason: string) {
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(bindings, ctx, { siteId, tags, reason });
  }

  // Observe the committed row inside the hook so a purge issued before the write also fails.
  function expectRowAtPurge(sql: string, key: string | number, expected: unknown) {
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(db.prepare(sql).get(key)).toEqual(expected);
    });
  }

  function seedPage(siteId: string | null, status = "published"): number {
    const row = db.prepare(
      "INSERT INTO pages (site_id, slug, title, content_json, status, page_type) VALUES (?, 'guide', 'Guide', '{}', ?, 'legal')",
    ).run(siteId, status);
    return Number(row.lastInsertRowid);
  }

  function seedCategory(): number {
    const { lastInsertRowid } = db.prepare("INSERT INTO categories (name, slug) VALUES (?, ?)")
      .run("Guides", "purge-guides");
    const id = Number(lastInsertRowid);
    db.prepare("INSERT INTO site_categories (site_id, category_id) VALUES (?, ?)").run(owner, id);
    return id;
  }

  it("creating a site-owned page purges the new slug and its owner's page links", async () => {
    expectRowAtPurge("SELECT site_id FROM pages WHERE slug = ?", "guide", { site_id: owner });
    expect((await write("POST", "pages", { site_id: owner, title: "Guide" })).status).toBe(201);
    expectChange(owner, pageAndOwner, "page.create");
  });

  it("a committed page still purges the owner if its legacy KV wipe fails", async () => {
    vi.spyOn(bindings.CACHE, "list").mockRejectedValueOnce(new Error("KV unavailable"));
    expectRowAtPurge("SELECT site_id FROM pages WHERE slug = ?", "guide", { site_id: owner });
    expect((await write("POST", "pages", { site_id: owner, title: "Guide" })).status).toBe(500);
    expectChange(owner, pageAndOwner, "page.create");
  });

  it("saving published copy with unchanged link fields purges the owner's slug and sitemap listing", async () => {
    const id = seedPage(owner);
    expectRowAtPurge("SELECT content_html FROM pages WHERE id = ?", id, { content_html: "Revised" });
    const res = await write("PATCH", "pages/" + id, {
      site_id: owner, slug: "guide", title: "Guide", status: "published", page_type: "legal",
      template: "default", show_in_footer: false, display_order: 0, content_html: "Revised",
    });
    expect(res.status).toBe(200);
    expectChange(owner, ["slug:site-a:guide", "listing:site-a"], "page.update");
  });

  it("editing draft page copy without a request context passes only the owner's slug for queued purge", async () => {
    const id = seedPage(owner, "draft");
    const res = await admin.request("/api/admin/pages/" + id, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ seo_title: "Guide SEO" }),
    }, bindings);
    expect(res.status).toBe(200);
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(bindings, undefined, {
      siteId: owner, tags: ["slug:site-a:guide"], reason: "page.update",
    });
  });

  it("renaming a site-owned page purges both slugs and the owner's page links once", async () => {
    const id = seedPage(owner);
    expect((await write("PATCH", "pages/" + id, { slug: "new-guide" })).status).toBe(200);
    expectChange(owner, ["slug:site-a:guide", "slug:site-a:new-guide", "site:site-a"], "page.update");
  });

  it.each([
    { title: "New label" }, { status: "archived" }, { show_in_footer: true },
    { display_order: 3 }, { page_type: "terms" },
  ])("changing page link metadata %o purges the slug and its owner site", async (body) => {
    const id = seedPage(owner);
    expect((await write("PATCH", "pages/" + id, body)).status).toBe(200);
    expectChange(owner, pageAndOwner, "page.update");
  });

  it("deleting a site-owned page purges the deleted slug and its owner site", async () => {
    const id = seedPage(owner);
    expectRowAtPurge("SELECT id FROM pages WHERE id = ?", id, undefined);
    expect((await write("DELETE", "pages/" + id)).status).toBe(200);
    expectChange(owner, pageAndOwner, "page.delete");
  });

  it("creating a global legal page purges every site in one call", async () => {
    expect((await write("POST", "pages", { title: "Guide", page_type: "legal", status: "published" })).status).toBe(201);
    expectChange(null, allSites, "page.create");
  });

  it("editing a global legal page purges every site in one call", async () => {
    const id = seedPage(null);
    expect((await write("PATCH", "pages/" + id, { content_html: "New terms" })).status).toBe(200);
    expectChange(null, allSites, "page.update");
  });

  it("adopting a global legal page purges every former reader and bumps the new owner's legacy version", async () => {
    const id = seedPage(null);
    expect((await write("PATCH", "pages/" + id, { site_id: owner, slug: "our-guide" })).status).toBe(200);
    expectChange(null, allSites, "page.update");
    expect(db.prepare("SELECT id, content_version FROM sites ORDER BY id").all()).toEqual([
      { id: owner, content_version: 2 }, { id: other, content_version: 1 },
    ]);
  });

  it("deleting a global legal page purges every site in one call", async () => {
    const id = seedPage(null);
    expectRowAtPurge("SELECT id FROM pages WHERE id = ?", id, undefined);
    expect((await write("DELETE", "pages/" + id)).status).toBe(200);
    expectChange(null, allSites, "page.delete");
  });

  it("updating an allocated category purges every site, including more than 100 tags in one change", async () => {
    const id = seedCategory();
    const extra = Array.from({ length: 101 }, (_, i) => "tenant-" + String(i).padStart(3, "0"));
    for (const site of extra) addSite(db, site, site, "home");
    expectRowAtPurge("SELECT name FROM categories WHERE id = ?", id, { name: "New name" });
    expect((await write("PUT", "categories/" + id, { site_id: owner, name: "New name" })).status).toBe(200);
    expectChange(null, [...allSites, ...extra.map(site => "site:" + site)], "category.update");
  });

  it("deleting a category through its allocation purges every tenant after the batch", async () => {
    const id = seedCategory();
    expectRowAtPurge("SELECT id FROM categories WHERE id = ?", id, undefined);
    expect((await write("DELETE", "categories/" + id + "?site_id=" + owner)).status).toBe(200);
    expectChange(null, allSites, "category.delete");
  });

  it.each([
    { scope: "only the owner site", siteId: owner, tags: ["site:site-a"] },
    { scope: "every site for a global tag", siteId: null, tags: allSites },
  ])("creating a tag purges $scope", async ({ siteId, tags }) => {
    expectRowAtPurge("SELECT site_id FROM tags WHERE slug = ?", "gardens", { site_id: siteId });
    expect((await write("POST", "tags", { site_id: siteId, name: "Gardens" })).status).toBe(201);
    expectChange(siteId, tags, "tag.create");
  });

  it.each([
    { scope: "only its stored owner", siteId: owner, tags: ["site:site-a"], query: "" },
    { scope: "every site for a global tag despite the request site", siteId: null, tags: allSites, query: "?site_id=" + owner },
  ])("deleting a tag purges $scope", async ({ siteId, tags, query }) => {
    const { lastInsertRowid } = db.prepare("INSERT INTO tags (slug, name, site_id) VALUES (?, ?, ?)")
      .run("gardens", "Gardens", siteId);
    const id = Number(lastInsertRowid);
    expectRowAtPurge("SELECT id FROM tags WHERE id = ?", id, undefined);
    expect((await write("DELETE", "tags/" + id + query)).status).toBe(200);
    expectChange(siteId, tags, "tag.delete");
  });

  it("a rejected page write and a rolled-back taxonomy delete purge no tenant", async () => {
    const page = seedPage(owner);
    expect((await write("PATCH", "pages/" + page, { site_id: other, title: "Moved" })).status).toBe(403);
    const id = seedCategory();
    db.prepare("CREATE TRIGGER refuse_delete BEFORE DELETE ON categories BEGIN SELECT RAISE(ABORT, 'refused'); END").run();
    expect((await write("DELETE", "categories/" + id)).status).toBe(500);
    expect(db.prepare("SELECT site_id FROM site_categories WHERE category_id = ?").get(id)).toEqual({ site_id: owner });
    expect(onPublicChange).not.toHaveBeenCalled();
  });

  it("vertical creation, audience edits, article reassignment and unused vertical deletion affect no tenant cache", async () => {
    const home = db.prepare("SELECT id FROM verticals WHERE slug = ?").get("home") as { id: number };
    expect((await write("POST", "verticals", { name: "Garden", slug: "garden" })).status).toBe(201);
    const garden = db.prepare("SELECT id FROM verticals WHERE slug = ?").get("garden") as { id: number };
    expect((await write("PATCH", "verticals/" + home.id, { audience: "Gardeners" })).status).toBe(200);
    expect(await fetchSiteVerticalName(bindings.DB, owner)).toBe("Home");
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO articles (site_id, slug, title, status, content_json, updated_at) VALUES (?, 'roses', 'Roses', 'published', '{}', 123)",
    ).run(owner);
    const id = Number(lastInsertRowid);
    expect((await write("POST", "articles/bulk-vertical", { article_ids: [id], vertical_id: home.id })).status).toBe(200);
    expect(db.prepare("SELECT vertical_id, updated_at FROM articles WHERE id = ?").get(id)).toEqual({
      vertical_id: home.id, updated_at: 123,
    });
    expect((await write("DELETE", "verticals/" + garden.id)).status).toBe(200);
    expect(onPublicChange).not.toHaveBeenCalled();
  });
});
