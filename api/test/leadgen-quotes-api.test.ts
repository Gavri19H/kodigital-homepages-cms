// LeadGen Phase 7 Stage B — the contract 03 §8.2 Quotes block over the REAL
// admin router + REAL 0036–0039 migrations (node:sqlite harness; the
// leadgen-sections-api.test.ts pattern with DEV_BYPASS_AUTH). Covers: §15.1
// Quote/Funnel/Variant CRUD + the funnel_id≠funnel_variant_id identity carried
// through create→structure; §15.3 variant PUT section-order replace-set
// (contiguous positions, auction-entry = MAX, verified IN THE DB); §15.5 funnel
// rule replace-set + redirect safety (target_offer_id vs the raw-URL allowlist);
// §17 activation (one enabled root per site, dup slug, preview URL, both
// sides); §15.3 structure tree; §15.6 analytics NULLIF ratios; dual-id +
// no-store headers + 404 semantics; the P8 A/B seam (create + start/stop).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { isPublicId, mintPublicId } from "../src/leadgen/ids";
import { assignVariant } from "../src/public/leadgen/ab-hash";

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
  // sites carries `domain` (§17.2 tenant-host preview URL) + two seeded sites.
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-2','Site Two','two.example.com');",
  );
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

function buildEnv(db: D1Database): Env {
  const env = {
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
  // §15.5 admin raw-redirect allowlist (read via a widening cast in the handler).
  (env as unknown as Record<string, unknown>).LEADGEN_REDIRECT_URL_ALLOWLIST = "partner.example.com";
  return env;
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

// --- direct-SQL seeding (sections + auctions + analytics) --------------------

function seedSection(
  sdb: SqliteDb,
  opts: { activity: string; vertical: string; name?: string; status?: string },
): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "f", answer_type: "boolean" }] });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, ?, ?, ?, ?, 'button', ?)",
    )
    .run(publicId, opts.name ?? `Section ${publicId.slice(-4)}`, opts.activity, opts.vertical, "Headline", content, opts.status ?? "active");
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

function seedOffer(sdb: SqliteDb, opts: { activity?: string; vertical?: string } = {}): { id: number; public_id: string } {
  const publicId = mintPublicId("offer");
  sdb
    .prepare(
      "INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type) VALUES (?, ?, ?, ?, 's2s_postback', 'cpl')",
    )
    .run(publicId, `Offer ${publicId.slice(-4)}`, opts.activity ?? "quote_funnel", opts.vertical ?? "life");
  const row = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

function seedAuction(sdb: SqliteDb, name = "Test Auction"): { id: number; public_id: string } {
  const publicId = mintPublicId("auction");
  sdb
    .prepare("INSERT INTO leadgen_auctions (public_id, auction_name, auction_type) VALUES (?, ?, 'static')")
    .run(publicId, name);
  const row = sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

function seedQuoteAnalytics(
  sdb: SqliteDb,
  r: { quote_public_id: string; funnel_id: string; funnel_name: string; date: string; visits: number; completions: number; clicks: number; conversions: number; unfilled: number; revenue: number },
): void {
  sdb
    .prepare(
      `INSERT INTO leadgen_analytics_quote (quote_public_id, funnel_id, funnel_name, date, visits, unique_visits, bounces, completions, clicks, conversions, unfilled, revenue)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    )
    .run(r.quote_public_id, r.funnel_id, r.funnel_name, r.date, r.visits, r.visits, r.completions, r.clicks, r.conversions, r.unfilled, r.revenue);
}

// --- Quote seeding (through the REAL P7 API) ---------------------------------

interface VariantJson {
  id: number;
  public_id: string;
  funnel_variant_id: string;
  is_control: boolean;
  funnel_design_id: string;
  auction_id: number | null;
  [key: string]: unknown;
}
interface FunnelJson {
  id: number;
  public_id: string;
  funnel_id: string;
  funnel_name: string;
  variants: VariantJson[];
  [key: string]: unknown;
}
interface QuoteDetail {
  id: number;
  public_id: string;
  quote_name: string;
  activity: string;
  verticals_json: string[];
  status: string;
  funnels: FunnelJson[];
}

async function createQuote(env: Env, overrides: Record<string, unknown> = {}): Promise<QuoteDetail> {
  const res = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", {
      quote_name: "Life Quote",
      activity: "quote_funnel",
      verticals: ["life", "health"],
      ...overrides,
    }),
    env,
  );
  expect(res.status, `create quote: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as QuoteDetail;
}

// ===========================================================================

describeDb("§15.1 Quote CRUD + auto-seeded funnel/control-variant", () => {
  it("POST /quotes mints lgq_ + one lgf_ funnel + one lgn_ control variant", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    expect(isPublicId("quote", q.public_id)).toBe(true);
    expect(q.funnels).toHaveLength(1);
    const funnel = q.funnels[0]!;
    expect(isPublicId("funnel", funnel.public_id)).toBe(true);
    expect(funnel.variants).toHaveLength(1);
    const variant = funnel.variants[0]!;
    expect(isPublicId("funnel_variant", variant.public_id)).toBe(true);
    expect(variant.is_control).toBe(true);
    expect(q.verticals_json).toEqual(["life", "health"]);
  });

  it("POST /quotes rejects missing name / verticals (400 with field errors)", async () => {
    const { env } = newHarness();
    const res = await admin.request(`${API}/quotes`, jsonInit("POST", { activity: "quote_funnel" }), env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: Record<string, string> };
    expect(body.fields.quote_name).toBeTruthy();
    expect(body.fields.verticals).toBeTruthy();
  });

  it("GET /quotes/:id resolves by BOTH numeric id and public_id (dual-id)", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const byPublic = await admin.request(`${API}/quotes/${q.public_id}`, {}, env);
    const byNumeric = await admin.request(`${API}/quotes/${q.id}`, {}, env);
    expect(byPublic.status).toBe(200);
    expect(byNumeric.status).toBe(200);
    expect(((await byPublic.json()) as QuoteDetail).public_id).toBe(q.public_id);
    expect(((await byNumeric.json()) as QuoteDetail).public_id).toBe(q.public_id);
  });

  it("PATCH /quotes/:id updates name/verticals/status; DELETE archives", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const patched = await admin.request(`${API}/quotes/${q.public_id}`, jsonInit("PATCH", { quote_name: "Renamed", status: "active" }), env);
    expect(patched.status).toBe(200);
    const pj = (await patched.json()) as QuoteDetail;
    expect(pj.quote_name).toBe("Renamed");
    expect(pj.status).toBe("active");
    const del = await admin.request(`${API}/quotes/${q.public_id}`, { method: "DELETE" }, env);
    expect(del.status).toBe(200);
    expect(((await del.json()) as { status: string }).status).toBe("archived");
  });

  it("GET /quotes list carries variant_count, active_sites_count, ab_status", async () => {
    const { env } = newHarness();
    await createQuote(env);
    const res = await admin.request(`${API}/quotes`, {}, env);
    const body = (await res.json()) as { items: Array<{ variant_count: number; active_sites_count: number; ab_status: string }>; paging: unknown };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.variant_count).toBe(1);
    expect(body.items[0]!.active_sites_count).toBe(0);
    expect(body.items[0]!.ab_status).toBe("none");
  });
});

