// X01 Part B — the Categories delete guard and the "Articles" column count
// the Articles that really use a Category.
//
// Before this fix both read categories.article_count, a stored column that
// no code path ever updates (it stays at its default 0). So "Delete" on a
// Category that still had Articles skipped the guard, hit the database's
// foreign-key refusal, and the admin showed only "Failed to delete
// category". This happened live on 22 Nov 2026 with the test Category
// "general-1779130910" (14 Articles, article_count 0).
//
// Runs against a real in-memory SQLite (node:sqlite) with foreign keys on,
// so the stored column is genuinely 0 while one Article uses the Category.
// Skipped where node:sqlite is unavailable.

import { describe, it, expect } from "vitest";
import admin from "../src/admin/router";
import * as data from "../src/admin/data";
import { buildEnv } from "./helpers/admin-test-kit";
import {
  loadDatabaseSync,
  d1FromSqlite,
  type SqliteDb,
} from "./helpers/leadgen-analytics-harness";

const DatabaseSync = loadDatabaseSync();

// The columns the Categories handlers read, copied from 0001/0002/0007.
const SCHEMA = `
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  parent_id INTEGER REFERENCES categories(id),
  featured_image_id INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  article_count INTEGER NOT NULL DEFAULT 0,
  show_on_homepage INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE verticals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE category_verticals (
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  vertical_id INTEGER NOT NULL REFERENCES verticals(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (category_id, vertical_id)
);
CREATE TABLE site_categories (
  site_id TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  display_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, category_id)
);
CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id)
);
INSERT INTO verticals (slug, name, display_order) VALUES ('finance', 'Finance', 2);
INSERT INTO categories (slug, name) VALUES ('test-cat', 'Test Category');
INSERT INTO category_verticals (category_id, vertical_id) VALUES (1, 1);
INSERT INTO site_categories (site_id, category_id) VALUES ('st_a', 1);
`;

function makeDb(): SqliteDb {
  const Ctor = DatabaseSync as unknown as new (path: string) => SqliteDb;
  const sdb = new Ctor(":memory:");
  (sdb["exec"] as (s: string) => void)("PRAGMA foreign_keys = ON;" + SCHEMA);
  return sdb;
}

function count(sdb: SqliteDb, sql: string): number {
  return Number((sdb.prepare(sql).get() as { n: number }).n);
}

describe.skipIf(DatabaseSync === null)("X01 Part B: Categories count real Articles", () => {
  it("refuses to delete a Category one Article uses, even though the stored article_count is 0", async () => {
    const sdb = makeDb();
    (sdb["exec"] as (s: string) => void)(
      "INSERT INTO articles (site_id, slug, title, category_id) VALUES ('st_a', 'a-1', 'Article one', 1);",
    );
    expect(count(sdb, "SELECT article_count AS n FROM categories WHERE id = 1")).toBe(0);

    const res = await admin.request(
      "/api/admin/categories/1",
      { method: "DELETE" },
      buildEnv(d1FromSqlite(sdb)),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; article_count?: number };
    expect(body.code).toBe("CATEGORY_HAS_ARTICLES");
    expect(body.error).toBe("Cannot delete category with articles. Move or delete articles first.");
    expect(body.article_count).toBe(1);

    // Nothing was removed.
    expect(count(sdb, "SELECT COUNT(*) AS n FROM categories")).toBe(1);
    expect(count(sdb, "SELECT COUNT(*) AS n FROM category_verticals")).toBe(1);
    expect(count(sdb, "SELECT COUNT(*) AS n FROM site_categories")).toBe(1);
    expect(count(sdb, "SELECT COUNT(*) AS n FROM articles WHERE category_id = 1")).toBe(1);
  });

  it("deletes the Category and its links once no Article uses it", async () => {
    const sdb = makeDb();
    const res = await admin.request(
      "/api/admin/categories/1",
      { method: "DELETE" },
      buildEnv(d1FromSqlite(sdb)),
    );
    expect(res.status).toBe(200);
    expect(count(sdb, "SELECT COUNT(*) AS n FROM categories")).toBe(0);
    expect(count(sdb, "SELECT COUNT(*) AS n FROM category_verticals")).toBe(0);
    expect(count(sdb, "SELECT COUNT(*) AS n FROM site_categories")).toBe(0);
  });

  it("the Categories API and a saved Category report the real Article count", async () => {
    const sdb = makeDb();
    (sdb["exec"] as (s: string) => void)(
      "INSERT INTO articles (site_id, slug, title, category_id) VALUES ('st_a', 'a-1', 'One', 1), ('st_a', 'a-2', 'Two', 1);",
    );
    const env = buildEnv(d1FromSqlite(sdb));

    const list = await admin.request("/api/admin/categories", { method: "GET" }, env);
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { categories: Array<{ id: number; article_count: number }> };
    expect(listed.categories.find((c) => c.id === 1)?.article_count).toBe(2);

    const put = await admin.request(
      "/api/admin/categories/1",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Test Category 2" }),
      },
      env,
    );
    expect(put.status).toBe(200);
    const saved = (await put.json()) as { item: { article_count: number } | null };
    expect(saved.item?.article_count).toBe(2);
  });

  it("the Categories screen's \"Articles\" column shows the real count (plain and filtered lists)", async () => {
    const sdb = makeDb();
    (sdb["exec"] as (s: string) => void)(
      "INSERT INTO articles (site_id, slug, title, category_id) VALUES ('st_a', 'a-1', 'One', 1), ('st_a', 'a-2', 'Two', 1), ('st_a', 'a-3', 'Three', 1);",
    );
    const env = buildEnv(d1FromSqlite(sdb));

    const plain = await data.listAdminCategories(env);
    expect(plain.find((c) => c.id === "1")?.article_count).toBe(3);

    const filtered = await data.listAdminCategoriesFiltered(env, { search: "Test" });
    expect(filtered.rows.find((c) => c.id === "1")?.article_count).toBe(3);
  });
});
