// LeadGen Round-4 Remediation — Phase P1 slice P1c (A-2 lifecycle / A-8+P-9
// jargon / A-7 columnsDefault seam). Request-level tests over the REAL admin
// router + REAL 0036-0041 migrations (node:sqlite harness, the
// leadgen-quotes-api.test.ts / leadgen-auctions-api.test.ts pattern):
//
//   1. validateSection messages humanized — fail-before/pass-after: the OLD
//      raw snake_case string is ABSENT from the pure validator AND the live
//      POST /sections 400 body (rows R4-13/R4-42).
//   2. design_overrides.columnsDefault: 0/6/999/non-integer rejected with the
//      plain-language message; 1..5 accepted (row R4-41, the P1b renderer-
//      clamp seam — P1b widened the render/content-schema clamps to 1..5,
//      this Section-level default was the P1c leg).
//   3. sections-handlers.ts answer_maps[] sweep messages humanized.
//   4. duplicateSectionHandler — coherent content copy, fresh id, "(copy)",
//      PLUS (fix-round ruling) its own answer_maps/available_offers rows
//      re-keyed to the new section id; the source rows stay untouched.
//   4b. DELETE /sections/:id — guarded hard delete (fix-round-2 ruling, a
//      P1d-discovered gap; fix-round-3 expanded the guard; adversarial-
//      review finding 5 made the guard+delete ONE atomic conditional SQL
//      statement, race-free): unreferenced -> true hard delete (row + owned
//      answer_maps/available_offers rows GONE, proven to survive intact
//      when the delete is instead BLOCKED — not just the section row);
//      referenced by a funnel variant OR a rule's target_section_id -> 409
//      plain-language with usage.{variants,rules}; PATCH-to-archived stays
//      reachable regardless of usage (the guard is DELETE-only, status-
//      independent).
//   5. duplicateQuoteHandler — deep copy funnels/variants/sections/rules;
//      site activations/analytics/ab-tests NOT copied — Rework M1 (§4.3-10,
//      "no control concept anywhere") widened this: a duplicate now copies
//      EVERY ACTIVE variant of each source funnel (readActiveFunnelVariants),
//      each forced to traffic_allocation_bp=10000 regardless of the source's
//      own split, since a fresh clone starts as a no-test draft
//      (adversarial-review finding 4, rework).
//   6. Quote archive->reactivate (PATCH status flip, already unrestricted)
//      + guarded DELETE (409 plain-language with live history; 200 archived
//      without).
//   7. Auction archive->reactivate + guarded DELETE (409 when a live variant
//      references it; 200 archived without).
//   8. quoteUsageHandler / auctionUsageHandler where-used response shapes
//      (offers usage report shape: {kinds[], delete_eligibility}).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { isPublicId, mintPublicId } from "../src/leadgen/ids";
import { validateSection } from "../src/leadgen/sections";

// --- node:sqlite harness (repo pattern, leadgen-quotes-api.test.ts) ----------

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

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  } as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(): { sdb: SqliteDb; env: Env } {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createLeadgenDb(ctor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// --- fixtures -----------------------------------------------------------------

// The leadgen-section-overrides-save.test.ts GRID_CONTENT fixture — already
// proven to pass validateSectionContent end-to-end through POST /sections.
const GRID_CONTENT = {
  components: [
    {
      type: "IconCardAnswerGrid",
      question_id: "g1",
      question_key: "coverage_q",
      internal_field: "coverage",
      answer_type: "enum",
      choices: [
        { label: "Up to $250k", value: "250k", analytics_id: "a_250", icon: "S" },
        { label: "Up to $1m", value: "1m", analytics_id: "a_1m", icon: "L" },
      ],
    },
    { type: "ContinueButton", question_id: "c1", props: { label: "Continue" } },
  ],
};

function sectionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    section_name: "Coverage",
    activity: "quote_funnel",
    vertical: "life",
    headline_text: "How much coverage?",
    content_json: JSON.stringify(GRID_CONTENT),
    ...overrides,
  };
}

interface SectionJson {
  id: number;
  public_id: string;
  section_name: string;
  content_json: unknown;
  status: string;
  available_offers: Array<{ offer_id: number; selected: boolean }>;
  answer_maps: Array<{ public_id: string; offer_id: number; offer_payload_field_path: string }>;
}

async function createSection(env: Env, overrides: Record<string, unknown> = {}): Promise<SectionJson> {
  const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody(overrides)), env);
  expect(res.status, `create section: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as SectionJson;
}

// --- fixtures for a MAPPED section (leadgen-sections-api.test.ts pattern) ----
// A boolean-required schema the Section maps into: data.insured (required).
const OFFER_SCHEMA = {
  version: 1,
  root: {
    type: "object",
    children: [
      { path: "data.insured", name: "insured", type: "boolean", required: true, source: "answer", internal_field: "insured" },
    ],
  },
};

interface OfferDetail {
  id: number;
  public_id: string;
  [key: string]: unknown;
}

async function createOffer(env: Env, overrides: Record<string, unknown> = {}): Promise<OfferDetail> {
  const res = await admin.request(
    `${API}/offers`,
    jsonInit("POST", {
      offer_name: "Life Offer",
      activity: "quote_funnel",
      vertical: "life",
      conversion_tracking_method: "s2s_postback",
      offer_type: "cpl",
      placements: [`pl-${mintPublicId("offer").slice(-8)}`],
      calls_provider_api: true,
      bid_source: "static",
      cap_enabled: false,
      ...overrides,
    }),
    env,
  );
  expect(res.status, `create offer: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as OfferDetail;
}

