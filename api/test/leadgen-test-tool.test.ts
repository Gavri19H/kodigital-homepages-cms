// LeadGen Phase 4 Stage B1 — the §11.6 Test tool (POST /offers/:id/test) over
// the REAL admin router + REAL migrations, with the OUTBOUND provider fetch
// MOCKED (vi.stubGlobal), plus the §30.3 retention prune task.
//
// Proves the full cycle: environment endpoint routing, payload built from the
// ACTIVE schema + sample answers, header/token resolution (real secret values
// SENT outbound, "[REDACTED]" in every returned/stored byte — §30.2),
// sample_response_json persistence, the redacted provider-request-log row
// (PII sha256-hashed, secrets masked — §30.3), the §11.6 response shape
// (payload/response/status/latency/masked headers/parse errors/carriers/
// response field paths), typed no-op notes for absent secrets, the
// LEADGEN_DEBUG_ENCRYPTION_KEY debug blob (AES-GCM into KV, expirationTtl
// 259200, debug_ref NULL when the secret is absent), the §11.1 dry_run
// (identical build/mask, ZERO side effects — no fetch/sample/log/blob), and
// failure modes (non-2xx / timeout / malformed response). Then
// pruneLeadgenRetention: old-vs-new row selection per §30.3 windows +
// bounded batching + isolation.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import {
  DEBUG_BLOB_TTL_SECONDS,
  DEBUG_ENCRYPTION_SECRET_NAME,
} from "../src/admin/leadgen/payload-builder-handlers";
import { pruneLeadgenRetention } from "../src/leadgen/retention";
import { sha256Hex } from "../src/public/leadgen/auction/parse";

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
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

interface RecordedPut {
  key: string;
  value: string;
  opts?: { expirationTtl?: number };
}

function recordingKv(): { kv: KVNamespace; puts: RecordedPut[] } {
  const store = new Map<string, string>();
  const puts: RecordedPut[] = [];
  const kv = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      store.set(key, value);
      puts.push({ key, value, ...(opts !== undefined ? { opts } : {}) });
    },
    async delete(key: string) {
      store.delete(key);
    },
  } as unknown as KVNamespace;
  return { kv, puts };
}

const PROVIDER_TOKEN = "tok-SECRET-123";
const HEADER_SECRET = "hdr-SECRET-456";

function buildEnv(db: D1Database, kv: KVNamespace, extra: Record<string, string> = {}): Env {
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
    LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS:
      "OFFER_TOKEN_TEST_PROVIDER,OFFER_TOKEN_TEST_HEADER,OFFER_TOKEN_MISSING,OFFER_TOKEN_MISSING_HEADER",
    OFFER_TOKEN_TEST_PROVIDER: PROVIDER_TOKEN,
    OFFER_TOKEN_TEST_HEADER: HEADER_SECRET,
    ...extra,
  } as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// The §11.5-shaped test schema: answer-sourced PII fields + a macro field +
// a static field (and, when asked, the token node for payload placement).
function testSchema(withTokenNode: boolean): Record<string, unknown> {
  const children: Array<Record<string, unknown>> = [
    // OWNER RULING 2026-08-12 — an answer field DECLARES its source and nothing
    // more; which question fills it is the Section mapping row seeded below.
    { path: "contact.email", name: "email", type: "string", required: true, source: "answer" },
    { path: "contact.zip", name: "zip", type: "string", source: "answer" },
    { path: "meta.offer", name: "offer", type: "string", source: "macro", macro: "offer_id" },
    { path: "plan", name: "plan", type: "string", source: "static", value: "gold" },
  ];
  if (withTokenNode) {
    children.push({ path: "auth.api_token", name: "api_token", type: "string", source: "token" });
  }
  return { version: 1, root: { type: "object", children } };
}

// A Section that asks the schema's answer fields, with one
// leadgen_section_answer_maps row per field — the ONLY thing that binds a
// question to a payload field (owner ruling 2026-08-12).
function seedAnswerMaps(
  sdb: SqliteDb,
  offerId: number,
  schemaId: number,
  fields: ReadonlyArray<{ internal_field: string; path: string; type: string }>,
): void {
  sdb
    .prepare(
      "INSERT OR IGNORE INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, ?, 'quote_funnel', 'life', 'H', '{\"components\":[]}')",
    )
    .run("lgs_testtool01", "Test Tool Section");
  const sectionId = (
    sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get("lgs_testtool01") as {
      id: number;
    }
  ).id;
  const schemaPublicId = (
    sdb.prepare("SELECT public_id FROM leadgen_offer_payload_schemas WHERE id = ?").get(schemaId) as {
      public_id: string;
    }
  ).public_id;
  fields.forEach((field, index) => {
    sdb
      .prepare(
        `INSERT INTO leadgen_section_answer_maps
           (public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id,
            payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type,
            mapping_status, validation_status)
         VALUES (?, ?, ?, ?, ?, 'string', ?, ?, ?, ?, ?, 'complete', 'ok')`,
      )
      .run(
        `lgm_${field.internal_field}${index}`,
        sectionId,
        `q_${field.internal_field}`,
        field.internal_field,
        field.internal_field,
        offerId,
        schemaId,
        schemaPublicId,
        field.path,
        field.type,
      );
  });
}

const CARRIER_PARSE = {
  carriers_path: "carriers",
  fields: { carrier_name: "name", bid: "bid", click_url: "url" },
};

const STAGING_URL = "https://staging.provider.example.com/quotes";
const PRODUCTION_URL = "https://api.provider.example.com/quotes";

interface Harness {
  sdb: SqliteDb;
  env: Env;
  puts: RecordedPut[];
  offerId: number;
  offerPublicId: string;
  schemaId: number;
}

