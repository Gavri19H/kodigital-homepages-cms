// LeadGen v2.5.1 redesign — migration 0041 (redesign contract 03 §3.1): the
// frame/theme storage columns land additively — leadgen_funnels.frame_config_json,
// leadgen_funnels.theme_json and leadgen_funnel_variants.frame_overrides_json,
// all nullable TEXT with NULL defaults (NULL = exact legacy behavior), forward
// only, no backfill, and ZERO other schema drift for the two tables vs their
// 0036 definitions + prior migrations. The static DDL asserts follow the
// migrations-0009/0010 pattern (Node-portable); the behavioral suite applies
// the REAL chain 0036→0040 then 0041 over node:sqlite (the
// leadgen-migrations.test.ts harness) and skips where node:sqlite is
// unavailable (Node < 22.5), exactly like that suite.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- node:sqlite harness (repo pattern — mirrors leadgen-migrations.test.ts) --

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  close(): void;
  [method: string]: unknown;
};
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return mod.DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        const mod = getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
        return mod.DatabaseSync;
      }
    } catch {
      /* fall through */
    }
    return null;
  }
}

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "../migrations");
const MIGRATION_0041 = "0041_leadgen_frame_theme.sql";

// Filename order — the same order `wrangler d1 migrations apply` uses.
const PRE_0041_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
] as const;