// Create an Offer + give it an ACTIVE boolean-required payload schema (so a
// Section can map into it — payload_schema_id is a NOT NULL FK).
async function createMappableOffer(env: Env, overrides: Record<string, unknown> = {}): Promise<OfferDetail> {
  const offer = await createOffer(env, overrides);
  const res = await admin.request(
    `${API}/offers/${offer.id}/payload-schemas`,
    jsonInit("POST", { schema_json: OFFER_SCHEMA }),
    env,
  );
  expect(res.status, `post schema: ${await res.clone().text()}`).toBe(201);
  return offer;
}

const YESNO_CONTENT = {
  components: [
    { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
  ],
};

function mapEdge(offerId: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    question_id: "q1",
    offer_id: offerId,
    offer_payload_field_path: "data.insured",
    provider_expected_type: "boolean",
    required_for_offer: true,
    output_value_map: { true: true, false: false },
    ...overrides,
  };
}

interface VariantJson {
  id: number;
  public_id: string;
  funnel_variant_id: string;
  variant_label: string;
  traffic_allocation_bp: number;
  auction_id: number | null;
  [key: string]: unknown;
}
interface FunnelJson {
  id: number;
  public_id: string;
  funnel_name: string;
  variants: VariantJson[];
  [key: string]: unknown;
}
interface QuoteJson {
  id: number;
  public_id: string;
  quote_name: string;
  activity: string;
  verticals_json: string[];
  status: string;
  funnels: FunnelJson[];
}

async function createQuote(env: Env, overrides: Record<string, unknown> = {}): Promise<QuoteJson> {
  const res = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Life Quote", activity: "quote_funnel", verticals: ["life"], ...overrides }),
    env,
  );
  expect(res.status, `create quote: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as QuoteJson;
}

interface AuctionJson {
  id: number;
  public_id: string;
  auction_name: string;
  quote_id: number | null;
  status: string;
  [key: string]: unknown;
}

async function createAuction(env: Env, body: Record<string, unknown>): Promise<AuctionJson> {
  const res = await admin.request(`${API}/auctions`, jsonInit("POST", body), env);
  expect(res.status, `create auction: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as AuctionJson;
}

function seedQuoteAnalytics(sdb: SqliteDb, quotePublicId: string, funnelId: string): void {
  sdb
    .prepare(
      `INSERT INTO leadgen_analytics_quote (quote_public_id, funnel_id, funnel_name, date, visits, unique_visits, bounces, completions, clicks, conversions, unfilled, revenue)
       VALUES (?, ?, 'A', '2026-07-01', 10, 10, 0, 5, 5, 2, 1, 40)`,
    )
    .run(quotePublicId, funnelId);
}

// Direct-SQL activation seeding (not the real PUT /activation endpoint): the
// guard under test only checks leadgen_site_quotes ROW EXISTENCE, and going
// through the real endpoint would entangle these tests with the UNRELATED
// activation-preflight gate (computeQuoteActivationPreflight) — the same
// direct-seed idiom seedSection/seedOffer/seedAuction already use in
// leadgen-quotes-api.test.ts for fixtures that are preconditions, not the
// system under test.
function seedSiteQuote(sdb: SqliteDb, quoteId: number, siteId = "site-1"): void {
  sdb
    .prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled) VALUES (?, ?, 1)")
    .run(siteId, quoteId);
}

// ===========================================================================
// 1. validateSection messages humanized (A-8/P-9, rows R4-13/R4-42)
// ===========================================================================

describe("validateSection — humanized save-error messages (A-8/P-9)", () => {
  it("required top-level fields: plain language, raw snake_case id ABSENT", () => {
    const { errors } = validateSection({});
    expect(errors.section_name).toBe("Section name is required");
    expect(errors.activity).toBe("Activity is required");
    expect(errors.vertical).toBe("Vertical is required");
    expect(errors.headline_text).toBe("Headline is required");
    // fail-before/pass-after: the OLD raw-id strings must be gone. "activity"/
    // "vertical" have no underscore to strip, so the pre-change and humanized
    // text differ only by capitalization — assert the exact capitalized string
    // (already done above) plus the lowercase-first-letter form is absent.
    expect(errors.section_name).not.toContain("section_name");
    expect(errors.headline_text).not.toContain("headline_text");
    expect(errors.activity?.startsWith("activity ")).toBe(false);
    expect(errors.vertical?.startsWith("vertical ")).toBe(false);
  });

  it("subheadline_text / image_json / continue_mode / address_validation_enabled / status humanized", () => {
    const base = {
      section_name: "S",
      activity: "quote_funnel",
      vertical: "life",
      headline_text: "H",
      content_json: JSON.stringify(GRID_CONTENT),
    };
    expect(validateSection({ ...base, subheadline_text: 123 }).errors.subheadline_text).toBe(
      "Subheadline must be a non-empty string or null",
    );
    expect(validateSection({ ...base, image_json: "{not json" }).errors.image_json).toBe(
      "Image must be valid JSON",
    );
    expect(validateSection({ ...base, image_json: 42 }).errors.image_json).toBe(
      "Image must be an object or JSON string",
    );
    expect(validateSection({ ...base, continue_mode: "bogus" }).errors.continue_mode).toBe(
      "Continue mode must be one of Wait for Continue or Go to next",
    );
    expect(validateSection({ ...base, address_validation_enabled: "yes" }).errors.address_validation_enabled).toBe(
      "Address validation must be a boolean",
    );
    expect(validateSection({ ...base, status: "bogus" }).errors.status).toBe(
      "Status must be one of active|archived",
    );
    expect(validateSection({ ...base, content_json: "" }).errors.content_json).toBe("Content is required");
    expect(validateSection({ ...base, content_json: "{not json" }).errors.content_json).toBe(
      "Content must be valid JSON",
    );
    expect(validateSection({ ...base, design_overrides_json: "{not json" }).errors.design_overrides_json).toBe(
      "Design overrides must be valid JSON",
    );
    // a non-string, non-record value skips the JSON.parse leg entirely and
    // hits the isRecord() shape check directly (a JSON-parseable-but-invalid
    // string like "not-an-object" would instead hit the JSON-parse-error
    // branch above — this asserts the OTHER branch).
    expect(validateSection({ ...base, design_overrides: 42 }).errors.design_overrides_json).toBe(
      "Design overrides must be an object of curated token keys",
    );
  });

  it("field KEYS in the `fields` object stay the raw snake_case ids (the studio maps/links by key)", () => {
    const { errors } = validateSection({});
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining(["section_name", "activity", "vertical", "headline_text"]),
    );
  });
});