// Build a fully-configured DYNAMIC offer through the REAL API: endpoints,
// header set (static/macro/secret_ref), token config, active payload schema.
async function setupOffer(
  options: {
    withTokenNode?: boolean;
    tokenPlacement?: "header" | "query" | "payload";
    envExtra?: Record<string, string>;
    skipEndpointStaging?: boolean;
  } = {},
): Promise<Harness> {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createLeadgenDb(ctor);
  const { kv, puts } = recordingKv();
  const env = buildEnv(d1FromSqlite(sdb), kv, options.envExtra ?? {});

  const createRes = await admin.request(
    `${API}/offers`,
    jsonInit("POST", {
      offer_name: "Dyn Offer",
      activity: "quote_funnel",
      vertical: "life",
      conversion_tracking_method: "s2s_postback",
      offer_type: "cpc",
      placements: ["pl-dyn-1"],
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
      endpoint_production: PRODUCTION_URL,
      ...(options.skipEndpointStaging === true ? {} : { endpoint_staging: STAGING_URL }),
      request_method: "POST",
      api_token_secret_ref: "OFFER_TOKEN_TEST_PROVIDER",
      api_token_placement: options.tokenPlacement ?? "header",
      api_token_param_name: options.tokenPlacement === "query" ? "token" : "X-Api-Token",
      headers: [
        { header_name: "X-Static", value_kind: "static", value_text: "fixed-value" },
        { header_name: "X-Macro", value_kind: "macro", value_text: "{offer_id}" },
        { header_name: "X-Secret", value_kind: "secret_ref", value_text: "OFFER_TOKEN_TEST_HEADER" },
      ],
    }),
    env,
  );
  expect(patchRes.status).toBe(200);

  const schemaRes = await admin.request(
    `${API}/offers/${offer.id}/payload-schemas`,
    jsonInit("POST", {
      schema_json: testSchema(options.withTokenNode === true),
      carrier_parse_json: CARRIER_PARSE,
    }),
    env,
  );
  expect(schemaRes.status).toBe(201);
  const schema = (await schemaRes.json()) as { id: number };

  // The ONE binding surface (owner ruling 2026-08-12): a Section whose questions
  // fill contact.email / contact.zip. The Test tool reads these rows through the
  // same loader the auction uses, so what it builds is what production sends.
  seedAnswerMaps(sdb, offer.id, schema.id, [
    { internal_field: "email", path: "contact.email", type: "string" },
    { internal_field: "zip", path: "contact.zip", type: "string" },
  ]);

  return { sdb, env, puts, offerId: offer.id, offerPublicId: offer.public_id, schemaId: schema.id };
}

interface CapturedFetch {
  url: string;
  init: RequestInit;
}

function stubFetch(
  handler: (url: string, init: RequestInit) => Promise<Response> | Response,
): CapturedFetch[] {
  const calls: CapturedFetch[] = [];
  vi.stubGlobal("fetch", async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const captured = { url: String(url), init: init ?? {} };
    calls.push(captured);
    return handler(captured.url, captured.init);
  });
  return calls;
}

const PROVIDER_BODY = {
  carriers: [{ name: "Acme Life", bid: 3.2, url: "https://p.example.com/click" }],
  session: "s-1",
};

const SAMPLE_ANSWERS = { email: " John@X.com ", zip: "90210" };

interface TestToolResponse {
  dry_run: boolean;
  environment: string;
  endpoint: string;
  method: string;
  request: { payload: Record<string, unknown>; headers: Record<string, string> };
  response: { status: number | null; latency_ms: number | null; body: unknown };
  // carriers is null ONLY on a §11.1 dry run (no response to parse).
  parse: { carriers: Array<Record<string, unknown>> | null; errors: Array<Record<string, unknown>> };
  response_field_paths: string[];
  notes: Array<{ scope: string; code: string; header_name?: string; secret_ref?: string }>;
  provider_error_reason: string | null;
  debug_ref: string | null;
}

async function runTest(h: Harness, body: unknown): Promise<{ status: number; body: TestToolResponse }> {
  const res = await admin.request(`${API}/offers/${h.offerId}/test`, jsonInit("POST", body), h.env);
  return { status: res.status, body: (await res.json()) as TestToolResponse };
}

