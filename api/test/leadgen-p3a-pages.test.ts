// LeadGen Round-4 P3a (D-3 pages model, FULL) — contract-delta coverage over
// REAL sqlite (node:sqlite harness, the leadgen-runtime-api.test.ts pattern):
//   * 0042 migration wrap correctness (positions preserved, one fixed slot
//     per pre-existing row);
//   * resolvePagePlan slot resolution matrix (rules-first / AB-fallback /
//     session stickiness / slot_revision re-bucket) — pure, no DB;
//   * validateSlotRuleFieldScope entry-known-only rejection;
//   * page_plan_hash determinism + the dual-accept window (an absent hash,
//     the pre-P3a-deploy in-flight-token shape, skips the auction-side
//     equality check entirely);
//   * the P3a MIGRATION GATE: migrated funnels serve byte-identical section/
//     component HTML. Rather than a frozen "render at the parent commit"
//     golden file (operationally heavier — a second checkout/build inside a
//     test, and a snapshot that silently rots), this proves the INVARIANT
//     directly: resolver.ts's loadVariantPages has TWO code paths for the
//     exact same underlying row set — the SYNTHETIC fallback (page_id/
//     slot_id NULL, the pre-backfill shape) and the REAL path (after 0042's
//     wrap backfill runs over those same rows) — and asserts the rendered
//     section HTML is IDENTICAL between them. This is the literal mechanism
//     the migration gate cares about, re-verified on every run instead of a
//     point-in-time snapshot;
//   * quotes-handlers.ts `pages` PUT contract (fixed/ruled/ab slot kinds,
//     validation, slot_revision bump-on-edit) + auction-after-last-page.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import {
  resolvePagePlan,
  validateSlotRuleFieldScope,
  sectionsFromPages,
  type ResolvedFunnelPage,
  type EntryKnownContext,
} from "../src/public/leadgen/resolver";
import { renderVariantSectionsHtml } from "../src/public/leadgen/serve";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import { resolveActivatedFunnelByVariant } from "../src/public/leadgen/resolver";
import { verifyConfigTokenDetailed, type ConfigTokenTuple } from "../src/public/leadgen/attempt";

// --- node:sqlite harness (repo pattern) --------------------------------------

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

const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql", // leadgen_funnels.frame_config_json/theme_json (duplicateQuoteHandler clones both)
  "0042_leadgen_pages.sql",
] as const;

const TENANT_HOST = "p3a.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const CONFIG_SIGNING_KEY = "p3a-signing-key-test-only";

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','${TENANT_HOST}','insurance','active');` +
      `INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','${TENANT_HOST}','active');`,
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
    LEADGEN_CONFIG_SIGNING_KEY: CONFIG_SIGNING_KEY,
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
  env: Env;
}

function newHarness(): Harness {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createDb(ctor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}

function seedSection(sdb: SqliteDb, name: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({
    components: [
      { type: "TwoButtonYesNo", question_id: `q_${name}`, question_key: name, internal_field: name, answer_type: "boolean" },
    ],
  });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 0, 'active')",
    )
    .run(publicId, name, `Headline ${name}`, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

// Create a quote (-> active funnel + active control variant); the caller
// attaches sections/pages + activates separately.
async function seedQuote(env: Env): Promise<{ quotePublicId: string; variantId: string }> {
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: `P3a ${Date.now()}-${Math.random()}`, activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const quote = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ variants: Array<{ public_id: string }> }>;
  };
  return { quotePublicId: quote.public_id, variantId: quote.funnels[0]!.variants[0]!.public_id };
}

async function activate(env: Env, quotePublicId: string): Promise<void> {
  const actRes = await admin.request(`${API}/quotes/${quotePublicId}/activation/site-1`, jsonInit("PUT", { enabled: true }), env);
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);
}

async function get(env: Env, path: string): Promise<Response> {
  return app.request(`${TENANT_ORIGIN}${path}`, {}, env);
}
async function post(env: Env, path: string, body: unknown): Promise<Response> {
  return app.request(`${TENANT_ORIGIN}${path}`, jsonInit("POST", body), env);
}

// ===========================================================================
// 0042 migration wrap correctness
// ===========================================================================

