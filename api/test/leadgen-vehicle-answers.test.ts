// F18 Vehicle database — the lead-data side of a visitor's vehicle answers:
// the answer keys a question records (answers.ts fieldsOf + /lg/ck), the
// server check before an Auction (serve-auction.ts / vehicle-answers.ts),
// what Offers receive (names by default, ids with "Send as: ID", the year as a
// number — payload.ts + engine.ts + the admin previews), and "Send as" stored
// on the Section's mapping rows (migration 0069 + sections-handlers.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { fieldsOf, normalizeAnswers, buildOfferPayload } from "../src/leadgen/answers";
import { attachVehicleAnswers, buildPayload, type LeadgenPayloadSchema } from "../src/leadgen/payload";
import {
  checkVehicleRawAnswers,
  collectVehicleQuestions,
  resolveVehicleAnswerValues,
} from "../src/leadgen/vehicle-answers";
import { resetVehicleStoreMemo } from "../src/leadgen/vehicles/store";
import { checkpointKnownFields } from "../src/public/leadgen/runtime-routes";
import { applyVehicleAnswerCheck } from "../src/public/leadgen/serve-auction";
import { mappingCompleteness, vehicleAnswerValues, type OfferSchemaInfo } from "../src/leadgen/sections";
import type { ResolvedActivatedFunnel } from "../src/public/leadgen/resolver";
import type { LeadgenComponentNode, LeadgenSectionContent } from "../src/public/leadgen/components/content-schema";
import { mintPublicId } from "../src/leadgen/ids";

// --- a tiny in-memory vehicle store (R2 binding MEDIA) -------------------------

const LIVE = "2026-10-05";
const OLD = "2025-10-05";
const COROLLA = "m_bbbbbbbbbb";
const CAMRY = "m_aaaaaaaaaa";
const BZ4X = "m_cccccccccc";
const CUTLASS = "m_dddddddddd";

const FILES: Record<string, unknown> = {
  "vehicles/live.json": { snapshot: LIVE },
  [`vehicles/${LIVE}/makes.json`]: {
    snapshot: LIVE,
    makes: [
      { make_id: 441, name: "Chevrolet", slug: "chevrolet" },
      { make_id: 448, name: "Toyota", slug: "toyota" },
      { make_id: 474, name: "Honda", slug: "honda" },
    ],
  },
  [`vehicles/${LIVE}/makes/448.json`]: {
    snapshot: LIVE,
    make_id: 448,
    models: [
      { model_id: CAMRY, name: "Camry" },
      { model_id: COROLLA, name: "Corolla" },
      { model_id: BZ4X, name: "bZ4X" },
    ],
    years: [
      { year: 2023, m: [0, 1, 2] },
      { year: 2010, m: [0, 1] },
    ],
  },
  [`vehicles/${OLD}/makes.json`]: {
    snapshot: OLD,
    makes: [
      { make_id: 448, name: "Toyota", slug: "toyota" },
      { make_id: 999, name: "Oldsmobile", slug: "oldsmobile" },
    ],
  },
  [`vehicles/${OLD}/makes/999.json`]: {
    snapshot: OLD,
    make_id: 999,
    models: [{ model_id: CUTLASS, name: "Cutlass" }],
    years: [{ year: 1999, m: [0] }],
  },
};

function memoryR2(files: Record<string, unknown> = FILES): R2Bucket {
  return {
    async get(key: string) {
      if (!Object.prototype.hasOwnProperty.call(files, key)) return null;
      const text = JSON.stringify(files[key]);
      return { text: async () => text, httpEtag: `"${key}"` };
    },
  } as unknown as R2Bucket;
}

const BROKEN_R2 = {
  async get() {
    throw new Error("R2 down");
  },
} as unknown as R2Bucket;

beforeEach(() => resetVehicleStoreMemo());
afterEach(() => vi.unstubAllGlobals());

// --- the three questions (Q5: three Sections) -----------------------------------

