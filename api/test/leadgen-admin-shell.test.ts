// LeadGen Phase 3 — admin nav + shell (contract 01 §3/§5, 03 §8/§9).
//
// Covers, over the REAL admin router + REAL 0036–0039 migrations
// (node:sqlite harness, repo pattern from listicles-ui.test.ts /
// leadgen-migrations.test.ts):
//   - ids.ts: the fourteen 02 §6.1/§6.3 prefixes, ULID shape/uniqueness,
//     isPublicId accepts its own kind and rejects other kinds / malformed
//   - nav entry present + order (LeadGen right after Listicles, 01 §5.1)
//   - GET /admin/leadgen → 302 /admin/leadgen/offers (01 §5.2)
//   - the four sub-tab routes render 200 with the four-tab bar + active tab;
//     the plural /admin/leadgen/auctions HTML path does NOT exist (404)
//   - every /admin/leadgen* + /api/admin/leadgen/* response class carries
//     `Cache-Control: private, no-store` + nosniff (03 §8.1/§9.1)
//   - the four list endpoints return `{ items, paging }` on an empty DB
//   - :id dual resolution: numeric id and public_id return the SAME mapped
//     entity; a well-formed but nonexistent public_id → 404 `{ error }`
//   - off-ADMIN_HOST 404 wall + unauthenticated 401, exactly as the
//     listicles equivalents behave (full src/index.ts app).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import app from "../src/index";
import type { Env } from "../src/env";
import { adminLayout } from "../src/admin/templates/layout";
import {
  PUBLIC_ID_PREFIXES,
  ULID_LENGTH,
  isPublicId,
  mintPublicId,
  ulid,
  type PublicIdKind,
} from "../src/leadgen/ids";
import type { LeadgenOfferApi } from "../src/admin/leadgen/db-types";
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
          sdb.prepare(sql).run(...binds);
          return { success: true, meta: {} };
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

// Filename order — the same order `wrangler d1 migrations apply` uses.
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  // Pre-0036 FK targets — the same stub tables the leadgen-migrations
  // harness creates, so the leadgen chain applies over an existing media
  // table.
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

const CROCKFORD_RE = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/;

const TAB_PATHS = [
  "/admin/leadgen/offers",
  "/admin/leadgen/sections",
  "/admin/leadgen/quotes",
  "/admin/leadgen/auction",
] as const;

const LIST_ENDPOINTS = [
  "/api/admin/leadgen/offers",
  "/api/admin/leadgen/sections",
  "/api/admin/leadgen/quotes",
  "/api/admin/leadgen/auctions",
] as const;

// --- ids.ts (01 §3 pattern-reuse row; prefixes per the normative 02 §6.1) ----

describe("leadgen ids — ULID shape", () => {
  it("mints 26-char Crockford base32 ULIDs (no I/L/O/U)", () => {
    for (let i = 0; i < 50; i++) {
      const id = ulid();
      expect(id).toHaveLength(ULID_LENGTH);
      expect(id).toMatch(CROCKFORD_RE);
    }
  });

  it("is time-ordered: ids minted at increasing timestamps sort lexicographically", () => {
    const t1 = ulid(1_700_000_000_000);
    const t2 = ulid(1_700_000_000_001);
    const t3 = ulid(1_800_000_000_000);
    expect(t1 < t2).toBe(true);
    expect(t2 < t3).toBe(true);
  });
});

