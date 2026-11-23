// X06 "SEO Fixes" (owner decision Q3): migration 0071 restores the SEO titles
// that new-site setup cut at 70 characters mid-word. It may change ONLY rows
// whose seo_title is exactly the first 70 characters of a LONGER title —
// never an SEO title an operator typed, never a short title, never NULL — and
// a second run changes nothing.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDatabaseSync, type SqliteDb } from "./helpers/leadgen-analytics-harness";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
const MIGRATION_0071 = readFileSync(join(MIGRATIONS_DIR, "0071_articles_seo_title_uncut.sql"), "utf8");

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function exec(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

const LONG = "Popular Budgeting Methods Compared: 50/30/20, Zero-Based, Envelope, and More";
const LONG_2 = "How to Pick a Health Insurance Plan When Your Employer Offers Three Different Options";
const EXACTLY_70 = "A".repeat(70);
const SHORT = "How to Build a Budget";

interface Row {
  slug: string;
  title: string;
  seo_title: string | null;
  updated_at: number;
}

function newDb(): SqliteDb {
  const sdb = new DatabaseSync!(":memory:");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && Number(f.slice(0, 4)) < 70)
    .sort();
  for (const f of files) exec(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  exec(sdb, "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('st_1', 's', 's.com', 'finance', 'active');");
  const insert = sdb.prepare(
    "INSERT INTO articles (slug, title, content_json, status, site_id, seo_title, updated_at) VALUES (?, ?, '{}', 'published', 'st_1', ?, 1700000000)",
  );
  // 1. cut by setup → fixed
  insert.run("cut", LONG, LONG.slice(0, 70));
  // 1b. a second cut row on another Article → fixed too
  insert.run("cut-2", LONG_2, LONG_2.slice(0, 70));
  // 2. operator-typed short SEO title on a long title → unchanged
  insert.run("typed", LONG, "Budgeting Methods Compared");
  // 2b. operator-typed SEO title 70 chars long but not the title's prefix → unchanged
  insert.run("typed-70", LONG, "B".repeat(70));
  // 3. title of exactly 70 characters, SEO title equal to it → unchanged (nothing was cut)
  insert.run("exactly-70", EXACTLY_70, EXACTLY_70);
  // 3b. short title, SEO title = title → unchanged
  insert.run("short", SHORT, SHORT);
  // 4. NULL seo_title → unchanged
  insert.run("null-seo", LONG, null);
  // 5. full SEO title already → unchanged
  insert.run("full", LONG, LONG);
  return sdb;
}

function rows(sdb: SqliteDb): Row[] {
  return sdb
    .prepare("SELECT slug, title, seo_title, updated_at FROM articles ORDER BY slug")
    .all() as unknown as Row[];
}

function runMigration(sdb: SqliteDb): number {
  const before = (sdb.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  exec(sdb, MIGRATION_0071);
  const after = (sdb.prepare("SELECT total_changes() AS n").get() as { n: number }).n;
  return after - before;
}

describeDb("migration 0071: restore SEO titles cut at 70 characters (owner Q3)", () => {
  it("changes exactly the cut rows, to the full title; every other row is byte-identical", () => {
    const sdb = newDb();
    const before = rows(sdb);
    expect(runMigration(sdb)).toBe(2);
    const after = rows(sdb);

    const bySlug = (rs: Row[]) => new Map(rs.map((r) => [r.slug, r]));
    const b = bySlug(before);
    const a = bySlug(after);
    expect(a.get("cut")!.seo_title).toBe(LONG);
    expect(a.get("cut-2")!.seo_title).toBe(LONG_2);
    for (const slug of ["typed", "typed-70", "exactly-70", "short", "null-seo", "full"]) {
      expect(a.get(slug), slug).toEqual(b.get(slug));
    }
    // updated_at is not touched, even on the fixed rows.
    expect(a.get("cut")!.updated_at).toBe(1700000000);
    expect(a.get("null-seo")!.seo_title).toBeNull();
  });

  it("a second run changes nothing", () => {
    const sdb = newDb();
    expect(runMigration(sdb)).toBe(2);
    const once = rows(sdb);
    expect(runMigration(sdb)).toBe(0);
    expect(rows(sdb)).toEqual(once);
  });
});