describeDb("POST /sections — live 400 body carries the humanized messages", () => {
  it("empty body: fields keyed raw, messages humanized", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/sections`, jsonInit("POST", {}), env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(body.fields.section_name).toBe("Section name is required");
    expect(body.fields.headline_text).toBe("Headline is required");
    expect(body.fields.section_name).not.toMatch(/section_name/);
    expect(body.fields.headline_text).not.toMatch(/headline_text/);
  });
});

// ===========================================================================
// 2. design_overrides.columnsDefault — 1..5 (A-7, row R4-41 — the P1b seam)
// ===========================================================================

describe("validateSection — design_overrides.columnsDefault range (A-7, row R4-41)", () => {
  const validate = (columnsDefault: unknown): Record<string, string> =>
    validateSection(
      sectionBody({ design_overrides: { columnsDefault } }),
    ).errors as Record<string, string>;

  it("rejects 0, 6, 999, and non-integers with the plain-language message", () => {
    for (const bad of [0, 6, 999, 3.5, "3", true, null]) {
      const errors = validate(bad);
      expect(errors["design_overrides.columnsDefault"], `columnsDefault=${String(bad)}`).toBe(
        "Columns must be between 1 and 5",
      );
    }
  });

  it("accepts every integer 1..5 (the P1b-widened renderer clamp)", () => {
    for (const good of [1, 2, 3, 4, 5]) {
      expect(validate(good)["design_overrides.columnsDefault"], `columnsDefault=${good}`).toBeUndefined();
    }
  });
});

// ===========================================================================
// 3. sections-handlers.ts answer_maps[] sweep messages humanized
// ===========================================================================

describeDb("sections-handlers.ts answer_maps[] sweep messages (A-8/P-9 sweep)", () => {
  it("POST /sections with a bare {} answer_map entry: humanized Question ID message", async () => {
    const { env } = newHarness();
    const res = await admin.request(
      `${API}/sections`,
      jsonInit("POST", sectionBody({ answer_maps: [{}] })),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(body.fields["answer_maps[0].question_id"]).toBe("Question ID is required");
    expect(body.fields["answer_maps[0].question_id"]).not.toMatch(/question_id/);
  });

  it("POST /sections with a non-array answer_maps: humanized Answer maps message", async () => {
    const { env } = newHarness();
    const res = await admin.request(
      `${API}/sections`,
      jsonInit("POST", sectionBody({ answer_maps: "not-an-array" })),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(body.fields["answer_maps"]).toBe("Answer maps must be an array");
  });
});

// ===========================================================================
// 4. duplicateSectionHandler (A-2, row R4-02)
// ===========================================================================

describeDb("POST /sections/:id/duplicate (A-2, row R4-02)", () => {
  it("produces a coherent copy: fresh id, name+(copy), identical content_json, status active", async () => {
    const { env } = newHarness();
    const src = await createSection(env, { section_name: "Original" });

    const res = await admin.request(`${API}/sections/${src.public_id}/duplicate`, jsonInit("POST", {}), env);
    expect(res.status, await res.clone().text()).toBe(201);
    const dup = (await res.json()) as SectionJson & { duplicated_from: { public_id: string; name: string } };

    expect(dup.public_id).not.toBe(src.public_id);
    expect(dup.id).not.toBe(src.id);
    expect(dup.section_name).toBe("Original (copy)");
    expect(dup.content_json).toEqual(src.content_json);
    expect(dup.status).toBe("active");
    expect(dup.duplicated_from).toEqual({ id: src.id, public_id: src.public_id, name: "Original" });

    // the original is untouched.
    const original = await admin.request(`${API}/sections/${src.public_id}`, {}, env);
    expect(((await original.json()) as SectionJson).section_name).toBe("Original");
  });

  it("honors an explicit section_name override", async () => {
    const { env } = newHarness();
    const src = await createSection(env);
    const res = await admin.request(
      `${API}/sections/${src.public_id}/duplicate`,
      jsonInit("POST", { section_name: "Custom Name" }),
      env,
    );
    expect((await res.json() as SectionJson).section_name).toBe("Custom Name");
  });

  it("also copies the section's own answer_maps + available_offers, re-keyed to the new section id — the source rows are untouched (fix-round ruling)", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const src = await createSection(env, {
      section_name: "Mapped",
      headline_text: "Are you insured?",
      content_json: JSON.stringify(YESNO_CONTENT),
      answer_maps: [mapEdge(offer.id)],
    });
    expect(src.answer_maps).toHaveLength(1);
    expect(src.available_offers).toHaveLength(1);
    expect(src.available_offers[0]!.offer_id).toBe(offer.id);

    const res = await admin.request(`${API}/sections/${src.public_id}/duplicate`, jsonInit("POST", {}), env);
    expect(res.status, await res.clone().text()).toBe(201);
    const dup = (await res.json()) as SectionJson & { copied: { available_offers: number; answer_maps: number } };

    expect(dup.copied).toEqual({ available_offers: 1, answer_maps: 1 });
    expect(dup.available_offers).toHaveLength(1);
    expect(dup.available_offers[0]!.offer_id).toBe(offer.id);
    expect(dup.answer_maps).toHaveLength(1);
    expect(dup.answer_maps[0]!.offer_id).toBe(offer.id);
    expect(dup.answer_maps[0]!.offer_payload_field_path).toBe("data.insured");
    // re-keyed: the copy's answer-map row mints its OWN fresh public_id.
    expect(dup.answer_maps[0]!.public_id).not.toBe(src.answer_maps[0]!.public_id);
    expect(isPublicId("answer_field_map", dup.answer_maps[0]!.public_id)).toBe(true);

    // the ORIGINAL section's rows are untouched (equal counts, same identity).
    const reread = await admin.request(`${API}/sections/${src.public_id}`, {}, env);
    const rereadBody = (await reread.json()) as SectionJson;
    expect(rereadBody.available_offers).toHaveLength(1);
    expect(rereadBody.answer_maps).toHaveLength(1);
    expect(rereadBody.answer_maps[0]!.public_id).toBe(src.answer_maps[0]!.public_id);
  });

  it("404 on an unknown section id", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/sections/lgs_00000000000000000000000000/duplicate`, jsonInit("POST", {}), env);
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 4b. DELETE /sections/:id — guarded hard delete (Round-4 P1d-discovered
//     gap, A-2): in line with the quote/auction lifecycle pattern above.
// ===========================================================================

describeDb("DELETE /sections/:id — guarded hard delete (P1d gap fix)", () => {
  it("unreferenced section: 200, the row + its answer_maps/available_offers are GONE on re-read", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const section = await createSection(env, {
      section_name: "Unreferenced",
      headline_text: "Are you insured?",
      content_json: JSON.stringify(YESNO_CONTENT),
      answer_maps: [mapEdge(offer.id)],
    });
    expect(section.answer_maps).toHaveLength(1);
    expect(section.available_offers).toHaveLength(1);

    const del = await admin.request(`${API}/sections/${section.public_id}`, { method: "DELETE" }, env);
    expect(del.status, await del.clone().text()).toBe(200);
    expect(await del.json()).toEqual({ ok: true, id: section.id, public_id: section.public_id, deleted: "hard" });

    const reread = await admin.request(`${API}/sections/${section.public_id}`, {}, env);
    expect(reread.status).toBe(404);
  });

  it("referenced by a quote variant: 409 plain-language, section stays present", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const section = await createSection(env, { section_name: "In use" });
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { sections: [{ section_id: section.id }] }),
      env,
    );

    const del = await admin.request(`${API}/sections/${section.public_id}`, { method: "DELETE" }, env);
    expect(del.status).toBe(409);
    const body = (await del.json()) as {
      error: string;
      usage: { variants: Array<{ quote_name: string }>; rules: unknown[] };
    };
    expect(body.error).toBe("This section is used by quotes — archive it instead");
    expect(body.usage.variants).toHaveLength(1);
    expect(body.usage.variants[0]!.quote_name).toBe("Life Quote");
    expect(body.usage.rules).toHaveLength(0);

    const stillThere = await admin.request(`${API}/sections/${section.public_id}`, {}, env);
    expect(stillThere.status).toBe(200);
  });

  it("referenced ONLY by a funnel rule's target_section_id (fix-round-3 guard expansion, NOT placed in any variant order): 409; detaching the rule allows DELETE 200", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const section = await createSection(env, { section_name: "Rule target only" });
    const variantId = quote.funnels[0]!.variants[0]!.public_id;

    // A rule targeting the section WITHOUT the section ever being placed in
    // the variant's ordered `sections` list — the two references
    // (leadgen_funnel_variant_sections vs leadgen_funnel_rules.
    // target_section_id) are independent.
    // Rework M3: skip_section is no longer a valid leadgen_funnel_rules type
    // (CHECK tightened to the 4 auction-domain types) — swapped to
    // eligibility. target_section_id is a generic, non-type-gated column
    // (quotes-handlers.ts parses it the same for every rule_type), so this
    // test's point (a rule referencing a section via target_section_id
    // blocks deletion) is unaffected by which type carries it.
    const putRes = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { rules: [{ rule_type: "eligibility", target_section_id: section.id }] }),
      env,
    );
    expect(putRes.status, await putRes.clone().text()).toBe(200);

    const del = await admin.request(`${API}/sections/${section.public_id}`, { method: "DELETE" }, env);
    expect(del.status, await del.clone().text()).toBe(409);
    const body = (await del.json()) as {
      error: string;
      usage: { variants: unknown[]; rules: Array<{ id: number; name: string; link: string }> };
    };
    expect(body.error).toBe("This section is used by quotes — archive it instead");
    expect(body.usage.variants).toHaveLength(0); // NOT in any variant's section order
    expect(body.usage.rules).toHaveLength(1);
    expect(body.usage.rules[0]!.name).toContain("Life Quote");
    expect(body.usage.rules[0]!.link).toContain(quote.public_id);

    // detach: replace the variant's rules with an empty set.
    const detach = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { rules: [] }), env);
    expect(detach.status, await detach.clone().text()).toBe(200);

    const del2 = await admin.request(`${API}/sections/${section.public_id}`, { method: "DELETE" }, env);
    expect(del2.status, await del2.clone().text()).toBe(200);
  });

  it("archive stays available for the referenced section (PATCH status archived -> 200); the guard is unaffected by status", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const section = await createSection(env, { section_name: "Archivable" });
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { sections: [{ section_id: section.id }] }),
      env,
    );

    const archive = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { status: "archived" }),
      env,
    );
    expect(archive.status, await archive.clone().text()).toBe(200);
    expect(((await archive.json()) as SectionJson).status).toBe("archived");

    // still referenced -> DELETE is STILL refused (status has no bearing on the guard).
    const del = await admin.request(`${API}/sections/${section.public_id}`, { method: "DELETE" }, env);
    expect(del.status).toBe(409);
  });

  it("404 on an unknown section id", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/sections/lgs_00000000000000000000000000`, { method: "DELETE" }, env);
    expect(res.status).toBe(404);
  });

  it("adversarial-review finding 5: the atomic conditional DELETE touches NOTHING when referenced (not just the section row — its own answer_maps/available_offers survive too), then hard-deletes cleanly once detached", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const quote = await createQuote(env);
    const section = await createSection(env, {
      section_name: "Referenced + mapped",
      headline_text: "Are you insured?",
      content_json: JSON.stringify(YESNO_CONTENT),
      answer_maps: [mapEdge(offer.id)],
    });
    expect(section.answer_maps).toHaveLength(1);
    expect(section.available_offers).toHaveLength(1);
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: section.id }] }), env);

    // blocked: the conditional DELETE's WHERE clause fails (meta.changes===0)
    // -> the SAME 409 message+usage shape the plain reference test already
    // asserts, PLUS proof that the children-cleanup batch never ran (a bug
    // that ran it unconditionally, instead of gated on the parent delete's
    // own success, would silently wipe these two rows even though the
    // section row itself survived).
    const del = await admin.request(`${API}/sections/${section.public_id}`, { method: "DELETE" }, env);
    expect(del.status).toBe(409);
    const body = (await del.json()) as {
      error: string;
      usage: { variants: Array<{ quote_name: string }>; rules: unknown[] };
    };
    expect(body.error).toBe("This section is used by quotes — archive it instead");
    expect(body.usage.variants).toHaveLength(1);
    expect(body.usage.rules).toHaveLength(0);

    const reread = await admin.request(`${API}/sections/${section.public_id}`, {}, env);
    expect(reread.status).toBe(200);
    const rereadBody = (await reread.json()) as SectionJson;
    expect(rereadBody.answer_maps).toHaveLength(1);
    expect(rereadBody.available_offers).toHaveLength(1);

    // detach: a variant PUT can't drop to sections:[] (validateFunnelBuilder
    // requires >=1 section to publish) — swap the variant's ordered list to
    // a DIFFERENT filler section instead, which just as validly removes the
    // reference to the section under test.
    const filler = await createSection(env, { section_name: "Filler" });
    const swap = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { sections: [{ section_id: filler.id }] }),
      env,
    );
    expect(swap.status, await swap.clone().text()).toBe(200);

    // the SAME atomic conditional DELETE now succeeds (meta.changes===1):
    // the row AND its children are all gone.
    const del2 = await admin.request(`${API}/sections/${section.public_id}`, { method: "DELETE" }, env);
    expect(del2.status, await del2.clone().text()).toBe(200);
    expect(await del2.json()).toEqual({ ok: true, id: section.id, public_id: section.public_id, deleted: "hard" });
    const reread2 = await admin.request(`${API}/sections/${section.public_id}`, {}, env);
    expect(reread2.status).toBe(404);
  });
});

// ===========================================================================
// 5. duplicateQuoteHandler (A-2, row R4-02) — deep copy
// ===========================================================================

describeDb("POST /quotes/:id/duplicate (A-2, row R4-02) — deep copy funnels/variants/sections/rules", () => {
  async function quoteWithContent(env: Env): Promise<{ quote: QuoteJson; section: SectionJson; variantId: string }> {
    const quote = await createQuote(env);
    const section = await createSection(env);
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    const put = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", {
        sections: [{ section_id: section.id }],
        rules: [{ rule_type: "eligibility" }],
      }),
      env,
    );
    expect(put.status, await put.clone().text()).toBe(200);
    return { quote, section, variantId };
  }

  it("copies name+(copy), every funnel/variant, and each variant's ordered sections + rules", async () => {
    const { env } = newHarness();
    const { quote, section } = await quoteWithContent(env);

    const res = await admin.request(`${API}/quotes/${quote.public_id}/duplicate`, jsonInit("POST", {}), env);
    expect(res.status, await res.clone().text()).toBe(201);
    const dup = (await res.json()) as QuoteJson & {
      duplicated_from: { public_id: string };
      copied: { funnels: number; variants: number; sections: number; rules: number; routing_rules: number };
      not_copied: string[];
    };

    expect(dup.public_id).not.toBe(quote.public_id);
    expect(dup.quote_name).toBe("Life Quote (copy)");
    expect(dup.duplicated_from.public_id).toBe(quote.public_id);
    // Rework M3: duplicateQuoteHandler now also copies quote-scoped
    // leadgen_quote_routing_rules (a real, new copyable resource this
    // fixture never seeds, so the count is 0 here — see the dedicated
    // routing-rules duplication coverage elsewhere for the >0 case).
    expect(dup.copied).toEqual({ funnels: 1, variants: 1, sections: 1, rules: 1, routing_rules: 0 });
    expect(dup.not_copied).toEqual(expect.arrayContaining(["site_activations", "analytics", "ab_tests"]));

    // the CLONE's variant carries the SAME section + rule type (structure tree).
    const structure = await admin.request(`${API}/quotes/${dup.public_id}/structure`, {}, env);
    const sBody = (await structure.json()) as {
      funnels: Array<{
        variants: Array<{ sections: Array<{ section_id: number }>; rules: Array<{ rule_type: string }> }>;
      }>;
    };
    const clonedVariant = sBody.funnels[0]!.variants[0]!;
    expect(clonedVariant.sections).toHaveLength(1);
    expect(clonedVariant.sections[0]!.section_id).toBe(section.id);
    expect(clonedVariant.rules).toHaveLength(1);
    expect(clonedVariant.rules[0]!.rule_type).toBe("eligibility");

    // the SOURCE quote is untouched.
    const sourceStructure = await admin.request(`${API}/quotes/${quote.public_id}/structure`, {}, env);
    const srcBody = (await sourceStructure.json()) as {
      funnels: Array<{ variants: Array<{ sections: unknown[] }> }>;
    };
    expect(srcBody.funnels[0]!.variants[0]!.sections).toHaveLength(1);
  });

  it("never copies site activations / analytics / ab-tests — the clone starts a fresh draft", async () => {
    const { sdb, env } = newHarness();
    const { quote } = await quoteWithContent(env);
    seedSiteQuote(sdb, quote.id);
    seedQuoteAnalytics(sdb, quote.public_id, quote.funnels[0]!.public_id);

    const res = await admin.request(`${API}/quotes/${quote.public_id}/duplicate`, jsonInit("POST", {}), env);
    const dup = (await res.json()) as QuoteJson;
    expect(dup.status).toBe("draft");

    const usage = await admin.request(`${API}/quotes/${dup.public_id}/usage`, {}, env);
    const usageBody = (await usage.json()) as { usage: { delete_eligibility: { eligible: boolean } } };
    expect(usageBody.usage.delete_eligibility.eligible).toBe(true); // the clone has NO history
  });

  it("404 on an unknown quote id", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/quotes/lgq_00000000000000000000000000/duplicate`, jsonInit("POST", {}), env);
    expect(res.status).toBe(404);
  });

  // Rework M1 (§4.3-10): "no control concept anywhere" — duplicateQuoteHandler
  // now copies EVERY ACTIVE variant of the funnel (readActiveFunnelVariants;
  // verified against quotes-handlers.ts), not "only the control" (that concept
  // is gone). With no running test a funnel has exactly one active variant
  // (validation enforces this) — the ORIGINAL adversarial-review scenario
  // (2 active arms under one funnel, no A/B test object) can only be built via
  // raw SQL now, since createVariantUnderFunnel unconditionally refuses a 2nd
  // active variant (see leadgen-quotes-api.test.ts's Σ-gate test for the full
  // rationale) — same scenario (does duplicate correctly handle a
  // multi-active-variant funnel), new axis (copies ALL of them, forced to
  // equal bp, not "only one").
  it("adversarial-review finding 4 (rework): a funnel with 2 ACTIVE arms (no A/B test object) has BOTH copied, each forced to bp=10000; the source stays untouched", async () => {
    const { sdb, env } = newHarness();
    const quote = await createQuote(env);
    const funnelId = quote.funnels[0]!.public_id;
    const control = quote.funnels[0]!.variants[0]!;
    expect(control.variant_label).toBe("A");

    // build a REAL 2-arm 50/50 split: rebalance "A" to 5000, then raw-SQL
    // seed a "B" arm at the remaining 5000 (funnelHasRunningTest is false
    // here — no leadgen_funnel_ab_tests row exists — but createVariantUnderFunnel
    // now unconditionally refuses ANY 2nd active variant regardless of test
    // state, so the arm is seeded directly — the SAME idiom
    // leadgen-rework-handlers.test.ts's own equal-arms test uses).
    const rebalance = await admin.request(
      `${API}/variants/${control.public_id}`,
      jsonInit("PUT", { traffic_allocation_bp: 5000 }),
      env,
    );
    expect(rebalance.status, await rebalance.clone().text()).toBe(200);
    const funnelRowId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelId) as { id: number }).id;
    const variantBPublicId = mintPublicId("funnel_variant");
    sdb
      .prepare(
        "INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status) VALUES (?, ?, 'B', 5000, 'default', 'active')",
      )
      .run(variantBPublicId, funnelRowId);

    const res = await admin.request(`${API}/quotes/${quote.public_id}/duplicate`, jsonInit("POST", {}), env);
    expect(res.status, await res.clone().text()).toBe(201);
    const dup = (await res.json()) as QuoteJson & {
      copied: { funnels: number; variants: number };
      not_copied: string[];
    };
    expect(dup.copied.funnels).toBe(1);
    expect(dup.copied.variants).toBe(2); // BOTH active arms — no control concept to single one out
    expect(dup.not_copied).toContain("ab_variants");

    const dupFunnel = dup.funnels[0]!;
    expect(dupFunnel.variants).toHaveLength(2);
    // every clone forced to the full-traffic shape (10000), NOT the source's
    // 5000/5000 split — a fresh no-test draft (§4.3-10: A/B tests never copy).
    for (const v of dupFunnel.variants) expect(v.traffic_allocation_bp).toBe(10000);
    expect(dupFunnel.variants.map((v) => v.variant_label).sort()).toEqual(["A", "B"]);

    // the SOURCE funnel is untouched: still 2 variants, still the 5000/5000 split.
    const sourceFunnels = await admin.request(`${API}/quotes/${quote.public_id}/funnels`, {}, env);
    const sourceFunnelsBody = (await sourceFunnels.json()) as { items: FunnelJson[] };
    expect(sourceFunnelsBody.items[0]!.variants).toHaveLength(2);
    for (const v of sourceFunnelsBody.items[0]!.variants) expect(v.traffic_allocation_bp).toBe(5000);
  });
});