describeDb("§15.1 the funnel_id ≠ funnel_variant_id identity (G4) through create→structure", () => {
  it("structure stamps distinct lgf_ funnel_id and lgn_ funnel_variant_id equal to the created ids", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const createdFunnelId = q.funnels[0]!.public_id;
    const createdVariantId = q.funnels[0]!.variants[0]!.public_id;

    const res = await admin.request(`${API}/quotes/${q.public_id}/structure`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      quote: { quote_id: string };
      funnels: Array<{ funnel_id: string; public_id: string; variants: Array<{ funnel_id: string; funnel_variant_id: string; public_id: string }> }>;
    };
    const f = body.funnels[0]!;
    const v = f.variants[0]!;
    // funnel_id is lgf_, funnel_variant_id is lgn_, and they are NOT equal.
    expect(isPublicId("funnel", f.funnel_id)).toBe(true);
    expect(isPublicId("funnel_variant", v.funnel_variant_id)).toBe(true);
    expect(f.funnel_id).not.toBe(v.funnel_variant_id);
    // they round-trip the values minted on create.
    expect(f.funnel_id).toBe(createdFunnelId);
    expect(v.funnel_variant_id).toBe(createdVariantId);
    // the variant carries its parent funnel_id (stable), distinct from its own variant id.
    expect(v.funnel_id).toBe(createdFunnelId);
    expect(v.funnel_id).not.toBe(v.funnel_variant_id);
    expect(isPublicId("quote", body.quote.quote_id)).toBe(true);
  });
});

describeDb("§6.2/§15.1 Funnel CRUD under a Quote", () => {
  it("POST /quotes/:id/funnels mints a new lgf_ + control variant; GET/PATCH/DELETE /funnels/:id", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const created = await admin.request(`${API}/quotes/${q.public_id}/funnels`, jsonInit("POST", { funnel_name: "Funnel B" }), env);
    expect(created.status).toBe(201);
    const fj = (await created.json()) as FunnelJson;
    expect(isPublicId("funnel", fj.public_id)).toBe(true);
    expect(fj.variants).toHaveLength(1);
    expect(isPublicId("funnel_variant", fj.variants[0]!.public_id)).toBe(true);

    const got = await admin.request(`${API}/funnels/${fj.public_id}`, {}, env);
    expect(got.status).toBe(200);

    const patched = await admin.request(`${API}/funnels/${fj.public_id}`, jsonInit("PATCH", { funnel_name: "Funnel B2" }), env);
    expect(((await patched.json()) as FunnelJson).funnel_name).toBe("Funnel B2");

    const del = await admin.request(`${API}/funnels/${fj.public_id}`, { method: "DELETE" }, env);
    expect(((await del.json()) as { status: string }).status).toBe("archived");

    const list = await admin.request(`${API}/quotes/${q.public_id}/funnels`, {}, env);
    expect(((await list.json()) as { items: unknown[] }).items.length).toBe(2);
  });
});