const MAKE: LeadgenComponentNode = {
  type: "IconCardAnswerGrid",
  question_id: "q_make",
  internal_field: "vehicle_make",
  // stale typed rows + a typed default stay saved but are ignored (Q7)
  choices: [{ label: "Old", value: "old", analytics_id: "old", icon: "car" }],
  props: { choice_source: "vehicle", vehicle_asks: "make", vehicle_featured_makes: [448, 474], defaultValue: "old" },
} as unknown as LeadgenComponentNode;
const YEAR = {
  type: "ButtonAnswerGroup",
  question_id: "q_year",
  internal_field: "vehicle_year",
  props: { choice_source: "vehicle", vehicle_asks: "year", vehicle_make_field: "vehicle_make" },
} as unknown as LeadgenComponentNode;
const MODEL = {
  type: "SearchableDropdownQuestion",
  question_id: "q_model",
  internal_field: "vehicle_model",
  props: {
    choice_source: "vehicle",
    vehicle_asks: "model",
    vehicle_make_field: "vehicle_make",
    vehicle_year_field: "vehicle_year",
  },
} as unknown as LeadgenComponentNode;
const QUESTIONS = collectVehicleQuestions([[MAKE], [YEAR], [MODEL]]);

function storeEnv(media: R2Bucket = memoryR2()): { MEDIA: R2Bucket } {
  return { MEDIA: media };
}

// --- answer keys -------------------------------------------------------------------

describe("F18 answer keys — the Make question also records its snapshot", () => {
  it("fieldsOf: Make → the answer + `${field}_snapshot`; Year / Model → the answer only; no default", () => {
    expect(fieldsOf(MAKE).map((s) => [s.field, s.answerType, s.hasDefault])).toEqual([
      ["vehicle_make", "enum", false],
      ["vehicle_make_snapshot", "string", false],
    ]);
    expect(fieldsOf(YEAR).map((s) => s.field)).toEqual(["vehicle_year"]);
    expect(fieldsOf(MODEL).map((s) => s.field)).toEqual(["vehicle_model"]);
  });

  it("normalizeAnswers keeps the snapshot and never applies a stale typed default", () => {
    const content = { components: [MAKE, YEAR, MODEL] } as LeadgenSectionContent;
    const out = normalizeAnswers(content, { vehicle_make: "448", vehicle_make_snapshot: LIVE, vehicle_year: "2023", vehicle_model: COROLLA });
    expect(out.answers).toEqual({ vehicle_make: "448", vehicle_make_snapshot: LIVE, vehicle_year: "2023", vehicle_model: COROLLA });
    expect(normalizeAnswers(content, {}).answers).toEqual({});
  });

  it("/lg/ck keeps the snapshot sub-field (checkpointKnownFields)", () => {
    const resolved = {
      sections: [{ position: 0, section: { content_json: JSON.stringify({ components: [MAKE, YEAR] }) } }],
    } as unknown as ResolvedActivatedFunnel;
    const known = checkpointKnownFields(resolved);
    expect(known.has("vehicle_make")).toBe(true);
    expect(known.has("vehicle_make_snapshot")).toBe(true);
    expect(known.has("vehicle_year")).toBe(true);
  });

  it("/lg/ck learns ONLY the vehicle snapshot sub-field — other sub-fields keep today's behaviour (review fix)", () => {
    // A two-handle slider records `${field}_min` / `${field}_max` (answers.ts
    // fieldsOf), which /lg/ck has never known; F18 must not change that.
    const range = { type: "NumberRangeQuestion", question_id: "q_budget", internal_field: "budget", props: { slider_type: "dual_range" } };
    const resolved = {
      sections: [{ position: 0, section: { content_json: JSON.stringify({ components: [MAKE, range] }) } }],
    } as unknown as ResolvedActivatedFunnel;
    const known = checkpointKnownFields(resolved);
    expect(known.has("vehicle_make_snapshot")).toBe(true);
    expect([...known].sort()).toEqual(["budget", "vehicle_make", "vehicle_make_snapshot"]);
  });
});

// --- the server check before an Auction ------------------------------------------