describeDb("0042 migration — wrap correctness (D-3, behavior-preserving)", () => {
  it("every pre-existing variant-section row becomes its own page + one fixed slot, positions preserved", () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    // Seed a variant + 3 sections DIRECTLY (raw SQL, bypassing the admin API —
    // simulates a pre-P3a row shape) at positions 0,1,2, THEN run 0042's own
    // backfill statements again (idempotent per their own `page_id IS NULL`
    // guards) to prove the wrap over these freshly-inserted legacy-shaped rows.
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES ('lgq_wraptest','Wrap','quote_funnel','[\"life\"]','active')").run();
    const quoteRow = sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id='lgq_wraptest'").get() as { id: number };
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status) VALUES ('lgf_wraptest', ?, 'Wrap Funnel', 'active')").run(quoteRow.id);
    const funnelRow = sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id='lgf_wraptest'").get() as { id: number };
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, is_control, status) VALUES ('lgn_wraptest', ?, 'A', 1, 'active')").run(funnelRow.id);
    const variantRow = sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id='lgn_wraptest'").get() as { id: number };

    const sections = ["s0", "s1", "s2"].map((n) => seedSection(sdb, n));
    sections.forEach((s, i) => {
      sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, ?)").run(variantRow.id, s.id, i);
    });

    // Re-run JUST 0042's WRAP backfill (its 3 final statements — idempotent
    // via `WHERE fvs.page_id IS NULL`; the file's CREATE TABLE/ALTER TABLE
    // statements already ran once during createDb and would error on replay,
    // so only the backfill trio is re-issued here, mirroring 0042 verbatim).
    const migrationSql = readFileSync(join(TEST_DIR, "../migrations/0042_leadgen_pages.sql"), "utf8");
    const backfillStart = migrationSql.indexOf("-- WRAP");
    expect(backfillStart).toBeGreaterThan(-1);
    runSql(sdb, migrationSql.slice(backfillStart));

    const pages = sdb
      .prepare("SELECT id, public_id, position, name FROM leadgen_funnel_pages WHERE variant_id = ? ORDER BY position ASC")
      .all(variantRow.id) as Array<{ id: number; public_id: string; position: number; name: string | null }>;
    expect(pages).toHaveLength(3);
    pages.forEach((p, i) => {
      expect(p.position).toBe(i);
      expect(p.public_id.startsWith("lgpg_")).toBe(true);
    });

    for (const page of pages) {
      const slots = sdb.prepare("SELECT id, position, slot_revision, rules_json, ab_allocations_json FROM leadgen_funnel_page_slots WHERE page_id = ?").all(page.id) as Array<{
        id: number;
        position: number;
        slot_revision: number;
        rules_json: string | null;
        ab_allocations_json: string | null;
      }>;
      expect(slots).toHaveLength(1);
      expect(slots[0]!.position).toBe(0);
      expect(slots[0]!.slot_revision).toBe(0);
      expect(slots[0]!.rules_json).toBeNull();
      expect(slots[0]!.ab_allocations_json).toBeNull();

      const candidates = sdb.prepare("SELECT section_id FROM leadgen_funnel_variant_sections WHERE slot_id = ?").all(slots[0]!.id) as Array<{ section_id: number }>;
      expect(candidates).toHaveLength(1);
    }

    // page_id/slot_id populated on every original row (no NULL survivors).
    const nullRows = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_variant_sections WHERE variant_id = ? AND (page_id IS NULL OR slot_id IS NULL)").get(variantRow.id) as { n: number };
    expect(nullRows.n).toBe(0);
    sdb.close();
  });
});

// ===========================================================================
// resolvePagePlan — slot resolution matrix (pure, no DB)
// ===========================================================================

function fixedPage(pageId: string, sectionPublicId: string, sectionDbId: number): ResolvedFunnelPage {
  return {
    id: 1,
    public_id: pageId,
    position: 0,
    name: null,
    slots: [
      {
        id: 1,
        position: 0,
        slot_revision: 0,
        rules: null,
        ab_allocations: null,
        candidates: [{ variant_section_id: 1, section: sectionRow(sectionDbId, sectionPublicId) }],
      },
    ],
  };
}

function sectionRow(id: number, publicId: string): ResolvedFunnelPage["slots"][number]["candidates"][number]["section"] {
  return {
    id,
    public_id: publicId,
    section_name: publicId,
    activity: "quote_funnel",
    vertical: "life",
    headline_text: "H",
    subheadline_text: null,
    image_json: null,
    content_json: "{}",
    content_html: null,
    continue_mode: "button",
    design_overrides_json: null,
    address_validation_enabled: 0,
    section_mapping_version: 1,
    content_version: 1,
    status: "active",
    created_by: null,
    created_at: 0,
    updated_at: 0,
  } as ResolvedFunnelPage["slots"][number]["candidates"][number]["section"];
}

const BASE_CTX: EntryKnownContext = { hour: 10, weekday: 2 };

