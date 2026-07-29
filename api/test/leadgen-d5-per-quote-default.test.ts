// LeadGen R2 fixing mission · P2 D5 (contract §7 D5; SOURCE-OF-TRUTH A.1 #11-D
// + ADJ-B2 owner ruling: "the user should be able to define the 'default'
// template, but to A/B test different templates" — "Set as default" was
// GLOBAL across every quote; the owner ruled a PER-QUOTE default via a NEW
// dedicated table (migration 0055), the global is_default staying the
// cross-quote FALLBACK).
//
// Real producer->consumer flow (the leadgen-rework-board.test.ts / node:sqlite
// D1 harness pattern): every leg drives the REAL admin router's HTTP handlers
// (createQuoteHandler / createQuoteFunnelHandler / patchQuoteHandler) and the
// REAL resolver.ts serve-time function — never hand-builds both sides of a
// boundary.

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { resolveSavedFrameTemplateDefaultsFor, type ResolvedActivatedFunnel } from "../src/public/leadgen/resolver";
import type { LeadgenQuoteRow, LeadgenFunnelRow, LeadgenFunnelVariantRow } from "../src/admin/leadgen/db-types";

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
      if (typeof getBuiltin === "function") return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
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
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T = unknown>(): Promise<T | null> { return (sdb.prepare(sql).get(...binds) ?? null) as T | null; },
        async all<T = unknown>() { return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }; },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      try {
        const out: unknown[] = [];
        for (const s of statements) out.push(await s.run());
        runSql(sdb, "COMMIT");
        return out;
      } catch (e) {
        runSql(sdb, "ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql", "0037_leadgen_analytics_mirror.sql", "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql", "0040_leadgen_runtime_context.sql", "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql", "0043_leadgen_routing_rules.sql", "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql", "0046_leadgen_rework_m1_variants.sql", "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql", "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql", "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql", "0053_leadgen_rework_m12_othergroup_retirement.sql",
  "0054_leadgen_analytics_routing_dims.sql", "0055_leadgen_quote_default_template.sql",
] as const;

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db, CACHE: {} as KVNamespace, MEDIA: {} as R2Bucket, APP_ENV: "test",
    ADMIN_HOST: "localhost", ADMIN_BASE_URL: "http://localhost:8787", ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "60", OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test", SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false", DEV_BYPASS_AUTH: "true",
  } as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

interface FrameTemplateRow { id: number; public_id: string; name: string; is_default: number }
interface QuoteDetail {
  id: number;
  public_id: string;
  default_template_id: string | null;
  funnels: Array<{ id: number; public_id: string; frame_template_id: number | null; variants: Array<{ public_id: string }> }>;
}
interface FunnelApi { id: number; public_id: string; frame_template_id: number | null }

