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
//      P1d-discovered gap): unreferenced -> true hard delete (row + owned
//      answer_maps/available_offers rows GONE); referenced by a funnel
//      variant -> 409 plain-language; PATCH-to-archived stays reachable
//      regardless of usage (the guard is DELETE-only, status-independent).
//   5. duplicateQuoteHandler — deep copy funnels/variants/sections/rules;
//      site activations/analytics/ab-tests NOT copied.
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

// 0040/0041 REQUIRED here (unlike the sibling 0036-0039-only harnesses):
// duplicateQuoteHandler copies leadgen_funnels.frame_config_json/theme_json +
// leadgen_funnel_variants.frame_overrides_json (0041) unconditionally in its
// INSERT column list — the pattern already proven by leadgen-frame-routes.test.ts.
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
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
  is_control: boolean;
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
      "Continue mode must be one of button|auto_advance",
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
    const body = (await del.json()) as { error: string; usage: { variants: Array<{ quote_name: string }> } };
    expect(body.error).toBe("This section is used by quotes — archive it instead");
    expect(body.usage.variants).toHaveLength(1);
    expect(body.usage.variants[0]!.quote_name).toBe("Life Quote");

    const stillThere = await admin.request(`${API}/sections/${section.public_id}`, {}, env);
    expect(stillThere.status).toBe(200);
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
      copied: { funnels: number; variants: number; sections: number; rules: number };
      not_copied: string[];
    };

    expect(dup.public_id).not.toBe(quote.public_id);
    expect(dup.quote_name).toBe("Life Quote (copy)");
    expect(dup.duplicated_from.public_id).toBe(quote.public_id);
    expect(dup.copied).toEqual({ funnels: 1, variants: 1, sections: 1, rules: 1 });
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