describe("resolvePagePlan — slot resolution matrix (D-3)", () => {
  it("a fixed slot (1 candidate) always resolves to that candidate, reason=fixed", () => {
    const pages = [fixedPage("lgpg_p1", "lgs_x", 1)];
    const plan = resolvePagePlan(pages, BASE_CTX, "sess-1");
    expect(plan.winners).toEqual([{ page_id: "lgpg_p1", slot_id: 1, section_public_id: "lgs_x", assignment_reason: "fixed" }]);
  });

  it("a ruled slot: a matching case wins over the default (rules-first)", () => {
    const pages: ResolvedFunnelPage[] = [
      {
        id: 1,
        public_id: "lgpg_p2",
        position: 0,
        name: null,
        slots: [
          {
            id: 2,
            position: 0,
            slot_revision: 0,
            rules: {
              cases: [{ conditions: { groups: [{ field: "state", op: "eq", value: "CA" }] }, section_id: 10 }],
              default_section_id: 20,
            },
            ab_allocations: null,
            candidates: [
              { variant_section_id: 1, section: sectionRow(10, "lgs_ca") },
              { variant_section_id: 2, section: sectionRow(20, "lgs_default") },
            ],
          },
        ],
      },
    ];
    const caWinner = resolvePagePlan(pages, { ...BASE_CTX, state: "CA" }, "sess-1").winners[0]!;
    expect(caWinner.section_public_id).toBe("lgs_ca");
    expect(caWinner.assignment_reason).toBe("slot_rule");
    const otherWinner = resolvePagePlan(pages, { ...BASE_CTX, state: "NY" }, "sess-1").winners[0]!;
    expect(otherWinner.section_public_id).toBe("lgs_default");
  });

  it("a ruled slot with no matching case falls through to default_section_id", () => {
    const pages: ResolvedFunnelPage[] = [
      {
        id: 1,
        public_id: "lgpg_p3",
        position: 0,
        name: null,
        slots: [
          {
            id: 3,
            position: 0,
            slot_revision: 0,
            rules: {
              cases: [{ conditions: { groups: [{ field: "device", op: "eq", value: "mobile" }] }, section_id: 11 }],
              default_section_id: 21,
            },
            ab_allocations: null,
            candidates: [
              { variant_section_id: 1, section: sectionRow(11, "lgs_mobile") },
              { variant_section_id: 2, section: sectionRow(21, "lgs_desktop") },
            ],
          },
        ],
      },
    ];
    const winner = resolvePagePlan(pages, { ...BASE_CTX, device: "desktop" }, "sess-1").winners[0]!;
    expect(winner.section_public_id).toBe("lgs_desktop");
  });

  it("an A/B slot is session-sticky (same session -> same winner across repeated resolutions)", () => {
    const pages: ResolvedFunnelPage[] = [
      {
        id: 1,
        public_id: "lgpg_p4",
        position: 0,
        name: null,
        slots: [
          {
            id: 4,
            position: 0,
            slot_revision: 0,
            rules: null,
            ab_allocations: [
              { section_id: 12, bp: 5000 },
              { section_id: 22, bp: 5000 },
            ],
            candidates: [
              { variant_section_id: 1, section: sectionRow(12, "lgs_A") },
              { variant_section_id: 2, section: sectionRow(22, "lgs_B") },
            ],
          },
        ],
      },
    ];
    const first = resolvePagePlan(pages, BASE_CTX, "sticky-session-42").winners[0]!;
    const second = resolvePagePlan(pages, BASE_CTX, "sticky-session-42").winners[0]!;
    expect(second.section_public_id).toBe(first.section_public_id);
    expect(first.assignment_reason).toBe("slot_ab");
  });

  it("bumping slot_revision re-buckets an A/B slot (at least one of many sessions flips)", () => {
    const withRevision = (rev: number): ResolvedFunnelPage[] => [
      {
        id: 1,
        public_id: "lgpg_p5",
        position: 0,
        name: null,
        slots: [
          {
            id: 5,
            position: 0,
            slot_revision: rev,
            rules: null,
            ab_allocations: [
              { section_id: 13, bp: 5000 },
              { section_id: 23, bp: 5000 },
            ],
            candidates: [
              { variant_section_id: 1, section: sectionRow(13, "lgs_A") },
              { variant_section_id: 2, section: sectionRow(23, "lgs_B") },
            ],
          },
        ],
      },
    ];
    let flips = 0;
    for (let i = 0; i < 30; i++) {
      const sid = `session-${i}`;
      const before = resolvePagePlan(withRevision(0), BASE_CTX, sid).winners[0]!.section_public_id;
      const after = resolvePagePlan(withRevision(1), BASE_CTX, sid).winners[0]!.section_public_id;
      if (before !== after) flips++;
    }
    expect(flips).toBeGreaterThan(0);
  });

  it("page_plan_hash is deterministic (same inputs -> same hash) and changes when the winner changes", () => {
    const pages = [fixedPage("lgpg_pA", "lgs_x", 1)];
    const h1 = resolvePagePlan(pages, BASE_CTX, "sess-x").hash;
    const h2 = resolvePagePlan(pages, BASE_CTX, "sess-x").hash;
    expect(h1).toBe(h2);

    const rulePages: ResolvedFunnelPage[] = [
      {
        id: 1,
        public_id: "lgpg_pB",
        position: 0,
        name: null,
        slots: [
          {
            id: 6,
            position: 0,
            slot_revision: 0,
            rules: { cases: [{ conditions: { groups: [{ field: "state", op: "eq", value: "CA" }] }, section_id: 1 }], default_section_id: 2 },
            ab_allocations: null,
            candidates: [
              { variant_section_id: 1, section: sectionRow(1, "lgs_ca") },
              { variant_section_id: 2, section: sectionRow(2, "lgs_other") },
            ],
          },
        ],
      },
    ];
    const caHash = resolvePagePlan(rulePages, { ...BASE_CTX, state: "CA" }, "sess-y").hash;
    const nyHash = resolvePagePlan(rulePages, { ...BASE_CTX, state: "NY" }, "sess-y").hash;
    expect(caHash).not.toBe(nyHash);
  });

  it("multi-page plans group winners under their page_id in page order", () => {
    const page1 = fixedPage("lgpg_page1", "lgs_p1", 1);
    const page2: ResolvedFunnelPage = {
      id: 2,
      public_id: "lgpg_page2",
      position: 1,
      name: null,
      slots: [
        { id: 7, position: 0, slot_revision: 0, rules: null, ab_allocations: null, candidates: [{ variant_section_id: 3, section: sectionRow(3, "lgs_p2a") }] },
        { id: 8, position: 1, slot_revision: 0, rules: null, ab_allocations: null, candidates: [{ variant_section_id: 4, section: sectionRow(4, "lgs_p2b") }] },
      ],
    };
    const plan = resolvePagePlan([page1, page2], BASE_CTX, "sess-multi");
    expect(plan.pages).toEqual([
      { page_id: "lgpg_page1", section_public_ids: ["lgs_p1"] },
      { page_id: "lgpg_page2", section_public_ids: ["lgs_p2a", "lgs_p2b"] },
    ]);
  });
});

