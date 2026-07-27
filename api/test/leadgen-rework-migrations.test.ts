// LeadGen Rework P1 — round-trip proof for migrations M1–M5 (0046–0049) over
// REAL sqlite. Applies the WHOLE chain (0001 → whatever exists, so 0050–0053
// are picked up automatically once S1.2 lands them) in filename order — the
// same order `wrangler d1 migrations apply` uses — and asserts the new shapes
// AND that seeded pre-M3 fixture rows survive the recreations with ids
// preserved and the route_funnel_variant rule lands migrated with target = its
// owning funnel.
//
// node:sqlite harness (repo pattern — mirrors leadgen-migrations.test.ts):
// DatabaseSync lands in Node >= 22.5; on older Node the whole suite skips,
// exactly like the sibling migration/seam suites. REAL SQL execution, no mocks.
// SQL is run through the harness helper (bracket-access to the sqlite handle's
// batch runner), never Node's child_process.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { FRAME_TEMPLATES } from "../src/public/leadgen/designs/frames";

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

// Run a batch of SQL through the sqlite handle (bracket-access, repo pattern).
function runSql(db: SqliteDb, sql: string): void {
  (db["exec"] as (s: string) => void)(sql);
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");
const M3_FILE = "0048_leadgen_rework_m3_routing.sql";

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}

function applyFiles(db: SqliteDb, files: readonly string[]): void {
  for (const f of files) runSql(db, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

// A fresh in-memory DB with the ENTIRE migration chain applied (the
// db:reset:local / production apply path, no fixtures).
function freshDb(): SqliteDb {
  const db = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  applyFiles(db, migrationFiles());
  return db;
}

// Column-name set / lookup helpers over PRAGMA table_info.
function columns(db: SqliteDb, table: string): Map<string, { notnull: number; type: string }> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
    type: string;
    notnull: number;
  }>;
  return new Map(rows.map((r) => [r.name, { notnull: r.notnull, type: r.type }]));
}
function indexNames(db: SqliteDb, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}
function tableSql(db: SqliteDb, table: string): string {
  return (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table) as { sql: string }).sql;
}

// Seed the pre-M3 fixtures, then apply M3 (0048) onward. Returns the ids so the
// "survives with ids preserved" assertions can compare exact values.
interface SeedIds {
  db: SqliteDb;
  quoteId: number;
  funnelId: number;
  variantId: number;
  routeRuleId: number;
}
function seedThenMigrate(): SeedIds {
  const db = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  const files = migrationFiles();
  const idx = files.indexOf(M3_FILE);
  expect(idx, "0048 must be present in the migrations dir").toBeGreaterThan(0);
  // Apply 0001 .. up to (not incl.) 0048 — route_funnel_variant is still a
  // valid rule_type here (added by 0043, removed by 0048).
  applyFiles(db, files.slice(0, idx));

  db.prepare(
    "INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES ('lgq_rw1', 'Rework Q', 'life', '[\"life\"]', 'active')",
  ).run();
  const quoteId = (db.prepare("SELECT id FROM leadgen_quotes WHERE public_id = 'lgq_rw1'").get() as { id: number }).id;

  db.prepare(
    "INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status) VALUES ('lgf_rw1', ?, 'Rework F', 'active')",
  ).run(quoteId);
  const funnelId = (db.prepare("SELECT id FROM leadgen_funnels WHERE public_id = 'lgf_rw1'").get() as { id: number }).id;

  db.prepare(
    "INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES ('lgn_rw1', ?, 'A')",
  ).run(funnelId);
  const variantId = (db.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = 'lgn_rw1'").get() as { id: number }).id;

  // a variant-owned page (owner axis: variant set, quote NULL)
  db.prepare(
    "INSERT INTO leadgen_funnel_pages (public_id, variant_id, quote_id, position) VALUES ('lgpg_rw1', ?, NULL, 0)",
  ).run(variantId);

  // the route_funnel_variant rule to be migrated (D2)
  db.prepare(
    "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, value_multiplier, redirect_pct, status) VALUES ('lgfr_route', ?, 'route_funnel_variant', '{\"groups\":[]}', 'hash_route', 7, 1.5, 50, 'active')",
  ).run(variantId);
  const routeRuleId = (db.prepare("SELECT id FROM leadgen_funnel_rules WHERE public_id = 'lgfr_route'").get() as { id: number }).id;

  // an auction-domain rule that MUST survive the CHECK tightening
  db.prepare(
    "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority) VALUES ('lgfr_dq', ?, 'disqualification', '{\"groups\":[]}', 'hash_dq', 10)",
  ).run(variantId);

  // a pre-M3 routing outcome (0043 shape) — recreation must backfill routed_to_funnel
  db.prepare(
    "INSERT INTO leadgen_routing_outcomes (funnel_attempt_id, session_id, routed_from_variant, routed_to_variant, matched_rule_hash, value_multiplier, plane) VALUES ('att_rw1', 'sess_rw1', 'lgn_rw1', 'lgn_rw1', 'hash_route', 1.5, 'entry')",
  ).run();

  // Apply 0048 onward (M3 recreations + M4/M5).
  applyFiles(db, files.slice(idx));
  return { db, quoteId, funnelId, variantId, routeRuleId };
}

describeDb("rework migrations 0046–0049 apply cleanly over the full chain", () => {
  it("applies every migration 0001→(latest) in filename order without error", () => {
    expect(() => freshDb()).not.toThrow();
  });

  it("creates the two NEW tables (leadgen_quote_routing_rules, leadgen_frame_templates)", () => {
    const db = freshDb();
    const names = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'leadgen_%'").all() as Array<{ name: string }>).map((r) => r.name),
    );
    expect(names.has("leadgen_quote_routing_rules")).toBe(true);
    expect(names.has("leadgen_frame_templates")).toBe(true);
  });
});