describeDb("§15.3 variant PUT — section-order replace-set (contiguous, auction=MAX, DB-verified)", () => {
  it("saves an ordered section list → positions 0..n-1 in the DB; auction_entry = MAX", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life", name: "S1" });
    const s2 = seedSection(sdb, { activity: "quote_funnel", vertical: "health", name: "S2" });
    const s3 = seedSection(sdb, { activity: "quote_funnel", vertical: "life", name: "S3" });

    const res = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { sections: [{ section_id: s1.id }, { section_id: s2.id }, { section_id: s3.id }] }),
      env,
    );
    expect(res.status, `put: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { sections: Array<{ position: number; section_id: number }>; auction_entry_position: number };
    expect(body.sections.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(body.auction_entry_position).toBe(2);

    // verify the DB rows directly (positions contiguous, correct section ids)
    const rows = sdb
      .prepare("SELECT section_id, position FROM leadgen_funnel_variant_sections WHERE variant_id = (SELECT id FROM leadgen_funnel_variants WHERE public_id = ?) ORDER BY position ASC")
      .all(variantId) as Array<{ section_id: number; position: number }>;
    expect(rows).toEqual([
      { section_id: s1.id, position: 0 },
      { section_id: s2.id, position: 1 },
      { section_id: s3.id, position: 2 },
    ]);
  });

  it("a re-save REPLACES the section set (replace-set, not append)", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life" });
    const s2 = seedSection(sdb, { activity: "quote_funnel", vertical: "life" });
    await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: s1.id }, { section_id: s2.id }] }), env);
    // re-save with only s2
    const res = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: s2.id }] }), env);
    const body = (await res.json()) as { sections: Array<{ section_id: number; position: number }>; auction_entry_position: number };
    expect(body.sections).toEqual([{ position: 0, section_id: s2.id, section_public_id: s2.public_id, section_name: expect.any(String), activity: "quote_funnel", vertical: "life", status: "active" }]);
    expect(body.auction_entry_position).toBe(0);
    const count = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_variant_sections WHERE variant_id = (SELECT id FROM leadgen_funnel_variants WHERE public_id = ?)").get(variantId) as { n: number };
    expect(count.n).toBe(1);
  });

  it("rejects NON-contiguous explicit positions (validateFunnelBuilder)", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life" });
    const s2 = seedSection(sdb, { activity: "quote_funnel", vertical: "life" });
    const res = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { sections: [{ section_id: s1.id, position: 0 }, { section_id: s2.id, position: 2 }] }),
      env,
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: { sections: string } }).fields.sections).toMatch(/contiguous/);
  });

  it("rejects a section whose activity/vertical does not match the quote", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const wrongActivity = seedSection(sdb, { activity: "other_activity", vertical: "life" });
    const wrongVertical = seedSection(sdb, { activity: "quote_funnel", vertical: "auto" });
    const r1 = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: wrongActivity.id }] }), env);
    expect(r1.status).toBe(400);
    expect(JSON.stringify((await r1.json()))).toMatch(/activity/);
    const r2 = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: wrongVertical.id }] }), env);
    expect(r2.status).toBe(400);
    expect(JSON.stringify((await r2.json()))).toMatch(/vertical/);
  });

  it("saves lander + design + auction FK; rejects a nonexistent auction id", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const auction = seedAuction(sdb);
    const ok = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { lander_enabled: true, lander_headline: "Hi", funnel_design_id: "default-funnel", auction_id: auction.id }),
      env,
    );
    expect(ok.status, `put lander: ${await ok.clone().text()}`).toBe(200);
    const body = (await ok.json()) as { lander_enabled: boolean; funnel_design_id: string; auction_id: number };
    expect(body.lander_enabled).toBe(true);
    expect(body.funnel_design_id).toBe("default-funnel");
    expect(body.auction_id).toBe(auction.id);

    const bad = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { auction_id: 999999 }), env);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { fields: { auction_id: string } }).fields.auction_id).toMatch(/does not exist/);
  });
});

describeDb("§15.5 variant PUT — funnel-rule replace-set + redirect safety", () => {
  async function putRules(env: Env, variantId: string, rules: unknown): Promise<Response> {
    return admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { rules }), env);
  }

  it("redirect_direct_offer WITHOUT target_offer_id is rejected", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const res = await putRules(env, variantId, [{ rule_type: "redirect_direct_offer" }]);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/redirect_offer_missing_target/);
  });

  it("redirect_direct_offer WITH target_offer_id persists + stamps a conditions_hash", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const offer = seedOffer(sdb);
    const res = await putRules(env, variantId, [
      { rule_type: "redirect_direct_offer", target_offer_id: offer.id, conditions_json: { groups: [{ field: "state", op: "eq", value: "CA" }] } },
    ]);
    expect(res.status, `put rules: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { rules: Array<{ rule_type: string; target_offer_id: number; conditions_hash: string; public_id: string }> };
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0]!.target_offer_id).toBe(offer.id);
    expect(isPublicId("funnel_rule", body.rules[0]!.public_id)).toBe(true);
    // conditions_hash is NOT NULL + non-empty in the DB.
    const row = sdb.prepare("SELECT conditions_hash, conditions_json FROM leadgen_funnel_rules WHERE public_id = ?").get(body.rules[0]!.public_id) as { conditions_hash: string; conditions_json: string };
    expect(row.conditions_hash.length).toBeGreaterThan(0);
    expect(row.conditions_json).toContain("state");
  });

  it("a dangling target_offer_id is a clean 400 (not a 500 FK crash)", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const res = await putRules(env, variantId, [{ rule_type: "redirect_direct_offer", target_offer_id: 999999 }]);
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/does not exist/);
  });

  it("a raw redirect_url is honored ONLY when allowlisted AND host ∈ admin allowlist", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;

    // allowlisted flag set, host on the allowlist (partner.example.com) → OK
    const ok = await putRules(env, variantId, [
      { rule_type: "eligibility", redirect_url: "https://partner.example.com/go", redirect_url_allowlisted: true },
    ]);
    expect(ok.status, `allowlisted ok: ${await ok.clone().text()}`).toBe(200);

    // allowlisted flag set but host NOT on the allowlist → rejected
    const badHost = await putRules(env, variantId, [
      { rule_type: "eligibility", redirect_url: "https://evil.example.net/go", redirect_url_allowlisted: true },
    ]);
    expect(badHost.status).toBe(400);
    expect(JSON.stringify(await badHost.json())).toMatch(/host_not_on_allowlist/);

    // raw URL without the allowlisted flag → rejected
    const notFlagged = await putRules(env, variantId, [
      { rule_type: "eligibility", redirect_url: "https://partner.example.com/go", redirect_url_allowlisted: false },
    ]);
    expect(notFlagged.status).toBe(400);
    expect(JSON.stringify(await notFlagged.json())).toMatch(/not_allowlisted/);
  });

  it("rule save is a REPLACE-SET (a second PUT with fewer rules replaces)", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    await putRules(env, variantId, [
      { rule_type: "eligibility" },
      { rule_type: "disqualification" },
    ]);
    await putRules(env, variantId, [{ rule_type: "skip_section" }]);
    const count = sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_rules WHERE variant_id = (SELECT id FROM leadgen_funnel_variants WHERE public_id = ?)").get(variantId) as { n: number };
    expect(count.n).toBe(1);
  });
});

