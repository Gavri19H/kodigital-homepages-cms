import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// T6 / Phase 3: assert that migration 0003 restructures site_settings to
// the (site_id, key) UNIQUE shape via the D1-safe CREATE-INSERT-DROP-
// RENAME pattern, preserving every pre-existing row under site_id NULL.
//
// Static SQL parser (readFileSync + regex). The BEHAVIORAL post-apply
// leg (insert two rows with the same key under different site_ids and
// observe the UNIQUE(site_id, key) collision behaviour) is deferred to
// T33's full-pipeline verification once T7 (idx_settings_site_key) and
// T8/T9 (seed migrations) are also in place and
// `wrangler d1 migrations apply --local` can advance the ledger.

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "migrations",
  "0003_phase3_site_settings_restructure.sql",
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("0003_phase3_site_settings_restructure.sql (T6)", () => {
  it("site_settings restructure preserves pre-existing keys", () => {
    const sql = readMigration();

    // Step 1: CREATE TABLE site_settings_new with site_id + UNIQUE(site_id, key).
    const createNew = sql.match(
      /CREATE\s+TABLE\s+site_settings_new\s*\(([\s\S]*?)\)\s*;/i,
    );
    expect(createNew, "CREATE TABLE site_settings_new not declared").toBeTruthy();
    const body = createNew![1] ?? "";
    expect(/\bsite_id\b/i.test(body), "site_settings_new must have a site_id column").toBe(true);
    expect(/\bkey\s+TEXT\s+NOT\s+NULL\b/i.test(body), "site_settings_new.key must remain NOT NULL").toBe(true);
    expect(/\bvalue\s+TEXT\s+NOT\s+NULL\b/i.test(body), "site_settings_new.value must remain NOT NULL").toBe(true);
    expect(
      /UNIQUE\s*\(\s*site_id\s*,\s*key\s*\)/i.test(body),
      "site_settings_new must declare UNIQUE(site_id, key)",
    ).toBe(true);

    // Step 2: INSERT OR IGNORE rows from the legacy table with site_id NULL.
    const copyLegacy = sql.match(
      /INSERT\s+OR\s+IGNORE\s+INTO\s+site_settings_new\s*\(\s*site_id\s*,\s*key\s*,\s*value\s*\)\s*SELECT\s+NULL\s*,\s*key\s*,\s*value\s+FROM\s+site_settings\s*;/i,
    );
    expect(
      copyLegacy,
      "INSERT OR IGNORE INTO site_settings_new ... SELECT NULL, key, value FROM site_settings; not found — pre-existing keys would be lost",
    ).toBeTruthy();

    // Step 3: DROP TABLE site_settings; (drops the legacy shape and its indexes).
    const dropLegacy = sql.match(/\bDROP\s+TABLE\s+site_settings\s*;/i);
    expect(dropLegacy, "DROP TABLE site_settings; not found").toBeTruthy();

    // Step 4: ALTER TABLE site_settings_new RENAME TO site_settings; (the new shape goes live under the original name).
    const renameNew = sql.match(
      /ALTER\s+TABLE\s+site_settings_new\s+RENAME\s+TO\s+site_settings\s*;/i,
    );
    expect(renameNew, "ALTER TABLE site_settings_new RENAME TO site_settings; not found").toBeTruthy();
  });

  it("orders the four restructure steps as CREATE → INSERT → DROP → RENAME", () => {
    const sql = readMigration();
    const createIdx = sql.search(/CREATE\s+TABLE\s+site_settings_new\b/i);
    const insertIdx = sql.search(
      /INSERT\s+OR\s+IGNORE\s+INTO\s+site_settings_new\b/i,
    );
    const dropIdx = sql.search(/\bDROP\s+TABLE\s+site_settings\s*;/i);
    const renameIdx = sql.search(
      /ALTER\s+TABLE\s+site_settings_new\s+RENAME\s+TO\s+site_settings\b/i,
    );
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeGreaterThan(createIdx);
    expect(dropIdx).toBeGreaterThan(insertIdx);
    expect(renameIdx).toBeGreaterThan(dropIdx);
  });

  it("copies legacy rows under site_id NULL so global keys survive as global defaults", () => {
    const sql = readMigration();
    const selectClause = sql.match(
      /SELECT\s+NULL\s*,\s*key\s*,\s*value\s+FROM\s+site_settings\b/i,
    );
    expect(
      selectClause,
      "legacy row copy must SELECT NULL as site_id — without this every pre-existing key would lose its global tier",
    ).toBeTruthy();
  });
});
