// LeadGen Rework P1 (slice S1.4) — the admin handlers over the REAL rework
// schema (leadgen migrations 0036–0053) and the REAL handler functions. Most
// tests below mount the handlers on a LOCAL Hono app (proving behavior by
// observing rows/effects, not schema existence, guardrail) so per-scenario
// setup stays terse; the "reachable through the real admin router" describe
// block at the bottom drives the SAME scenarios through the actual mounted app
// (src/admin/router.ts → leadgen/router.ts, now registers every new route —
// conductor-extended ownership) to prove the wiring itself, not just the
// handler logic in isolation.
//
// Covers §4.3 clauses + M1/M3/M4/M5 + Appendix A-4/A-5/A-11 verbatim:
//   shared-page CRUD + second-page rejection · funnel CRUD + A-5 delete guards +
//   cascade · default funnel · display_order reorder · quote routing-rule CRUD +
//   A-11 + validations + allowlisted redirect + conditions_hash stability ·
//   §4.3-13 uniqueness (A-4) at save AND activation · the §4.3-15 preflight
//   matrix (each check failing then passing) · M5 template CRUD + in-use guard +
//   atomic default swap + variant override · equal-arms Σbp=10000 ·
//   single-active-variant-without-test rejection · L-192 legacy-quote seam ·
//   every new route reachable through the REAL admin router.

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
// The REAL mounted admin app (src/admin/router.ts → leadgen/router.ts) — used
// ONLY by the "reachable through the real admin router" describe block below,
// to prove the actual route registrations (not just the handler functions).
import admin from "../src/admin/router";
import {
  createFunnelExperimentHandler,
  createFunnelVariantHandler,
  createQuoteFunnelHandler,
  createQuoteHandler,
  createQuoteRoutingRuleHandler,
  createSharedPageHandler,
  deleteFunnelHandler,
  deleteQuoteRoutingRuleHandler,
  deleteSharedPageHandler,
  deleteVariantHandler,
  duplicateFunnelHandler,
  duplicateQuoteHandler,
  duplicateQuoteRoutingRuleHandler,
  forkVariantHandler,
  getQuoteHandler,
  getSharedPageHandler,
  listQuoteRoutingRulesHandler,
  previewVariantHandler,
  putActivationHandler,
  putVariantHandler,
  quoteActivationHandler,
  reorderQuoteFunnelsHandler,
  setQuoteDefaultFunnelHandler,
  startExperimentHandler,
  stopExperimentHandler,
  updateQuoteRoutingRuleHandler,
  updateSharedPageHandler,
} from "../src/admin/leadgen/quotes-handlers";
import {
  applyFrameTemplateToFunnelHandler,
  createFrameTemplateHandler,
  deleteFrameTemplateHandler,
  duplicateFrameTemplateHandler,
  listFrameTemplateRecordsHandler,
  setDefaultFrameTemplateHandler,
  updateFrameTemplateHandler,
} from "../src/admin/leadgen/frame-handlers";

// --- node:sqlite harness (repo pattern, mirrors leadgen-quotes-api.test.ts) --

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
// The full leadgen block INCLUDING the rework recreations 0046–0053.
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql", "0037_leadgen_analytics_mirror.sql", "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql", "0040_leadgen_runtime_context.sql", "0041_leadgen_frame_theme.sql",
  "0042_leadgen_pages.sql", "0043_leadgen_routing_rules.sql", "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql", "0046_leadgen_rework_m1_variants.sql", "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql", "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql", "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql", "0053_leadgen_rework_m12_othergroup_retirement.sql",
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
  const env = {
    DB: db, CACHE: {} as KVNamespace, MEDIA: {} as R2Bucket,
    APP_ENV: "test", ADMIN_HOST: "localhost", ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin", CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "60",
    DEV_BYPASS_AUTH: "true",
  } as Env;
  (env as unknown as Record<string, unknown>).LEADGEN_REDIRECT_URL_ALLOWLIST = "partner.example.com";
  return env;
}

// LOCAL app mounting the REAL handlers directly (router.ts ALSO registers every
// route below — see the "reachable through the real admin router" describe
// block; this local mount just keeps per-scenario setup terse for the bulk of
// the file). Route shapes mirror the real surface exactly.
function buildApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/quotes", createQuoteHandler);
  app.get("/quotes/:id", getQuoteHandler);
  app.post("/quotes/:id/duplicate", duplicateQuoteHandler);
  app.post("/quotes/:id/funnels", createQuoteFunnelHandler);
  app.put("/quotes/:id/funnel-order", reorderQuoteFunnelsHandler);
  app.put("/quotes/:id/default-funnel", setQuoteDefaultFunnelHandler);
  app.get("/quotes/:id/shared-page", getSharedPageHandler);
  app.post("/quotes/:id/shared-page", createSharedPageHandler);
  app.put("/quotes/:id/shared-page", updateSharedPageHandler);
  app.delete("/quotes/:id/shared-page", deleteSharedPageHandler);
  app.get("/quotes/:id/routing-rules", listQuoteRoutingRulesHandler);
  app.post("/quotes/:id/routing-rules", createQuoteRoutingRuleHandler);
  app.patch("/routing-rules/:rule_id", updateQuoteRoutingRuleHandler);
  app.post("/routing-rules/:rule_id/duplicate", duplicateQuoteRoutingRuleHandler);
  app.delete("/routing-rules/:rule_id", deleteQuoteRoutingRuleHandler);
  app.put("/quotes/:id/activation/:site_id", putActivationHandler);
  app.get("/quotes/:id/activation", quoteActivationHandler);
  app.post("/funnels/:id/variants", createFunnelVariantHandler);
  app.post("/funnels/:id/duplicate", duplicateFunnelHandler);
  app.post("/funnels/:id/experiments", createFunnelExperimentHandler);
  app.post("/funnels/:id/apply-template", applyFrameTemplateToFunnelHandler);
  app.delete("/funnels/:id", deleteFunnelHandler);
  app.put("/variants/:id", putVariantHandler);
  app.post("/variants/:id/fork", forkVariantHandler);
  app.post("/variants/:id/preview", previewVariantHandler);
  app.delete("/variants/:id", deleteVariantHandler);
  app.post("/experiments/:id/start", startExperimentHandler);
  app.post("/experiments/:id/stop", stopExperimentHandler);
  app.get("/frame-template-records", listFrameTemplateRecordsHandler);
  app.post("/frame-template-records", createFrameTemplateHandler);
  app.patch("/frame-template-records/:id", updateFrameTemplateHandler);
  app.post("/frame-template-records/:id/duplicate", duplicateFrameTemplateHandler);
  app.put("/frame-template-records/:id/default", setDefaultFrameTemplateHandler);
  app.delete("/frame-template-records/:id", deleteFrameTemplateHandler);
  return app;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  if (method === "GET" || method === "HEAD") return { method };
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) };
}

