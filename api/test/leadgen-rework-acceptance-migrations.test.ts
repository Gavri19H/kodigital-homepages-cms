// LEADGEN-REWORK-03 — P6 acceptance (slice S6.1b): the §11 "Migrations" row as
// an EXECUTABLE terminal record. No browser is needed — every §11 Migrations
// clause is a data invariant over real SQL, so this lives in a vitest node:sqlite
// harness (the same DatabaseSync engine the P1 migration suites use), NOT a third
// Playwright spec. REAL SQL execution against the ACTUAL migration files on disk;
// no JS mock of SQL, no fabricated report text.
//
// The §11 bullet: "M6/M7/M9/M12 each: before/after report generated;
// field-universe + answer-map invariants hold; affected-section lists delivered."
// The slice also proves the structural terminal clauses the acceptance record
// must roll up: field-universe equality via collectKnownAnswerFields, answer-map
// count invariance, ids preserved, is_default uniqueness, rules CHECK 4-type
// tightening.
//
// This suite COMPLEMENTS — never re-litigates — the P1 mechanism proofs. Each
// clause cites the deeper P1 test it stands on:
//   • test/leadgen-rework-migrations.test.ts   — the whole-chain M1–M5 structural
//     proofs + the D2 route-rule migration/id-preservation (freshDb/seedThenMigrate).
//   • test/leadgen-rework-content-migrations.test.ts — the per-node M6/M7/M9/M12
//     content transforms + the frozen pre-removal projected universes + content_html
//     invalidation.
// What is NET-NEW here (proven by NO P1 test): the report GENERATOR itself
// (generateReportFromFixtures) — the §11 "before/after report generated;
// affected-section lists delivered" clause, executed.
//
// node:sqlite lands in Node ≥ 22.5; on older Node the whole suite skips exactly
// like every sibling migration suite (describeDb).

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { collectKnownAnswerFields } from "../src/public/leadgen/components/content-schema";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import {
  loadDatabaseSync,
  createSectionsDb,
  insertFixtureSection,
  insertFixtureAnswerMap,
  applyMigrationFile,
  answerMapCount,
  projectedFieldUniverse,
  topLevelTargetSections,
  migrationSpec,
  generateReportFromFixtures,
  MIGRATIONS_DIR,
  FIXTURE_SECTIONS,
  FIXTURE_ANSWER_MAPS,
  type SqliteDb,
  type DatabaseSyncCtor,
} from "../src/scripts/leadgen-rework-migration-report";

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

const CONTENT_KEYS = ["m6", "m7", "m9", "m12"] as const;

// The FROZEN pre-migration PROJECTED field universes — the exact values the
// shipped collectKnownAnswerFields(components.flatMap(expandPublicComponents))
// returned on the PRE-migration fixtures, transcribed from
// test/leadgen-rework-content-migrations.test.ts PRE_REMOVAL_PROJECTED_UNIVERSE
// (§10 removed the extinct-type expansion, so the pre-migration universe can no
// longer be recomputed live — it is frozen). Re-confirmed byte-for-byte this
// slice by running projectedFieldUniverse on the POST-migration content of a
// fresh fixture DB (the values below === the live post-migration universe, which
// IS the invariant: after == frozen == before ⇒ no answer field lost).
const FROZEN_PROJECTED_UNIVERSE: Readonly<Record<number, readonly string[]>> = {
  601: ["grade", "homeowner", "m6a_cont", "m6a_grid::grade", "m6a_grid::homeowner", "m6a_grid::married", "m6a_head", "m6a_prequal", "married", "prequal"],
  602: ["insured", "m6b_grid::insured", "m6b_grid::owner", "owner"],
  701: ["age", "loan", "m7_c", "m7_n", "m7_r", "years"],
  901: ["home_city", "home_zip", "m9_a1", "m9_a1_state", "m9_a1_street", "m9_a2", "m9_a2_city", "m9_a2_state", "m9_a2_street", "m9_a2_zip"],
  1201: ["insurer", "m12c_ins"],
  1202: ["color", "m12d_col"],
};

