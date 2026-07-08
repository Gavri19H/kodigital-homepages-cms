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

import { describe, expect, it } from "vitest";
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
          { header_name: "X-Secret", value_kind: "secret_ref", value_text: "LEADGEN_PROVIDER_KEY" },
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
      { header_name: "X-Secret", value_kind: "secret_ref", value_text: "LEADGEN_PROVIDER_KEY" },
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
      jsonInit("PATCH", { request_execution_mode: "client", api_token_secret_ref: "PROVIDER_TOKEN" }),
      env,
    );
    expect(resA.status).toBe(400);
    expect(((await resA.json()) as { fields: Record<string, string> }).fields["api_token_secret_ref"]).toContain(
      "client-mode",
    );

    // (b) switching to client mode while a STORED secret_ref header exists
    const offerB = await createOffer(env, { placements: ["cb-1"] });
    await admin.request(
      `${API}/offers/${offerB.id}`,
      jsonInit("PATCH", { headers: [{ header_name: "X-Key", value_kind: "secret_ref", value_text: "K1" }] }),
      env,
    );
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

    const res = await admin.request(`${API}/offers/${offer.id}/usage`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      usage: {
        sections: Array<{ section_name: string; selected: boolean; mapping_state: string }>;
        auctions: Array<{ auction_name: string; auction_type: string; placement_id: string; enabled: boolean }>;
      };
    };
    expect(body.usage.sections).toHaveLength(1);
    expect(body.usage.sections[0]?.section_name).toBe("Home Q");
    expect(body.usage.sections[0]?.selected).toBe(true);
    expect(body.usage.sections[0]?.mapping_state).toBe("complete");
    expect(body.usage.auctions).toHaveLength(1);
    expect(body.usage.auctions[0]?.auction_name).toBe("Main Auction");
    expect(body.usage.auctions[0]?.placement_id).toBe("pl-100");
    expect(body.usage.auctions[0]?.enabled).toBe(true);
  });

  it("returns empty lists for an unused offer", async () => {
    const { env } = newHarness();
    const offer = await createOffer(env);
    const res = await admin.request(`${API}/offers/${offer.id}/usage`, {}, env);
    const body = (await res.json()) as { usage: { sections: unknown[]; auctions: unknown[] } };
    expect(body.usage).toEqual({ sections: [], auctions: [] });
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
});