function lastLogRow(sdb: SqliteDb): Record<string, unknown> | null {
  return (sdb.prepare("SELECT * FROM leadgen_provider_request_log ORDER BY id DESC LIMIT 1").get() ??
    null) as Record<string, unknown> | null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// --- the §11.6 success cycle ---------------------------------------------------

describeDb("POST /offers/:id/test — §11.6 success cycle (mocked outbound fetch)", () => {
  it("sends real secrets OUTBOUND, returns the §11.6 shape with every secret byte masked", async () => {
    const h = await setupOffer();
    const calls = stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));

    const { status, body } = await runTest(h, { environment: "staging", sample_answers: SAMPLE_ANSWERS });
    expect(status).toBe(200);

    // --- outbound request: REAL secret values, staging endpoint, signal wired
    expect(calls).toHaveLength(1);
    const sent = calls[0];
    expect(sent?.url).toBe(STAGING_URL);
    expect(sent?.init.method).toBe("POST");
    const sentHeaders = sent?.init.headers as Record<string, string>;
    expect(sentHeaders["X-Static"]).toBe("fixed-value");
    expect(sentHeaders["X-Macro"]).toBe(h.offerPublicId); // {offer_id} resolved
    expect(sentHeaders["X-Secret"]).toBe(HEADER_SECRET);
    expect(sentHeaders["X-Api-Token"]).toBe(PROVIDER_TOKEN);
    expect(sentHeaders["content-type"]).toBe("application/json");
    expect(sent?.init.signal).toBeInstanceOf(AbortSignal); // bounded-timeout wiring
    const sentPayload = JSON.parse(String(sent?.init.body)) as Record<string, unknown>;
    expect(sentPayload).toEqual({
      contact: { email: " John@X.com ", zip: "90210" },
      meta: { offer: h.offerPublicId },
      plan: "gold",
    });

    // --- §11.6 response: exact payload + masked headers + parse + chips
    expect(body.environment).toBe("staging");
    expect(body.endpoint).toBe(STAGING_URL);
    expect(body.method).toBe("POST");
    expect(body.request.payload).toEqual(sentPayload); // exact payload sent
    expect(body.request.headers["X-Static"]).toBe("fixed-value");
    expect(body.request.headers["X-Secret"]).toBe("[REDACTED]");
    expect(body.request.headers["X-Api-Token"]).toBe("[REDACTED]");
    expect(body.response.status).toBe(200);
    expect(typeof body.response.latency_ms).toBe("number");
    expect(body.response.body).toEqual(PROVIDER_BODY);
    expect(body.parse.errors).toEqual([]);
    expect(body.parse.carriers).toHaveLength(1);
    expect(body.parse.carriers?.[0]?.["carrier_key"]).toBe("acme-life");
    expect(body.parse.carriers?.[0]?.["carrier_name"]).toBe("Acme Life");
    expect(body.parse.carriers?.[0]?.["bid"]).toBe(3.2);
    expect(body.response_field_paths).toEqual([
      "carriers.0.name",
      "carriers.0.bid",
      "carriers.0.url",
      "session",
    ]);
    expect(body.notes).toEqual([]);
    expect(body.provider_error_reason).toBeNull();
    expect(body.debug_ref).toBeNull(); // no LEADGEN_DEBUG_ENCRYPTION_KEY

    // §30.2: the secret VALUES appear in NO response byte.
    const responseBytes = JSON.stringify(body);
    expect(responseBytes).not.toContain(PROVIDER_TOKEN);
    expect(responseBytes).not.toContain(HEADER_SECRET);
  });

  it("persists sample_response_json on the ACTIVE schema row (§11.6)", async () => {
    const h = await setupOffer();
    stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));
    await runTest(h, { environment: "staging", sample_answers: {} });
    const row = h.sdb
      .prepare("SELECT sample_response_json FROM leadgen_offer_payload_schemas WHERE id = ?")
      .get(h.schemaId) as { sample_response_json: string | null };
    expect(row.sample_response_json).toBe(JSON.stringify(PROVIDER_BODY));
  });

  it("writes ONE §30.3 log row: PII sha256-hashed, secrets [REDACTED], carriers parsed", async () => {
    const h = await setupOffer();
    stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));
    await runTest(h, { environment: "staging", sample_answers: SAMPLE_ANSWERS });

    const log = lastLogRow(h.sdb);
    expect(log).not.toBeNull();
    expect(log?.["offer_public_id"]).toBe(h.offerPublicId);
    expect(typeof log?.["placement_public_id"]).toBe("string"); // the default placement
    expect(log?.["environment"]).toBe("staging");
    expect(log?.["status_code"]).toBe(200);
    expect(typeof log?.["latency_ms"]).toBe("number");
    expect(log?.["carrier_parse_version"]).toBe(1);
    expect(log?.["provider_error_reason"]).toBeNull();
    expect(log?.["debug_ref"]).toBeNull();

    const headers = JSON.parse(String(log?.["request_headers_redacted_json"])) as Record<string, string>;
    expect(headers["X-Secret"]).toBe("[REDACTED]");
    expect(headers["X-Api-Token"]).toBe("[REDACTED]");
    expect(headers["X-Static"]).toBe("fixed-value");

    // §30.3 payload redaction: PII hashed lowercased+trimmed, rest verbatim
    const payload = JSON.parse(String(log?.["request_payload_redacted_json"])) as {
      contact: { email: string; zip: string };
      plan: string;
    };
    expect(payload.contact.email).toBe(`sha256:${sha256Hex("john@x.com")}`);
    expect(payload.contact.zip).toBe(`sha256:${sha256Hex("90210")}`);
    expect(payload.plan).toBe("gold");

    const carriers = JSON.parse(String(log?.["parsed_carriers_json"])) as Array<{ carrier_key: string }>;
    expect(carriers[0]?.carrier_key).toBe("acme-life");

    // §30.2: no secret byte lands in the log row either.
    const logBytes = JSON.stringify(log);
    expect(logBytes).not.toContain(PROVIDER_TOKEN);
    expect(logBytes).not.toContain(HEADER_SECRET);
  });

  it("routes environment=production to the production endpoint", async () => {
    const h = await setupOffer();
    const calls = stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));
    const { body } = await runTest(h, { environment: "production", sample_answers: {} });
    expect(calls[0]?.url).toBe(PRODUCTION_URL);
    expect(body.environment).toBe("production");
    expect(lastLogRow(h.sdb)?.["environment"]).toBe("production");
  });
});

// --- token placements ------------------------------------------------------------