describe("leadgen ids — the fourteen entity prefixes (02 §6.1 + §6.3)", () => {
  const expected: Record<PublicIdKind, string> = {
    offer: "lgo_",
    offer_placement: "lgpl_",
    payload_schema_version: "lgp_",
    offer_region_rule: "lgrr_",
    section: "lgs_",
    answer_field_map: "lgm_",
    quote: "lgq_",
    funnel: "lgf_",
    funnel_ab_test: "lgx_",
    funnel_variant: "lgn_",
    funnel_rule: "lgfr_",
    auction: "lga_",
    auction_rule: "lgar_",
    link_click: "lgl_",
  };

  it("exposes exactly the fourteen contract prefixes", () => {
    expect(PUBLIC_ID_PREFIXES).toEqual(expected);
    expect(Object.keys(PUBLIC_ID_PREFIXES)).toHaveLength(14);
  });

  for (const [kind, prefix] of Object.entries(expected) as Array<[PublicIdKind, string]>) {
    it(`mintPublicId('${kind}') yields ${prefix}<26-char ULID>`, () => {
      const id = mintPublicId(kind);
      expect(id.startsWith(prefix)).toBe(true);
      expect(id.slice(prefix.length)).toMatch(CROCKFORD_RE);
      expect(isPublicId(kind, id)).toBe(true);
    });
  }

  it("minted ids are unique", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(mintPublicId("offer"));
    }
    expect(ids.size).toBe(50);
  });

  it("isPublicId rejects other kinds and malformed remainders", () => {
    expect(isPublicId("offer", mintPublicId("section"))).toBe(false);
    expect(isPublicId("quote", mintPublicId("funnel"))).toBe(false);
    // shared-stem prefixes must not cross-accept (lga_ vs lgar_, lgp_ vs lgpl_)
    expect(isPublicId("auction", mintPublicId("auction_rule"))).toBe(false);
    expect(isPublicId("auction_rule", mintPublicId("auction"))).toBe(false);
    expect(isPublicId("payload_schema_version", mintPublicId("offer_placement"))).toBe(false);
    expect(isPublicId("offer", "lgo_short")).toBe(false);
    expect(isPublicId("offer", "lgo_" + "I".repeat(26))).toBe(false); // I not in Crockford
    expect(isPublicId("offer", ulid())).toBe(false); // bare ULID, no prefix
  });
});

// --- 01 §5.1: nav entry (pure template — no DB needed) ------------------------

