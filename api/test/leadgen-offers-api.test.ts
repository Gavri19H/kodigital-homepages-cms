// LeadGen Phase 4 Stage B1 — the contract 03 §8.2 Offers block over the REAL
// admin router + REAL 0036–0039 migrations (node:sqlite harness; the
// leadgen-admin-shell.test.ts pattern with DEV_BYPASS_AUTH).
//
// Covers: the §10.1 create modal (draft offer + default placement, every
// required-field rejection, the illegal flag combo), the 7 list filters +
// paging, /offers/search order/limit + static-before-param, GET detail with
// nested collections, PATCH replace-set headers[] + region_rules[] (lgrr_
// minting), the three §10.3 client-mode save rejections, §10.5 banner
// template save guards, archive-not-delete, usage joins, §10.7 analytics
// NULLIF ratios, §10.6 cap status, §11.8 immutable schema versioning +
// active-pointer moves, and §11.2 from-example inference.

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { isPublicId, mintPublicId } from "../src/leadgen/ids";
import { capPeriodKey } from "../src/leadgen/caps";
import { validatePayloadSchema } from "../src/leadgen/payload";
import type { Paging } from "../src/admin/leadgen/router";

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
  // NULLable + quote_id) the quotes_indirect usage tests below exercise.
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
    LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS:
      "OFFER_TOKEN_HEADER,OFFER_TOKEN_PROVIDER,OFFER_TOKEN_PROV_KEY",
    OFFER_TOKEN_HEADER: "header-secret-value",
    OFFER_TOKEN_PROVIDER: "provider-secret-value",
    OFFER_TOKEN_PROV_KEY: "provider-key-value",
  } as unknown as Env;
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
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// A valid §10.1 create-modal body (every required field present).
function createBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    offer_name: "Test Offer",
    activity: "quote_funnel",
    vertical: "life",
    conversion_tracking_method: "s2s_postback",
    offer_type: "cpc",
    placements: ["pl-100"],
    calls_provider_api: true,
    bid_source: "response",
    cap_enabled: false,
    ...overrides,
  };
}

interface OfferDetail {
  id: number;
  public_id: string;
  offer_name: string;
  status: string;
  calls_provider_api: boolean;
  cap_enabled: boolean;
  banner_url_template: string | null;
  placements: Array<{
    id: number;
    public_id: string;
    placement_id: string;
    label: string | null;
    is_default: boolean;
  }>;
  headers: Array<{ header_name: string; value_kind: string; value_text: string | null }>;
  region_rules: Array<{
    public_id: string;
    dimension: string;
    action: string;
    values_json: unknown;
    priority: number;
    enabled: boolean;
  }>;
  [key: string]: unknown;
}

async function createOffer(env: Env, overrides: Record<string, unknown> = {}): Promise<OfferDetail> {
  const res = await admin.request(`${API}/offers`, jsonInit("POST", createBody(overrides)), env);
  expect(res.status).toBe(201);
  return (await res.json()) as OfferDetail;
}

// --- §10.1 create modal --------------------------------------------------------

describeDb("POST /offers — §10.1 create modal", () => {
  it("creates the draft offer + its default placement atomically (lgo_/lgpl_, is_default=1)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env, { placements: ["pl-1", "pl-2"], provider: "acme" });

    expect(isPublicId("offer", offer.public_id)).toBe(true);
    // §7.1: "draft" is lifecycle prose — the DDL default status applies.
    expect(offer.status).toBe("active");
    expect(offer.calls_provider_api).toBe(true);
    expect(offer.cap_enabled).toBe(false);

    // The response carries the placements; the FIRST is the default.
    expect(offer.placements).toHaveLength(2);
    const [first, second] = offer.placements;
    expect(first?.placement_id).toBe("pl-1");
    expect(first?.is_default).toBe(true);
    expect(second?.placement_id).toBe("pl-2");
    expect(second?.is_default).toBe(false);
    expect(isPublicId("offer_placement", first?.public_id ?? "")).toBe(true);

    // DB truth: exactly one default row per offer.
    const rows = sdb
      .prepare("SELECT placement_id, is_default FROM leadgen_offer_placements WHERE offer_id = ? ORDER BY id")
      .all(offer.id) as Array<{ placement_id: string; is_default: number }>;
    expect(rows).toEqual([
      { placement_id: "pl-1", is_default: 1 },
      { placement_id: "pl-2", is_default: 0 },
    ]);

    // uq_leadgen_offerplacement_default HOLDS: promoting a second default throws.
    expect(() =>
      sdb
        .prepare("UPDATE leadgen_offer_placements SET is_default = 1 WHERE offer_id = ? AND placement_id = 'pl-2'")
        .run(offer.id),
    ).toThrow();
  });

  it("rejects every missing §10.1 required field with a field-keyed 400", async () => {
    const { env } = newHarness();
    const required = [
      "offer_name",
      "activity",
      "vertical",
      "conversion_tracking_method",
      "offer_type",
      "placements",
      "calls_provider_api",
      "bid_source",
      "cap_enabled",
    ] as const;
    for (const field of required) {
      const body = createBody();
      delete body[field];
      const res = await admin.request(`${API}/offers`, jsonInit("POST", body), env);
      expect(res.status, `missing ${field} must 400`).toBe(400);
      const payload = (await res.json()) as { error: string; fields: Record<string, string> };
      expect(payload.error).toBe("Validation failed");
      expect(payload.fields[field], `fields.${field} must name the error`).toBeTruthy();
    }
    // an EMPTY placements array is as invalid as an absent one
    const res = await admin.request(`${API}/offers`, jsonInit("POST", createBody({ placements: [] })), env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields["placements"]).toBeTruthy();
  });

  it("rejects the illegal §10.2 flag combo (calls_provider_api=0 + bid_source=response)", async () => {
    const { env } = newHarness();
    const res = await admin.request(
      `${API}/offers`,
      jsonInit("POST", createBody({ calls_provider_api: false, bid_source: "response" })),
      env,
    );
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { fields: Record<string, string> };
    expect(payload.fields["bid_source"]).toContain("requires calls_provider_api");
  });

  it("rejects a non-JSON body", async () => {
    const { env } = newHarness();
    const res = await admin.request(
      `${API}/offers`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "not-json" },
      env,
    );
    expect(res.status).toBe(400);
  });
});

// --- GET /offers — the 7 filters + paging ---------------------------------------

describeDb("GET /offers — §8.2/§9.2 filters + paging", () => {
  async function seedSix(env: Env): Promise<OfferDetail[]> {
    const offers = [
      await createOffer(env, { offer_name: "Alpha Life", provider: "acme", vertical: "life", activity: "quote_funnel", offer_type: "cpc", calls_provider_api: true, bid_source: "response", placements: ["a-1"] }),
      await createOffer(env, { offer_name: "Beta Auto", provider: "acme", vertical: "auto", activity: "quote_funnel", offer_type: "cpl", calls_provider_api: true, bid_source: "static", placements: ["b-1"] }),
      await createOffer(env, { offer_name: "Gamma Life", provider: "zenith", vertical: "life", activity: "banner", offer_type: "cpa", calls_provider_api: false, bid_source: "static", placements: ["c-1"] }),
      await createOffer(env, { offer_name: "Delta Home", provider: "zenith", vertical: "home", activity: "banner", offer_type: "cpi", calls_provider_api: false, bid_source: "static", placements: ["d-1"] }),
      await createOffer(env, { offer_name: "Epsilon Life", provider: "nova", vertical: "life", activity: "quote_funnel", offer_type: "cpc", calls_provider_api: true, bid_source: "response", placements: ["e-1"] }),
      await createOffer(env, { offer_name: "Zeta Auto", provider: "nova", vertical: "auto", activity: "banner", offer_type: "cpc", calls_provider_api: true, bid_source: "response", placements: ["f-1"] }),
    ];
    return offers;
  }

  async function listNames(env: Env, qs: string): Promise<string[]> {
    const res = await admin.request(`${API}/offers${qs}`, {}, env);
    expect(res.status, `${qs} status`).toBe(200);
    const body = (await res.json()) as { items: Array<{ offer_name: string }> };
    return body.items.map((i) => i.offer_name).sort();
  }

  it("filters by search / provider / vertical / activity / status / offer_type / dynamic", async () => {
    const { env } = newHarness();
    const offers = await seedSix(env);
    // archive one to exercise the status filter
    await admin.request(`${API}/offers/${offers[3]?.id}`, { method: "DELETE" }, env);

    expect(await listNames(env, "?search=Life")).toEqual(["Alpha Life", "Epsilon Life", "Gamma Life"]);
    expect(await listNames(env, "?provider=acme")).toEqual(["Alpha Life", "Beta Auto"]);
    expect(await listNames(env, "?vertical=auto")).toEqual(["Beta Auto", "Zeta Auto"]);
    expect(await listNames(env, "?activity=banner")).toEqual(["Delta Home", "Gamma Life", "Zeta Auto"]);
    expect(await listNames(env, "?status=archived")).toEqual(["Delta Home"]);
    expect(await listNames(env, "?offer_type=cpc")).toEqual(["Alpha Life", "Epsilon Life", "Zeta Auto"]);
    // dynamic maps to calls_provider_api (§10.2)
    expect(await listNames(env, "?dynamic=1")).toEqual(["Alpha Life", "Beta Auto", "Epsilon Life", "Zeta Auto"]);
    expect(await listNames(env, "?dynamic=false")).toEqual(["Delta Home", "Gamma Life"]);
    // filters compose
    expect(await listNames(env, "?vertical=life&dynamic=true&provider=nova")).toEqual(["Epsilon Life"]);
  });

  it("rejects invalid enum filter values with 400", async () => {
    const { env } = newHarness();
    for (const qs of ["?status=bogus", "?offer_type=cpx", "?dynamic=maybe"]) {
      const res = await admin.request(`${API}/offers${qs}`, {}, env);
      expect(res.status, `${qs} must 400`).toBe(400);
    }
  });

  it("pages with the 03 §8.4 paging envelope and carries default_placement_id", async () => {
    const { env } = newHarness();
    await seedSix(env);
    const res = await admin.request(`${API}/offers?page=2&page_size=2`, {}, env);
    const body = (await res.json()) as {
      items: Array<{ default_placement_id: string | null }>;
      paging: Paging;
    };
    expect(body.items).toHaveLength(2);
    expect(body.paging).toEqual({ page: 2, page_size: 2, total: 6, has_next: true, has_prev: true });
    // §9.2 "placement id" column: the default placement rides each list row.
    for (const item of body.items) {
      expect(typeof item.default_placement_id).toBe("string");
    }
  });
});

// --- GET /offers/search ----------------------------------------------------------