describeDb("POST /offers/:id/test — token placements (§11.3–11.4)", () => {
  it("query placement: real token in the OUTBOUND url, [REDACTED] in the echoed endpoint", async () => {
    const h = await setupOffer({ tokenPlacement: "query" });
    const calls = stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));
    const { body } = await runTest(h, { environment: "staging", sample_answers: {} });

    expect(calls[0]?.url).toBe(`${STAGING_URL}?token=${encodeURIComponent(PROVIDER_TOKEN)}`);
    expect(body.endpoint).toBe(`${STAGING_URL}?token=[REDACTED]`);
    expect(JSON.stringify(body)).not.toContain(PROVIDER_TOKEN);
  });

  it("does not expose or persist secrets echoed by a rejected query-token fetch", async () => {
    const h = await setupOffer({ tokenPlacement: "query" });
    stubFetch((url, init) => {
      const headers = init.headers as Record<string, string>;
      const err = new Error(`provider rejected ${url}; header=${headers["X-Secret"]}`);
      err.name = `Poisoned-${PROVIDER_TOKEN}-${HEADER_SECRET}`;
      throw err;
    });

    const { status, body } = await runTest(h, {
      environment: "staging",
      sample_answers: SAMPLE_ANSWERS,
    });
    const log = lastLogRow(h.sdb);

    expect(status).toBe(200);
    expect(body.provider_error_reason).toBe("network_error");
    expect(log?.["error_text"]).toBe("provider_fetch_failed:UnknownError");
    expect(JSON.stringify(body)).not.toContain(PROVIDER_TOKEN);
    expect(JSON.stringify(body)).not.toContain(HEADER_SECRET);
    expect(JSON.stringify(log)).not.toContain(PROVIDER_TOKEN);
    expect(JSON.stringify(log)).not.toContain(HEADER_SECRET);
  });

  it("payload placement: token node carries the real value outbound, masked everywhere else", async () => {
    const h = await setupOffer({ withTokenNode: true, tokenPlacement: "payload" });
    const calls = stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));
    const { body } = await runTest(h, { environment: "staging", sample_answers: {} });

    const sentPayload = JSON.parse(String(calls[0]?.init.body)) as { auth: { api_token: string } };
    expect(sentPayload.auth.api_token).toBe(PROVIDER_TOKEN); // real value SENT

    const echoed = body.request.payload as { auth: { api_token: string } };
    expect(echoed.auth.api_token).toBe("[REDACTED]"); // masked in the response

    const log = lastLogRow(h.sdb);
    const loggedPayload = JSON.parse(String(log?.["request_payload_redacted_json"])) as {
      auth: { api_token: string };
    };
    expect(loggedPayload.auth.api_token).toBe("[REDACTED]"); // masked in the log
    expect(JSON.stringify(body)).not.toContain(PROVIDER_TOKEN);
    expect(JSON.stringify(log)).not.toContain(PROVIDER_TOKEN);
  });

  const echoedResponseCases = (["header", "query", "payload"] as const).flatMap((placement) =>
    ([
      { kind: "2xx JSON", status: 200, json: true },
      { kind: "non-2xx JSON", status: 500, json: true },
      { kind: "2xx text", status: 200, json: false },
      { kind: "non-2xx text", status: 500, json: false },
    ] as const).map((response) => ({ placement, ...response })),
  );

  it.each(echoedResponseCases)(
    "$placement token + secret header never enter admin/D1 projections for $kind",
    async ({ placement, status, json }) => {
      const providerSecret = "admin provider !'()~ /+%?= Secret";
      const headerSecret = "admin header !'()~ /+%?= Secret";
      const encodedProvider = encodeURIComponent(providerSecret);
      const encodedHeader = encodeURIComponent(headerSecret);
      const formProvider = new URLSearchParams({ token: providerSecret }).toString().slice("token=".length);
      const formHeader = new URLSearchParams({ token: headerSecret }).toString().slice("token=".length);
      const doubleFormProvider = new URLSearchParams({ token: formProvider }).toString().slice("token=".length);
      const doubleFormHeader = new URLSearchParams({ token: formHeader }).toString().slice("token=".length);
      const h = await setupOffer({
        tokenPlacement: placement,
        withTokenNode: placement === "payload",
        envExtra: {
          OFFER_TOKEN_TEST_PROVIDER: providerSecret,
          OFFER_TOKEN_TEST_HEADER: headerSecret,
        },
      });
      stubFetch(() => {
        const echoed = {
          [`key-${providerSecret}`]: `embedded-${providerSecret}`,
          encoded_provider: encodedProvider,
          encoded_header: encodedHeader,
          form_provider: formProvider,
          form_header: formHeader,
          carriers: [{ name: `Carrier ${formProvider}`, bid: 3.2, url: `https://p.test/?h=${doubleFormHeader}` }],
        };
        return new Response(
          json
            ? JSON.stringify(echoed)
            : `raw=${providerSecret}; encoded=${encodedProvider}; form=${formProvider}; form2=${doubleFormProvider}; header=${headerSecret}; header_encoded=${encodedHeader}; header_form=${formHeader}; header_form2=${doubleFormHeader}`,
          { status },
        );
      });

      const { body } = await runTest(h, { environment: "staging", sample_answers: {} });
      const log = lastLogRow(h.sdb);
      const sample = h.sdb
        .prepare("SELECT sample_response_json FROM leadgen_offer_payload_schemas WHERE id = ?")
        .get(h.schemaId) as { sample_response_json: string | null };

      for (const safeProjection of [body, log, sample.sample_response_json]) {
        const bytes = JSON.stringify(safeProjection);
        expect(bytes).not.toContain(providerSecret);
        expect(bytes).not.toContain(headerSecret);
        expect(bytes).not.toContain(encodedProvider);
        expect(bytes).not.toContain(encodedHeader);
        expect(bytes).not.toContain(formProvider);
        expect(bytes).not.toContain(formHeader);
        expect(bytes).not.toContain(doubleFormProvider);
        expect(bytes).not.toContain(doubleFormHeader);
      }
      expect(JSON.stringify(body)).toContain("[REDACTED]");
      expect(String(log?.["parsed_carriers_json"])).not.toContain(providerSecret);
      if (status === 200 && json) {
        expect(sample.sample_response_json).toContain("[REDACTED]");
      } else {
        expect(sample.sample_response_json).toBeNull();
      }
    },
  );
});

// --- §30.2 absent secrets = typed no-ops --------------------------------------------

