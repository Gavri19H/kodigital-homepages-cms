// LeadGen Phase 5 Stage B — the contract 03 §8.2 Sections block over the REAL
// admin router + REAL 0036–0039 migrations (node:sqlite harness; the
// leadgen-offers-api.test.ts pattern with DEV_BYPASS_AUTH). All Offer seeding
// goes through the REAL P4 offers API.
//
// Covers: §12.1 CRUD; the §12.1 derived-index rebuild verified IN THE DB
// (leadgen_section_available_offers + leadgen_section_answer_maps, replace-set
// on PATCH); §14.9 preview (both viewports + scoped CSS); §12.4 archived /
// mismatched-Offer mapping blocked at save; /offers + /usage joins; §12.9
// analytics NULLIF ratios + answer distribution; §12.11 per-Offer
// validate-payload completeness; dual-id + no-store headers + 404 semantics.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { isPublicId, mintPublicId } from "../src/leadgen/ids";

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

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
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
  };
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

// --- Offer seeding (through the REAL P4 API) ---------------------------------

interface OfferDetail {
  id: number;
  public_id: string;
  placements: Array<{ public_id: string }>;
  [key: string]: unknown;
}

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

// --- Section bodies ----------------------------------------------------------

const YESNO_CONTENT = {
  components: [
    { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "currently_insured", answer_type: "boolean" },
  ],
};

function sectionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    section_name: "Are you insured?",
    activity: "quote_funnel",
    vertical: "life",
    headline_text: "Are you insured?",
    content_json: JSON.stringify(YESNO_CONTENT),
    ...overrides,
  };
}

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

interface SectionDetail {
  id: number;
  public_id: string;
  section_name: string;
  status: string;
  content_json: unknown;
  available_offers: Array<{ offer_id: number; selected: boolean; mapping_state: string; required_fields_total: number; required_fields_mapped: number }>;
  answer_maps: Array<{
    offer_id: number;
    offer_payload_field_path: string;
    mapping_status: string;
    validation_status: string;
    payload_schema_public_id: string;
    output_value_map: Record<string, unknown> | null;
    value_transform: Array<Record<string, unknown>> | null;
  }>;
  [key: string]: unknown;
}