// ===========================================================================
// 6. Quote archive -> reactivate + guarded DELETE (D-8, rows R4-02/R4-38)
// ===========================================================================

describeDb("Quote archive->reactivate lifecycle + guarded DELETE (D-8)", () => {
  it("PATCH status archived->active reactivates (already-unrestricted status merge)", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const archived = await admin.request(`${API}/quotes/${quote.public_id}`, jsonInit("PATCH", { status: "archived" }), env);
    expect((await archived.json() as QuoteJson).status).toBe("archived");
    const reactivated = await admin.request(`${API}/quotes/${quote.public_id}`, jsonInit("PATCH", { status: "active" }), env);
    expect(reactivated.status).toBe(200);
    expect((await reactivated.json() as QuoteJson).status).toBe("active");
  });

  it("DELETE with no live history: 200 archived (unchanged behavior)", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const del = await admin.request(`${API}/quotes/${quote.public_id}`, { method: "DELETE" }, env);
    expect(del.status).toBe(200);
    expect((await del.json() as { status: string }).status).toBe("archived");
  });

  it("DELETE with a site activation: 409 plain-language, quote stays un-archived", async () => {
    const { sdb, env } = newHarness();
    const quote = await createQuote(env);
    seedSiteQuote(sdb, quote.id);

    const del = await admin.request(`${API}/quotes/${quote.public_id}`, { method: "DELETE" }, env);
    expect(del.status).toBe(409);
    const body = (await del.json()) as { error: string };
    expect(body.error).toBe("This quote has live history — archive it instead");

    const stillActive = await admin.request(`${API}/quotes/${quote.public_id}`, {}, env);
    expect((await stillActive.json() as QuoteJson).status).not.toBe("archived");
  });

  it("DELETE with analytics history (no activation): 409 plain-language", async () => {
    const { sdb, env } = newHarness();
    const quote = await createQuote(env);
    seedQuoteAnalytics(sdb, quote.public_id, quote.funnels[0]!.public_id);

    const del = await admin.request(`${API}/quotes/${quote.public_id}`, { method: "DELETE" }, env);
    expect(del.status).toBe(409);
    expect((await del.json() as { error: string }).error).toBe("This quote has live history — archive it instead");
  });
});