// ===========================================================================
// validateSlotRuleFieldScope — entry-known-only (roast MAJOR-4)
// ===========================================================================

describe("validateSlotRuleFieldScope — entry-known attributes ONLY", () => {
  it("accepts every entry-known field (state/device/utm_source/utm_medium/utm_content/hour/weekday)", () => {
    for (const field of ["state", "device", "utm_source", "utm_medium", "utm_content", "hour", "weekday"]) {
      const result = validateSlotRuleFieldScope({ groups: [{ field, op: "eq", value: "x" }] } as never);
      expect(result, `field ${field} should be accepted`).toBeNull();
    }
  });

  it("rejects an answer-field condition with the plain-language guidance", () => {
    const result = validateSlotRuleFieldScope({ groups: [{ field: "homeowner", op: "eq", value: true }] } as never);
    expect(result).toBe("answer-based visibility lives on the section's own show/hide rules");
  });
});

// ===========================================================================
// sectionsFromPages — flattening (session-independent candidate catalog)
// ===========================================================================

describe("sectionsFromPages — the flat session-independent candidate catalog", () => {
  it("includes ALL slot candidates (not just a resolved winner), in page/slot order", () => {
    const page: ResolvedFunnelPage = {
      id: 1,
      public_id: "lgpg_flat",
      position: 0,
      name: null,
      slots: [
        {
          id: 9,
          position: 0,
          slot_revision: 0,
          rules: null,
          ab_allocations: [{ section_id: 1, bp: 5000 }, { section_id: 2, bp: 5000 }],
          candidates: [
            { variant_section_id: 1, section: sectionRow(1, "lgs_A") },
            { variant_section_id: 2, section: sectionRow(2, "lgs_B") },
          ],
        },
      ],
    };
    const flat = sectionsFromPages([page]);
    expect(flat.map((s) => s.section.public_id)).toEqual(["lgs_A", "lgs_B"]);
  });
});

// ===========================================================================
// The P3a migration gate: migrated funnels serve BYTE-IDENTICAL section HTML
// ===========================================================================

describeDb("P3a migration gate — byte-identical section/component HTML", () => {
  it("the SYNTHETIC (pre-backfill) and REAL (post-backfill) resolution paths render identical section HTML for the same rows", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId } = await seedQuote(env);
    const s1 = seedSection(sdb, "alpha");
    const s2 = seedSection(sdb, "beta");
    const putRes = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { sections: [{ section_id: s1.id, position: 0 }, { section_id: s2.id, position: 1 }] }),
      env,
    );
    expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);
    await activate(env, quotePublicId);

    // SYNTHETIC path: no real leadgen_funnel_pages rows exist yet for this
    // variant (putVariantHandler's `sections` contract never creates them —
    // resolveSectionOrder is untouched, per design) -> loadVariantPages's
    // fallback branch synthesizes 1 page/1 slot per row.
    const resolvedSynthetic = await resolveActivatedFunnelByVariant(env, "site-1", variantId);
    expect(resolvedSynthetic).not.toBeNull();
    const design = getFunnelDesign(resolvedSynthetic!.variant.funnel_design_id);
    const htmlSynthetic = renderVariantSectionsHtml(resolvedSynthetic!.sections, design, null);

    // Run 0042's WRAP backfill NOW (mirrors what already happened for
    // migrated production data the moment 0042 was deployed) over these
    // freshly-created rows.
    const migrationSql = readFileSync(join(TEST_DIR, "../migrations/0042_leadgen_pages.sql"), "utf8");
    const backfillStart = migrationSql.indexOf("-- WRAP");
    runSql(sdb, migrationSql.slice(backfillStart));

    // REAL path: leadgen_funnel_pages/_page_slots now exist for this variant.
    const resolvedReal = await resolveActivatedFunnelByVariant(env, "site-1", variantId);
    expect(resolvedReal).not.toBeNull();
    expect(resolvedReal!.pages?.length).toBe(2); // wrap created 1 page per section
    const htmlReal = renderVariantSectionsHtml(resolvedReal!.sections, design, null);

    expect(htmlReal).toBe(htmlSynthetic);
    expect(htmlReal).toContain("alpha");
    expect(htmlReal).toContain("beta");
  });
});