describeDb("§17 activation — one enabled root per site, dup slug, preview URL, both sides", () => {
  it("activates a root (no slug) then GET reflects it + a tenant-host preview URL", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const put = await admin.request(`${API}/quotes/${q.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true }), env);
    expect(put.status, `activate: ${await put.clone().text()}`).toBe(200);
    const pj = (await put.json()) as { enabled: boolean; slug: string | null; preview_url: string };
    expect(pj.enabled).toBe(true);
    expect(pj.slug).toBeNull();
    expect(pj.preview_url).toBe("https://one.example.com/lg");

    const got = await admin.request(`${API}/quotes/${q.public_id}/activation`, {}, env);
    const gj = (await got.json()) as { sites: Array<{ site_id: string; enabled: boolean; activated: boolean; preview_url: string }> };
    const site1 = gj.sites.find((s) => s.site_id === "site-1")!;
    expect(site1.enabled).toBe(true);
    expect(site1.activated).toBe(true);
    expect(site1.preview_url).toBe("https://one.example.com/lg");
  });

  it("a SECOND enabled root on the same site is rejected (uq_leadgen_sitequote_root)", async () => {
    const { env } = newHarness();
    const q1 = await createQuote(env, { quote_name: "Q1" });
    const q2 = await createQuote(env, { quote_name: "Q2" });
    await admin.request(`${API}/quotes/${q1.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true }), env);
    const second = await admin.request(`${API}/quotes/${q2.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true }), env);
    expect(second.status).toBe(400);
    expect(JSON.stringify(await second.json())).toMatch(/root_conflict/);
    // …but the second quote WITH a slug succeeds on the same site.
    const withSlug = await admin.request(`${API}/quotes/${q2.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true, slug: "q2" }), env);
    expect(withSlug.status).toBe(200);
    expect(((await withSlug.json()) as { preview_url: string }).preview_url).toBe("https://one.example.com/lg/q2");
  });

  it("a duplicate slug on the same site is rejected", async () => {
    const { env } = newHarness();
    const q1 = await createQuote(env, { quote_name: "Q1" });
    const q2 = await createQuote(env, { quote_name: "Q2" });
    await admin.request(`${API}/quotes/${q1.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true, slug: "shared" }), env);
    const dup = await admin.request(`${API}/quotes/${q2.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true, slug: "shared" }), env);
    expect(dup.status).toBe(400);
    expect(JSON.stringify(await dup.json())).toMatch(/duplicate_slug/);
  });

  it("DELETE deactivates (enabled → 0, reversible) and frees the root", async () => {
    const { env } = newHarness();
    const q1 = await createQuote(env, { quote_name: "Q1" });
    const q2 = await createQuote(env, { quote_name: "Q2" });
    await admin.request(`${API}/quotes/${q1.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true }), env);
    const del = await admin.request(`${API}/quotes/${q1.public_id}/activation/site-1`, { method: "DELETE" }, env);
    expect(del.status).toBe(200);
    expect(((await del.json()) as { enabled: boolean }).enabled).toBe(false);
    // now q2 can take the root.
    const q2root = await admin.request(`${API}/quotes/${q2.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true }), env);
    expect(q2root.status).toBe(200);
  });
});

