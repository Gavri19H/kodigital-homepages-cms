import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// T2 / Phase 3: assert the multi-site composite indexes are declared in the
// 0002 migration. We parse the SQL statically instead of round-tripping
// through wrangler d1 so the check stays deterministic and runs without a
// local D1 binding — the BEHAVIORAL post-migration sqlite_master check is
// owned by T33's verification pass once the full migration set (including
// T3/T4 column ALTERs and the T6 site_settings restructure) is in place.
//
// idx_settings_site_key is INTENTIONALLY excluded from 0002's required set:
// the site_settings table is restructured (CREATE-INSERT-DROP-RENAME) in 0003
// to add the site_id column, and idx_settings_site_key is created in 0003
// immediately after that rename. Declaring the index in 0002 raised
// "no such column: site_id at offset 69" on fresh D1 applies because
// site_settings still had the legacy (key, value) shape from 0001 at that
// point in the migration sequence. The 0003-owned index is covered by a
// separate suite (migrations-0003-idx-settings-site-key.test.ts).

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "migrations",
  "0002_phase3_multi_site_schema.sql",
);

const REQUIRED_INDEX_NAMES = [
  "idx_articles_site_status_pub",
  "idx_articles_site_category_status_pub",
  "idx_articles_site_featured",
  "idx_articles_site_trending",
  "idx_articles_site_homepage_section",
  "idx_pages_site_slug",
  "idx_pages_site_type",
  "idx_domains_hostname",
  "idx_site_categories_site_order",
  "idx_category_verticals_vertical",
  "idx_media_site",
  "idx_tags_site_slug",
] as const;

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function findCreateIndex(sql: string, name: string): string | undefined {
  const re = new RegExp(
    `^CREATE\\s+INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+${name}\\b[^;]*;`,
    "im",
  );
  const m = sql.match(re);
  return m ? m[0] : undefined;
}

describe("0002_phase3_multi_site_schema.sql — multi-site composite indexes (T2)", () => {
  it("declares all 12 required Phase 3 idx_* indexes (excluding idx_settings_site_key which lives in 0003)", () => {
    const sql = readMigration();
    const missing = REQUIRED_INDEX_NAMES.filter(
      (n) => findCreateIndex(sql, n) === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("leads every site-scoped index with site_id as the first key", () => {
    const sql = readMigration();
    const siteScoped = REQUIRED_INDEX_NAMES.filter(
      (n) => n !== "idx_domains_hostname" && n !== "idx_category_verticals_vertical",
    );
    for (const name of siteScoped) {
      const stmt = findCreateIndex(sql, name);
      expect(stmt, `${name} missing CREATE INDEX statement`).toBeTruthy();
      expect(stmt!).toMatch(/\(\s*site_id\b/);
    }
  });

  it("declares idx_domains_hostname keyed on hostname for public-middleware lookup", () => {
    const sql = readMigration();
    const stmt = findCreateIndex(sql, "idx_domains_hostname");
    expect(stmt).toBeTruthy();
    expect(stmt!).toMatch(/ON\s+domains\s*\(\s*hostname\s*\)/i);
  });

  it("declares idx_category_verticals_vertical keyed on vertical_id for reverse lookup", () => {
    const sql = readMigration();
    const stmt = findCreateIndex(sql, "idx_category_verticals_vertical");
    expect(stmt).toBeTruthy();
    expect(stmt!).toMatch(/ON\s+category_verticals\s*\(\s*vertical_id\b/i);
  });

  it("uses CREATE INDEX IF NOT EXISTS for every declared index so a re-apply is idempotent", () => {
    const sql = readMigration();
    for (const name of REQUIRED_INDEX_NAMES) {
      const stmt = findCreateIndex(sql, name);
      expect(stmt, `${name} missing CREATE INDEX statement`).toBeTruthy();
      expect(stmt!).toMatch(/CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS/i);
    }
  });
});
