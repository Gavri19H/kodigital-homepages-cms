import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// T9 / Phase 3: assert that migration 0004 seeds >= 7 global category
// rows and a category_verticals many-to-many matrix that links at
// least one category to >= 2 verticals (the AC names healthy-meals ->
// health+food+parenting as the canonical example). Static SQL parser
// (readFileSync + regex). The behavioural post-apply leg (SELECT
// category_id, COUNT(vertical_id) FROM category_verticals GROUP BY
// category_id) is deferred to T33's full-pipeline verification once
// the architect's planned fix for the 0002 forward-declared index
// ordering unblocks the `wrangler d1 migrations apply --local` ledger.

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "migrations",
  "0004_phase3_seed_verticals_and_legal_templates.sql",
);

const EXPECTED_CATEGORY_SLUGS = [
  "healthy-meals",
  "family-travel",
  "personal-finance",
  "smart-home",
  "quick-recipes",
  "tech-gadgets",
  "wellness",
] as const;

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function extractCategorySlugs(sql: string): string[] {
  const pattern =
    /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+categories\b[^;]*?VALUES\s*\(\s*'([^']+)'/gi;
  const slugs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(sql)) !== null) {
    if (m[1] !== undefined) slugs.push(m[1]);
  }
  return slugs;
}

// Parse each INSERT INTO category_verticals row and return the
// (categorySlug, verticalSlug) pair the row encodes. Each row in the
// seed reads:
//   INSERT OR IGNORE INTO category_verticals (...) VALUES (
//     (SELECT id FROM categories WHERE slug = '<cat>'),
//     (SELECT id FROM verticals WHERE slug = '<vert>'),
//     <display_order>);
function extractCategoryVerticalPairs(
  sql: string,
): Array<{ categorySlug: string; verticalSlug: string }> {
  const pattern =
    /INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+category_verticals\b[\s\S]*?categories\s+WHERE\s+slug\s*=\s*'([^']+)'[\s\S]*?verticals\s+WHERE\s+slug\s*=\s*'([^']+)'/gi;
  const pairs: Array<{ categorySlug: string; verticalSlug: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(sql)) !== null) {
    if (m[1] !== undefined && m[2] !== undefined) {
      pairs.push({ categorySlug: m[1], verticalSlug: m[2] });
    }
  }
  return pairs;
}

describe("0004_phase3_seed_verticals_and_legal_templates.sql (T9 categories)", () => {
  it("seed categories contains >= 7 expected slugs", () => {
    const sql = readMigration();
    const slugs = extractCategorySlugs(sql);
    expect(slugs.length).toBeGreaterThanOrEqual(EXPECTED_CATEGORY_SLUGS.length);
    for (const expected of EXPECTED_CATEGORY_SLUGS) {
      expect(slugs).toContain(expected);
    }
  });

  it("category can map to multiple verticals", () => {
    const sql = readMigration();
    const pairs = extractCategoryVerticalPairs(sql);
    expect(pairs.length).toBeGreaterThan(0);

    const byCategory = new Map<string, Set<string>>();
    for (const { categorySlug, verticalSlug } of pairs) {
      const set = byCategory.get(categorySlug) ?? new Set<string>();
      set.add(verticalSlug);
      byCategory.set(categorySlug, set);
    }

    let maxFanOut = 0;
    let exemplar: string | null = null;
    for (const [cat, verts] of byCategory) {
      if (verts.size > maxFanOut) {
        maxFanOut = verts.size;
        exemplar = cat;
      }
    }
    expect(maxFanOut).toBeGreaterThanOrEqual(2);
    expect(exemplar).not.toBeNull();

    // The T9.AC2 BEHAVIORAL example names healthy-meals ->
    // health+food+parenting; assert the example holds verbatim so a
    // future refactor that drops the canonical 3-way mapping is
    // caught.
    const healthyMealsVerticals = byCategory.get("healthy-meals");
    expect(healthyMealsVerticals).toBeDefined();
    expect(healthyMealsVerticals?.has("health")).toBe(true);
    expect(healthyMealsVerticals?.has("food")).toBe(true);
    expect(healthyMealsVerticals?.has("parenting")).toBe(true);
  });

  it("uses INSERT OR IGNORE so re-applies are idempotent", () => {
    const sql = readMigration();
    const categoryInserts =
      sql.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+categories\b/gi) ?? [];
    const cvInserts =
      sql.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+category_verticals\b/gi) ?? [];
    expect(categoryInserts.length).toBeGreaterThanOrEqual(7);
    expect(cvInserts.length).toBeGreaterThanOrEqual(7);
  });
});