describeDb("§15.3 structure tree carries ordered sections + rules per variant", () => {
  it("reflects a variant's saved sections + rules in the full tree", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life", name: "First" });
    await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: s1.id }], rules: [{ rule_type: "eligibility" }] }), env);

    const res = await admin.request(`${API}/quotes/${q.public_id}/structure`, {}, env);
    const body = (await res.json()) as { funnels: Array<{ variants: Array<{ sections: Array<{ section_name: string }>; rules: Array<{ rule_type: string }>; auction_entry_position: number }> }> };
    const v = body.funnels[0]!.variants[0]!;
    expect(v.sections).toHaveLength(1);
    expect(v.sections[0]!.section_name).toBe("First");
    expect(v.rules).toHaveLength(1);
    expect(v.rules[0]!.rule_type).toBe("eligibility");
    expect(v.auction_entry_position).toBe(0);
  });
});

describeDb("§15.6 analytics — per-funnel NULLIF ratios at read", () => {
  it("computes ratios and yields NULL (not 0) on a zero denominator", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const funnelId = q.funnels[0]!.public_id;
    const today = "2026-07-01";
    // funnel A: real denominators.
    seedQuoteAnalytics(sdb, { quote_public_id: q.public_id, funnel_id: funnelId, funnel_name: "A", date: today, visits: 100, completions: 40, clicks: 50, conversions: 10, unfilled: 5, revenue: 200 });
    // funnel B: zero visits + zero clicks → all ratios NULL.
    seedQuoteAnalytics(sdb, { quote_public_id: q.public_id, funnel_id: "lgf_00000000000000000000000000", funnel_name: "B", date: today, visits: 0, completions: 0, clicks: 0, conversions: 3, unfilled: 0, revenue: 9 });

    const res = await admin.request(`${API}/quotes/${q.public_id}/analytics?from=2026-06-01&to=2026-07-31`, {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { analytics: { funnels: Array<{ funnel_id: string; visits: number; completion_rate: number | null; cvr_clicks: number | null; avg_rps: number | null }> } };
    const a = body.analytics.funnels.find((f) => f.funnel_id === funnelId)!;
    const b = body.analytics.funnels.find((f) => f.funnel_id === "lgf_00000000000000000000000000")!;
    expect(a.completion_rate).toBeCloseTo(0.4, 5); // 40/100
    expect(a.cvr_clicks).toBeCloseTo(0.2, 5); // 10/50
    expect(a.avg_rps).toBeCloseTo(2.0, 5); // 200/100
    expect(b.completion_rate).toBeNull(); // 0 visits → NULL, not 0
    expect(b.cvr_clicks).toBeNull(); // 0 clicks → NULL
    expect(b.avg_rps).toBeNull();
  });
});

describeDb("A/B — §16.2 allocation + lifecycle (P8)", () => {
  it("creates an ab_test (draft) with a §16.2 allocation note; a single-variant (Σ=10000) start → running, stop → stopped", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const create = await admin.request(`${API}/quotes/${q.public_id}/experiments`, jsonInit("POST", { name: "Test 1" }), env);
    expect(create.status, `create ab: ${await create.clone().text()}`).toBe(201);
    const cj = (await create.json()) as { public_id: string; status: string; allocation_note: string };
    expect(isPublicId("funnel_ab_test", cj.public_id)).toBe(true);
    expect(cj.status).toBe("draft");
    // the note now describes the LIVE Σ==10000 rule (no longer "ships in P8").
    expect(cj.allocation_note).toMatch(/10000/);
    expect(cj.allocation_note).not.toMatch(/ships in P8/i);

    // single control variant defaults to bp 10000 → Σ==10000 → start succeeds.
    const start = await admin.request(`${API}/experiments/${cj.public_id}/start`, { method: "POST" }, env);
    expect(((await start.json()) as { status: string }).status).toBe("running");

    // a second running test on the same funnel is refused (uq_leadgen_abtest_running).
    const create2 = await admin.request(`${API}/quotes/${q.public_id}/experiments`, jsonInit("POST", {}), env);
    const cj2 = (await create2.json()) as { public_id: string };
    const start2 = await admin.request(`${API}/experiments/${cj2.public_id}/start`, { method: "POST" }, env);
    expect(start2.status).toBe(400);

    const stop = await admin.request(`${API}/experiments/${cj.public_id}/stop`, { method: "POST" }, env);
    expect(((await stop.json()) as { status: string }).status).toBe("stopped");
  });

  it("start REJECTS a test whose active variants' bp do NOT sum to 10000 (§16.2 Σ gate)", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const control = q.funnels[0]!.variants[0]!.public_id;
    // fork the control → a 2nd active variant that COPIES bp 10000 → Σ = 20000.
    const fork = await admin.request(`${API}/variants/${control}/fork`, { method: "POST" }, env);
    expect(fork.status).toBe(201);
    const forked = (await fork.json()) as { public_id: string };

    const create = await admin.request(`${API}/quotes/${q.public_id}/experiments`, jsonInit("POST", {}), env);
    const ab = (await create.json()) as { public_id: string };

    // Σ = 20000 ≠ 10000 → start 400 with a traffic_allocation_bp field error.
    const bad = await admin.request(`${API}/experiments/${ab.public_id}/start`, { method: "POST" }, env);
    expect(bad.status, `start should reject Σ≠10000`).toBe(400);
    const badBody = (await bad.json()) as { error: string; fields: Record<string, string> };
    expect(badBody.fields.traffic_allocation_bp).toMatch(/10000/);
    // it did NOT start — the structure (which now surfaces ab_tests) shows draft.
    const struct1 = (await (await admin.request(`${API}/quotes/${q.public_id}/structure`, {}, env)).json()) as {
      funnels: Array<{ ab_tests: Array<{ public_id: string; status: string }> }>;
    };
    const abRow1 = struct1.funnels[0]!.ab_tests.find((t) => t.public_id === ab.public_id);
    expect(abRow1?.status).toBe("draft");

    // split 50/50 (bp 5000 each) → Σ = 10000 → start succeeds AND bumps revision.
    expect((await admin.request(`${API}/variants/${control}`, jsonInit("PUT", { traffic_allocation_bp: 5000 }), env)).status).toBe(200);
    expect((await admin.request(`${API}/variants/${forked.public_id}`, jsonInit("PUT", { traffic_allocation_bp: 5000 }), env)).status).toBe(200);
    const ok = await admin.request(`${API}/experiments/${ab.public_id}/start`, { method: "POST" }, env);
    expect(ok.status, `start should accept Σ==10000: ${await ok.clone().text()}`).toBe(200);
    const okBody = (await ok.json()) as { status: string; revision: number };
    expect(okBody.status).toBe("running");
    // create seeds revision=1; start bumps to 2 (§16.2 re-bucket).
    expect(okBody.revision).toBe(2);
  });

  it("a per-variant allocation SAVE that breaks a RUNNING test's Σ==10000 is rejected; the guard lifts after stop", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const control = q.funnels[0]!.variants[0]!.public_id;
    const fork = await admin.request(`${API}/variants/${control}/fork`, { method: "POST" }, env);
    const forked = (await fork.json()) as { public_id: string };
    // draft editing is free (no running test) → split 50/50, then start.
    await admin.request(`${API}/variants/${control}`, jsonInit("PUT", { traffic_allocation_bp: 5000 }), env);
    await admin.request(`${API}/variants/${forked.public_id}`, jsonInit("PUT", { traffic_allocation_bp: 5000 }), env);
    const create = await admin.request(`${API}/quotes/${q.public_id}/experiments`, jsonInit("POST", {}), env);
    const ab = (await create.json()) as { public_id: string };
    expect((await admin.request(`${API}/experiments/${ab.public_id}/start`, { method: "POST" }, env)).status).toBe(200);

    // While RUNNING: bumping one arm to 6000 (→ Σ 11000) breaks the invariant → 400.
    const bad = await admin.request(`${API}/variants/${control}`, jsonInit("PUT", { traffic_allocation_bp: 6000 }), env);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { fields: Record<string, string> }).fields.traffic_allocation_bp).toMatch(/10000/);

    // a NON-allocation save (lander only) is unaffected by the guard while running.
    expect((await admin.request(`${API}/variants/${control}`, jsonInit("PUT", { lander_headline: "Hi" }), env)).status).toBe(200);

    // stop the test → per-variant allocation edits are free again (draft-style).
    await admin.request(`${API}/experiments/${ab.public_id}/stop`, { method: "POST" }, env);
    expect((await admin.request(`${API}/variants/${control}`, jsonInit("PUT", { traffic_allocation_bp: 6000 }), env)).status).toBe(200);
  });

  it("assignment-preview returns the SAME variant + bucket assignVariant computes (zero drift)", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const control = q.funnels[0]!.variants[0]!.public_id;
    const fork = await admin.request(`${API}/variants/${control}/fork`, { method: "POST" }, env);
    const forked = (await fork.json()) as { public_id: string };
    await admin.request(`${API}/variants/${control}`, jsonInit("PUT", { traffic_allocation_bp: 5000 }), env);
    await admin.request(`${API}/variants/${forked.public_id}`, jsonInit("PUT", { traffic_allocation_bp: 5000 }), env);
    const create = await admin.request(`${API}/quotes/${q.public_id}/experiments`, jsonInit("POST", {}), env);
    const ab = (await create.json()) as { public_id: string };
    const started = (await (await admin.request(`${API}/experiments/${ab.public_id}/start`, { method: "POST" }, env)).json()) as {
      public_id: string;
      revision: number;
    };

    // arms exactly as the runtime resolver sees them (funnel-scoped, from structure).
    const struct = (await (await admin.request(`${API}/quotes/${q.public_id}/structure`, {}, env)).json()) as {
      funnels: Array<{ variants: Array<{ public_id: string; variant_label: string; traffic_allocation_bp: number; status: string }> }>;
    };
    const arms = struct.funnels[0]!.variants
      .filter((v) => v.status === "active")
      .map((v) => ({ variant_label: v.variant_label, traffic_allocation_bp: v.traffic_allocation_bp, public_id: v.public_id }));

    for (const sid of ["preview-a", "preview-b", "preview-c"]) {
      const expected = assignVariant(started.public_id, started.revision, sid, arms);
      const res = await admin.request(
        `${API}/experiments/${ab.public_id}/assignment-preview?session_id=${encodeURIComponent(sid)}`,
        {},
        env,
      );
      expect(res.status, `preview ${sid}`).toBe(200);
      const body = (await res.json()) as { assignment_bucket: number; variant: { funnel_variant_id: string } };
      expect(body.variant.funnel_variant_id).toBe(expected.variant.public_id);
      expect(body.assignment_bucket).toBe(expected.assignment_bucket);
    }

    // a missing session_id is a clean 400.
    expect((await admin.request(`${API}/experiments/${ab.public_id}/assignment-preview`, {}, env)).status).toBe(400);
  });

  it("POST /variants/:id/fork clones sections+rules into a NEW lgn_ variant", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life" });
    await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: [{ section_id: s1.id }], rules: [{ rule_type: "eligibility" }] }), env);
    const fork = await admin.request(`${API}/variants/${variantId}/fork`, { method: "POST" }, env);
    expect(fork.status).toBe(201);
    const fj = (await fork.json()) as { public_id: string; is_control: boolean; sections: unknown[]; rules: unknown[]; forked_from: string };
    expect(isPublicId("funnel_variant", fj.public_id)).toBe(true);
    expect(fj.public_id).not.toBe(variantId);
    expect(fj.forked_from).toBe(variantId);
    expect(fj.is_control).toBe(false);
    expect(fj.sections).toHaveLength(1);
    expect(fj.rules).toHaveLength(1);
  });
});