// A fresh sections DB with the golden fixtures loaded (the report module's own
// harness — leadgen_sections + leadgen_section_answer_maps only).
function freshSectionsDb(): SqliteDb {
  const db = createSectionsDb(DatabaseSync as DatabaseSyncCtor);
  for (const s of FIXTURE_SECTIONS) insertFixtureSection(db, s);
  FIXTURE_ANSWER_MAPS.forEach((m, i) => insertFixtureAnswerMap(db, m, i));
  return db;
}

function contentComponents(db: SqliteDb, id: number): LeadgenComponentNode[] {
  const cj = (db.prepare("SELECT content_json AS c FROM leadgen_sections WHERE id = ?").get(id) as { c: string }).c;
  return (JSON.parse(cj) as { components: LeadgenComponentNode[] }).components;
}
function rawJson(db: SqliteDb, id: number): string {
  return (db.prepare("SELECT content_json AS c FROM leadgen_sections WHERE id = ?").get(id) as { c: string }).c;
}

// Extract ONLY the per-section-invariants table's data rows (the "## Per-section
// invariants" section, up to the next "## " heading) — the affected-sections
// table above it also has `| <id> |` rows but different columns.
function perSectionInvariantRows(md: string): string[] {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith("## Per-section invariants"));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  const table = end < 0 ? rest : rest.slice(0, end);
  return table.filter((l) => /^\|\s*\d+\s*\|/.test(l));
}

// ===========================================================================
// §11 Migrations clause 1 — "before/after report generated; affected-section
// lists delivered". The report GENERATOR is the net-new terminal artifact (no
// P1 test exercises it). Assert its structure + the answer-map invariant column
// it computes, per migration.
// ===========================================================================
describeDb("§11 Migrations — before/after report generated for M6/M7/M9/M12", () => {
  it.each(CONTENT_KEYS)("%s — the generated report carries the file, the affected-section list, and the per-section invariants table", (key) => {
    const spec = migrationSpec(key);
    // The affected-section list the report must deliver = the migration's OWN
    // top-level WHERE match set (computed against the same fixture corpus).
    const probe = freshSectionsDb();
    const affected = topLevelTargetSections(probe, spec);
    probe.close();
    expect(affected.length, `${key}: the fixture corpus must exercise this migration`).toBeGreaterThan(0);

    const md = generateReportFromFixtures(DatabaseSync as DatabaseSyncCtor, spec);

    // before/after report structure (buildReport contract).
    expect(md).toContain(`# Migration report — ${spec.title}`);
    expect(md).toContain(`migrations/${spec.file}`);
    expect(md).toContain(`## Affected sections (${affected.length})`);
    expect(md).toContain("nodes before→after"); // the before→after node-count column header
    expect(md).toContain("## Per-section invariants");
    expect(md).toContain("projected FU diff (must be empty)");
    // affected-section list delivered: every affected id has its own report row.
    for (const id of affected) {
      expect(md, `${key}: affected section ${id} must appear in the report table`).toMatch(new RegExp(`\\|\\s*${id}\\s*\\|`));
    }
  });

  it.each(CONTENT_KEYS)("%s — the report's answer-map before→after column is EQUAL for every affected section (invariant held)", (key) => {
    const spec = migrationSpec(key);
    const md = generateReportFromFixtures(DatabaseSync as DatabaseSyncCtor, spec);
    // The per-section-invariants table's final column is `${before}→${after}`.
    // Parse every `| <id> | … | N→M |` data row and require N === M.
    const rows = perSectionInvariantRows(md);
    expect(rows.length, `${key}: at least one affected-section invariant row`).toBeGreaterThan(0);
    let checkedMapCol = 0;
    for (const row of rows) {
      const pairs = [...row.matchAll(/(\d+)→(\d+)/g)];
      // The LAST before→after pair on the row is the answer-map column (the
      // node-count column is earlier and MAY legitimately change; the answer-map
      // column must not).
      const mapPair = pairs[pairs.length - 1];
      expect(mapPair, `${key}: row must carry a before→after answer-map cell: ${row}`).toBeTruthy();
      expect(mapPair![1], `${key}: answer-map rows before→after must be equal (${row})`).toBe(mapPair![2]);
      checkedMapCol += 1;
    }
    expect(checkedMapCol).toBeGreaterThan(0);
  });

  it("M6 — the report surfaces the grid-node-id → per-row-id retirement note (the raw diff is transparency, the projected universe is preserved — proven directly below)", () => {
    // Own-hand-verified this slice: because §10 deleted the grid expansion, the
    // report cannot RE-EXPAND pre-migration grid content, so M6's projected-FU
    // column shows the grid-node-id retirement rather than "∅ (empty)" (unlike
    // M7/M9/M12). The report documents exactly this; the field-universe EQUALITY
    // is proven on the live post-migration content in the next describe.
    const md = generateReportFromFixtures(DatabaseSync as DatabaseSyncCtor, migrationSpec("m6"));
    expect(md).toContain("m6a_grid"); // the retired grid node-id named in the diff
    expect(md).toContain("The **projected** diff is empty, confirming the runtime field universe is preserved.");
  });

  it.each(["m7", "m9", "m12"] as const)("%s — the report's projected-FU diff is ∅ (empty) for every affected section", (key) => {
    // These three rewrite live, catalog-known node shapes, so the report CAN
    // recompute the pre-migration projected universe and shows it unchanged.
    const spec = migrationSpec(key);
    const md = generateReportFromFixtures(DatabaseSync as DatabaseSyncCtor, spec);
    const invRows = perSectionInvariantRows(md);
    expect(invRows.length, `${key}: at least one invariant row`).toBeGreaterThan(0);
    for (const row of invRows) {
      expect(row, `${key}: projected FU diff must be empty in the report (${row})`).toContain("∅ (empty)");
    }
  });
});