// ===========================================================================
// End-to-end: a 2-page funnel via the `pages` PUT contract
// ===========================================================================

describeDb("quotes-handlers pages PUT contract + end-to-end plan resolution", () => {
  it("page 1 = fixed section; page 2 = a ruled slot (CA -> X else Y) + an A/B slot — saves, resolves, mints an attempt with the plan echo", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId } = await seedQuote(env);
    const fixedSection = seedSection(sdb, "page1fixed");
    const ruledCA = seedSection(sdb, "ruledCA");
    const ruledElse = seedSection(sdb, "ruledElse");
    const abA = seedSection(sdb, "abA");
    const abB = seedSection(sdb, "abB");

    const putRes = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", {
        pages: [
          { name: "Page 1", slots: [{ kind: "fixed", section_id: fixedSection.public_id }] },
          {
            name: "Page 2",
            slots: [
              {
                kind: "ruled",
                cases: [{ conditions: { groups: [{ field: "state", op: "eq", value: "CA" }] }, section_id: ruledCA.public_id }],
                default_section_id: ruledElse.public_id,
              },
              { kind: "ab", allocations: [{ section_id: abA.public_id, bp: 5000 }, { section_id: abB.public_id, bp: 5000 }] },
            ],
          },
        ],
      }),
      env,
    );
    expect(putRes.status, `put pages: ${await putRes.clone().text()}`).toBe(200);
    const detail = (await putRes.json()) as { pages: Array<{ page_id: string; slots: Array<{ kind: string }> }> };
    expect(detail.pages).toHaveLength(2);
    expect(detail.pages[0]!.slots).toHaveLength(1);
    expect(detail.pages[0]!.slots[0]!.kind).toBe("fixed");
    expect(detail.pages[1]!.slots).toHaveLength(2);
    expect(detail.pages[1]!.slots.map((s) => s.kind)).toEqual(["ruled", "ab"]);

    await activate(env, quotePublicId);

    const shellRes = await get(env, "/lg");
    expect(shellRes.status, `shell: ${await shellRes.clone().text()}`).toBe(200);
    const shellHtml = await shellRes.text();
    // ALL 5 candidate sections ship server-rendered (hidden until the
    // attempt-time plan reveals the winner) — the visitor-invariant shell.
    for (const s of [fixedSection, ruledCA, ruledElse, abA, abB]) {
      expect(shellHtml).toContain(s.public_id);
    }

    const attemptRes = await get(env, `/lg/attempt?vid=${variantId}`);
    expect(attemptRes.status, `attempt: ${await attemptRes.clone().text()}`).toBe(200);
    const attempt = (await attemptRes.json()) as {
      funnel_attempt_id: string;
      signed_config_token: string;
      page_plan?: Array<{ page_id: string; slot_id: number; section_public_id: string; assignment_reason: string }>;
    };
    expect(attempt.funnel_attempt_id.startsWith("att_")).toBe(true);
    expect(attempt.page_plan).toBeDefined();
    // page 1's fixed slot always resolves to the fixed section.
    const page1Winner = attempt.page_plan!.find((w) => w.section_public_id === fixedSection.public_id);
    expect(page1Winner?.assignment_reason).toBe("fixed");
    // page 2 resolves EXACTLY 2 winners (one per slot): the ruled slot
    // (no state header in this harness -> falls to the default) + the A/B slot.
    const page2Winners = attempt.page_plan!.filter((w) => w.page_id !== page1Winner!.page_id);
    expect(page2Winners).toHaveLength(2);
    const ruledWinner = page2Winners.find((w) => w.assignment_reason === "slot_rule");
    expect(ruledWinner?.section_public_id).toBe(ruledElse.public_id); // no CA header -> default
    const abWinner = page2Winners.find((w) => w.assignment_reason === "slot_ab");
    expect(abWinner).toBeDefined();
    expect([abA.public_id, abB.public_id]).toContain(abWinner!.section_public_id);
  });

  it("a slot rule referencing an answer field is REJECTED with plain language, never persisted", async () => {
    const { sdb, env } = newHarness();
    const { variantId } = await seedQuote(env);
    const s1 = seedSection(sdb, "fixedone");
    const s2 = seedSection(sdb, "ruledtwo");
    const putRes = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", {
        pages: [
          {
            name: "P1",
            slots: [
              {
                kind: "ruled",
                cases: [{ conditions: { groups: [{ field: "homeowner", op: "eq", value: true }] }, section_id: s1.public_id }],
                default_section_id: s2.public_id,
              },
            ],
          },
        ],
      }),
      env,
    );
    expect(putRes.status).toBe(400);
    const body = (await putRes.json()) as { fields: Record<string, string> };
    const messages = Object.values(body.fields);
    expect(messages.some((m) => m === "answer-based visibility lives on the section's own show/hide rules")).toBe(true);
  });

  it("an A/B slot whose allocations don't sum to 10000 is REJECTED", async () => {
    const { sdb, env } = newHarness();
    const { variantId } = await seedQuote(env);
    const a = seedSection(sdb, "aa");
    const b = seedSection(sdb, "bb");
    const putRes = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", {
        pages: [{ name: "P1", slots: [{ kind: "ab", allocations: [{ section_id: a.public_id, bp: 4000 }, { section_id: b.public_id, bp: 4000 }] }] }],
      }),
      env,
    );
    expect(putRes.status).toBe(400);
  });

  it("pages and sections cannot both be provided in the same save", async () => {
    const { sdb, env } = newHarness();
    const { variantId } = await seedQuote(env);
    const s = seedSection(sdb, "both");
    const putRes = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { sections: [{ section_id: s.id }], pages: [{ slots: [{ kind: "fixed", section_id: s.public_id }] }] }),
      env,
    );
    expect(putRes.status).toBe(400);
  });

  it("editing a ruled slot's conditions bumps its slot_revision; an untouched slot keeps its revision", async () => {
    const { sdb, env } = newHarness();
    const { variantId } = await seedQuote(env);
    const ca = seedSection(sdb, "revCA");
    const other = seedSection(sdb, "revOther");
    const fixed = seedSection(sdb, "revFixed");
    const body1 = {
      pages: [
        { name: "P1", slots: [{ kind: "fixed", section_id: fixed.public_id }] },
        {
          name: "P2",
          slots: [{ kind: "ruled", cases: [{ conditions: { groups: [{ field: "state", op: "eq", value: "CA" }] }, section_id: ca.public_id }], default_section_id: other.public_id }],
        },
      ],
    };
    const put1 = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", body1), env);
    expect(put1.status).toBe(200);
    const detail1 = (await put1.json()) as { pages: Array<{ slots: Array<{ slot_revision: number }> }> };
    expect(detail1.pages[1]!.slots[0]!.slot_revision).toBe(0);

    // Re-save with the SAME body (untouched) -- revision must NOT bump.
    const put2 = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", body1), env);
    const detail2 = (await put2.json()) as { pages: Array<{ slots: Array<{ slot_revision: number }> }> };
    expect(detail2.pages[1]!.slots[0]!.slot_revision).toBe(0);

    // Now edit page 2's ruled slot condition (CA -> NY) -- revision bumps.
    const body2 = {
      pages: [
        { name: "P1", slots: [{ kind: "fixed", section_id: fixed.public_id }] },
        {
          name: "P2",
          slots: [{ kind: "ruled", cases: [{ conditions: { groups: [{ field: "state", op: "eq", value: "NY" }] }, section_id: ca.public_id }], default_section_id: other.public_id }],
        },
      ],
    };
    const put3 = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", body2), env);
    const detail3 = (await put3.json()) as { pages: Array<{ slots: Array<{ slot_revision: number }> }> };
    expect(detail3.pages[1]!.slots[0]!.slot_revision).toBe(1);
  });

  // Round-4 P3a item 4 (P3b-found coherence gap): the legacy `sections`
  // replace-set used to leave a page-bearing variant's page/slot rows
  // ORPHANED (nothing re-linked once variant_sections rows were replaced).
  it("posting `sections` to a page-bearing variant rebuilds pages as wraps -- no orphaned page/slot rows survive", async () => {
    const { sdb, env } = newHarness();
    const { variantId } = await seedQuote(env);
    const abA = seedSection(sdb, "wrapAbA");
    const abB = seedSection(sdb, "wrapAbB");
    const flat1 = seedSection(sdb, "wrapFlat1");
    const flat2 = seedSection(sdb, "wrapFlat2");

    // Give the variant a REAL page-bearing structure first -- an A/B slot,
    // something the flat `sections` contract could never itself produce.
    const pagesPut = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", {
        pages: [{ name: "P1", slots: [{ kind: "ab", allocations: [{ section_id: abA.public_id, bp: 5000 }, { section_id: abB.public_id, bp: 5000 }] }] }],
      }),
      env,
    );
    expect(pagesPut.status, `put pages: ${await pagesPut.clone().text()}`).toBe(200);

    const variantRow = sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(variantId) as { id: number };
    const beforePages = sdb.prepare("SELECT COUNT(*) as n FROM leadgen_funnel_pages WHERE variant_id = ?").get(variantRow.id) as { n: number };
    expect(beforePages.n).toBe(1); // the one A/B page

    // Now save via the LEGACY flat `sections` contract -- a caller that has
    // never heard of `pages` editing a variant that already has real ones.
    const sectionsPut = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { sections: [{ section_id: flat1.id }, { section_id: flat2.id }] }),
      env,
    );
    expect(sectionsPut.status, `put sections: ${await sectionsPut.clone().text()}`).toBe(200);
    const detail = (await sectionsPut.json()) as {
      pages: Array<{ slots: Array<{ kind: string; candidates: Array<{ section_id: string }> }> }>;
    };

    // Rebuilt as ONE page + one fixed slot PER section -- the same shape a
    // fresh migration backfill produces -- never the stale A/B structure.
    expect(detail.pages).toHaveLength(2);
    for (const page of detail.pages) {
      expect(page.slots).toHaveLength(1);
      expect(page.slots[0]!.kind).toBe("fixed");
      expect(page.slots[0]!.candidates).toHaveLength(1);
    }
    const wrappedSectionIds = new Set(detail.pages.flatMap((p) => p.slots[0]!.candidates.map((c) => c.section_id)));
    expect(wrappedSectionIds).toEqual(new Set([flat1.public_id, flat2.public_id]));

    // NO ORPHANS at the DB level: exactly 2 page rows / 2 slot rows survive
    // (one per section) -- 1 (stale AB) + 2 (new) = 3 would mean the DELETE
    // never ran and the rebuild was merely additive.
    const afterPages = sdb.prepare("SELECT COUNT(*) as n FROM leadgen_funnel_pages WHERE variant_id = ?").get(variantRow.id) as { n: number };
    expect(afterPages.n).toBe(2);
    const afterSlots = sdb
      .prepare(
        "SELECT COUNT(*) as n FROM leadgen_funnel_page_slots s JOIN leadgen_funnel_pages p ON p.id = s.page_id WHERE p.variant_id = ?",
      )
      .get(variantRow.id) as { n: number };
    expect(afterSlots.n).toBe(2);
  });
});