// MINOR-2 — the fork must be ATOMIC: the variant + its cloned sections/rules
// commit together, or not at all. A NON-atomic fork inserts the variant first
// and clones its children in a SEPARATE batch, so a mid-clone failure orphans a
// variant with no sections/rules.
describeDb("POST /variants/:id/fork — atomicity (MINOR-2)", () => {
  it("clones MULTIPLE sections + rules — lands them ALL on the new variant", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life" });
    const s2 = seedSection(sdb, { activity: "quote_funnel", vertical: "life" });
    const s3 = seedSection(sdb, { activity: "quote_funnel", vertical: "health" });
    const put = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", {
        sections: [{ section_id: s1.id }, { section_id: s2.id }, { section_id: s3.id }],
        rules: [{ rule_type: "eligibility" }, { rule_type: "skip_section" }],
      }),
      env,
    );
    expect(put.status, `put: ${await put.clone().text()}`).toBe(200);

    const fork = await admin.request(`${API}/variants/${variantId}/fork`, { method: "POST" }, env);
    expect(fork.status, `fork: ${await fork.clone().text()}`).toBe(201);
    const fj = (await fork.json()) as { public_id: string; sections: unknown[]; rules: unknown[] };
    expect(fj.sections).toHaveLength(3);
    expect(fj.rules).toHaveLength(2);
    // the DB rows are attached to the NEW variant, all of them.
    const row = sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(fj.public_id) as { id: number };
    const secN = (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_variant_sections WHERE variant_id = ?").get(row.id) as { n: number }).n;
    const ruleN = (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_rules WHERE variant_id = ?").get(row.id) as { n: number }).n;
    expect(secN).toBe(3);
    expect(ruleN).toBe(2);
  });

  it("a mid-clone failure leaves NO orphan variant (the whole fork rolls back)", async () => {
    const { sdb, env } = newHarness();
    const q = await createQuote(env);
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const funnelDbId = q.funnels[0]!.id;
    const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life" });
    const put = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { sections: [{ section_id: s1.id }], rules: [{ rule_type: "eligibility" }] }),
      env,
    );
    expect(put.status).toBe(200);

    const variantsBefore = (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_variants WHERE funnel_id = ?").get(funnelDbId) as { n: number }).n;

    // Inject a failure on the RULE-clone INSERT (a realistic partial failure).
    // A non-atomic fork commits the variant BEFORE this throws → orphan; the
    // atomic single-batch fork rolls the variant back with it.
    const failEnv = withRuleInsertFailure(env, sdb);
    let status = 0;
    try {
      status = (await admin.request(`${API}/variants/${variantId}/fork`, { method: "POST" }, failEnv)).status;
    } catch {
      status = 500; // the injected failure propagated
    }
    expect(status, "the injected clone failure must surface, not a 201").not.toBe(201);

    const variantsAfter = (sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_variants WHERE funnel_id = ?").get(funnelDbId) as { n: number }).n;
    expect(variantsAfter, "an atomic fork must not orphan a variant on a mid-clone failure").toBe(variantsBefore);
  });
});