// ===========================================================================
// §11 Migrations clause 2 — "field-universe + answer-map invariants hold",
// proven on the LIVE post-migration content via collectKnownAnswerFields
// (the M6 §5 post-check operator) + answer-map count invariance.
// Complements test/leadgen-rework-content-migrations.test.ts (per-node transform).
// ===========================================================================
describeDb("§11 Migrations — field-universe equality (collectKnownAnswerFields) + answer-map count invariance", () => {
  it.each(CONTENT_KEYS)("%s — every affected section's projected universe == the frozen pre-migration universe; answer-map count unchanged", (key) => {
    const spec = migrationSpec(key);
    const db = freshSectionsDb();
    const affected = topLevelTargetSections(db, spec);
    expect(affected.length).toBeGreaterThan(0);
    const beforeCounts = new Map(affected.map((id) => [id, answerMapCount(db, id)]));

    applyMigrationFile(db, spec.file);

    for (const id of affected) {
      const expected = FROZEN_PROJECTED_UNIVERSE[id];
      expect(expected, `${key}: section ${id} must have a frozen pre-migration universe`).toBeTruthy();
      // projectedFieldUniverse = [...collectKnownAnswerFields(comps.flatMap(expandPublicComponents))].sort()
      // — the exact §5 post-check. after == frozen == before ⇒ no answer field lost.
      expect(projectedFieldUniverse(rawJson(db, id)), `${key}: section ${id} projected field universe preserved`).toEqual([...expected!]);
      // answer-map row count invariant (the migrations never touch leadgen_section_answer_maps).
      expect(answerMapCount(db, id), `${key}: section ${id} answer-map count invariant`).toBe(beforeCounts.get(id)!);
    }
    db.close();
  });

  it("collectKnownAnswerFields is the named operator: on a post-migration non-expanding section it equals the projected universe (M12 §1202)", () => {
    // Name collectKnownAnswerFields directly (projectedFieldUniverse wraps it):
    // for a post-M12 section of only catalog-known, non-expanding types, the raw
    // walk equals the projected universe — the operator the §5 invariant cites.
    const db = freshSectionsDb();
    applyMigrationFile(db, migrationSpec("m12").file);
    const direct = [...collectKnownAnswerFields(contentComponents(db, 1202))].sort();
    expect(direct).toEqual([...FROZEN_PROJECTED_UNIVERSE[1202]!]);
    expect(direct).toEqual(projectedFieldUniverse(rawJson(db, 1202)));
    db.close();
  });
});

