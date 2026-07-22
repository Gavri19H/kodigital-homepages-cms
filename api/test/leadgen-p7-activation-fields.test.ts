// LeadGen Round-4 P7 — activation-time dependency field-set + composed-shape
// regression (money-path: "quote activation must not 409 on a rule that
// references an expanded answer sub-field").
//
// Two independent activation-preflight holes this file pins (both found by the
// round-4 acceptance suite, Item 4A/4B/4C/4E):
//
//   1. FIELD-SET: computeVariantPreflightBlocks' knownFields builder collected
//      only each flattened node's OWN top-level internal_field. A
//      MultiQuestionGrid row (props.rows[].internal_field), an Address role
//      sub-field, and a NameFieldsGroup field carry NO top-level internal_field,
//      so a rule referencing one was wrongly flagged dependency_missing_field at
//      activation (409) even though the studio picker + save gate both accept it.
//      Fix: activation now consumes the SHARED collectKnownAnswerFields
//      (content-schema.ts) — the same enumerator save-time validation uses.
//
//   2. COMPOSED SHAPE: the dependency guard tested `typeof conditional.when ===
//      "string"`, which is false for the P2 composed group {match,conditions:[…]}
//      — so a composed rule skipped field-dependency validation ENTIRELY (the
//      opposite hole: a group naming a genuinely-missing field activated
//      silently). Fix: activation now walks conditionalFieldRefs
//      (content-schema.ts), which yields every `when` across BOTH shapes.
//
// Real producer→consume path: sections are inserted with crafted content_json
// (raw, so an intentionally-unknown field can be staged past save-validation),
// then a quote + funnel + variant are created and the sections linked through
// the ACTUAL admin handlers (POST /quotes, PUT /variants/:id); the assertion runs
// the ACTUAL computeQuoteActivationPreflight the 409 gate calls.
//
// Fail-before / pass-after (against HEAD source, this file unchanged):
//   * MQG-row bare conditional (test 1) — 409-blocked before, activates after;
//   * composed-shape unknown field (test 2) — silently activated before, blocked
//     after (proves the fix VALIDATES composed shapes, does not merely skip them);
//   * Address-role + Name-field conditionals (test 3) — 409-blocked before,
//     activate after.
//   * Back-compat (test 4) — bare single-field known/unknown validate identically
//     before and after.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import {
  computeQuoteActivationPreflight,
  type QuoteActivationBlock,
  type QuoteActivationPreflight,
} from "../src/admin/leadgen/quotes-handlers";
import type { LeadgenQuoteRow } from "../src/admin/leadgen/db-types";

// --- node:sqlite harness (repo pattern, mirrors leadgen-activation-preflight-v25) ---

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

function d1FromSqlite(sdb: SqliteDb): D1Database {
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          const r = sdb.prepare(sql).get(...binds);
          return (r ?? null) as T | null;
        },
        async all<T = unknown>() {
          const rows = sdb.prepare(sql).all(...binds);
          return { results: rows as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as {
            changes?: number;
            lastInsertRowid?: number | bigint;
          };
          return {
            success: true,
            meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) },
          };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const statement of statements) {
          results.push(await statement.run());
        }
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return results;
    },
  } as unknown as D1Database;
  return db;
}

function makeKvStub(): KVNamespace {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)!.value : null;
    },
    async getWithMetadata(key: string): Promise<{ value: string | null; metadata: unknown }> {
      const e = store.get(key);
      return e ? { value: e.value, metadata: e.metadata ?? null } : { value: null, metadata: null };
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }): Promise<void> {
      store.set(key, { value, metadata: opts?.metadata ?? null });
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

// Rework P1 coherence sweep (conductor-consolidated round): brought
// current through 0053 (was stale) so this harness's D1 schema matches
// the real Wave-1 shape (handlers now write M1/M2/M4/M5 columns/tables
// this file's schema never had).
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql",
  "0046_leadgen_rework_m1_variants.sql",
  "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql",
  "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql",
  "0053_leadgen_rework_m12_othergroup_retirement.sql",
] as const;

function createRuntimeDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','insurance','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','one.example.com','active');",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "300",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "runtime-signing-key-test-only",
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

interface Harness {
  sdb: SqliteDb;
  d1: D1Database;
  env: Env;
}

function newHarness(): Harness {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  const d1 = d1FromSqlite(sdb);
  return { sdb, d1, env: buildEnv(d1, makeKvStub()) };
}