describeDb("GET /offers/search — typeahead (03 §8.2)", () => {
  it("is registered BEFORE /offers/:id (static-before-param) and returns the search envelope", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/offers/search?q=`, {}, env);
    // if :id had captured "search", idSelector would 404 — 200 proves order.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; q: string };
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.q).toBe("");
  });

  it("matches on name only, filters activity+vertical, active only, name-ordered, LIMIT 20", async () => {
    const { env } = newHarness();
    // 22 active matching offers prove the LIMIT; zz-prefixed names prove ORDER.
    for (let i = 0; i < 22; i++) {
      const suffix = String(i).padStart(2, "0");
      await createOffer(env, {
        offer_name: `Match ${suffix}`,
        activity: "quote_funnel",
        vertical: "life",
        placements: [`m-${suffix}`],
      });
    }
    // name does NOT match; provider does — must be EXCLUDED (name match only)
    await createOffer(env, { offer_name: "Unrelated", provider: "Match", placements: ["u-1"] });
    // matching name, WRONG activity — excluded by the activity filter
    await createOffer(env, { offer_name: "Match banner", activity: "banner", placements: ["u-2"] });
    // matching name but ARCHIVED — excluded
    const archived = await createOffer(env, { offer_name: "Match archived", placements: ["u-3"] });
    await admin.request(`${API}/offers/${archived.id}`, { method: "DELETE" }, env);

    const res = await admin.request(
      `${API}/offers/search?q=Match&activity=quote_funnel&vertical=life`,
      {},
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ offer_name: string; status: string }>; q: string };
    expect(body.items).toHaveLength(20); // LIMIT 20
    expect(body.items[0]?.offer_name).toBe("Match 00"); // ORDER BY offer_name ASC
    expect(body.items[19]?.offer_name).toBe("Match 19");
    for (const item of body.items) {
      expect(item.status).toBe("active");
      expect(item.offer_name.startsWith("Match ")).toBe(true);
      expect(item.offer_name).not.toBe("Match banner");
    }
  });
});

// --- PATCH /offers/:id -------------------------------------------------------------

describeDb("PATCH /offers/:id — partial update + nested collections", () => {
  it("updates scalars via dual id (public_id) with merge-then-revalidate", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    const res = await admin.request(
      `${API}/offers/${offer.public_id}`,
      jsonInit("PATCH", {
        offer_name: "Renamed",
        endpoint_production: "https://api.example.com/quotes",
        endpoint_staging: "https://staging.example.com/quotes",
        request_method: "POST",
        tag: "q4",
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as OfferDetail;
    expect(body.offer_name).toBe("Renamed");
    expect(body["endpoint_production"]).toBe("https://api.example.com/quotes");
    const row = sdb.prepare("SELECT offer_name, tag FROM leadgen_offers WHERE id = ?").get(offer.id) as {
      offer_name: string;
      tag: string;
    };
    expect(row).toEqual({ offer_name: "Renamed", tag: "q4" });
  });

  it("replace-sets headers[] (value kinds validated; macro templates normalized)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    const first = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        headers: [
          { header_name: "X-Static", value_kind: "static", value_text: "fixed-value" },
          { header_name: "X-Macro", value_kind: "macro", value_text: "{clickid}" },
          { header_name: "X-Secret", value_kind: "secret_ref", value_text: "OFFER_TOKEN_HEADER" },
        ],
      }),
      env,
    );
    expect(first.status).toBe(200);
    const rows = sdb
      .prepare("SELECT header_name, value_kind, value_text FROM leadgen_offer_headers WHERE offer_id = ? ORDER BY id")
      .all(offer.id) as Array<{ header_name: string; value_kind: string; value_text: string }>;
    expect(rows).toEqual([
      { header_name: "X-Static", value_kind: "static", value_text: "fixed-value" },
      // {clickid} alias normalizes to the canonical {click_id} at save
      { header_name: "X-Macro", value_kind: "macro", value_text: "{click_id}" },
      // §30.2: the secret NAME only — never a secret value
      { header_name: "X-Secret", value_kind: "secret_ref", value_text: "OFFER_TOKEN_HEADER" },
    ]);

    // REPLACE-set: the next PATCH's list fully replaces the stored rows.
    const second = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", { headers: [{ header_name: "X-Only", value_kind: "static", value_text: "v2" }] }),
      env,
    );
    expect(second.status).toBe(200);
    const after = sdb
      .prepare("SELECT header_name FROM leadgen_offer_headers WHERE offer_id = ?")
      .all(offer.id) as Array<{ header_name: string }>;
    expect(after).toEqual([{ header_name: "X-Only" }]);
  });

  it("rejects bad headers: unknown macro, control chars, bad secret name, duplicate name", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const cases: Array<{ headers: unknown; key: string }> = [
      { headers: [{ header_name: "X-M", value_kind: "macro", value_text: "{not_a_macro}" }], key: "headers[0].value_text" },
      { headers: [{ header_name: "X-C", value_kind: "static", value_text: "bad\r\nvalue" }], key: "headers[0].value_text" },
      { headers: [{ header_name: "X-S", value_kind: "secret_ref", value_text: "not a name" }], key: "headers[0].value_text" },
      { headers: [{ header_name: "Bad Name", value_kind: "static", value_text: "v" }], key: "headers[0].header_name" },
      {
        headers: [
          { header_name: "X-Dup", value_kind: "static", value_text: "a" },
          { header_name: "x-dup", value_kind: "static", value_text: "b" },
        ],
        key: "headers[1].header_name",
      },
    ];
    for (const { headers, key } of cases) {
      const res = await admin.request(`${API}/offers/${offer.id}`, jsonInit("PATCH", { headers }), env);
      expect(res.status, `${key} must 400`).toBe(400);
      const body = (await res.json()) as { fields: Record<string, string> };
      expect(body.fields[key], `fields.${key}`).toBeTruthy();
    }
  });

  it("fails closed when saving disallowed infrastructure or missing outbound bindings", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    Object.assign(env as unknown as Record<string, unknown>, {
      LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS:
        "OFFER_TOKEN_HEADER,OFFER_TOKEN_PROVIDER,OFFER_TOKEN_PROV_KEY,OFFER_TOKEN_MISSING,CH_PASSWORD,CF_API_TOKEN,GITHUB_TOKEN",
      CH_PASSWORD: "must-never-be-selected-by-an-offer",
      CF_API_TOKEN: "must-never-be-selected-by-an-offer",
      GITHUB_TOKEN: "must-never-be-selected-by-an-offer",
    });

    const infrastructureToken = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", { api_token_secret_ref: "CH_PASSWORD" }),
      env,
    );
    expect(infrastructureToken.status).toBe(400);
    expect(
      ((await infrastructureToken.json()) as { fields: Record<string, string> }).fields.api_token_secret_ref,
    ).toContain("infrastructure");

    for (const reference of ["CF_API_TOKEN", "GITHUB_TOKEN"]) {
      const commonInfrastructureToken = await admin.request(
        `${API}/offers/${offer.id}`,
        jsonInit("PATCH", { api_token_secret_ref: reference }),
        env,
      );
      expect(commonInfrastructureToken.status).toBe(400);
      expect(
        ((await commonInfrastructureToken.json()) as { fields: Record<string, string> })
          .fields.api_token_secret_ref,
      ).toContain("infrastructure");
    }

    const missingToken = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", { api_token_secret_ref: "OFFER_TOKEN_MISSING" }),
      env,
    );
    expect(missingToken.status).toBe(400);
    expect(((await missingToken.json()) as { fields: Record<string, string> }).fields.api_token_secret_ref).toContain(
      "missing or empty",
    );

    const infrastructureHeader = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        headers: [{ header_name: "X-Key", value_kind: "secret_ref", value_text: "CH_PASSWORD" }],
      }),
      env,
    );
    expect(infrastructureHeader.status).toBe(400);
    expect(
      ((await infrastructureHeader.json()) as { fields: Record<string, string> }).fields["headers[0].value_text"],
    ).toContain("infrastructure");

    const persisted = sdb
      .prepare("SELECT api_token_secret_ref FROM leadgen_offers WHERE id = ?")
      .get(offer.id) as { api_token_secret_ref: string | null };
    expect(persisted.api_token_secret_ref).toBeNull();
    expect(
      (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_offer_headers WHERE offer_id = ?").get(offer.id) as { n: number })
        .n,
    ).toBe(0);
  });

  it("replace-sets region_rules[] minting lgrr_ for new rows, preserving provided ids", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    const first = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        region_rules: [
          { dimension: "state", action: "exclude", values: ["CA"], priority: 10 },
          { dimension: "zip", action: "include_only", values: ["90210", "10001"] },
        ],
      }),
      env,
    );
    expect(first.status).toBe(200);
    const created = (await first.json()) as OfferDetail;
    expect(created.region_rules).toHaveLength(2);
    for (const rule of created.region_rules) {
      expect(isPublicId("offer_region_rule", rule.public_id)).toBe(true);
    }
    const stateRule = created.region_rules.find((r) => r.dimension === "state");
    expect(stateRule?.values_json).toEqual(["CA"]);
    expect(stateRule?.priority).toBe(10);

    // Re-PATCH: keep the state rule (by public_id), replace the zip rule.
    const keptId = stateRule?.public_id ?? "";
    const second = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        region_rules: [
          { public_id: keptId, dimension: "state", action: "exclude", values: ["CA", "NY"] },
          { dimension: "country", action: "allow_list", values: ["us"] },
        ],
      }),
      env,
    );
    expect(second.status).toBe(200);
    const updated = (await second.json()) as OfferDetail;
    expect(updated.region_rules).toHaveLength(2);
    const kept = updated.region_rules.find((r) => r.dimension === "state");
    expect(kept?.public_id).toBe(keptId); // preserved across the replace-set
    expect(kept?.values_json).toEqual(["CA", "NY"]);
    const minted = updated.region_rules.find((r) => r.dimension === "country");
    expect(minted?.public_id).not.toBe(keptId);
    expect(isPublicId("offer_region_rule", minted?.public_id ?? "")).toBe(true);

    // DB truth: exactly two rows, the old zip rule is gone.
    const rows = sdb
      .prepare("SELECT dimension FROM leadgen_offer_region_rules WHERE offer_id = ? ORDER BY priority, id")
      .all(offer.id) as Array<{ dimension: string }>;
    expect(rows.map((r) => r.dimension).sort()).toEqual(["country", "state"]);
  });

  it("rejects invalid region rules (empty values, bad enums, foreign public_id shape)", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const cases: Array<{ rule: unknown; key: string }> = [
      { rule: { dimension: "state", action: "exclude", values: [] }, key: "region_rules[0].values_json" },
      { rule: { dimension: "planet", action: "exclude", values: ["x"] }, key: "region_rules[0].dimension" },
      { rule: { dimension: "state", action: "nuke", values: ["x"] }, key: "region_rules[0].action" },
      {
        rule: { public_id: mintPublicId("offer"), dimension: "state", action: "exclude", values: ["CA"] },
        key: "region_rules[0].public_id",
      },
    ];
    for (const { rule, key } of cases) {
      const res = await admin.request(`${API}/offers/${offer.id}`, jsonInit("PATCH", { region_rules: [rule] }), env);
      expect(res.status, `${key} must 400`).toBe(400);
      expect(((await res.json()) as { fields: Record<string, string> }).fields[key]).toBeTruthy();
    }
  });

  it("rejects each §10.3 client-mode violation at save", async () => {
    const { env } = newHarness();

    // (a) client mode + api_token_secret_ref in the same PATCH
    const offerA = await createOffer(env, { placements: ["ca-1"] });
    const resA = await admin.request(
      `${API}/offers/${offerA.id}`,
      jsonInit("PATCH", { request_execution_mode: "client", api_token_secret_ref: "OFFER_TOKEN_PROVIDER" }),
      env,
    );
    expect(resA.status).toBe(400);
    expect(((await resA.json()) as { fields: Record<string, string> }).fields["api_token_secret_ref"]).toContain(
      "client-mode",
    );

    // (b) switching to client mode while a STORED secret_ref header exists
    const offerB = await createOffer(env, { placements: ["cb-1"] });
    const storedHeader = await admin.request(
      `${API}/offers/${offerB.id}`,
      jsonInit("PATCH", {
        headers: [{ header_name: "X-Key", value_kind: "secret_ref", value_text: "OFFER_TOKEN_HEADER" }],
      }),
      env,
    );
    expect(storedHeader.status).toBe(200);
    const resB = await admin.request(
      `${API}/offers/${offerB.id}`,
      jsonInit("PATCH", { request_execution_mode: "client" }),
      env,
    );
    expect(resB.status).toBe(400);
    const fieldsB = ((await resB.json()) as { fields: Record<string, string> }).fields;
    expect(fieldsB["headers[0].value_kind"]).toContain("secret_ref");

    // (c) client mode + non-https endpoint
    const offerC = await createOffer(env, { placements: ["cc-1"] });
    const resC = await admin.request(
      `${API}/offers/${offerC.id}`,
      jsonInit("PATCH", { request_execution_mode: "client", endpoint_production: "http://plain.example.com/x" }),
      env,
    );
    expect(resC.status).toBe(400);
    expect(((await resC.json()) as { fields: Record<string, string> }).fields["endpoint_production"]).toContain(
      "https",
    );
  });

  it("enforces the §10.5 banner template guards at save and persists normalized", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env, { calls_provider_api: false, bid_source: "static" });
    const bad = [
      "https://x.example.com/{not_a_real_macro}",
      "https://{sub1}.example.com/path", // macro in authority
      "/relative/path?c={click_id}", // not absolute
    ];
    for (const template of bad) {
      const res = await admin.request(
        `${API}/offers/${offer.id}`,
        jsonInit("PATCH", { banner_url_template: template }),
        env,
      );
      expect(res.status, `${template} must 400`).toBe(400);
      expect(((await res.json()) as { fields: Record<string, string> }).fields["banner_url_template"]).toBeTruthy();
    }
    const ok = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", { banner_url_template: "https://x.example.com/q?cid={clickid}&s={response:slug}" }),
      env,
    );
    expect(ok.status).toBe(200);
    const row = sdb.prepare("SELECT banner_url_template FROM leadgen_offers WHERE id = ?").get(offer.id) as {
      banner_url_template: string;
    };
    // persisted ALIAS-NORMALIZED ({clickid} → {click_id}); response macro intact
    expect(row.banner_url_template).toBe("https://x.example.com/q?cid={click_id}&s={response:slug}");
  });

  it("enforces §10.6 cap coherence and §10.2 flag combo on the MERGED state", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, { calls_provider_api: false, bid_source: "static" });

    const capRes = await admin.request(`${API}/offers/${offer.id}`, jsonInit("PATCH", { cap_enabled: true }), env);
    expect(capRes.status).toBe(400);
    const capFields = ((await capRes.json()) as { fields: Record<string, string> }).fields;
    expect(capFields["cap_amount"]).toBeTruthy();
    expect(capFields["cap_timezone"]).toBeTruthy();
    expect(capFields["cap_count_by"]).toBeTruthy();

    const okCap = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", { cap_enabled: true, cap_amount: 50, cap_timezone: "America/New_York", cap_count_by: "clicks" }),
      env,
    );
    expect(okCap.status).toBe(200);

    // merged combo: stored calls_provider_api=0, PATCHing only bid_source=response is illegal
    const comboRes = await admin.request(`${API}/offers/${offer.id}`, jsonInit("PATCH", { bid_source: "response" }), env);
    expect(comboRes.status).toBe(400);
    expect(((await comboRes.json()) as { fields: Record<string, string> }).fields["bid_source"]).toBeTruthy();
  });

  it("validates cap_fallback_offer_id referentially (unknown + self)", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const unknown = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", { cap_fallback_offer_id: 99_999 }),
      env,
    );
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { fields: Record<string, string> }).fields["cap_fallback_offer_id"]).toBe(
      "unknown fallback offer",
    );
    const self = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", { cap_fallback_offer_id: offer.id }),
      env,
    );
    expect(self.status).toBe(400);
    expect(((await self.json()) as { fields: Record<string, string> }).fields["cap_fallback_offer_id"]).toContain(
      "own cap fallback",
    );
  });

  it("400s on an empty PATCH and on unknown fields (active_payload_schema_id is not PATCHable)", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const empty = await admin.request(`${API}/offers/${offer.id}`, jsonInit("PATCH", {}), env);
    expect(empty.status).toBe(400);
    const unknown = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", { active_payload_schema_id: 1 }),
      env,
    );
    expect(unknown.status).toBe(400);
    expect(
      ((await unknown.json()) as { fields: Record<string, string> }).fields["active_payload_schema_id"],
    ).toContain("not an updatable field");
  });
});

// --- PATCH placements[] — the §10.1 replace-set --------------------------------------

describeDb("PATCH /offers/:id — placements[] replace-set (04 §10.1 / 03 §9.2)", () => {
  it("preserves rows by lgpl_ public_id (same DB row id), mints new, deletes omitted", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env, { placements: ["pl-1", "pl-2"] });
    const [keep, drop] = offer.placements;
    expect(keep?.placement_id).toBe("pl-1");
    expect(drop?.placement_id).toBe("pl-2");

    const res = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        placements: [
          { public_id: keep?.public_id, placement_id: "pl-1-renamed", label: "Main feed", is_default: true },
          { placement_id: "pl-3", is_default: false },
        ],
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as OfferDetail;
    expect(body.placements).toHaveLength(2);

    const kept = body.placements.find((p) => p.public_id === keep?.public_id);
    // Preserved IN PLACE: the same numeric row id survives (auctions join
    // leadgen_offer_placements BY id, §7.4 — delete+reinsert would orphan them).
    expect(kept?.id).toBe(keep?.id);
    expect(kept?.placement_id).toBe("pl-1-renamed");
    expect(kept?.label).toBe("Main feed");
    expect(kept?.is_default).toBe(true);

    const minted = body.placements.find((p) => p.placement_id === "pl-3");
    expect(isPublicId("offer_placement", minted?.public_id ?? "")).toBe(true);
    expect(minted?.is_default).toBe(false);
    expect(body.placements.some((p) => p.public_id === drop?.public_id)).toBe(false);

    // DB truth: two rows, the dropped one is gone, exactly one default.
    const rows = sdb
      .prepare("SELECT public_id, placement_id, is_default FROM leadgen_offer_placements WHERE offer_id = ? ORDER BY id")
      .all(offer.id) as Array<{ public_id: string; placement_id: string; is_default: number }>;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.placement_id).sort()).toEqual(["pl-1-renamed", "pl-3"]);
    expect(rows.filter((r) => r.is_default === 1).map((r) => r.public_id)).toEqual([keep?.public_id]);
  });

  it("moves the default between rows in one PATCH (uq_leadgen_offerplacement_default holds both sides)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env, { placements: ["pl-a", "pl-b"] });
    const [a, b] = offer.placements;
    expect(a?.is_default).toBe(true);

    const res = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        placements: [
          { public_id: a?.public_id, placement_id: "pl-a", is_default: false },
          { public_id: b?.public_id, placement_id: "pl-b", is_default: true },
        ],
      }),
      env,
    );
    expect(res.status).toBe(200);
    const rows = sdb
      .prepare("SELECT public_id, is_default FROM leadgen_offer_placements WHERE offer_id = ? ORDER BY id")
      .all(offer.id) as Array<{ public_id: string; is_default: number }>;
    expect(rows.filter((r) => r.is_default === 1).map((r) => r.public_id)).toEqual([b?.public_id]);

    // Swapping placement_id values in one PATCH also lands (the temp-park
    // ordering keeps UNIQUE(offer_id, placement_id) quiet mid-batch).
    const swap = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        placements: [
          { public_id: a?.public_id, placement_id: "pl-b", is_default: false },
          { public_id: b?.public_id, placement_id: "pl-a", is_default: true },
        ],
      }),
      env,
    );
    expect(swap.status).toBe(200);
    const swapped = sdb
      .prepare("SELECT public_id, placement_id FROM leadgen_offer_placements WHERE offer_id = ? ORDER BY id")
      .all(offer.id) as Array<{ public_id: string; placement_id: string }>;
    expect(swapped.find((r) => r.public_id === a?.public_id)?.placement_id).toBe("pl-b");
    expect(swapped.find((r) => r.public_id === b?.public_id)?.placement_id).toBe("pl-a");
  });

  it("rejects zero defaults, two defaults, an empty set, and duplicate placement_id (typed)", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, { placements: ["pl-1"] });
    const keep = offer.placements[0];

    const zero = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", { placements: [{ public_id: keep?.public_id, placement_id: "pl-1", is_default: false }] }),
      env,
    );
    expect(zero.status).toBe(400);
    expect(((await zero.json()) as { fields: Record<string, string> }).fields["placements"]).toContain(
      "exactly one placement must be the default",
    );

    const two = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        placements: [
          { public_id: keep?.public_id, placement_id: "pl-1", is_default: true },
          { placement_id: "pl-2", is_default: true },
        ],
      }),
      env,
    );
    expect(two.status).toBe(400);
    expect(((await two.json()) as { fields: Record<string, string> }).fields["placements"]).toContain(
      "exactly one placement must be the default",
    );

    // ≥1 placement (§10.1) — an empty replace-set is refused, never applied.
    const empty = await admin.request(`${API}/offers/${offer.id}`, jsonInit("PATCH", { placements: [] }), env);
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { fields: Record<string, string> }).fields["placements"]).toContain(
      "at least one placement",
    );

    // duplicate placement_id in the set — the UNIQUE(offer_id, placement_id)
    // violation surfaces as a typed field error at validation, not a 500.
    const dup = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        placements: [
          { public_id: keep?.public_id, placement_id: "pl-1", is_default: true },
          { placement_id: "pl-1", is_default: false },
        ],
      }),
      env,
    );
    expect(dup.status).toBe(400);
    expect(((await dup.json()) as { fields: Record<string, string> }).fields["placements[1].placement_id"]).toContain(
      "duplicate placement_id",
    );
  });

  it("rejects a foreign/unknown lgpl_ public_id and a malformed one", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env, { placements: ["pl-1"] });
    const other = await createOffer(env, { offer_name: "Other", placements: ["pl-x"] });

    // another offer's placement id is NOT this offer's row
    const foreign = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        placements: [{ public_id: other.placements[0]?.public_id, placement_id: "pl-1", is_default: true }],
      }),
      env,
    );
    expect(foreign.status).toBe(400);
    expect(((await foreign.json()) as { fields: Record<string, string> }).fields["placements[0].public_id"]).toContain(
      "unknown placement",
    );

    // a non-lgpl public id is malformed for this collection
    const malformed = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        placements: [{ public_id: mintPublicId("offer"), placement_id: "pl-1", is_default: true }],
      }),
      env,
    );
    expect(malformed.status).toBe(400);
    expect(
      ((await malformed.json()) as { fields: Record<string, string> }).fields["placements[0].public_id"],
    ).toContain("lgpl_");
  });

  it("refuses removing a placement referenced by leadgen_auction_offers (typed guard)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env, { placements: ["pl-auction", "pl-free"] });
    const [inAuction, free] = offer.placements;

    // an Auction joins the offer THROUGH the concrete default placement row
    sdb
      .prepare("INSERT INTO leadgen_auctions (public_id, auction_name, auction_type) VALUES (?, 'Main', 'dynamic')")
      .run(mintPublicId("auction"));
    const auctionId = (sdb.prepare("SELECT id FROM leadgen_auctions LIMIT 1").get() as { id: number }).id;
    sdb
      .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id) VALUES (?, ?, ?)")
      .run(auctionId, inAuction?.id, offer.id);

    // dropping the participating placement is refused with a typed error
    const blocked = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        placements: [{ public_id: free?.public_id, placement_id: "pl-free", is_default: true }],
      }),
      env,
    );
    expect(blocked.status).toBe(400);
    const fields = ((await blocked.json()) as { fields: Record<string, string> }).fields;
    expect(fields["placements"]).toContain("pl-auction");
    expect(fields["placements"]).toContain("participates in an auction");

    // ...and the rows are untouched (the batch never ran)
    const count = (
      sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_offer_placements WHERE offer_id = ?").get(offer.id) as {
        n: number;
      }
    ).n;
    expect(count).toBe(2);

    // keeping the participating row (still allowed to edit its label) passes
    const kept = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        placements: [
          { public_id: inAuction?.public_id, placement_id: "pl-auction", label: "Live", is_default: true },
          { public_id: free?.public_id, placement_id: "pl-free", is_default: false },
        ],
      }),
      env,
    );
    expect(kept.status).toBe(200);
    const body = (await kept.json()) as OfferDetail;
    expect(body.placements.find((p) => p.public_id === inAuction?.public_id)?.label).toBe("Live");
  });
});

// --- DELETE = archive ----------------------------------------------------------------

describeDb("DELETE /offers/:id — archive semantics (03 §9.6)", () => {
  it("flips status to archived, never hard-deletes; archived offers stay filterable", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    const res = await admin.request(`${API}/offers/${offer.public_id}`, { method: "DELETE" }, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: offer.id, public_id: offer.public_id, status: "archived" });

    // the ROW SURVIVES (status flip, not a hard delete)
    const row = sdb.prepare("SELECT status FROM leadgen_offers WHERE id = ?").get(offer.id) as { status: string };
    expect(row.status).toBe("archived");

    // still readable + filterable
    const read = await admin.request(`${API}/offers/${offer.id}`, {}, env);
    expect(read.status).toBe(200);
    const listed = await admin.request(`${API}/offers?status=archived`, {}, env);
    const body = (await listed.json()) as { items: Array<{ id: number }>; paging: Paging };
    expect(body.items.map((i) => i.id)).toContain(offer.id);
  });
});

// --- usage ------------------------------------------------------------------------------

describeDb("GET /offers/:id/usage — sections + auctions joins", () => {
  it("returns the Sections mapping to it and the Auctions it participates in", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);

    // a Section that maps this offer (leadgen_section_available_offers)
    sdb
      .prepare(
        "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, 'Home Q', 'quote_funnel', 'life', 'H', '{}')",
      )
      .run(mintPublicId("section"));
    const sectionId = (sdb.prepare("SELECT id FROM leadgen_sections LIMIT 1").get() as { id: number }).id;
    sdb
      .prepare(
        "INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected, mapping_state) VALUES (?, ?, 1, 'complete')",
      )
      .run(sectionId, offer.id);

    // an Auction joined through the offer's CONCRETE default placement
    sdb
      .prepare(
        "INSERT INTO leadgen_auctions (public_id, auction_name, auction_type) VALUES (?, 'Main Auction', 'dynamic')",
      )
      .run(mintPublicId("auction"));
    const auctionId = (sdb.prepare("SELECT id FROM leadgen_auctions LIMIT 1").get() as { id: number }).id;
    const placementRowId = (
      sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE offer_id = ? AND is_default = 1").get(offer.id) as {
        id: number;
      }
    ).id;
    sdb
      .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id) VALUES (?, ?, ?)")
      .run(auctionId, placementRowId, offer.id);

    // v2.4 §7.4: the usage response is the full reference-KIND inventory.
    const res = await admin.request(`${API}/offers/${offer.id}/usage`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usage: {
        kinds: Array<{ kind: string; count: number; items: Array<{ name: string }> }>;
        delete_eligibility: { eligible: boolean; blocking_kinds: string[] };
      };
    };
    const kind = (k: string): { count: number; items: Array<{ name: string }> } | undefined =>
      body.usage.kinds.find((x) => x.kind === k);
    expect(kind("sections_available")?.count).toBe(1);
    expect(kind("sections_available")?.items[0]?.name).toBe("Home Q");
    expect(kind("auctions_participating")?.count).toBe(1);
    expect(kind("auctions_participating")?.items[0]?.name).toBe("Main Auction");
    // referenced by a Section + an Auction → NOT deletable, both kinds blocking.
    expect(body.usage.delete_eligibility.eligible).toBe(false);
    expect(body.usage.delete_eligibility.blocking_kinds).toEqual(
      expect.arrayContaining(["sections_available", "auctions_participating"]),
    );
  });

  it("an unused offer references nothing and is delete-eligible", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const res = await admin.request(`${API}/offers/${offer.id}/usage`, {}, env);
    const body = (await res.json()) as {
      usage: { kinds: Array<{ count: number }>; delete_eligibility: { eligible: boolean } };
    };
    expect(body.usage.kinds.every((k) => k.count === 0)).toBe(true);
    expect(body.usage.delete_eligibility.eligible).toBe(true);
  });
});

// --- builder_context.linked_fields (§8.5 flatten — Phase-4 audit FINDING 2) --------------

// readLinkedSectionFields feeds the §6.2 Section-field picker, the condition
// `when` source list, and the sample-answer enum metadata. It MUST walk the
// canonical flattenComponents projection so a question nested inside a §8.5
// layout container still surfaces. Exercised end-to-end through GET /offers/:id
// → builder_context.linked_fields (the real producer→projection→response path).
describeDb("GET /offers/:id builder_context.linked_fields — §8.5 nested questions", () => {
  interface LinkedField {
    internal_field: string;
    answer_type: string;
    choice_count: number;
    section_public_id: string;
  }

  function seedSectionLinked(sdb: SqliteDb, offerId: number, name: string, components: unknown[]): void {
    const publicId = mintPublicId("section");
    sdb
      .prepare(
        "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, ?, 'quote_funnel', 'life', 'H', ?)",
      )
      .run(publicId, name, JSON.stringify({ components }));
    const sectionId = (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number })
      .id;
    sdb
      .prepare(
        "INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected, mapping_state) VALUES (?, ?, 1, 'complete')",
      )
      .run(sectionId, offerId);
  }

  async function linkedFields(env: Env, offerId: number): Promise<LinkedField[]> {
    const res = await admin.request(`${API}/offers/${offerId}`, {}, env);
    expect(res.status, `GET offer: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { builder_context: { linked_fields: LinkedField[] } };
    return body.builder_context.linked_fields;
  }

  it("a question NESTED inside a layout container surfaces in linked_fields (pre-fix: dropped)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    // a flat top-level sibling + a question nested one level inside a Stack.
    seedSectionLinked(sdb, offer.id, "Nested Sec", [
      { type: "FreeTextQuestion", question_id: "q_flat", internal_field: "flat_top", answer_type: "string" },
      {
        type: "Stack",
        question_id: "c_stack",
        props: { direction: "vertical" },
        children: [
          { type: "FreeTextQuestion", question_id: "q_deep", internal_field: "nested_in_stack", answer_type: "string" },
        ],
      },
    ]);
    const names = (await linkedFields(env, offer.id)).map((f) => f.internal_field);
    // the nested field IS present (pre-fix it was absent — the top-level-only
    // walk never descended into the Stack) AND the flatten is depth-first.
    expect(names, "nested field must surface").toContain("nested_in_stack");
    expect(names).toEqual(["flat_top", "nested_in_stack"]);
  });

  it("a DEEPLY nested question (CardPanel ⊃ Stack ⊃ question) surfaces with its enum metadata", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    seedSectionLinked(sdb, offer.id, "Deep Sec", [
      {
        type: "CardPanel",
        question_id: "c_card",
        props: {},
        children: [
          {
            type: "Stack",
            question_id: "c_stack",
            props: {},
            children: [
              {
                type: "DropdownQuestion",
                question_id: "q_deep",
                internal_field: "deep_choice",
                answer_type: "enum",
                choices: [
                  { value: "a", label: "A" },
                  { value: "b", label: "B" },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const fields = await linkedFields(env, offer.id);
    expect(fields.map((f) => f.internal_field)).toEqual(["deep_choice"]);
    expect(fields[0]!.answer_type).toBe("enum");
    expect(fields[0]!.choice_count).toBe(2);
  });

  it("a FLAT Section's projection is unchanged — same fields, same order, same metadata", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    seedSectionLinked(sdb, offer.id, "Flat Sec", [
      { type: "FreeTextQuestion", question_id: "q_a", internal_field: "field_a", answer_type: "string" },
      {
        type: "DropdownQuestion",
        question_id: "q_b",
        internal_field: "field_b",
        answer_type: "enum",
        choices: [{ value: "x", label: "X" }],
      },
    ]);
    const fields = await linkedFields(env, offer.id);
    expect(fields.map((f) => f.internal_field)).toEqual(["field_a", "field_b"]);
    expect(fields.map((f) => f.answer_type)).toEqual(["string", "enum"]);
    expect(fields.map((f) => f.choice_count)).toEqual([0, 1]);
  });

  // --- R2 P5 F8 (SRC-6B) — multi-field components offer their SUB-FIELDS ----
  //
  // Owner A.1 #6 (verbatim): "Also, be aware that every component that include
  // more than one field- each field is potentially answering another offer
  // field in different formats per offer!!!" Contract §5.6 requires that
  // mapping to be authorable through the payload builder's UI, never raw JSON
  // — so the §6.2 Section-field picker MUST offer the sub-field the visitor
  // actually records ({base}_zip), not just the component's base key.
  //
  // Expectations below are LITERAL names (never re-derived from the source
  // function), asserted through the real GET /offers/:id projection.

  const ADDR_NODE = (props: Record<string, unknown>): Record<string, unknown> => ({
    type: "AddressAutocompleteQuestion",
    question_id: "q_addr",
    internal_field: "addr",
    props,
  });

  it("SRC-6B: an unconfigured (4-field) Address projects its SUB-FIELD keys, not the base", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    seedSectionLinked(sdb, offer.id, "Addr Sec", [
      { type: "FreeTextQuestion", question_id: "q_a", internal_field: "field_a", answer_type: "string" },
      ADDR_NODE({}),
    ]);
    const fields = await linkedFields(env, offer.id);
    expect(fields.map((f) => f.internal_field)).toEqual([
      "field_a",
      "addr_street",
      "addr_city",
      "addr_state",
      "addr_zip",
    ]);
    // the BASE key is absent — fieldsOf never projects it, so no Offer may be
    // pointed at a field the visitor will never record.
    expect(fields.map((f) => f.internal_field)).not.toContain("addr");
    // each sub-field carries its OWN metadata: a text input (string), no enum
    // domain — not the parent component's catalog "object".
    const subs = fields.filter((f) => f.internal_field.startsWith("addr_"));
    expect(subs.map((f) => f.answer_type)).toEqual(["string", "string", "string", "string"]);
    expect(subs.map((f) => f.choice_count)).toEqual([0, 0, 0, 0]);
  });

  it("SRC-6B: an authored maps.fills rename is offered under the RENAMED name", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    seedSectionLinked(sdb, offer.id, "Addr Renamed", [
      ADDR_NODE({ maps: { enabled: true, fills: { zip: "postal_code_x" } } }),
    ]);
    const names = (await linkedFields(env, offer.id)).map((f) => f.internal_field);
    expect(names).toEqual(["addr_street", "addr_city", "addr_state", "postal_code_x"]);
    expect(names).not.toContain("addr_zip");
  });

  it("SRC-6B: a full_address-alone Address still projects ONE entry under the base key", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    seedSectionLinked(sdb, offer.id, "Addr Free Text", [
      ADDR_NODE({ fields: [{ field: "full_address", label: "Your address", mode: "autofill" }] }),
    ]);
    const fields = await linkedFields(env, offer.id);
    expect(fields.map((f) => f.internal_field)).toEqual(["addr"]);
    // R2 P5 F9 — the DERIVATION's type, not the catalog's. fieldsOf types this
    // key "string" (a lone full_address is ONE text input, and the value the
    // visitor posts is a string that normalizeAnswerValue would REJECT as an
    // "object"); the picker must say the same thing the answer space does.
    expect(fields[0]!.answer_type).toBe("string");
    expect(fields[0]!.choice_count).toBe(0);
  });

  it("SRC-6B: a street-only Address projects ONE entry, named for the key it records", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    seedSectionLinked(sdb, offer.id, "Addr Street Only", [
      ADDR_NODE({ fields: [{ field: "street", label: "Street", mode: "manual" }] }),
    ]);
    const fields = await linkedFields(env, offer.id);
    expect(fields.map((f) => f.internal_field)).toEqual(["addr_street"]);
    expect(fields[0]!.answer_type).toBe("string");
  });

  it("SRC-6B: a non-address multi-entry Section keeps its exact projection (no address expansion leaks)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    seedSectionLinked(sdb, offer.id, "No Addr", [
      { type: "ZIPInputQuestion", question_id: "q_z", internal_field: "zip_only", answer_type: "string" },
      {
        type: "NumberRangeQuestion",
        question_id: "q_n",
        internal_field: "coverage",
        answer_type: "number",
        props: { slider_type: "stepper" },
      },
    ]);
    const fields = await linkedFields(env, offer.id);
    expect(fields.map((f) => f.internal_field)).toEqual(["zip_only", "coverage"]);
    expect(fields.map((f) => f.answer_type)).toEqual(["string", "number"]);
  });

  // --- R2 P5 F9 (SRC-6B) — EVERY component, from the ONE derivation --------
  //
  // Owner A.1 #6 says "every component that include more than one field", not
  // "the address". F8 expanded the Address by name; the picker now projects
  // answers.ts `fieldsOf` for EVERY node, so it offers exactly the keys the
  // visitor will record whatever the component is. Every expectation below is
  // a LITERAL key/type asserted through the real GET /offers/:id projection.

  const SLIDER = (sliderType: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    type: "NumberRangeQuestion",
    question_id: `q_${sliderType}`,
    internal_field: "loan",
    props: { min: 10_000, max: 500_000, step: 5_000, slider_type: sliderType, ...extra },
  });

  it("SRC-6B: a from_to slider projects loan_min + loan_max as NUMBERS, never the base", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    seedSectionLinked(sdb, offer.id, "FromTo Sec", [
      { type: "FreeTextQuestion", question_id: "q_a", internal_field: "field_a", answer_type: "string" },
      // the §6.8 authored shape: a from_to slider legitimately declares
      // answer_type "object" (content-schema's dual-slider carve-out) — the
      // picker must NOT hand that type to the sub-fields.
      { ...SLIDER("from_to"), answer_type: "object" },
    ]);
    const fields = await linkedFields(env, offer.id);
    expect(fields.map((f) => f.internal_field)).toEqual(["field_a", "loan_min", "loan_max"]);
    expect(fields.map((f) => f.internal_field)).not.toContain("loan");
    const subs = fields.filter((f) => f.internal_field.startsWith("loan_"));
    expect(subs.map((f) => f.answer_type)).toEqual(["number", "number"]);
    expect(subs.map((f) => f.choice_count)).toEqual([0, 0]);
  });

  it("SRC-6B: a dual_range slider projects the SAME two number sub-fields", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    seedSectionLinked(sdb, offer.id, "DualRange Sec", [{ ...SLIDER("dual_range"), answer_type: "object" }]);
    const fields = await linkedFields(env, offer.id);
    expect(fields.map((f) => f.internal_field)).toEqual(["loan_min", "loan_max"]);
    // the node's own authored answer_type ("object", the §6.8 carve-out) never
    // reaches the sub-fields — each one is a number.
    expect(fields.map((f) => f.answer_type)).toEqual(["number", "number"]);
  });

  it("SRC-6B: single / stepper / radial sliders still project the SCALAR base", async () => {
    for (const sliderType of ["single", "stepper", "radial"] as const) {
      const { sdb, env } = newHarness();
      const offer = await createOffer(env);
      seedSectionLinked(sdb, offer.id, `${sliderType} Sec`, [SLIDER(sliderType)]);
      const fields = await linkedFields(env, offer.id);
      expect(fields.map((f) => f.internal_field), sliderType).toEqual(["loan"]);
      expect(fields[0]!.answer_type, sliderType).toBe("number");
      // the scalar entry keeps the node's own props (the sample-answer
      // generator reads props.min) — unchanged by this fix.
      expect(fields[0]!.internal_field, sliderType).toBe("loan");
    }
  });

  it("SRC-6B: a NameFieldsGroup projects the sub-fields it records (it carries no internal_field at all)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    seedSectionLinked(sdb, offer.id, "Name Sec", [
      { type: "NameFieldsGroup", question_id: "q_name", props: { fields: ["given", "family"] } },
      { type: "FreeTextQuestion", question_id: "q_b", internal_field: "field_b", answer_type: "string" },
    ]);
    const fields = await linkedFields(env, offer.id);
    // pre-fix the whole component was SKIPPED (no internal_field ⇒ `continue`),
    // so neither name key could be picked in the §6.2 picker.
    expect(fields.map((f) => f.internal_field)).toEqual(["given", "family", "field_b"]);
    expect(fields.slice(0, 2).map((f) => f.answer_type)).toEqual(["string", "string"]);
    expect(fields.slice(0, 2).map((f) => f.choice_count)).toEqual([0, 0]);
  });

  it("SRC-6B: a NON-PRODUCING node that references a question's field contributes NOTHING", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    seedSectionLinked(sdb, offer.id, "NonProducing Sec", [
      { type: "FreeTextQuestion", question_id: "q_a", internal_field: "field_a", answer_type: "string" },
      // a ValidationError CARRIES the field it decorates (its error-slot
      // binding) but never CLAIMS an answer name — catalog produces === null,
      // so fieldsOf gives it no field and the picker must not offer one.
      { type: "ValidationError", question_id: "q_err", internal_field: "err_only" },
      { type: "HelperText", question_id: "q_help", internal_field: "help_only", props: { text: "hi" } },
    ]);
    const fields = await linkedFields(env, offer.id);
    expect(fields.map((f) => f.internal_field)).toEqual(["field_a"]);
  });
});