function seedSection(sdb: SqliteDb, name: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "f", answer_type: "boolean" }] });
  sdb.prepare(
    "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, 'quote_funnel', 'life', 'H', ?, 'button', 'active')",
  ).run(publicId, name, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

function seedOffer(sdb: SqliteDb): { id: number; public_id: string } {
  const publicId = mintPublicId("offer");
  sdb.prepare(
    "INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type) VALUES (?, 'Ofr', 'quote_funnel', 'life', 's2s_postback', 'cpl')",
  ).run(publicId);
  const row = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

const DatabaseSync = loadDatabaseSync();
const d = DatabaseSync === null ? describe.skip : describe;

interface Harness {
  sdb: SqliteDb;
  env: Env;
  app: Hono<{ Bindings: Env }>;
}
function harness(): Harness {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)), app: buildApp() };
}
async function req(h: Harness, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await h.app.request(path, jsonInit(method, body), h.env as unknown as Record<string, unknown>);
  let json: unknown = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

// Same request shape, but through the REAL mounted admin app + the 03 §8.1 API
// prefix (proves the router.ts registration itself, not the handler in isolation).
const REAL_API_PREFIX = "/api/admin/leadgen";
async function reqReal(h: Harness, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await admin.request(`${REAL_API_PREFIX}${path}`, jsonInit(method, body), h.env as unknown as Record<string, unknown>);
  let json: unknown = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

// Create a quote THROUGH THE REAL ROUTER (mirrors newQuote below, but via
// reqReal — used only by the router-reachability describe block so its own
// fixtures are proven reachable end-to-end, not seeded through the local app).
async function newQuoteReal(h: Harness): Promise<{ quotePublic: string; funnelPublic: string; variantPublic: string }> {
  const { json } = await reqReal(h, "POST", "/quotes", { quote_name: "Q", activity: "quote_funnel", verticals: ["life"] });
  const funnel = json.funnels[0];
  return { quotePublic: json.public_id, funnelPublic: funnel.public_id, variantPublic: funnel.variants[0].public_id };
}

// Create a quote (activity/vertical the seeded sections match) → returns ids.
async function newQuote(h: Harness): Promise<{ quotePublic: string; funnelPublic: string; variantPublic: string; defaultFunnelId: number | null }> {
  const { json } = await req(h, "POST", "/quotes", { quote_name: "Q", activity: "quote_funnel", verticals: ["life"] });
  const funnel = json.funnels[0];
  return { quotePublic: json.public_id, funnelPublic: funnel.public_id, variantPublic: funnel.variants[0].public_id, defaultFunnelId: json.default_funnel_id };
}

d("leadgen rework handlers (S1.4)", () => {
  // --- M1 create semantics ---------------------------------------------------
  it("createQuote seeds ONE active variant labelled 'A', no is_control, default funnel set", async () => {
    const h = harness();
    const { json } = await req(h, "POST", "/quotes", { quote_name: "Q", activity: "quote_funnel", verticals: ["life"] });
    expect(json.default_funnel_id).not.toBeNull();
    expect(json.funnels).toHaveLength(1);
    const variants = json.funnels[0].variants;
    expect(variants).toHaveLength(1);
    expect(variants[0].variant_label).toBe("A");
    expect(variants[0]).not.toHaveProperty("is_control");
    expect(json.funnels[0].id).toBe(json.default_funnel_id);
  });

  it("forbids a SECOND active variant without a running test (§4.3-10)", async () => {
    const h = harness();
    const q = await newQuote(h);
    const r = await req(h, "POST", `/funnels/${q.funnelPublic}/variants`, {});
    expect(r.status).toBe(409);
    expect(r.json.error).toContain("A second active variant is only allowed as an arm of a running A/B test");
    // fork is also refused (the invariant, §8.2 removes the UI too).
    const f = await req(h, "POST", `/variants/${q.variantPublic}/fork`, {});
    expect(f.status).toBe(409);
  });

  // --- Shared page CRUD (§4.3-1) ---------------------------------------------
  it("shared-page CRUD + rejects a SECOND shared page per quote", async () => {
    const h = harness();
    const q = await newQuote(h);
    const s1 = seedSection(h.sdb, "Shared A");
    // none yet
    expect((await req(h, "GET", `/quotes/${q.quotePublic}/shared-page`)).json.shared_page).toBeNull();
    // create
    const created = await req(h, "POST", `/quotes/${q.quotePublic}/shared-page`, { name: "First", sections: [{ section_id: s1.id, position: 0 }] });
    expect(created.status).toBe(201);
    expect(created.json.shared_page.sections).toHaveLength(1);
    // second create rejected
    const dup = await req(h, "POST", `/quotes/${q.quotePublic}/shared-page`, {});
    expect(dup.status).toBe(409);
    expect(dup.json.error).toContain("exactly one");
    // update (rename + reorder/add)
    const s2 = seedSection(h.sdb, "Shared B");
    const upd = await req(h, "PUT", `/quotes/${q.quotePublic}/shared-page`, { name: "Renamed", sections: [{ section_id: s2.id, position: 0 }, { section_id: s1.id, position: 1 }] });
    expect(upd.status).toBe(200);
    expect(upd.json.shared_page.name).toBe("Renamed");
    expect(upd.json.shared_page.sections.map((x: any) => x.section_public_id)).toEqual([s2.public_id, s1.public_id]);
    // delete
    expect((await req(h, "DELETE", `/quotes/${q.quotePublic}/shared-page`)).status).toBe(200);
    expect((await req(h, "GET", `/quotes/${q.quotePublic}/shared-page`)).json.shared_page).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // §4.3-11 parity addendum (conductor addendum round) — the composed variant
  // preview (POST /variants/:id/preview with a V25_PREVIEW_KEYS body) must
  // compose the quote's shared-page sections EXACTLY as the live serve path
  // does (composeResolvedBundle, resolver.ts: shared page FIRST, then the
  // variant's own pages). Before this fix, composedVariantPreviewResponse read
  // ONLY readVariantSections(variant.id) — the variant's flat sections — so a
  // shared-page section was invisible to preview even though serve already
  // composed it in (S1.3's §4.3-11 fix). Proven two ways: (1) section_count
  // includes the shared section: 2, not 1; (2) the shared section's OWN
  // public_id is resolvable via `section_public_id` (pre-fix this 400'd with
  // "section_public_id is not a section of this variant" — the shared section
  // was not in the array at all, not merely miscounted).
  // ---------------------------------------------------------------------------
  it("composed preview parity: shared-page sections compose into /variants/:id/preview exactly as serve does", async () => {
    const h = harness();
    const q = await newQuote(h);
    const sharedSec = seedSection(h.sdb, "Shared Preview Section");
    const variantSec = seedSection(h.sdb, "Variant Preview Section");
    await req(h, "POST", `/quotes/${q.quotePublic}/shared-page`, { sections: [{ section_id: sharedSec.id, position: 0 }] });
    await req(h, "PUT", `/variants/${q.variantPublic}`, { sections: [{ section_id: variantSec.id, position: 0 }] });

    // (1) count: shared (1) + variant (1) = 2, not 1.
    const preview = await req(h, "POST", `/variants/${q.variantPublic}/preview`, { mode: "section" });
    expect(preview.status, `preview: ${JSON.stringify(preview.json)}`).toBe(200);
    expect(preview.json.preview.section_count).toBe(2);

    // (2) the SHARED section is directly addressable (pre-fix: 400, "not a
    // section of this variant" — it was absent from the array entirely).
    const previewShared = await req(h, "POST", `/variants/${q.variantPublic}/preview`, {
      mode: "section",
      section_public_id: sharedSec.public_id,
    });
    expect(previewShared.status, `preview shared section: ${JSON.stringify(previewShared.json)}`).toBe(200);
    // the variant's OWN section still resolves too (unaffected by the fix).
    const previewVariant = await req(h, "POST", `/variants/${q.variantPublic}/preview`, {
      mode: "section",
      section_public_id: variantSec.public_id,
    });
    expect(previewVariant.status, `preview variant section: ${JSON.stringify(previewVariant.json)}`).toBe(200);
  });

  it("composed preview parity: UNCHANGED for a legacy quote with no shared page (section_count stays variant-only)", async () => {
    const h = harness();
    const q = await newQuote(h);
    const variantSec = seedSection(h.sdb, "Only Variant Section");
    await req(h, "PUT", `/variants/${q.variantPublic}`, { sections: [{ section_id: variantSec.id, position: 0 }] });
    // no shared page ever created for this quote — loadSharedPages resolves to
    // [] (the L-192 fail-safe path), so composition is variant-only, as before.
    const preview = await req(h, "POST", `/variants/${q.variantPublic}/preview`, { mode: "section" });
    expect(preview.status, `preview: ${JSON.stringify(preview.json)}`).toBe(200);
    expect(preview.json.preview.section_count).toBe(1);
  });

  // --- Funnel CRUD + A-5 delete guards + cascade -----------------------------
  it("funnel create appends display_order; reorder swaps it", async () => {
    const h = harness();
    const q = await newQuote(h);
    const f2 = await req(h, "POST", `/quotes/${q.quotePublic}/funnels`, { funnel_name: "Funnel B" });
    const f3 = await req(h, "POST", `/quotes/${q.quotePublic}/funnels`, { funnel_name: "Funnel C" });
    const before = (await req(h, "GET", `/quotes/${q.quotePublic}`)).json.funnels.map((f: any) => [f.public_id, f.display_order]);
    expect(before.map((x: any) => x[1])).toEqual([1, 2, 3]);
    // reverse
    const order = [f3.json.public_id, f2.json.public_id, q.funnelPublic];
    const re = await req(h, "PUT", `/quotes/${q.quotePublic}/funnel-order`, { order });
    expect(re.status).toBe(200);
    const after = new Map(re.json.items.map((f: any) => [f.public_id, f.display_order]));
    expect(after.get(f3.json.public_id)).toBe(1);
    expect(after.get(q.funnelPublic)).toBe(3);
  });

  it("A-5: delete blocked when funnel is the default (verbatim)", async () => {
    const h = harness();
    const q = await newQuote(h);
    const del = await req(h, "DELETE", `/funnels/${q.funnelPublic}`);
    expect(del.status).toBe(409);
    expect(del.json.blockers).toContain("Can't delete 'Q — Funnel A': it is the default funnel.");
  });

  it("A-5: delete blocked when funnel is a rule target (verbatim) + cascade when allowed", async () => {
    const h = harness();
    const q = await newQuote(h);
    // second funnel + point the default at it, so Funnel A is not the default
    const f2 = await req(h, "POST", `/quotes/${q.quotePublic}/funnels`, { funnel_name: "Funnel B" });
    await req(h, "PUT", `/quotes/${q.quotePublic}/default-funnel`, { funnel_id: f2.json.public_id });
    // an enabled rule targets Funnel A
    const rule = await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "R1", target_funnel_id: q.funnelPublic });
    expect(rule.status).toBe(201);
    const blocked = await req(h, "DELETE", `/funnels/${q.funnelPublic}`);
    expect(blocked.status).toBe(409);
    expect(blocked.json.blockers).toContain("Can't delete 'Q — Funnel A': it is the target of rule 'R1'.");
    // disable the rule → now deletable; cascade removes the variant
    const variantIdRow = h.sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(q.variantPublic) as { id: number };
    await req(h, "PATCH", `/routing-rules/${rule.json.public_id}`, { status: "disabled" });
    const ok = await req(h, "DELETE", `/funnels/${q.funnelPublic}`);
    expect(ok.status).toBe(200);
    expect(ok.json.deleted).toBe(true);
    // variant is gone (explicit cascade — FK OFF in prod)
    const gone = h.sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_variants WHERE id = ?").get(variantIdRow.id) as { n: number };
    expect(gone.n).toBe(0);
    // the disabled rule's target was nulled
    const ruleAfter = h.sdb.prepare("SELECT target_funnel_id FROM leadgen_quote_routing_rules WHERE public_id = ?").get(rule.json.public_id) as { target_funnel_id: number | null };
    expect(ruleAfter.target_funnel_id).toBeNull();
  });

  // --- Default funnel --------------------------------------------------------
  it("set/unset default funnel; rejects a foreign or inactive funnel", async () => {
    const h = harness();
    const q = await newQuote(h);
    const other = await newQuote(h); // a different quote's funnel
    const foreign = await req(h, "PUT", `/quotes/${q.quotePublic}/default-funnel`, { funnel_id: other.funnelPublic });
    expect(foreign.status).toBe(400);
    // unset
    const unset = await req(h, "PUT", `/quotes/${q.quotePublic}/default-funnel`, { funnel_id: null });
    expect(unset.status).toBe(200);
    expect(unset.json.default_funnel_id).toBeNull();
  });

  // --- Quote routing rule CRUD ----------------------------------------------
  it("routing rule: ≥1 action gate (A-11 verbatim) + name/priority/feed validation", async () => {
    const h = harness();
    const q = await newQuote(h);
    const noAction = await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "R" });
    expect(noAction.status).toBe(400);
    expect(noAction.json.fields.actions).toBe("Pick at least one action for this rule.");
    expect((await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "", feed_name: "x" })).json.fields.rule_name).toBeDefined();
    expect((await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "R", priority: 0, feed_name: "x" })).json.fields.priority).toBeDefined();
    expect((await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "R", feed_name: "bad name!" })).json.fields.feed_name).toBeDefined();
    const ok = await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "R", feed_name: "my_feed-1" });
    expect(ok.status).toBe(201);
    expect(ok.json.feed_name).toBe("my_feed-1");
  });

  it("routing rule: allowlisted redirect accepted, non-allowlisted rejected; conditions_hash stable", async () => {
    const h = harness();
    const q = await newQuote(h);
    const offer = seedOffer(h.sdb);
    const bad = await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "R", redirect_url: "https://evil.example.com/x", redirect_pct: 50 });
    expect(bad.status).toBe(400);
    expect(bad.json.fields.redirect_url).toBeDefined();
    const good = await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "R2", redirect_url: "https://partner.example.com/land", redirect_pct: 50 });
    expect(good.status).toBe(201);
    expect(good.json.redirect_url_allowlisted).toBe(true);
    // offer redirect target also works
    const viaOffer = await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "R3", target_offer_id: offer.id, redirect_pct: 25 });
    expect(viaOffer.status).toBe(201);
    // conditions_hash: two rules with identical conditions share the hash; differing conditions differ
    const conds = { groups: [{ field: "state", op: "eq", value: "CA" }] };
    const a = await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "CA", feed_name: "f", conditions_json: conds });
    const b = await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "CA2", feed_name: "f", conditions_json: conds });
    expect(a.json.conditions_hash).toBe(b.json.conditions_hash);
    const cRow = h.sdb.prepare("SELECT conditions_hash FROM leadgen_quote_routing_rules WHERE public_id = ?").get(
      (await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "NY", feed_name: "f", conditions_json: { groups: [{ field: "state", op: "eq", value: "NY" }] } })).json.public_id,
    ) as { conditions_hash: string };
    expect(cRow.conditions_hash).not.toBe(a.json.conditions_hash);
  });

  it("routing rule: update (enable/disable), duplicate, delete", async () => {
    const h = harness();
    const q = await newQuote(h);
    const r = await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "R", feed_name: "f" });
    const disabled = await req(h, "PATCH", `/routing-rules/${r.json.public_id}`, { status: "disabled" });
    expect(disabled.json.status).toBe("disabled");
    const dup = await req(h, "POST", `/routing-rules/${r.json.public_id}/duplicate`, {});
    expect(dup.status).toBe(201);
    expect(dup.json.rule_name).toBe("R (copy)");
    expect((await req(h, "GET", `/quotes/${q.quotePublic}/routing-rules`)).json.items).toHaveLength(2);
    expect((await req(h, "DELETE", `/routing-rules/${r.json.public_id}`)).status).toBe(200);
    expect((await req(h, "GET", `/quotes/${q.quotePublic}/routing-rules`)).json.items).toHaveLength(1);
  });

  // --- §4.3-13 uniqueness (A-4 verbatim) at save AND activation --------------
  it("A-4: a section on the shared page AND a funnel is rejected at variant save (verbatim)", async () => {
    const h = harness();
    const q = await newQuote(h);
    const s = seedSection(h.sdb, "Dup Section");
    await req(h, "POST", `/quotes/${q.quotePublic}/shared-page`, { sections: [{ section_id: s.id, position: 0 }] });
    const save = await req(h, "PUT", `/variants/${q.variantPublic}`, { sections: [{ section_id: s.id, position: 0 }] });
    expect(save.status).toBe(400);
    expect(Object.values(save.json.fields)).toContain("'Dup Section' is already in this funnel — a section can appear once per funnel.");
  });

  // --- §4.3-15 activation preflight matrix -----------------------------------
  it("§4.3-15 preflight: each check fails, then a fully-wired quote passes", async () => {
    const h = harness();
    const q = await newQuote(h);
    const sharedSec = seedSection(h.sdb, "Shared");
    const funnelSec = seedSection(h.sdb, "Funnel");

    // (a) fresh quote: shared page missing + funnel has no sections → blocked
    const a = await req(h, "PUT", `/quotes/${q.quotePublic}/activation/site-1`, { enabled: true });
    expect(a.status).toBe(409);
    const msgsA = (a.json.problems ?? []).map((p: any) => p.message);
    expect(msgsA.some((m: string) => m.includes("shared first page needs at least one section"))).toBe(true);
    expect(msgsA.some((m: string) => m.includes("needs at least one page with a section"))).toBe(true);

    // add shared page section + funnel section
    await req(h, "POST", `/quotes/${q.quotePublic}/shared-page`, { sections: [{ section_id: sharedSec.id, position: 0 }] });
    await req(h, "PUT", `/variants/${q.variantPublic}`, { sections: [{ section_id: funnelSec.id, position: 0 }] });

    // (b) unset the default funnel → blocked on default-funnel
    await req(h, "PUT", `/quotes/${q.quotePublic}/default-funnel`, { funnel_id: null });
    const b = await req(h, "PUT", `/quotes/${q.quotePublic}/activation/site-1`, { enabled: true });
    expect(b.status).toBe(409);
    expect((b.json.problems ?? []).some((p: any) => p.path === "activation.default_funnel")).toBe(true);

    // restore default funnel → now passes
    await req(h, "PUT", `/quotes/${q.quotePublic}/default-funnel`, { funnel_id: q.funnelPublic });
    const ok = await req(h, "PUT", `/quotes/${q.quotePublic}/activation/site-1`, { enabled: true });
    expect(ok.status).toBe(200);
    // GET activation surfaces the (now clean) preflight
    const panel = await req(h, "GET", `/quotes/${q.quotePublic}/activation`);
    expect(panel.json.activation_preflight.problems.filter((p: any) => p.severity === "error")).toHaveLength(0);
  });

  it("§4.3-15: an enabled rule targeting an archived funnel blocks activation", async () => {
    const h = harness();
    const q = await newQuote(h);
    const sharedSec = seedSection(h.sdb, "Shared");
    const funnelSec = seedSection(h.sdb, "Funnel");
    await req(h, "POST", `/quotes/${q.quotePublic}/shared-page`, { sections: [{ section_id: sharedSec.id, position: 0 }] });
    await req(h, "PUT", `/variants/${q.variantPublic}`, { sections: [{ section_id: funnelSec.id, position: 0 }] });
    // a second funnel, archived, targeted by an enabled rule
    const f2 = await req(h, "POST", `/quotes/${q.quotePublic}/funnels`, { funnel_name: "B" });
    h.sdb.prepare("UPDATE leadgen_funnels SET status = 'archived' WHERE public_id = ?").run(f2.json.public_id);
    await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "toB", target_funnel_id: f2.json.public_id });
    const res = await req(h, "PUT", `/quotes/${q.quotePublic}/activation/site-1`, { enabled: true });
    expect(res.status).toBe(409);
    expect((res.json.problems ?? []).some((p: any) => p.message.includes("targets a funnel that is not active"))).toBe(true);
  });

  it("L-192: a legacy quote (no shared page, no default) REPORTS missing pieces, never 500s", async () => {
    const h = harness();
    const q = await newQuote(h);
    // strip to a legacy shape: no default funnel, no shared page, no sections
    await req(h, "PUT", `/quotes/${q.quotePublic}/default-funnel`, { funnel_id: null });
    const panel = await req(h, "GET", `/quotes/${q.quotePublic}/activation`);
    expect(panel.status).toBe(200); // not a 500
    const msgs = panel.json.activation_preflight.problems.map((p: any) => p.message);
    expect(msgs.some((m: string) => m.includes("Set a default funnel"))).toBe(true);
    expect(msgs.some((m: string) => m.includes("shared first page needs"))).toBe(true);
  });

  // --- M5 frame templates ----------------------------------------------------
  it("M5 templates: seeded 6; create/rename/duplicate; atomic default swap; in-use guard; apply + variant override", async () => {
    const h = harness();
    const q = await newQuote(h);
    // seeded 6 built-ins, 'Centered card' is default
    const list = await req(h, "GET", "/frame-template-records");
    expect(list.json.items).toHaveLength(6);
    expect(list.json.items.filter((t: any) => t.is_default)).toHaveLength(1);
    const centered = list.json.items.find((t: any) => t.name === "Centered card");
    // create (save-as) from an existing template's frame_json
    const created = await req(h, "POST", "/frame-template-records", { name: "My Template", frame_json: centered.frame_json });
    expect(created.status).toBe(201);
    expect(created.json.is_default).toBe(false);
    // rename
    const renamed = await req(h, "PATCH", `/frame-template-records/${created.json.public_id}`, { name: "Renamed Template" });
    expect(renamed.json.name).toBe("Renamed Template");
    // duplicate
    const duped = await req(h, "POST", `/frame-template-records/${created.json.public_id}/duplicate`, {});
    expect(duped.status).toBe(201);
    expect(duped.json.name).toBe("Renamed Template (copy)");
    // atomic default swap
    const swap = await req(h, "PUT", `/frame-template-records/${created.json.public_id}/default`, {});
    expect(swap.json.is_default).toBe(true);
    const afterSwap = await req(h, "GET", "/frame-template-records");
    expect(afterSwap.json.items.filter((t: any) => t.is_default)).toHaveLength(1);
    expect(afterSwap.json.items.find((t: any) => t.name === "Centered card").is_default).toBe(false);
    // apply-to-funnel sets funnels.frame_template_id
    const applied = await req(h, "POST", `/funnels/${q.funnelPublic}/apply-template`, { template_id: created.json.public_id });
    expect(applied.status).toBe(200);
    expect(applied.json.frame_template_id).toBe(created.json.id);
    // in-use guard: cannot delete a template a funnel references
    const del = await req(h, "DELETE", `/frame-template-records/${created.json.public_id}`);
    expect(del.status).toBe(409);
    expect(del.json.in_use.funnels).toHaveLength(1);
    // variant-level override (M5) via putVariant
    const ov = await req(h, "PUT", `/variants/${q.variantPublic}`, { frame_template_id: duped.json.id });
    expect(ov.status).toBe(200);
    expect(ov.json.frame_template_id).toBe(duped.json.id);
  });

  // --- equal-arms Σbp=10000 at start (existing gate, post-rework) ------------
  it("equal-arms: start refuses Σbp≠10000, accepts Σbp=10000 (no control axis)", async () => {
    const h = harness();
    const q = await newQuote(h);
    const funnelIdRow = h.sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(q.funnelPublic) as { id: number };
    // seed a SECOND active arm directly (the API forbids it without a test — that
    // is the point; arms are set up via the A/B tab in a later phase)
    h.sdb.prepare(
      "INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status) VALUES (?, ?, 'B', 4000, 'default', 'active')",
    ).run(mintPublicId("funnel_variant"), funnelIdRow.id);
    h.sdb.prepare("UPDATE leadgen_funnel_variants SET traffic_allocation_bp = 4000 WHERE public_id = ?").run(q.variantPublic);
    const test = await req(h, "POST", `/funnels/${q.funnelPublic}/experiments`, { name: "T" });
    const bad = await req(h, "POST", `/experiments/${test.json.public_id}/start`, {});
    expect(bad.status).toBe(400); // 4000 + 4000 != 10000
    // fix allocations to sum 10000
    h.sdb.prepare("UPDATE leadgen_funnel_variants SET traffic_allocation_bp = 5000 WHERE funnel_id = ?").run(funnelIdRow.id);
    const okStart = await req(h, "POST", `/experiments/${test.json.public_id}/start`, {});
    expect(okStart.status).toBe(200);
    expect(okStart.json.status).toBe("running");
  });

  // ---------------------------------------------------------------------------
  // Conductor extension round 2 (P1 regression fix) — the FULL A/B lifecycle
  // through a REAL HTTP flow: create test → start (1 arm, trivially Σ=10000) →
  // fork the running arm (bootstraps the 2nd arm — the ONLY prior gap: fork
  // unconditionally 409'd regardless of running-test state, so there was NO
  // HTTP-reachable way to create a second active variant at all) → equal
  // Σ=10000 arms → §4.3-13 uniqueness still enforced on the freshly-forked arm
  // → delete-variant works (stopped test, non-last arm) → deleting the funnel's
  // last active variant 409s.
  //
  // FAIL-BEFORE (the pre-fix 409-everywhere state, real evidence, not narrated):
  //   (1) This session's own read of forkVariantHandler BEFORE this fix (verbatim):
  //         if (await funnelHasRunningTest(c.env.DB, source.funnel_id)) {
  //           return c.json({ error: RUNNING_TEST_ARM_LOCK_MESSAGE }, 409);
  //         }
  //         const existing = await readFunnelVariants(c.env.DB, source.funnel_id);
  //         if (existing.some((v) => v.status === "active")) {
  //           return c.json({ error: SINGLE_ACTIVE_VARIANT_MESSAGE }, 409);
  //         }
  //       — BOTH branches 409 once any active variant exists, REGARDLESS of
  //       running-test state (the first branch fires exactly in the case that
  //       needed to be the sanctioned path). createVariantUnderFunnel carried
  //       the identical pattern. Together: zero HTTP path could ever produce a
  //       2nd active variant.
  //   (2) Independent, external corroboration: test/leadgen-quotes-api.test.ts
  //       (owned by a different slice) documents the SAME bug as an already-
  //       adapted-around fact in its own comments — "forkVariantHandler now
  //       unconditionally refuses a second ACTIVE variant while one already
  //       exists" (:822-824) and "fork unconditionally refuses a 2nd active
  //       variant, so the arm is seeded via raw SQL instead" (:864-867,
  //       905-908) — that file's B1 test block seeds its 2-arm fixture via raw
  //       SQL specifically BECAUSE no HTTP path existed. This test proves that
  //       gap is closed via forkVariantHandler, not a workaround.
  // ---------------------------------------------------------------------------
  it("full A/B lifecycle: create → start → fork bootstraps the 2nd arm → equal Σ=10000 → uniqueness still enforced → delete-variant → last-variant 409", async () => {
    const h = harness();
    const q = await newQuote(h);
    const sharedSec = seedSection(h.sdb, "Shared");
    const collidingSec = seedSection(h.sdb, "Colliding");

    // fork BEFORE any test exists still 409s (unchanged — "keep the 409 with
    // the current message when no running test exists").
    const forkNoTest = await req(h, "POST", `/variants/${q.variantPublic}/fork`, {});
    expect(forkNoTest.status).toBe(409);
    expect(forkNoTest.json.error).toContain("A second active variant is only allowed as an arm of a running A/B test");

    // create → draft, still 1 arm at bp=10000.
    const created = await req(h, "POST", `/funnels/${q.funnelPublic}/experiments`, { name: "AB1" });
    expect(created.status).toBe(201);
    expect(created.json.status).toBe("draft");
    expect(created.json.allocation_note).toContain("10000");

    // start → running, trivially Σ=10000 with 1 arm (no new "≥2 arms" gate).
    const started = await req(h, "POST", `/experiments/${created.json.public_id}/start`, {});
    expect(started.status).toBe(200);
    expect(started.json.status).toBe("running");
    const revisionBeforeFork = started.json.revision as number;

    // fork the RUNNING variant → NOW allowed: bootstraps the 2nd arm.
    const fork = await req(h, "POST", `/variants/${q.variantPublic}/fork`, {});
    expect(fork.status, `fork while running (bootstrap): ${JSON.stringify(fork.json)}`).toBe(201);
    expect(fork.json).not.toHaveProperty("is_control");
    const forkedPublic = fork.json.public_id as string;
    expect(forkedPublic).not.toBe(q.variantPublic);

    // equal arms, Σ=10000, both active — read back from the DB directly.
    const arms = h.sdb
      .prepare("SELECT public_id, variant_label, traffic_allocation_bp, status FROM leadgen_funnel_variants WHERE funnel_id = (SELECT id FROM leadgen_funnels WHERE public_id = ?) ORDER BY variant_label ASC")
      .all(q.funnelPublic) as Array<{ public_id: string; variant_label: string; traffic_allocation_bp: number; status: string }>;
    expect(arms).toHaveLength(2);
    expect(arms.every((a) => a.status === "active")).toBe(true);
    expect(arms.map((a) => a.traffic_allocation_bp)).toEqual([5000, 5000]);
    expect(arms.reduce((sum, a) => sum + a.traffic_allocation_bp, 0)).toBe(10000);
    // M1 "Labels A/B/C" — the forked arm is deterministically labelled 'B'.
    expect(arms.map((a) => a.variant_label)).toEqual(["A", "B"]);

    // the running test's revision bumped (clean re-bucket on arm-set change).
    const testRow = h.sdb.prepare("SELECT revision FROM leadgen_funnel_ab_tests WHERE public_id = ?").get(created.json.public_id) as { revision: number };
    expect(testRow.revision).toBe(revisionBeforeFork + 1);

    // a 3rd arm is STILL refused even with the test running (B1 test (c)'s
    // invariant — the arm set is frozen once it reaches its running shape).
    const thirdArm = await req(h, "POST", `/variants/${forkedPublic}/fork`, {});
    expect(thirdArm.status).toBe(409);

    // §4.3-13 uniqueness still enforced on the freshly-forked arm: seed the
    // shared page with `sharedSec`, then try to save `sharedSec` AGAIN onto the
    // forked arm — must be rejected with the A-4 verbatim message (proves the
    // fork operation didn't bypass save-time uniqueness for the new variant).
    await req(h, "POST", `/quotes/${q.quotePublic}/shared-page`, { sections: [{ section_id: sharedSec.id, position: 0 }] });
    const collision = await req(h, "PUT", `/variants/${forkedPublic}`, { sections: [{ section_id: sharedSec.id, position: 0 }] });
    expect(collision.status).toBe(400);
    expect(Object.values(collision.json.fields)).toContain(`'Shared' is already in this funnel — a section can appear once per funnel.`);
    // a NON-colliding section saves fine on the forked arm.
    const noCollision = await req(h, "PUT", `/variants/${forkedPublic}`, { sections: [{ section_id: collidingSec.id, position: 0 }] });
    expect(noCollision.status).toBe(200);

    // delete-variant while the test is STILL running → 409 (the B1 arm-set
    // freeze extended to delete — closing the same gap consistently).
    const deleteWhileRunning = await req(h, "DELETE", `/variants/${forkedPublic}`);
    expect(deleteWhileRunning.status).toBe(409);
    expect(deleteWhileRunning.json.error).toMatch(/stop the running A\/B test/i);

    // stop the test → delete-variant now works for the non-last arm.
    const stop = await req(h, "POST", `/experiments/${created.json.public_id}/stop`, {});
    expect(stop.status, `stop: ${JSON.stringify(stop.json)}`).toBe(200);
    const del = await req(h, "DELETE", `/variants/${forkedPublic}`);
    expect(del.status, `delete forked arm: ${JSON.stringify(del.json)}`).toBe(200);
    expect(del.json.deleted).toBe(true);
    const remaining = h.sdb.prepare("SELECT COUNT(*) AS n FROM leadgen_funnel_variants WHERE public_id = ?").get(forkedPublic) as { n: number };
    expect(remaining.n).toBe(0);

    // deleting the funnel's LAST active variant 409s.
    const deleteLast = await req(h, "DELETE", `/variants/${q.variantPublic}`);
    expect(deleteLast.status).toBe(409);
    expect(deleteLast.json.error).toContain("at least one active variant");
  });

  // --- duplicate quote carries the rework model ------------------------------
  it("duplicateQuote copies funnels/routing-rules and remaps default + rule targets", async () => {
    const h = harness();
    const q = await newQuote(h);
    await req(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "R", target_funnel_id: q.funnelPublic, feed_name: "f" });
    const dup = await req(h, "POST", `/quotes/${q.quotePublic}/duplicate`, {});
    expect(dup.status).toBe(201);
    expect(dup.json.copied.routing_rules).toBe(1);
    expect(dup.json.default_funnel_id).not.toBeNull();
    // the clone's default funnel is one of the clone's funnels
    const cloneFunnelIds = dup.json.funnels.map((f: any) => f.id);
    expect(cloneFunnelIds).toContain(dup.json.default_funnel_id);
    // the clone's routing rule targets the clone's funnel, not the source's
    const cloneQuoteId = h.sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = ?").get(dup.json.public_id) as { id: number };
    const rr = h.sdb.prepare("SELECT target_funnel_id FROM leadgen_quote_routing_rules WHERE quote_id = ?").get(cloneQuoteId.id) as { target_funnel_id: number };
    expect(cloneFunnelIds).toContain(rr.target_funnel_id);
  });

  // ---------------------------------------------------------------------------
  // Every new route reachable through the REAL admin router (conductor
  // extension round) — src/admin/router.ts -> leadgen/router.ts, hit via
  // reqReal/admin.request with the 03 §8.1 `/api/admin/leadgen` prefix. One
  // representative request per registered group; each proves the ACTUAL
  // route registration (verb + path + param name), not just the handler
  // function called directly (the tests above already prove the handler logic
  // exhaustively — these prove the wiring).
  // ---------------------------------------------------------------------------
  describe("every new route is reachable through the REAL admin router", () => {
    it("quotes group: shared-page, quote-scoped routing-rules, funnel-order, default-funnel", async () => {
      const h = harness();
      const q = await newQuoteReal(h);
      const s = seedSection(h.sdb, "Real Router Section");

      // GET/POST /quotes/:id/shared-page
      expect((await reqReal(h, "GET", `/quotes/${q.quotePublic}/shared-page`)).json.shared_page).toBeNull();
      const created = await reqReal(h, "POST", `/quotes/${q.quotePublic}/shared-page`, { sections: [{ section_id: s.id, position: 0 }] });
      expect(created.status).toBe(201);
      expect(created.json.shared_page.sections).toHaveLength(1);
      // PUT/DELETE /quotes/:id/shared-page
      expect((await reqReal(h, "PUT", `/quotes/${q.quotePublic}/shared-page`, { name: "Renamed" })).json.shared_page.name).toBe("Renamed");
      expect((await reqReal(h, "DELETE", `/quotes/${q.quotePublic}/shared-page`)).status).toBe(200);

      // GET/POST /quotes/:id/routing-rules (quote-scoped)
      const ruleCreate = await reqReal(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "Real Router Rule", feed_name: "f" });
      expect(ruleCreate.status).toBe(201);
      const ruleList = await reqReal(h, "GET", `/quotes/${q.quotePublic}/routing-rules`);
      expect(ruleList.json.items).toHaveLength(1);

      // PUT /quotes/:id/funnel-order (single-funnel permutation — proves the route, not reorder logic)
      const reorder = await reqReal(h, "PUT", `/quotes/${q.quotePublic}/funnel-order`, { order: [q.funnelPublic] });
      expect(reorder.status).toBe(200);
      expect(reorder.json.items).toHaveLength(1);

      // PUT /quotes/:id/default-funnel
      const setDefault = await reqReal(h, "PUT", `/quotes/${q.quotePublic}/default-funnel`, { funnel_id: q.funnelPublic });
      expect(setDefault.status).toBe(200);
      expect(setDefault.json.default_funnel_id).not.toBeNull();
    });

    it("routing-rules own-address group: PATCH/DELETE /routing-rules/:rule_id + POST .../duplicate", async () => {
      const h = harness();
      const q = await newQuoteReal(h);
      const created = await reqReal(h, "POST", `/quotes/${q.quotePublic}/routing-rules`, { rule_name: "R", feed_name: "f" });
      expect(created.status).toBe(201);
      const ruleId = created.json.public_id;

      // PATCH /routing-rules/:rule_id (param name `rule_id`, distinct address space)
      const patched = await reqReal(h, "PATCH", `/routing-rules/${ruleId}`, { status: "disabled" });
      expect(patched.status).toBe(200);
      expect(patched.json.status).toBe("disabled");

      // POST /routing-rules/:rule_id/duplicate
      const dup = await reqReal(h, "POST", `/routing-rules/${ruleId}/duplicate`, {});
      expect(dup.status).toBe(201);
      expect(dup.json.rule_name).toBe("R (copy)");

      // DELETE /routing-rules/:rule_id
      const del = await reqReal(h, "DELETE", `/routing-rules/${ruleId}`);
      expect(del.status).toBe(200);
      expect((await reqReal(h, "GET", `/quotes/${q.quotePublic}/routing-rules`)).json.items).toHaveLength(1); // the duplicate remains
    });

    it("funnels group: POST /funnels/:id/duplicate + POST /funnels/:id/apply-template", async () => {
      const h = harness();
      const q = await newQuoteReal(h);

      const dup = await reqReal(h, "POST", `/funnels/${q.funnelPublic}/duplicate`, {});
      expect(dup.status).toBe(201);
      expect(dup.json.public_id).not.toBe(q.funnelPublic);

      const templates = await reqReal(h, "GET", "/frame-template-records");
      const someTemplate = templates.json.items[0];
      const applied = await reqReal(h, "POST", `/funnels/${q.funnelPublic}/apply-template`, { template_id: someTemplate.public_id });
      expect(applied.status).toBe(200);
      expect(applied.json.frame_template_id).toBe(someTemplate.id);
    });

    it("variant lifecycle group (conductor extension round 2): POST /variants/:id/fork bootstraps an arm + DELETE /variants/:id, both through the real router", async () => {
      const h = harness();
      const q = await newQuoteReal(h);
      const experiment = await reqReal(h, "POST", `/funnels/${q.funnelPublic}/experiments`, { name: "Real Router AB" });
      expect(experiment.status).toBe(201);
      const started = await reqReal(h, "POST", `/experiments/${experiment.json.public_id}/start`, {});
      expect(started.status).toBe(200);
      // POST /variants/:id/fork — bootstraps the 2nd arm through the REAL router.
      const fork = await reqReal(h, "POST", `/variants/${q.variantPublic}/fork`, {});
      expect(fork.status, `fork via real router: ${JSON.stringify(fork.json)}`).toBe(201);
      // DELETE /variants/:id — stop first (the running-test freeze applies here too).
      await reqReal(h, "POST", `/experiments/${experiment.json.public_id}/stop`, {});
      const del = await reqReal(h, "DELETE", `/variants/${fork.json.public_id}`);
      expect(del.status).toBe(200);
      expect(del.json.deleted).toBe(true);
    });

    it("frame-template-records group: list/create/update/duplicate/default/delete all reachable", async () => {
      const h = harness();
      // GET (static, seeded 6) + POST (create)
      const list = await reqReal(h, "GET", "/frame-template-records");
      expect(list.json.items).toHaveLength(6);
      const created = await reqReal(h, "POST", "/frame-template-records", { name: "Real Router Template", frame_json: list.json.items[0].frame_json });
      expect(created.status).toBe(201);
      // GET /:id + PATCH /:id
      const fetched = await reqReal(h, "GET", `/frame-template-records/${created.json.public_id}`);
      expect(fetched.status).toBe(200);
      const patched = await reqReal(h, "PATCH", `/frame-template-records/${created.json.public_id}`, { name: "Renamed Real Router" });
      expect(patched.json.name).toBe("Renamed Real Router");
      // POST /:id/duplicate
      const dup = await reqReal(h, "POST", `/frame-template-records/${created.json.public_id}/duplicate`, {});
      expect(dup.status).toBe(201);
      // PUT /:id/default (atomic swap)
      const setDefault = await reqReal(h, "PUT", `/frame-template-records/${created.json.public_id}/default`, {});
      expect(setDefault.json.is_default).toBe(true);
      // DELETE /:id (the never-applied duplicate, so no in-use guard fires)
      const del = await reqReal(h, "DELETE", `/frame-template-records/${dup.json.public_id}`);
      expect(del.status).toBe(200);
    });
  });
});