async function createSection(env: Env, body: Record<string, unknown>): Promise<SectionDetail> {
  const res = await admin.request(`${API}/sections`, jsonInit("POST", body), env);
  expect(res.status, `create section: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as SectionDetail;
}

// ---------------------------------------------------------------------------
// §12.1 CRUD + the derived-index rebuild (verified in the DB)
// ---------------------------------------------------------------------------

describeDb("POST /sections — create + §12.1 derived rebuild", () => {
  it("creates the section (lgs_) and rebuilds both derived indexes from content_json", async () => {
    const { sdb, env } = newHarness();
    const offer = await createMappableOffer(env);
    const section = await createSection(env, sectionBody({ answer_maps: [mapEdge(offer.id)] }));

    expect(isPublicId("section", section.public_id)).toBe(true);
    expect(section.status).toBe("active");

    // API detail carries the derived rows.
    expect(section.answer_maps).toHaveLength(1);
    expect(section.answer_maps[0]?.mapping_status).toBe("complete");
    expect(section.answer_maps[0]?.validation_status).toBe("ok");
    expect(isPublicId("payload_schema_version", section.answer_maps[0]?.payload_schema_public_id ?? "")).toBe(true);
    expect(section.available_offers).toHaveLength(1);
    expect(section.available_offers[0]?.mapping_state).toBe("complete");
    expect(section.available_offers[0]?.required_fields_total).toBe(1);
    expect(section.available_offers[0]?.required_fields_mapped).toBe(1);

    // DB truth: the answer-map row + the available-offer row exist, with the
    // minted lgm_ public id.
    const maps = sdb
      .prepare("SELECT public_id, offer_id, mapping_status, validation_status FROM leadgen_section_answer_maps WHERE section_id = ?")
      .all(section.id) as Array<{ public_id: string; offer_id: number; mapping_status: string; validation_status: string }>;
    expect(maps).toHaveLength(1);
    expect(isPublicId("answer_field_map", maps[0]?.public_id ?? "")).toBe(true);
    expect(maps[0]?.offer_id).toBe(offer.id);
    const avail = sdb
      .prepare("SELECT offer_id, mapping_state, required_fields_total, required_fields_mapped FROM leadgen_section_available_offers WHERE section_id = ?")
      .all(section.id) as Array<{ offer_id: number; mapping_state: string; required_fields_total: number; required_fields_mapped: number }>;
    expect(avail).toEqual([{ offer_id: offer.id, mapping_state: "complete", required_fields_total: 1, required_fields_mapped: 1 }]);
  });

  it("rejects a Section missing a §12.1 required field", async () => {
    const { env } = newHarness();
    const body = sectionBody();
    delete body["headline_text"];
    const res = await admin.request(`${API}/sections`, jsonInit("POST", body), env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields["headline_text"]).toBeTruthy();
  });

  it("PATCH replaces the derived index set (add then swap the mapped Offer)", async () => {
    const { sdb, env } = newHarness();
    const offerA = await createMappableOffer(env, { offer_name: "A" });
    const offerB = await createMappableOffer(env, { offer_name: "B" });
    const section = await createSection(env, sectionBody({ answer_maps: [mapEdge(offerA.id)] }));

    // PATCH the mapping set to Offer B only — replace-set.
    const res = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { answer_maps: [mapEdge(offerB.id)] }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const updated = (await res.json()) as SectionDetail;
    expect(updated.answer_maps).toHaveLength(1);
    expect(updated.answer_maps[0]?.offer_id).toBe(offerB.id);

    // DB truth: Offer A's rows are gone, only Offer B remains.
    const offerIds = (
      sdb.prepare("SELECT offer_id FROM leadgen_section_answer_maps WHERE section_id = ?").all(section.id) as Array<{ offer_id: number }>
    ).map((r) => r.offer_id);
    expect(offerIds).toEqual([offerB.id]);
    const availIds = (
      sdb.prepare("SELECT offer_id FROM leadgen_section_available_offers WHERE section_id = ?").all(section.id) as Array<{ offer_id: number }>
    ).map((r) => r.offer_id);
    expect(availIds).toEqual([offerB.id]);
  });

  it("a scalar-only PATCH preserves the mapping graph (round-trips stored edges)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createMappableOffer(env);
    const section = await createSection(env, sectionBody({ answer_maps: [mapEdge(offer.id)] }));

    const res = await admin.request(
      `${API}/sections/${section.id}`,
      jsonInit("PATCH", { section_name: "Renamed Section" }),
      env,
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as SectionDetail;
    expect(updated.section_name).toBe("Renamed Section");
    expect(updated.answer_maps).toHaveLength(1); // mapping preserved

    const count = (
      sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_section_answer_maps WHERE section_id = ?").get(section.id) as { n: number }
    ).n;
    expect(count).toBe(1);
  });

  it("B1: a GET→PATCH round-trip preserves output_value_map + value_transform (no silent wipe)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createMappableOffer(env);
    // A NON-trivial per-Offer value map + transform (the §12.7/§16 core Section
    // feature). This must survive a read-modify-write.
    const section = await createSection(
      env,
      sectionBody({
        answer_maps: [
          mapEdge(offer.id, { output_value_map: { true: "Y", false: "N" }, value_transform: [{ kind: "toString" }] }),
        ],
      }),
    );

    // GET the detail — the READ shape the admin editor collectSection resends,
    // and the shape any API GET→PATCH client round-trips.
    const getRes = await admin.request(`${API}/sections/${section.public_id}`, {}, env);
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as SectionDetail;
    expect(got.answer_maps).toHaveLength(1);
    // §8.5 Row-vs-API contract: the READ shape exposes the §12.11 API names
    // (output_value_map / value_transform), NOT the DB `_json` column names.
    expect(got.answer_maps[0]?.output_value_map).toEqual({ true: "Y", false: "N" });
    expect(got.answer_maps[0]?.value_transform).toEqual([{ kind: "toString" }]);

    // PATCH the returned object back VERBATIM (the collectSection resend path).
    const patchRes = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { answer_maps: got.answer_maps }),
      env,
    );
    expect(patchRes.status, await patchRes.clone().text()).toBe(200);

    // Re-GET: the map + transform MUST still be present (the bug wiped them to null).
    const reRes = await admin.request(`${API}/sections/${section.public_id}`, {}, env);
    const re = (await reRes.json()) as SectionDetail;
    expect(re.answer_maps).toHaveLength(1);
    expect(re.answer_maps[0]?.output_value_map).toEqual({ true: "Y", false: "N" });
    expect(re.answer_maps[0]?.value_transform).toEqual([{ kind: "toString" }]);

    // DB truth: the columns are NOT null (a wipe would store null).
    const dbRow = sdb
      .prepare("SELECT output_value_map_json, transform_json FROM leadgen_section_answer_maps WHERE section_id = ?")
      .get(section.id) as { output_value_map_json: string | null; transform_json: string | null };
    expect(dbRow.output_value_map_json).not.toBeNull();
    expect(JSON.parse(dbRow.output_value_map_json ?? "null")).toEqual({ true: "Y", false: "N" });
    expect(dbRow.transform_json).not.toBeNull();
    expect(JSON.parse(dbRow.transform_json ?? "null")).toEqual([{ kind: "toString" }]);
  });

  it("DELETE archives (status flip, never a hard delete)", async () => {
    const { sdb, env } = newHarness();
    const section = await createSection(env, sectionBody());
    const res = await admin.request(`${API}/sections/${section.public_id}`, { method: "DELETE" }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: section.id, public_id: section.public_id, status: "archived" });
    const row = sdb.prepare("SELECT status FROM leadgen_sections WHERE id = ?").get(section.id) as { status: string };
    expect(row.status).toBe("archived");
  });
});

// ---------------------------------------------------------------------------
// §12.4 archived / mismatched Offer mapping blocked at save
// ---------------------------------------------------------------------------

describeDb("§12.4 — mapping into an archived / mismatched Offer is blocked", () => {
  it("blocks mapping into an archived Offer", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    await admin.request(`${API}/offers/${offer.id}`, { method: "DELETE" }, env); // archive
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody({ answer_maps: [mapEdge(offer.id)] })), env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields["answer_maps[0].offer_id"]).toContain("archived");
  });

  it("blocks mapping into an activity/vertical-mismatched Offer", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env, { vertical: "auto" }); // section is 'life'
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody({ answer_maps: [mapEdge(offer.id)] })), env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields["answer_maps[0].offer_id"]).toContain("does not match");
  });

  it("blocks mapping into an Offer with no active payload schema", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env); // no schema posted
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody({ answer_maps: [mapEdge(offer.id)] })), env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields["answer_maps[0].offer_id"]).toContain("no active payload schema");
  });
});

// ---------------------------------------------------------------------------
// §14.9 preview — desktop + mobile + scoped CSS
// ---------------------------------------------------------------------------

describeDb("POST /sections/preview — §14.9 desktop + mobile (no persist)", () => {
  it("renders both viewports from a draft content_json + the scoped chrome CSS", async () => {
    const { sdb, env } = newHarness();
    const res = await admin.request(`${API}/sections/preview`, jsonInit("POST", { content_json: JSON.stringify(YESNO_CONTENT) }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { preview: { desktop: string; mobile: string; css: string; component_count: number } };
    expect(body.preview.desktop).toContain('data-viewport="desktop"');
    expect(body.preview.mobile).toContain('data-viewport="mobile"');
    expect(body.preview.desktop).toContain("lg-yesno"); // the yes/no preset rendered
    expect(body.preview.mobile).toContain("lg-yesno");
    expect(body.preview.css).toContain("data-funnel-design"); // scoped chrome stylesheet
    expect(body.preview.component_count).toBe(1);
    // no persist — nothing landed in leadgen_sections.
    const n = (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_sections").get() as { n: number }).n;
    expect(n).toBe(0);
  });

  it("rejects a malformed content_json (only rejection path, §30.6)", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/sections/preview`, jsonInit("POST", { content_json: "{not json" }), env);
    expect(res.status).toBe(400);
  });

  it("is registered BEFORE /sections/:id (static-before-param)", async () => {
    const { env } = newHarness();
    // if :id captured "preview", a POST would 404/405 on the resolver; a 400
    // (validation) proves the static route matched first.
    const res = await admin.request(`${API}/sections/preview`, jsonInit("POST", {}), env);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// /sections/:id/offers + /usage joins
// ---------------------------------------------------------------------------

describeDb("GET /sections/:id/offers — activity+vertical Offers + mappings (§12.4)", () => {
  it("lists only activity+vertical-matching active Offers + the current mappings", async () => {
    const { env } = newHarness();
    const life = await createMappableOffer(env, { offer_name: "Life Match", vertical: "life" });
    await createMappableOffer(env, { offer_name: "Auto Miss", vertical: "auto" });
    const section = await createSection(env, sectionBody({ answer_maps: [mapEdge(life.id)] }));

    const res = await admin.request(`${API}/sections/${section.public_id}/offers`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      offers: Array<{ id: number; offer_name: string; selected: boolean; has_active_schema: boolean }>;
      mappings: Array<{ offer_id: number }>;
    };
    const names = body.offers.map((o) => o.offer_name);
    expect(names).toContain("Life Match");
    expect(names).not.toContain("Auto Miss"); // wrong vertical excluded
    const match = body.offers.find((o) => o.id === life.id);
    expect(match?.selected).toBe(true);
    expect(match?.has_active_schema).toBe(true);
    expect(body.mappings).toHaveLength(1);
    expect(body.mappings[0]?.offer_id).toBe(life.id);
  });
});

describeDb("GET /sections/:id/usage — funnel-variant join (P7 tables exist in 0036)", () => {
  it("returns the funnel variants ordering the Section", async () => {
    const { sdb, env } = newHarness();
    const section = await createSection(env, sectionBody());

    // Seed a Quote → Funnel → Variant → variant_section referencing the section.
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'Q1', 'quote_funnel', ?)").run(mintPublicId("quote"), JSON.stringify(["life"]));
    const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes LIMIT 1").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, ?, 'F1')").run(mintPublicId("funnel"), quoteId);
    const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels LIMIT 1").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label) VALUES (?, ?, 'A')").run(mintPublicId("funnel_variant"), funnelId);
    const variantId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants LIMIT 1").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, 0)").run(variantId, section.id);

    const res = await admin.request(`${API}/sections/${section.id}/usage`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { usage: { variants: Array<{ quote_name: string; variant_label: string; funnel_name: string }> } };
    expect(body.usage.variants).toHaveLength(1);
    expect(body.usage.variants[0]?.quote_name).toBe("Q1");
    expect(body.usage.variants[0]?.funnel_name).toBe("F1");
    expect(body.usage.variants[0]?.variant_label).toBe("A");
  });

  it("returns an empty list for an unused Section", async () => {
    const { env } = newHarness();
    const section = await createSection(env, sectionBody());
    const res = await admin.request(`${API}/sections/${section.id}/usage`, {}, env);
    expect(((await res.json()) as { usage: { variants: unknown[] } }).usage.variants).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// §12.9 analytics — NULLIF ratios + answer distribution (no raw free-text)
// ---------------------------------------------------------------------------

describeDb("GET /sections/:id/analytics — §12.9 NULLIF ratios + distribution", () => {
  it("zero rows → zero counts + NULL ratios (never fake 0)", async () => {
    const { env } = newHarness();
    const section = await createSection(env, sectionBody());
    const res = await admin.request(`${API}/sections/${section.id}/analytics`, {}, env);
    expect(res.status).toBe(200);
    const { analytics } = (await res.json()) as { analytics: Record<string, unknown> };
    expect(analytics["views"]).toBe(0);
    expect(analytics["continue_rate"]).toBeNull();
    expect(analytics["validation_error_rate"]).toBeNull();
    expect(analytics["answer_distribution"]).toEqual([]);
  });

  it("computes the §12.9 ratios over the ranged mirror + per-question distribution %", async () => {
    const { sdb, env } = newHarness();
    const section = await createSection(env, sectionBody());
    const seed = sdb.prepare(
      "INSERT INTO leadgen_analytics_section (section_public_id, date, views, clicks, continued, validation_errors, default_applied, user_confirmed_default, user_selected, time_on_section_ms_sum, dropoffs) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    seed.run(section.public_id, "2026-07-01", 100, 80, 60, 5, 10, 5, 85, 500000, 40);
    seed.run(section.public_id, "2026-06-01", 999, 999, 999, 999, 999, 999, 999, 999, 999); // outside range

    // answer distribution: two normalized values for one question.
    const dist = sdb.prepare(
      "INSERT INTO leadgen_analytics_answer_distribution (section_public_id, question_key, answer_value_normalized, answer_source, date, count, continued_count) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    dist.run(section.public_id, "insured_q", "true", "user_selected", "2026-07-01", 30, 25);
    dist.run(section.public_id, "insured_q", "false", "user_selected", "2026-07-01", 10, 5);

    const res = await admin.request(`${API}/sections/${section.id}/analytics?from=2026-07-01&to=2026-07-31`, {}, env);
    const { analytics } = (await res.json()) as {
      analytics: {
        views: number;
        continue_rate: number;
        validation_error_rate: number;
        answer_distribution: Array<{ answer_value_normalized: string; count: number; percentage: number | null }>;
      };
    };
    expect(analytics.views).toBe(100);
    expect(analytics.continue_rate).toBeCloseTo(0.6, 10); // 60/100
    expect(analytics.validation_error_rate).toBeCloseTo(0.05, 10); // 5/100
    expect(analytics.answer_distribution).toHaveLength(2);
    const trueRow = analytics.answer_distribution.find((d) => d.answer_value_normalized === "true");
    expect(trueRow?.count).toBe(30);
    expect(trueRow?.percentage).toBeCloseTo(0.75, 10); // 30 / (30 + 10)
  });
});

// ---------------------------------------------------------------------------
// §12.11 per-Offer validate-payload preview
// ---------------------------------------------------------------------------

describeDb("POST /sections/:id/validate-payload — §12.11 per-Offer preview", () => {
  it("generates the payload + completeness score per Offer (the §16 example)", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const section = await createSection(env, sectionBody({ answer_maps: [mapEdge(offer.id)] }));

    const res = await admin.request(
      `${API}/sections/${section.public_id}/validate-payload`,
      jsonInit("POST", { answers: { currently_insured: "Yes" }, offer_ids: [offer.id] }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as {
      answers: Record<string, unknown>;
      offers: Array<{ offer_id: number; payload: unknown; completeness: { required_total: number; required_mapped: number; score: number | null }; missing: string[]; invalid: unknown[] }>;
      section_validation: { status: string; publishable: boolean };
    };
    expect(body.answers["currently_insured"]).toBe(true);
    expect(body.offers).toHaveLength(1);
    const o = body.offers[0];
    expect(o?.payload).toEqual({ data: { insured: true } });
    expect(o?.completeness).toEqual({ required_total: 1, required_mapped: 1, score: 1 });
    expect(o?.missing).toEqual([]);
    expect(o?.invalid).toEqual([]);
    expect(body.section_validation.status).toBe("ok");
    expect(body.section_validation.publishable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// dual-id + no-store headers + 404 semantics
// ---------------------------------------------------------------------------

describeDb("GET /sections/:id — dual-id, no-store headers, 404 semantics", () => {
  it("resolves by BOTH the numeric id and the lgs_ public id", async () => {
    const { env } = newHarness();
    const section = await createSection(env, sectionBody());
    for (const id of [String(section.id), section.public_id]) {
      const res = await admin.request(`${API}/sections/${id}`, {}, env);
      expect(res.status, `resolve ${id}`).toBe(200);
      expect(((await res.json()) as { public_id: string }).public_id).toBe(section.public_id);
    }
  });

  it("carries private, no-store + nosniff on every response (§8.1)", async () => {
    const { env } = newHarness();
    const section = await createSection(env, sectionBody());
    const res = await admin.request(`${API}/sections/${section.public_id}`, {}, env);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("404s on unknown / foreign-kind / malformed ids", async () => {
    const { env } = newHarness();
    for (const id of [mintPublicId("section"), mintPublicId("offer"), "999999", "lgs_short"]) {
      const res = await admin.request(`${API}/sections/${id}`, {}, env);
      expect(res.status, `${id} → 404`).toBe(404);
    }
  });
});