// --- analytics ---------------------------------------------------------------------------

describeDb("GET /offers/:id/analytics — §10.7 NULLIF-guarded ratios", () => {
  it("zero rows → zero counts and NULL ratios (never fake 0 ratios)", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const res = await admin.request(`${API}/offers/${offer.id}/analytics`, {}, env);
    expect(res.status).toBe(200);
    const { analytics } = (await res.json()) as { analytics: Record<string, unknown> };
    expect(analytics["offer_impressions"]).toBe(0);
    expect(analytics["clicks"]).toBe(0);
    expect(analytics["revenue"]).toBe(0);
    expect(analytics["ctr"]).toBeNull();
    expect(analytics["cvr"]).toBeNull();
    expect(analytics["rpc"]).toBeNull();
    expect(analytics["rpm"]).toBeNull();
  });

  it("computes the exact §10.7 formulas over the ranged mirror sum", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    const seed = sdb.prepare(
      "INSERT INTO leadgen_analytics_offer (offer_public_id, date, offer_impressions, clicks, unique_clicks, conversions, revenue) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    seed.run(offer.public_id, "2026-07-01", 100, 30, 20, 3, 60);
    seed.run(offer.public_id, "2026-07-02", 100, 20, 10, 2, 40);
    seed.run(offer.public_id, "2026-06-01", 999, 999, 999, 999, 999); // outside range

    const res = await admin.request(`${API}/offers/${offer.id}/analytics?from=2026-07-01&to=2026-07-31`, {}, env);
    const { analytics } = (await res.json()) as { analytics: Record<string, number> };
    expect(analytics["offer_impressions"]).toBe(200);
    expect(analytics["clicks"]).toBe(50);
    expect(analytics["unique_clicks"]).toBe(30);
    expect(analytics["conversions"]).toBe(5);
    expect(analytics["revenue"]).toBe(100);
    expect(analytics["ctr"]).toBeCloseTo(0.25, 10); // clicks / offer_impressions
    expect(analytics["cvr"]).toBeCloseTo(0.1, 10); // conversions / clicks
    expect(analytics["rpc"]).toBeCloseTo(2, 10); // revenue / clicks
    expect(analytics["rpm"]).toBeCloseTo(500, 10); // revenue / offer_impressions * 1000
  });

  it("rejects malformed date params", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const res = await admin.request(`${API}/offers/${offer.id}/analytics?from=07-01-2026`, {}, env);
    expect(res.status).toBe(400);
  });
});