// ===========================================================================
// 7. Auction archive -> reactivate + guarded DELETE (D-8, row R4-38)
// ===========================================================================

describeDb("Auction archive->reactivate lifecycle + guarded DELETE (D-8)", () => {
  it("PATCH status archived->active reactivates (already-unrestricted status merge)", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const auction = await createAuction(env, { auction_name: "A", quote_id: quote.id });
    const archived = await admin.request(`${API}/auctions/${auction.public_id}`, jsonInit("PATCH", { status: "archived" }), env);
    expect((await archived.json() as AuctionJson).status).toBe("archived");
    const reactivated = await admin.request(`${API}/auctions/${auction.public_id}`, jsonInit("PATCH", { status: "active" }), env);
    expect(reactivated.status).toBe(200);
    expect((await reactivated.json() as AuctionJson).status).toBe("active");
  });

  it("DELETE with no referencing variant: 200 archived (unchanged behavior)", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const auction = await createAuction(env, { auction_name: "Unused", quote_id: quote.id });
    const del = await admin.request(`${API}/auctions/${auction.public_id}`, { method: "DELETE" }, env);
    expect(del.status).toBe(200);
    expect((await del.json() as { status: string }).status).toBe("archived");
  });

  it("DELETE referenced by a live funnel variant: 409 plain-language, stays un-archived", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const auction = await createAuction(env, { auction_name: "In use", quote_id: quote.id });
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { auction_id: auction.id }), env);

    const del = await admin.request(`${API}/auctions/${auction.public_id}`, { method: "DELETE" }, env);
    expect(del.status).toBe(409);
    const body = (await del.json()) as { error: string };
    expect(body.error).toBe("This auction is used by a live funnel variant — archive it instead");

    const stillActive = await admin.request(`${API}/auctions/${auction.public_id}`, {}, env);
    expect((await stillActive.json() as AuctionJson).status).not.toBe("archived");
  });
});

