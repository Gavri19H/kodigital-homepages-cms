// Payload builder Output format "Remove special characters and spacing"
// (2026-10-19). Owner verbatim: "In the "Leadgen" --> Offers" --> "Payload" -->
// "Payload builder" --> "field" -->"Output Format" field, add a "Remove special
// characters and spacing" option. This should support a situation when a user
// fill a given pattern (Phone number for example) that includes special
// characters that we don't want to send. ... Assuming he's filling it out using
// an American format such as (707) 849 3710 --> AmOne requesting it to be sent
// as a simple string "7078493710""
//
// The `removeSpecial` transform kind: String(value) with every character that
// is not a letter, a combining mark or a digit removed (Unicode \p{L} \p{M}
// \p{N} kept); a value in EXACTLY our stored US phone shape (/^\+1\d{10}$/ —
// the "+1" the visitor runtime's normalizePhoneE164 adds at capture) sends its
// 10 national digits; the output is a STRING; an empty result or a non
// string/number input is INVALID (→ the node's fallback), like the other
// formatters. Idempotent.
//
// This file is the runtime unit floor (the exact emitted strings + edge
// cases), buildPayload over a hand-written binding (the shape
// answer-bindings.ts produces — says so in its name), and the REAL route: the
// visitor's phone answer as the runtime stores it → normalizeAnswers →
// readAnswerBindings over real D1 rows → fetchProvider (the bytes the provider
// receives), plus the admin Test tab's sample-answers path for the same field.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import type { LeadgenOfferRow } from "../src/admin/leadgen/db-types";
import { normalizeAnswers } from "../src/leadgen/answers";
import { readAnswerBindings } from "../src/leadgen/answer-bindings";
import {
  applyTransformPipeline,
  buildPayload,
  LEADGEN_TRANSFORM_KINDS,
  validatePayloadSchema,
  type LeadgenPayloadSchema,
} from "../src/leadgen/payload";
import { fetchProvider } from "../src/public/leadgen/auction/fetch";
import { formatKindFor, normalizePhoneE164 } from "../src/public/leadgen/runtime/validation";
import type { LgComponentConfig } from "../src/public/leadgen/runtime/state";

const strip = (value: unknown): unknown => applyTransformPipeline(value, [{ kind: "removeSpecial" }] as never);

