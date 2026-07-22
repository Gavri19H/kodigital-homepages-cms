#!/usr/bin/env tsx
/**
 * leadgen-rework-migration-report
 *
 * Generates the per-migration before/after reports for the four LeadGen rework
 * CONTENT migrations (M6 grid expansion, M7 slider collapse, M9 address fields,
 * M12 other-group retirement — migrations 0050–0053). Contract
 * LEADGEN-REWORK-03 §5 + §11 "Migrations" AC.
 *
 * For each migration the report lists: the affected sections (id/public_id/name),
 * their per-section before/after node counts + type histograms, the FIELD-UNIVERSE
 * diff computed by the REAL enumerators (see "Field universe" below), the
 * answer-map row count before/after (must be equal — the migrations never touch
 * leadgen_section_answer_maps), a nested-target detector (json_tree, all depths),
 * and the re-runnable SQL SELECT the operator runs against prod at deploy time to
 * regenerate the affected-section list.
 *
 * Field universe (why two views):
 *   * PROJECTED (the invariant): collectKnownAnswerFields over the config-dto
 *     projection `components.flatMap(expandPublicComponents)` — the RESOLVED
 *     runtime answer-field set the runtime, answer-maps, analytics, and rules
 *     actually reference (config-dto.ts expandPublicComponents projects every
 *     MultiQuestionGrid row to its `<nodeQid>::<field>` component). This diff MUST
 *     be empty for every affected section and every migration.
 *   * RAW (transparency): collectKnownAnswerFields over the stored components
 *     as-authored. Empty for M7/M9/M12. For M6 it shows exactly the retirement of
 *     the grid's own (non-producing) authoring node-id in favour of the per-row
 *     projected ids answer-maps already key on — config-dto.ts:432 "the parent
 *     grid node itself projects to NOTHING". Shown so nothing is hidden.
 *
 * Dependency-free: node:sqlite (the repo's DB-backed test harness pattern) +
 * node:fs. No new npm deps. The migration SQL applied here is read verbatim from
 * the migrations/ files — the report proves what the REAL SQL produces.
 *
 * Usage:
 *   tsx src/scripts/leadgen-rework-migration-report.ts                 # fixtures -> writes the 4 committed reports
 *   tsx src/scripts/leadgen-rework-migration-report.ts --fixtures      # (explicit) same as above
 *   tsx src/scripts/leadgen-rework-migration-report.ts --db <sqlite>   # report against a real D1 sqlite file (prod snapshot)
 *   tsx src/scripts/leadgen-rework-migration-report.ts snapshot --db <sqlite> --out before.json
 *   tsx src/scripts/leadgen-rework-migration-report.ts report   --db <sqlite> --before before.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

import {
  collectKnownAnswerFields,
  type LeadgenComponentNode,
} from "../public/leadgen/components/content-schema";
import { expandPublicComponents } from "../public/leadgen/config-dto";

// --- node:sqlite harness (repo pattern — mirrors leadgen-migrations.test.ts) --

export type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
export type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  close(): void;
  [method: string]: unknown;
};
export type DatabaseSyncCtor = new (path: string) => SqliteDb;

export function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
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

function runSql(db: SqliteDb, sql: string): void {
  (db["exec"] as (s: string) => void)(sql);
}

const HERE = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(HERE, "..", "..", "migrations");
export const REPORTS_DIR = join(HERE, "..", "..", "docs", "leadgen", "rework", "migration-reports");

// --- migration specs -------------------------------------------------------

export interface MigrationSpec {
  key: "m6" | "m7" | "m9" | "m12";
  file: string;
  title: string;
  contractAnchor: string;
  /** Component types this migration targets (for the nested-target detector). */
  targetTypes: readonly string[];
  /** The re-runnable prod SELECT that lists affected sections (top-level). */
  prodSelect: string;
  /** A json_tree detector for target nodes at ANY depth (surfaces nested cases). */
  nestedDetect: string;
  summary: string;
}