describeDb("POST /offers/:id/test — missing secret binding (§30.2 / §18.7)", () => {
  it("fails closed before fetch with typed notes", async () => {
    const h = await setupOffer();
    // The admin save gate requires the binding to exist. Save while present,
    // then simulate deployment drift by removing it before the runtime lookup.
    const mutableEnv = h.env as unknown as Record<string, unknown>;
    mutableEnv["OFFER_TOKEN_MISSING"] = "temporary";
    mutableEnv["OFFER_TOKEN_MISSING_HEADER"] = "temporary";
    const patch = await admin.request(
      `${API}/offers/${h.offerId}`,
      jsonInit("PATCH", {
        api_token_secret_ref: "OFFER_TOKEN_MISSING",
        headers: [{ header_name: "X-Secret", value_kind: "secret_ref", value_text: "OFFER_TOKEN_MISSING_HEADER" }],
      }),
      h.env,
    );
    expect(patch.status).toBe(200);
    delete mutableEnv["OFFER_TOKEN_MISSING"];
    delete mutableEnv["OFFER_TOKEN_MISSING_HEADER"];
    const calls = stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));
    const { status, body } = await runTest(h, { environment: "staging", sample_answers: {} });

    expect(status).toBe(422);
    expect(calls).toHaveLength(0);
    expect(body.provider_error_reason).toBe("secret_reference_invalid");
    expect(body.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "token", code: "secret_absent", secret_ref: "OFFER_TOKEN_MISSING" }),
        expect.objectContaining({ scope: "header", code: "secret_absent", header_name: "X-Secret" }),
      ]),
    );
  });

  it.each([
    {
      label: "valid but forbidden in client mode",
      secretRef: "OFFER_TOKEN_TEST_HEADER",
      code: "secret_mode_invalid",
    },
    {
      label: "missing binding",
      secretRef: "OFFER_TOKEN_MISSING_HEADER",
      code: "secret_absent",
    },
    {
      label: "disallowed",
      secretRef: "OFFER_TOKEN_NOT_ALLOWED",
      code: "secret_not_allowed",
    },
    {
      label: "infrastructure",
      secretRef: "CH_PASSWORD",
      code: "secret_infrastructure_reference",
    },
  ])("client-mode row with $label secret header fails before admin Test fetch/write", async ({ secretRef, code }) => {
    const h = await setupOffer();
    const mutableEnv = h.env as unknown as Record<string, unknown>;
    if (secretRef === "CH_PASSWORD") {
      mutableEnv["LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS"] = "CH_PASSWORD";
      mutableEnv["CH_PASSWORD"] = "must-never-be-sent";
    }
    h.sdb.prepare(
      "UPDATE leadgen_offers SET request_execution_mode = 'client', api_token_secret_ref = NULL WHERE id = ?",
    ).run(h.offerId);
    h.sdb.prepare(
      "UPDATE leadgen_offer_headers SET value_text = ? WHERE offer_id = ? AND value_kind = 'secret_ref'",
    ).run(secretRef, h.offerId);
    const calls = stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));

    const { status, body } = await runTest(h, { environment: "staging", sample_answers: {} });

    expect(status).toBe(422);
    expect(calls).toHaveLength(0);
    expect(body.provider_error_reason).toBe("secret_reference_invalid");
    expect(body.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ scope: "header", code, header_name: "X-Secret", secret_ref: secretRef }),
      ]),
    );
    const persisted = h.sdb
      .prepare("SELECT COUNT(*) AS count FROM leadgen_provider_request_log")
      .get() as { count: number };
    expect(persisted.count).toBe(0);
  });

  it("client-mode row with a valid token ref fails before admin Test fetch/write", async () => {
    const h = await setupOffer();
    h.sdb.prepare("DELETE FROM leadgen_offer_headers WHERE offer_id = ? AND value_kind = 'secret_ref'").run(h.offerId);
    h.sdb.prepare("UPDATE leadgen_offers SET request_execution_mode = 'client' WHERE id = ?").run(h.offerId);
    const calls = stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));

    const { status, body } = await runTest(h, { environment: "staging", sample_answers: {} });

    expect(status).toBe(422);
    expect(calls).toHaveLength(0);
    expect(body.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope: "token",
          code: "secret_mode_invalid",
          secret_ref: "OFFER_TOKEN_TEST_PROVIDER",
        }),
      ]),
    );
    const persisted = h.sdb
      .prepare("SELECT COUNT(*) AS count FROM leadgen_provider_request_log")
      .get() as { count: number };
    expect(persisted.count).toBe(0);
  });
});

// --- §11.1 dry run ---------------------------------------------------------------------

describeDb("POST /offers/:id/test — §11.1 dry_run (build + mask, no side effects)", () => {
  it("builds + masks exactly like the live path but never fetches, persists, logs or blobs", async () => {
    // The debug-encryption key is PRESENT on purpose: even then a dry run
    // writes NO blob — it must leave zero trace beyond its response.
    const h = await setupOffer({
      withTokenNode: true,
      tokenPlacement: "payload",
      envExtra: { [DEBUG_ENCRYPTION_SECRET_NAME]: "dry-run-key" },
    });
    const calls = stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));

    const { status, body } = await runTest(h, {
      environment: "staging",
      sample_answers: SAMPLE_ANSWERS,
      dry_run: true,
    });
    expect(status).toBe(200);
    expect(body.dry_run).toBe(true);

    // NO outbound fetch was invoked
    expect(calls).toHaveLength(0);

    // the build/resolve/mask surface is IDENTICAL to the live §11.6 path
    expect(body.environment).toBe("staging");
    expect(body.endpoint).toBe(STAGING_URL);
    expect(body.method).toBe("POST");
    expect(body.request.payload).toEqual({
      contact: { email: " John@X.com ", zip: "90210" },
      meta: { offer: h.offerPublicId },
      plan: "gold",
      auth: { api_token: "[REDACTED]" }, // token node masked at its schema path (§30.2)
    });
    expect(body.request.headers["X-Static"]).toBe("fixed-value");
    expect(body.request.headers["X-Macro"]).toBe(h.offerPublicId);
    expect(body.request.headers["X-Secret"]).toBe("[REDACTED]");
    expect(body.request.headers["content-type"]).toBe("application/json");
    expect(body.notes).toEqual([]);

    // the dry-run contract: null response/status/latency/carriers
    expect(body.response).toEqual({ status: null, latency_ms: null, body: null });
    expect(body.parse).toEqual({ carriers: null, errors: [] });
    expect(body.response_field_paths).toEqual([]);
    expect(body.provider_error_reason).toBeNull();
    expect(body.debug_ref).toBeNull();

    // NO log row, NO sample persisted, NO debug blob
    expect(lastLogRow(h.sdb)).toBeNull();
    const row = h.sdb
      .prepare("SELECT sample_response_json FROM leadgen_offer_payload_schemas WHERE id = ?")
      .get(h.schemaId) as { sample_response_json: string | null };
    expect(row.sample_response_json).toBeNull();
    expect(h.puts).toHaveLength(0);

    // §30.2 holds on the dry-run bytes too
    const responseBytes = JSON.stringify(body);
    expect(responseBytes).not.toContain(PROVIDER_TOKEN);
    expect(responseBytes).not.toContain(HEADER_SECRET);
  });

  it("masks a query-placed token in the echoed endpoint on a dry run", async () => {
    const h = await setupOffer({ tokenPlacement: "query" });
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const { body } = await runTest(h, { environment: "staging", sample_answers: {}, dry_run: true });
    expect(calls).toHaveLength(0);
    expect(body.endpoint).toBe(`${STAGING_URL}?token=[REDACTED]`);
    expect(JSON.stringify(body)).not.toContain(PROVIDER_TOKEN);
  });

  it("keeps the live-path validations: a missing environment endpoint is a typed 400, still no fetch", async () => {
    const h = await setupOffer({ skipEndpointStaging: true });
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const res = await admin.request(
      `${API}/offers/${h.offerId}/test`,
      jsonInit("POST", { environment: "staging", sample_answers: {}, dry_run: true }),
      h.env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields["environment"]).toContain(
      "no staging endpoint",
    );
    expect(calls).toHaveLength(0);
    expect(lastLogRow(h.sdb)).toBeNull();
  });

  it("rejects a non-boolean dry_run; the live path reports dry_run:false", async () => {
    const h = await setupOffer();
    stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));
    const bad = await admin.request(
      `${API}/offers/${h.offerId}/test`,
      jsonInit("POST", { environment: "staging", dry_run: "yes" }),
      h.env,
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { fields: Record<string, string> }).fields["dry_run"]).toBeTruthy();

    const { body } = await runTest(h, { environment: "staging", sample_answers: {} });
    expect(body.dry_run).toBe(false);
  });
});

