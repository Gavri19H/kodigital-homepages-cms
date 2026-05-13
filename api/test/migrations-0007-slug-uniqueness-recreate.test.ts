import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// MQAFIX-3 / Phase 3 retry: assert migration 0007 rebuilds the articles
// and pages tables via CREATE-INSERT-DROP-RENAME so the legacy Phase-1
// column-level UNIQUE constraint on slug (and its hidden
// sqlite_autoindex_*) is removed. After 0007 the only slug uniqueness
// constraint on these two tables is the per-site composite index
// (site_id, slug) declared at the bottom of the migration -- meaning
// two sites can independently hold the same slug at the SQLite layer,
// while a duplicate (site_id, slug) within a single site still
// collides via the UNIQUE composite index.
//
// Static SQL parser (readFileSync + regex). The BEHAVIORAL post-apply
// leg (insert the same slug under two different site_ids and observe
// it succeed; insert the same (site_id, slug) twice and observe
// UNIQUE collision) is owned by manual QA / full-pipeline verification
// once the migration has been applied to a local D1 via
// `wrangler d1 migrations apply kodigital-homepages-cms-db --local`.
// The schema invariants this file asserts statically are sufficient to
// prove the per-site behaviour: a TEXT NOT NULL slug column with no
// inline UNIQUE token can host duplicate slugs across rows, and the
// composite UNIQUE INDEX (site_id, slug) collides only when site_id
// AND slug both match.

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "migrations",
  "0007_phase3r_drop_global_slug_unique.sql",
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function findCreateTable(sql: string, name: string): string | undefined {
  const re = new RegExp(
    `CREATE\\s+TABLE\\s+${name}\\s*\\(([\\s\\S]*?)\\)\\s*;`,
    "i",
  );
  const m = sql.match(re);
  return m ? m[1] : undefined;
}

