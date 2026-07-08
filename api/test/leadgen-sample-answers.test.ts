// LeadGen fix-contract v2.4 Phase 2 — the B4 sample-answer endpoint
// (06 §6.12.1), the B7 pre-SAVE validity gate (05 §5.5), the §6.14
// byte-equivalent re-save regression, and the additive `builder_context`
// projection on the Offer GET — over the REAL admin router + REAL
// migrations (repo node:sqlite harness).
//
// PINNED response shape (the ui-payload-builder sibling codes against it):
//   POST /offers/:id/payload/sample-answers →
//     { answers: Record<internal_field, sample_value>,
//       fields: [{ internal_field, label,
//                  kind: "enum"|"boolean"|"date"|"zip"|"address"|"text"|"number",
//                  options?: [{value,label}], sample, required, source_path }] }
//   PUT (same route) persists {answers} as the per-Offer KV draft
//   (`lg-testdraft:<lgo_…>`); POST merges a persisted draft over generated.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { TEST_DRAFT_KV_PREFIX } from "../src/admin/leadgen/payload-builder-handlers";

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

function recordingKv(): {
  kv: KVNamespace;
  store: Map<string, string>;
  putOpts: Map<string, { expirationTtl?: number } | undefined>;
} {
  const store = new Map<string, string>();
  const putOpts = new Map<string, { expirationTtl?: number } | undefined>();
  const kv = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      store.set(key, value);
      putOpts.set(key, opts);
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
  return { kv, store, putOpts };
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv,
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

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

interface Harness {
  sdb: SqliteDb;
  env: Env;
  store: Map<string, string>;
  putOpts: Map<string, { expirationTtl?: number } | undefined>;
  offerId: number;
  offerPublicId: string;
}

async function createDynamicOffer(env: Env): Promise<{ id: number; public_id: string }> {
  const res = await admin.request(
    `${API}/offers`,
    jsonInit("POST", {
      offer_name: "Sample Dyn Offer",
      activity: "quote_funnel",
      vertical: "life",
      conversion_tracking_method: "s2s_postback",
      offer_type: "cpc",
      placements: ["pl-sample-1"],
      calls_provider_api: true,
      bid_source: "response",
      cap_enabled: false,
    }),
    env,
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: number; public_id: string };
}

function newHarness(): Harness {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createLeadgenDb(ctor);
  const { kv, store, putOpts } = recordingKv();
  const env = buildEnv(d1FromSqlite(sdb), kv);
  return { sdb, env, store, putOpts, offerId: 0, offerPublicId: "" };
}

async function harnessWithOffer(): Promise<Harness> {
  const h = newHarness();
  const offer = await createDynamicOffer(h.env);
  h.offerId = offer.id;
  h.offerPublicId = offer.public_id;
  return h;
}

// The B4 fixture schema: one node per §6.12.1 heuristic row (+ non-answer
// sources that must NOT appear in the form, + a duplicated internal_field
// whose `required` must OR across nodes).
function sampleFixtureSchema(): Record<string, unknown> {
  return {
    version: 1,
    root: {
      type: "object",
      children: [
        { path: "contact.email", name: "email", type: "string", required: true, source: "answer", internal_field: "email" },
        { path: "contact.zip", name: "zip", type: "string", required: true, source: "answer", internal_field: "zip" },
        { path: "contact.street", name: "street", type: "string", source: "answer", internal_field: "street_address" },
        {
          path: "applicant.dob", name: "dob", type: "string", required: true, source: "answer",
          internal_field: "dob", transform: [{ kind: "formatDate", format: "MM/DD/YYYY" }],
        },
        {
          path: "applicant.homeowner", name: "homeowner", type: "boolean", source: "answer",
          internal_field: "homeowner", value_map: { true: true, false: false },
        },
        {
          path: "applicant.carrier", name: "carrier", label: "Current carrier", type: "string", source: "answer",
          internal_field: "carrier", value_map: { acme: "ACM", globex: "GLX" },
          choiceDisplay: { mainValues: ["acme"], otherGroupEnabled: true },
        },
        { path: "applicant.age", name: "age", type: "number", source: "answer", internal_field: "age" },
        { path: "policy.start_date", name: "start_date", type: "string", source: "answer", internal_field: "policy_start_date" },
        { path: "applicant.phone", name: "phone", type: "string", source: "answer", internal_field: "phone" },
        { path: "notes", name: "notes", type: "string", source: "answer", internal_field: "notes" },
        {
          path: "tier", name: "tier", type: "enum", source: "answer", internal_field: "tier",
          valid_values: ["basic", "premium"],
        },
        // required-OR pair: first node optional, second node REQUIRED.
        { path: "shared.a", name: "a", type: "string", source: "answer", internal_field: "shared_field" },
        { path: "shared.b", name: "b", type: "string", required: true, source: "answer", internal_field: "shared_field" },
        // NON-answer sources — never form fields:
        { path: "plan", name: "plan", type: "string", source: "static", value: "gold" },
        { path: "meta.offer", name: "offer", type: "string", source: "macro", macro: "offer_id" },
        { path: "meta.stamp", name: "stamp", type: "number", source: "computed", computed: "request_timestamp" },
      ],
    },
  };
}

async function activateSchema(h: Harness, schema: Record<string, unknown>): Promise<number> {
  const res = await admin.request(
    `${API}/offers/${h.offerId}/payload-schemas`,
    jsonInit("POST", { schema_json: schema }),
    h.env,
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

// Linked Section fixture: one component per kind-driving type. Inserted
// directly (the loaders read content_json; API-side section authoring is
// Phase 4's surface).
function linkSectionWithComponents(h: Harness): void {
  const content = {
    components: [
      {
        type: "ButtonAnswerGroup", question_id: "q-carrier", internal_field: "carrier", answer_type: "enum",
        choices: [
          { label: "Acme", value: "acme", analytics_id: "c-acme" },
          { label: "Globex", value: "globex", analytics_id: "c-globex" },
        ],
      },
      { type: "TwoButtonYesNo", question_id: "q-home", internal_field: "homeowner" },
      { type: "DateQuestion", question_id: "q-dob", internal_field: "dob" },
      { type: "ZIPInputQuestion", question_id: "q-zip", internal_field: "zip" },
      { type: "EmailInputQuestion", question_id: "q-email", internal_field: "email" },
      { type: "PhoneInputQuestion", question_id: "q-phone", internal_field: "phone" },
      { type: "RangeQuestion", question_id: "q-age", internal_field: "age", props: { min: 18, max: 99 } },
    ],
  };
  h.sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run("lgs_sampletest01", "Life Basics", "quote_funnel", "life", "About you", JSON.stringify(content));
  const section = h.sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get("lgs_sampletest01") as {
    id: number;
  };
  h.sdb
    .prepare("INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected) VALUES (?, ?, 1)")
    .run(section.id, h.offerId);
}

interface SampleField {
  internal_field: string;
  label: string;
  kind: string;
  options?: Array<{ value: unknown; label: string }>;
  sample: unknown;
  required: boolean;
  source_path: string;
}
interface SampleResponse {
  answers: Record<string, unknown>;
  fields: SampleField[];
}

async function generate(h: Harness): Promise<{ status: number; body: SampleResponse }> {
  const res = await admin.request(
    `${API}/offers/${h.offerId}/payload/sample-answers`,
    { method: "POST" },
    h.env,
  );
  return { status: res.status, body: (await res.json()) as SampleResponse };
}

function isoDateUtcNow(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoDateUtcMinus30y(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear() - 30, d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

// --- B4 generation ------------------------------------------------------------

describeDb("POST /offers/:id/payload/sample-answers — B4 generation (06 §6.12.1)", () => {
  it("emits the PINNED {answers, fields[]} shape with every §6.12.1 kind generated right", async () => {
    const h = await harnessWithOffer();
    linkSectionWithComponents(h);
    await activateSchema(h, sampleFixtureSchema());

    const before = { today: isoDateUtcNow(), dob: isoDateUtcMinus30y() };
    const { status, body } = await generate(h);
    const after = { today: isoDateUtcNow(), dob: isoDateUtcMinus30y() };
    expect(status).toBe(200);

    // PINNED byte-shape: exactly {answers, fields}; rows carry exactly the
    // pinned keys (options only on enum rows).
    expect(Object.keys(body).sort()).toEqual(["answers", "fields"]);
    for (const field of body.fields) {
      const keys = Object.keys(field).sort();
      const expected = field.options !== undefined
        ? ["internal_field", "kind", "label", "options", "required", "sample", "source_path"]
        : ["internal_field", "kind", "label", "required", "sample", "source_path"];
      expect(keys, field.internal_field).toEqual(expected);
    }

    const byField = new Map(body.fields.map((f) => [f.internal_field, f]));

    // enum from the SECTION's authored choices (labels included), first value preselected
    const carrier = byField.get("carrier");
    expect(carrier?.kind).toBe("enum");
    expect(carrier?.options).toEqual([
      { value: "acme", label: "Acme" },
      { value: "globex", label: "Globex" },
    ]);
    expect(carrier?.sample).toBe("acme");
    expect(carrier?.label).toBe("Current carrier"); // node label wins
    expect(carrier?.source_path).toBe("applicant.carrier");

    // enum from valid_values when no Section choices exist
    const tier = byField.get("tier");
    expect(tier?.kind).toBe("enum");
    expect(tier?.options).toEqual([
      { value: "basic", label: "basic" },
      { value: "premium", label: "premium" },
    ]);
    expect(tier?.sample).toBe("basic");

    // boolean → true
    expect(byField.get("homeowner")?.kind).toBe("boolean");
    expect(byField.get("homeowner")?.sample).toBe(true);

    // DOB-like date → today−30y; other date-like → today
    const dob = byField.get("dob");
    expect(dob?.kind).toBe("date");
    expect([before.dob, after.dob]).toContain(dob?.sample);
    const startDate = byField.get("policy_start_date");
    expect(startDate?.kind).toBe("date");
    expect([before.today, after.today]).toContain(startDate?.sample);

    // ZIP / address presets
    expect(byField.get("zip")?.kind).toBe("zip");
    expect(byField.get("zip")?.sample).toBe("90210");
    expect(byField.get("street_address")?.kind).toBe("address");
    expect(byField.get("street_address")?.sample).toBe("123 Main St");

    // number → the component's props.min
    expect(byField.get("age")?.kind).toBe("number");
    expect(byField.get("age")?.sample).toBe(18);

    // text family: email/phone-shaped placeholders, generic otherwise
    expect(byField.get("email")?.kind).toBe("text");
    expect(byField.get("email")?.sample).toBe("sample@example.com");
    expect(byField.get("phone")?.kind).toBe("text");
    expect(byField.get("phone")?.sample).toBe("5551234567");
    expect(byField.get("notes")?.kind).toBe("text");
    expect(byField.get("notes")?.sample).toBe("Sample text");

    // required flags: from the node; OR'd across duplicate internal_fields
    expect(byField.get("email")?.required).toBe(true);
    expect(byField.get("notes")?.required).toBe(false);
    const shared = body.fields.filter((f) => f.internal_field === "shared_field");
    expect(shared).toHaveLength(1); // ONE form row per internal_field
    expect(shared[0]?.required).toBe(true); // second node's required=true ORs in
    expect(shared[0]?.source_path).toBe("shared.a"); // first node provides metadata

    // NON-answer sources never become form fields
    expect(byField.has("plan")).toBe(false);
    expect(body.fields.every((f) => f.source_path !== "plan" && f.source_path !== "meta.offer")).toBe(true);

    // answers mirror fields[].sample exactly, key-for-key
    expect(Object.keys(body.answers).sort()).toEqual(
      body.fields.map((f) => f.internal_field).sort(),
    );
    for (const field of body.fields) {
      expect(body.answers[field.internal_field]).toEqual(field.sample);
    }

    // every REQUIRED answer-source field is present (§6.12.1 minimum bar)
    for (const required of ["email", "zip", "dob", "shared_field"]) {
      expect(body.answers).toHaveProperty(required);
    }
  });

  it("generates without any linked Section (schema-only heuristics)", async () => {
    const h = await harnessWithOffer();
    await activateSchema(h, sampleFixtureSchema());
    const { status, body } = await generate(h);
    expect(status).toBe(200);
    const byField = new Map(body.fields.map((f) => [f.internal_field, f]));
    // carrier still enums off its value_map INTERNAL KEYS
    expect(byField.get("carrier")?.options).toEqual([
      { value: "acme", label: "acme" },
      { value: "globex", label: "globex" },
    ]);
    // dob still dates off the field NAME + formatDate transform
    expect(byField.get("dob")?.kind).toBe("date");
    // age has no component props.min → deterministic 30
    expect(byField.get("age")?.sample).toBe(30);
  });

  it("404s on an unknown offer and on an offer with no active schema", async () => {
    const h = await harnessWithOffer(); // offer exists but has NO schema
    const missing = await admin.request(
      `${API}/offers/999999/payload/sample-answers`,
      { method: "POST" },
      h.env,
    );
    expect(missing.status).toBe(404);

    const noSchema = await generate(h);
    expect(noSchema.status).toBe(404);
    expect((noSchema.body as unknown as { error: string }).error).toBe(
      "offer has no active payload schema",
    );
  });

  it("a BLOCKING-invalid active schema is a typed 400 {error, schema_errors} — never a 500", async () => {
    const h = await harnessWithOffer();
    // hand-inserted legacy row bypassing the save gate
    h.sdb
      .prepare(
        "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, source) VALUES ('lgp_samplebad01', ?, 1, ?, 'manual')",
      )
      .run(h.offerId, "{ not json");
    const row = h.sdb
      .prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = 'lgp_samplebad01'")
      .get() as { id: number };
    h.sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(row.id, h.offerId);

    const res = await admin.request(
      `${API}/offers/${h.offerId}/payload/sample-answers`,
      { method: "POST" },
      h.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; schema_errors: Array<{ code: string }> };
    expect(body.error).toBe("schema_validation_errors");
    expect(body.schema_errors[0]?.code).toBe("schema_not_object");
  });
});

// --- B4 draft persistence -------------------------------------------------------

describeDb("PUT + POST /offers/:id/payload/sample-answers — per-Offer KV draft", () => {
  it("PUT persists {answers} under lg-testdraft:<lgo_> and POST merges the draft over generated", async () => {
    const h = await harnessWithOffer();
    linkSectionWithComponents(h);
    await activateSchema(h, sampleFixtureSchema());

    const putRes = await admin.request(
      `${API}/offers/${h.offerId}/payload/sample-answers`,
      jsonInit("PUT", {
        answers: { email: "operator@corp.com", zip: "10001", ghost_field: "stale" },
      }),
      h.env,
    );
    expect(putRes.status).toBe(200);
    expect((await putRes.json()) as Record<string, unknown>).toEqual({
      answers: { email: "operator@corp.com", zip: "10001", ghost_field: "stale" },
    });

    // the draft landed under the documented KV key
    const stored = h.store.get(`${TEST_DRAFT_KV_PREFIX}${h.offerPublicId}`);
    expect(stored).toBeTruthy();
    expect(JSON.parse(stored ?? "{}")).toEqual({
      answers: { email: "operator@corp.com", zip: "10001", ghost_field: "stale" },
    });

    // GET-by-POST: draft values win per KNOWN field; unknown draft keys drop
    const { body } = await generate(h);
    expect(body.answers["email"]).toBe("operator@corp.com");
    expect(body.answers["zip"]).toBe("10001");
    expect(body.answers).not.toHaveProperty("ghost_field");
    expect(body.answers["phone"]).toBe("5551234567"); // untouched fields stay generated
    const byField = new Map(body.fields.map((f) => [f.internal_field, f]));
    expect(byField.get("email")?.sample).toBe("operator@corp.com"); // sample mirrors the merge
    expect(byField.get("zip")?.sample).toBe("10001");
  });

  it("a corrupt persisted draft falls through to pure generation (never a 500)", async () => {
    const h = await harnessWithOffer();
    await activateSchema(h, sampleFixtureSchema());
    h.store.set(`${TEST_DRAFT_KV_PREFIX}${h.offerPublicId}`, "{corrupt!!");
    const { status, body } = await generate(h);
    expect(status).toBe(200);
    expect(body.answers["zip"]).toBe("90210");
  });

  it("PUT validates its body: non-object answers / invalid JSON → 400; no schema → 404", async () => {
    const h = await harnessWithOffer();
    await activateSchema(h, sampleFixtureSchema());

    const badAnswers = await admin.request(
      `${API}/offers/${h.offerId}/payload/sample-answers`,
      jsonInit("PUT", { answers: ["not", "a", "record"] }),
      h.env,
    );
    expect(badAnswers.status).toBe(400);

    const badJson = await admin.request(
      `${API}/offers/${h.offerId}/payload/sample-answers`,
      { method: "PUT", headers: { "content-type": "application/json" }, body: "{{{" },
      h.env,
    );
    expect(badJson.status).toBe(400);

    const bare = await createDynamicOffer(h.env); // no active schema
    const noSchema = await admin.request(
      `${API}/offers/${bare.id}/payload/sample-answers`,
      jsonInit("PUT", { answers: {} }),
      h.env,
    );
    expect(noSchema.status).toBe(404);
  });

  // MINOR-4 (adversarial): the draft is operator-editable + KV-persisted — cap
  // its serialized size (typed 400) and set a TTL so abandoned drafts expire.
  it("MINOR-4: oversized draft → typed 400; a normal draft persists WITH a TTL", async () => {
    const h = await harnessWithOffer();
    await activateSchema(h, sampleFixtureSchema());

    // > 64 KB serialized → typed 400, not persisted.
    const huge = { blob: "x".repeat(70_000) };
    const over = await admin.request(
      `${API}/offers/${h.offerId}/payload/sample-answers`,
      jsonInit("PUT", { answers: huge }),
      h.env,
    );
    expect(over.status).toBe(400);
    expect(h.store.get(`${TEST_DRAFT_KV_PREFIX}${h.offerPublicId}`)).toBeUndefined();

    // a normal draft persists AND carries a positive TTL (abandoned drafts expire).
    const ok = await admin.request(
      `${API}/offers/${h.offerId}/payload/sample-answers`,
      jsonInit("PUT", { answers: { zip: "90210" } }),
      h.env,
    );
    expect(ok.status).toBe(200);
    const opts = h.putOpts.get(`${TEST_DRAFT_KV_PREFIX}${h.offerPublicId}`);
    expect(opts?.expirationTtl).toBeGreaterThan(0);
  });
});

// --- B7 pre-SAVE gate (05 §5.5) ---------------------------------------------------

describeDb("POST /offers/:id/payload-schemas — B7 blocking vs warning save matrix", () => {
  const schemaOf = (children: unknown[]): Record<string, unknown> => ({
    version: 1,
    root: { type: "object", children },
  });

  it("BLOCKING-class errors reject the save with the standard 400 shape (schema_errors included)", async () => {
    const h = await harnessWithOffer();
    const res = await admin.request(
      `${API}/offers/${h.offerId}/payload-schemas`,
      jsonInit("POST", {
        schema_json: schemaOf([
          { path: "dup", name: "dup", type: "string", source: "static", value: "a" },
          { path: "dup", name: "dup", type: "string", source: "static", value: "b" },
        ]),
      }),
      h.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      fields: Record<string, string>;
      schema_errors: Array<{ code: string; path?: string; message: string }>;
    };
    expect(body.error).toBe("Validation failed");
    expect(body.fields["schema_json"]).toBeTruthy();
    expect(body.schema_errors.some((e) => e.code === "path_duplicate")).toBe(true);
    // nothing persisted, active pointer untouched
    const count = h.sdb
      .prepare("SELECT COUNT(*) AS n FROM leadgen_offer_payload_schemas WHERE offer_id = ?")
      .get(h.offerId) as { n: number };
    expect(count.n).toBe(0);
  });

  it("WARNING-class-only findings SAVE with warnings[] (enum_value_violation + choice_display_invalid)", async () => {
    const h = await harnessWithOffer();
    const res = await admin.request(
      `${API}/offers/${h.offerId}/payload-schemas`,
      jsonInit("POST", {
        schema_json: schemaOf([
          {
            path: "tier", name: "tier", type: "enum", source: "answer", internal_field: "tier",
            valid_values: ["basic", "premium"],
            default: "zzz", // enum_value_violation (warning)
            choiceDisplay: { mainValues: ["ghost"] }, // choice_display_invalid (warning)
          },
        ]),
      }),
      h.env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: number;
      version: number;
      warnings: Array<{ code: string; path?: string; message: string }>;
    };
    expect(body.warnings.map((w) => w.code).sort()).toEqual([
      "choice_display_invalid",
      "enum_value_violation",
    ]);
    // the version PERSISTED and became active
    const offer = h.sdb
      .prepare("SELECT active_payload_schema_id FROM leadgen_offers WHERE id = ?")
      .get(h.offerId) as { active_payload_schema_id: number | null };
    expect(offer.active_payload_schema_id).toBe(body.id);
  });

  it("a clean save carries warnings: [] (stable additive shape)", async () => {
    const h = await harnessWithOffer();
    const res = await admin.request(
      `${API}/offers/${h.offerId}/payload-schemas`,
      jsonInit("POST", {
        schema_json: schemaOf([{ path: "plan", name: "plan", type: "string", source: "static", value: "gold" }]),
      }),
      h.env,
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as { warnings: unknown[] }).warnings).toEqual([]);
  });

  it("a valid choiceDisplay (§6.4) saves with zero warnings", async () => {
    const h = await harnessWithOffer();
    const res = await admin.request(
      `${API}/offers/${h.offerId}/payload-schemas`,
      jsonInit("POST", {
        schema_json: schemaOf([
          {
            path: "carrier", name: "carrier", type: "string", source: "answer", internal_field: "carrier",
            value_map: { acme: "ACM", globex: "GLX" },
            choiceDisplay: { mainValues: ["acme"], otherGroupEnabled: true, otherGroupLabel: "Other", searchableOther: true },
          },
        ]),
      }),
      h.env,
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as { warnings: unknown[] }).warnings).toEqual([]);
  });
});

// --- §6.14 byte-equivalent re-save regression ---------------------------------------

describeDb("§6.14 storage-format regression — load → re-save is byte-equivalent", () => {
  async function assertByteEquivalentResave(schema: Record<string, unknown>): Promise<void> {
    const h = await harnessWithOffer();
    await activateSchema(h, schema);
    const v1 = h.sdb
      .prepare("SELECT schema_json FROM leadgen_offer_payload_schemas WHERE offer_id = ? AND version = 1")
      .get(h.offerId) as { schema_json: string };

    // load (parse) the STORED text and re-save it untouched
    const reSaved = await admin.request(
      `${API}/offers/${h.offerId}/payload-schemas`,
      jsonInit("POST", { schema_json: JSON.parse(v1.schema_json) }),
      h.env,
    );
    expect(reSaved.status).toBe(201);
    const v2 = h.sdb
      .prepare("SELECT schema_json FROM leadgen_offer_payload_schemas WHERE offer_id = ? AND version = 2")
      .get(h.offerId) as { schema_json: string };

    // byte-equivalent modulo the allocated version counter
    expect(v2.schema_json.replace('"version":2', '"version":1')).toBe(v1.schema_json);
  }

  it("an existing schema WITHOUT choiceDisplay re-saves byte-equivalent", async () => {
    await assertByteEquivalentResave({
      version: 1,
      root: {
        type: "object",
        children: [
          {
            path: "data.home_own", name: "home_own", type: "boolean", required: true,
            source: "answer", internal_field: "homeowner", value_map: { true: true, false: false },
          },
          { path: "meta.click_id", name: "click_id", type: "string", source: "macro", macro: "click_id" },
          { path: "plan", name: "plan", type: "string", source: "static", value: "gold" },
        ],
      },
    });
  });

  it("a schema WITH choiceDisplay also round-trips byte-equivalent (additive metadata)", async () => {
    await assertByteEquivalentResave({
      version: 1,
      root: {
        type: "object",
        children: [
          {
            path: "carrier", name: "carrier", type: "string", source: "answer", internal_field: "carrier",
            value_map: { acme: "ACM", globex: "GLX" },
            choiceDisplay: { mainValues: ["acme"], otherGroupEnabled: true, otherGroupLabel: "Other", searchableOther: false },
          },
        ],
      },
    });
  });
});

// --- builder_context (12 Phase-2 additive offer-GET field) ---------------------------

describeDb("GET /offers/:id — additive builder_context projection", () => {
  it("carries the ACTIVE schema's parsed node list (per-node source) + the linked-field inventory", async () => {
    const h = await harnessWithOffer();
    linkSectionWithComponents(h);
    const schema = sampleFixtureSchema();
    const schemaId = await activateSchema(h, schema);

    const res = await admin.request(`${API}/offers/${h.offerId}`, { method: "GET" }, h.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      builder_context: {
        active_schema: { id: number; public_id: string; version: number; nodes: Array<Record<string, unknown>> } | null;
        linked_fields: Array<Record<string, unknown>>;
      };
    };
    const ctx = body.builder_context;

    // active schema: id/public_id/version + the node list AS STORED
    expect(ctx.active_schema?.id).toBe(schemaId);
    expect(ctx.active_schema?.version).toBe(1);
    const children = (schema["root"] as { children: Array<Record<string, unknown>> }).children;
    expect(ctx.active_schema?.nodes).toHaveLength(children.length);
    for (const node of ctx.active_schema?.nodes ?? []) {
      expect(typeof node["source"]).toBe("string"); // per-node source present
      expect(typeof node["path"]).toBe("string");
    }
    // spot-check a node passes through verbatim (choiceDisplay included)
    const carrierNode = ctx.active_schema?.nodes.find((n) => n["path"] === "applicant.carrier");
    expect(carrierNode).toEqual(children.find((n) => n["path"] === "applicant.carrier"));

    // linked-field inventory: EXACTLY the pinned 6 keys per row (F-1 added
    // choices — the Section choices feeding the §6.10 typed condition inputs)
    expect(ctx.linked_fields.length).toBeGreaterThan(0);
    for (const row of ctx.linked_fields) {
      expect(Object.keys(row).sort()).toEqual([
        "answer_type",
        "choice_count",
        "choices",
        "internal_field",
        "section_name",
        "section_public_id",
      ]);
      expect(row["section_public_id"]).toBe("lgs_sampletest01");
      expect(row["section_name"]).toBe("Life Basics");
    }
    const byField = new Map(ctx.linked_fields.map((r) => [r["internal_field"], r]));
    expect(byField.get("carrier")?.["answer_type"]).toBe("enum");
    expect(byField.get("carrier")?.["choice_count"]).toBe(2);
    expect(byField.get("carrier")?.["choices"]).toEqual([
      { label: "Acme", value: "acme" },
      { label: "Globex", value: "globex" },
    ]);
    expect(byField.get("homeowner")?.["choices"]).toEqual([]);
    expect(byField.get("homeowner")?.["answer_type"]).toBe("boolean"); // catalog produces fallback
    expect(byField.get("homeowner")?.["choice_count"]).toBe(0);
    expect(byField.get("age")?.["answer_type"]).toBe("number");
    expect(byField.get("zip")?.["answer_type"]).toBe("string");
  });

  it("an offer with no active schema and no linked Sections: active_schema null, linked_fields []", async () => {
    const h = await harnessWithOffer();
    const res = await admin.request(`${API}/offers/${h.offerId}`, { method: "GET" }, h.env);
    const body = (await res.json()) as {
      builder_context: { active_schema: unknown; linked_fields: unknown[] };
    };
    expect(body.builder_context.active_schema).toBeNull();
    expect(body.builder_context.linked_fields).toEqual([]);
  });
});