describeDb("M1 — leadgen_funnel_variants drops is_control", () => {
  it("has NO is_control column and keeps the funnel index", () => {
    const db = freshDb();
    const cols = columns(db, "leadgen_funnel_variants");
    expect(cols.has("is_control")).toBe(false);
    // frame_template_id is added by M5 (0049).
    expect(cols.has("frame_template_id")).toBe(true);
    expect(indexNames(db, "leadgen_funnel_variants").has("idx_leadgen_variants_funnel")).toBe(true);
  });
});

describeDb("M2 — owner axis on pages + variant_sections", () => {
  it("both tables carry variant_id (nullable) + quote_id (nullable) + the owner CHECK", () => {
    const db = freshDb();
    for (const t of ["leadgen_funnel_pages", "leadgen_funnel_variant_sections"]) {
      const cols = columns(db, t);
      expect(cols.has("variant_id"), `${t}.variant_id`).toBe(true);
      expect(cols.get("variant_id")!.notnull, `${t}.variant_id nullable`).toBe(0);
      expect(cols.has("quote_id"), `${t}.quote_id`).toBe(true);
      expect(cols.get("quote_id")!.notnull, `${t}.quote_id nullable`).toBe(0);
      expect(tableSql(db, t)).toMatch(/CHECK\s*\(\s*\(variant_id IS NULL\)\s*!=\s*\(quote_id IS NULL\)\s*\)/);
    }
  });

  it("the owner-axis CHECK rejects both-set and neither-set, and the partial indexes enforce per-owner uniqueness", () => {
    const db = freshDb();
    db.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES ('lgq_ax', 'Q', 'life', '[\"life\"]')").run();
    const quoteId = (db.prepare("SELECT id FROM leadgen_quotes WHERE public_id='lgq_ax'").get() as { id: number }).id;
    db.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES ('lgf_ax', ?, 'F')").run(quoteId);
    const funnelId = (db.prepare("SELECT id FROM leadgen_funnels WHERE public_id='lgf_ax'").get() as { id: number }).id;
    db.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES ('lgn_ax', ?)").run(funnelId);
    const variantId = (db.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id='lgn_ax'").get() as { id: number }).id;

    // quote-owned page — valid
    db.prepare("INSERT INTO leadgen_funnel_pages (public_id, variant_id, quote_id, position) VALUES ('lgpg_q', NULL, ?, 0)").run(quoteId);
    // variant-owned page — valid
    db.prepare("INSERT INTO leadgen_funnel_pages (public_id, variant_id, quote_id, position) VALUES ('lgpg_v', ?, NULL, 0)").run(variantId);
    // both set — rejected by CHECK
    expect(() =>
      db.prepare("INSERT INTO leadgen_funnel_pages (public_id, variant_id, quote_id, position) VALUES ('lgpg_both', ?, ?, 1)").run(variantId, quoteId),
    ).toThrow(/CHECK/i);
    // neither set — rejected by CHECK
    expect(() =>
      db.prepare("INSERT INTO leadgen_funnel_pages (public_id, variant_id, quote_id, position) VALUES ('lgpg_none', NULL, NULL, 1)").run(),
    ).toThrow(/CHECK/i);
    // duplicate (quote_id, position) — rejected by the quote partial index
    expect(() =>
      db.prepare("INSERT INTO leadgen_funnel_pages (public_id, variant_id, quote_id, position) VALUES ('lgpg_q2', NULL, ?, 0)").run(quoteId),
    ).toThrow(/UNIQUE/i);
    // same position under the VARIANT owner — accepted (distinct partial index)
    db.prepare("INSERT INTO leadgen_funnel_pages (public_id, variant_id, quote_id, position) VALUES ('lgpg_v2', ?, NULL, 1)").run(variantId);
  });
});

describeDb("M3 — quote routing rules, funnel_rules CHECK, outcomes recreation, D2 migration", () => {
  it("leadgen_quote_routing_rules has the contract columns, index, and CHECKs", () => {
    const db = freshDb();
    const cols = columns(db, "leadgen_quote_routing_rules");
    for (const c of [
      "id", "public_id", "quote_id", "rule_name", "priority", "status", "match_mode",
      "conditions_json", "conditions_hash", "checkpoint_page", "target_funnel_id",
      "feed_name", "value_multiplier", "redirect_pct", "target_offer_id", "redirect_url",
      "redirect_url_allowlisted", "created_at",
    ]) {
      expect(cols.has(c), `missing column ${c}`).toBe(true);
    }
    expect(indexNames(db, "leadgen_quote_routing_rules").has("idx_lg_quote_routing_rules_quote")).toBe(true);
    db.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES ('lgq_qr', 'Q', 'life', '[\"life\"]')").run();
    const quoteId = (db.prepare("SELECT id FROM leadgen_quotes WHERE public_id='lgq_qr'").get() as { id: number }).id;
    const ins = (pub: string, col: string, val: string) =>
      db.prepare(
        `INSERT INTO leadgen_quote_routing_rules (public_id, quote_id, rule_name, conditions_json, conditions_hash, ${col}) VALUES (?, ?, 'R', '{}', 'h', ${val})`,
      ).run(pub, quoteId);
    ins("lgqr_ok", "feed_name", "'good_feed-1'");
    expect(() => ins("lgqr_badfeed", "feed_name", "'bad feed!'")).toThrow(/CHECK/i);
    expect(() => ins("lgqr_badpct", "redirect_pct", "150")).toThrow(/CHECK/i);
    expect(() => ins("lgqr_badstatus", "status", "'paused'")).toThrow(/CHECK/i);
  });

  it("leadgen_funnel_rules CHECK rejects route_funnel_variant/skip_section/show_section and accepts the four auction types", () => {
    const db = freshDb();
    db.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES ('lgq_fr', 'Q', 'life', '[\"life\"]')").run();
    const quoteId = (db.prepare("SELECT id FROM leadgen_quotes WHERE public_id='lgq_fr'").get() as { id: number }).id;
    db.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES ('lgf_fr', ?, 'F')").run(quoteId);
    const funnelId = (db.prepare("SELECT id FROM leadgen_funnels WHERE public_id='lgf_fr'").get() as { id: number }).id;
    db.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES ('lgn_fr', ?)").run(funnelId);
    const variantId = (db.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id='lgn_fr'").get() as { id: number }).id;
    const insertRule = (pub: string, ruleType: string) =>
      db.prepare("INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash) VALUES (?, ?, ?, '{}', 'h')").run(pub, variantId, ruleType);
    for (const rt of ["eligibility", "disqualification", "auction_entry", "redirect_direct_offer"]) {
      expect(() => insertRule(`lgfr_${rt}`, rt), `${rt} should be accepted`).not.toThrow();
    }
    for (const rt of ["route_funnel_variant", "skip_section", "show_section"]) {
      expect(() => insertRule(`lgfr_bad_${rt}`, rt), `${rt} should be rejected`).toThrow(/CHECK/i);
    }
  });

  it("leadgen_routing_outcomes has routed_to_funnel (NOT NULL) + feed_name + nullable routed_from_variant/routed_to_variant", () => {
    const db = freshDb();
    const cols = columns(db, "leadgen_routing_outcomes");
    expect(cols.has("routed_to_funnel")).toBe(true);
    expect(cols.get("routed_to_funnel")!.notnull).toBe(1);
    expect(cols.has("feed_name")).toBe(true);
    expect(cols.get("routed_from_variant")!.notnull).toBe(0);
    expect(cols.get("routed_to_variant")!.notnull).toBe(0);
    // an entry-plane row with no variants yet is now insertable
    db.prepare(
      "INSERT INTO leadgen_routing_outcomes (funnel_attempt_id, session_id, routed_from_variant, routed_to_variant, routed_to_funnel, matched_rule_hash, feed_name, plane) VALUES ('att_e', 'sess_e', NULL, NULL, 'lgf_x', 'h', 'my_feed', 'entry')",
    ).run();
    const row = db.prepare("SELECT routed_to_funnel, feed_name, routed_from_variant FROM leadgen_routing_outcomes WHERE funnel_attempt_id='att_e'").get() as {
      routed_to_funnel: string;
      feed_name: string;
      routed_from_variant: string | null;
    };
    expect(row.routed_to_funnel).toBe("lgf_x");
    expect(row.feed_name).toBe("my_feed");
    expect(row.routed_from_variant).toBeNull();
  });

  it("D2: the route_funnel_variant rule migrates to leadgen_quote_routing_rules with target = owning funnel, fields intact; the fixture graph survives with ids preserved", () => {
    const { db, quoteId, funnelId, variantId, routeRuleId } = seedThenMigrate();

    // route rule migrated
    const migrated = db.prepare("SELECT * FROM leadgen_quote_routing_rules").all() as Array<Record<string, unknown>>;
    expect(migrated).toHaveLength(1);
    const m = migrated[0]!;
    expect(m.rule_name).toBe(`Migrated rule ${routeRuleId}`);
    expect(m.quote_id).toBe(quoteId);
    expect(m.target_funnel_id).toBe(funnelId); // target = owning funnel (behavior-neutral)
    expect(m.priority).toBe(7);
    expect(m.value_multiplier).toBe(1.5);
    expect(m.redirect_pct).toBe(50);
    expect(m.conditions_hash).toBe("hash_route");
    expect(m.status).toBe("active");
    expect(m.feed_name).toBeNull();
    expect(String(m.public_id)).toMatch(/^lgqr_[0-9A-F]{26}$/);

    // route rule GONE from leadgen_funnel_rules; auction rule SURVIVES
    const remaining = db.prepare("SELECT rule_type, public_id FROM leadgen_funnel_rules ORDER BY public_id").all() as Array<{ rule_type: string; public_id: string }>;
    expect(remaining).toEqual([{ rule_type: "disqualification", public_id: "lgfr_dq" }]);

    // ids preserved across the recreations
    expect((db.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id='lgn_rw1'").get() as { id: number }).id).toBe(variantId);
    expect(!!db.prepare("SELECT 1 FROM leadgen_funnel_pages WHERE public_id='lgpg_rw1'").get()).toBe(true);

    // outcomes recreated + backfilled from the served variant's funnel
    const outcome = db.prepare("SELECT routed_to_funnel, feed_name, routed_from_variant FROM leadgen_routing_outcomes WHERE funnel_attempt_id='att_rw1'").get() as {
      routed_to_funnel: string;
      feed_name: string | null;
      routed_from_variant: string | null;
    };
    expect(outcome.routed_to_funnel).toBe("lgf_rw1"); // derived via variant→funnel join
    expect(outcome.feed_name).toBeNull();
    expect(outcome.routed_from_variant).toBe("lgn_rw1");
  });

  // P2-2 (adversarial-review fix round): 0048's step-2 INSERT…SELECT (the D2
  // migration) commits as an ordinary auto-committing statement — no implicit
  // transaction spans the whole file — so if the skip/show guard trips LATER
  // in the same apply attempt, step 2's effects are NOT rolled back. A
  // byte-identical re-application of 0048 (after the operator removes the
  // blocking skip/show rows) must not re-insert a second copy of an
  // already-migrated rule. Fail-before/pass-after against the ACTUAL file on
  // disk (not a simulation): this test would show 2 rows without the fix in
  // 0048 (the NOT EXISTS guard on the D2 INSERT + IF NOT EXISTS on the new
  // table/index/guard-table) and shows exactly 1 with it.
  it("retry safety: a route_funnel_variant rule + a skip_section rule ⇒ 0048 aborts (guard trips) with the route rule already migrated; after the skip row is removed, RE-APPLYING THE SAME FILE succeeds with EXACTLY ONE migrated rule (no duplicate)", () => {
    const db = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
    const files = migrationFiles();
    const idx = files.indexOf(M3_FILE);
    applyFiles(db, files.slice(0, idx)); // through 0047 — route_funnel_variant still valid here

    db.prepare(
      "INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES ('lgq_retry', 'Retry Q', 'life', '[\"life\"]', 'active')",
    ).run();
    const quoteId = (db.prepare("SELECT id FROM leadgen_quotes WHERE public_id = 'lgq_retry'").get() as { id: number }).id;
    db.prepare(
      "INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status) VALUES ('lgf_retry', ?, 'Retry F', 'active')",
    ).run(quoteId);
    const funnelId = (db.prepare("SELECT id FROM leadgen_funnels WHERE public_id = 'lgf_retry'").get() as { id: number }).id;
    db.prepare(
      "INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES ('lgn_retry', ?)",
    ).run(funnelId);
    const variantId = (db.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = 'lgn_retry'").get() as { id: number }).id;

    // the rule to be migrated (D2)
    db.prepare(
      "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority) VALUES ('lgfr_retry_route', ?, 'route_funnel_variant', '{}', 'h_retry', 5)",
    ).run(variantId);
    const routeRuleId = (db.prepare("SELECT id FROM leadgen_funnel_rules WHERE public_id = 'lgfr_retry_route'").get() as { id: number }).id;
    // the rule that trips the guard
    db.prepare(
      "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash) VALUES ('lgfr_retry_skip', ?, 'skip_section', '{}', 'h_skip')",
    ).run(variantId);

    const sql0048 = readFileSync(join(MIGRATIONS_DIR, M3_FILE), "utf8");

    // Attempt 1: skip row present ⇒ the guard must trip (migration aborts).
    expect(() => runSql(db, sql0048)).toThrow(/CHECK constraint failed/i);
    // Step 2 already committed before the guard ran — exactly one migrated row exists.
    expect((db.prepare("SELECT COUNT(*) AS n FROM leadgen_quote_routing_rules").get() as { n: number }).n).toBe(1);

    // Operator clears the blocker.
    db.prepare("DELETE FROM leadgen_funnel_rules WHERE public_id = 'lgfr_retry_skip'").run();

    // Attempt 2: RE-APPLY THE SAME FILE TEXT, unmodified, byte-identical.
    expect(() => runSql(db, sql0048)).not.toThrow();

    const migrated = db.prepare("SELECT public_id, rule_name, quote_id, target_funnel_id FROM leadgen_quote_routing_rules").all() as Array<{
      public_id: string;
      rule_name: string;
      quote_id: number;
      target_funnel_id: number;
    }>;
    expect(migrated).toHaveLength(1); // NOT 2 — the retry did not duplicate
    expect(migrated[0]!.rule_name).toBe(`Migrated rule ${routeRuleId}`);
    expect(migrated[0]!.quote_id).toBe(quoteId);
    expect(migrated[0]!.target_funnel_id).toBe(funnelId);

    // The rest of the file also completed on the successful retry (the guard
    // no longer blocks steps (4)-(5)).
    expect(tableSql(db, "leadgen_funnel_rules")).toMatch(
      /rule_type TEXT NOT NULL CHECK \(rule_type IN \('eligibility','disqualification','auction_entry','redirect_direct_offer'\)\)/,
    );
  });
});

describeDb("M4 — default funnel + board order backfill", () => {
  it("quotes.default_funnel_id + funnels.display_order exist and backfill behavior-neutrally", () => {
    const { db, quoteId, funnelId } = seedThenMigrate();
    expect(columns(db, "leadgen_quotes").has("default_funnel_id")).toBe(true);
    expect(columns(db, "leadgen_funnels").has("display_order")).toBe(true);
    const q = db.prepare("SELECT default_funnel_id FROM leadgen_quotes WHERE id=?").get(quoteId) as { default_funnel_id: number | null };
    expect(q.default_funnel_id).toBe(funnelId); // the (only) active funnel
    const f = db.prepare("SELECT display_order FROM leadgen_funnels WHERE id=?").get(funnelId) as { display_order: number };
    expect(f.display_order).toBe(funnelId); // backfilled = id
  });
});

describeDb("M5 — frame templates seed", () => {
  it("seeds exactly 6 templates with at most one default and a unique-default index", () => {
    const db = freshDb();
    const n = (db.prepare("SELECT COUNT(*) AS n FROM leadgen_frame_templates").get() as { n: number }).n;
    expect(n).toBe(6);
    const defaults = (db.prepare("SELECT COUNT(*) AS n FROM leadgen_frame_templates WHERE is_default=1").get() as { n: number }).n;
    expect(defaults).toBeLessThanOrEqual(1);
    expect(indexNames(db, "leadgen_frame_templates").has("uq_lg_frame_templates_default")).toBe(true);
    // a second default is rejected by the partial unique index
    expect(() =>
      db.prepare("INSERT INTO leadgen_frame_templates (public_id, name, frame_json, is_default) VALUES ('lgft_dup', 'Another default', '{}', 1)").run(),
    ).toThrow(/UNIQUE/i);
  });

  it("each seeded frame_json parses and deep-equals the live FRAME_TEMPLATES[id].defaults (byte-faithful, drift-proof)", () => {
    const db = freshDb();
    const rows = db.prepare("SELECT name, frame_json FROM leadgen_frame_templates ORDER BY id").all() as Array<{ name: string; frame_json: string }>;
    expect(rows).toHaveLength(6);
    const seenTemplateIds = new Set<string>();
    for (const row of rows) {
      const parsed = JSON.parse(row.frame_json) as { template: keyof typeof FRAME_TEMPLATES };
      const templateId = parsed.template;
      expect(FRAME_TEMPLATES[templateId], `unknown template id ${String(templateId)}`).toBeTruthy();
      expect(parsed).toEqual(FRAME_TEMPLATES[templateId].defaults);
      expect(row.name).toBe(FRAME_TEMPLATES[templateId].label);
      seenTemplateIds.add(String(templateId));
    }
    // all six built-ins present exactly once
    expect(seenTemplateIds).toEqual(new Set(Object.keys(FRAME_TEMPLATES)));
  });

  it("funnels + funnel_variants gain a nullable frame_template_id", () => {
    const db = freshDb();
    expect(columns(db, "leadgen_funnels").get("frame_template_id")?.notnull).toBe(0);
    expect(columns(db, "leadgen_funnel_variants").get("frame_template_id")?.notnull).toBe(0);
  });
});