describe("F18 server answer check — drop ids the visitor's snapshot doesn't have", () => {
  it("valid answers are kept", async () => {
    const raw = { vehicle_make: "448", vehicle_make_snapshot: LIVE, vehicle_year: "2023", vehicle_model: COROLLA, other: "x" };
    const out = await checkVehicleRawAnswers(storeEnv(), QUESTIONS, raw);
    expect(out.rawAnswers).toEqual(raw);
    expect(out.dropped).toEqual([]);
  });

  it("an unknown make id is dropped, and so are the year / model ids that depend on it", async () => {
    const out = await checkVehicleRawAnswers(storeEnv(), QUESTIONS, {
      vehicle_make: "12345",
      vehicle_year: "2023",
      vehicle_model: COROLLA,
    });
    expect(out.rawAnswers).toEqual({});
    expect(out.dropped.sort()).toEqual(["vehicle_make", "vehicle_model", "vehicle_year"]);
  });

  it("a year the make doesn't have, a model the make doesn't have, a model not in that year: dropped", async () => {
    const badYear = await checkVehicleRawAnswers(storeEnv(), QUESTIONS, { vehicle_make: "448", vehicle_year: "1990" });
    expect(badYear.rawAnswers).toEqual({ vehicle_make: "448" });
    const badModel = await checkVehicleRawAnswers(storeEnv(), QUESTIONS, { vehicle_make: "448", vehicle_model: "m_0000000000" });
    expect(badModel.rawAnswers).toEqual({ vehicle_make: "448" });
    const wrongYear = await checkVehicleRawAnswers(storeEnv(), QUESTIONS, {
      vehicle_make: "448",
      vehicle_year: { value: "2010", touched: true },
      vehicle_model: { value: BZ4X, touched: true },
    });
    expect(wrongYear.rawAnswers).toEqual({ vehicle_make: "448", vehicle_year: { value: "2010", touched: true } });
  });

  it("typed text (the lookup failed, Q6) is kept; over-long text and a junk snapshot record are dropped", async () => {
    const out = await checkVehicleRawAnswers(storeEnv(), QUESTIONS, {
      vehicle_make: "448",
      vehicle_make_snapshot: "not a snapshot",
      vehicle_year: "around 2015",
      vehicle_model: "x".repeat(81),
    });
    expect(out.rawAnswers).toEqual({ vehicle_make: "448", vehicle_year: "around 2015" });
  });

  it("the visitor's own snapshot is used (an older make is valid there), else the live one", async () => {
    const shown = await checkVehicleRawAnswers(storeEnv(), QUESTIONS, {
      vehicle_make: "999",
      vehicle_make_snapshot: OLD,
      vehicle_year: "1999",
      vehicle_model: CUTLASS,
    });
    expect(shown.dropped).toEqual([]);
    const live = await checkVehicleRawAnswers(storeEnv(), QUESTIONS, { vehicle_make: "999" });
    expect(live.dropped).toEqual(["vehicle_make"]);
  });

  it("an unreadable vehicle list keeps every answer (fail open)", async () => {
    const raw = { vehicle_make: "12345", vehicle_year: "1990", vehicle_model: "m_0000000000" };
    const out = await checkVehicleRawAnswers(storeEnv(BROKEN_R2), QUESTIONS, raw);
    expect(out.rawAnswers).toEqual(raw);
    const missing = await checkVehicleRawAnswers(storeEnv(memoryR2({})), QUESTIONS, raw);
    expect(missing.rawAnswers).toEqual(raw);
  });

  it("serve-auction's check reads the funnel's Sections (and nothing without a vehicle question)", async () => {
    const resolved = {
      sections: [
        { position: 0, section: { content_json: JSON.stringify({ components: [MAKE] }) } },
        { position: 1, section: { content_json: JSON.stringify({ components: [YEAR, MODEL] }) } },
      ],
    } as unknown as ResolvedActivatedFunnel;
    const env = { MEDIA: memoryR2() } as unknown as Env;
    const out = await applyVehicleAnswerCheck(env, resolved, { vehicle_make: "448", vehicle_model: "m_0000000000" });
    expect(out).toEqual({ vehicle_make: "448" });
    const plain = { sections: [{ position: 0, section: { content_json: '{"components":[]}' } }] } as unknown as ResolvedActivatedFunnel;
    const untouched = { vehicle_make: "12345" };
    expect(await applyVehicleAnswerCheck({ MEDIA: BROKEN_R2 } as unknown as Env, plain, untouched)).toBe(untouched);
  });
});

// --- what Offers receive (Q4) -----------------------------------------------------

const SCHEMA: LeadgenPayloadSchema = {
  version: 1,
  root: {
    type: "object",
    children: [
      { path: "car.make", name: "make", type: "string", source: "answer" },
      { path: "car.year", name: "year", type: "number", source: "answer" },
      { path: "car.model", name: "model", type: "string", source: "answer" },
    ],
  },
};