function applyMigrationFile(sdb: SqliteDb, file: string): void {
  runSql(sdb, readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

function createPre0041Db(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  // Pre-0036 FK targets (leadgen_funnel_variants.lander_hero_media_id
  // REFERENCES media(id)) — the same stub tables the leadgen harness creates.
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  for (const file of PRE_0041_MIGRATIONS) applyMigrationFile(sdb, file);
  return sdb;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newDb(): SqliteDb {
  return createPre0041Db(DatabaseSync as DatabaseSyncCtor);
}

function leadgenTableNames(sdb: SqliteDb): string[] {
  const rows = sdb
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'leadgen_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

// PRAGMA snapshots normalized to plain objects so toEqual compares values only.
type ColumnInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
};

function tableInfo(sdb: SqliteDb, table: string): ColumnInfo[] {
  const rows = sdb.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  return rows.map((r) => ({
    cid: r.cid,
    name: r.name,
    type: r.type,
    notnull: r.notnull,
    dflt_value: r.dflt_value,
    pk: r.pk,
  }));
}

function indexNames(sdb: SqliteDb, table: string): string[] {
  const rows = sdb.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>;
  return rows.map((r) => r.name).sort();
}

// --- seed helpers (minimal NOT NULL column sets from the 0036 DDL) ----------

function seedQuote(sdb: SqliteDb, publicId: string): number {
  sdb
    .prepare(
      "INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, ?, 'quote_funnel', '[\"life\"]')",
    )
    .run(publicId, `Quote ${publicId}`);
  return (sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = ?").get(publicId) as { id: number }).id;
}

function seedFunnel(sdb: SqliteDb, publicId: string, quoteId: number): number {
  sdb
    .prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, ?, ?)")
    .run(publicId, quoteId, `Funnel ${publicId}`);
  return (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(publicId) as { id: number }).id;
}

function seedVariant(sdb: SqliteDb, publicId: string, funnelId: number): number {
  sdb
    .prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES (?, ?)")
    .run(publicId, funnelId);
  return (
    sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(publicId) as { id: number }
  ).id;
}

// --- static DDL asserts (Node-portable — migrations-0009/0010 pattern) ------

function read0041(): string {
  return readFileSync(join(MIGRATIONS_DIR, MIGRATION_0041), "utf8");
}

describe("0041_leadgen_frame_theme.sql — contract 03 §3.1 DDL (additive, forward-only)", () => {
  it("migration 0041 exists in the migrations directory", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
    expect(files).toContain(MIGRATION_0041);
  });

  it("declares exactly the three §3.1 ALTER TABLE ADD COLUMN statements (nullable TEXT)", () => {
    const sql = read0041();
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+leadgen_funnels\s+ADD\s+COLUMN\s+frame_config_json\s+TEXT\s*;/i,
    );
    expect(sql).toMatch(/ALTER\s+TABLE\s+leadgen_funnels\s+ADD\s+COLUMN\s+theme_json\s+TEXT\s*;/i);
    expect(sql).toMatch(
      /ALTER\s+TABLE\s+leadgen_funnel_variants\s+ADD\s+COLUMN\s+frame_overrides_json\s+TEXT\s*;/i,
    );
    expect(sql.match(/ALTER\s+TABLE/gi) ?? []).toHaveLength(3);
  });

  it("adds NULL-default columns with no backfill (no NOT NULL / DEFAULT / DML)", () => {
    const sql = read0041();
    expect(sql).not.toMatch(/NOT\s+NULL/i);
    expect(sql).not.toMatch(/DEFAULT/i);
    expect(sql).not.toMatch(/UPDATE/i);
    expect(sql).not.toMatch(/INSERT/i);
    expect(sql).not.toMatch(/DELETE/i);
  });

  it("contains no destructive ops (no DROP / no table recreation)", () => {
    const sql = read0041();
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+INDEX/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
  });
});

// --- behavioral asserts over the real chain (node:sqlite) -------------------

describeDb("0041 applies over the real 0036–0040 chain (§3.1 behavior)", () => {
  it("adds frame_config_json + theme_json (funnels) and frame_overrides_json (variants) as nullable TEXT with NULL default", () => {
    const sdb = newDb();
    applyMigrationFile(sdb, MIGRATION_0041);
    const expected: Array<[table: string, column: string]> = [
      ["leadgen_funnels", "frame_config_json"],
      ["leadgen_funnels", "theme_json"],
      ["leadgen_funnel_variants", "frame_overrides_json"],
    ];
    for (const [table, column] of expected) {
      const info = tableInfo(sdb, table).find((c) => c.name === column);
      expect(info, `${table}.${column} missing after 0041`).toBeDefined();
      expect(info?.type).toBe("TEXT");
      expect(info?.notnull).toBe(0); // nullable
      expect(info?.dflt_value).toBeNull(); // NULL default
      expect(info?.pk).toBe(0);
    }
  });

  it("pre-existing funnel + variant rows are unaffected and read NULL in the new columns", () => {
    const sdb = newDb();
    const quoteId = seedQuote(sdb, "lgq_pre");
    const funnelId = seedFunnel(sdb, "lgf_pre", quoteId);
    seedVariant(sdb, "lgn_pre", funnelId);
    const funnelBefore = {
      ...(sdb.prepare("SELECT * FROM leadgen_funnels WHERE public_id = 'lgf_pre'").get() as Record<
        string,
        unknown
      >),
    };
    const variantBefore = {
      ...(sdb
        .prepare("SELECT * FROM leadgen_funnel_variants WHERE public_id = 'lgn_pre'")
        .get() as Record<string, unknown>),
    };

    applyMigrationFile(sdb, MIGRATION_0041);

    const funnelAfter = {
      ...(sdb.prepare("SELECT * FROM leadgen_funnels WHERE public_id = 'lgf_pre'").get() as Record<
        string,
        unknown
      >),
    };
    const variantAfter = {
      ...(sdb
        .prepare("SELECT * FROM leadgen_funnel_variants WHERE public_id = 'lgn_pre'")
        .get() as Record<string, unknown>),
    };
    // Every pre-existing value is bit-identical; the ONLY delta is the new
    // columns, which read NULL (= legacy behavior) without any backfill.
    expect(funnelAfter).toEqual({ ...funnelBefore, frame_config_json: null, theme_json: null });
    expect(variantAfter).toEqual({ ...variantBefore, frame_overrides_json: null });
  });

  it("is additive: zero schema drift for the two tables beyond the appended columns (columns / indexes / table set)", () => {
    const sdb = newDb();
    const funnelColsBefore = tableInfo(sdb, "leadgen_funnels");
    const variantColsBefore = tableInfo(sdb, "leadgen_funnel_variants");
    const funnelIdxBefore = indexNames(sdb, "leadgen_funnels");
    const variantIdxBefore = indexNames(sdb, "leadgen_funnel_variants");
    const tablesBefore = leadgenTableNames(sdb);

    applyMigrationFile(sdb, MIGRATION_0041);

    const funnelColsAfter = tableInfo(sdb, "leadgen_funnels");
    const variantColsAfter = tableInfo(sdb, "leadgen_funnel_variants");
    // The 0036-and-prior column definitions are untouched (same order, type,
    // notnull, default, pk) — the new columns strictly APPEND in DDL order.
    expect(funnelColsAfter.slice(0, funnelColsBefore.length)).toEqual(funnelColsBefore);
    expect(funnelColsAfter.slice(funnelColsBefore.length).map((c) => c.name)).toEqual([
      "frame_config_json",
      "theme_json",
    ]);
    expect(variantColsAfter.slice(0, variantColsBefore.length)).toEqual(variantColsBefore);
    expect(variantColsAfter.slice(variantColsBefore.length).map((c) => c.name)).toEqual([
      "frame_overrides_json",
    ]);
    // No index or table-set drift.
    expect(indexNames(sdb, "leadgen_funnels")).toEqual(funnelIdxBefore);
    expect(indexNames(sdb, "leadgen_funnel_variants")).toEqual(variantIdxBefore);
    expect(leadgenTableNames(sdb)).toEqual(tablesBefore);
  });

  it("new columns accept JSON text writes; omitted on INSERT they default to NULL", () => {
    const sdb = newDb();
    applyMigrationFile(sdb, MIGRATION_0041);
    const quoteId = seedQuote(sdb, "lgq_post");
    const frameJson = '{"version":1,"template":"centered"}';
    const themeJson = '{"version":1}';
    const overridesJson = '{"header":{"enabled":false}}';
    sdb
      .prepare(
        "INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, frame_config_json, theme_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run("lgf_post", quoteId, "Funnel lgf_post", frameJson, themeJson);
    const funnelId = (
      sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = 'lgf_post'").get() as { id: number }
    ).id;
    sdb
      .prepare(
        "INSERT INTO leadgen_funnel_variants (public_id, funnel_id, frame_overrides_json) VALUES (?, ?, ?)",
      )
      .run("lgn_post", funnelId, overridesJson);

    const funnel = sdb
      .prepare("SELECT frame_config_json, theme_json FROM leadgen_funnels WHERE public_id = 'lgf_post'")
      .get() as { frame_config_json: string | null; theme_json: string | null };
    expect(funnel.frame_config_json).toBe(frameJson);
    expect(funnel.theme_json).toBe(themeJson);
    const variant = sdb
      .prepare(
        "SELECT frame_overrides_json FROM leadgen_funnel_variants WHERE public_id = 'lgn_post'",
      )
      .get() as { frame_overrides_json: string | null };
    expect(variant.frame_overrides_json).toBe(overridesJson);

    // Columns omitted on INSERT (the legacy write shape) land as NULL.
    const legacyFunnelId = seedFunnel(sdb, "lgf_legacy", quoteId);
    seedVariant(sdb, "lgn_legacy", legacyFunnelId);
    const legacyFunnel = sdb
      .prepare("SELECT frame_config_json, theme_json FROM leadgen_funnels WHERE public_id = 'lgf_legacy'")
      .get() as { frame_config_json: string | null; theme_json: string | null };
    expect(legacyFunnel.frame_config_json).toBeNull();
    expect(legacyFunnel.theme_json).toBeNull();
    const legacyVariant = sdb
      .prepare(
        "SELECT frame_overrides_json FROM leadgen_funnel_variants WHERE public_id = 'lgn_legacy'",
      )
      .get() as { frame_overrides_json: string | null };
    expect(legacyVariant.frame_overrides_json).toBeNull();
  });
});