// ===========================================================================
// §11 Migrations clause 3 — structural terminal invariants on a LIVE
// FULLY-MIGRATED local DB (the whole 0001→latest chain, the db:migrate:local /
// production apply path). Reuses the P1 whole-chain harness pattern
// (test/leadgen-rework-migrations.test.ts) — cited per clause.
// ===========================================================================
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();
}
function runSql(db: SqliteDb, sql: string): void {
  (db["exec"] as (s: string) => void)(sql);
}
function applyFiles(db: SqliteDb, files: readonly string[]): void {
  for (const f of files) runSql(db, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
}
// A fresh in-memory DB with the ENTIRE migration chain applied (no fixtures).
function fullyMigratedDb(): SqliteDb {
  const db = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  applyFiles(db, migrationFiles());
  return db;
}
function indexNames(db: SqliteDb, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}
function tableSql(db: SqliteDb, table: string): string {
  return (db.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(table) as { sql: string }).sql;
}

const M3_FILE = "0048_leadgen_rework_m3_routing.sql";

describeDb("§11 Migrations — structural invariants on the fully-migrated chain", () => {
  it("M3 — leadgen_funnel_rules CHECK is tightened to EXACTLY the four auction types (route_funnel_variant/skip_section/show_section rejected)", () => {
    // Complements test/leadgen-rework-migrations.test.ts "leadgen_funnel_rules
    // CHECK rejects route_funnel_variant/skip_section/show_section and accepts
    // the four auction types" — re-asserted here as the terminal §11 record.
    const db = fullyMigratedDb();
    db.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES ('lgq_acc_fr', 'Q', 'life', '[\"life\"]')").run();
    const quoteId = (db.prepare("SELECT id FROM leadgen_quotes WHERE public_id='lgq_acc_fr'").get() as { id: number }).id;
    db.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES ('lgf_acc_fr', ?, 'F')").run(quoteId);
    const funnelId = (db.prepare("SELECT id FROM leadgen_funnels WHERE public_id='lgf_acc_fr'").get() as { id: number }).id;
    db.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES ('lgn_acc_fr', ?)").run(funnelId);
    const variantId = (db.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id='lgn_acc_fr'").get() as { id: number }).id;
    const insertRule = (pub: string, ruleType: string) =>
      db.prepare("INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash) VALUES (?, ?, ?, '{}', 'h')").run(pub, variantId, ruleType);

    for (const rt of ["eligibility", "disqualification", "auction_entry", "redirect_direct_offer"]) {
      expect(() => insertRule(`lgfr_acc_${rt}`, rt), `${rt} accepted`).not.toThrow();
    }
    for (const rt of ["route_funnel_variant", "skip_section", "show_section"]) {
      expect(() => insertRule(`lgfr_acc_bad_${rt}`, rt), `${rt} rejected`).toThrow(/CHECK/i);
    }
    // The tightened CHECK text is present verbatim on the recreated table.
    expect(tableSql(db, "leadgen_funnel_rules")).toMatch(
      /rule_type TEXT NOT NULL CHECK \(rule_type IN \('eligibility','disqualification','auction_entry','redirect_direct_offer'\)\)/,
    );
    db.close();
  });

  it("M5 — leadgen_frame_templates seeds ≤1 default with a partial unique index (a second is_default=1 is rejected)", () => {
    // Complements test/leadgen-rework-migrations.test.ts "seeds exactly 6
    // templates with at most one default and a unique-default index".
    const db = fullyMigratedDb();
    const seeded = (db.prepare("SELECT COUNT(*) AS n FROM leadgen_frame_templates").get() as { n: number }).n;
    expect(seeded, "the six built-ins seed").toBe(6);
    const defaults = (db.prepare("SELECT COUNT(*) AS n FROM leadgen_frame_templates WHERE is_default=1").get() as { n: number }).n;
    expect(defaults, "at most one default").toBeLessThanOrEqual(1);
    expect(indexNames(db, "leadgen_frame_templates").has("uq_lg_frame_templates_default")).toBe(true);
    expect(() =>
      db.prepare("INSERT INTO leadgen_frame_templates (public_id, name, frame_json, is_default) VALUES ('lgft_acc_dup', 'Acc dup default', '{}', 1)").run(),
    ).toThrow(/UNIQUE/i);
    db.close();
  });

  it("D2 — a route_funnel_variant rule migrates to leadgen_quote_routing_rules (target = owning funnel) with the fixture graph's ids preserved", () => {
    // Complements test/leadgen-rework-migrations.test.ts "D2: the
    // route_funnel_variant rule migrates … with ids preserved". Seed the pre-M3
    // graph, apply 0048→latest, assert ids survive the recreations + the D2 target.
    const db = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
    const files = migrationFiles();
    const idx = files.indexOf(M3_FILE);
    expect(idx, "0048 present in the migrations dir").toBeGreaterThan(0);
    applyFiles(db, files.slice(0, idx)); // through 0047 — route_funnel_variant still a valid rule type

    db.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES ('lgq_acc_d2', 'Acc D2 Q', 'life', '[\"life\"]', 'active')").run();
    const quoteId = (db.prepare("SELECT id FROM leadgen_quotes WHERE public_id='lgq_acc_d2'").get() as { id: number }).id;
    db.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status) VALUES ('lgf_acc_d2', ?, 'Acc D2 F', 'active')").run(quoteId);
    const funnelId = (db.prepare("SELECT id FROM leadgen_funnels WHERE public_id='lgf_acc_d2'").get() as { id: number }).id;
    db.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES ('lgn_acc_d2', ?, 'A')").run(funnelId);
    const variantId = (db.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id='lgn_acc_d2'").get() as { id: number }).id;
    db.prepare("INSERT INTO leadgen_funnel_pages (public_id, variant_id, quote_id, position) VALUES ('lgpg_acc_d2', ?, NULL, 0)").run(variantId);
    db.prepare(
      "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, value_multiplier, redirect_pct, status) VALUES ('lgfr_acc_route', ?, 'route_funnel_variant', '{\"groups\":[]}', 'hash_acc_route', 7, 1.5, 50, 'active')",
    ).run(variantId);
    const routeRuleId = (db.prepare("SELECT id FROM leadgen_funnel_rules WHERE public_id='lgfr_acc_route'").get() as { id: number }).id;

    applyFiles(db, files.slice(idx)); // 0048 → latest (M3 recreations + everything after)

    const migrated = db.prepare("SELECT * FROM leadgen_quote_routing_rules").all() as Array<Record<string, unknown>>;
    expect(migrated, "exactly one migrated quote routing rule").toHaveLength(1);
    expect(migrated[0]!.quote_id, "migrated onto the owning quote").toBe(quoteId);
    expect(migrated[0]!.target_funnel_id, "target = the owning funnel (behavior-neutral)").toBe(funnelId);
    expect(migrated[0]!.rule_name).toBe(`Migrated rule ${routeRuleId}`);
    expect(migrated[0]!.value_multiplier).toBe(1.5);
    expect(migrated[0]!.redirect_pct).toBe(50);

    // ids preserved across the M2/M3 table recreations.
    expect((db.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id='lgn_acc_d2'").get() as { id: number }).id, "variant id preserved").toBe(variantId);
    expect(!!db.prepare("SELECT 1 FROM leadgen_funnel_pages WHERE public_id='lgpg_acc_d2'").get(), "page survives the recreation").toBe(true);
    // the route rule is GONE from leadgen_funnel_rules (moved to the quote table).
    expect(db.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_rules WHERE public_id='lgfr_acc_route'").get() as { n: number }).toEqual({ n: 0 });
    db.close();
  });
});
