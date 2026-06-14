import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// T3 / Phase 9: schema proof for migration 0010 (sites.content_mode).
//
// CI runs on Node 20 (package.json engines: node >=20), where node:sqlite's
// DatabaseSync is unavailable (it lands in Node >= 22.5). So — exactly like
// the 0004 seed-migration test — this asserts the migration DDL by parsing
// the migration SQL text rather than executing it in an in-memory engine.
// The runtime persistence of the column (DEFAULT 'ai', CHECK enforcement) is
// exercised end to end by the admin/runner suites that bind content_mode
// through the mock-D1 harness, which are Node-20 portable.

const MIGRATIONS_DIR = resolve(__dirname, "..", "migrations");
const MIGRATION_0010 = "0010_phase9_sites_content_mode.sql";

function read0010(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_0010), "utf8");
}

describe("0010_phase9_sites_content_mode.sql — T3 schema delta", () => {
  it("migration 0010 exists in the migrations directory", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files).toContain(MIGRATION_0010);
  });

  it("declares sites.content_mode TEXT NOT NULL DEFAULT 'ai'", () => {
    const sql = read0010();
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+sites\s+ADD\s+COLUMN\s+content_mode\s+TEXT/i,
    );
    expect(sql).toMatch(/content_mode\s+TEXT\s+NOT\s+NULL/i);
    expect(sql).toMatch(/DEFAULT\s+'ai'/i);
  });

  it("constrains content_mode to (ai, manual) via a CHECK", () => {
    const sql = read0010();
    expect(sql).toMatch(
      /CHECK\s*\(\s*content_mode\s+IN\s*\(\s*'ai'\s*,\s*'manual'\s*\)\s*\)/i,
    );
  });

  it("contains no destructive ops (no DROP / table recreation)", () => {
    const sql = read0010();
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
  });
});
