import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// T12 / Phase 9: schema proof for migration 0014 (prompt_presets reference
// columns). Like the 0010 schema test, this asserts the migration DDL by
// parsing the migration SQL text (Node 20 CI lacks node:sqlite's
// DatabaseSync); the live-D1 PRAGMA proof runs through
// `wrangler d1 migrations apply --local` + `PRAGMA table_info(prompt_presets)`.

const MIGRATIONS_DIR = resolve(__dirname, "..", "migrations");
const MIGRATION_0014 = "0014_phase9_prompt_presets_reference_columns.sql";

function read0014(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_0014), "utf8");
}

describe("0014_phase9_prompt_presets_reference_columns.sql — T12 schema delta", () => {
  it("migration 0014 exists in the migrations directory", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files).toContain(MIGRATION_0014);
  });

  // T12-AC2: PRAGMA table_info(prompt_presets) must show these three columns.
  it("declares system_prompt_template, user_prompt_template, content_mapping as nullable TEXT (AC2)", () => {
    const sql = read0014();
    for (const col of [
      "system_prompt_template",
      "user_prompt_template",
      "content_mapping",
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `ALTER\\s+TABLE\\s+prompt_presets\\s+ADD\\s+COLUMN\\s+${col}\\s+TEXT`,
          "i",
        ),
      );
    }
  });

  it("also adds the reference display columns name + description", () => {
    const sql = read0014();
    expect(sql).toMatch(/ALTER\s+TABLE\s+prompt_presets\s+ADD\s+COLUMN\s+name\s+TEXT/i);
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+prompt_presets\s+ADD\s+COLUMN\s+description\s+TEXT/i,
    );
  });

  it("bakes in no NOT NULL / value literal (columns are nullable, back-compatible)", () => {
    const sql = read0014();
    expect(sql).not.toMatch(/NOT\s+NULL/i);
    expect(sql).not.toMatch(/DEFAULT\s+'/i);
  });

  it("contains no destructive ops (no DROP / table recreation)", () => {
    const sql = read0014();
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
  });
});