describe("F18 Offer values — names by default, ids with Send as: ID, the year as a number", () => {
  const answers = { vehicle_make: "448", vehicle_make_snapshot: LIVE, vehicle_year: "2023", vehicle_model: COROLLA };

  it("resolveVehicleAnswerValues: name + id per answer; typed text as typed", async () => {
    expect(await resolveVehicleAnswerValues(storeEnv(), QUESTIONS, answers)).toEqual({
      vehicle_make: { name: "Toyota", id: "448" },
      vehicle_year: { name: 2023, id: 2023 },
      vehicle_model: { name: "Corolla", id: COROLLA },
    });
    expect(await resolveVehicleAnswerValues(storeEnv(), QUESTIONS, { vehicle_make: "448", vehicle_model: "Corola LE" })).toEqual({
      vehicle_make: { name: "Toyota", id: "448" },
      vehicle_model: { name: "Corola LE", id: "Corola LE" },
    });
    // unreadable list (nothing kept in memory yet): no name, so the stored
    // answer is sent as it is
    resetVehicleStoreMemo();
    expect(await resolveVehicleAnswerValues(storeEnv(BROKEN_R2), QUESTIONS, answers)).toEqual({
      vehicle_year: { name: 2023, id: 2023 },
    });
  });

  it("the payload gets names by default and ids where the field says Send as: ID", async () => {
    const values = await resolveVehicleAnswerValues(storeEnv(), QUESTIONS, answers);
    const names = buildPayload(SCHEMA, {
      answers,
      answer_bindings: attachVehicleAnswers(
        {
          "car.make": [{ internal_field: "vehicle_make" }],
          "car.year": [{ internal_field: "vehicle_year" }],
          "car.model": [{ internal_field: "vehicle_model" }],
        },
        values,
      ),
    });
    expect(names).toEqual({ car: { make: "Toyota", year: 2023, model: "Corolla" } });
    const ids = buildPayload(SCHEMA, {
      answers,
      answer_bindings: attachVehicleAnswers(
        {
          "car.make": [{ internal_field: "vehicle_make", send_as: "id" }],
          "car.year": [{ internal_field: "vehicle_year", send_as: "id" }],
          "car.model": [{ internal_field: "vehicle_model", send_as: "id" }],
        },
        values,
      ),
    });
    expect(ids).toEqual({ car: { make: "448", year: 2023, model: COROLLA } });
  });

  it("a Provider's own spelling uses the value map, keyed by the name; unmapped names pass through", async () => {
    const values = await resolveVehicleAnswerValues(storeEnv(), QUESTIONS, { vehicle_make: "441" });
    const bindings = { "car.make": [{ internal_field: "vehicle_make", value_map: { Chevrolet: "Chevy" } }] };
    expect(buildPayload(SCHEMA, { answers: { vehicle_make: "441" }, answer_bindings: attachVehicleAnswers(bindings, values) })).toEqual({
      car: { make: "Chevy" },
    });
    const toyota = await resolveVehicleAnswerValues(storeEnv(), QUESTIONS, { vehicle_make: "448" });
    expect(buildPayload(SCHEMA, { answers: { vehicle_make: "448" }, answer_bindings: attachVehicleAnswers(bindings, toyota) })).toEqual({
      car: { make: "Toyota" },
    });
  });

  it("buildOfferPayload (Section payload preview) carries send_as and the names", async () => {
    const values = await resolveVehicleAnswerValues(storeEnv(), QUESTIONS, answers);
    const payload = buildOfferPayload(
      [
        { internal_field: "vehicle_make", offer_payload_field_path: "car.make", provider_expected_type: "string" },
        { internal_field: "vehicle_model", offer_payload_field_path: "car.model", provider_expected_type: "string", send_as: "id" },
      ],
      answers,
      undefined,
      values,
    );
    expect(payload).toEqual({ car: { make: "Toyota", model: COROLLA } });
  });

  it("without vehicle values every answer is sent exactly as before", () => {
    expect(
      buildPayload(SCHEMA, { answers, answer_bindings: { "car.make": [{ internal_field: "vehicle_make", send_as: "id" }] } }),
    ).toEqual({ car: { make: "448" } });
  });
});

