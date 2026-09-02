// OWNER 2026-09-03: "No results at all appear now, when the funnel is
// complete." Migration 0057 moves the §5.1 Test verdict onto the Offer row,
// because it was DERIVED from `leadgen_provider_request_log` — a table the
// §30.3 retention cron prunes to seven days — so every dynamic Offer silently
// went ineligible a week after its last Test and the funnel served an empty
// page.
//
// This suite proves the migration's own two jobs against the REAL SQL over
// node:sqlite (the migrations-0041 harness pattern):
//   1. the three columns land additively and nullable (NULL = never tested,
//      the exact verdict the old read-time CASE produced for "no rows");
//   2. the BACKFILL reconstructs a verdict from whatever the 7-day window
//      still holds — INCLUDING his production shape, where the two live
//      Offers had NO surviving Test-tool row but did have successful auction
//      calls, so they come back eligible without an operator re-test.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
      if (typeof getBuiltin === "function") return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
    } catch {
      /* fall through */
    }
    return null;
  }
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "../migrations");
const MIGRATION_0057 = "0057_leadgen_offer_test_verdict.sql";
const PRE = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
] as const;

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}
function apply(sdb: SqliteDb, file: string): void {
  runSql(sdb, readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function preDb(): SqliteDb {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  for (const f of PRE) apply(sdb, f);
  return sdb;
}

function seedOffer(sdb: SqliteDb, publicId: string, name: string): void {
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type, status, calls_provider_api)
       VALUES (?, ?, 'quote_funnel', 'home', 's2s_postback', 'cpc', 'active', 1)`,
    )
    .run(publicId, name);
}

function logRow(
  sdb: SqliteDb,
  offerPublicId: string,
  statusCode: number | null,
  auctionInstanceId: string | null,
  createdAt: number,
): void {
  sdb
    .prepare(
      `INSERT INTO leadgen_provider_request_log
         (offer_public_id, environment, status_code, auction_instance_id, created_at)
       VALUES (?, 'production', ?, ?, ?)`,
    )
    .run(offerPublicId, statusCode, auctionInstanceId, createdAt);
}

function verdictOf(sdb: SqliteDb, publicId: string): { s: string | null; at: number | null; src: string | null } {
  const r = sdb
    .prepare("SELECT last_test_status AS s, last_test_at AS at, last_test_source AS src FROM leadgen_offers WHERE public_id = ?")
    .get(publicId) as { s: string | null; at: number | null; src: string | null };
  return r;
}

describeDb("migration 0057 — the durable Offer Test verdict", () => {
  it("adds exactly three nullable columns and nothing else", () => {
    const sdb = preDb();
    const before = (sdb.prepare("PRAGMA table_info(leadgen_offers)").all() as Array<{ name: string }>).map((c) => c.name);
    apply(sdb, MIGRATION_0057);
    const after = (sdb.prepare("PRAGMA table_info(leadgen_offers)").all() as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: unknown;
    }>);
    const added = after.filter((c) => !before.includes(c.name));
    expect(added.map((c) => c.name)).toEqual(["last_test_status", "last_test_at", "last_test_source"]);
    expect(added.map((c) => c.type)).toEqual(["TEXT", "INTEGER", "TEXT"]);
    // nullable with no default — NULL means "never tested", the same verdict
    // the old read-time CASE produced when the log had no row.
    for (const c of added) {
      expect(c.notnull, c.name).toBe(0);
      expect(c.dflt_value, c.name).toBeNull();
    }
    sdb.close();
  });

  it("an Offer with no provider history at all stays NULL — never fabricated as passed", () => {
    const sdb = preDb();
    seedOffer(sdb, "lgo_never", "NeverCalled");
    apply(sdb, MIGRATION_0057);
    expect(verdictOf(sdb, "lgo_never")).toEqual({ s: null, at: null, src: null });
    sdb.close();
  });

  it("HIS PRODUCTION SHAPE: no surviving Test row, but successful auction calls → 'passed' from 'auction'", () => {
    // Exactly what his D1 held on 2026-09-03: the two live Offers' Test-tool
    // rows were pruned (>7d) while their auction calls from 2026-08-30 08:35
    // survived, both HTTP 200. The backfill must recover them, otherwise the
    // deploy fixes the CLASS but leaves his funnel dead until he re-tests.
    const sdb = preDb();
    seedOffer(sdb, "lgo_ads", "AdsByMoneyHome");
    seedOffer(sdb, "lgo_quin", "QuinStreetHome");
    const aug30 = 1_787_042_159; // 2026-08-30 08:35:59Z
    logRow(sdb, "lgo_ads", 200, "01M18WZ9MSH1DMDYSPPQ4V49C5", aug30);
    logRow(sdb, "lgo_quin", 200, "01M18WZ9MSH1DMDYSPPQ4V49C5", aug30);
    apply(sdb, MIGRATION_0057);
    for (const id of ["lgo_ads", "lgo_quin"]) {
      const v = verdictOf(sdb, id);
      expect(v.s, id).toBe("passed");
      expect(v.src, id).toBe("auction");
      expect(v.at, id).toBe(aug30);
    }
    sdb.close();
  });

  it("a Test-tool row WINS over a newer auction row (the operator's own verdict is authoritative)", () => {
    const sdb = preDb();
    seedOffer(sdb, "lgo_both", "BothKinds");
    logRow(sdb, "lgo_both", 500, null, 1_000); // operator Test — FAILED
    logRow(sdb, "lgo_both", 200, "lgai_newer", 9_000); // newer live call — 200
    apply(sdb, MIGRATION_0057);
    const v = verdictOf(sdb, "lgo_both");
    expect(v.s).toBe("failed");
    expect(v.src).toBe("test");
    expect(v.at).toBe(1_000);
    sdb.close();
  });

  it("a transport-error row (NULL status) produces no verdict — it is not a failure", () => {
    const sdb = preDb();
    seedOffer(sdb, "lgo_transport", "TransportError");
    logRow(sdb, "lgo_transport", null, null, 5_000);
    apply(sdb, MIGRATION_0057);
    expect(verdictOf(sdb, "lgo_transport")).toEqual({ s: null, at: null, src: null });
    sdb.close();
  });

  it("the newest of several Test rows wins, and a non-2xx reads 'failed'", () => {
    const sdb = preDb();
    seedOffer(sdb, "lgo_seq", "Sequence");
    logRow(sdb, "lgo_seq", 200, null, 1_000);
    logRow(sdb, "lgo_seq", 503, null, 2_000); // newest
    apply(sdb, MIGRATION_0057);
    const v = verdictOf(sdb, "lgo_seq");
    expect(v.s).toBe("failed");
    expect(v.at).toBe(2_000);
    sdb.close();
  });
});

// OWNER 2026-09-03, second pass. The first fix changed THREE readers and the
// auction's participating-offers panel was a FOURTH — found by reading the
// deployed endpoint on production, where it still answered
// `"last_test_status":"untested"` for two Offers that the offers list, the
// offer editor's "Eligible for live auction" banner and the engine all agreed
// were `passed`. This guard is source-level so a fifth one cannot appear:
// nothing may re-derive the Test verdict from the pruned log.
describe("no source may re-derive the Test verdict from the 7-day-pruned log", () => {
  it("zero subselects over leadgen_provider_request_log decide a pass/fail verdict", () => {
    const SRC = join(TEST_DIR, "../src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const text = readFileSync(full, "utf8");
        // the shape of the old derivation: a CASE over prl.status_code that
        // yields the verdict vocabulary, anywhere in a query string.
        const derives =
          /status_code\s*>=\s*200[\s\S]{0,200}?'passed'/.test(text) &&
          /leadgen_provider_request_log/.test(text);
        if (derives) offenders.push(full.slice(SRC.length + 1));
      }
    };
    walk(SRC);
    expect(offenders, "read the durable last_test_status column instead").toEqual([]);
  });
});
