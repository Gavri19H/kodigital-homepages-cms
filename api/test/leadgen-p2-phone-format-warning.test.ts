// LeadGen Round-4 P2 — formatPhone x phone_format incoherence warning (P2
// adversarial review finding). props.phone_format (content-schema.ts, Round-4
// A-6b) lets an author accept e164_intl/il/custom phone shapes; the
// answer-map value_transform step `formatPhone` (payload.ts
// transformFormatPhone) hard-requires exactly 10 NANP digits and silently
// drops (returns undefined for) anything else — a lead's phone answer
// validated under a non-NANP format vanishes from the dispatched payload
// with NO signal to the author. This pins the new non-blocking warning
// (sections-handlers.ts parseAnswerMaps/prepareSave): absent/'nanp' is the
// coherent pairing (no warning); any other phone_format + a formatPhone
// transform on the SAME field warns verbatim, riding the section save
// response's EXISTING problems[] array (03 §3.6 Problem shape, scope
// "mapping") — the same non-blocking-warning surface the content validator's
// own warnings (frame_scope_component/duplicate_continue) already use. Never
// a save-blocker: the combination exists in shipped content already.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

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

// A string-typed schema field the phone answer maps into (source: answer).
const PHONE_SCHEMA = {
  version: 1,
  root: {
    type: "object",
    children: [
      { path: "data.phone", name: "phone", type: "string", required: false, source: "answer", internal_field: "phone" },
    ],
  },
};

async function createMappableOffer(env: Env): Promise<{ id: number; public_id: string }> {
  const res = await admin.request(
    `${API}/offers`,
    jsonInit("POST", {
      offer_name: "Phone Offer",
      activity: "quote_funnel",
      vertical: "life",
      conversion_tracking_method: "s2s_postback",
      offer_type: "cpl",
      placements: ["plc-phone-1"],
      calls_provider_api: true,
      bid_source: "static",
      cap_enabled: false,
    }),
    env,
  );
  expect(res.status, `create offer: ${await res.clone().text()}`).toBe(201);
  const offer = (await res.json()) as { id: number; public_id: string };
  const schemaRes = await admin.request(
    `${API}/offers/${offer.id}/payload-schemas`,
    jsonInit("POST", { schema_json: PHONE_SCHEMA }),
    env,
  );
  expect(schemaRes.status, `post schema: ${await schemaRes.clone().text()}`).toBe(201);
  return offer;
}

// A single PhoneInputQuestion component, optionally carrying props.phone_format.
function phoneContentJson(phoneFormat: unknown): string {
  const node: Record<string, unknown> = {
    type: "PhoneInputQuestion",
    question_id: "p1",
    question_key: "phone_q",
    internal_field: "phone",
    answer_type: "string",
  };
  if (phoneFormat !== undefined) node.props = { phone_format: phoneFormat };
  return JSON.stringify({ components: [node] });
}

function sectionBody(
  phoneFormat: unknown,
  offerId: number,
  transform: Array<Record<string, unknown>> = [{ kind: "formatPhone" }],
): Record<string, unknown> {
  return {
    section_name: "Phone Section",
    activity: "quote_funnel",
    vertical: "life",
    headline_text: "What is your phone number?",
    content_json: phoneContentJson(phoneFormat),
    answer_maps: [
      {
        question_id: "p1",
        offer_id: offerId,
        offer_payload_field_path: "data.phone",
        provider_expected_type: "string",
        value_transform: transform,
      },
    ],
  };
}

interface ProblemJson {
  path: string;
  scope: string;
  severity: string;
  message: string;
}

const WARNING_MESSAGE =
  "This field uses an international phone format, but the offer mapping applies a US-only phone transform — the phone may be dropped from the lead. Align the format or the transform.";

function findPhoneWarning(problems: ProblemJson[]): ProblemJson | undefined {
  return problems.find((p) => p.message === WARNING_MESSAGE);
}

// ===========================================================================

describeDb("formatPhone x phone_format incoherence warning (P2 review round)", () => {
  it("il phone_format + a formatPhone transform: the save response carries the warning verbatim (scope=mapping, severity=warning)", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody("il", offer.id)), env);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { problems: ProblemJson[] };
    const warning = findPhoneWarning(body.problems);
    expect(warning, JSON.stringify(body.problems)).toBeDefined();
    expect(warning!.message).toBe(WARNING_MESSAGE);
    expect(warning!.scope).toBe("mapping");
    expect(warning!.severity).toBe("warning");
    expect(warning!.path).toBe("answer_maps[0].value_transform");
  });

  it("e164_intl phone_format + formatPhone: also warns (any non-nanp preset, not just il)", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody("e164_intl", offer.id)), env);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { problems: ProblemJson[] };
    expect(findPhoneWarning(body.problems)).toBeDefined();
  });

  it("a custom phone_format object + formatPhone: also warns (not just preset strings)", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const res = await admin.request(
      `${API}/sections`,
      jsonInit("POST", sectionBody({ custom: { regex: "^\\d{9}$" } }, offer.id)),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { problems: ProblemJson[] };
    expect(findPhoneWarning(body.problems)).toBeDefined();
  });

  it("nanp phone_format + formatPhone: NO warning (the coherent pairing)", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody("nanp", offer.id)), env);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { problems: ProblemJson[] };
    expect(findPhoneWarning(body.problems)).toBeUndefined();
  });

  it("absent phone_format + formatPhone: NO warning (byte-identical legacy NANP default is coherent)", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody(undefined, offer.id)), env);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { problems: ProblemJson[] };
    expect(findPhoneWarning(body.problems)).toBeUndefined();
  });

  it("il phone_format WITHOUT a formatPhone transform: NO warning (the transform is the trigger, not the format alone)", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody("il", offer.id, [])), env);
    expect(res.status, await res.clone().text()).toBe(201);
    const body = (await res.json()) as { problems: ProblemJson[] };
    expect(findPhoneWarning(body.problems)).toBeUndefined();
  });

  it("never blocks the save: a 201/200 either way, il+formatPhone included (warning, not rejection)", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const res = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody("il", offer.id)), env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { public_id: string };
    expect(typeof body.public_id).toBe("string");
  });

  it("PATCH re-validates the stored mapping too: a save that doesn't touch answer_maps still surfaces an existing incoherence", async () => {
    const { env } = newHarness();
    const offer = await createMappableOffer(env);
    const created = await admin.request(`${API}/sections`, jsonInit("POST", sectionBody("il", offer.id)), env);
    expect(created.status, await created.clone().text()).toBe(201);
    const section = (await created.json()) as { public_id: string };

    const patch = await admin.request(
      `${API}/sections/${section.public_id}`,
      jsonInit("PATCH", { headline_text: "Updated headline" }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);
    const patchBody = (await patch.json()) as { problems: ProblemJson[] };
    expect(findPhoneWarning(patchBody.problems)).toBeDefined();
  });
});