// --- cap status --------------------------------------------------------------------------

describeDb("GET /offers/:id/cap — §10.6 near-real-time status", () => {
  it("reads the current-period counter and computes exceeded", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env, { cap_enabled: true });
    await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", { cap_amount: 5, cap_timezone: "UTC", cap_count_by: "clicks" }),
      env,
    );
    const capDate = capPeriodKey("UTC", new Date());
    sdb
      .prepare(
        "INSERT INTO leadgen_offer_cap_counters (offer_id, cap_date, timezone, click_count, conversion_count) VALUES (?, ?, 'UTC', 5, 1)",
      )
      .run(offer.id, capDate);

    const res = await admin.request(`${API}/offers/${offer.id}/cap`, {}, env);
    expect(res.status).toBe(200);
    const { cap } = (await res.json()) as { cap: Record<string, unknown> };
    expect(cap["cap_enabled"]).toBe(true);
    expect(cap["cap_amount"]).toBe(5);
    expect(cap["cap_date"]).toBe(capDate);
    expect(cap["click_count"]).toBe(5);
    expect(cap["conversion_count"]).toBe(1);
    expect(cap["exceeded"]).toBe(true);
  });

  it("returns zeros + exceeded=false when no counter row exists", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const res = await admin.request(`${API}/offers/${offer.id}/cap`, {}, env);
    const { cap } = (await res.json()) as { cap: Record<string, unknown> };
    expect(cap["click_count"]).toBe(0);
    expect(cap["conversion_count"]).toBe(0);
    expect(cap["exceeded"]).toBe(false);
  });
});

// --- builder_context.active_schema field_label (v2.5 12 §12.5) ---------------------------

// ADDITIVE `field_label` on every projected schema node — the authored schema
// label wins; absent one, the humanized leaf segment. Derived at projection
// time (offerBuilderContext); the STORED schema_json is untouched.
describeDb("GET /offers/:id builder_context.active_schema — §12.5 additive field_label", () => {
  it("every node carries field_label (authored label > humanized leaf); the stored schema bytes gain nothing", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    const schemaRes = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", {
        schema_json: {
          version: 1,
          root: {
            type: "object",
            children: [
              { path: "data.home_own", name: "home_own", type: "boolean", required: true, source: "answer", internal_field: "homeowner", label: "Owns their home?" },
              { path: "data.loan_amount", name: "loan_amount", type: "number", source: "answer", internal_field: "loan_amount" },
              { path: "meta.click_id", name: "click_id", type: "string", source: "macro", macro: "click_id" },
            ],
          },
        },
      }),
      env,
    );
    expect(schemaRes.status, await schemaRes.clone().text()).toBe(201);

    const res = await admin.request(`${API}/offers/${offer.id}`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      builder_context: { active_schema: { nodes: Array<Record<string, unknown>> } };
    };
    const nodes = body.builder_context.active_schema.nodes;
    expect(nodes.map((n) => [n["path"], n["field_label"]])).toEqual([
      ["data.home_own", "Owns their home?"],
      ["data.loan_amount", "Loan amount"],
      ["meta.click_id", "Click id"],
    ]);
    // derived only — the stored schema_json rows carry NO field_label bytes
    const stored = sdb
      .prepare("SELECT schema_json FROM leadgen_offer_payload_schemas WHERE offer_id = ?")
      .all(offer.id) as Array<{ schema_json: string }>;
    expect(stored.length).toBeGreaterThan(0);
    for (const row of stored) expect(row.schema_json).not.toContain("field_label");
  });
});

// --- payload schemas -----------------------------------------------------------------------

const VALID_SCHEMA = {
  version: 1,
  root: {
    type: "object",
    children: [
      {
        path: "data.home_own",
        name: "home_own",
        type: "boolean",
        required: true,
        source: "answer",
        internal_field: "homeowner",
        value_map: { true: true, false: false },
      },
      { path: "meta.click_id", name: "click_id", type: "string", source: "macro", macro: "click_id" },
    ],
  },
};

describeDb("payload-schemas — §11.8 immutable versioning + active pointer", () => {
  it("creates v1 then v2; the active pointer moves; v1 stays byte-identical", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);

    // v1 — client sends version 7; the server allocates the REAL sequence (1)
    const res1 = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", { schema_json: { ...VALID_SCHEMA, version: 7 } }),
      env,
    );
    expect(res1.status).toBe(201);
    const v1 = (await res1.json()) as { id: number; public_id: string; version: number; source: string; schema_json: { version: number } };
    expect(v1.version).toBe(1);
    expect(v1.source).toBe("manual");
    expect(isPublicId("payload_schema_version", v1.public_id)).toBe(true);
    expect(v1.schema_json.version).toBe(1); // rewritten to the allocated sequence

    const activeAfterV1 = sdb.prepare("SELECT active_payload_schema_id FROM leadgen_offers WHERE id = ?").get(offer.id) as {
      active_payload_schema_id: number;
    };
    expect(activeAfterV1.active_payload_schema_id).toBe(v1.id);

    const v1BytesBefore = (
      sdb.prepare("SELECT schema_json FROM leadgen_offer_payload_schemas WHERE id = ?").get(v1.id) as {
        schema_json: string;
      }
    ).schema_json;

    // v2 with a carrier parser
    const res2 = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", {
        schema_json: VALID_SCHEMA,
        carrier_parse_json: { carriers_path: "carriers", fields: { carrier_name: "name", bid: "bid" } },
      }),
      env,
    );
    expect(res2.status).toBe(201);
    const v2 = (await res2.json()) as { id: number; version: number };
    expect(v2.version).toBe(2);

    const activeAfterV2 = sdb.prepare("SELECT active_payload_schema_id FROM leadgen_offers WHERE id = ?").get(offer.id) as {
      active_payload_schema_id: number;
    };
    expect(activeAfterV2.active_payload_schema_id).toBe(v2.id);

    // §11.8 IMMUTABILITY: creating v2 left the v1 row byte-identical.
    const v1BytesAfter = (
      sdb.prepare("SELECT schema_json FROM leadgen_offer_payload_schemas WHERE id = ?").get(v1.id) as {
        schema_json: string;
      }
    ).schema_json;
    expect(v1BytesAfter).toBe(v1BytesBefore);

    // list returns versions DESC
    const list = await admin.request(`${API}/offers/${offer.id}/payload-schemas`, {}, env);
    const items = ((await list.json()) as { items: Array<{ version: number }> }).items;
    expect(items.map((i) => i.version)).toEqual([2, 1]);
  });

  it("rejects an invalid schema with the typed §11.5 error list", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const res = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", {
        schema_json: {
          version: 1,
          root: {
            type: "object",
            children: [
              { path: "a.b", name: "b", type: "string", source: "static", value: "x" },
              { path: "a.b", name: "b", type: "string", source: "static", value: "y" }, // duplicate path
            ],
          },
        },
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string>; schema_errors: Array<{ code: string }> };
    expect(body.fields["schema_json"]).toBeTruthy();
    expect(body.schema_errors.some((e) => e.code === "path_duplicate")).toBe(true);
  });

  it("rejects a carrier_parse_json without a fields map", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const res = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", { schema_json: VALID_SCHEMA, carrier_parse_json: { carriers_path: "c" } }),
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields["carrier_parse_json"]).toBeTruthy();
  });

  it("persists carrier_parse_json byte-identical on the new version (§11.6 — the parser versions WITH the schema)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    // The full §11.7 authored shape incl. a first-wins fallback ARRAY.
    const parseConfig = {
      carriers_path: "data.carriers",
      fields: {
        provider_id: "id",
        carrier_name: ["display_name", "name"],
        carrier_logo: "logo",
        bid: ["price.amount", "bid"],
        bid_currency: "price.currency",
        click_url: "url",
        tracking_id: "tid",
        headline: "headline",
        subheadline: "sub",
        disclaimer: "legal",
        pricing_model: "model",
      },
    };
    const res = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", { schema_json: VALID_SCHEMA, carrier_parse_json: parseConfig }),
      env,
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: number; version: number; carrier_parse_json: unknown };
    // API echo: the parsed config round-trips structurally...
    expect(created.carrier_parse_json).toEqual(parseConfig);
    // ...and the STORED column is byte-identical to the authored JSON —
    // §7.1: carrier_parse_json is a column on the schema-version row.
    const row = sdb
      .prepare("SELECT carrier_parse_json, carrier_parse_version FROM leadgen_offer_payload_schemas WHERE id = ?")
      .get(created.id) as { carrier_parse_json: string; carrier_parse_version: number };
    expect(row.carrier_parse_json).toBe(JSON.stringify(parseConfig));
    expect(row.carrier_parse_version).toBe(1);
    // the new version became the active pointer (§11.8)
    const active = sdb.prepare("SELECT active_payload_schema_id FROM leadgen_offers WHERE id = ?").get(offer.id) as {
      active_payload_schema_id: number;
    };
    expect(active.active_payload_schema_id).toBe(created.id);
  });
});