describe("nav: LeadGen entry (01 §5.1)", () => {
  it("inserts LeadGen right after Listicles in the sidebar", () => {
    const html = adminLayout({
      title: "T",
      activePath: "/admin/leadgen/offers",
      content: "<p>x</p>",
    });
    const nav = html.match(/<nav class="sidebar-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";
    const labels = Array.from(nav.matchAll(/<span>([^<]+)<\/span>/g)).map((m) => m[1]);
    const listiclesIdx = labels.indexOf("Listicles");
    expect(listiclesIdx).toBeGreaterThan(-1);
    expect(labels[listiclesIdx + 1]).toBe("LeadGen");
    expect(nav).toContain('href="/admin/leadgen"');
    // active state binds to the LeadGen entry for a sub-tab path
    expect(html).toContain('href="/admin/leadgen" class="nav-item active"');
    expect((html.match(/nav-item active/g) ?? []).length).toBe(1);
  });
});

// --- shell + API routes over the real admin router ----------------------------

describeDb("leadgen shell routes (01 §5.2 / 03 §9)", () => {
  it("GET /admin/leadgen 302-redirects to the offers tab", async () => {
    const { env } = newHarness();
    const res = await admin.request("/admin/leadgen", { redirect: "manual" }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/leadgen/offers");
  });

  it("03 §8.1/§9.1: every response class carries private, no-store + nosniff", async () => {
    const { env } = newHarness();
    const absentId = mintPublicId("offer");
    const cases: Array<{ path: string; status: number; method?: string }> = [
      { path: "/admin/leadgen", status: 302 }, // redirect
      ...TAB_PATHS.map((path) => ({ path, status: 200 })), // tab pages
      { path: "/api/admin/leadgen/offers", status: 200 }, // API list
      { path: `/api/admin/leadgen/offers/${absentId}`, status: 404 }, // API 404
      { path: "/admin/leadgen/auctions", status: 404 }, // HTML 404 (01 §5.2 singular)
      { path: "/api/admin/leadgen", status: 404 }, // bare API root
      { path: "/admin/leadgen/offers", method: "POST", status: 404 }, // method miss
    ];
    for (const { path, status, method } of cases) {
      const res = await admin.request(path, { redirect: "manual", method }, env);
      expect(res.status, `${method ?? "GET"} ${path} status`).toBe(status);
      expect(res.headers.get("Cache-Control"), `${path} Cache-Control`).toBe(
        "private, no-store",
      );
      expect(
        res.headers.get("X-Content-Type-Options"),
        `${path} nosniff`,
      ).toBe("nosniff");
    }
    // 500 class: a poisoned DB makes the list handler throw; Hono's composer
    // routes it through onError while the after-next() header middleware
    // still stamps the error response.
    const poisoned = buildEnv({
      prepare() {
        throw new Error("forced D1 failure (header-class test)");
      },
    } as unknown as D1Database);
    const errRes = await admin.request("/api/admin/leadgen/offers", {}, poisoned);
    expect(errRes.status).toBe(500);
    expect(errRes.headers.get("Cache-Control")).toBe("private, no-store");
    expect(errRes.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("the four sub-tab routes render 200 with the four-tab bar + active tab", async () => {
    const { env } = newHarness();
    for (const path of TAB_PATHS) {
      const res = await admin.request(path, {}, env);
      expect(res.status, `${path} must render 200`).toBe(200);
      const html = await res.text();
      // adminLayout shell + LeadGen page title
      expect(html).toContain('data-marker="kodigital-admin-shell"');
      expect(html).toContain("LeadGen");
      // 01 §5.2 four-tab bar with every tab href present + the active one marked
      expect(html).toContain('class="leadgen-tabs"');
      for (const tabPath of TAB_PATHS) {
        expect(html, `${path} must link ${tabPath}`).toContain(`href="${tabPath}"`);
      }
      expect(html).toContain(`href="${path}" class="leadgen-tab active"`);
      // Shared anatomy on every tab: toolbar + empty-state (empty DB)
      expect(html).toContain('class="toolbar"');
      expect(html).toContain('class="empty-state"');
      if (path === "/admin/leadgen/offers") {
        // Phase-4 Stage B2: the Offers tab is LIVE — an ENABLED Create
        // button that opens the §10.1 modal (leadgen-offers-ui.test.ts
        // covers the full live anatomy).
        expect(html).toContain("data-open-offer-modal");
        expect(html).not.toMatch(/<button[^>]*disabled[^>]*>\+ Create an Offer/);
        expect(html).not.toContain("ships in a later phase");
      } else if (path === "/admin/leadgen/sections") {
        // Phase-5 Stage B: the Sections tab is LIVE — an ENABLED Create link
        // to the full-page editor (leadgen-sections-ui.test.ts covers the
        // full live anatomy).
        expect(html).toContain("data-create-section");
        expect(html).not.toMatch(/<button[^>]*disabled[^>]*>\+ Create a Section/);
        expect(html).not.toContain("ships in a later phase");
      } else {
        // Phase-3 scaffold anatomy: disabled Create button + phase note
        expect(html).toMatch(/<button[^>]*disabled[^>]*>\+ Create a/);
        expect(html).toContain("ships in a later phase");
      }
    }
  });

  it("the plural /admin/leadgen/auctions HTML path does NOT exist (01 §5.2 singular)", async () => {
    const { env } = newHarness();
    const res = await admin.request("/admin/leadgen/auctions", {}, env);
    expect(res.status).toBe(404);
  });

  it("each list endpoint returns { items: [], paging } on an empty DB (03 §8.4)", async () => {
    const { env } = newHarness();
    for (const path of LIST_ENDPOINTS) {
      const res = await admin.request(path, {}, env);
      expect(res.status, `${path} status`).toBe(200);
      const body = (await res.json()) as { items: unknown[]; paging: Paging };
      expect(body.items, `${path} items`).toEqual([]);
      expect(body.paging, `${path} paging`).toEqual({
        page: 1,
        page_size: 25,
        total: 0,
        has_next: false,
        has_prev: false,
      });
    }
  });

  it(":id dual resolution — numeric id and public_id return the SAME offer", async () => {
    const { sdb, env } = newHarness();
    const publicId = mintPublicId("offer");
    sdb
      .prepare(
        "INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type) VALUES (?, 'Dual Id Offer', 'quote_funnel', 'life', 's2s_postback', 'cpc')",
      )
      .run(publicId);
    const numericId = (
      sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as {
        id: number;
      }
    ).id;

    const byNumeric = await admin.request(`/api/admin/leadgen/offers/${numericId}`, {}, env);
    expect(byNumeric.status).toBe(200);
    const numericBody = (await byNumeric.json()) as LeadgenOfferApi;

    const byPublic = await admin.request(`/api/admin/leadgen/offers/${publicId}`, {}, env);
    expect(byPublic.status).toBe(200);
    const publicBody = (await byPublic.json()) as LeadgenOfferApi;

    expect(numericBody).toEqual(publicBody);
    expect(numericBody.id).toBe(numericId);
    expect(numericBody.public_id).toBe(publicId);
    expect(numericBody.offer_name).toBe("Dual Id Offer");
    // 03 §8.5 Row→API mapping: INTEGER bools surface as booleans
    expect(numericBody.cap_enabled).toBe(false);
    expect(numericBody.calls_provider_api).toBe(false);

    // the seeded row also reaches the list envelope
    const listed = await admin.request("/api/admin/leadgen/offers", {}, env);
    const listBody = (await listed.json()) as { items: LeadgenOfferApi[]; paging: Paging };
    expect(listBody.items).toHaveLength(1);
    expect(listBody.paging.total).toBe(1);
  });

  it("a well-formed but nonexistent public_id → 404 JSON error envelope", async () => {
    const { env } = newHarness();
    const absentId = mintPublicId("offer");
    const res = await admin.request(`/api/admin/leadgen/offers/${absentId}`, {}, env);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe("string");
  });
});

// --- host gate + auth (full src/index.ts app) ---------------------------------

// Minimal D1 stub — these tests only assert status codes before any handler
// touches the DB (admin-auth.test.ts pattern).
const noopD1 = {
  prepare() {
    const stmt = {
      bind() {
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        return null;
      },
      async run() {
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        return { results: [] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  },
} as unknown as D1Database;

const gateEnv: Env = {
  DB: noopD1,
  CACHE: {} as KVNamespace,
  MEDIA: {} as R2Bucket,
  APP_ENV: "test",
  ADMIN_HOST: "cms.kodigital.app",
  ADMIN_BASE_URL: "https://cms.kodigital.app",
  ADMIN_BASE_PATH: "/admin",
  CACHE_API_ENABLED: "false",
  HTML_CACHE_TTL_SECONDS: "60",
  OPENAI_TEXT_MODEL: "",
  OPENAI_IMAGE_MODEL: "",
  SITE_PROVISIONING_DRY_RUN: "true",
  SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
};

const authEnv: Env = { ...gateEnv, ADMIN_HOST: "localhost", ADMIN_BASE_URL: "http://localhost:8787" };

describe("leadgen off-ADMIN_HOST 404 wall (03 §9.1)", () => {
  it("off-ADMIN_HOST GET /admin/leadgen returns a flat 404", async () => {
    const res = await app.request("https://example.com/admin/leadgen", {}, { ...gateEnv });
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.text();
    expect(body).not.toContain("cms.kodigital.app");
  });

  it("off-ADMIN_HOST GET /api/admin/leadgen/offers returns a flat 404", async () => {
    const res = await app.request(
      "https://example.com/api/admin/leadgen/offers",
      {},
      { ...gateEnv },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.text();
    expect(body).not.toContain("cms.kodigital.app");
  });
});

describe("leadgen accessAuth gate (03 §9.1 — no JWT, no dev bypass)", () => {
  it("unauthenticated /admin/leadgen is rejected exactly like /admin/listicles", async () => {
    const leadgen = await app.request("/admin/leadgen", {}, { ...authEnv });
    const listicles = await app.request("/admin/listicles", {}, { ...authEnv });
    expect(leadgen.status).toBe(401);
    expect(leadgen.status).toBe(listicles.status);
    const body = (await leadgen.json()) as { error: string };
    expect(body.error).toMatch(/Unauthorized/i);
  });

  it("unauthenticated /api/admin/leadgen/offers is rejected exactly like the listicles API", async () => {
    const leadgen = await app.request("/api/admin/leadgen/offers", {}, { ...authEnv });
    const listicles = await app.request("/api/admin/listicles/offers", {}, { ...authEnv });
    expect(leadgen.status).toBe(401);
    expect(leadgen.status).toBe(listicles.status);
  });
});