// --- failure modes -------------------------------------------------------------------

describeDb("POST /offers/:id/test — failure modes", () => {
  it("400s (typed) when the CHOSEN environment has no endpoint — and never fetches", async () => {
    const h = await setupOffer({ skipEndpointStaging: true });
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const res = await admin.request(
      `${API}/offers/${h.offerId}/test`,
      jsonInit("POST", { environment: "staging", sample_answers: {} }),
      h.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(body.fields["environment"]).toContain("no staging endpoint");
    expect(calls).toHaveLength(0);
  });

  it("records non-2xx as provider_error_reason=http_<status> and PROTECTS the stored sample", async () => {
    const h = await setupOffer();
    stubFetch(() => new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    const { status, body } = await runTest(h, { environment: "staging", sample_answers: {} });
    expect(status).toBe(200); // the TEST endpoint reports; it does not fail
    expect(body.response.status).toBe(500);
    expect(body.provider_error_reason).toBe("http_500");
    expect(body.response.body).toEqual({ error: "boom" });

    // an error body never becomes THE sample
    const row = h.sdb
      .prepare("SELECT sample_response_json FROM leadgen_offer_payload_schemas WHERE id = ?")
      .get(h.schemaId) as { sample_response_json: string | null };
    expect(row.sample_response_json).toBeNull();
    expect(lastLogRow(h.sdb)?.["provider_error_reason"]).toBe("http_500");
  });

  it("classifies an aborted fetch as timeout (status null) with the log row still written", async () => {
    const h = await setupOffer();
    stubFetch(() => {
      const err = new Error("The operation was aborted");
      err.name = "AbortError";
      throw err;
    });
    const { status, body } = await runTest(h, { environment: "staging", sample_answers: {} });
    expect(status).toBe(200);
    expect(body.response.status).toBeNull();
    expect(body.provider_error_reason).toBe("timeout");
    expect(body.parse.carriers).toEqual([]);
    const log = lastLogRow(h.sdb);
    expect(log?.["status_code"]).toBeNull();
    expect(log?.["provider_error_reason"]).toBe("timeout");
    expect(typeof log?.["error_text"]).toBe("string");
  });

  it("classifies a non-JSON 200 body as malformed_response with typed parse errors", async () => {
    const h = await setupOffer();
    stubFetch(() => new Response("<html>oops</html>", { status: 200 }));
    const { body } = await runTest(h, { environment: "staging", sample_answers: {} });
    expect(body.provider_error_reason).toBe("malformed_response");
    expect(body.response.body).toBe("<html>oops</html>"); // raw text echoed
    expect(body.parse.errors.some((e) => e["code"] === "invalid_json")).toBe(true);
    expect(body.response_field_paths).toEqual([]);
    const log = lastLogRow(h.sdb);
    expect(log?.["response_redacted_json"]).toBeNull(); // nothing JSON to store
    // and the sample stays untouched
    const row = h.sdb
      .prepare("SELECT sample_response_json FROM leadgen_offer_payload_schemas WHERE id = ?")
      .get(h.schemaId) as { sample_response_json: string | null };
    expect(row.sample_response_json).toBeNull();
  });

  it("validates the request body and offer preconditions", async () => {
    const h = await setupOffer();
    stubFetch(() => new Response("{}", { status: 200 }));

    const badEnv = await admin.request(`${API}/offers/${h.offerId}/test`, jsonInit("POST", { environment: "prod" }), h.env);
    expect(badEnv.status).toBe(400);

    const badAnswers = await admin.request(
      `${API}/offers/${h.offerId}/test`,
      jsonInit("POST", { environment: "staging", sample_answers: 5 }),
      h.env,
    );
    expect(badAnswers.status).toBe(400);

    // a STATIC offer has nothing to test
    const staticRes = await admin.request(
      `${API}/offers`,
      jsonInit("POST", {
        offer_name: "Static",
        activity: "quote_funnel",
        vertical: "life",
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: ["pl-s"],
        calls_provider_api: false,
        bid_source: "static",
        cap_enabled: false,
      }),
      h.env,
    );
    const staticOffer = (await staticRes.json()) as { id: number };
    const notDynamic = await admin.request(
      `${API}/offers/${staticOffer.id}/test`,
      jsonInit("POST", { environment: "staging", sample_answers: {} }),
      h.env,
    );
    expect(notDynamic.status).toBe(400);

    // a DYNAMIC offer without an active schema
    const bare = await admin.request(
      `${API}/offers`,
      jsonInit("POST", {
        offer_name: "Bare Dyn",
        activity: "quote_funnel",
        vertical: "life",
        conversion_tracking_method: "s2s_postback",
        offer_type: "cpc",
        placements: ["pl-b"],
        calls_provider_api: true,
        bid_source: "response",
        cap_enabled: false,
      }),
      h.env,
    );
    const bareOffer = (await bare.json()) as { id: number };
    const noSchema = await admin.request(
      `${API}/offers/${bareOffer.id}/test`,
      jsonInit("POST", { environment: "staging", sample_answers: {} }),
      h.env,
    );
    expect(noSchema.status).toBe(400);
    expect(((await noSchema.json()) as { fields: Record<string, string> }).fields["offer"]).toContain(
      "no active payload schema",
    );
  });
});

// --- B7 pre-test validity gate (fix-contract v2.4 05 §5.5) ---------------------------

// Point the offer at a DIRECTLY-INSERTED schema row (bypassing the save gate,
// exactly how a legacy/hand-written row would sit in production D1).
function activateRawSchemaRow(h: Harness, schemaJson: string): void {
  const next = h.sdb
    .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS v FROM leadgen_offer_payload_schemas WHERE offer_id = ?")
    .get(h.offerId) as { v: number };
  h.sdb
    .prepare(
      "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, carrier_parse_json, source) VALUES (?, ?, ?, ?, ?, 'manual')",
    )
    .run(
      `lgp_b7gate${Math.random().toString(36).slice(2, 10)}`,
      h.offerId,
      next.v,
      schemaJson,
      JSON.stringify(CARRIER_PARSE),
    );
  const row = h.sdb
    .prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE offer_id = ? ORDER BY id DESC LIMIT 1")
    .get(h.offerId) as { id: number };
  h.sdb.prepare("UPDATE leadgen_offers SET active_payload_schema_id = ? WHERE id = ?").run(row.id, h.offerId);
}

describeDb("POST /offers/:id/test — B7 pre-test validity gate (05 §5.5)", () => {
  it("BLOCKING-class schema errors → typed 400 {error, schema_errors[{code,path,message}]}, no fetch, no log", async () => {
    const h = await setupOffer();
    activateRawSchemaRow(
      h,
      JSON.stringify({
        version: 1,
        root: {
          type: "object",
          children: [
            { path: "dup", name: "dup", type: "string", source: "static", value: "a" },
            { path: "dup", name: "dup", type: "string", source: "static", value: "b" },
          ],
        },
      }),
    );
    const calls = stubFetch(() => new Response("{}", { status: 200 }));
    const res = await admin.request(
      `${API}/offers/${h.offerId}/test`,
      jsonInit("POST", { environment: "staging", sample_answers: {} }),
      h.env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      schema_errors: Array<{ code: string; path?: string; message: string }>;
    };
    expect(body.error).toBe("schema_validation_errors");
    expect(body.schema_errors.some((e) => e.code === "path_duplicate" && e.path === "dup")).toBe(true);
    expect(body.schema_errors.every((e) => typeof e.message === "string" && e.message !== "")).toBe(true);
    expect(calls).toHaveLength(0); // gate fires BEFORE any provider call
    expect(lastLogRow(h.sdb)).toBeNull();
  });

  it("an UNREADABLE stored schema (not JSON / not the §11.5 shape) is a typed 400 — never a bare 500", async () => {
    const h = await setupOffer();
    const calls = stubFetch(() => new Response("{}", { status: 200 }));

    activateRawSchemaRow(h, "this is not json at all {{{");
    const notJson = await admin.request(
      `${API}/offers/${h.offerId}/test`,
      jsonInit("POST", { environment: "staging", sample_answers: {} }),
      h.env,
    );
    expect(notJson.status).toBe(400);
    const notJsonBody = (await notJson.json()) as { error: string; schema_errors: Array<{ code: string }> };
    expect(notJsonBody.error).toBe("schema_validation_errors");
    expect(notJsonBody.schema_errors[0]?.code).toBe("schema_not_object");

    activateRawSchemaRow(h, JSON.stringify({ version: 1 })); // no root
    const noRoot = await admin.request(
      `${API}/offers/${h.offerId}/test`,
      jsonInit("POST", { environment: "staging", sample_answers: {} }),
      h.env,
    );
    expect(noRoot.status).toBe(400);
    expect(
      ((await noRoot.json()) as { schema_errors: Array<{ code: string }> }).schema_errors.some(
        (e) => e.code === "root_invalid",
      ),
    ).toBe(true);
    expect(calls).toHaveLength(0);
    expect(lastLogRow(h.sdb)).toBeNull();
  });

  it("WARNING-class-only findings (enum_value_violation) do NOT block the test (05 §5.5)", async () => {
    const h = await setupOffer();
    activateRawSchemaRow(
      h,
      JSON.stringify({
        version: 1,
        root: {
          type: "object",
          children: [
            {
              path: "tier",
              name: "tier",
              type: "enum",
              source: "answer",
              internal_field: "tier",
              valid_values: ["basic", "premium"],
              default: "zzz", // OUTSIDE the domain → warning-class only
            },
          ],
        },
      }),
    );
    // the tier question maps to the tier field — the ONE binding surface
    seedAnswerMaps(h.sdb, h.offerId, h.schemaId, [
      { internal_field: "tier", path: "tier", type: "enum" },
    ]);
    const calls = stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));
    const { status, body } = await runTest(h, { environment: "staging", sample_answers: { tier: "basic" } });
    expect(status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(body.request.payload).toEqual({ tier: "basic" });
  });
});

// --- encrypted debug blob -------------------------------------------------------------

async function decryptDebugBlob(secret: string, stored: string): Promise<string> {
  const [ivB64, ctB64] = stored.split(".");
  const iv = Uint8Array.from(atob(ivB64 ?? ""), (ch) => ch.charCodeAt(0));
  const ct = Uint8Array.from(atob(ctB64 ?? ""), (ch) => ch.charCodeAt(0));
  const keyMaterial = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(plaintext);
}

describeDb("POST /offers/:id/test — encrypted debug_ref (§30.3)", () => {
  it("debug_ref stays NULL and NO blob is written while the encryption secret is absent", async () => {
    const h = await setupOffer();
    stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));
    const { body } = await runTest(h, { environment: "staging", sample_answers: {} });
    expect(body.debug_ref).toBeNull();
    expect(lastLogRow(h.sdb)?.["debug_ref"]).toBeNull();
    expect(h.puts).toHaveLength(0);
  });

  it("with LEADGEN_DEBUG_ENCRYPTION_KEY set: encrypted KV blob, 72h TTL, opaque debug_ref", async () => {
    const encryptionKey = "unit-test-encryption-key";
    const h = await setupOffer({ envExtra: { [DEBUG_ENCRYPTION_SECRET_NAME]: encryptionKey } });
    stubFetch(() => new Response(JSON.stringify(PROVIDER_BODY), { status: 200 }));
    const { body } = await runTest(h, { environment: "staging", sample_answers: SAMPLE_ANSWERS });

    // opaque ref, echoed in the response AND stamped on the log row
    expect(body.debug_ref).toMatch(/^lg-debug:[0-9a-f]{32}$/);
    expect(lastLogRow(h.sdb)?.["debug_ref"]).toBe(body.debug_ref);

    // one KV put under the ref with the §30.3 72-hour TTL (259200 s)
    expect(h.puts).toHaveLength(1);
    const put = h.puts[0];
    expect(put?.key).toBe(body.debug_ref);
    expect(put?.opts?.expirationTtl).toBe(DEBUG_BLOB_TTL_SECONDS);
    expect(DEBUG_BLOB_TTL_SECONDS).toBe(259_200);

    // the stored blob is CIPHERTEXT — no plaintext secret/PII byte in it
    expect(put?.value).not.toContain(PROVIDER_TOKEN);
    expect(put?.value).not.toContain(HEADER_SECRET);
    expect(put?.value).not.toContain("John@X.com");
    expect(put?.value).not.toContain("contact");

    // ...and it decrypts back to the FULL unredacted request/response record
    const plaintext = await decryptDebugBlob(encryptionKey, put?.value ?? "");
    const blob = JSON.parse(plaintext) as {
      url: string;
      request_headers: Record<string, string>;
      request_payload: { contact: { email: string } };
      response_body: string;
    };
    expect(blob.url).toBe(STAGING_URL);
    expect(blob.request_headers["X-Api-Token"]).toBe(PROVIDER_TOKEN); // full blob is unredacted
    expect(blob.request_headers["X-Secret"]).toBe(HEADER_SECRET);
    expect(blob.request_payload.contact.email).toBe(" John@X.com ");
    expect(blob.response_body).toBe(JSON.stringify(PROVIDER_BODY));
  });
});