// ===========================================================================
// 8. quoteUsageHandler / auctionUsageHandler — where-used shapes
// ===========================================================================

describeDb("GET /quotes/:id/usage — where-used (offers usage report shape)", () => {
  it("no activation/analytics: eligible true, kinds present with count 0", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const res = await admin.request(`${API}/quotes/${quote.public_id}/usage`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usage: { kinds: Array<{ kind: string; count: number }>; delete_eligibility: { eligible: boolean; blocking_kinds: string[] } };
    };
    expect(body.usage.kinds.map((k) => k.kind)).toEqual(
      expect.arrayContaining(["site_activations", "analytics_history"]),
    );
    expect(body.usage.delete_eligibility).toEqual({ eligible: true, blocking_kinds: [] });
  });

  it("with a site activation: eligible false, site named in items, blocking_kinds includes site_activations", async () => {
    const { sdb, env } = newHarness();
    const quote = await createQuote(env);
    seedSiteQuote(sdb, quote.id);
    const res = await admin.request(`${API}/quotes/${quote.public_id}/usage`, {}, env);
    const body = (await res.json()) as {
      usage: {
        kinds: Array<{ kind: string; count: number; items: Array<{ name: string }> }>;
        delete_eligibility: { eligible: boolean; blocking_kinds: string[] };
      };
    };
    const siteKind = body.usage.kinds.find((k) => k.kind === "site_activations")!;
    expect(siteKind.count).toBe(1);
    expect(siteKind.items[0]!.name).toBe("Site One");
    expect(body.usage.delete_eligibility.eligible).toBe(false);
    expect(body.usage.delete_eligibility.blocking_kinds).toContain("site_activations");
  });

  it("404 on an unknown quote id", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/quotes/lgq_00000000000000000000000000/usage`, {}, env);
    expect(res.status).toBe(404);
  });
});

describeDb("GET /auctions/:id/usage — where-used (offers usage report shape)", () => {
  it("no referencing variant: eligible true", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const auction = await createAuction(env, { auction_name: "Unused", quote_id: quote.id });
    const res = await admin.request(`${API}/auctions/${auction.public_id}/usage`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usage: { kinds: Array<{ kind: string; count: number }>; delete_eligibility: { eligible: boolean } };
    };
    expect(body.usage.kinds).toEqual([{ kind: "variants_referencing", count: 0, items: [], warning_only: false }]);
    expect(body.usage.delete_eligibility.eligible).toBe(true);
  });

  it("referenced by a variant: eligible false, item names the owning quote/funnel/variant", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const auction = await createAuction(env, { auction_name: "In use", quote_id: quote.id });
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { auction_id: auction.id }), env);

    const res = await admin.request(`${API}/auctions/${auction.public_id}/usage`, {}, env);
    const body = (await res.json()) as {
      usage: {
        kinds: Array<{ kind: string; count: number; items: Array<{ name: string; link: string }> }>;
        delete_eligibility: { eligible: boolean; blocking_kinds: string[] };
      };
    };
    const refKind = body.usage.kinds.find((k) => k.kind === "variants_referencing")!;
    expect(refKind.count).toBe(1);
    expect(refKind.items[0]!.name).toContain("Life Quote");
    expect(refKind.items[0]!.link).toContain(quote.public_id);
    expect(body.usage.delete_eligibility.eligible).toBe(false);
    expect(body.usage.delete_eligibility.blocking_kinds).toEqual(["variants_referencing"]);
  });

  it("404 on an unknown auction id", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/auctions/lga_00000000000000000000000000/usage`, {}, env);
    expect(res.status).toBe(404);
  });
});

// sanity: isPublicId import actually used (dual-id shape spot check alongside
// the duplicate handlers' freshly-minted ids).
describeDb("duplicate handlers mint well-formed public ids", () => {
  it("duplicated section/quote ids are valid public ids of the right kind", async () => {
    const { env } = newHarness();
    const src = await createSection(env);
    const dupRes = await admin.request(`${API}/sections/${src.public_id}/duplicate`, jsonInit("POST", {}), env);
    const dup = (await dupRes.json()) as SectionJson;
    expect(isPublicId("section", dup.public_id)).toBe(true);

    const quote = await createQuote(env);
    const dupQuoteRes = await admin.request(`${API}/quotes/${quote.public_id}/duplicate`, jsonInit("POST", {}), env);
    const dupQuote = (await dupQuoteRes.json()) as QuoteJson;
    expect(isPublicId("quote", dupQuote.public_id)).toBe(true);
  });
});