describe("F18 mapping completeness — vehicle fields need no per-choice value list", () => {
  const schema = (type: "string" | "number"): OfferSchemaInfo => ({
    status: "active",
    activity: "quote_funnel",
    vertical: "auto",
    active_schema_id: 1,
    active_schema_public_id: "lgp_1",
    fieldTypes: new Map([["car.x", type]]),
    requiredFieldPaths: [],
  });
  const edge = (sendAs: "name" | "id" | null) => ({
    question_id: "q",
    question_key: "q",
    internal_field: "f",
    answer_type: "enum",
    offer_id: 1,
    offer_payload_field_path: "car.x",
    provider_expected_type: "string",
    output_value_map: null,
    value_transform: null,
    required_for_offer: true,
    default_value: null,
    fallback_value: null,
    send_as: sendAs,
  });
  it("a name into a text field is complete; a make name into a number field is not; ids and years into a number field are", () => {
    expect(mappingCompleteness(edge(null), schema("string"), vehicleAnswerValues("make", null))).toBe("complete");
    expect(mappingCompleteness(edge(null), schema("string"), vehicleAnswerValues("model", null))).toBe("complete");
    const num = (sendAs: "name" | "id" | null) => ({ ...edge(sendAs), provider_expected_type: "number" });
    expect(mappingCompleteness(num(null), schema("number"), vehicleAnswerValues("make", null))).toBe("type_mismatch");
    expect(mappingCompleteness(num("id"), schema("number"), vehicleAnswerValues("make", "id"))).toBe("complete");
    expect(mappingCompleteness(num(null), schema("number"), vehicleAnswerValues("year", null))).toBe("complete");
    expect(mappingCompleteness(num("id"), schema("number"), vehicleAnswerValues("model", "id"))).toBe("type_mismatch");
  });
});

// --- sqlite harness: migration 0069, Send as round trip, Simulator, Test tab ------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string, options?: { enableForeignKeyConstraints?: boolean }) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    return null;
  }
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");

