// LeadGen Phase 2 — migrations 0036–0039 over REAL sqlite (contract 10
// §31.2): the four files apply cleanly in filename order, all 40 leadgen_
// tables exist, CHECK enums and UNIQUE / partial-unique indexes actually
// enforce, and a second application is a no-op (IF NOT EXISTS everywhere).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// --- node:sqlite harness (repo pattern — mirrors listicles-articles-api) ----

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

// Filename order — the same order `wrangler d1 migrations apply` uses.
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
] as const;

function applyLeadgenMigrations(sdb: SqliteDb): void {
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
}

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  // Pre-0036 FK targets (leadgen_funnel_variants.lander_hero_media_id
  // REFERENCES media(id)) — the same stub tables the listicles harness
  // creates, so the leadgen chain applies over an existing media table.
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  applyLeadgenMigrations(sdb);
  return sdb;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newDb(): SqliteDb {
  return createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
}

function leadgenTableNames(sdb: SqliteDb): string[] {
  const rows = sdb
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'leadgen_%' ORDER BY name",
    )
    .all() as Array<{ name: string }>;
  return rows.map((r) => r.name);
}

// --- seed helpers (minimal NOT NULL column sets from the 0036 DDL) ----------

function seedOffer(sdb: SqliteDb, publicId: string): number {
  sdb
    .prepare(
      "INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type) VALUES (?, ?, 'quote_funnel', 'life', 's2s_postback', 'cpc')",
    )
    .run(publicId, `Offer ${publicId}`);
  return (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
}

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

function seedSection(sdb: SqliteDb, publicId: string): number {
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, ?, 'quote_funnel', 'life', 'Headline', '{\"blocks\":[]}')",
    )
    .run(publicId, `Section ${publicId}`);
  return (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number }).id;
}

describeDb("leadgen migrations 0036–0039 apply cleanly (§31.2)", () => {
  it("creates all 40 leadgen_ tables, including the key entities", () => {
    const sdb = newDb();
    const names = leadgenTableNames(sdb);
    expect(names).toHaveLength(40);
    const nameSet = new Set(names);
    for (const key of [
      "leadgen_offers",
      "leadgen_funnels",
      "leadgen_funnel_variants",
      "leadgen_site_quotes",
      "leadgen_auctions",
      "leadgen_analytics_offer",
      "leadgen_analytics_provider_diagnostics",
      "leadgen_media_platforms",
      "leadgen_conversion_log",
    ]) {
      expect(nameSet.has(key), `${key} missing`).toBe(true);
    }
  });

  it("re-running all four migration files is a no-op (IF NOT EXISTS everywhere), not an error", () => {
    const sdb = newDb();
    const offerId = seedOffer(sdb, "lgo_keep");
    expect(() => applyLeadgenMigrations(sdb)).not.toThrow();
    expect(leadgenTableNames(sdb)).toHaveLength(40);
    // Existing data survives the re-run: tables were kept, not recreated.
    const row = sdb
      .prepare("SELECT id FROM leadgen_offers WHERE public_id = 'lgo_keep'")
      .get() as { id: number };
    expect(row.id).toBe(offerId);
  });
});