// Raw section insert — crafted content_json goes in verbatim (bypasses the
// save-time content validator, which is exactly what test 2 needs to stage a
// genuinely-unknown field). status 'active' so the variant link is active.
function seedSection(sdb: SqliteDb, contentJson: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', 'Headline', ?, 'button', 0, 'active')",
    )
    .run(publicId, `P7 Section ${publicId.slice(-4)}`, contentJson);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as {
    id: number;
  };
  return { id: row.id, public_id: publicId };
}

// Real admin path: POST /quotes -> funnel + variant, PUT /variants/:id links the
// section rows. Returns the quote row the activation preflight consumes.
async function seedQuote(h: Harness, name: string, sectionIds: number[]): Promise<LeadgenQuoteRow> {
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: name, activity: "quote_funnel", verticals: ["life"] }),
    h.env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const created = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const variantPublicId = created.funnels[0]!.variants[0]!.public_id;
  const putRes = await admin.request(
    `${API}/variants/${variantPublicId}`,
    jsonInit("PUT", { sections: sectionIds.map((section_id) => ({ section_id })) }),
    h.env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);
  return h.sdb
    .prepare("SELECT * FROM leadgen_quotes WHERE public_id = ?")
    .get(created.public_id) as unknown as LeadgenQuoteRow;
}

// The dependency_missing_field references the preflight flagged (its fields[],
// flattened) — the money-path 409 payload's block list.
function dependencyMissingFields(preflight: QuoteActivationPreflight): string[] {
  return preflight.blocks
    .filter((b: QuoteActivationBlock) => b.code === "dependency_missing_field")
    .flatMap((b) => b.fields);
}

const YESNO = [
  { label: "Yes", value: "yes", analytics_id: "yes" },
  { label: "No", value: "no", analytics_id: "no" },
];
const ONE_CHOICE = [{ label: "Acme", value: "acme", analytics_id: "acme" }];
const CONTINUE = { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } };

// ===========================================================================