function d1FromSqlite(sdb: SqliteDb): D1Database {
  const prep = (sql: string, binds: unknown[] = []): D1PreparedStatement =>
    ({
      bind: (...next: unknown[]) => prep(sql, next),
      first: async <T>() => (sdb.prepare(sql).get(...binds) ?? null) as T | null,
      all: async <T>() => ({ results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }),
      run: async () => {
        const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
        return { success: true, meta: { changes: Number(r.changes ?? 0), last_row_id: Number(r.lastInsertRowid ?? 0) } };
      },
    }) as unknown as D1PreparedStatement;
  return {
    prepare: (sql: string) => prep(sql),
    batch: async (statements: D1PreparedStatement[]) => {
      const out = [];
      for (const s of statements) out.push(await (s as unknown as { run(): Promise<unknown> }).run());
      return out;
    },
  } as unknown as D1Database;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function harness(): { sdb: SqliteDb; env: Env } {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:", { enableForeignKeyConstraints: false });
  (sdb["exec"] as (s: string) => void)(
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, filename TEXT, storage_key TEXT, created_at INTEGER);",
  );
  // every leadgen migration in filename order — the same scan the existing
  // in-memory suites use (0069 included)
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && f.includes("leadgen")).sort()) {
    (sdb["exec"] as (s: string) => void)(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  const db = d1FromSqlite(sdb);
  const env = {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: memoryR2(),
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
  } as unknown as Env;
  return { sdb, env };
}

const CAR_SCHEMA = {
  version: 1,
  root: {
    type: "object",
    children: [
      { path: "car.make", name: "make", type: "string", source: "answer" },
      { path: "car.make_id", name: "make_id", type: "number", source: "answer" },
      { path: "car.year", name: "year", type: "number", source: "answer" },
      { path: "car.model", name: "model", type: "string", source: "answer" },
    ],
  },
};
const CARRIER_PARSE = JSON.stringify({ carriers_path: "carriers", fields: { carrier_name: "name", bid: "bid", click_url: "url", carrier_logo: "logo" } });

function seedOffer(sdb: SqliteDb): { id: number; public_id: string; placement_id: number; schema_id: number; schema_public_id: string } {
  const publicId = mintPublicId("offer");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, request_method, endpoint_production, endpoint_staging, status,
          last_test_status, last_test_at, last_test_source)
       VALUES (?, 'Car Offer', 'Prov', 'quote_funnel', 'auto', 's2s_postback', 'cpc', 1, 'response', 'server', 'POST',
               'https://provider.example/quote', 'https://staging.provider.example/quote', 'active', 'passed', unixepoch(), 'test')`,
    )
    .run(publicId);
  const id = (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
  const schemaPublic = mintPublicId("payload_schema_version");
  sdb
    .prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, carrier_parse_version, source) VALUES (?, ?, 1, ?, ?, 1, 'manual')",
    )
    .run(schemaPublic, id, JSON.stringify(CAR_SCHEMA), CARRIER_PARSE);
  const schemaId = (sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = ?").get(schemaPublic) as { id: number }).id;
  sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(schemaId, id);
  const placementPublic = mintPublicId("offer_placement");
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, 'plc-car', 1)").run(placementPublic, id);
  const placementId = (sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number }).id;
  return { id, public_id: publicId, placement_id: placementId, schema_id: schemaId, schema_public_id: schemaPublic };
}

// One Section asking Make / Year / Model (Q5 allows one Section), mapped to the
// Offer's four fields through the REAL Sections API (parseAnswerMaps + rebuild).
async function createCarSection(env: Env, offerId: number, makeIdEdge: Record<string, unknown> = { send_as: "id" }): Promise<Response> {
  return admin.request(
    `${API}/sections`,
    jsonInit("POST", {
      section_name: "Your car",
      activity: "quote_funnel",
      vertical: "auto",
      headline_text: "Your car",
      content_json: JSON.stringify({ components: [MAKE, YEAR, MODEL] }),
      answer_maps: [
        { question_id: "q_make", offer_id: offerId, offer_payload_field_path: "car.make", provider_expected_type: "string" },
        {
          question_id: "q_make",
          offer_id: offerId,
          offer_payload_field_path: "car.make_id",
          provider_expected_type: "number",
          ...makeIdEdge,
        },
        { question_id: "q_year", offer_id: offerId, offer_payload_field_path: "car.year", provider_expected_type: "number" },
        { question_id: "q_model", offer_id: offerId, offer_payload_field_path: "car.model", provider_expected_type: "string" },
      ],
    }),
    env,
  );
}

const SAMPLE = { vehicle_make: "448", vehicle_make_snapshot: LIVE, vehicle_year: "2023", vehicle_model: COROLLA };

describeDb("F18 Send as — migration 0069 and the Section mapping rows", () => {
  it("0069 applies on the in-memory database the suites use: a nullable send_as limited to name / id", () => {
    const { sdb } = harness();
    const cols = sdb.prepare("PRAGMA table_info(leadgen_section_answer_maps)").all() as Array<{ name: string; notnull: number }>;
    const col = cols.find((c) => c.name === "send_as");
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(0);
    const insert = (value: unknown) =>
      sdb
        .prepare(
          `INSERT INTO leadgen_section_answer_maps (public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id,
             payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type, send_as)
           VALUES (?, 1, 'q', 'q', 'f', 'enum', 1, 1, 'lgp', 'a.b', 'string', ?)`,
        )
        .run(mintPublicId("answer_field_map"), value);
    expect(() => insert("id")).not.toThrow();
    expect(() => insert(null)).not.toThrow();
    expect(() => insert("label")).toThrow();
  });

  it("parseAnswerMaps round-trips send_as; a scalar-only PATCH and a duplicate keep it; the mapping is complete", async () => {
    const { sdb, env } = harness();
    const offer = seedOffer(sdb);
    const res = await createCarSection(env, offer.id);
    expect(res.status, await res.clone().text()).toBe(201);
    const created = (await res.json()) as { id: number; public_id: string };
    const rows = () =>
      sdb.prepare("SELECT offer_payload_field_path AS path, send_as, mapping_status FROM leadgen_section_answer_maps WHERE section_id = ? ORDER BY id").all(created.id) as Array<{
        path: string;
        send_as: string | null;
        mapping_status: string;
      }>;
    expect(rows()).toEqual([
      { path: "car.make", send_as: null, mapping_status: "complete" },
      { path: "car.make_id", send_as: "id", mapping_status: "complete" },
      { path: "car.year", send_as: null, mapping_status: "complete" },
      { path: "car.model", send_as: null, mapping_status: "complete" },
    ]);
    const detail = (await (await admin.request(`${API}/sections/${created.public_id}`, {}, env)).json()) as {
      answer_maps: Array<{ offer_payload_field_path: string; send_as?: string | null }>;
    };
    expect(detail.answer_maps.find((m) => m.offer_payload_field_path === "car.make_id")?.send_as).toBe("id");

    const patch = await admin.request(`${API}/sections/${created.public_id}`, jsonInit("PATCH", { section_name: "Renamed" }), env);
    expect(patch.status).toBe(200);
    // the PATCH re-sent the stored mapping rows (storedAnswerMapsAsInput)
    expect(rows().map((r) => r.send_as)).toEqual([null, "id", null, null]);

    const dup = await admin.request(`${API}/sections/${created.public_id}/duplicate`, jsonInit("POST", {}), env);
    expect(dup.status).toBeLessThan(300);
    const copy = (await dup.json()) as { id: number };
    const copied = sdb.prepare("SELECT send_as FROM leadgen_section_answer_maps WHERE section_id = ? ORDER BY id").all(copy.id) as Array<{ send_as: string | null }>;
    expect(copied.map((r) => r.send_as)).toEqual([null, "id", null, null]);
  });

  it("only \"id\" is stored: Name (the key left out, \"name\", or anything else) is the default, NULL", async () => {
    for (const edge of [{}, { send_as: "name" }, { send_as: "label" }]) {
      const { sdb, env } = harness();
      const offer = seedOffer(sdb);
      const res = await createCarSection(env, offer.id, edge);
      expect(res.status).toBe(201);
      const created = (await res.json()) as { id: number };
      const stored = sdb.prepare("SELECT send_as FROM leadgen_section_answer_maps WHERE section_id = ? ORDER BY id").all(created.id) as Array<{ send_as: string | null }>;
      expect(stored.map((r) => r.send_as)).toEqual([null, null, null, null]);
    }
  });

  it("the Section payload preview sends names, the make id where asked, the year as a number", async () => {
    const { sdb, env } = harness();
    const offer = seedOffer(sdb);
    const created = (await (await createCarSection(env, offer.id)).json()) as { public_id: string };
    const res = await admin.request(`${API}/sections/${created.public_id}/validate-payload`, jsonInit("POST", { answers: SAMPLE }), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results?: Array<{ payload: unknown }>; offers?: Array<{ payload: unknown }> };
    const list = body.results ?? body.offers ?? [];
    expect(list[0]?.payload).toEqual({ car: { make: "Toyota", make_id: 448, year: 2023, model: "Corolla" } });
  });
});

describeDb("F18 Offer names in the admin previews and the dry-run auction", () => {
  it("Simulator: the payload preview AND the dry run's own provider request carry the names", async () => {
    const { sdb, env } = harness();
    const offer = seedOffer(sdb);
    expect((await createCarSection(env, offer.id)).status).toBe(201);
    const auctionPublic = mintPublicId("auction");
    sdb
      .prepare(
        `INSERT INTO leadgen_auctions
           (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
            surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
            backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
         VALUES (?, 'Sim', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled', 1, 5, 3, 10, 'disabled', 'on_slot_exhaustion', 0, 'offer', 2500, 1, 'active')`,
      )
      .run(auctionPublic);
    const auctionId = (sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(auctionPublic) as { id: number }).id;
    sdb
      .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, enabled) VALUES (?, ?, ?, 0, 1)")
      .run(auctionId, offer.placement_id, offer.id);
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      bodies.push(url instanceof Request ? await url.clone().text() : String(init?.body ?? ""));
      return new Response(JSON.stringify({ carriers: [{ name: "Acme", bid: 12, url: "https://acme.example/c", logo: "https://acme.example/l.png" }] }), { status: 200 });
    });
    const res = await admin.request(`${API}/auctions/${auctionPublic}/simulate`, jsonInit("POST", { sample_answers: SAMPLE }), env);
    expect(res.status, await res.clone().text()).toBe(200);
    const j = (await res.json()) as { offers_payload_explain: Array<{ offer_id: string; payload_preview: unknown }> };
    const expected = { car: { make: "Toyota", make_id: 448, year: 2023, model: "Corolla" } };
    expect(j.offers_payload_explain.find((e) => e.offer_id === offer.public_id)?.payload_preview).toEqual(expected);
    const posted = bodies.find((b) => b.includes("Corolla"));
    expect(posted, "the dry run posted the Offer's request").toBeDefined();
    expect(JSON.parse(posted!)).toEqual(expected);
  });

  it("Offer Test tab (dry run): the request payload carries the names", async () => {
    const { sdb, env } = harness();
    const offer = seedOffer(sdb);
    expect((await createCarSection(env, offer.id)).status).toBe(201);
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
    const res = await admin.request(
      `${API}/offers/${offer.id}/test`,
      jsonInit("POST", { environment: "staging", sample_answers: SAMPLE, dry_run: true }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as { request: { payload: unknown } };
    expect(body.request.payload).toEqual({ car: { make: "Toyota", make_id: 448, year: 2023, model: "Corolla" } });
  });
});