// ===========================================================================
// Round-4 P3a review round (adversarial minor-3): fork/duplicate must clone
// the source variant's REAL page/slot structure — an A/B or ruled slot used
// to silently flatten into sequential MANDATORY single-candidate pages
// (forkVariantHandler/duplicateQuoteHandler used to clone bare
// leadgen_funnel_variant_sections rows via readVariantSections, never the
// page/slot tables).
// ===========================================================================

describeDb("fork/duplicate page fidelity (Round-4 P3a review round minor-3)", () => {
  it("forking a variant with an A/B slot clones an EQUIVALENT A/B slot (own ids, revision 0); source untouched", async () => {
    const { sdb, env } = newHarness();
    const { variantId } = await seedQuote(env);
    const abA = seedSection(sdb, "forkAbA");
    const abB = seedSection(sdb, "forkAbB");

    const putRes = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", {
        pages: [{ name: "P1", slots: [{ kind: "ab", allocations: [{ section_id: abA.public_id, bp: 5000 }, { section_id: abB.public_id, bp: 5000 }] }] }],
      }),
      env,
    );
    expect(putRes.status, `put pages: ${await putRes.clone().text()}`).toBe(200);
    const before = (await putRes.json()) as {
      pages: Array<{ page_id: string; slots: Array<{ slot_id: number; slot_revision: number; kind: string; candidates: Array<{ section_id: string }> }> }>;
    };
    const sourcePage = before.pages[0]!;
    const sourceSlot = sourcePage.slots[0]!;
    expect(sourceSlot.kind).toBe("ab");

    const forkRes = await admin.request(`${API}/variants/${variantId}/fork`, jsonInit("POST", {}), env);
    expect(forkRes.status, `fork: ${await forkRes.clone().text()}`).toBe(201);
    const forked = (await forkRes.json()) as {
      pages: Array<{ page_id: string; slots: Array<{ slot_id: number; slot_revision: number; kind: string; candidates: Array<{ section_id: string }> }> }>;
    };

    expect(forked.pages).toHaveLength(1);
    const forkedSlot = forked.pages[0]!.slots[0]!;
    // EQUIVALENT structure: same kind, same candidate set -- NOT flattened
    // into two sequential mandatory fixed pages.
    expect(forkedSlot.kind).toBe("ab");
    expect(new Set(forkedSlot.candidates.map((c) => c.section_id))).toEqual(new Set(sourceSlot.candidates.map((c) => c.section_id)));
    // OWN ids (never the source's) + a fresh revision-0 lineage.
    expect(forked.pages[0]!.page_id).not.toBe(sourcePage.page_id);
    expect(forkedSlot.slot_id).not.toBe(sourceSlot.slot_id);
    expect(forkedSlot.slot_revision).toBe(0);

    // Source UNTOUCHED: a read-only PUT ({} body -- no sections/pages/rules
    // key, so neither replace-set branch runs) re-reads the SAME page/slot
    // ids + revision as before the fork.
    const reread = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", {}), env);
    expect(reread.status).toBe(200);
    const after = (await reread.json()) as { pages: Array<{ page_id: string; slots: Array<{ slot_id: number; slot_revision: number }> }> };
    expect(after.pages[0]!.page_id).toBe(sourcePage.page_id);
    expect(after.pages[0]!.slots[0]!.slot_id).toBe(sourceSlot.slot_id);
    expect(after.pages[0]!.slots[0]!.slot_revision).toBe(sourceSlot.slot_revision);
  });

  it("duplicating a quote clones an EQUIVALENT A/B slot on the new quote's variant (own ids, revision 0); source untouched", async () => {
    const { sdb, env } = newHarness();
    const { quotePublicId, variantId } = await seedQuote(env);
    const abA = seedSection(sdb, "dupAbA");
    const abB = seedSection(sdb, "dupAbB");

    const putRes = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", {
        pages: [{ name: "P1", slots: [{ kind: "ab", allocations: [{ section_id: abA.public_id, bp: 5000 }, { section_id: abB.public_id, bp: 5000 }] }] }],
      }),
      env,
    );
    expect(putRes.status, `put pages: ${await putRes.clone().text()}`).toBe(200);
    const before = (await putRes.json()) as {
      pages: Array<{ page_id: string; slots: Array<{ slot_id: number; slot_revision: number; kind: string; candidates: Array<{ section_id: string }> }> }>;
    };
    const sourcePage = before.pages[0]!;
    const sourceSlot = sourcePage.slots[0]!;

    const dupRes = await admin.request(`${API}/quotes/${quotePublicId}/duplicate`, jsonInit("POST", {}), env);
    expect(dupRes.status, `duplicate: ${await dupRes.clone().text()}`).toBe(201);
    const dup = (await dupRes.json()) as { funnels: Array<{ variants: Array<{ public_id: string }> }> };
    const newVariantId = dup.funnels[0]!.variants[0]!.public_id;

    // duplicateQuoteHandler's own response uses the shallow variantRowToApi
    // (no pages) -- read the new variant's FULL detail via the same read-
    // only-PUT trick used for the source below.
    const newDetailRes = await admin.request(`${API}/variants/${newVariantId}`, jsonInit("PUT", {}), env);
    expect(newDetailRes.status).toBe(200);
    const newDetail = (await newDetailRes.json()) as {
      pages: Array<{ page_id: string; slots: Array<{ slot_id: number; slot_revision: number; kind: string; candidates: Array<{ section_id: string }> }> }>;
    };
    expect(newDetail.pages).toHaveLength(1);
    const newSlot = newDetail.pages[0]!.slots[0]!;
    expect(newSlot.kind).toBe("ab");
    expect(new Set(newSlot.candidates.map((c) => c.section_id))).toEqual(new Set(sourceSlot.candidates.map((c) => c.section_id)));
    expect(newDetail.pages[0]!.page_id).not.toBe(sourcePage.page_id);
    expect(newSlot.slot_id).not.toBe(sourceSlot.slot_id);
    expect(newSlot.slot_revision).toBe(0);

    // Source quote's ORIGINAL variant untouched.
    const rereadSource = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", {}), env);
    const afterSource = (await rereadSource.json()) as { pages: Array<{ page_id: string; slots: Array<{ slot_id: number; slot_revision: number }> }> };
    expect(afterSource.pages[0]!.page_id).toBe(sourcePage.page_id);
    expect(afterSource.pages[0]!.slots[0]!.slot_id).toBe(sourceSlot.slot_id);
    expect(afterSource.pages[0]!.slots[0]!.slot_revision).toBe(sourceSlot.slot_revision);
  });
});