describeDb("leadgen-p7 activation dependency field-set + composed shape", () => {
  // Test 1 — the operator's exact journey: a Dropdown conditioned on a
  // MultiQuestionGrid ROW field. FAIL-BEFORE: activation 409s
  // (dependency_missing_field ["mqg row field"]); PASS-AFTER: activates clean.
  it("a rule conditioning a component on an MQG row field activates (no dependency block)", async () => {
    const h = newHarness();
    const s = seedSection(
      h.sdb,
      JSON.stringify({
        components: [
          {
            type: "MultiQuestionGrid",
            question_id: "q_grid",
            choices: YESNO,
            props: { rows: [{ label: "Homeowner", internal_field: "p7_homeowner" }] },
          },
          {
            type: "DropdownQuestion",
            question_id: "q_carrier",
            internal_field: "p7_carrier",
            answer_type: "enum",
            choices: ONE_CHOICE,
            conditional: { when: "p7_homeowner", op: "eq", value: "yes" },
          },
          CONTINUE,
        ],
      }),
    );
    const quoteRow = await seedQuote(h, "P7 MQG-row rule", [s.id]);
    const preflight = await computeQuoteActivationPreflight(h.d1, quoteRow);
    expect(
      dependencyMissingFields(preflight),
      `MQG row 'p7_homeowner' must be a known activation field; blocks: ${JSON.stringify(preflight.blocks)}`,
    ).toEqual([]);
  });

  // Test 2 — a COMPOSED-shape rule naming a field that exists NOWHERE must be
  // REJECTED at activation. FAIL-BEFORE: composed shape skipped the check, so it
  // activated silently (no block); PASS-AFTER: blocked on the unknown field.
  // Proves the fix VALIDATES composed shapes rather than merely tolerating them.
  it("a composed {match,conditions} rule naming a genuinely-unknown field is blocked", async () => {
    const h = newHarness();
    const s = seedSection(
      h.sdb,
      JSON.stringify({
        components: [
          { type: "TwoButtonYesNo", question_id: "q_insured", internal_field: "p7_insured", answer_type: "boolean" },
          {
            type: "DropdownQuestion",
            question_id: "q_x",
            internal_field: "p7_x",
            answer_type: "enum",
            choices: ONE_CHOICE,
            conditional: { match: "all", conditions: [{ when: "p7_ghost", op: "eq", value: "yes" }] },
          },
          CONTINUE,
        ],
      }),
    );
    const quoteRow = await seedQuote(h, "P7 composed-unknown rule", [s.id]);
    const preflight = await computeQuoteActivationPreflight(h.d1, quoteRow);
    expect(
      dependencyMissingFields(preflight),
      `composed rule's unknown 'p7_ghost' must block activation; blocks: ${JSON.stringify(preflight.blocks)}`,
    ).toContain("p7_ghost");
  });

  // Test 3 — Address role sub-field + NameFieldsGroup field as rule sources (the
  // A-4 sweep). FAIL-BEFORE: both 409-block; PASS-AFTER: both activate.
  it("rules conditioned on an Address role field and a Name field activate (no dependency block)", async () => {
    const h = newHarness();
    const s = seedSection(
      h.sdb,
      JSON.stringify({
        components: [
          // internal_field 'p7_addr', no maps.fills -> roles p7_addr_street/_city/_state/_zip.
          { type: "AddressAutocompleteQuestion", question_id: "q_addr", internal_field: "p7_addr", answer_type: "string" },
          // no props.fields -> defaults 'first'/'last'.
          { type: "NameFieldsGroup", question_id: "q_name" },
          {
            type: "DropdownQuestion",
            question_id: "q_by_city",
            internal_field: "p7_by_city",
            answer_type: "enum",
            choices: ONE_CHOICE,
            conditional: { when: "p7_addr_city", op: "eq", value: "NYC" },
          },
          {
            type: "DropdownQuestion",
            question_id: "q_by_first",
            internal_field: "p7_by_first",
            answer_type: "enum",
            choices: ONE_CHOICE,
            conditional: { when: "first", op: "eq", value: "Sam" },
          },
          CONTINUE,
        ],
      }),
    );
    const quoteRow = await seedQuote(h, "P7 address+name rules", [s.id]);
    const preflight = await computeQuoteActivationPreflight(h.d1, quoteRow);
    expect(
      dependencyMissingFields(preflight),
      `Address role 'p7_addr_city' + Name 'first' must be known activation fields; blocks: ${JSON.stringify(preflight.blocks)}`,
    ).toEqual([]);
  });

  // Test 4 — back-compat: the pre-existing bare single-field path is byte-for-
  // byte unchanged. A known internal_field activates; an unknown one still
  // blocks (identical before and after the fix). Plus: a composed rule over
  // KNOWN MQG rows activates (composed + expanded field-set together).
  it("bare single-field rules validate identically (known activates, unknown blocks); composed over known MQG rows activates", async () => {
    const h = newHarness();

    const known = seedSection(
      h.sdb,
      JSON.stringify({
        components: [
          { type: "TwoButtonYesNo", question_id: "q_insured", internal_field: "p7_insured", answer_type: "boolean" },
          {
            type: "DropdownQuestion",
            question_id: "q_c",
            internal_field: "p7_c",
            answer_type: "enum",
            choices: ONE_CHOICE,
            conditional: { when: "p7_insured", op: "eq", value: true },
          },
          CONTINUE,
        ],
      }),
    );
    const knownPreflight = await computeQuoteActivationPreflight(h.d1, await seedQuote(h, "P7 bare-known", [known.id]));
    expect(dependencyMissingFields(knownPreflight), "bare known field must activate").toEqual([]);

    const unknown = seedSection(
      h.sdb,
      JSON.stringify({
        components: [
          { type: "TwoButtonYesNo", question_id: "q_insured", internal_field: "p7_insured", answer_type: "boolean" },
          {
            type: "DropdownQuestion",
            question_id: "q_c",
            internal_field: "p7_c",
            answer_type: "enum",
            choices: ONE_CHOICE,
            conditional: { when: "p7_missing", op: "eq", value: "x" },
          },
          CONTINUE,
        ],
      }),
    );
    const unknownPreflight = await computeQuoteActivationPreflight(h.d1, await seedQuote(h, "P7 bare-unknown", [unknown.id]));
    expect(dependencyMissingFields(unknownPreflight), "bare unknown field must still block").toContain("p7_missing");

    const composedKnown = seedSection(
      h.sdb,
      JSON.stringify({
        components: [
          {
            type: "MultiQuestionGrid",
            question_id: "q_grid",
            choices: YESNO,
            props: {
              rows: [
                { label: "Married", internal_field: "p7_married" },
                { label: "Gender", internal_field: "p7_gender" },
              ],
            },
          },
          {
            type: "FreeTextQuestion",
            question_id: "q_x2",
            internal_field: "p7_x2",
            answer_type: "string",
            conditional: {
              match: "all",
              conditions: [
                { when: "p7_married", op: "eq", value: "yes" },
                { when: "p7_gender", op: "eq", value: "male" },
              ],
            },
          },
          CONTINUE,
        ],
      }),
    );
    const composedPreflight = await computeQuoteActivationPreflight(
      h.d1,
      await seedQuote(h, "P7 composed-known", [composedKnown.id]),
    );
    expect(
      dependencyMissingFields(composedPreflight),
      `composed rule over known MQG rows must activate; blocks: ${JSON.stringify(composedPreflight.blocks)}`,
    ).toEqual([]);
  });
});
