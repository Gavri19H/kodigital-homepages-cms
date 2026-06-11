import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// vitest 2.1's bundled vite does not yet list node:sqlite as a builtin
// and fails to resolve a static runtime import of it; the type-only
// import above is erased at transform time and the implementation is
// fetched through process.getBuiltinModule (Node >= 22.3), which
// bypasses the vite resolver entirely.
const { DatabaseSync: SqliteDatabase } = process.getBuiltinModule("node:sqlite");

// T3 / Phase 9: behavioral proof for migration 0010. The AC is "PRAGMA
// confirms content_mode column", so unlike the static-regex 0009 test
// this one APPLIES every migration 0001..0010 in filename order to a
// real in-memory SQLite database (node:sqlite — the same engine D1
// runs) and asserts PRAGMA table_info(sites) lists the declared column
// with its NOT NULL / DEFAULT / CHECK semantics actually enforced.
// Foreign keys are disabled for the apply, mirroring D1's
// defer_foreign_keys behaviour during `wrangler d1 migrations apply`.

const MIGRATIONS_DIR = resolve(__dirname, "..", "migrations");
const MIGRATION_0010 = "0010_phase9_sites_content_mode.sql";

interface TableInfoRow {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

let db: DatabaseSync;

function applyAllMigrations(): DatabaseSync {
  const fresh = new SqliteDatabase(":memory:");
  fresh.exec("PRAGMA foreign_keys = OFF;");
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files) {
    fresh.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  return fresh;
}

function sitesTableInfo(database: DatabaseSync): TableInfoRow[] {
  return database
    .prepare("PRAGMA table_info(sites)")
    .all() as unknown as TableInfoRow[];
}

beforeAll(() => {
  db = applyAllMigrations();
});

afterAll(() => {
  db.close();
});

describe("0010_phase9_sites_content_mode.sql — T3 schema delta", () => {
  it("migration 0010 exists and the full chain 0001..0010 applies cleanly", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files).toContain(MIGRATION_0010);
    // beforeAll already applied every migration without throwing; prove
    // the chain produced the sites table at all.
    expect(sitesTableInfo(db).length).toBeGreaterThan(0);
  });

  it("PRAGMA table_info(sites) lists content_mode TEXT NOT NULL DEFAULT 'ai'", () => {
    const col = sitesTableInfo(db).find((r) => r.name === "content_mode");
    expect(col).toBeDefined();
    expect(col?.type.toUpperCase()).toBe("TEXT");
    expect(col?.notnull).toBe(1);
    expect(col?.dflt_value).toBe("'ai'");
  });

  it("rows inserted without content_mode default to 'ai'", () => {
    db.prepare(
      "INSERT INTO sites (id, name, domain, vertical_slug) VALUES (?, ?, ?, ?)",
    ).run("t3-default-site", "T3 Default", "t3-default.example.com", "finance");
    const row = db
      .prepare("SELECT content_mode FROM sites WHERE id = ?")
      .get("t3-default-site") as { content_mode: string } | undefined;
    expect(row?.content_mode).toBe("ai");
  });

  it("CHECK accepts 'manual' and rejects values outside (ai, manual)", () => {
    db.prepare("UPDATE sites SET content_mode = ? WHERE id = ?").run(
      "manual",
      "t3-default-site",
    );
    const row = db
      .prepare("SELECT content_mode FROM sites WHERE id = ?")
      .get("t3-default-site") as { content_mode: string } | undefined;
    expect(row?.content_mode).toBe("manual");

    expect(() =>
      db
        .prepare("UPDATE sites SET content_mode = ? WHERE id = ?")
        .run("autopilot", "t3-default-site"),
    ).toThrow(/CHECK/i);
  });

  it("0010 contains no destructive ops (no DROP / table recreation)", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, MIGRATION_0010), "utf8");
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
  });
});