// --- R2 P5 F10 (defect 1): a schema-only save must NOT destroy the parser ---------------------
//
// Owner A.1 #7B (verbatim): "the currency is only a graphic feature, I can
// define that I want the currency will be passed to the offer in the auction
// and I can define that only the number is sent, and I can define that the
// number will be sent as string". The operator's path to "define" that is the
// Offers Payload Builder — and SAVING is part of that path. Before this fix the
// builder's own "Save schema version" button (which POSTs `{schema_json}` with
// NO carrier_parse_json key) wrote NULL into the new ACTIVE version, so
// validation.ts pushed `carrier_parse_missing` and the R5 activation gate 409'd
// with "Response parsing (carrier parse) is not configured".
//
// Wire contract proven here, all through the REAL endpoints:
//   key ABSENT          → carry forward carrier_parse_json + carrier_parse_version
//   "carrier_parse_json": null → explicit clear
//   an object           → explicit replace

const F10_PARSE_CONFIG = {
  carriers_path: "data.carriers",
  fields: { carrier_name: "name", bid: "price.amount", click_url: "url" },
};

// Drive an offer to a state where the ONLY thing standing between it and
// §5.1 eligibility is the carrier parse: valid active schema + production
// endpoint + a PASSED provider test (auction_instance_id IS NULL — the
// LEADGEN_TEST_STATUS_SUBSELECT discipline).
async function f10ReadyOffer(
  sdb: SqliteDb,
  env: Env,
): Promise<OfferDetail> {
  const offer = await createOffer(env);
  const patched = await admin.request(
    `${API}/offers/${offer.id}`,
    jsonInit("PATCH", { endpoint_production: "https://provider.example.com/quotes" }),
    env,
  );
  expect(patched.status, await patched.clone().text()).toBe(200);
  sdb
    .prepare(
      "INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'production', 200)",
    )
    .run(offer.public_id);
  // v1 WITH the parser — the operator's "define the currency handling" save.
  const res = await admin.request(
    `${API}/offers/${offer.id}/payload-schemas`,
    jsonInit("POST", { schema_json: VALID_SCHEMA, carrier_parse_json: F10_PARSE_CONFIG }),
    env,
  );
  expect(res.status, await res.clone().text()).toBe(201);
  return offer;
}

function activeSchemaRow(sdb: SqliteDb, offerId: number): {
  id: number;
  version: number;
  carrier_parse_json: string | null;
  carrier_parse_version: number;
} {
  return sdb
    .prepare(
      `SELECT s.id, s.version, s.carrier_parse_json, s.carrier_parse_version
         FROM leadgen_offers o JOIN leadgen_offer_payload_schemas s ON s.id = o.active_payload_schema_id
        WHERE o.id = ?`,
    )
    .get(offerId) as { id: number; version: number; carrier_parse_json: string | null; carrier_parse_version: number };
}

async function offerEligibility(env: Env, offerId: number | string): Promise<{ eligible: boolean; reasons: string[] }> {
  const res = await admin.request(`${API}/offers/${offerId}`, {}, env);
  expect(res.status).toBe(200);
  return ((await res.json()) as { eligibility: { eligible: boolean; reasons: string[] } }).eligibility;
}

describeDb("payload-schemas — R2 P5 F10: an omitted carrier_parse_json CARRIES FORWARD", () => {
  it("a schema-only save keeps the parse config + version on the new ACTIVE version, and activation stops reporting carrier_parse_missing", async () => {
    const { sdb, env } = newHarness();
    const offer = await f10ReadyOffer(sdb, env);

    const v1 = activeSchemaRow(sdb, offer.id);
    expect(v1.version).toBe(1);
    expect(v1.carrier_parse_json).toBe(JSON.stringify(F10_PARSE_CONFIG));
    const beforeEligibility = await offerEligibility(env, offer.id);
    expect(beforeEligibility.reasons).toEqual([]);
    expect(beforeEligibility.eligible).toBe(true);

    // The builder's "Save schema version" wire, verbatim: schema_json ONLY.
    const res = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", { schema_json: VALID_SCHEMA }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const created = (await res.json()) as { id: number; version: number; carrier_parse_json: unknown };
    expect(created.version).toBe(2);
    // the API echo already carries the preserved config
    expect(created.carrier_parse_json).toEqual(F10_PARSE_CONFIG);

    // the ACTIVE pointer moved to the new version AND that version carries the
    // parse pair the predecessor had.
    const v2 = activeSchemaRow(sdb, offer.id);
    expect(v2.id).toBe(created.id);
    expect(v2.version).toBe(2);
    expect(v2.carrier_parse_json).toBe(JSON.stringify(F10_PARSE_CONFIG));
    expect(v2.carrier_parse_version).toBe(v1.carrier_parse_version);

    // §11.8 immutability: v1's own parse column is untouched.
    const v1After = sdb
      .prepare("SELECT carrier_parse_json FROM leadgen_offer_payload_schemas WHERE id = ?")
      .get(v1.id) as { carrier_parse_json: string | null };
    expect(v1After.carrier_parse_json).toBe(JSON.stringify(F10_PARSE_CONFIG));

    // the activation input (evaluateDynamicOffersEligibility — the SAME verdict
    // the R5 quote-activation preflight recomputes) is clean.
    const after = await offerEligibility(env, offer.id);
    expect(after.reasons).not.toContain("carrier_parse_missing");
    expect(after.reasons).toEqual([]);
    expect(after.eligible).toBe(true);
  });

  it("carries a NON-default carrier_parse_version forward (not a hardcoded 1)", async () => {
    const { sdb, env } = newHarness();
    const offer = await f10ReadyOffer(sdb, env);
    // The column is NOT NULL DEFAULT 1 but holds whatever a seed / clone chain
    // left behind — pin that the carry reads the predecessor, not a literal.
    sdb
      .prepare("UPDATE leadgen_offer_payload_schemas SET carrier_parse_version = 7 WHERE offer_id = ?")
      .run(offer.id);

    const res = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", { schema_json: VALID_SCHEMA }),
      env,
    );
    expect(res.status).toBe(201);
    const v2 = activeSchemaRow(sdb, offer.id);
    expect(v2.version).toBe(2);
    expect(v2.carrier_parse_version).toBe(7);
    expect(v2.carrier_parse_json).toBe(JSON.stringify(F10_PARSE_CONFIG));
  });

  it("an EXPLICIT null clears the parse config (and activation reports carrier_parse_missing again)", async () => {
    const { sdb, env } = newHarness();
    const offer = await f10ReadyOffer(sdb, env);

    const res = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", { schema_json: VALID_SCHEMA, carrier_parse_json: null }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const created = (await res.json()) as { id: number; version: number; carrier_parse_json: unknown };
    expect(created.version).toBe(2);
    expect(created.carrier_parse_json).toBeNull();

    const v2 = activeSchemaRow(sdb, offer.id);
    expect(v2.id).toBe(created.id);
    expect(v2.carrier_parse_json).toBeNull();
    expect(v2.carrier_parse_version).toBe(1);

    const after = await offerEligibility(env, offer.id);
    expect(after.reasons).toContain("carrier_parse_missing");
    expect(after.eligible).toBe(false);
  });

  it("an EXPLICIT object still REPLACES the carried config", async () => {
    const { sdb, env } = newHarness();
    const offer = await f10ReadyOffer(sdb, env);
    const replacement = { fields: { carrier_name: "carrier", bid: "cpc" } };
    const res = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", { schema_json: VALID_SCHEMA, carrier_parse_json: replacement }),
      env,
    );
    expect(res.status).toBe(201);
    const v2 = activeSchemaRow(sdb, offer.id);
    expect(v2.carrier_parse_json).toBe(JSON.stringify(replacement));
  });

  it("a FIRST-EVER schema (no active predecessor) still saves with no parse config", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    const before = sdb
      .prepare("SELECT active_payload_schema_id FROM leadgen_offers WHERE id = ?")
      .get(offer.id) as { active_payload_schema_id: number | null };
    expect(before.active_payload_schema_id).toBeNull();

    const res = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", { schema_json: VALID_SCHEMA }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const v1 = activeSchemaRow(sdb, offer.id);
    expect(v1.version).toBe(1);
    expect(v1.carrier_parse_json).toBeNull();
    expect(v1.carrier_parse_version).toBe(1);
    expect((await offerEligibility(env, offer.id)).reasons).toContain("carrier_parse_missing");
  });

  it("§11.2 from-example generation also carries the parse config forward", async () => {
    const { sdb, env } = newHarness();
    const offer = await f10ReadyOffer(sdb, env);
    const res = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas/from-example`,
      jsonInit("POST", { example: { quote: { zip: "10001" } } }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const v2 = activeSchemaRow(sdb, offer.id);
    expect(v2.version).toBe(2);
    expect(v2.carrier_parse_json).toBe(JSON.stringify(F10_PARSE_CONFIG));
    expect((await offerEligibility(env, offer.id)).reasons).not.toContain("carrier_parse_missing");
  });
});

// --- §6.1 last_test_at — the additive detail timestamp --------------------------------------

describeDb("offer detail last_test_at — §6.1 right-column chip source", () => {
  it("is null without any test run (create response + GET detail)", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    expect(offer["last_test_at"]).toBeNull();
    const res = await admin.request(`${API}/offers/${offer.id}`, {}, env);
    expect(res.status).toBe(200);
    const detail = (await res.json()) as { last_test_at: string | null };
    expect(detail.last_test_at).toBeNull();
  });

  it("returns MAX(created_at) of TEST-TOOL rows as an ISO string; runtime auction rows NEVER count", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    const t1 = 1_783_000_000;
    const t2 = 1_783_100_000; // newer TEST row (failed — status still counts for the timestamp)
    const t3 = 1_783_200_000; // newest of all — but an AUCTION row (auction_instance_id set)
    const seed = sdb.prepare(
      "INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code, auction_instance_id, created_at) VALUES (?, 'production', ?, ?, ?)",
    );
    seed.run(offer.public_id, 200, null, t1);
    seed.run(offer.public_id, 500, null, t2);
    seed.run(offer.public_id, 200, "lgai_runtime_row", t3);

    const res = await admin.request(`${API}/offers/${offer.id}`, {}, env);
    const detail = (await res.json()) as { last_test_at: string | null };
    // the auction_instance_id IS NULL discipline (mirrors last_test_status):
    // t3 is invisible; the newest TEST row wins.
    expect(detail.last_test_at).toBe(new Date(t2 * 1000).toISOString());
  });

  it("another offer's test rows never leak in (.bind-scoped by public_id)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env, { offer_name: "Mine", placements: ["lt-1"] });
    const other = await createOffer(env, { offer_name: "Other", placements: ["lt-2"] });
    sdb
      .prepare(
        "INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code, created_at) VALUES (?, 'production', 200, 1783000000)",
      )
      .run(other.public_id);
    const res = await admin.request(`${API}/offers/${offer.id}`, {}, env);
    expect(((await res.json()) as { last_test_at: string | null }).last_test_at).toBeNull();
  });
});

// --- §6.5/§6.9 additive node fields — storage passthrough (§6.14) ---------------------------

describeDb("payload-schemas — §6.5/§6.9 additive node fields persist verbatim (§6.14)", () => {
  it("free_text_* + computed default/fallback refs save (201, no warnings) and round-trip byte-faithfully", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    const schema = {
      version: 1,
      root: {
        type: "object",
        children: [
          {
            path: "first_name",
            name: "first_name",
            type: "string",
            source: "answer",
            internal_field: "first_name",
            free_text_max_length: 40,
            free_text_pattern: "letters",
            fallback: { source: "computed", key: "timezone" },
          },
          {
            path: "sent_at",
            name: "sent_at",
            type: "string",
            source: "answer",
            internal_field: "sent_at",
            default: { source: "computed", key: "today_date_utc" },
          },
        ],
      },
    };
    const res = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", { schema_json: schema }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(201);
    const created = (await res.json()) as {
      id: number;
      warnings: unknown[];
      schema_json: { root: { children: unknown[] } };
    };
    expect(created.warnings).toEqual([]);
    expect(created.schema_json.root.children).toEqual(schema.root.children);
    // §6.14: the STORED bytes carry the additive fields verbatim (existing
    // schemas without them are untouched — the fields are purely additive).
    const row = sdb
      .prepare("SELECT schema_json FROM leadgen_offer_payload_schemas WHERE id = ?")
      .get(created.id) as { schema_json: string };
    expect(JSON.parse(row.schema_json)).toEqual(schema);
  });

  it("a bad free-text config / unknown computed ref key REJECT the save with the typed blocking codes", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const bad = {
      version: 1,
      root: {
        type: "object",
        children: [
          {
            path: "a",
            name: "a",
            type: "string",
            source: "answer",
            internal_field: "a",
            free_text_max_length: 0,
          },
          {
            path: "b",
            name: "b",
            type: "string",
            source: "answer",
            internal_field: "b",
            default: { source: "computed", key: "ghost" },
          },
        ],
      },
    };
    const res = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", { schema_json: bad }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { schema_errors: Array<{ code: string; path?: string }> };
    const codes = body.schema_errors.map((e) => e.code);
    expect(codes).toContain("free_text_constraint_invalid");
    expect(codes).toContain("computed_unknown_key");
  });
});

describeDb("payload-schemas/from-example — §11.2 automatic generation", () => {
  it("infers a VALID editable schema, persists it as the next active version", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    const example = {
      quote: { email: "x@y.z", amount: 5, active: true },
      carriers: [{ name: "Acme" }],
    };
    const res = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas/from-example`,
      jsonInit("POST", { example }),
      env,
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: number;
      version: number;
      source: string;
      schema_json: { root: { children: Array<{ path: string; type: string }> } };
    };
    expect(created.version).toBe(1);
    expect(created.source).toBe("auto_from_example");
    const paths = created.schema_json.root.children.map((n) => n.path).sort();
    expect(paths).toEqual(["carriers.0.name", "quote.active", "quote.amount", "quote.email"]);

    // the persisted schema round-trips through the Stage-A validator
    const stored = sdb.prepare("SELECT schema_json FROM leadgen_offer_payload_schemas WHERE id = ?").get(created.id) as {
      schema_json: string;
    };
    expect(validatePayloadSchema(JSON.parse(stored.schema_json)).ok).toBe(true);

    // and it became the offer's active schema
    const active = sdb.prepare("SELECT active_payload_schema_id FROM leadgen_offers WHERE id = ?").get(offer.id) as {
      active_payload_schema_id: number;
    };
    expect(active.active_payload_schema_id).toBe(created.id);
  });

  it("accepts a pasted JSON STRING example and rejects a malformed one", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const ok = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas/from-example`,
      jsonInit("POST", { example: '{"a": {"b": 1}}' }),
      env,
    );
    expect(ok.status).toBe(201);
    const bad = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas/from-example`,
      jsonInit("POST", { example: "{not json" }),
      env,
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { fields: Record<string, string> }).fields["example"]).toBeTruthy();
  });
});