// --- §30.3 retention prune --------------------------------------------------------------

describeDb("pruneLeadgenRetention — §30.3 bounded prune", () => {
  function seedHarness(): { sdb: SqliteDb; env: Env } {
    const ctor = DatabaseSync as DatabaseSyncCtor;
    const sdb = createLeadgenDb(ctor);
    const { kv } = recordingKv();
    return { sdb, env: buildEnv(d1FromSqlite(sdb), kv) };
  }

  function seedProviderLog(sdb: SqliteDb, createdAt: number, count: number): void {
    const stmt = sdb.prepare(
      "INSERT INTO leadgen_provider_request_log (offer_public_id, environment, created_at) VALUES ('lgo_seed', 'staging', ?)",
    );
    for (let i = 0; i < count; i++) stmt.run(createdAt);
  }

  function seedClicked(sdb: SqliteDb, clickedAt: number, count: number, prefix: string): void {
    const stmt = sdb.prepare(
      "INSERT INTO leadgen_session_clicked_offers (funnel_attempt_id, offer_id, carrier_key, clicked_at) VALUES (?, 1, '', ?)",
    );
    for (let i = 0; i < count; i++) stmt.run(`${prefix}-${i}`, clickedAt);
  }

  it("deletes provider-log rows older than 7d and clicked-offer rows older than 24h, keeps the rest", async () => {
    const { sdb, env } = seedHarness();
    const now = new Date("2026-07-06T12:00:00Z");
    const nowEpoch = Math.floor(now.getTime() / 1000);
    seedProviderLog(sdb, nowEpoch - 8 * 86400, 3); // old → pruned
    seedProviderLog(sdb, nowEpoch - 3600, 2); // fresh → kept
    seedClicked(sdb, nowEpoch - 25 * 3600, 2, "old"); // old → pruned
    seedClicked(sdb, nowEpoch - 3600, 1, "new"); // fresh → kept

    const result = await pruneLeadgenRetention(env, now);
    expect(result).toEqual({ provider_request_log_deleted: 3, session_clicked_offers_deleted: 2 });

    const logs = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_provider_request_log").get() as { n: number };
    expect(logs.n).toBe(2);
    const clicked = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_session_clicked_offers").get() as { n: number };
    expect(clicked.n).toBe(1);
  });

  it("is BOUNDED: batchSize × maxIterations caps one run; the next run resumes", async () => {
    const { sdb, env } = seedHarness();
    const now = new Date("2026-07-06T12:00:00Z");
    const nowEpoch = Math.floor(now.getTime() / 1000);
    seedProviderLog(sdb, nowEpoch - 8 * 86400, 10);

    const first = await pruneLeadgenRetention(env, now, { batchSize: 2, maxIterations: 3 });
    expect(first.provider_request_log_deleted).toBe(6); // 2 × 3 — the bound held
    const remaining = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_provider_request_log").get() as { n: number };
    expect(remaining.n).toBe(4);

    const second = await pruneLeadgenRetention(env, now, { batchSize: 2, maxIterations: 3 });
    expect(second.provider_request_log_deleted).toBe(4); // resumed to completion
  });

  it("isolates table failures: one broken table never blocks the other, and it never throws", async () => {
    const { sdb, env } = seedHarness();
    const now = new Date("2026-07-06T12:00:00Z");
    const nowEpoch = Math.floor(now.getTime() / 1000);
    seedProviderLog(sdb, nowEpoch - 8 * 86400, 2);
    runSql(sdb, "DROP TABLE leadgen_session_clicked_offers");

    const result = await pruneLeadgenRetention(env, now);
    expect(result.provider_request_log_deleted).toBe(2);
    expect(result.session_clicked_offers_deleted).toBe(0); // failed leg reports 0, no throw
  });
});