// Wrap env.DB so the leadgen_funnel_rules clone INSERT rejects — everything else
// delegates to a real D1 over the same sqlite db (so the rollback is real).
function withRuleInsertFailure(env: Env, sdb: SqliteDb): Env {
  const realDb = d1FromSqlite(sdb) as unknown as {
    prepare(sql: string): { bind(...a: unknown[]): unknown; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<unknown> };
    batch(statements: Array<{ run(): Promise<unknown> }>): Promise<unknown>;
  };
  const proxied = {
    prepare(sql: string) {
      const real = realDb.prepare(sql);
      if (sql.includes("INSERT INTO leadgen_funnel_rules")) {
        const wrapper = {
          bind(...a: unknown[]) {
            real.bind(...a);
            return wrapper;
          },
          run(): Promise<unknown> {
            return Promise.reject(new Error("injected rule-clone failure"));
          },
          first<T>(): Promise<T | null> {
            return real.first<T>();
          },
          all<T>(): Promise<unknown> {
            return real.all<T>();
          },
        };
        return wrapper;
      }
      return real;
    },
    batch(statements: Array<{ run(): Promise<unknown> }>): Promise<unknown> {
      return realDb.batch(statements);
    },
  };
  return { ...env, DB: proxied as unknown as D1Database };
}

