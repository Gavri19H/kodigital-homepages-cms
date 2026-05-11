import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// T3 / Phase 3: assert the 6 articles columns declared by the T3 ALTER
// block of 0002 are present in the migration SQL. Parse the SQL
// statically (readFileSync + regex) instead of round-tripping through
// `wrangler d1` so the check stays deterministic and runs without a
// local D1 binding — the BEHAVIORAL post-migration PRAGMA
// table_info(articles) check is owned by T33's full-pipeline
// verification once 0003/0004 are also in place.

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "migrations",
  "0002_phase3_multi_site_schema.sql",
);

const REQUIRED_COLUMNS = [
  "site_id",
  "homepage_section",
  "homepage_rank",
  "seo_title",
  "seo_description",
  "ai_generation_id",
] as const;

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function findAlterAddColumn(sql: string, column: string): string | undefined {
  const re = new RegExp(
    `^ALTER\\s+TABLE\\s+articles\\s+ADD\\s+COLUMN\\s+${column}\\b[^;]*;`,
    "im",
  );
  const m = sql.match(re);
  return m ? m[0] : undefined;
}

describe("0002_phase3_multi_site_schema.sql — articles columns (T3)", () => {
  it("declares all 6 required Phase 3 articles columns via ALTER TABLE", () => {
    const sql = readMigration();
    const missing = REQUIRED_COLUMNS.filter(
      (c) => findAlterAddColumn(sql, c) === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("homepage_section is declared with DEFAULT 'none'", () => {
    const sql = readMigration();
    const stmt = findAlterAddColumn(sql, "homepage_section");
    expect(stmt).toBeTruthy();
    expect(stmt!).toMatch(/DEFAULT\s+'none'/i);
  });

  it("site_id references sites(id) so cross-site tenant isolation has a FK target", () => {
    const sql = readMigration();
    const stmt = findAlterAddColumn(sql, "site_id");
    expect(stmt).toBeTruthy();
    expect(stmt!).toMatch(/REFERENCES\s+sites\s*\(\s*id\s*\)/i);
  });

  it("ai_generation_id references ai_generations(id) so stub-generated articles trace back to a receipt row", () => {
    const sql = readMigration();
    const stmt = findAlterAddColumn(sql, "ai_generation_id");
    expect(stmt).toBeTruthy();
    expect(stmt!).toMatch(/REFERENCES\s+ai_generations\s*\(\s*id\s*\)/i);
  });

  it("places the T3 ALTER block before the CREATE INDEX block so idx_articles_site_homepage_section references existing columns", () => {
    const sql = readMigration();
    const alterIdx = sql.search(
      /ALTER\s+TABLE\s+articles\s+ADD\s+COLUMN\s+site_id\b/i,
    );
    const indexIdx = sql.search(
      /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_articles_site_homepage_section\b/i,
    );
    expect(alterIdx).toBeGreaterThanOrEqual(0);
    expect(indexIdx).toBeGreaterThanOrEqual(0);
    expect(alterIdx).toBeLessThan(indexIdx);
  });
});
