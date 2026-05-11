import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// T8 / Phase 3: assert that migration 0004 seeds the 8 canonical
// vertical slugs and the 4 canonical legal-template slugs. Static
// SQL parser (readFileSync + regex). The behavioural post-apply leg
// (SELECT slug FROM verticals / legal_templates) is deferred to
// T33's full-pipeline verification once the architect's planned
// fix for the 0002 forward-declared index ordering unblocks the
// `wrangler d1 migrations apply --local` ledger.

const MIGRATION_PATH = resolve(
  __dirname,
  "..",
  "migrations",
  "0004_phase3_seed_verticals_and_legal_templates.sql",
);

const EXPECTED_VERTICAL_SLUGS = [
  "home",
  "finance",
  "travel",
  "health",
  "parenting",
  "food",
  "tech",
  "lifestyle",
] as const;

const EXPECTED_LEGAL_SLUGS = [
  "privacy-policy",
  "terms",
  "do-not-sell",
  "contact",
] as const;

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

function extractInsertedSlugs(sql: string, table: string): string[] {
  const pattern = new RegExp(
    `INSERT\\s+(?:OR\\s+IGNORE\\s+)?INTO\\s+${table}[^;]*?VALUES\\s*\\(\\s*'([^']+)'`,
    "gi",
  );
  const slugs: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(sql)) !== null) {
    if (m[1] !== undefined) slugs.push(m[1]);
  }
  return slugs;
}

describe("0004_phase3_seed_verticals_and_legal_templates.sql (T8)", () => {
  it("seed verticals contains exactly 8 expected slugs", () => {
    const sql = readMigration();
    const slugs = extractInsertedSlugs(sql, "verticals");
    expect(slugs.length).toBe(EXPECTED_VERTICAL_SLUGS.length);
    for (const expected of EXPECTED_VERTICAL_SLUGS) {
      expect(slugs).toContain(expected);
    }
  });

  it("seed legal_templates contains exactly 4 expected slugs", () => {
    const sql = readMigration();
    const slugs = extractInsertedSlugs(sql, "legal_templates");
    expect(slugs.length).toBe(EXPECTED_LEGAL_SLUGS.length);
    for (const expected of EXPECTED_LEGAL_SLUGS) {
      expect(slugs).toContain(expected);
    }
  });

  it("uses INSERT OR IGNORE so re-applies are idempotent", () => {
    const sql = readMigration();
    const verticalInserts =
      sql.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+verticals\b/gi) ?? [];
    const legalInserts =
      sql.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+legal_templates\b/gi) ?? [];
    expect(verticalInserts.length).toBe(8);
    expect(legalInserts.length).toBe(4);
  });
});