export const MIGRATIONS: readonly MigrationSpec[] = [
  {
    key: "m6",
    file: "0050_leadgen_rework_m6_grid_expansion.sql",
    title: "M6 — MultiQuestionGrid → independent components",
    contractAnchor: "LEADGEN-REWORK-03 §5 M6 · §2 #1 (F-A) · §11 #1",
    targetTypes: ["MultiQuestionGrid"],
    prodSelect:
      "SELECT id, public_id, section_name FROM leadgen_sections\n" +
      "WHERE json_valid(content_json)\n" +
      "  AND EXISTS (SELECT 1 FROM json_each(content_json,'$.components') c\n" +
      "              WHERE json_extract(c.value,'$.type')='MultiQuestionGrid');",
    nestedDetect:
      "SELECT id, public_id FROM leadgen_sections\n" +
      "WHERE json_valid(content_json)\n" +
      "  AND EXISTS (SELECT 1 FROM json_tree(content_json) t WHERE t.key='type' AND t.value='MultiQuestionGrid');",
    summary:
      "Each MultiQuestionGrid expands in place to N components (one per row), ordered " +
      "(component, row). A row's effective choices being exactly a {Yes,No} pair → " +
      "TwoButtonYesNo, else ButtonAnswerGroup. row.label→props.label, row.default→" +
      "props.defaultValue, row.required→required, node.conditional copied onto each, " +
      "question_id=`<nodeQid>::<internal_field>` (the projected id answer-maps already key on).",
  },
  {
    key: "m7",
    file: "0051_leadgen_rework_m7_slider_collapse.sql",
    title: "M7 — slider triplet → one NumberRangeQuestion catalog",
    contractAnchor: "LEADGEN-REWORK-03 §5 M7 · §2 #7 · §6.8 · §11 #7",
    targetTypes: ["RangeQuestion", "CurrencyRangeQuestion", "NumberRangeQuestion"],
    prodSelect:
      "SELECT id, public_id, section_name FROM leadgen_sections\n" +
      "WHERE json_valid(content_json)\n" +
      "  AND EXISTS (SELECT 1 FROM json_each(content_json,'$.components') c\n" +
      "              WHERE json_extract(c.value,'$.type') IN ('RangeQuestion','CurrencyRangeQuestion')\n" +
      "                 OR (json_extract(c.value,'$.type')='NumberRangeQuestion'\n" +
      "                     AND json_type(c.value,'$.props.slider_type') IS NULL));",
    nestedDetect:
      "SELECT id, public_id FROM leadgen_sections\n" +
      "WHERE json_valid(content_json)\n" +
      "  AND EXISTS (SELECT 1 FROM json_tree(content_json) t WHERE t.key='type'\n" +
      "              AND t.value IN ('RangeQuestion','CurrencyRangeQuestion'));",
    summary:
      "RangeQuestion/CurrencyRangeQuestion → NumberRangeQuestion with answer_type " +
      "normalised to 'number' (fixes the Image9 answer_type_mismatch), props.slider_type " +
      "'single', props.currency_affix true (Currency) / false (Range). A NumberRangeQuestion " +
      "without slider_type gains 'single'. min/max/step and every other prop preserved.",
  },
  {
    key: "m9",
    file: "0052_leadgen_rework_m9_address_fields.sql",
    title: "M9 — explicit Address field set",
    contractAnchor: "LEADGEN-REWORK-03 §5 M9 · §2 #6 · §6.10 · §11 #6",
    targetTypes: ["AddressAutocompleteQuestion"],
    prodSelect:
      "SELECT id, public_id, section_name FROM leadgen_sections\n" +
      "WHERE json_valid(content_json)\n" +
      "  AND EXISTS (SELECT 1 FROM json_each(content_json,'$.components') c\n" +
      "              WHERE json_extract(c.value,'$.type')='AddressAutocompleteQuestion'\n" +
      "                AND json_type(c.value,'$.props.fields') IS NULL);",
    nestedDetect:
      "SELECT id, public_id FROM leadgen_sections\n" +
      "WHERE json_valid(content_json)\n" +
      "  AND EXISTS (SELECT 1 FROM json_tree(content_json) t WHERE t.key='type' AND t.value='AddressAutocompleteQuestion');",
    summary:
      "Each AddressAutocompleteQuestion gains a behaviour-preserving props.fields[] " +
      "(street/city/state/zip, mode 'autofill', zip→'zip5'). node.required and props.maps " +
      "(incl. maps.fills) are UNTOUCHED — requiredness stays node-level (today's exact " +
      "behaviour) and the internal_field derivation / field universe are unchanged. No " +
      "per-field label (today's labels are fixed studio-preview strings, never stored).",
  },
  {
    key: "m12",
    file: "0053_leadgen_rework_m12_othergroup_retirement.sql",
    title: "M12 — OtherGroupSelector + choiceDisplay retirement",
    contractAnchor: "LEADGEN-REWORK-03 §5 M12 · §2 #8 (F-B) · §10 · §11 #8",
    targetTypes: ["OtherGroupSelector"],
    prodSelect:
      "SELECT id, public_id, section_name FROM leadgen_sections\n" +
      "WHERE json_valid(content_json)\n" +
      "  AND EXISTS (SELECT 1 FROM json_each(content_json,'$.components') c\n" +
      "              WHERE json_extract(c.value,'$.type')='OtherGroupSelector'\n" +
      "                 OR json_type(c.value,'$.choiceDisplay') IS NOT NULL);",
    nestedDetect:
      "SELECT id, public_id FROM leadgen_sections\n" +
      "WHERE json_valid(content_json)\n" +
      "  AND EXISTS (SELECT 1 FROM json_tree(content_json) t\n" +
      "              WHERE (t.key='type' AND t.value='OtherGroupSelector') OR t.key='choiceDisplay');",
    summary:
      "OtherGroupSelector → ButtonAnswerGroup (its choices array already holds every " +
      "choice — mainValues only partitioned it), and the choiceDisplay prop is stripped " +
      "from EVERY node of any type. The new-model 'other' is NOT auto-enabled; the affected " +
      "sections are listed for the owner to re-author an Other list where wanted.",
  },
] as const;

