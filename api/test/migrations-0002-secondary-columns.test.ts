import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// T4 / Phase 3: assert the 6 site-scope (+page_type / ai_generation_id)
// columns declared by the T4 ALTER block of 0002 are present in the
// migration SQL. Parse the SQL statically (readFileSync + regex)
// instead of round-tripping through `wrangler d1` so the check stays
// deterministic and runs without a local D1 binding — the BEHAVIORAL
// post-migration PRAGMA table_info(...) check on pages/media/tags/
// redirects is owned by T33's full-pipeline verification once 0003/
// 0004 are also in place.

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "migrations",
  "0002_phase3_multi_site_schema.sql",
);

interface ExpectedColumn {
  table: "pages" | "media" | "tags" | "redirects";
  column: string;
}

const REQUIRED_COLUMNS: readonly ExpectedColumn[] = [
  { table: "pages", column: "site_id" },
  { table: "pages", column: "page_type" },
  { table: "pages", column: "ai_generation_id" },
  { table: "media", column: "site_id" },
  { table: "tags", column: "site_id" },
  { table: "redirects", column: "site_id" },
];

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function findAlterAddColumn(
  sql: string,
  table: string,
  column: string,
): string | undefined {
  const re = new RegExp(
    `^ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+${column}\\b[^;]*;`,
    "im",
  );
  const m = sql.match(re);
  return m ? m[0] : undefined;
}

describe("0002_phase3_multi_site_schema.sql — secondary tables columns (T4)", () => {
  it("declares all 6 required Phase 3 ALTER TABLE statements on pages/media/tags/redirects", () => {
    const sql = readMigration();
    const missing = REQUIRED_COLUMNS.filter(
      ({ table, column }) => findAlterAddColumn(sql, table, column) === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("pages.page_type is declared with DEFAULT 'generic' so existing rows land in the safe bucket", () => {
    const sql = readMigration();
    const stmt = findAlterAddColumn(sql, "pages", "page_type");
    expect(stmt).toBeTruthy();
    expect(stmt!).toMatch(/DEFAULT\s+'generic'/i);
  });

  it("pages.site_id, media.site_id, tags.site_id, and redirects.site_id each REFERENCE sites(id)", () => {
    const sql = readMigration();
    for (const table of ["pages", "media", "tags", "redirects"] as const) {
      const stmt = findAlterAddColumn(sql, table, "site_id");
      expect(stmt, `${table}.site_id ALTER missing`).toBeTruthy();
      expect(stmt!).toMatch(/REFERENCES\s+sites\s*\(\s*id\s*\)/i);
    }
  });

  it("pages.ai_generation_id REFERENCES ai_generations(id) so AI-rendered legal/about pages trace back to a receipt", () => {
    const sql = readMigration();
    const stmt = findAlterAddColumn(sql, "pages", "ai_generation_id");
    expect(stmt).toBeTruthy();
    expect(stmt!).toMatch(/REFERENCES\s+ai_generations\s*\(\s*id\s*\)/i);
  });

  it("places the T4 ALTER block before the CREATE INDEX block so idx_pages_site_type / idx_media_site / idx_tags_site_slug reference existing columns", () => {
    const sql = readMigration();
    const pagesSiteIdx = sql.search(
      /ALTER\s+TABLE\s+pages\s+ADD\s+COLUMN\s+site_id\b/i,
    );
    const mediaSiteIdx = sql.search(
      /ALTER\s+TABLE\s+media\s+ADD\s+COLUMN\s+site_id\b/i,
    );
    const tagsSiteIdx = sql.search(
      /ALTER\s+TABLE\s+tags\s+ADD\s+COLUMN\s+site_id\b/i,
    );
    const idxPagesType = sql.search(
      /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_pages_site_type\b/i,
    );
    const idxMediaSite = sql.search(
      /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_media_site\b/i,
    );
    const idxTagsSiteSlug = sql.search(
      /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_tags_site_slug\b/i,
    );
    expect(pagesSiteIdx).toBeGreaterThanOrEqual(0);
    expect(mediaSiteIdx).toBeGreaterThanOrEqual(0);
    expect(tagsSiteIdx).toBeGreaterThanOrEqual(0);
    expect(idxPagesType).toBeGreaterThanOrEqual(0);
    expect(idxMediaSite).toBeGreaterThanOrEqual(0);
    expect(idxTagsSiteSlug).toBeGreaterThanOrEqual(0);
    expect(pagesSiteIdx).toBeLessThan(idxPagesType);
    expect(mediaSiteIdx).toBeLessThan(idxMediaSite);
    expect(tagsSiteIdx).toBeLessThan(idxTagsSiteSlug);
  });
});