describe("removeSpecial — the emitted string", () => {
  it('"(707) 849 3710" → EXACTLY "7078493710" (the owner\'s AmOne example)', () => {
    expect(strip("(707) 849 3710")).toBe("7078493710");
  });

  it('the STORED phone shape "+17078493710" (what the visitor runtime records for "(707) 849 3710") → "7078493710"', () => {
    expect(strip("+17078493710")).toBe("7078493710");
    expect(strip("+12155551234")).toBe("2155551234");
  });

  it('only the EXACT stored shape drops the "+1": a typed "+1 (707) 849-3710" keeps the generic rule → "17078493710"', () => {
    expect(strip("+1 (707) 849-3710")).toBe("17078493710");
    // near misses of /^\+1\d{10}$/ — generic rule, no digit is ever dropped
    expect(strip("+170784937101")).toBe("170784937101"); // 11 digits after +1
    expect(strip("+1707849371")).toBe("1707849371"); // 9 digits after +1
    expect(strip("+447078493710")).toBe("447078493710"); // another country code
    expect(strip("17078493710")).toBe("17078493710"); // no "+"
    expect(strip(17078493710)).toBe("17078493710"); // a number never matches the stored text shape
  });

  it('Unicode letters survive: "José Núñez" → "JoséNúñez"', () => {
    expect(strip("José Núñez")).toBe("JoséNúñez");
  });

  it('combining marks survive: NFD "José Núñez" stays readable (no accent dropped)', () => {
    const nfd = "José Núñez".normalize("NFD");
    expect(nfd).not.toBe("José Núñez"); // really decomposed: e + U+0301 …
    const out = strip(nfd);
    expect(out).toBe("JoséNúñez".normalize("NFD"));
    expect((out as string).normalize("NFC")).toBe("JoséNúñez");
  });

  it('Hindi vowel signs and virama (marks, not letters) survive: "हिन्दी नाम" → "हिन्दीनाम"', () => {
    expect(strip("हिन्दी नाम")).toBe("हिन्दीनाम");
  });

  it('a number answer is stringified first: 707.5 → "7075" (a STRING, never a number)', () => {
    expect(strip(707.5)).toBe("7075");
    expect(typeof strip(7078493710)).toBe("string");
    expect(strip(7078493710)).toBe("7078493710");
  });

  it("is IDEMPOTENT on its own output", () => {
    for (const raw of [
      "(707) 849 3710",
      "+17078493710",
      "+1 (707) 849-3710",
      "José Núñez",
      "José Núñez".normalize("NFD"),
      "हिन्दी नाम",
      707.5,
      "a-b_c.d",
    ]) {
      const once = strip(raw);
      expect(strip(once), String(raw)).toBe(once);
    }
  });

  it('INVALID (→ the node\'s fallback) when nothing is left or the input is not a string/number: "---", "", "   ", true, null, {}, []', () => {
    for (const bad of ["---", "", "   ", "()- .", true, null, undefined, {}, [], Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(strip(bad), JSON.stringify(bad) ?? String(bad)).toBeUndefined();
    }
  });
});

describe("removeSpecial — buildPayload over a HAND-WRITTEN answer binding (the shape answer-bindings.ts produces)", () => {
  // The node the Output-format control writes (type string + ONE removeSpecial
  // step) and a binding literal in the shape readAnswerBindings returns. This
  // block exercises buildPayload only — the real D1 → binding route is the
  // "REAL route" block below.
  const schema = (extra: Record<string, unknown> = {}): LeadgenPayloadSchema =>
    ({
      version: 1,
      root: {
        type: "object",
        children: [
          {
            path: "lead.home_phone",
            name: "home_phone",
            type: "string",
            source: "answer",
            transform: [{ kind: "removeSpecial" }],
            ...extra,
          },
        ],
      },
    }) as unknown as LeadgenPayloadSchema;
  const bindings = { "lead.home_phone": [{ internal_field: "home_phone" }] };

  it('the business-loans home phone "(707) 849 3710" is sent as the string "7078493710"', () => {
    const payload = buildPayload(schema(), { answers: { home_phone: "(707) 849 3710" }, answer_bindings: bindings });
    expect(payload).toEqual({ lead: { home_phone: "7078493710" } });
    expect(JSON.stringify(payload)).toBe('{"lead":{"home_phone":"7078493710"}}');
  });

  it('an answer with nothing left ("---") takes the node\'s fallback', () => {
    const payload = buildPayload(schema({ fallback: "0000000000" }), {
      answers: { home_phone: "---" },
      answer_bindings: bindings,
    });
    expect(payload).toEqual({ lead: { home_phone: "0000000000" } });
  });

  it("an answer with nothing left and no fallback drops the field (never an empty string)", () => {
    expect(buildPayload(schema(), { answers: { home_phone: "" }, answer_bindings: bindings })).toEqual({});
    expect(buildPayload(schema(), { answers: { home_phone: "() -" }, answer_bindings: bindings })).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// The REAL route (fix round B1 / MINOR-5). Production fact (read-only, conductor
// 2026-10-19): AmONE's HomePhone is filled by q_mrun7kvo_l2s0, a
// PhoneInputQuestion with no mask/preset, and the reviewer's live visitor drive
// recorded "+17078493710" for a typed "(707) 849 3710" — the visitor runtime
// (runtime/engine.ts, the PhoneInputQuestion branch with no mask) stores
// normalizePhoneE164(value). Every function below is the production one. The
// offer and its payload schema are written by the real admin routes over the
// real migrations (node:sqlite harness, repo pattern); the section and its
// answer-map rows are seeded with plain SQL INSERTs; only the provider's HTTP
// endpoint is stubbed so the exact request body can be read.
// ---------------------------------------------------------------------------

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
      const getBuiltin = (process as unknown as { getBuiltinModule?: (name: string) => unknown }).getBuiltinModule;
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
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
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
        for (const statement of statements) results.push(await statement.run());
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

// The same migration set the Test-tool suite (leadgen-test-tool.test.ts) runs
// its admin routes over.
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
  "0057_leadgen_offer_test_verdict.sql",
] as const;

function createLeadgenDb(ctor: DatabaseSyncCtor): SqliteDb {
  const sdb = new ctor(":memory:");
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

function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: memoryKv(),
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
const API = "/api/admin/leadgen";
const STAGING_URL = "https://staging.amone.example.com/leads";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// The production question that fills AmONE's HomePhone: a PhoneInputQuestion,
// no mask, no preset.
const PHONE_QUESTION = {
  type: "PhoneInputQuestion",
  question_id: "q_mrun7kvo_l2s0",
  internal_field: "home_phone",
};

interface RouteHarness {
  sdb: SqliteDb;
  env: Env;
  offerId: number;
  offerPublicId: string;
  schemaId: number;
  sectionId: number;
}

// Offer + payload schema through the REAL admin routes (the schema is the
// builder's saved shape: HomePhone string, source answer, Output format
// removeSpecial on the node); the Section that asks the phone question + its
// answer-map row (Section tab: HomePhone ← home_phone, NO transform of its own,
// as in production).
async function setupRoute(): Promise<RouteHarness> {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  const env = buildEnv(d1FromSqlite(sdb));
  const createRes = await admin.request(
    `${API}/offers`,
    jsonInit("POST", {
      offer_name: "AmONE - Tier 2 (test)",
      activity: "quote_funnel",
      vertical: "life",
      conversion_tracking_method: "s2s_postback",
      offer_type: "cpc",
      placements: ["pl-amone-1"],
      calls_provider_api: true,
      bid_source: "response",
      cap_enabled: false,
    }),
    env,
  );
  expect(createRes.status).toBe(201);
  const offer = (await createRes.json()) as { id: number; public_id: string };
  const patchRes = await admin.request(
    `${API}/offers/${offer.id}`,
    jsonInit("PATCH", {
      endpoint_production: "https://api.amone.example.com/leads",
      endpoint_staging: STAGING_URL,
      request_method: "POST",
    }),
    env,
  );
  expect(patchRes.status).toBe(200);
  const schemaRes = await admin.request(
    `${API}/offers/${offer.id}/payload-schemas`,
    jsonInit("POST", {
      schema_json: {
        version: 1,
        root: {
          type: "object",
          children: [
            {
              path: "HomePhone",
              name: "HomePhone",
              type: "string",
              source: "answer",
              transform: [{ kind: "removeSpecial" }],
            },
          ],
        },
      },
      carrier_parse_json: { carriers_path: "carriers", fields: { carrier_name: "name", bid: "bid", click_url: "url" } },
    }),
    env,
  );
  expect(schemaRes.status).toBe(201);
  const schema = (await schemaRes.json()) as { id: number };
  const schemaPublicId = (
    sdb.prepare("SELECT public_id FROM leadgen_offer_payload_schemas WHERE id = ?").get(schema.id) as {
      public_id: string;
    }
  ).public_id;

  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, ?, 'quote_funnel', 'life', 'H', ?)",
    )
    .run("lgs_homephone01", "Contact", JSON.stringify({ components: [PHONE_QUESTION] }));
  const sectionId = (
    sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get("lgs_homephone01") as { id: number }
  ).id;
  sdb
    .prepare("INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected) VALUES (?, ?, 1)")
    .run(sectionId, offer.id);
  sdb
    .prepare(
      `INSERT INTO leadgen_section_answer_maps
         (public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id,
          payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type,
          mapping_status, validation_status)
       VALUES (?, ?, ?, ?, ?, 'string', ?, ?, ?, ?, 'string', 'complete', 'ok')`,
    )
    .run(
      "lgm_homephone0",
      sectionId,
      PHONE_QUESTION.question_id,
      PHONE_QUESTION.internal_field,
      PHONE_QUESTION.internal_field,
      offer.id,
      schema.id,
      schemaPublicId,
      "HomePhone",
    );
  return { sdb, env, offerId: offer.id, offerPublicId: offer.public_id, schemaId: schema.id, sectionId };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describeDb("removeSpecial — the REAL route: visitor phone answer → stored shape → bindings → provider request", () => {
  it('a PhoneInputQuestion answer "(707) 849 3710", stored as the visitor runtime stores it, reaches the provider as "7078493710"', async () => {
    const h = await setupRoute();

    // 1) Visitor runtime capture: the question is a phone-format component with
    //    no compiled mask, so runtime/engine.ts records normalizePhoneE164(typed).
    const sectionRow = h.sdb.prepare("SELECT content_json FROM leadgen_sections WHERE id = ?").get(h.sectionId) as {
      content_json: string;
    };
    const content = JSON.parse(sectionRow.content_json) as { components: Array<Record<string, unknown>> };
    const component = content.components[0] as unknown as LgComponentConfig;
    expect(formatKindFor(component)).toBe("phone");
    expect((component as unknown as Record<string, unknown>)["client_validation"]).toBeUndefined(); // no mask
    const stored = normalizePhoneE164("(707) 849 3710");
    expect(stored).toBe("+17078493710");

    // 2) Server leg, the auction engine's own order (auction/engine.ts):
    //    normalizeAnswers(section content, posted envelope) → readAnswerBindings
    //    (the Section rows, for the Sections the lead passed) → fetchProvider.
    const posted = { home_phone: { value: stored, answer_source: "user_selected" } };
    const { answers } = normalizeAnswers(content as never, posted as never);
    expect(answers["home_phone"]).toBe("+17078493710");
    const bindings = (await readAnswerBindings(h.env.DB, [h.offerId], [h.sectionId])).get(h.offerId) ?? {};
    expect(bindings["HomePhone"]).toEqual([{ internal_field: "home_phone" }]);

    const offerRow = h.sdb.prepare("SELECT * FROM leadgen_offers WHERE id = ?").get(h.offerId) as LeadgenOfferRow;
    const schemaRow = h.sdb
      .prepare("SELECT schema_json FROM leadgen_offer_payload_schemas WHERE id = ?")
      .get(h.schemaId) as { schema_json: string };
    const savedSchema = JSON.parse(schemaRow.schema_json) as LeadgenPayloadSchema;

    const sent: Array<{ url: string; body: string }> = [];
    vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      sent.push({ url: String(url), body: typeof init?.body === "string" ? init.body : "" });
      return new Response(JSON.stringify({ carriers: [] }), { status: 200 });
    });
    await fetchProvider(
      h.env,
      offerRow,
      [],
      savedSchema,
      { answers, answer_bindings: bindings, macros: {}, timeout_ms: 2500 },
      "staging",
    );

    // 3) The bytes the provider receives.
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe(STAGING_URL);
    expect(sent[0]?.body).toBe('{"HomePhone":"7078493710"}');
  });

  it('the admin Test tab sample-answers path for the same phone field sends the same "7078493710"', async () => {
    const h = await setupRoute();
    // The Test tab's form: generated from the Section rows (the phone field is
    // classified from its PhoneInputQuestion).
    const genRes = await admin.request(`${API}/offers/${h.offerId}/payload/sample-answers`, { method: "POST" }, h.env);
    expect(genRes.status).toBe(200);
    const gen = (await genRes.json()) as { answers: Record<string, unknown>; fields: Array<{ internal_field: string }> };
    expect(gen.fields.map((f) => f.internal_field)).toEqual(["home_phone"]);

    // The operator types the owner's example — or pastes the stored shape a
    // real lead carries — into the phone answer; the draft is saved and the
    // form re-generated with it, then Test runs (dry run: build + mask only).
    for (const typed of ["(707) 849 3710", "+17078493710"]) {
      const putRes = await admin.request(
        `${API}/offers/${h.offerId}/payload/sample-answers`,
        jsonInit("PUT", { answers: { ...gen.answers, home_phone: typed } }),
        h.env,
      );
      expect(putRes.status).toBe(200);
      const again = (await (
        await admin.request(`${API}/offers/${h.offerId}/payload/sample-answers`, { method: "POST" }, h.env)
      ).json()) as { answers: Record<string, unknown> };
      expect(again.answers["home_phone"]).toBe(typed);
      const testRes = await admin.request(
        `${API}/offers/${h.offerId}/test`,
        jsonInit("POST", { environment: "staging", sample_answers: again.answers, dry_run: true }),
        h.env,
      );
      expect(testRes.status).toBe(200);
      const body = (await testRes.json()) as { request: { payload: Record<string, unknown> } };
      expect(body.request.payload, typed).toEqual({ HomePhone: "7078493710" });
    }
  });
});

describe("removeSpecial — one allow-list, every validator", () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), "utf8");

  it("is in the exported list, the type union, and the runtime switch", () => {
    expect([...LEADGEN_TRANSFORM_KINDS]).toContain("removeSpecial");
    const payloadSrc = read("../src/leadgen/payload.ts");
    expect(payloadSrc).toContain(`| { kind: "removeSpecial" }`);
    expect(payloadSrc).toContain(`case "removeSpecial":`);
  });

  it("validator #1 (payload.ts validatePayloadSchema) accepts it on a string answer field", () => {
    const res = validatePayloadSchema({
      version: 1,
      root: {
        type: "object",
        children: [
          {
            path: "lead.home_phone",
            name: "home_phone",
            type: "string",
            source: "answer",
            transform: [{ kind: "removeSpecial" }],
          },
        ],
      },
    });
    expect(res.errors.filter((e) => e.code === "transform_invalid")).toHaveLength(0);
    expect(res.ok).toBe(true);
  });

  it("validator #2 (admin sections-handlers parseTransformSteps) builds its allow-list FROM the exported list", () => {
    const adminSrc = read("../src/admin/leadgen/sections-handlers.ts");
    expect(adminSrc).toContain("new Set(LEADGEN_TRANSFORM_KINDS)");
    expect(adminSrc).not.toContain(`"removeSpecial"`);
  });
});