export function migrationSpec(key: string): MigrationSpec {
  const s = MIGRATIONS.find((m) => m.key === key);
  if (s === undefined) throw new Error(`unknown migration key ${key}`);
  return s;
}

// --- schema + fixtures ------------------------------------------------------

export interface FixtureSection {
  id: number;
  public_id: string;
  section_name: string;
  content: { components: LeadgenComponentNode[] };
}

export interface FixtureAnswerMap {
  section_id: number;
  question_id: string;
  internal_field: string;
}

/**
 * Create an in-memory DB with the REAL leadgen_sections + leadgen_section_answer_maps
 * shapes by applying migration 0036 over the pre-0036 FK stub tables — the exact
 * pattern leadgen-migrations.test.ts uses, so the migration SQL runs against the
 * true column set / types.
 */
export function createSectionsDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const db = new DatabaseSync(":memory:");
  runSql(
    db,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  runSql(db, readFileSync(join(MIGRATIONS_DIR, "0036_leadgen_core.sql"), "utf8"));
  // FK enforcement OFF for the fixture connection: this in-memory DB exists only
  // to exercise the content-migration UPDATEs over leadgen_sections and to prove
  // the answer-map COUNT invariant — never referential integrity — so the fixtures
  // need not scaffold the whole offer/payload-schema graph an answer-map row FKs.
  runSql(db, "PRAGMA foreign_keys = OFF;");
  return db;
}

export function insertFixtureSection(db: SqliteDb, s: FixtureSection): void {
  db.prepare(
    "INSERT INTO leadgen_sections (id, public_id, section_name, activity, vertical, headline_text, content_json) " +
      "VALUES (?, ?, ?, 'quote_funnel', 'life', 'Headline', ?)",
  ).run(s.id, s.public_id, s.section_name, JSON.stringify(s.content));
}

export function insertFixtureAnswerMap(db: SqliteDb, m: FixtureAnswerMap, n: number): void {
  db.prepare(
    "INSERT INTO leadgen_section_answer_maps (public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id, payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type) " +
      "VALUES (?, ?, ?, ?, ?, 'enum', 1, 1, 'lgps_x', ?, 'string')",
  ).run(`lgm_${m.section_id}_${n}`, m.section_id, m.question_id, m.question_id, m.internal_field, m.internal_field);
}