describeDb("dual-id + no-store headers + 404 semantics", () => {
  it("unknown ids 404 across the block; every response carries no-store + nosniff", async () => {
    const { env } = newHarness();
    const absent = mintPublicId("quote");
    const paths: Array<{ path: string; method?: string; status: number }> = [
      { path: `${API}/quotes/${absent}`, status: 404 },
      { path: `${API}/quotes/${absent}/structure`, status: 404 },
      { path: `${API}/funnels/${mintPublicId("funnel")}`, status: 404 },
      { path: `${API}/variants/${mintPublicId("funnel_variant")}`, method: "PUT", status: 404 },
      { path: `${API}/quotes`, status: 200 },
    ];
    for (const { path, method, status } of paths) {
      const res = await admin.request(path, method ? jsonInit(method, {}) : {}, env);
      expect(res.status, `${method ?? "GET"} ${path}`).toBe(status);
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("variant PUT resolves by numeric id too (dual-id)", async () => {
    const { env } = newHarness();
    const q = await createQuote(env);
    const numericVariantId = q.funnels[0]!.variants[0]!.id;
    const res = await admin.request(`${API}/variants/${numericVariantId}`, jsonInit("PUT", { lander_headline: "Hi" }), env);
    expect(res.status).toBe(200);
  });
});