// --- Shared: /verticals + /activities (03 §8.2) ---------------------------------------------

describeDb("GET /verticals + /activities — 03 §8.2 Shared filter options", () => {
  it("unions DISTINCT non-empty values from offers ∪ sections ∪ quotes, deduped + sorted", async () => {
    const { sdb, env } = newHarness();
    // offers leg (through the real API) — 'life' also recurs in a quote below
    await createOffer(env, { offer_name: "V1", vertical: "life", activity: "quote_funnel", placements: ["sv-1"] });
    await createOffer(env, { offer_name: "V2", vertical: "auto", activity: "quote_funnel", placements: ["sv-2"] });
    // sections leg (direct insert — the sections POST ships in its own phase)
    sdb
      .prepare(
        "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, 'S', 'banner', 'home', 'H', '{}')",
      )
      .run(mintPublicId("section"));
    // quotes leg: activity is a scalar column; verticals are a JSON ARRAY
    // (§7.3 verticals_json) — the union must read THROUGH the array.
    sdb
      .prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'Q', 'quiz', ?)")
      .run(mintPublicId("quote"), JSON.stringify(["pet", "life"]));

    const v = await admin.request(`${API}/verticals`, {}, env);
    expect(v.status).toBe(200);
    // deduped ('life' appears in offers AND a quote array) + sorted
    expect(await v.json()).toEqual({ items: ["auto", "home", "life", "pet"] });

    const a = await admin.request(`${API}/activities`, {}, env);
    expect(a.status).toBe(200);
    expect(await a.json()).toEqual({ items: ["banner", "quiz", "quote_funnel"] });
  });

  it("returns { items: [] } on an empty DB and both paths carry no-store", async () => {
    const { env } = newHarness();
    for (const path of ["/verticals", "/activities"]) {
      const res = await admin.request(`${API}${path}`, {}, env);
      expect(res.status, `${path} status`).toBe(200);
      expect(await res.json()).toEqual({ items: [] });
      expect(res.headers.get("Cache-Control"), `${path} no-store`).toBe("private, no-store");
    }
  });

  // §8.2 (fix-contract v2.4 08, E1): the OPTIONAL ?activity= filter — each
  // UNION leg (offers / sections / quotes-json_each) filters by ITS OWN
  // activity column. Regression pins filtered-vs-global.
  it("GET /verticals?activity= filters every union leg; the bare path stays the global union", async () => {
    const { sdb, env } = newHarness();
    await createOffer(env, { offer_name: "VA1", vertical: "life", activity: "quote_funnel", placements: ["sva-1"] });
    await createOffer(env, { offer_name: "VA2", vertical: "boat", activity: "quiz", placements: ["sva-2"] });
    sdb
      .prepare(
        "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, 'S', 'quote_funnel', 'home', 'H', '{}')",
      )
      .run(mintPublicId("section"));
    // two quotes on DIFFERENT activities — the json_each leg must only read
    // the matching quote's verticals array.
    sdb
      .prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'Q1', 'quote_funnel', ?)")
      .run(mintPublicId("quote"), JSON.stringify(["pet"]));
    sdb
      .prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'Q2', 'quiz', ?)")
      .run(mintPublicId("quote"), JSON.stringify(["psychic"]));

    // global (no filter) — the full union, unchanged shape
    const global = await admin.request(`${API}/verticals`, {}, env);
    expect(await global.json()).toEqual({ items: ["boat", "home", "life", "pet", "psychic"] });

    // filtered: quote_funnel sees its offers+sections+quotes legs only
    const funnel = await admin.request(`${API}/verticals?activity=quote_funnel`, {}, env);
    expect(await funnel.json()).toEqual({ items: ["home", "life", "pet"] });

    // filtered: quiz sees the quiz offer + the quiz quote's array only
    const quiz = await admin.request(`${API}/verticals?activity=quiz`, {}, env);
    expect(await quiz.json()).toEqual({ items: ["boat", "psychic"] });

    // an unknown activity filters to empty (never errors)
    const none = await admin.request(`${API}/verticals?activity=nope`, {}, env);
    expect(await none.json()).toEqual({ items: [] });
  });
});

// ===========================================================================
// Fix-contract v2.4 Phase 3 (07 §§7.2–7.4) — offer lifecycle
// ===========================================================================

describeDb("A2 duplicate — POST /offers/:id/duplicate (07 §7.3)", () => {
  it("clones to a paused draft: new lgo_/lgpl_ ids, required new default placement, untested, nothing operational copied", async () => {
    const { env } = newHarness();
    const src = await createOffer(env, { offer_name: "Source", placements: ["pl-src-A", "pl-src-B"] });

    const missing = await admin.request(`${API}/offers/${src.id}/duplicate`, jsonInit("POST", { name: "Copy" }), env);
    expect(missing.status, "default_placement_id required").toBe(400);

    const res = await admin.request(
      `${API}/offers/${src.id}/duplicate`,
      jsonInit("POST", { name: "My Copy", default_placement_id: "pl-copy-DEFAULT" }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      offer: { id: number; public_id: string; offer_name: string; status: string };
      not_copied: string[];
      test_status: string;
    };
    expect(isPublicId("offer", body.offer.public_id)).toBe(true);
    expect(body.offer.public_id).not.toBe(src.public_id);
    expect(body.offer.offer_name).toBe("My Copy");
    expect(body.offer.status).toBe("paused");
    expect(body.test_status).toBe("untested");
    expect(body.not_copied).toEqual(
      expect.arrayContaining(["analytics", "cap_counters", "provider_logs", "revenue"]),
    );

    const detail = (await (await admin.request(`${API}/offers/${body.offer.id}`, {}, env)).json()) as {
      placements: Array<{ placement_id: string; is_default: boolean }>;
    };
    expect(detail.placements.find((p) => p.is_default)?.placement_id).toBe("pl-copy-DEFAULT");
    expect(detail.placements.some((p) => p.placement_id === "pl-src-B"), "source ids not reused verbatim").toBe(false);
  });
});

describeDb("A1 guarded hard delete — DELETE /offers/:id?mode=hard (07 §7.2)", () => {
  it("archives by default; hard-deletes a clean offer permanently", async () => {
    const { env } = newHarness();
    const clean = await createOffer(env);

    const arch = await admin.request(`${API}/offers/${clean.id}`, { method: "DELETE" }, env);
    expect(arch.status).toBe(200);
    expect(((await arch.json()) as { status: string }).status).toBe("archived");

    const hard = await admin.request(`${API}/offers/${clean.id}?mode=hard`, { method: "DELETE" }, env);
    expect(hard.status).toBe(200);
    expect(((await hard.json()) as { deleted: string }).deleted).toBe("hard");
    expect((await admin.request(`${API}/offers/${clean.id}`, {}, env)).status).toBe(404);
  });
});

describeDb("A3 usage inventory — GET /offers/:id/usage (07 §7.4)", () => {
  it("reports the full reference-kind set + delete_eligibility; provider-logs/analytics are warning-only", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const res = await admin.request(`${API}/offers/${offer.id}/usage`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usage: {
        kinds: Array<{ kind: string; count: number; warning_only?: boolean }>;
        delete_eligibility: { eligible: boolean; blocking_kinds: string[] };
      };
    };
    const kinds = body.usage.kinds.map((k) => k.kind);
    for (const k of [
      "sections_available", "answer_maps", "auctions_participating", "auction_rules_targeting",
      "cap_fallback_referenced_by", "cap_counters_active", "provider_request_logs", "analytics_mirror_rows",
    ]) {
      expect(kinds, k).toContain(k);
    }
    expect(body.usage.delete_eligibility.eligible, "fresh offer references nothing").toBe(true);
    expect(body.usage.kinds.find((k) => k.kind === "provider_request_logs")?.warning_only).toBe(true);
    expect(body.usage.kinds.find((k) => k.kind === "analytics_mirror_rows")?.warning_only).toBe(true);
  });
});

describeDb("A1 referenced hard-delete is blocked — 409 + usage report (07 §7.2)", () => {
  it("a funnel_rule target AND an auction backfill source block ?mode=hard with the two new kinds", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    // FKs are enforced — seed a minimal quote→funnel→variant chain for the rule.
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'Q', 'quote_funnel', '[]')").run(mintPublicId("quote"));
    const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, ?, 'F')").run(mintPublicId("funnel"), quoteId);
    const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES (?, ?)").run(mintPublicId("funnel_variant"), funnelId);
    const variantId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    sdb.prepare(
      "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id) VALUES (?, ?, 'redirect_direct_offer', '{}', 'h', ?)",
    ).run(mintPublicId("funnel_rule"), variantId, offer.id);
    sdb.prepare(
      "INSERT INTO leadgen_auctions (public_id, auction_name, auction_type, backfill_source_offer_id) VALUES (?, 'Backfill A', 'dynamic', ?)",
    ).run(mintPublicId("auction"), offer.id);

    const res = await admin.request(`${API}/offers/${offer.id}?mode=hard`, { method: "DELETE" }, env);
    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: string;
      usage: { delete_eligibility: { eligible: boolean; blocking_kinds: string[] } };
    };
    expect(body.error).toBe("offer_in_use");
    expect(body.usage.delete_eligibility.eligible).toBe(false);
    expect(body.usage.delete_eligibility.blocking_kinds).toEqual(
      expect.arrayContaining(["funnel_rules_targeting", "auction_backfill_source"]),
    );
    expect((await admin.request(`${API}/offers/${offer.id}`, {}, env)).status).toBe(200);
  });
});

describeDb("A3 usage inventory — populated fixture (07 §7.4)", () => {
  it("reports every named kind with real counts; warning-only kinds never block", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env);
    sdb.prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, 'S', 'quote_funnel', 'life', 'H', '{}')",
    ).run(mintPublicId("section"));
    const sectionId = (sdb.prepare("SELECT id FROM leadgen_sections LIMIT 1").get() as { id: number }).id;
    sdb.prepare(
      "INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected, mapping_state) VALUES (?, ?, 1, 'complete')",
    ).run(sectionId, offer.id);
    // FKs are enforced — seed a minimal quote→funnel→variant chain for the rule.
    sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'Q', 'quote_funnel', '[]')").run(mintPublicId("quote"));
    const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, ?, 'F')").run(mintPublicId("funnel"), quoteId);
    const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES (?, ?)").run(mintPublicId("funnel_variant"), funnelId);
    const variantId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    sdb.prepare(
      "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id) VALUES (?, ?, 'redirect_direct_offer', '{}', 'h', ?)",
    ).run(mintPublicId("funnel_rule"), variantId, offer.id);
    sdb.prepare(
      "INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'staging', 200)",
    ).run(offer.public_id);
    sdb.prepare(
      "INSERT INTO leadgen_revenue_raw (dt, click_id, offer_public_id, source, revenue) VALUES ('2026-07-08', 'ck1', ?, 's2s_postback', 5.0)",
    ).run(offer.public_id);

    const res = await admin.request(`${API}/offers/${offer.id}/usage`, {}, env);
    const body = (await res.json()) as {
      usage: {
        kinds: Array<{ kind: string; count: number; warning_only?: boolean }>;
        delete_eligibility: { eligible: boolean; blocking_kinds: string[] };
      };
    };
    const k = (name: string): { count: number; warning_only?: boolean } | undefined =>
      body.usage.kinds.find((x) => x.kind === name);
    for (const name of [
      "sections_available", "answer_maps", "auctions_participating", "auction_rules_targeting",
      "cap_fallback_referenced_by", "funnel_rules_targeting", "auction_backfill_source",
      "quotes_indirect", "region_rules", "cap_counters_active",
      "provider_request_logs", "analytics_mirror_rows", "revenue_attribution",
    ]) {
      expect(body.usage.kinds.map((x) => x.kind), name).toContain(name);
    }
    expect(k("sections_available")?.count).toBe(1);
    expect(k("funnel_rules_targeting")?.count).toBe(1);
    expect(k("provider_request_logs")?.count).toBe(1);
    expect(k("revenue_attribution")?.count).toBe(1);
    expect(k("provider_request_logs")?.warning_only).toBe(true);
    expect(k("revenue_attribution")?.warning_only).toBe(true);
    expect(body.usage.delete_eligibility.eligible).toBe(false);
    expect(body.usage.delete_eligibility.blocking_kinds).toEqual(
      expect.arrayContaining(["sections_available", "funnel_rules_targeting"]),
    );
    expect(body.usage.delete_eligibility.blocking_kinds).not.toContain("provider_request_logs");
    expect(body.usage.delete_eligibility.blocking_kinds).not.toContain("revenue_attribution");
  });
});

// ===========================================================================
// Fix-contract v2.4 P2/P3 audit remediation (F5, F6, F7, F8, F12, F13)
// ===========================================================================

// --- F5 (07 §7.1): the additive per-row list test_status chip field ----------

describeDb("GET /offers — F5 §7.1 per-row test_status chip field", () => {
  it("derives passed/failed/untested from the LATEST TEST-TOOL run; runtime auction rows never count", async () => {
    const { sdb, env } = newHarness();
    const passed = await createOffer(env, { offer_name: "PassedOffer", placements: ["ts-1"] });
    const failed = await createOffer(env, { offer_name: "FailedOffer", placements: ["ts-2"] });
    const untested = await createOffer(env, { offer_name: "UntestedOffer", placements: ["ts-3"] });
    const seed = sdb.prepare(
      "INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code, auction_instance_id, created_at) VALUES (?, 'production', ?, ?, ?)",
    );
    seed.run(passed.public_id, 500, null, 1_000); // older FAIL…
    seed.run(passed.public_id, 200, null, 2_000); // …the NEWEST test run passes
    seed.run(failed.public_id, 200, null, 1_000); // older pass…
    seed.run(failed.public_id, 503, null, 2_000); // …the newest fails
    seed.run(untested.public_id, 200, "lgai_runtime_row", 3_000); // AUCTION row — invisible to the chip

    const res = await admin.request(`${API}/offers`, {}, env);
    expect(res.status).toBe(200);
    const items = ((await res.json()) as { items: Array<{ offer_name: string; test_status: string }> }).items;
    const byName = new Map(items.map((i) => [i.offer_name, i.test_status]));
    expect(byName.get("PassedOffer")).toBe("passed");
    expect(byName.get("FailedOffer")).toBe("failed");
    expect(byName.get("UntestedOffer"), "no TEST-TOOL rows → untested").toBe("untested");
  });
});

// --- F7 + F13 (07 §7.3): duplicate is ONE transaction + the source-id guard --