// ===========================================================================
// page_plan_hash dual-accept window (an absent hash — pre-P3a in-flight
// token shape — skips the auction-side equality check entirely)
// ===========================================================================

describe("page_plan_hash — dual-accept window (decode-level)", () => {
  it("a v2 token payload with NO page_plan_hash key decodes to page_plan_hash: ''", async () => {
    // Mirrors a token minted by the pre-P3a code (no page_plan_hash field in
    // the signed payload at all) -- verifyConfigTokenDetailed must decode it
    // WITHOUT that key present and still verify the OTHER 7 tuple fields.
    const tuple: ConfigTokenTuple = {
      funnel_variant_id: "lgn_test",
      section_order_hash: "abc",
      content_version: 1,
      funnel_attempt_id: "att_test",
      session_id: "",
      answer_mapping_hash: "def",
      auction_config_version: "",
    };
    const payload = JSON.stringify({ ...tuple, landing_url: "" }); // NO page_plan_hash key
    const b64 = Buffer.from(payload).toString("base64url");
    const secret = "test-secret";
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
    const sigB64 = Buffer.from(sig).toString("base64url");
    const token = `v2.${b64}.${sigB64}`;
    const env = { LEADGEN_CONFIG_SIGNING_KEY: secret } as unknown as Env;
    const verification = await verifyConfigTokenDetailed(env, token, tuple, { requireSigned: true });
    expect(verification.ok).toBe(true);
    expect(verification.page_plan_hash).toBe("");
  });
});