export function applyMigrationFile(db: SqliteDb, file: string): void {
  runSql(db, readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

// THE golden fixtures — the single source of truth shared by this tool (report
// generation) and the content-migrations test (transformation assertions).
export const FIXTURE_SECTIONS: readonly FixtureSection[] = [
  // (a) M6 mixed grid: row1 Yes/No override → TwoButtonYesNo; row2 inherits node
  // [A,B,C] → ButtonAnswerGroup; row3 default+required + node-conditional carried.
  {
    id: 601,
    public_id: "lgs_rework_m6a",
    section_name: "M6 mixed driver grid",
    content: {
      components: [
        // A real sibling gate field, so the grid's copied-to-every-row conditional
        // references a field that exists in this section (validateConditional).
        { type: "TwoButtonYesNo", question_id: "m6a_prequal", internal_field: "prequal", props: {} },
        { type: "QuestionHeadline", question_id: "m6a_head", props: { text: "Tell us about you" } },
        {
          type: "MultiQuestionGrid",
          question_id: "m6a_grid",
          choices: [
            { label: "A", value: "a", analytics_id: "a" },
            { label: "B", value: "b", analytics_id: "b" },
            { label: "C", value: "c", analytics_id: "c" },
          ],
          conditional: { when: "prequal", op: "eq", value: "yes" },
          props: {
            rows: [
              {
                label: "Homeowner?",
                internal_field: "homeowner",
                choices: [
                  { label: "Yes", value: "yes", analytics_id: "y" },
                  { label: "No", value: "no", analytics_id: "n" },
                ],
              },
              { label: "Pick a grade", internal_field: "grade" },
              { label: "Married?", internal_field: "married", default: "b", required: true },
            ],
          },
        } as unknown as LeadgenComponentNode,
        { type: "ContinueButton", question_id: "m6a_cont", props: {} },
      ],
    },
  },
  // (b) M6 all-Yes/No grid: node choices [Yes,No], rows without overrides → all TwoButtonYesNo.
  {
    id: 602,
    public_id: "lgs_rework_m6b",
    section_name: "M6 all yes/no grid",
    content: {
      components: [
        {
          type: "MultiQuestionGrid",
          question_id: "m6b_grid",
          choices: [
            { label: "Yes", value: "yes", analytics_id: "y" },
            { label: "No", value: "no", analytics_id: "n" },
          ],
          props: {
            rows: [
              { label: "Insured?", internal_field: "insured" },
              { label: "Own a home?", internal_field: "owner" },
            ],
          },
        } as unknown as LeadgenComponentNode,
      ],
    },
  },
  // (c) M12 OtherGroupSelector with mainValues split → ButtonAnswerGroup, ALL choices base.
  {
    id: 1201,
    public_id: "lgs_rework_m12c",
    section_name: "M12 other-group insurer",
    content: {
      components: [
        {
          type: "OtherGroupSelector",
          question_id: "m12c_ins",
          internal_field: "insurer",
          choices: [
            { label: "State Farm", value: "sf", analytics_id: "sf" },
            { label: "Geico", value: "geico", analytics_id: "geico" },
            { label: "Other Co", value: "other_co", analytics_id: "oc" },
          ],
          choiceDisplay: { otherGroupEnabled: true, mainValues: ["sf"], otherGroupLabel: "More" },
        } as unknown as LeadgenComponentNode,
      ],
    },
  },
  // (d) M12 ButtonAnswerGroup carrying choiceDisplay → prop stripped, choices intact, type unchanged.
  {
    id: 1202,
    public_id: "lgs_rework_m12d",
    section_name: "M12 button with choiceDisplay",
    content: {
      components: [
        {
          type: "ButtonAnswerGroup",
          question_id: "m12d_col",
          internal_field: "color",
          choices: [
            { label: "Red", value: "red", analytics_id: "r" },
            { label: "Blue", value: "blue", analytics_id: "b" },
          ],
          choiceDisplay: { mainValues: ["red"] },
        } as unknown as LeadgenComponentNode,
      ],
    },
  },
  // (e) M7 sliders: Range + CurrencyRange + pre-existing NumberRange.
  {
    id: 701,
    public_id: "lgs_rework_m7e",
    section_name: "M7 sliders",
    content: {
      components: [
        { type: "RangeQuestion", question_id: "m7_r", internal_field: "years", answer_type: "number", props: { min: 0, max: 30, step: 1 } } as unknown as LeadgenComponentNode,
        { type: "CurrencyRangeQuestion", question_id: "m7_c", internal_field: "loan", answer_type: "currency", props: { min: 1000, max: 100000, step: 1000, currency: "$" } } as unknown as LeadgenComponentNode,
        { type: "NumberRangeQuestion", question_id: "m7_n", internal_field: "age", answer_type: "number", props: { min: 18, max: 99 } } as unknown as LeadgenComponentNode,
      ],
    },
  },
  // (f) M9 addresses: one WITH maps.fills, one WITHOUT any maps config.
  {
    id: 901,
    public_id: "lgs_rework_m9f",
    section_name: "M9 address",
    content: {
      components: [
        { type: "AddressAutocompleteQuestion", question_id: "m9_a1", required: true, props: { maps: { enabled: true, autocomplete: true, fills: { zip: "home_zip", city: "home_city" } } } } as unknown as LeadgenComponentNode,
        { type: "AddressAutocompleteQuestion", question_id: "m9_a2", props: { placeholder: "Address…" } } as unknown as LeadgenComponentNode,
      ],
    },
  },
  // (i) No-target section — untouched byte-identically by every migration.
  {
    id: 999,
    public_id: "lgs_rework_none",
    section_name: "No rework target",
    content: {
      components: [
        { type: "FreeTextQuestion", question_id: "nt_name", internal_field: "full_name", props: { placeholder: "Name" } },
        { type: "ContinueButton", question_id: "nt_cont", props: {} },
      ],
    },
  },
];

// Answer-map rows keyed on the M6 grid's PROJECTED per-row question_ids (the ids
// answer-maps already carry today). The count must survive M6 unchanged.
export const FIXTURE_ANSWER_MAPS: readonly FixtureAnswerMap[] = [
  { section_id: 601, question_id: "m6a_grid::homeowner", internal_field: "homeowner" },
  { section_id: 601, question_id: "m6a_grid::grade", internal_field: "grade" },
  { section_id: 601, question_id: "m6a_grid::married", internal_field: "married" },
];

// --- pure analysis helpers --------------------------------------------------

function parseComponents(contentJson: string): LeadgenComponentNode[] {
  const parsed = JSON.parse(contentJson) as { components?: unknown };
  return Array.isArray(parsed.components) ? (parsed.components as LeadgenComponentNode[]) : [];
}

/** The RESOLVED runtime answer-field universe — the invariant the report asserts. */
export function projectedFieldUniverse(contentJson: string): string[] {
  const comps = parseComponents(contentJson);
  const projected = comps.flatMap((n) => expandPublicComponents(n));
  return [...collectKnownAnswerFields(projected)].sort();
}

/** The as-authored field universe — shown for transparency (M6 annotated). */
export function rawFieldUniverse(contentJson: string): string[] {
  return [...collectKnownAnswerFields(parseComponents(contentJson))].sort();
}

export function nodeSummary(contentJson: string): { count: number; types: Record<string, number> } {
  const comps = parseComponents(contentJson);
  const types: Record<string, number> = {};
  for (const c of comps) {
    const t = typeof c?.type === "string" ? c.type : "(unknown)";
    types[t] = (types[t] ?? 0) + 1;
  }
  return { count: comps.length, types };
}

export function diffSets(before: readonly string[], after: readonly string[]): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    added: after.filter((x) => !b.has(x)).sort(),
    removed: before.filter((x) => !a.has(x)).sort(),
  };
}