describeDb("duplicate — F7 one-transaction atomicity + F13 source-placement-id guard (07 §7.3)", () => {
  it("F13: 400s when default_placement_id equals ANY source placement id (default or extra)", async () => {
    const { sdb, env } = newHarness();
    const src = await createOffer(env, { offer_name: "Src", placements: ["pl-src-A", "pl-src-B"] });
    for (const collide of ["pl-src-A", "pl-src-B"]) {
      const res = await admin.request(
        `${API}/offers/${src.id}/duplicate`,
        jsonInit("POST", { name: "Clone", default_placement_id: collide }),
        env,
      );
      expect(res.status, `${collide} must 400`).toBe(400);
      const body = (await res.json()) as { error: string; fields: Record<string, string> };
      expect(body.error).toBe("Validation failed");
      expect(body.fields["default_placement_id"]).toContain("differ from every placement id");
    }
    // F7: every pre-batch validation failure leaves ZERO clone rows behind.
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_offers").get() as { n: number }).n).toBe(1);
  });

  it("F7: a validation failure BEFORE the batch leaves zero offer rows (missing default_placement_id)", async () => {
    const { sdb, env } = newHarness();
    const src = await createOffer(env, { offer_name: "Src", placements: ["pl-a"] });
    const missing = await admin.request(`${API}/offers/${src.id}/duplicate`, jsonInit("POST", { name: "Clone" }), env);
    expect(missing.status).toBe(400);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_offers").get() as { n: number }).n).toBe(1);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_offer_placements").get() as { n: number }).n).toBe(1);
  });

  it("F13b: a reserved __needs_value__ default_placement_id is a typed 400 (never the old mid-batch 500), zero clone rows", async () => {
    const { sdb, env } = newHarness();
    const src = await createOffer(env, { offer_name: "Src", placements: ["pl-a", "pl-b"] });
    // Both the colliding sentinel ("__needs_value__1" — the clone WOULD mint
    // that exact row for the extra placement) and a non-colliding one are
    // rejected: the whole prefix namespace is reserved, not just live rows.
    for (const reserved of ["__needs_value__1", "__needs_value__"]) {
      const res = await admin.request(
        `${API}/offers/${src.id}/duplicate`,
        jsonInit("POST", { name: "Clone", default_placement_id: reserved }),
        env,
      );
      expect(res.status, `${reserved} must 400`).toBe(400);
      const body = (await res.json()) as { error: string; fields: Record<string, string> };
      expect(body.error).toBe("Validation failed");
      expect(body.fields["default_placement_id"]).toContain("reserved value");
    }
    // F7: the pre-batch rejection leaves ZERO clone rows behind.
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_offers").get() as { n: number }).n).toBe(1);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_offer_placements").get() as { n: number }).n).toBe(2);
  });

  it("F7: a MID-BATCH child failure rolls back the whole clone — parent offer row included (no compensating delete)", async () => {
    const { sdb, env } = newHarness();
    // The old real-input route to a mid-batch collision (default =
    // "__needs_value__1") is now rejected pre-batch as a typed 400 (F13b), so
    // recreate a genuine child failure AT THE DB LAYER instead: rewrite the
    // extra placement's sentinel bind to equal the new default, colliding on
    // UNIQUE(offer_id, placement_id) INSIDE the real BEGIN…ROLLBACK batch.
    const src = await createOffer(env, { offer_name: "Src", placements: ["pl-a", "pl-b"] });
    const db = env.DB as unknown as {
      prepare: (sql: string) => { bind: (...a: unknown[]) => unknown; [k: string]: unknown };
    };
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      if (/INSERT INTO leadgen_offer_placements/.test(sql)) {
        const origBind = stmt.bind.bind(stmt) as (...a: unknown[]) => unknown;
        stmt.bind = (...args: unknown[]) =>
          typeof args[2] === "string" && args[2].startsWith("__needs_value__")
            ? origBind(args[0], args[1], "pl-new-default", ...args.slice(3))
            : origBind(...args);
      }
      return stmt;
    };
    const res = await admin.request(
      `${API}/offers/${src.id}/duplicate`,
      jsonInit("POST", { name: "Clone", default_placement_id: "pl-new-default" }),
      env,
    );
    expect(res.status).toBe(500);
    // §7.3 "one transaction": the rollback left NO trace — no clone offer row
    // (the parent INSERT was INSIDE the batch), no clone placement rows.
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_offers").get() as { n: number }).n).toBe(1);
    expect((sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_offer_placements").get() as { n: number }).n).toBe(2);
  });

  it("F7 structural: duplicate NEVER writes leadgen_offers via a standalone run() — the parent INSERT rides the batch (crash-window proof)", async () => {
    // The compensating-delete design converged to the same end-state in the
    // happy/rollback paths — its defect was the CRASH WINDOW between the
    // standalone parent INSERT and the children batch. That window exists iff
    // some leadgen_offers write executes OUTSIDE db.batch(), so this probe
    // records exactly that (fail-before: the old parent INSERT ran standalone).
    const { env } = newHarness();
    const src = await createOffer(env, { offer_name: "Src", placements: ["pl-a", "pl-b"] });

    const db = env.DB as unknown as {
      prepare: (sql: string) => { run: () => Promise<unknown>; [k: string]: unknown };
      batch: (stmts: unknown[]) => Promise<unknown>;
    };
    const standaloneOfferWrites: string[] = [];
    let inBatch = false;
    const origPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = origPrepare(sql);
      const origRun = stmt.run.bind(stmt) as () => Promise<unknown>;
      stmt.run = async () => {
        if (!inBatch && /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql) && sql.includes("leadgen_offers")) {
          standaloneOfferWrites.push(sql);
        }
        return origRun();
      };
      return stmt;
    };
    const origBatch = db.batch.bind(db);
    db.batch = async (stmts: unknown[]) => {
      inBatch = true;
      try {
        return await origBatch(stmts);
      } finally {
        inBatch = false;
      }
    };

    const res = await admin.request(
      `${API}/offers/${src.id}/duplicate`,
      jsonInit("POST", { name: "Atomic Clone", default_placement_id: "pl-new" }),
      env,
    );
    expect(res.status).toBe(201);
    expect(standaloneOfferWrites, "every leadgen_offers write must ride the ONE batch").toEqual([]);
  });
});

// --- F12b/F12c/F12d + F13a (07 §7.3/§7.7): the duplicate copy-set proofs -----

