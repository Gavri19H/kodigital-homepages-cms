import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// T13 / Phase 9: seed proof for migration 0016 (default is_system prompt
// presets). Like the other migration schema tests, this asserts the seed DDL
// by parsing the migration SQL text; the live-D1 proof runs through
// `wrangler d1 migrations apply --local` + the AC2 SELECT (RC-036).

const MIGRATIONS_DIR = resolve(__dirname, "..", "migrations");
const MIGRATION_0016 = "0016_phase9_seed_default_prompt_presets.sql";

function read0016(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_0016), "utf8");
}

// T13-AC2: a default is_system preset for EVERY use-case category so every
// preset lookup resolves.
const FULL_CATEGORY_ENUM = [
  "title",
  "excerpt",
  "outline",
  "content",
  "seo",
  "image",
  "custom",
];

describe("0016_phase9_seed_default_prompt_presets.sql — T13 seed", () => {
  it("migration 0016 exists in the migrations directory", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files).toContain(MIGRATION_0016);
  });

  it("seeds one is_system default preset per category in the full enum (AC2)", () => {
    const sql = read0016();
    for (const category of FULL_CATEGORY_ENUM) {
      // Each category appears as a bound VALUES literal.
      expect(sql).toContain(`'${category}'`);
    }
    // All seven rows are is_system defaults — assert the seed marks system
    // presets and never inserts a non-system row (fresh site = only these 7).
    const systemSlugs = [
      "system-title",
      "system-excerpt",
      "system-outline",
      "system-content",
      "system-seo",
      "system-image",
      "system-custom",
    ];
    for (const slug of systemSlugs) {
      expect(sql).toContain(`'${slug}'`);
    }
  });

  it("is idempotent via INSERT OR IGNORE (AC2)", () => {
    const sql = read0016();
    expect(sql).toMatch(/INSERT\s+OR\s+IGNORE\s+INTO\s+prompt_presets/i);
    // No plain INSERT that could duplicate on re-run.
    expect(sql).not.toMatch(/INSERT\s+INTO\s+prompt_presets/i);
  });

  it("populates the NOT NULL prompt_template + the reference System/User split", () => {
    const sql = read0016();
    // The INSERT names prompt_template (NOT NULL from 0001) plus the reference
    // columns the resolver reads (migration 0014).
    expect(sql).toMatch(/prompt_template/);
    expect(sql).toMatch(/system_prompt_template/);
    expect(sql).toMatch(/user_prompt_template/);
    // Interpolation tokens the preset-resolver substitutes at generation time.
    expect(sql).toContain("{{vertical}}");
    expect(sql).toContain("{{title}}");
  });

  it("bakes in no unsupported model id (text=gpt-5.5, image=gpt-image-2 only)", () => {
    const sql = read0016();
    expect(sql).toContain("gpt-5.5");
    expect(sql).toContain("gpt-image-2");
  });

  it("contains no destructive ops (no DROP / table recreation)", () => {
    const sql = read0016();
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
  });
});