describeDb("R2 D5 (contract §7 D5) — per-quote default frame template", () => {
  it("0055 is re-runnable (INSERT OR IGNORE + CREATE TABLE IF NOT EXISTS are true no-ops on a second pass)", () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const before = (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_quote_default_template").get() as { n: number }).n;
    // Re-execute the RAW migration file a second time (bypassing any migration-
    // tracking bookkeeping) — the SQL itself must tolerate re-application.
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0055_leadgen_quote_default_template.sql"), "utf8"));
    const after = (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_quote_default_template").get() as { n: number }).n;
    expect(after).toBe(before);
  });

  describe("three driven legs", () => {
    let env: Env;
    let templates: FrameTemplateRow[];

    beforeAll(async () => {
      const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
      env = buildEnv(d1FromSqlite(sdb));
      templates = sdb.prepare("SELECT id, public_id, name, is_default FROM leadgen_frame_templates ORDER BY id ASC").all() as FrameTemplateRow[];
    });

    it("global default is 'Centered card' (id 1, is_default=1) — the seed's known-good baseline", () => {
      expect(templates.find((t) => t.is_default === 1)?.id).toBe(1);
    });

    it("leg (i): set a per-quote default -> a funnel created AFTER inherits it", async () => {
      const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "D5 Leg1", activity: "quote_funnel", verticals: ["auto"] }), env);
      expect(cq.status, await cq.clone().text()).toBe(201);
      const quote = (await cq.json()) as QuoteDetail;
      expect(quote.default_template_id).toBeNull();

      const nonDefault = templates.find((t) => t.is_default === 0)!;
      const patch = await admin.request(`${API}/quotes/${quote.public_id}`, jsonInit("PATCH", { default_template_id: nonDefault.id }), env);
      expect(patch.status, await patch.clone().text()).toBe(200);
      const patched = (await patch.json()) as QuoteDetail;
      expect(patched.default_template_id).toBe(nonDefault.public_id);

      const cf = await admin.request(`${API}/quotes/${quote.public_id}/funnels`, jsonInit("POST", { funnel_name: "After the default was set" }), env);
      expect(cf.status, await cf.clone().text()).toBe(201);
      const funnel = (await cf.json()) as FunnelApi;
      // Config/DB evidence: the served frame_template_id column equals the
      // PER-QUOTE override's numeric id, not the global default's (1).
      expect(funnel.frame_template_id).toBe(nonDefault.id);
      expect(funnel.frame_template_id).not.toBe(1);
    });

    it("leg (ii): an existing funnel with an explicit template is UNTOUCHED when the per-quote default later changes (create-time seed never re-templates)", async () => {
      const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "D5 Leg2", activity: "quote_funnel", verticals: ["auto"] }), env);
      const quote = (await cq.json()) as QuoteDetail;
      const firstTemplate = templates[2]!; // "Header + call CTA" (id 3), not the global default
      await admin.request(`${API}/quotes/${quote.public_id}`, jsonInit("PATCH", { default_template_id: firstTemplate.id }), env);
      const cf = await admin.request(`${API}/quotes/${quote.public_id}/funnels`, jsonInit("POST", { funnel_name: "Explicit-template funnel" }), env);
      const funnel = (await cf.json()) as FunnelApi;
      expect(funnel.frame_template_id).toBe(firstTemplate.id);

      // Change the per-quote default to something ELSE entirely.
      const secondTemplate = templates[4]!; // "White + trust bar" (id 5)
      const patch2 = await admin.request(`${API}/quotes/${quote.public_id}`, jsonInit("PATCH", { default_template_id: secondTemplate.id }), env);
      expect(patch2.status).toBe(200);

      // Re-read the EXISTING funnel — its own explicit frame_template_id must
      // stand (DB evidence: the column is still the FIRST template's id).
      const refetch = await admin.request(`${API}/quotes/${quote.public_id}/funnels`, {}, env);
      const list = (await refetch.json()) as { items: FunnelApi[] };
      const existing = list.items.find((f) => f.public_id === funnel.public_id)!;
      expect(existing.frame_template_id).toBe(firstTemplate.id);
      expect(existing.frame_template_id).not.toBe(secondTemplate.id);

      // Serve-time precedence (resolver.ts, real function, real D1 rows):
      // an explicit funnel.frame_template_id ALWAYS wins over the per-quote
      // default, regardless of variant.
      const quoteRow = { id: quote.id, public_id: quote.public_id } as LeadgenQuoteRow;
      const funnelRow = { frame_template_id: existing.frame_template_id } as LeadgenFunnelRow;
      const variantRow = { frame_template_id: null } as LeadgenFunnelVariantRow;
      const served = await resolveSavedFrameTemplateDefaultsFor(env.DB, {
        quote: quoteRow,
        funnel: funnelRow,
        variant: variantRow,
      } as Pick<ResolvedActivatedFunnel, "funnel" | "variant" | "quote">);
      expect(served?.template).toBe("header-cta"); // firstTemplate's frame_json.template string
    });

    it("leg (iii): a second quote with no per-quote row falls back to the global default", async () => {
      const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "D5 Leg3", activity: "quote_funnel", verticals: ["auto"] }), env);
      const quote = (await cq.json()) as QuoteDetail;
      expect(quote.default_template_id).toBeNull(); // never set for this quote

      const cf = await admin.request(`${API}/quotes/${quote.public_id}/funnels`, jsonInit("POST", { funnel_name: "No per-quote row" }), env);
      const funnel = (await cf.json()) as FunnelApi;
      expect(funnel.frame_template_id).toBe(1); // the seeded global is_default

      // Serve-time: no explicit ftid anywhere AND no per-quote row -> "none"
      // (null) per the contract's exact chain — resolver.ts never falls
      // further to the global is_default at serve time.
      const served = await resolveSavedFrameTemplateDefaultsFor(env.DB, {
        quote: { id: quote.id, public_id: quote.public_id } as LeadgenQuoteRow,
        funnel: { frame_template_id: null } as LeadgenFunnelRow,
        variant: { frame_template_id: null } as LeadgenFunnelVariantRow,
      } as Pick<ResolvedActivatedFunnel, "funnel" | "variant" | "quote">);
      expect(served).toBeNull();
    });

    it("serve-time: a per-quote default DOES resolve as the final fallback when neither funnel nor variant has an explicit ftid", async () => {
      const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "D5 Serve Fallback", activity: "quote_funnel", verticals: ["auto"] }), env);
      const quote = (await cq.json()) as QuoteDetail;
      const tpl = templates[1]!; // "Site header + footer" (id 2)
      await admin.request(`${API}/quotes/${quote.public_id}`, jsonInit("PATCH", { default_template_id: tpl.id }), env);
      const served = await resolveSavedFrameTemplateDefaultsFor(env.DB, {
        quote: { id: quote.id, public_id: quote.public_id } as LeadgenQuoteRow,
        funnel: { frame_template_id: null } as LeadgenFunnelRow, // a PRE-existing funnel from before D5 (never seeded)
        variant: { frame_template_id: null } as LeadgenFunnelVariantRow,
      } as Pick<ResolvedActivatedFunnel, "funnel" | "variant" | "quote">);
      expect(served?.template).toBe("header-footer");
    });

    it("clearing the per-quote default (null) falls back to the global default at create-time", async () => {
      const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "D5 Clear", activity: "quote_funnel", verticals: ["auto"] }), env);
      const quote = (await cq.json()) as QuoteDetail;
      const tpl = templates[3]!;
      await admin.request(`${API}/quotes/${quote.public_id}`, jsonInit("PATCH", { default_template_id: tpl.id }), env);
      const clear = await admin.request(`${API}/quotes/${quote.public_id}`, jsonInit("PATCH", { default_template_id: null }), env);
      expect(clear.status, await clear.clone().text()).toBe(200);
      expect(((await clear.clone().json()) as QuoteDetail).default_template_id).toBeNull();
      const cf = await admin.request(`${API}/quotes/${quote.public_id}/funnels`, jsonInit("POST", { funnel_name: "After clear" }), env);
      const funnel = (await cf.json()) as FunnelApi;
      expect(funnel.frame_template_id).toBe(1);
    });

    it("PATCH rejects an unknown default_template_id", async () => {
      const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "D5 Bad Id", activity: "quote_funnel", verticals: ["auto"] }), env);
      const quote = (await cq.json()) as QuoteDetail;
      const res = await admin.request(`${API}/quotes/${quote.public_id}`, jsonInit("PATCH", { default_template_id: 999999 }), env);
      expect(res.status).toBe(400);
    });
  });
});
