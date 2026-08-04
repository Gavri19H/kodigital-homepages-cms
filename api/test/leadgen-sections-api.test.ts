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
// §9.2 preview-parameterization pins: the byte-identical legacy pin rebuilds
// the expected output from the SAME canonical primitives the handler composes
// (shared renderer §9.1 — never hand-written expected markup), and the
// design_id test registers a throwaway design in the REAL registry.
import { FUNNEL_DESIGNS, getFunnelDesign, type FunnelDesign } from "../src/public/leadgen/designs/registry";
import { funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import { renderSectionComponents } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";

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
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql",
  // Rework P1 (§5 M1-M12): the full migration set so leadgen_funnel_pages /
  // leadgen_funnel_variant_sections carry the M2 owner axis (variant_id
  // NULLable + quote_id) this suite's usage tests exercise below.
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

  // P4a (PC-A1): the operator's auto_advance conflict rule, end-to-end over the
  // REAL admin router. YESNO_CONTENT is one single-select click producer = the
  // ELIGIBLE case; the stuck compositions are rejected 400 at save.
  const twoProducers = JSON.stringify({
    components: [
      { type: "TwoButtonYesNo", question_id: "q1", internal_field: "a" },
      { type: "ButtonAnswerGroup", question_id: "q2", internal_field: "b", choices: [{ label: "X", value: "x", analytics_id: "x" }] },
    ],
  });

  it("PC-A1: accepts auto_advance for an ELIGIBLE single-choice section (201)", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody({ continue_mode: "auto_advance" })), env);
    expect(res.status, await res.clone().text()).toBe(201);
  });

  it("PC-A1: rejects auto_advance on a MULTI-component section (400, names the Continue rule)", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody({ continue_mode: "auto_advance", content_json: twoProducers })), env);
    expect(res.status).toBe(400);
    const fields = ((await res.json()) as { fields: Record<string, string> }).fields;
    const key = Object.keys(fields).find((k) => k.includes("continue_mode"));
    expect(key, JSON.stringify(fields)).toBeTruthy();
    expect(fields[key as string]).toContain("Continue button");
  });

  it("PC-A1: rejects auto_advance on a dropdown-only (no-click) section (400)", async () => {
    const { env } = newHarness();
    const content = JSON.stringify({
      components: [{ type: "DropdownQuestion", question_id: "q1", internal_field: "a", choices: [{ label: "X", value: "x", analytics_id: "x" }] }],
    });
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody({ continue_mode: "auto_advance", content_json: content })), env);
    expect(res.status).toBe(400);
  });

  it("PC-A1: PATCH switching a button section to auto_advance with 2 producers is rejected (400)", async () => {
    const { env } = newHarness();
    const section = await createSection(env, sectionBody({ content_json: twoProducers }));
    const res = await admin.request(`${API}/sections/${section.public_id}`, jsonInit("PATCH", { continue_mode: "auto_advance" }), env);
    expect(res.status, await res.clone().text()).toBe(400);
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

  // Round-4 P1c re-pin (deliberate — operator item #2/A-2 overrode the
  // pre-round-4 "DELETE always archives" semantics): DELETE is now a
  // GUARDED hard delete (sections-handlers.ts deleteSectionHandler) —
  // unreferenced sections are truly removed; archiving moves to the general
  // PATCH {status} surface (already unrestricted, patchSectionHandler). The
  // guarded-409 leg (a section referenced by a variant/rule) lives in
  // test/leadgen-p1c-lifecycle.test.ts, not duplicated here.
  it("Round-4 re-pin: DELETE hard-deletes an unreferenced section (row gone); archiving moves to PATCH {status:'archived'} (row stays)", async () => {
    const { sdb, env } = newHarness();

    const toDelete = await createSection(env, sectionBody());
    const del = await admin.request(`${API}/sections/${toDelete.public_id}`, { method: "DELETE" }, env);
    expect(del.status, await del.clone().text()).toBe(200);
    expect(await del.json()).toEqual({ ok: true, id: toDelete.id, public_id: toDelete.public_id, deleted: "hard" });
    expect(sdb.prepare("SELECT id FROM leadgen_sections WHERE id = ?").get(toDelete.id)).toBeUndefined();

    const toArchive = await createSection(env, sectionBody());
    const patch = await admin.request(
      `${API}/sections/${toArchive.public_id}`,
      jsonInit("PATCH", { status: "archived" }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const archivedRow = sdb
      .prepare("SELECT status FROM leadgen_sections WHERE id = ?")
      .get(toArchive.id) as { status: string };
    expect(archivedRow.status).toBe("archived");
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

  // Rework M2 (§4.3-1 "shared first page", §5-M2 P1 entry gate): a Section can
  // ALSO be placed directly on a Quote's shared page — a
  // leadgen_funnel_variant_sections row with quote_id SET and variant_id
  // NULL — instead of on any funnel variant's own page order. readSectionUsageRows
  // must surface that row too (no owning funnel/variant to name), or an
  // operator would see "not used" here while the DELETE guard (which checks
  // existence, not identity) still correctly 409s.
  it("returns a shared-page usage row (quote_id-owned, variant_id NULL) with no funnel/variant identity", async () => {
    const { sdb, env } = newHarness();
    const section = await createSection(env, sectionBody());

    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'SharedQ', 'quote_funnel', ?)").run(mintPublicId("quote"), JSON.stringify(["life"]));
    const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes LIMIT 1").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position) VALUES (?, ?, 0)").run(quoteId, section.id);

    const res = await admin.request(`${API}/sections/${section.id}/usage`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usage: {
        variants: Array<{
          quote_name: string;
          funnel_public_id: string | null;
          variant_public_id: string | null;
          variant_label: string | null;
        }>;
      };
    };
    expect(body.usage.variants).toHaveLength(1);
    expect(body.usage.variants[0]?.quote_name).toBe("SharedQ");
    expect(body.usage.variants[0]?.funnel_public_id).toBeNull();
    expect(body.usage.variants[0]?.variant_public_id).toBeNull();
    expect(body.usage.variants[0]?.variant_label).toBeNull();
  });

  // The SAME shared-page reference must ALSO block a hard delete (the guard
  // itself never joined through variant_id, so this already passed before
  // the M2 fix — this proves the two legs stay in agreement, not a new gap).
  it("blocks DELETE with 409 when the Section is used ONLY via a quote's shared page", async () => {
    const { sdb, env } = newHarness();
    const section = await createSection(env, sectionBody());
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'SharedQ2', 'quote_funnel', ?)").run(mintPublicId("quote"), JSON.stringify(["life"]));
    const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes LIMIT 1").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position) VALUES (?, ?, 0)").run(quoteId, section.id);

    const del = await admin.request(`${API}/sections/${section.id}`, { method: "DELETE" }, env);
    expect(del.status, await del.clone().text()).toBe(409);
    const body = (await del.json()) as { error: string; usage: { variants: unknown[] } };
    expect(body.error).toBe("This section is used by quotes — archive it instead");
    expect(body.usage.variants).toHaveLength(1);
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

// ---------------------------------------------------------------------------
// §12.3 / §14.9 conditional-dependency preview (POST /sections/preview + sample_answers)
// ---------------------------------------------------------------------------

// q2 (insurer) shows only when q1 (insured) === true, and is required-when-shown.
const DEP_CONTENT = {
  components: [
    { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "insured", answer_type: "boolean" },
    {
      type: "FreeTextQuestion",
      question_id: "q2",
      question_key: "insurer_q",
      internal_field: "insurer",
      answer_type: "string",
      required: true,
      conditional: { when: "insured", op: "eq", value: true },
    },
  ],
};

interface DepPreviewBody {
  preview: { component_count: number; desktop: string; mobile: string };
  dependencies?: {
    components: Array<{ question_id: string; visible: boolean; required_now: boolean }>;
    continue_blocked: boolean;
    blocking_question_ids: string[];
    visible_question_ids: string[];
  };
}

describeDb("POST /sections/preview — §12.3/§14.9 conditional dependency preview", () => {
  it("no sample_answers ⇒ classic full render, no dependencies block (backward compatible)", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/sections/preview`, jsonInit("POST", { content_json: JSON.stringify(DEP_CONTENT) }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DepPreviewBody;
    expect(body.preview.component_count).toBe(2); // both components rendered
    expect(body.dependencies).toBeUndefined();
  });

  it("sample answers HIDE the dependent when its condition is unmet (rendered AND reported)", async () => {
    const { env } = newHarness();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", { content_json: JSON.stringify(DEP_CONTENT), sample_answers: { insured: false } }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as DepPreviewBody;
    // q2 hidden → only q1 survives into the rendered HTML (proves hidden nodes
    // are dropped from the render, not just flagged).
    expect(body.preview.component_count).toBe(1);
    expect(body.dependencies?.visible_question_ids).toEqual(["q1"]);
    expect(body.dependencies?.components.find((cc) => cc.question_id === "q2")?.visible).toBe(false);
    // a HIDDEN required component never blocks continue (§12.3).
    expect(body.dependencies?.continue_blocked).toBe(false);
  });

  it("sample answers REVEAL the dependent when met; a visible required unanswered field blocks continue", async () => {
    const { env } = newHarness();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", { content_json: JSON.stringify(DEP_CONTENT), sample_answers: { insured: true } }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as DepPreviewBody;
    expect(body.preview.component_count).toBe(2); // both visible → both rendered
    expect(body.dependencies?.visible_question_ids).toEqual(["q1", "q2"]);
    // q2 is visible + required + unanswered → §12.3 continue gate closes on it.
    expect(body.dependencies?.continue_blocked).toBe(true);
    expect(body.dependencies?.blocking_question_ids).toContain("q2");
  });
});

// ---------------------------------------------------------------------------
// §9.2 (E5) preview parameterization — design_id / viewport / sim
// ---------------------------------------------------------------------------

// Choice-bearing content for the selected-state sims.
const CHOICES_CONTENT = {
  components: [
    {
      type: "ButtonAnswerGroup",
      question_id: "qc",
      question_key: "carrier_q",
      internal_field: "carrier",
      answer_type: "string",
      choices: [
        { value: "geico", label: "GEICO" },
        { value: "allstate", label: "Allstate" },
      ],
    },
  ],
};

const DROPDOWN_CONTENT = {
  components: [
    {
      type: "DropdownQuestion",
      question_id: "qd",
      question_key: "state_q",
      internal_field: "us_state",
      answer_type: "string",
      choices: [
        { value: "ca", label: "California" },
        { value: "ny", label: "New York" },
      ],
    },
  ],
};

// §8.5 container tree: the dependency sim must drop the hidden LEAF while the
// container WRAPPER survives (renderSectionComponentsVisible semantics).
const STACK_DEP_CONTENT = {
  components: [
    {
      type: "Stack",
      container_id: "c1",
      props: {},
      children: [
        { type: "TwoButtonYesNo", question_id: "q1", question_key: "insured_q", internal_field: "insured", answer_type: "boolean" },
        {
          type: "FreeTextQuestion",
          question_id: "q2",
          question_key: "insurer_q",
          internal_field: "insurer",
          answer_type: "string",
          required: true,
          conditional: { when: "insured", op: "eq", value: true },
        },
      ],
    },
  ],
};

// An AUTHORED address (props.fields[]) — the shape runtime/validation.ts
// validateSection routes PER SUBFIELD (its `Array.isArray(props.fields)` gate),
// with one subfield carrying a custom format rule and its own message. Drives
// the G3c canvas-vs-live parity pin below.
const ADDR_CONTENT = {
  components: [
    {
      type: "AddressAutocompleteQuestion",
      question_id: "q_addr",
      internal_field: "addr",
      required: true,
      props: {
        fields: [
          { field: "street", mode: "autofill" },
          { field: "city", mode: "autofill" },
          { field: "state", mode: "autofill" },
          {
            field: "zip",
            mode: "manual",
            required: true,
            validation: { regex: "^[0-9]{5}(-[0-9]{4})?$", message: "Enter a ZIP like 90210 or 90210-1234." },
          },
        ],
      },
    },
  ],
};

interface ParamPreviewBody {
  preview: {
    css: string;
    desktop: string;
    mobile: string;
    component_count: number;
    design_id: string;
    sim_state: string;
    html?: string;
  };
  dependencies?: DepPreviewBody["dependencies"];
  error?: string;
  fields?: Record<string, string>;
}

async function postPreview(
  env: Env,
  body: Record<string, unknown>,
): Promise<{ status: number; body: ParamPreviewBody }> {
  const res = await admin.request(`${API}/sections/preview`, jsonInit("POST", body), env);
  return { status: res.status, body: (await res.json()) as ParamPreviewBody };
}

// The opening tag of the choice element carrying data-lg-choice="value".
function choiceTag(html: string, value: string): string {
  const m = html.match(new RegExp(`<(?:button|option)[^>]*data-lg-choice="${value}"[^>]*>`));
  expect(m, `choice tag for ${value} present`).not.toBeNull();
  return m![0];
}

// The [data-lg-error-for="{field}"] slot AS AN ELEMENT: its opening tag, the
// text INSIDE it, and whether it is switched off.
//
// R2 P8-5 M-4 (ADJ-P8-22): presets.ts autoErrorSlot renders every slot
// `hidden` and EMPTY, and the live page un-hides it (runtime/render.ts
// setFieldError -> toggleHidden). So "the message appears somewhere in the
// preview bytes" is compatible with the operator seeing nothing at all — a
// document-wide `toContain(message)` cannot fail on a hidden slot. Reading the
// slot element itself can.
function errorSlot(html: string, field: string): { open: string; text: string; hidden: boolean } {
  const m = html.match(new RegExp(`<p([^>]*)data-lg-error-for="${field}"([^>]*)>([^<]*)</p>`));
  expect(m, `error slot for ${field} present`).not.toBeNull();
  const open = `<p${m![1]}data-lg-error-for="${field}"${m![2]}>`;
  return { open, text: m![3] as string, hidden: / hidden[ >]/.test(open) };
}

// The opening tag of the [data-lg-field="{field}"] block (the element the
// runtime's setFieldError resolves and puts ERROR_CLASS on).
function fieldBlockTag(html: string, field: string): string {
  const m = html.match(new RegExp(`<[a-z]+[^>]*data-lg-field="${field}"[^>]*>`));
  expect(m, `field block for ${field} present`).not.toBeNull();
  return m![0];
}

// Every [data-lg-input] in the markup, tagged with the field of the nearest
// PRECEDING [data-lg-field] — presets renderAddressFieldSet emits one flat
// `<span data-lg-field="{key}"> label · input · slot </span>` per authored
// spec, so nearest-preceding is exact. This is WHICH input is marked, which a
// count alone (or a document-wide substring) cannot say.
function inputsByField(html: string): Array<{ field: string; invalid: boolean }> {
  const out: Array<{ field: string; invalid: boolean }> = [];
  let field = "";
  for (const m of html.matchAll(
    /data-lg-field="([^"]*)"|<(?:input|select|textarea)\b[^>]*data-lg-input[^>]*>/g,
  )) {
    if (m[1] !== undefined) field = m[1];
    else out.push({ field, invalid: /\baria-invalid="true"/.test(m[0]) });
  }
  return out;
}

describeDb("POST /sections/preview — §9.2 (E5) parameterization", () => {
  it("legacy body (no new params) → byte-identical preview.{css,desktop,mobile,component_count} (regression pin)", async () => {
    const { env } = newHarness();
    const { status, body } = await postPreview(env, { content_json: JSON.stringify(YESNO_CONTENT) });
    expect(status).toBe(200);

    // Rebuild the EXACT pre-§9.2 composition from the canonical primitives:
    // getFunnelDesign(null) + renderSectionComponents + funnelChromeCss with
    // its DEFAULT scope (no scope arg — the pre-change call shape).
    const design = getFunnelDesign(null);
    const nodes = YESNO_CONTENT.components as unknown as LeadgenComponentNode[];
    const rendered = renderSectionComponents(nodes, design);
    const wrap = (viewport: string, maxWidth: string): string =>
      `<div data-funnel-design="${design.id}" data-viewport="${viewport}" class="lg-preview lg-preview-${viewport}" style="max-width:${maxWidth};margin:0 auto"><div class="lg-content">${rendered}</div></div>`;

    expect(body.preview.css).toBe(funnelChromeCss(design));
    expect(body.preview.desktop).toBe(wrap("desktop", design.header.contentMaxWidth));
    expect(body.preview.mobile).toBe(wrap("mobile", design.breakpoints.mobileMax));
    expect(body.preview.component_count).toBe(1);
    // additive §9.2 echoes only — no viewport param ⇒ no preview.html
    expect(body.preview.design_id).toBe(design.id);
    expect(body.preview.sim_state).toBe("default");
    expect("html" in body.preview).toBe(false);
    expect(body.dependencies).toBeUndefined();
  });

  it("design_id resolves through the REAL registry: wrapper attr + CSS scope carry the RESOLVED id", async () => {
    const { env } = newHarness();
    // The token type pins `id` to the measured design's literal — widen it for
    // the throwaway registry entry (runtime shape is identical).
    const skin = { ...getFunnelDesign(null), id: "test-skin" } as unknown as FunnelDesign;
    FUNNEL_DESIGNS["test-skin"] = skin;
    try {
      const { status, body } = await postPreview(env, {
        content_json: JSON.stringify(YESNO_CONTENT),
        design_id: "test-skin",
      });
      expect(status).toBe(200);
      expect(body.preview.design_id).toBe("test-skin");
      expect(body.preview.desktop).toContain('<div data-funnel-design="test-skin"');
      expect(body.preview.mobile).toContain('<div data-funnel-design="test-skin"');
      // the chrome CSS is scoped to THAT design id (the serve.ts shell pattern)
      expect(body.preview.css).toBe(funnelChromeCss(skin, '[data-funnel-design="test-skin"]'));
      expect(body.preview.css).toContain('[data-funnel-design="test-skin"]');
      expect(body.preview.css).not.toContain('[data-funnel-design="default-funnel"]');
    } finally {
      delete FUNNEL_DESIGNS["test-skin"];
    }
  });

  it("unknown design_id → the default design (§14.1), resolved id echoed", async () => {
    const { env } = newHarness();
    const { status, body } = await postPreview(env, {
      content_json: JSON.stringify(YESNO_CONTENT),
      design_id: "no-such-skin",
    });
    expect(status).toBe(200);
    expect(body.preview.design_id).toBe("default-funnel");
    expect(body.preview.desktop).toContain('<div data-funnel-design="default-funnel"');
    expect(body.preview.css).toContain('[data-funnel-design="default-funnel"]');
  });

  it("viewport param → preview.html carries exactly that viewport's markup", async () => {
    const { env } = newHarness();
    const mobile = await postPreview(env, { content_json: JSON.stringify(YESNO_CONTENT), viewport: "mobile" });
    expect(mobile.status).toBe(200);
    expect(mobile.body.preview.html).toBe(mobile.body.preview.mobile);
    expect(mobile.body.preview.html).not.toBe(mobile.body.preview.desktop);
    expect(mobile.body.preview.html).toContain("lg-preview-mobile");

    const desktop = await postPreview(env, { content_json: JSON.stringify(YESNO_CONTENT), viewport: "desktop" });
    expect(desktop.status).toBe(200);
    expect(desktop.body.preview.html).toBe(desktop.body.preview.desktop);
    expect(desktop.body.preview.html).toContain("lg-preview-desktop");
  });

  it('sim "selected" server-renders the runtime selection markup (aria-checked/lg-selected) into buttons', async () => {
    const { env } = newHarness();
    const dflt = await postPreview(env, { content_json: JSON.stringify(CHOICES_CONTENT) });
    const { status, body } = await postPreview(env, {
      content_json: JSON.stringify(CHOICES_CONTENT),
      sim: { state: "selected", answers: { carrier: "allstate" } },
    });
    expect(status).toBe(200);
    expect(body.preview.sim_state).toBe("selected");
    // visibly different from the default render
    expect(body.preview.desktop).not.toBe(dflt.body.preview.desktop);

    // the matching choice: the preset's initial aria-checked="false" flips to
    // "true" + the runtime's applySelectionClasses conventions (lg-selected).
    // P5 S5c (ADJ-R8) fixed the runtime to write aria-checked, never
    // aria-pressed — the sim mirror was fixed in lockstep (P5 tail item 2).
    const on = choiceTag(body.preview.desktop, "allstate");
    expect(on).toContain('aria-checked="true"');
    expect(on).not.toContain("aria-pressed");
    expect(on).toContain("lg-selected");
    // its sibling: aria-checked stays "false" (applySelectionClasses sets it
    // explicitly on every choice), NO selected class, no aria-pressed anywhere
    const off = choiceTag(body.preview.desktop, "geico");
    expect(off).not.toContain("aria-pressed");
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toContain("lg-selected");
    // both viewports carry the same server-rendered state
    expect(choiceTag(body.preview.mobile, "allstate")).toContain('aria-checked="true"');
  });

  it('sim "selected" on a dropdown selects the REAL <option> and deselects the placeholder', async () => {
    const { env } = newHarness();
    const { status, body } = await postPreview(env, {
      content_json: JSON.stringify(DROPDOWN_CONTENT),
      sim: { state: "selected", answers: { us_state: "ny" } },
    });
    expect(status).toBe(200);
    const on = choiceTag(body.preview.desktop, "ny");
    expect(on).toMatch(/ selected>$/);
    expect(choiceTag(body.preview.desktop, "ca")).not.toContain("selected");
    // the disabled placeholder loses `selected` so exactly one option is selected
    expect(body.preview.desktop).toContain('<option value="" disabled>');
    expect(body.preview.desktop).not.toContain('<option value="" disabled selected>');
  });

  it('sim "error" server-renders setFieldError markup (lg-error + aria-invalid + visible required message)', async () => {
    const { env } = newHarness();
    // insured=true reveals q2 (required, unanswered) → q2 carries the error state
    const { status, body } = await postPreview(env, {
      content_json: JSON.stringify(DEP_CONTENT),
      sim: { state: "error", answers: { insured: true } },
    });
    expect(status).toBe(200);
    expect(body.preview.sim_state).toBe("error");
    const input = body.preview.desktop.match(/<input[^>]*data-lg-field="insurer"[^>]*>/);
    expect(input).not.toBeNull();
    expect(input![0]).toContain('aria-invalid="true"');
    expect(input![0]).toContain("lg-error");
    // The message is VISIBLE: it sits INSIDE the [data-lg-error-for] slot AND
    // that slot is not switched off. (runtime/validation.ts copy, verbatim.)
    //
    // BEFORE this round these two lines read
    //     expect(body.preview.desktop).toContain('data-lg-error-for="insurer"');
    //     expect(body.preview.desktop).toContain("This field is required.");
    // — a document-wide substring pair that a `hidden` slot satisfies. It was
    // green while the endpoint really was returning
    //     <p class="lg-error lg-error-auto" ... hidden ...>This field is
    //     required.</p>
    // (measured on the real route, P8-5 slice G3). The slot-level read below
    // is what fails on that markup.
    const slot = errorSlot(body.preview.desktop, "insurer");
    expect(slot.text).toBe("This field is required.");
    expect(slot.hidden, `the required message must not be hidden: ${slot.open}`).toBe(false);
    // the answered boolean question is NOT error-marked
    expect(body.preview.desktop).not.toMatch(/<div[^>]*data-lg-field="insured"[^>]*aria-invalid/);
  });

  it('sim "validation_success" / "validation_error" mark answered fields with the success/error conventions', async () => {
    const { env } = newHarness();
    const ok = await postPreview(env, {
      content_json: JSON.stringify(DEP_CONTENT),
      sim: { state: "validation_success", answers: { insured: true, insurer: "Acme Mutual" } },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.preview.sim_state).toBe("validation_success");
    const okInput = ok.body.preview.desktop.match(/<input[^>]*data-lg-field="insurer"[^>]*>/);
    expect(okInput).not.toBeNull();
    expect(okInput![0]).toContain("lg-valid");
    expect(okInput![0]).not.toContain("aria-invalid");

    const bad = await postPreview(env, {
      content_json: JSON.stringify(DEP_CONTENT),
      sim: { state: "validation_error", answers: { insured: true, insurer: "Acme Mutual" } },
    });
    expect(bad.status).toBe(200);
    expect(bad.body.preview.sim_state).toBe("validation_error");
    const badInput = bad.body.preview.desktop.match(/<input[^>]*data-lg-field="insurer"[^>]*>/);
    expect(badInput).not.toBeNull();
    expect(badInput![0]).toContain('aria-invalid="true"');
    expect(badInput![0]).toContain("lg-error");
    // Same slot-level read as the sim "error" case above, for the same reason.
    // BEFORE this round the line was
    //     expect(bad.body.preview.desktop).toContain("The value has an invalid format.");
    // — a document-wide substring that a still-`hidden` slot satisfies.
    const badSlot = errorSlot(bad.body.preview.desktop, "insurer");
    expect(badSlot.text).toBe("The value has an invalid format.");
    expect(badSlot.hidden, `the invalid-format message must not be hidden: ${badSlot.open}`).toBe(false);
    // the two states are visibly different markup
    expect(bad.body.preview.desktop).not.toBe(ok.body.preview.desktop);
  });

  it('sim "validation_error" on an AUTHORED address marks the RULED subfield with its own message, never the group', async () => {
    const { env } = newHarness();
    const { status, body } = await postPreview(env, {
      content_json: JSON.stringify(ADDR_CONTENT),
      sim: { state: "validation_error" },
    });
    expect(status).toBe(200);
    expect(body.preview.sim_state).toBe("validation_error");
    const html = body.preview.desktop;

    // MEASURED on the real product (scripts/p8/drive-g3-canvas-live-error.mjs,
    // scenario address_validation): a visitor who types "123" into this ZIP and
    // hits Continue gets ONE marked input (the ZIP), `lg-error` on
    // [data-lg-field="addr_zip"], the ZIP spec's OWN sentence in the addr_zip
    // slot, and the GROUP slot left empty + `hidden`. Before the G3c fix the
    // canvas painted the opposite on all four counts (4/4 inputs marked,
    // lg-error on the fieldset, the generic message in the group slot) — 5 of
    // the probe's 7 parity rows disagreed.
    //
    // Slot-level reads with the `hidden` check, NOT document-wide toContain:
    // the group slot below still CONTAINS the empty string, and the pre-fix
    // markup still contained the author's sentence nowhere a visitor reads.
    const zipSlot = errorSlot(html, "addr_zip");
    expect(zipSlot.text).toBe("Enter a ZIP like 90210 or 90210-1234.");
    expect(zipSlot.hidden, `the ZIP rule's message must not be hidden: ${zipSlot.open}`).toBe(false);

    const groupSlot = errorSlot(html, "addr");
    expect(groupSlot.text).toBe("");
    expect(groupSlot.hidden, `the group slot must stay switched off: ${groupSlot.open}`).toBe(true);

    // WHICH input carries aria-invalid — exactly the ruled one.
    expect(inputsByField(html)).toEqual([
      { field: "addr_street", invalid: false },
      { field: "addr_city", invalid: false },
      { field: "addr_state", invalid: false },
      { field: "addr_zip", invalid: true },
    ]);
    // ERROR_CLASS lands on the subfield wrapper, not the fieldset.
    expect(fieldBlockTag(html, "addr_zip")).toContain("lg-error");
    expect(fieldBlockTag(html, "addr")).not.toContain("lg-error");
  });

  it('sim "validation_error" on a zip5-ruled address subfield speaks validation.ts\'s zip5 copy', async () => {
    const { env } = newHarness();
    const content = {
      components: [
        {
          ...ADDR_CONTENT.components[0],
          props: { fields: [{ field: "zip", mode: "manual", required: true, validation: "zip5" }] },
        },
      ],
    };
    const { status, body } = await postPreview(env, {
      content_json: JSON.stringify(content),
      sim: { state: "validation_error" },
    });
    expect(status).toBe(200);
    // runtime/validation.ts validateAddressField's zip5 branch copy, verbatim.
    const slot = errorSlot(body.preview.desktop, "addr_zip");
    expect(slot.text).toBe("Enter a valid 5-digit ZIP code.");
    expect(slot.hidden, `the zip5 message must not be hidden: ${slot.open}`).toBe(false);
  });

  it('sim "dependency" via sim.answers drops the hidden LEAF while the container WRAPPER survives', async () => {
    const { env } = newHarness();
    const { status, body } = await postPreview(env, {
      content_json: JSON.stringify(STACK_DEP_CONTENT),
      sim: { state: "dependency", answers: { insured: false } },
    });
    expect(status).toBe(200);
    expect(body.preview.sim_state).toBe("dependency");
    // container wrapper present, hidden leaf ABSENT from the markup
    expect(body.preview.desktop).toContain('class="lg-stack"');
    expect(body.preview.desktop).toContain('data-lg-question="q1"');
    expect(body.preview.desktop).not.toContain('data-lg-question="q2"');
    expect(body.preview.component_count).toBe(1);
    // the dependencies verdict block rides along (§12.3 response contract)
    expect(body.dependencies?.visible_question_ids).toEqual(["q1"]);
    expect(body.dependencies?.continue_blocked).toBe(false);
  });

  it("sim.answers OVERRIDE legacy sample_answers (overlay order: sample_answers < sim.answers < flow)", async () => {
    const { env } = newHarness();
    const { status, body } = await postPreview(env, {
      content_json: JSON.stringify(DEP_CONTENT),
      sample_answers: { insured: true },
      sim: { state: "dependency", answers: { insured: false } },
    });
    expect(status).toBe(200);
    // sim.answers wins → q2 hidden
    expect(body.preview.component_count).toBe(1);
    expect(body.dependencies?.visible_question_ids).toEqual(["q1"]);
  });

  it("sim.flow reduces later-entries-win and drives the selected basis (even without state=selected)", async () => {
    const { env } = newHarness();
    const { status, body } = await postPreview(env, {
      content_json: JSON.stringify(CHOICES_CONTENT),
      sim: {
        flow: [
          { internal_field: "carrier", value: "geico" },
          { internal_field: "carrier", value: "allstate" },
        ],
      },
    });
    expect(status).toBe(200);
    // no explicit state ⇒ resolved sim_state stays "default"…
    expect(body.preview.sim_state).toBe("default");
    // …but the flow record IS the selected basis: LATER entry wins
    const on = choiceTag(body.preview.desktop, "allstate");
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain("lg-selected");
    const off = choiceTag(body.preview.desktop, "geico");
    expect(off).toContain('aria-checked="false"');
    expect(off).not.toContain("aria-pressed");
    expect(off).not.toContain("lg-selected");
  });

  it("malformed §9.2 params → 400 with the offending field named", async () => {
    const { env } = newHarness();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ content_json: JSON.stringify(YESNO_CONTENT), viewport: "tablet" }, "viewport"],
      [{ content_json: JSON.stringify(YESNO_CONTENT), design_id: 42 }, "design_id"],
      [{ content_json: JSON.stringify(YESNO_CONTENT), sim: "selected" }, "sim"],
      [{ content_json: JSON.stringify(YESNO_CONTENT), sim: { state: "blink" } }, "sim.state"],
      [{ content_json: JSON.stringify(YESNO_CONTENT), sim: { answers: [] } }, "sim.answers"],
      [{ content_json: JSON.stringify(YESNO_CONTENT), sim: { flow: {} } }, "sim.flow"],
    ];
    for (const [reqBody, field] of cases) {
      const { status, body } = await postPreview(env, reqBody);
      expect(status, `${field} rejected`).toBe(400);
      expect(body.fields?.[field], `${field} named in fields`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// §12.8 server-side ZIP validation in the validate flow (maps.validateZip)
// ---------------------------------------------------------------------------

const ZIP_CONTENT = {
  components: [{ type: "ZIPInputQuestion", question_id: "zq", question_key: "zip_q", internal_field: "zip" }],
};

interface ZipValidationBody {
  address_validation: {
    enabled: boolean;
    zip_fields: string[];
    checks: Array<{ field: string; present: boolean; valid: boolean | null }>;
    malformed: string[];
    has_malformed: boolean;
  } | null;
}

describeDb("POST /sections/:id/validate-payload — §12.8 ZIP validation", () => {
  it("flags a malformed ZIP when address_validation_enabled + a ZIP component", async () => {
    const { env } = newHarness();
    const section = await createSection(env, sectionBody({ content_json: JSON.stringify(ZIP_CONTENT), address_validation_enabled: true }));
    const res = await admin.request(
      `${API}/sections/${section.public_id}/validate-payload`,
      jsonInit("POST", { answers: { zip: "9021" } }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as ZipValidationBody;
    expect(body.address_validation?.enabled).toBe(true);
    expect(body.address_validation?.has_malformed).toBe(true);
    expect(body.address_validation?.malformed).toContain("zip");
    expect(body.address_validation?.checks.find((cc) => cc.field === "zip")?.valid).toBe(false);
  });

  it("a well-formed 5-digit ZIP passes maps.validateZip", async () => {
    const { env } = newHarness();
    const section = await createSection(env, sectionBody({ content_json: JSON.stringify(ZIP_CONTENT), address_validation_enabled: true }));
    const res = await admin.request(
      `${API}/sections/${section.public_id}/validate-payload`,
      jsonInit("POST", { answers: { zip: "90210" } }),
      env,
    );
    const body = (await res.json()) as ZipValidationBody;
    expect(body.address_validation?.has_malformed).toBe(false);
    expect(body.address_validation?.checks.find((cc) => cc.field === "zip")?.valid).toBe(true);
  });

  it("address_validation is null when the toggle is off (the leg does not apply)", async () => {
    const { env } = newHarness();
    const section = await createSection(env, sectionBody({ content_json: JSON.stringify(ZIP_CONTENT) })); // address_validation_enabled defaults false
    const res = await admin.request(
      `${API}/sections/${section.public_id}/validate-payload`,
      jsonInit("POST", { answers: { zip: "9021" } }),
      env,
    );
    const body = (await res.json()) as ZipValidationBody;
    expect(body.address_validation).toBeNull();
  });

  // v3.1 §9.3 per-field precedence (adversarial-review fix round, MINOR-1):
  // this admin leg keyed SOLELY off address_validation_enabled and validated
  // ALL zip fields — it never consulted a field's OWN props.maps.jobs.validate,
  // contradicting §9.3 (the client leg + key-injection gate already honor
  // jobs.validate) and §12 parity. Both directions below prove the field's
  // own maps config — when present — is now authoritative over the legacy
  // Section-level column, exactly like the runtime/key-injection legs.
  const ZIP_WITH_FIELD_MAPS = (validate: boolean) => ({
    components: [
      {
        type: "ZIPInputQuestion",
        question_id: "zq",
        question_key: "zip_q",
        internal_field: "zip",
        props: { maps: { enabled: true, jobs: { validate, auction: false, autocomplete: false } } },
      },
    ],
  });

  it("a field's OWN props.maps.jobs.validate:false wins over an ENABLED address_validation_enabled column — preview shows NO zip validation (the fix-round regression scenario, verbatim)", async () => {
    const { env } = newHarness();
    const section = await createSection(
      env,
      sectionBody({ content_json: JSON.stringify(ZIP_WITH_FIELD_MAPS(false)), address_validation_enabled: true }),
    );
    const res = await admin.request(
      `${API}/sections/${section.public_id}/validate-payload`,
      jsonInit("POST", { answers: { zip: "9021" } }), // malformed — would flag if this field were validated
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as ZipValidationBody;
    expect(body.address_validation).toBeNull();
  });

  it("a field's OWN props.maps.jobs.validate:true still validates even when address_validation_enabled is OFF (per-field precedence both directions)", async () => {
    const { env } = newHarness();
    const section = await createSection(env, sectionBody({ content_json: JSON.stringify(ZIP_WITH_FIELD_MAPS(true)) })); // address_validation_enabled defaults false
    const res = await admin.request(
      `${API}/sections/${section.public_id}/validate-payload`,
      jsonInit("POST", { answers: { zip: "9021" } }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as ZipValidationBody;
    expect(body.address_validation?.enabled).toBe(true);
    expect(body.address_validation?.has_malformed).toBe(true);
    expect(body.address_validation?.checks.find((cc) => cc.field === "zip")?.valid).toBe(false);
  });

  it("a field with NO props.maps at all still falls back to the legacy address_validation_enabled column (§12 no-regression for pre-v3.1 content)", async () => {
    const { env } = newHarness();
    const section = await createSection(env, sectionBody({ content_json: JSON.stringify(ZIP_CONTENT), address_validation_enabled: true }));
    const res = await admin.request(
      `${API}/sections/${section.public_id}/validate-payload`,
      jsonInit("POST", { answers: { zip: "9021" } }),
      env,
    );
    const body = (await res.json()) as ZipValidationBody;
    expect(body.address_validation?.enabled).toBe(true);
    expect(body.address_validation?.checks.find((cc) => cc.field === "zip")?.valid).toBe(false);
  });
});
