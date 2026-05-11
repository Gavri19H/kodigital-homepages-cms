import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// T7 / Phase 3: assert that migration 0003 declares idx_settings_site_key
// on the restructured site_settings(site_id, key) shape AFTER the
// CREATE-INSERT-DROP-RENAME block from T6 — so the index is attached to
// the new table (the legacy table and its attached indexes were dropped
// in step 3 of T6).
//
// Static SQL parser (readFileSync + regex). The BEHAVIORAL post-apply
// leg (SELECT count(*) FROM sqlite_master WHERE name='idx_settings_site_key')
// is deferred to T33's full-pipeline verification once the architect's
// planned fix for the 0002 forward-declared index lands and
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

describe("0003_phase3_site_settings_restructure.sql (T7)", () => {
  it("declares idx_settings_site_key on site_settings(site_id, key)", () => {
    const sql = readMigration();
    const idx = sql.match(
      /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_settings_site_key\s+ON\s+site_settings\s*\(\s*site_id\s*,\s*key\s*\)\s*;/i,
    );
    expect(
      idx,
      "CREATE INDEX idx_settings_site_key ON site_settings(site_id, key); not declared in 0003 — the (site_id, key) read path will table-scan",
    ).toBeTruthy();
  });

  it("places idx_settings_site_key AFTER the T6 rename of site_settings_new", () => {
    const sql = readMigration();
    const renameIdx = sql.search(
      /ALTER\s+TABLE\s+site_settings_new\s+RENAME\s+TO\s+site_settings\b/i,
    );
    const indexIdx = sql.search(
      /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_settings_site_key\b/i,
    );
    expect(renameIdx).toBeGreaterThanOrEqual(0);
    expect(indexIdx).toBeGreaterThan(renameIdx);
  });

  it("declares exactly one idx_settings_site_key statement in 0003", () => {
    const sql = readMigration();
    const matches = sql.match(
      /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?idx_settings_site_key\b/gi,
    );
    expect(matches?.length ?? 0).toBe(1);
  });
});