describeDb("leadgen CHECK + UNIQUE constraints enforce (§31.2)", () => {
  it("leadgen_offers.offer_type CHECK: 'cpm' is rejected, 'cpc' is accepted", () => {
    const sdb = newDb();
    const insertOffer = (publicId: string, offerType: string) =>
      sdb
        .prepare(
          "INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type) VALUES (?, 'Offer', 'quote_funnel', 'life', 's2s_postback', ?)",
        )
        .run(publicId, offerType);
    expect(() => insertOffer("lgo_bad", "cpm")).toThrow(/CHECK/i);
    insertOffer("lgo_good", "cpc");
    const rows = sdb
      .prepare("SELECT public_id, offer_type FROM leadgen_offers")
      .all() as Array<{ public_id: string; offer_type: string }>;
    expect(rows).toHaveLength(1); // the rejected row wrote nothing
    expect(rows[0]?.public_id).toBe("lgo_good");
    expect(rows[0]?.offer_type).toBe("cpc");
  });

  it("leadgen_postback_log UNIQUE (provider, external_txn_id): duplicate txn rejected, new txn accepted", () => {
    const sdb = newDb();
    const insert = (provider: string, txn: string) =>
      sdb
        .prepare("INSERT INTO leadgen_postback_log (provider, external_txn_id) VALUES (?, ?)")
        .run(provider, txn);
    insert("provider_a", "txn_1");
    expect(() => insert("provider_a", "txn_1")).toThrow(/UNIQUE/i);
    insert("provider_a", "txn_2"); // different txn id — accepted
    insert("provider_b", "txn_1"); // same txn id under another provider — accepted
    const count = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_postback_log").get() as { n: number };
    expect(count.n).toBe(3);
  });

  it("leadgen_conversion_log UNIQUE (click_id, dedupe_key): duplicate conversion rejected", () => {
    const sdb = newDb();
    const insert = (clickId: string, dedupeKey: string) =>
      sdb
        .prepare("INSERT INTO leadgen_conversion_log (click_id, dedupe_key) VALUES (?, ?)")
        .run(clickId, dedupeKey);
    insert("clk_1", "2026-07-06");
    expect(() => insert("clk_1", "2026-07-06")).toThrow(/UNIQUE/i);
    insert("clk_1", "2026-07-07"); // same click, different dedupe window — accepted
    const count = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_conversion_log").get() as { n: number };
    expect(count.n).toBe(2);
  });

  it("uq_leadgen_sitequote_root: at most ONE enabled NULL-slug root per site", () => {
    const sdb = newDb();
    const q1 = seedQuote(sdb, "lgq_1");
    const q2 = seedQuote(sdb, "lgq_2");
    const q3 = seedQuote(sdb, "lgq_3");
    const insert = (siteId: string, quoteId: number, enabled: number, slug: string | null) =>
      sdb
        .prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES (?, ?, ?, ?)")
        .run(siteId, quoteId, enabled, slug);
    insert("st_a", q1, 1, null); // site A's enabled root
    expect(() => insert("st_a", q2, 1, null)).toThrow(/UNIQUE/i); // second enabled root, same site
    insert("st_b", q1, 1, null); // a DIFFERENT site's enabled root — accepted
    insert("st_a", q2, 1, "life-quote"); // same site WITH a slug — accepted
    insert("st_a", q3, 0, null); // NULL slug but disabled — outside the partial index, accepted
    const count = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_site_quotes").get() as { n: number };
    expect(count.n).toBe(4);
  });

  it("uq_leadgen_offerplacement_default: one is_default=1 placement per offer", () => {
    const sdb = newDb();
    const offer1 = seedOffer(sdb, "lgo_1");
    const offer2 = seedOffer(sdb, "lgo_2");
    const insert = (publicId: string, offerId: number, placementId: string, isDefault: number) =>
      sdb
        .prepare(
          "INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, ?)",
        )
        .run(publicId, offerId, placementId, isDefault);
    insert("lgpl_1", offer1, "pl_main", 1);
    expect(() => insert("lgpl_2", offer1, "pl_side", 1)).toThrow(/UNIQUE/i); // second default
    insert("lgpl_3", offer1, "pl_side", 0); // non-default second placement — accepted
    insert("lgpl_4", offer2, "pl_main", 1); // another offer's default — accepted
    const defaults = sdb
      .prepare("SELECT COUNT(*) AS n FROM leadgen_offer_placements WHERE is_default = 1")
      .get() as { n: number };
    expect(defaults.n).toBe(2); // exactly one per offer
  });

  it("leadgen_funnel_variant_sections UNIQUE (variant_id, position): duplicate position per variant rejected", () => {
    const sdb = newDb();
    const quoteId = seedQuote(sdb, "lgq_v");
    const funnelId = seedFunnel(sdb, "lgf_v", quoteId);
    const variantA = seedVariant(sdb, "lgn_a", funnelId);
    const variantB = seedVariant(sdb, "lgn_b", funnelId);
    const section1 = seedSection(sdb, "lgs_1");
    const section2 = seedSection(sdb, "lgs_2");
    const insert = (variantId: number, sectionId: number, position: number) =>
      sdb
        .prepare(
          "INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, ?)",
        )
        .run(variantId, sectionId, position);
    insert(variantA, section1, 0);
    expect(() => insert(variantA, section2, 0)).toThrow(/UNIQUE/i); // same variant, same position
    insert(variantA, section2, 1); // next position — accepted
    insert(variantB, section1, 0); // same position on ANOTHER variant — accepted
    const count = sdb
      .prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_variant_sections")
      .get() as { n: number };
    expect(count.n).toBe(3);
  });
});