describeDb("duplicate — F12 copy-set matrix / blanked sentinels / non-copy proofs (07 §7.3, §7.7)", () => {
  it("F12b: each copy checkbox independently copies vs skips, DB-proven (incl. F13a cap_fallback_offer_id under the cap flag)", async () => {
    const { sdb, env } = newHarness();
    const fallback = await createOffer(env, { offer_name: "FallbackTarget", placements: ["fb-1"] });
    const src = await createOffer(env, { offer_name: "MatrixSrc", placements: ["mx-1"] });
    const patch = await admin.request(
      `${API}/offers/${src.id}`,
      jsonInit("PATCH", {
        endpoint_production: "https://prov.example.com/q",
        endpoint_staging: "https://stg.example.com/q",
        request_method: "POST",
        api_token_secret_ref: "OFFER_TOKEN_PROV_KEY",
        api_token_placement: "header",
        api_token_param_name: "Authorization",
        headers: [{ header_name: "X-Static", value_kind: "static", value_text: "v1" }],
        region_rules: [
          { dimension: "state", action: "exclude", values: ["CA"], priority: 10 },
          { dimension: "zip", action: "include_only", values: ["90210"] },
        ],
        cap_enabled: true,
        cap_amount: 50,
        cap_timezone: "UTC",
        cap_count_by: "clicks",
        cap_fallback_offer_id: fallback.id,
        cap_fallback_url: "https://fallback.example.com/x",
      }),
      env,
    );
    expect(patch.status, await patch.clone().text()).toBe(200);

    interface CloneRow {
      cap_enabled: number;
      cap_amount: number | null;
      cap_timezone: string | null;
      cap_count_by: string | null;
      cap_fallback_offer_id: number | null;
      cap_fallback_url: string | null;
      endpoint_production: string | null;
      endpoint_staging: string | null;
      request_method: string | null;
      api_token_secret_ref: string | null;
      api_token_placement: string | null;
      api_token_param_name: string | null;
    }
    let n = 0;
    const dup = async (
      flags: Record<string, boolean>,
    ): Promise<{ row: CloneRow; headers: number; rules: number }> => {
      n += 1;
      const res = await admin.request(
        `${API}/offers/${src.id}/duplicate`,
        jsonInit("POST", { name: `Clone ${n}`, default_placement_id: `mx-clone-${n}`, ...flags }),
        env,
      );
      expect(res.status, await res.clone().text()).toBe(201);
      const body = (await res.json()) as { offer: { id: number } };
      const row = sdb
        .prepare(
          "SELECT cap_enabled, cap_amount, cap_timezone, cap_count_by, cap_fallback_offer_id, cap_fallback_url, endpoint_production, endpoint_staging, request_method, api_token_secret_ref, api_token_placement, api_token_param_name FROM leadgen_offers WHERE id = ?",
        )
        .get(body.offer.id) as CloneRow;
      const headers = (
        sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_offer_headers WHERE offer_id = ?").get(body.offer.id) as { n: number }
      ).n;
      const rules = (
        sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_offer_region_rules WHERE offer_id = ?").get(body.offer.id) as {
          n: number;
        }
      ).n;
      return { row, headers, rules };
    };

    // Defaults: region rules ON, endpoint config ON, cap settings OFF.
    const defaults = await dup({});
    expect(defaults.rules, "copy_region_rules default ON").toBe(2);
    expect(defaults.row.endpoint_production).toBe("https://prov.example.com/q");
    expect(defaults.row.endpoint_staging).toBe("https://stg.example.com/q");
    expect(defaults.row.request_method).toBe("POST");
    expect(defaults.row.api_token_secret_ref).toBe("OFFER_TOKEN_PROV_KEY");
    expect(defaults.row.api_token_placement).toBe("header");
    expect(defaults.row.api_token_param_name).toBe("Authorization");
    expect(defaults.headers, "headers ride the endpoint-config box").toBe(1);
    expect(defaults.row.cap_enabled).toBe(0);
    expect(defaults.row.cap_amount, "cap settings default OFF").toBeNull();
    expect(defaults.row.cap_timezone).toBeNull();
    expect(defaults.row.cap_count_by).toBeNull();
    expect(defaults.row.cap_fallback_offer_id).toBeNull();
    expect(defaults.row.cap_fallback_url).toBeNull();

    // copy_region_rules OFF — rules skipped, everything else per defaults.
    const rulesOff = await dup({ copy_region_rules: false });
    expect(rulesOff.rules).toBe(0);
    expect(rulesOff.headers).toBe(1);

    // copy_endpoint_config OFF — refs AND headers skipped.
    const epOff = await dup({ copy_endpoint_config: false });
    expect(epOff.row.endpoint_production).toBeNull();
    expect(epOff.row.endpoint_staging).toBeNull();
    expect(epOff.row.request_method).toBeNull();
    expect(epOff.row.api_token_secret_ref).toBeNull();
    expect(epOff.row.api_token_placement).toBeNull();
    expect(epOff.row.api_token_param_name).toBeNull();
    expect(epOff.headers).toBe(0);
    expect(epOff.rules, "region rules unaffected by the endpoint box").toBe(2);

    // copy_cap_settings ON — settings copy, the cap still lands DISABLED.
    const capOn = await dup({ copy_cap_settings: true });
    expect(capOn.row.cap_enabled, "caps ALWAYS copied disabled (§7.3)").toBe(0);
    expect(capOn.row.cap_amount).toBe(50);
    expect(capOn.row.cap_timezone).toBe("UTC");
    expect(capOn.row.cap_count_by).toBe("clicks");
    // F13a: cap_fallback_offer_id rides the cap-settings checkbox (it was
    // silently never copied before this fix).
    expect(capOn.row.cap_fallback_offer_id).toBe(fallback.id);
    expect(capOn.row.cap_fallback_url).toBe("https://fallback.example.com/x");
  });

  it("F12c: extra source placements clone as __needs_value__ sentinel DB rows + copied.extra_placements_blanked", async () => {
    const { sdb, env } = newHarness();
    const src = await createOffer(env, { offer_name: "BlankSrc", placements: ["pl-d", "pl-x1", "pl-x2"] });
    const res = await admin.request(
      `${API}/offers/${src.id}/duplicate`,
      jsonInit("POST", { name: "BlankClone", default_placement_id: "pl-new-default" }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { offer: { id: number }; copied: { extra_placements_blanked: number } };
    expect(body.copied.extra_placements_blanked).toBe(2);
    const rows = sdb
      .prepare("SELECT placement_id, is_default FROM leadgen_offer_placements WHERE offer_id = ? ORDER BY id")
      .all(body.offer.id) as Array<{ placement_id: string; is_default: number }>;
    expect(rows).toEqual([
      { placement_id: "pl-new-default", is_default: 1 },
      { placement_id: "__needs_value__1", is_default: 0 },
      { placement_id: "__needs_value__2", is_default: 0 },
    ]);
  });

  it("F12d: operational data is NEVER copied — zero analytics/cap-counter/provider-log/test/revenue rows keyed to the clone", async () => {
    const { sdb, env } = newHarness();
    const src = await createOffer(env, { offer_name: "OpSrc", placements: ["op-1"] });
    // active schema WITH a sample response (a passed-Test artifact on the source)
    const schemaRes = await admin.request(
      `${API}/offers/${src.id}/payload-schemas`,
      jsonInit("POST", { schema_json: VALID_SCHEMA }),
      env,
    );
    expect(schemaRes.status).toBe(201);
    const schemaId = ((await schemaRes.json()) as { id: number }).id;
    sdb
      .prepare("UPDATE leadgen_offer_payload_schemas SET sample_response_json = '{\"carriers\":[]}' WHERE id = ?")
      .run(schemaId);
    // operational rows on the SOURCE (analytics, active cap counter, a
    // test-tool provider-log row, revenue attribution)
    sdb
      .prepare("INSERT INTO leadgen_analytics_offer (offer_public_id, date, offer_impressions) VALUES (?, '2026-07-01', 10)")
      .run(src.public_id);
    sdb
      .prepare("INSERT INTO leadgen_offer_cap_counters (offer_id, cap_date, timezone, click_count) VALUES (?, '2026-07-01', 'UTC', 3)")
      .run(src.id);
    sdb
      .prepare("INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'production', 200)")
      .run(src.public_id);
    sdb
      .prepare("INSERT INTO leadgen_revenue_raw (dt, click_id, offer_public_id, source, revenue) VALUES ('2026-07-01', 'ck-op', ?, 'api', 5)")
      .run(src.public_id);

    const res = await admin.request(
      `${API}/offers/${src.id}/duplicate`,
      jsonInit("POST", { name: "OpClone", default_placement_id: "op-new" }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      offer: { id: number; public_id: string };
      copied: { active_schema_as_v1: boolean };
      not_copied: string[];
    };
    expect(body.copied.active_schema_as_v1).toBe(true);
    expect(body.not_copied).toEqual(
      expect.arrayContaining(["analytics", "cap_counters", "provider_logs", "test_results", "revenue"]),
    );

    const clonePid = body.offer.public_id;
    const count = (sql: string, key: string | number): number =>
      (sdb.prepare(sql).get(key) as { n: number }).n;
    expect(count("SELECT COUNT(*) AS n FROM leadgen_analytics_offer WHERE offer_public_id = ?", clonePid)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM leadgen_offer_cap_counters WHERE offer_id = ?", body.offer.id)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM leadgen_provider_request_log WHERE offer_public_id = ?", clonePid)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM leadgen_revenue_raw WHERE offer_public_id = ?", clonePid)).toBe(0);
    // the cloned v1 schema carries NO sample response → untested by design
    const cloneSchema = sdb
      .prepare("SELECT sample_response_json, version FROM leadgen_offer_payload_schemas WHERE offer_id = ?")
      .get(body.offer.id) as { sample_response_json: string | null; version: number };
    expect(cloneSchema.version).toBe(1);
    expect(cloneSchema.sample_response_json).toBeNull();
  });
});

// --- F12a + F6 (07 §7.2/§7.7): hard-delete cascade proofs + the audit log ----

describeDb("hard delete — F12a cascade row-count proofs + F6 structured audit log (07 §7.2)", () => {
  async function seedRichOffer(env: Env, sdb: SqliteDb): Promise<OfferDetail> {
    const offer = await createOffer(env, { offer_name: "RichOffer", placements: ["rich-1"] });
    const patch = await admin.request(
      `${API}/offers/${offer.id}`,
      jsonInit("PATCH", {
        headers: [{ header_name: "X-Static", value_kind: "static", value_text: "v" }],
        region_rules: [
          { dimension: "state", action: "exclude", values: ["CA"] },
          { dimension: "zip", action: "include_only", values: ["90210"] },
        ],
      }),
      env,
    );
    expect(patch.status).toBe(200);
    // two schema versions — the ACTIVE pointer is set, so the delete batch
    // must clear it before cascading the schema rows (FK-safe order)
    for (let i = 0; i < 2; i++) {
      const res = await admin.request(
        `${API}/offers/${offer.id}/payload-schemas`,
        jsonInit("POST", { schema_json: VALID_SCHEMA }),
        env,
      );
      expect(res.status).toBe(201);
    }
    // an INACTIVE (zero-activity) counter row: cascades, never blocks
    sdb
      .prepare(
        "INSERT INTO leadgen_offer_cap_counters (offer_id, cap_date, timezone, click_count, conversion_count) VALUES (?, '2026-07-01', 'UTC', 0, 0)",
      )
      .run(offer.id);
    return offer;
  }

  const CHILD_TABLES = [
    "leadgen_offer_region_rules",
    "leadgen_offer_headers",
    "leadgen_offer_cap_counters",
    "leadgen_offer_payload_schemas",
    "leadgen_offer_placements",
  ] as const;
  const EXPECTED_BEFORE = {
    leadgen_offer_region_rules: 2,
    leadgen_offer_headers: 1,
    leadgen_offer_cap_counters: 1,
    leadgen_offer_payload_schemas: 2,
    leadgen_offer_placements: 1,
  };

  function childCounts(sdb: SqliteDb, offerId: number): Record<string, number> {
    const out: Record<string, number> = {};
    for (const table of CHILD_TABLES) {
      // fixed-literal table names from the const list above (test-only helper)
      out[table] = (sdb.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE offer_id = ?`).get(offerId) as { n: number }).n;
    }
    return out;
  }

  it("F12a: ?mode=hard cascades ALL 5 own-child tables — BEFORE/AFTER row counts", async () => {
    const { sdb, env } = newHarness();
    const offer = await seedRichOffer(env, sdb);
    expect(childCounts(sdb, offer.id), "BEFORE: every child table populated").toEqual(EXPECTED_BEFORE);

    const res = await admin.request(`${API}/offers/${offer.id}?mode=hard`, { method: "DELETE" }, env);
    expect(res.status, await res.clone().text()).toBe(200);

    expect(childCounts(sdb, offer.id), "AFTER: every child table empty").toEqual({
      leadgen_offer_region_rules: 0,
      leadgen_offer_headers: 0,
      leadgen_offer_cap_counters: 0,
      leadgen_offer_payload_schemas: 0,
      leadgen_offer_placements: 0,
    });
    expect(
      (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_offers WHERE id = ?").get(offer.id) as { n: number }).n,
    ).toBe(0);
  });

  it("F6: hard delete emits the structured audit event with per-child-table cascaded counts", async () => {
    const { sdb, env } = newHarness();
    const offer = await seedRichOffer(env, sdb);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const res = await admin.request(`${API}/offers/${offer.id}?mode=hard`, { method: "DELETE" }, env);
      expect(res.status).toBe(200);
      const line = spy.mock.calls.map((args) => String(args[0])).find((s) => s.includes("leadgen_offer_hard_delete"));
      expect(line, "structured audit log emitted on hard-delete success").toBeTruthy();
      expect(JSON.parse(line as string)).toEqual({
        event: "leadgen_offer_hard_delete",
        offer_public_id: offer.public_id,
        offer_name: "RichOffer",
        cascaded: EXPECTED_BEFORE,
      });
    } finally {
      spy.mockRestore();
    }
  });
});

// --- F12e + F8 (07 §7.4/§7.7): EVERY usage kind populated in ONE fixture -----

describeDb("usage — F12e every-kind fixture + F8 true multi-table counts (07 §7.4)", () => {
  it("populates all 13 kinds ≥1 and every count is the TRUE summed row count in one response", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env, { offer_name: "UsedEverywhere", placements: ["ue-1"] });
    const placementRowId = (
      sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE offer_id = ? AND is_default = 1").get(offer.id) as {
        id: number;
      }
    ).id;
    // a real schema version (answer_maps carries a NOT NULL schema FK)
    const schemaRes = await admin.request(
      `${API}/offers/${offer.id}/payload-schemas`,
      jsonInit("POST", { schema_json: VALID_SCHEMA }),
      env,
    );
    expect(schemaRes.status).toBe(201);
    const schema = (await schemaRes.json()) as { id: number; public_id: string };

    // 1. sections_available + 2. answer_maps
    sdb
      .prepare(
        "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, 'Sec', 'quote_funnel', 'life', 'H', '{}')",
      )
      .run(mintPublicId("section"));
    const sectionId = (sdb.prepare("SELECT id FROM leadgen_sections LIMIT 1").get() as { id: number }).id;
    sdb
      .prepare("INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected, mapping_state) VALUES (?, ?, 1, 'complete')")
      .run(sectionId, offer.id);
    sdb
      .prepare(
        `INSERT INTO leadgen_section_answer_maps
           (public_id, section_id, question_id, question_key, internal_field, answer_type, offer_id,
            payload_schema_id, payload_schema_public_id, offer_payload_field_path, provider_expected_type)
         VALUES (?, ?, 'q1', 'homeowner', 'homeowner', 'boolean', ?, ?, ?, 'data.home_own', 'boolean')`,
      )
      .run(mintPublicId("answer_field_map"), sectionId, offer.id, schema.id, schema.public_id);

    // 3. auctions_participating + 4. auction_rules_targeting + 7. auction_backfill_source
    sdb
      .prepare("INSERT INTO leadgen_auctions (public_id, auction_name, auction_type, backfill_source_offer_id) VALUES (?, 'A', 'dynamic', ?)")
      .run(mintPublicId("auction"), offer.id);
    const auctionId = (sdb.prepare("SELECT id FROM leadgen_auctions LIMIT 1").get() as { id: number }).id;
    sdb
      .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id) VALUES (?, ?, ?)")
      .run(auctionId, placementRowId, offer.id);
    sdb
      .prepare(
        "INSERT INTO leadgen_auction_rules (public_id, auction_id, rule_level, target_offer_id, action, conditions_json, conditions_hash) VALUES (?, ?, 'offer', ?, 'exclude', '{}', 'h')",
      )
      .run(mintPublicId("auction_rule"), auctionId, offer.id);

    // 5. cap_fallback_referenced_by — ANOTHER offer points its fallback here
    const other = await createOffer(env, { offer_name: "PointsAtMe", placements: ["ue-2"] });
    sdb.prepare("UPDATE leadgen_offers SET cap_fallback_offer_id = ? WHERE id = ?").run(offer.id, other.id);

    // 6. funnel_rules_targeting + 8. quotes_indirect (quote→funnel→variant chain)
    sdb
      .prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'Q', 'quote_funnel', '[]')")
      .run(mintPublicId("quote"));
    const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name) VALUES (?, ?, 'F')").run(mintPublicId("funnel"), quoteId);
    const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    sdb.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES (?, ?)").run(mintPublicId("funnel_variant"), funnelId);
    const variantId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    sdb
      .prepare(
        "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, target_offer_id) VALUES (?, ?, 'redirect_direct_offer', '{}', 'h', ?)",
      )
      .run(mintPublicId("funnel_rule"), variantId, offer.id);
    sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, 1)").run(variantId, sectionId);

    // 9. region_rules (own; warning-only) + 10. cap_counters_active (blocking)
    sdb
      .prepare(
        "INSERT INTO leadgen_offer_region_rules (public_id, offer_id, dimension, action, values_json) VALUES (?, ?, 'state', 'exclude', '[\"CA\"]')",
      )
      .run(mintPublicId("offer_region_rule"), offer.id);
    sdb
      .prepare("INSERT INTO leadgen_offer_cap_counters (offer_id, cap_date, timezone, click_count) VALUES (?, '2026-07-01', 'UTC', 5)")
      .run(offer.id);

    // 11. provider_request_logs (warning-only)
    sdb
      .prepare("INSERT INTO leadgen_provider_request_log (offer_public_id, environment, status_code) VALUES (?, 'staging', 200)")
      .run(offer.public_id);

    // 12. analytics_mirror_rows — F8: rows spread across ALL FOUR offer-keyed
    // 0037 mirrors (1+1+2+1 = 5); a single-table count would read 1.
    sdb.prepare("INSERT INTO leadgen_analytics_offer (offer_public_id, date, offer_impressions) VALUES (?, '2026-07-01', 10)").run(offer.public_id);
    sdb.prepare("INSERT INTO leadgen_analytics_auction_drilldown (auction_public_id, offer_public_id, date) VALUES ('lga_mirror', ?, '2026-07-01')").run(offer.public_id);
    sdb.prepare("INSERT INTO leadgen_analytics_carrier (auction_public_id, offer_public_id, carrier_key, date) VALUES ('lga_mirror', ?, 'acme', '2026-07-01')").run(offer.public_id);
    sdb.prepare("INSERT INTO leadgen_analytics_carrier (auction_public_id, offer_public_id, carrier_key, date) VALUES ('lga_mirror', ?, 'acme', '2026-07-02')").run(offer.public_id);
    sdb.prepare("INSERT INTO leadgen_analytics_provider_diagnostics (offer_public_id, date) VALUES (?, '2026-07-01')").run(offer.public_id);

    // 13. revenue_attribution — F8: raw + postback + conversion (1+2+1 = 4).
    sdb.prepare("INSERT INTO leadgen_revenue_raw (dt, click_id, offer_public_id, source, revenue) VALUES ('2026-07-08', 'ck1', ?, 's2s_postback', 5.0)").run(offer.public_id);
    sdb.prepare("INSERT INTO leadgen_postback_log (provider, external_txn_id, offer_public_id) VALUES ('prov', 't1', ?)").run(offer.public_id);
    sdb.prepare("INSERT INTO leadgen_postback_log (provider, external_txn_id, offer_public_id) VALUES ('prov', 't2', ?)").run(offer.public_id);
    sdb.prepare("INSERT INTO leadgen_conversion_log (click_id, dedupe_key, offer_public_id) VALUES ('ck1', 'd1', ?)").run(offer.public_id);

    const res = await admin.request(`${API}/offers/${offer.id}/usage`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usage: {
        kinds: Array<{ kind: string; count: number; items: unknown[]; warning_only: boolean }>;
        delete_eligibility: { eligible: boolean; blocking_kinds: string[] };
      };
    };
    const byKind = new Map(body.usage.kinds.map((k) => [k.kind, k]));
    const BLOCKING = [
      "sections_available", "answer_maps", "auctions_participating", "auction_rules_targeting",
      "cap_fallback_referenced_by", "funnel_rules_targeting", "auction_backfill_source",
      "quotes_indirect", "cap_counters_active",
    ];
    const WARNING = ["region_rules", "provider_request_logs", "analytics_mirror_rows", "revenue_attribution"];
    // every kind present, count > 0, warning_only EXPLICIT on every entry
    for (const kind of [...BLOCKING, ...WARNING]) {
      const entry = byKind.get(kind);
      expect(entry, kind).toBeDefined();
      expect(entry!.count, `${kind} count > 0`).toBeGreaterThan(0);
      expect(typeof entry!.warning_only, `${kind} carries warning_only explicitly`).toBe("boolean");
      expect(entry!.warning_only, `${kind} warning_only`).toBe(WARNING.includes(kind));
    }
    // F8 exact sums: the TRUE row counts across every offer-keyed table
    expect(byKind.get("analytics_mirror_rows")?.count, "4 mirror tables summed").toBe(5);
    expect(byKind.get("revenue_attribution")?.count, "raw+postback+conversion summed").toBe(4);
    expect(byKind.get("provider_request_logs")?.count).toBe(1);
    // warning kinds keep a single synthetic display item; count stays the truth
    expect(byKind.get("analytics_mirror_rows")?.items).toHaveLength(1);
    expect(byKind.get("revenue_attribution")?.items).toHaveLength(1);
    // blocking verdict: all 9 blocking kinds, NONE of the warning kinds
    expect(body.usage.delete_eligibility.eligible).toBe(false);
    expect([...body.usage.delete_eligibility.blocking_kinds].sort()).toEqual([...BLOCKING].sort());
  });
});

// --- Rework M2 (§4.3-1 "shared first page", §5-M2 P1 entry gate) -----------
// quotes_indirect must ALSO count a Section reachable ONLY via a Quote's
// shared page (leadgen_funnel_variant_sections.quote_id set, variant_id
// NULL) — not just via a funnel variant. An unqualified INNER JOIN through
// fv.id = fvs.variant_id (the pre-rework shape) silently drops that row,
// which would wrongly let a still-referenced Offer's hard-delete pass since
// quotes_indirect is a BLOCKING kind.

describeDb("quotes_indirect — a quote-owned shared-page Section also counts (Rework M2 owner axis)", () => {
  it("counts + blocks a hard delete when the Offer's Section is placed ONLY on a quote's shared page (no variant reference)", async () => {
    const { sdb, env } = newHarness();
    const offer = await createOffer(env, { offer_name: "SharedPageOnly", placements: ["sp-1"] });

    sdb
      .prepare(
        "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json) VALUES (?, 'Sec', 'quote_funnel', 'life', 'H', '{}')",
      )
      .run(mintPublicId("section"));
    const sectionId = (sdb.prepare("SELECT id FROM leadgen_sections LIMIT 1").get() as { id: number }).id;
    sdb
      .prepare(
        "INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected, mapping_state) VALUES (?, ?, 1, 'complete')",
      )
      .run(sectionId, offer.id);

    sdb
      .prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, 'SharedQ', 'quote_funnel', '[]')")
      .run(mintPublicId("quote"));
    const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes ORDER BY id DESC LIMIT 1").get() as { id: number }).id;
    // The M2 owner axis: quote_id set, variant_id left NULL — placed on the
    // quote's shared page directly, never on any funnel variant.
    sdb
      .prepare("INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position) VALUES (?, ?, 0)")
      .run(quoteId, sectionId);

    const res = await admin.request(`${API}/offers/${offer.id}/usage`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usage: { kinds: Array<{ kind: string; count: number; items: Array<{ name: string }> }> };
    };
    const quotesIndirect = body.usage.kinds.find((k) => k.kind === "quotes_indirect");
    expect(quotesIndirect, "quotes_indirect present").toBeDefined();
    expect(quotesIndirect!.count, "the shared-page-owning quote is counted even with NO variant reference").toBe(1);
    expect(quotesIndirect!.items[0]?.name).toBe("SharedQ");

    const del = await admin.request(`${API}/offers/${offer.id}?mode=hard`, { method: "DELETE" }, env);
    expect(del.status, await del.clone().text()).toBe(409);
    const delBody = (await del.json()) as {
      error: string;
      usage: { delete_eligibility: { blocking_kinds: string[] } };
    };
    expect(delBody.error).toBe("offer_in_use");
    expect(delBody.usage.delete_eligibility.blocking_kinds).toContain("quotes_indirect");
  });
});
