import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// T5 / Phase 3: assert the two per-site UNIQUE indexes that replace the
// Phase-1 globally-unique slug design are declared in the migration SQL.
// Parse the SQL statically (readFileSync + regex) — the BEHAVIORAL
// post-apply check (two articles with same slug across sites succeed;
// same slug + same site_id collides) is deferred to T33's full-pipeline
// verification once 0003 (site_settings restructure) is also in place
// and `wrangler d1 migrations apply --local` can advance the ledger.

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "migrations",
  "0002_phase3_multi_site_schema.sql",
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("0002_phase3_multi_site_schema.sql — per-site slug uniqueness (T5)", () => {
  it("slug uniqueness is per site (articles and pages)", () => {
    const sql = readMigration();
    const articlesIdx = sql.match(
      /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_articles_site_slug_unique\s+ON\s+articles\s*\(\s*site_id\s*,\s*slug\s*\)\s*;/i,
    );
    const pagesIdx = sql.match(
      /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_pages_site_slug_unique\s+ON\s+pages\s*\(\s*site_id\s*,\s*slug\s*\)\s*;/i,
    );
    expect(articlesIdx, "idx_articles_site_slug_unique not declared").toBeTruthy();
    expect(pagesIdx, "idx_pages_site_slug_unique not declared").toBeTruthy();
  });

  it("places the T5 UNIQUE indexes after the T3/T4 ALTER blocks that add the site_id columns they reference", () => {
    const sql = readMigration();
    const articlesAlter = sql.search(
      /ALTER\s+TABLE\s+articles\s+ADD\s+COLUMN\s+site_id\b/i,
    );
    const pagesAlter = sql.search(
      /ALTER\s+TABLE\s+pages\s+ADD\s+COLUMN\s+site_id\b/i,
    );
    const articlesUnique = sql.search(
      /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_articles_site_slug_unique\b/i,
    );
    const pagesUnique = sql.search(
      /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_pages_site_slug_unique\b/i,
    );
    expect(articlesAlter).toBeGreaterThanOrEqual(0);
    expect(pagesAlter).toBeGreaterThanOrEqual(0);
    expect(articlesUnique).toBeGreaterThanOrEqual(0);
    expect(pagesUnique).toBeGreaterThanOrEqual(0);
    expect(articlesAlter).toBeLessThan(articlesUnique);
    expect(pagesAlter).toBeLessThan(pagesUnique);
  });

  it("declares both UNIQUE indexes with composite (site_id, slug) keys so the same slug can coexist across tenants", () => {
    const sql = readMigration();
    const matches = sql.match(
      /CREATE\s+UNIQUE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:idx_articles_site_slug_unique|idx_pages_site_slug_unique)\s+ON\s+(?:articles|pages)\s*\(\s*site_id\s*,\s*slug\s*\)/gi,
    );
    expect(matches).toBeTruthy();
    expect(matches!.length).toBe(2);
  });
});