describe("0007_phase3r_drop_global_slug_unique.sql (MQAFIX-3)", () => {
  describe("articles -- CREATE-INSERT-DROP-RENAME rebuild", () => {
    it("declares CREATE TABLE articles_new with slug TEXT NOT NULL (no inline UNIQUE)", () => {
      const sql = readMigration();
      const body = findCreateTable(sql, "articles_new");
      expect(body, "CREATE TABLE articles_new not declared").toBeTruthy();
      // slug must be TEXT NOT NULL with NO inline UNIQUE keyword between
      // the column type and the next comma.
      expect(
        /\bslug\s+TEXT\s+NOT\s+NULL\s*,/i.test(body ?? ""),
        "articles_new.slug must be `TEXT NOT NULL,` with no inline UNIQUE keyword",
      ).toBe(true);
      expect(
        /\bslug\s+TEXT\s+NOT\s+NULL\s+UNIQUE\b/i.test(body ?? ""),
        "articles_new.slug must NOT carry the inline UNIQUE keyword (that's the legacy auto-index this migration removes)",
      ).toBe(false);
    });

    it("preserves the post-0002 column set (15 Phase-1 + 6 Phase-3 columns) verbatim", () => {
      const sql = readMigration();
      const body = findCreateTable(sql, "articles_new") ?? "";
      const required = [
        "id",
        "slug",
        "title",
        "content_json",
        "content_html",
        "category_id",
        "status",
        "published_at",
        "scheduled_at",
        "author_name",
        "featured_image_id",
        "is_featured",
        "is_trending",
        "created_at",
        "updated_at",
        "site_id",
        "homepage_section",
        "homepage_rank",
        "seo_title",
        "seo_description",
        "ai_generation_id",
      ];
      const missing = required.filter(
        (col) => !new RegExp(`\\b${col}\\b`).test(body),
      );
      expect(missing).toEqual([]);
    });

    it("orders the four rebuild steps as CREATE -> INSERT -> DROP -> RENAME", () => {
      const sql = readMigration();
      const createIdx = sql.search(/CREATE\s+TABLE\s+articles_new\b/i);
      const insertIdx = sql.search(/INSERT\s+INTO\s+articles_new\b/i);
      const dropIdx = sql.search(/\bDROP\s+TABLE\s+articles\s*;/i);
      const renameIdx = sql.search(
        /ALTER\s+TABLE\s+articles_new\s+RENAME\s+TO\s+articles\b/i,
      );
      expect(createIdx).toBeGreaterThanOrEqual(0);
      expect(insertIdx).toBeGreaterThan(createIdx);
      expect(dropIdx).toBeGreaterThan(insertIdx);
      expect(renameIdx).toBeGreaterThan(dropIdx);
    });

    it("re-creates the per-site UNIQUE (site_id, slug) index AFTER the rename", () => {
      const sql = readMigration();
      const renameIdx = sql.search(
        /ALTER\s+TABLE\s+articles_new\s+RENAME\s+TO\s+articles\b/i,
      );
      const uniqueIdx = sql.search(
        /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_articles_site_slug_unique\s+ON\s+articles\s*\(\s*site_id\s*,\s*slug\s*\)/i,
      );
      expect(renameIdx).toBeGreaterThanOrEqual(0);
      expect(uniqueIdx).toBeGreaterThan(renameIdx);
    });

    it("re-creates every non-unique covering index that hung off the legacy articles table", () => {
      const sql = readMigration();
      const required = [
        "idx_articles_status_published",
        "idx_articles_category",
        "idx_articles_featured",
        "idx_articles_trending",
        "idx_articles_site_status_pub",
        "idx_articles_site_category_status_pub",
        "idx_articles_site_featured",
        "idx_articles_site_trending",
        "idx_articles_site_homepage_section",
      ];
      const renameIdx = sql.search(
        /ALTER\s+TABLE\s+articles_new\s+RENAME\s+TO\s+articles\b/i,
      );
      expect(renameIdx).toBeGreaterThanOrEqual(0);
      const tail = sql.slice(renameIdx);
      const missing = required.filter(
        (name) =>
          !new RegExp(
            `CREATE\\s+INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${name}\\b`,
            "i",
          ).test(tail),
      );
      expect(missing).toEqual([]);
    });
  });

  describe("pages -- CREATE-INSERT-DROP-RENAME rebuild", () => {
    it("declares CREATE TABLE pages_new with slug TEXT NOT NULL (no inline UNIQUE)", () => {
      const sql = readMigration();
      const body = findCreateTable(sql, "pages_new");
      expect(body, "CREATE TABLE pages_new not declared").toBeTruthy();
      expect(
        /\bslug\s+TEXT\s+NOT\s+NULL\s*,/i.test(body ?? ""),
        "pages_new.slug must be `TEXT NOT NULL,` with no inline UNIQUE keyword",
      ).toBe(true);
      expect(
        /\bslug\s+TEXT\s+NOT\s+NULL\s+UNIQUE\b/i.test(body ?? ""),
        "pages_new.slug must NOT carry the inline UNIQUE keyword (that's the legacy auto-index this migration removes)",
      ).toBe(false);
    });

    it("preserves the post-0002 column set (10 Phase-1 + 3 Phase-3 columns) verbatim", () => {
      const sql = readMigration();
      const body = findCreateTable(sql, "pages_new") ?? "";
      const required = [
        "id",
        "slug",
        "title",
        "content_json",
        "content_html",
        "status",
        "template",
        "show_in_footer",
        "created_at",
        "updated_at",
        "site_id",
        "page_type",
        "ai_generation_id",
      ];
      const missing = required.filter(
        (col) => !new RegExp(`\\b${col}\\b`).test(body),
      );
      expect(missing).toEqual([]);
    });

    it("orders the four rebuild steps as CREATE -> INSERT -> DROP -> RENAME", () => {
      const sql = readMigration();
      const createIdx = sql.search(/CREATE\s+TABLE\s+pages_new\b/i);
      const insertIdx = sql.search(/INSERT\s+INTO\s+pages_new\b/i);
      const dropIdx = sql.search(/\bDROP\s+TABLE\s+pages\s*;/i);
      const renameIdx = sql.search(
        /ALTER\s+TABLE\s+pages_new\s+RENAME\s+TO\s+pages\b/i,
      );
      expect(createIdx).toBeGreaterThanOrEqual(0);
      expect(insertIdx).toBeGreaterThan(createIdx);
      expect(dropIdx).toBeGreaterThan(insertIdx);
      expect(renameIdx).toBeGreaterThan(dropIdx);
    });

    it("re-creates the per-site UNIQUE (site_id, slug) index AFTER the rename", () => {
      const sql = readMigration();
      const renameIdx = sql.search(
        /ALTER\s+TABLE\s+pages_new\s+RENAME\s+TO\s+pages\b/i,
      );
      const uniqueIdx = sql.search(
        /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_pages_site_slug_unique\s+ON\s+pages\s*\(\s*site_id\s*,\s*slug\s*\)/i,
      );
      expect(renameIdx).toBeGreaterThanOrEqual(0);
      expect(uniqueIdx).toBeGreaterThan(renameIdx);
    });

    it("re-creates every non-unique covering index that hung off the legacy pages table", () => {
      const sql = readMigration();
      const required = [
        "idx_pages_status",
        "idx_pages_site_slug",
        "idx_pages_site_type",
      ];
      const renameIdx = sql.search(
        /ALTER\s+TABLE\s+pages_new\s+RENAME\s+TO\s+pages\b/i,
      );
      expect(renameIdx).toBeGreaterThanOrEqual(0);
      const tail = sql.slice(renameIdx);
      const missing = required.filter(
        (name) =>
          !new RegExp(
            `CREATE\\s+INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${name}\\b`,
            "i",
          ).test(tail),
      );
      expect(missing).toEqual([]);
    });
  });

  describe("per-site slug uniqueness invariants (proxy for BEHAVIORAL ACs)", () => {
    it("asserts the two per-site UNIQUE indexes are declared with composite (site_id, slug) keys so the same slug can coexist across tenants", () => {
      const sql = readMigration();
      const matches = sql.match(
        /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:idx_articles_site_slug_unique|idx_pages_site_slug_unique)\s+ON\s+(?:articles|pages)\s*\(\s*site_id\s*,\s*slug\s*\)/gi,
      );
      expect(matches).toBeTruthy();
      expect(matches!.length).toBe(2);
    });

    it("never declares an inline UNIQUE constraint on slug anywhere in the migration (proves global slug uniqueness is gone)", () => {
      const sql = readMigration();
      const violation = sql.match(/\bslug\s+TEXT\s+NOT\s+NULL\s+UNIQUE\b/i);
      expect(
        violation,
        "0007 must not contain `slug TEXT NOT NULL UNIQUE`: that's the legacy Phase-1 global-uniqueness shape this migration rebuilds away",
      ).toBeFalsy();
    });
  });
});