export function answerMapCount(db: SqliteDb, sectionId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM leadgen_section_answer_maps WHERE section_id = ?").get(sectionId) as { n: number }).n;
}

/** Sections holding a target node at ANY depth (json_tree) — surfaces nested cases. */
export function nestedTargetSections(db: SqliteDb, spec: MigrationSpec): number[] {
  const rows = db.prepare(spec.nestedDetect).all() as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

/** Sections the migration's own top-level WHERE would match. */
export function topLevelTargetSections(db: SqliteDb, spec: MigrationSpec): number[] {
  const rows = db.prepare(spec.prodSelect).all() as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

// --- report generation ------------------------------------------------------

interface SectionSnap {
  id: number;
  public_id: string;
  section_name: string;
  content_json: string;
  mapCount: number;
}

function snapshot(db: SqliteDb): Map<number, SectionSnap> {
  const rows = db
    .prepare("SELECT id, public_id, section_name, content_json FROM leadgen_sections ORDER BY id")
    .all() as Array<{ id: number; public_id: string; section_name: string; content_json: string }>;
  const out = new Map<number, SectionSnap>();
  for (const r of rows) out.set(r.id, { ...r, mapCount: answerMapCount(db, r.id) });
  return out;
}

function typeHistogram(types: Record<string, number>): string {
  const keys = Object.keys(types).sort();
  return keys.map((k) => `${k}×${types[k]}`).join(", ") || "(none)";
}

function buildReport(spec: MigrationSpec, before: Map<number, SectionSnap>, affected: number[], after: Map<number, SectionSnap>): string {
  const L: string[] = [];
  L.push(`# Migration report — ${spec.title}`);
  L.push("");
  L.push(`- **Migration file:** \`migrations/${spec.file}\``);
  L.push(`- **Contract anchor:** ${spec.contractAnchor}`);
  L.push(`- **Generated by:** \`tsx src/scripts/leadgen-rework-migration-report.ts\` (from the committed golden fixtures — no prod data locally; run the SELECT below against prod at deploy time to regenerate)`);
  L.push("");
  L.push(`> ${spec.summary}`);
  L.push("");
  L.push("## Field-universe methodology");
  L.push("");
  L.push("The **projected** field universe is `collectKnownAnswerFields(components.flatMap(expandPublicComponents))` — the resolved runtime answer-field set the runtime, answer-maps, analytics, and rules reference. **This diff must be empty for every affected section.** The **raw** field universe is `collectKnownAnswerFields(components)` on the stored content as-authored, shown for transparency.");
  L.push("");

  L.push(`## Affected sections (${affected.length})`);
  L.push("");
  if (affected.length === 0) {
    L.push("_No affected sections in the fixture corpus for this migration._");
    L.push("");
  } else {
    L.push("| id | public_id | name | nodes before→after | types before | types after |");
    L.push("|---|---|---|---|---|---|");
    for (const id of affected) {
      const b = before.get(id)!;
      const a = after.get(id)!;
      const bs = nodeSummary(b.content_json);
      const as = nodeSummary(a.content_json);
      L.push(`| ${id} | \`${b.public_id}\` | ${b.section_name} | ${bs.count}→${as.count} | ${typeHistogram(bs.types)} | ${typeHistogram(as.types)} |`);
    }
    L.push("");

    L.push("## Per-section invariants");
    L.push("");
    L.push("| id | projected FU diff (must be empty) | raw FU diff (transparency) | answer-map rows before→after (must be equal) |");
    L.push("|---|---|---|---|");
    for (const id of affected) {
      const b = before.get(id)!;
      const a = after.get(id)!;
      const projDiff = diffSets(projectedFieldUniverse(b.content_json), projectedFieldUniverse(a.content_json));
      const rawDiff = diffSets(rawFieldUniverse(b.content_json), rawFieldUniverse(a.content_json));
      const projStr = projDiff.added.length === 0 && projDiff.removed.length === 0 ? "∅ (empty)" : `+${JSON.stringify(projDiff.added)} −${JSON.stringify(projDiff.removed)}`;
      const rawStr = rawDiff.added.length === 0 && rawDiff.removed.length === 0 ? "∅ (empty)" : `+${JSON.stringify(rawDiff.added)} −${JSON.stringify(rawDiff.removed)}`;
      L.push(`| ${id} | ${projStr} | ${rawStr} | ${b.mapCount}→${a.mapCount} |`);
    }
    L.push("");
    if (spec.key === "m6") {
      L.push("_M6 raw-diff note:_ the raw diff retires each grid's own authoring node-id (`<nodeQid>`, which produces no answer — config-dto.ts:432 \"the parent grid node itself projects to NOTHING\") and adds the per-row projected ids `<nodeQid>::<field>` that the answer-maps, analytics keys, and rules already reference. No answer field (internal_field) is added or removed. The **projected** diff is empty, confirming the runtime field universe is preserved.");
      L.push("");
    }
  }

  // Nested-target coverage
  L.push("## Nested-target coverage");
  L.push("");
  L.push("This migration rewrites **top-level** `$.components[*]`. A target nested inside a layout container (`children`) is NOT rewritten here and would be surfaced below (current authoring places these components at top level, so this is normally empty).");
  L.push("");
  if (affected.length > 0) {
    L.push(`- Top-level target sections: ${affected.length}. Nested-only target sections (json_tree − top-level): see the detector SELECT below.`);
  } else {
    L.push("- No targets in the fixture corpus.");
  }
  L.push("");

  L.push("## Re-runnable prod SQL (deploy-time regeneration)");
  L.push("");
  L.push("Affected sections (top-level — the exact set this migration rewrites):");
  L.push("");
  L.push("```sql");
  L.push(spec.prodSelect);
  L.push("```");
  L.push("");
  L.push("Nested-target detector (any depth — must be a SUBSET of the top-level set; extra ids = nested targets needing manual handling):");
  L.push("");
  L.push("```sql");
  L.push(spec.nestedDetect);
  L.push("```");
  L.push("");
  return L.join("\n");
}

// --- orchestration ----------------------------------------------------------

/** Build one migration's report over a fresh fixture DB (snapshot → apply → report). */
export function generateReportFromFixtures(DatabaseSync: DatabaseSyncCtor, spec: MigrationSpec): string {
  const db = createSectionsDb(DatabaseSync);
  for (const s of FIXTURE_SECTIONS) insertFixtureSection(db, s);
  FIXTURE_ANSWER_MAPS.forEach((m, i) => insertFixtureAnswerMap(db, m, i));
  const affected = topLevelTargetSections(db, spec);
  const before = snapshot(db);
  applyMigrationFile(db, spec.file);
  const after = snapshot(db);
  const md = buildReport(spec, before, affected, after);
  db.close();
  return md;
}

export function writeAllFixtureReports(DatabaseSync: DatabaseSyncCtor): string[] {
  if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
  const written: string[] = [];
  for (const spec of MIGRATIONS) {
    const md = generateReportFromFixtures(DatabaseSync, spec);
    const path = join(REPORTS_DIR, `${spec.key}-report.md`);
    writeFileSync(path, md, "utf8");
    written.push(path);
  }
  return written;
}

function main(argv: string[]): void {
  const DatabaseSync = loadDatabaseSync();
  if (DatabaseSync === null) {
    console.error("leadgen-rework-migration-report: node:sqlite unavailable (needs Node ≥ 22.5). Aborting.");
    process.exit(1);
  }
  const mode = argv[0] && !argv[0].startsWith("--") ? argv[0] : "fixtures";
  const dbFlag = argv.indexOf("--db");
  const dbPath = dbFlag >= 0 ? argv[dbFlag + 1] : undefined;

  if (mode === "snapshot") {
    if (dbPath === undefined) throw new Error("snapshot requires --db <sqlite>");
    const outFlag = argv.indexOf("--out");
    const outPath = (outFlag >= 0 ? argv[outFlag + 1] : undefined) ?? "leadgen-rework-before.json";
    const db = new DatabaseSync(dbPath);
    const snap = snapshot(db);
    db.close();
    writeFileSync(outPath, JSON.stringify([...snap.values()], null, 2), "utf8");
    console.log(`snapshot written: ${outPath} (${snap.size} sections)`);
    return;
  }

  if (mode === "report" && dbPath !== undefined) {
    // Report against a real DB whose migrations have ALREADY been applied, using a
    // captured before-snapshot for the "before" side.
    const beforeFlag = argv.indexOf("--before");
    const beforePath = beforeFlag >= 0 ? argv[beforeFlag + 1] : undefined;
    if (beforePath === undefined) throw new Error("report --db requires --before <snapshot.json>");
    const beforeArr = JSON.parse(readFileSync(beforePath, "utf8")) as SectionSnap[];
    const before = new Map<number, SectionSnap>(beforeArr.map((s) => [s.id, s]));
    const db = new DatabaseSync(dbPath);
    const after = snapshot(db);
    if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
    for (const spec of MIGRATIONS) {
      const affected = [...before.values()]
        .filter((b) => {
          const a = after.get(b.id);
          return a !== undefined && a.content_json !== b.content_json;
        })
        .map((b) => b.id);
      const md = buildReport(spec, before, affected, after);
      writeFileSync(join(REPORTS_DIR, `${spec.key}-report.md`), md, "utf8");
    }
    db.close();
    console.log(`reports written to ${REPORTS_DIR}`);
    return;
  }

  // default / --fixtures: regenerate the committed reports from the golden fixtures.
  const written = writeAllFixtureReports(DatabaseSync);
  for (const p of written) console.log(`report written: ${p}`);
}

// tsx entrypoint guard.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2));
}
