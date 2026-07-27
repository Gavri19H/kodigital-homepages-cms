// Section Builder v3.1 REMEDIATION — phase R1, Test B REBUILD (adversarial
// review FIX-FIRST, blockers 1 + 2).
//
// BLOCKER 1 (F8 HTTP-boundary): the prior version of this suite entered at
// runAuction() directly with hand-built NUMERIC raw_answers — bypassing
// serveLeadgenAuction (serve-auction.ts:128), unwrapAnswers (:98 — the
// {value,answer_source} envelope seam), and the client-authentic STRING form
// the runtime actually records for a range input (engine.ts handleInputEvent:
// `input.value` is always a string). Reviewer's failure demo: delete
// toNumberLoose's string branch → production slider answers silently drop →
// the old test stayed green (it never fed a string through the coercion at
// all). Rebuilt on the EXISTING G2 harness pattern (test/leadgen-gates.test.ts
// §"G2 — the live /lg/auction provider payload…"): app.request POST
// /lg/auction, a REAL signed attempt (mintLiveAttempt), envelope-shaped
// answers whose numeric field rides as the STRING the client posts — so this
// suite genuinely exercises answers.ts's toNumberLoose coercion SERVER-SIDE,
// through the real HTTP boundary, exactly like a live visitor.
//
// BLOCKER 2 (server-side array selection-count): normalizeAnswers had NO
// selection-count enforcement for array-typed (MultiChoice) answers — a
// scripted client could bypass min/max entirely by POSTing straight to
// /lg/auction (the client-only validateValue check is not a security
// boundary). Fixed in src/leadgen/answers.ts (FieldSpec.minCount/maxCount +
// a drop-on-out-of-bounds branch inside normalizeAnswers — the SAME "invalid
// answer is omitted" discipline the file already uses; no new rejection
// channel). Proven here through the SAME HTTP round-trip: a disqualification
// rule keyed on the MultiChoice field's mere PRESENCE (`neq` against a
// sentinel no real answer could ever equal — `conditionalMet`'s `actual ===
// undefined` guard fails the rule the instant the field is dropped) fires
// only when the selection count survived normalizeAnswers' bounds check.
//
// One shared funnel: DropdownQuestion(coverage) + NumberRangeQuestion(loan_amount)
// + MultiChoiceCardGroup(features, min:2/max:3, 6 choices a..f) in one
// Section, plus THREE disqualification rules (priority-ordered, isolated per
// test by choosing values that can only trip ONE rule at a time):
//   Rule A (eq + gte, AND-group):  coverage=="auto" AND loan_amount>=50000
//   Rule B (lt):                   loan_amount<10000
//   Rule C (presence proxy, neq):  features != "__never__" (fires iff present)

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

// ---------------------------------------------------------------------------
// node:sqlite + D1 shim (test/leadgen-gates.test.ts convention — the FULL
// sites+domains schema, since this suite drives the REAL tenant-routed public
// app via app.request, not a bare in-process engine call).
// ---------------------------------------------------------------------------

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
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
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
        },
        async all<T = unknown>() {
          return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const s of statements) results.push(await s.run());
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
function makeKvStub(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)! : null;
    },
    async getWithMetadata(key: string): Promise<{ value: string | null; metadata: unknown }> {
      return { value: store.get(key) ?? null, metadata: null };
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
  return { kv, store };
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

const TENANT_HOST = "one.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;

function createRuntimeDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','insurance','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','one.example.com','active');",
  );
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return sdb;
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "300",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "r1-roundtrip-signing-key-test-only",
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const API = "/api/admin/leadgen";

interface Harness {
  sdb: SqliteDb;
  env: Env;
}
function newHarness(): Harness {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  const { kv } = makeKvStub();
  return { sdb, env: buildEnv(d1FromSqlite(sdb), kv) };
}

interface CapturedCtx {
  ctx: ExecutionContext;
  promises: Promise<unknown>[];
}
function captureCtx(): CapturedCtx {
  const promises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>): void {
      promises.push(Promise.resolve(p).catch(() => undefined));
    },
    passThroughOnException(): void {},
  } as unknown as ExecutionContext;
  return { ctx, promises };
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function reqTenant(env: Env, path: string, init?: RequestInit, ctx?: ExecutionContext): Promise<Response> {
  return app.request(`${TENANT_ORIGIN}${path}`, init ?? {}, env, ctx);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Funnel + auction + rule seeders (test/leadgen-gates.test.ts G2 conventions)
// ---------------------------------------------------------------------------

// A Section with caller-supplied components (raw INSERT — bypasses content
// validation, matching leadgen-gates.test.ts's seedSectionWithComponents, so
// the multi-field content this suite needs is authorable in one row).
function seedSectionWithComponents(sdb: SqliteDb, components: unknown[]): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({ components });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', 'Headline', ?, 'button', 0, 'active')",
    )
    .run(publicId, `Section ${publicId.slice(-4)}`, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

const COVERAGE_CHOICES = [
  { label: "Auto", value: "auto", analytics_id: "cov_auto" },
  { label: "Home", value: "home", analytics_id: "cov_home" },
];
const FEATURE_CHOICES = ["a", "b", "c", "d", "e", "f"].map((v) => ({
  label: v.toUpperCase(),
  value: v,
  analytics_id: `f_${v}`,
}));

const SECTION_COMPONENTS = [
  { type: "DropdownQuestion", question_id: "q_cov", internal_field: "coverage", answer_type: "enum", choices: COVERAGE_CHOICES, props: {} },
  { type: "NumberRangeQuestion", question_id: "q_loan", internal_field: "loan_amount", answer_type: "number", props: { min: 0, max: 100000, step: 5000 } },
  { type: "MultiChoiceCardGroup", question_id: "q_features", internal_field: "features", answer_type: "array", props: { min: 2, max: 3 }, choices: FEATURE_CHOICES },
];

// Seed the quote → funnel → variant → section → auction chain THROUGH THE
// REAL ADMIN API (matching leadgen-gates.test.ts's seedActivatedFunnel), then
// attach the THREE disqualification rules via raw INSERT (no admin endpoint
// authors funnel_rules today — same class of fixture-only shortcut the
// existing G2/G3 suites take for schema/carrier_parse rows).
async function seedFixture(h: Harness, slug: string): Promise<{ variantId: string }> {
  const { sdb, env } = h;
  const createRes = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: `Q ${slug}`, activity: "quote_funnel", verticals: ["life"] }), env);
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const quote = (await createRes.json()) as { public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> };
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  const section = seedSectionWithComponents(sdb, SECTION_COMPONENTS);

  const quoteRow = sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = ?").get(quote.public_id) as { id: number };
  const auctionRes = await admin.request(
    `${API}/auctions`,
    jsonInit("POST", {
      auction_name: `RT Auction ${slug}`,
      quote_id: quoteRow.id,
      auction_type: "dynamic",
      winner_logic: "highest_bid",
      floor_type: "percentage_of_max",
      floor_value: 10,
      multi_offer: "enabled",
      banner_slots_count: 5,
      max_carriers_per_offer: 3,
      max_total_carriers: 10,
      timeout_ms: 2500,
      status: "active",
    }),
    env,
  );
  expect(auctionRes.status, `create auction: ${await auctionRes.clone().text()}`).toBe(201);
  const auction = (await auctionRes.json()) as { id: number };

  // ONE PUT attaches both the section AND the auction (no offers — the
  // disqualification check runs BEFORE offer participation in the engine, so
  // this suite needs none to prove the rule-flip).
  const putRes = await admin.request(
    `${API}/variants/${variantId}`,
    jsonInit("PUT", { auction_id: auction.id, sections: [{ section_id: section.id, position: 0 }] }),
    env,
  );
  expect(putRes.status, `put variant: ${await putRes.clone().text()}`).toBe(200);

  // Rework M2 (§4.3-1, §4.3-15): activation now also requires the quote's
  // shared first page (leadgen_funnel_pages, quote_id-owned) to carry ≥1
  // section — a section distinct from the funnel/variant's own (§4.3-13
  // uniqueness). Route wiring for POST/PUT /quotes/:id/shared-page is
  // mid-flight in another round, so this seeds the SQL shape directly
  // (mirrors leadgen-rework-handlers.test.ts / leadgen-rework-routing.test.ts).
  const sharedSectionPublicId = mintPublicId("section");
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, 'Shared', 'quote_funnel', 'life', 'Shared', ?, 'button', 'active')",
    )
    .run(sharedSectionPublicId, JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "qs1", question_key: "ks", internal_field: "fs", answer_type: "boolean" }] }));
  const sharedSectionRow = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sharedSectionPublicId) as { id: number };
  const sharedPagePublicId = mintPublicId("funnel_page");
  sdb.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position, name) VALUES (?, ?, 0, NULL)").run(sharedPagePublicId, quoteRow.id);
  sdb
    .prepare(
      `INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id)
       VALUES (?, ?, 0, (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?))`,
    )
    .run(quoteRow.id, sharedSectionRow.id, sharedPagePublicId);

  const actRes = await admin.request(`${API}/quotes/${quote.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true, slug }), env);
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);

  const variantNumericId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(variantId) as { id: number }).id;

  // Rule A (eq + gte AND-group): coverage=="auto" AND loan_amount>=50000.
  sdb
    .prepare(
      "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, enabled) VALUES (?, ?, 'disqualification', ?, 'hA', 0, 1)",
    )
    .run(
      mintPublicId("funnel_rule"),
      variantNumericId,
      JSON.stringify({ groups: [{ field: "coverage", op: "eq", value: "auto" }, { field: "loan_amount", op: "gte", value: 50000 }] }),
    );
  // Rule B (lt): loan_amount<10000.
  sdb
    .prepare(
      "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, enabled) VALUES (?, ?, 'disqualification', ?, 'hB', 1, 1)",
    )
    .run(mintPublicId("funnel_rule"), variantNumericId, JSON.stringify({ groups: [{ field: "loan_amount", op: "lt", value: 10000 }] }));
  // Rule C (presence proxy, neq against a value no real answer equals): fires
  // iff "features" survived normalizeAnswers' selection-count bounds check
  // (a dropped field is `undefined` in ruleContext, and conditionalMet's
  // `actual === undefined` guard rejects EVERY op before it ever compares).
  sdb
    .prepare(
      "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, enabled) VALUES (?, ?, 'disqualification', ?, 'hC', 2, 1)",
    )
    .run(mintPublicId("funnel_rule"), variantNumericId, JSON.stringify({ groups: [{ field: "features", op: "neq", value: "__never__" }] }));

  return { variantId };
}

// mintLiveAttempt (test/leadgen-gates.test.ts G2 convention): /lg/config then
// /lg/attempt with the funnel page's landing URL — the signed binding the
// client must post back verbatim to /lg/auction.
async function mintLiveAttempt(env: Env, variantId: string, landingUrl: string): Promise<{
  section_order_hash: string;
  funnel_attempt_id: string;
  signed_config_token: string;
  session_id: string;
}> {
  const config = (await reqTenant(env, `/lg/config/${variantId}`).then((r) => r.json())) as { section_order_hash: string };
  const attemptRes = await reqTenant(env, `/lg/attempt?funnel_variant_id=${variantId}&u=${encodeURIComponent(landingUrl)}`);
  expect(attemptRes.status, `attempt: ${await attemptRes.clone().text()}`).toBe(200);
  const attempt = (await attemptRes.json()) as { funnel_attempt_id: string; signed_config_token: string; session_id: string };
  return { section_order_hash: config.section_order_hash, ...attempt };
}

// One full round trip: mint a FRESH attempt (never reused across calls, so
// there is no risk of a replay-guard interaction) and POST /lg/auction through
// the REAL app.request boundary with 03 §3.6 envelope-shaped answers
// ({value, answer_source} — the EXACT shape unwrapAnswers expects).
async function submitAnswers(
  env: Env,
  variantId: string,
  answers: Record<string, { value: unknown; answer_source: string }>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const attempt = await mintLiveAttempt(env, variantId, "https://one.example.com/lg/r1?utm_source=test");
  const captured = captureCtx();
  const req = new Request(`${TENANT_ORIGIN}/lg/auction`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      funnel_variant_id: variantId,
      funnel_attempt_id: attempt.funnel_attempt_id,
      section_order_hash: attempt.section_order_hash,
      signed_config_token: attempt.signed_config_token,
      session_id: attempt.session_id,
      page_view_id: "pv-1",
      answers,
    }),
  });
  const res = await app.request(req, undefined, env, captured.ctx);
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

function envelope(value: unknown): { value: unknown; answer_source: string } {
  return { value, answer_source: "user_selected" };
}

// ---------------------------------------------------------------------------
// BLOCKER 1 — dropdown + slider answers reach server ruleContext via the REAL
// /lg/auction HTTP boundary (envelope unwrap + toNumberLoose string→number
// coercion), each answer independently flipping a disqualification rule.
// ---------------------------------------------------------------------------

describeDb("R1 BLOCKER 1 — HTTP-boundary round trip: dropdown + slider answers reach server ruleContext", () => {
  it("BOTH conditions met (coverage='auto' + loan_amount='55000' STRING) → Rule A disqualifies (proves eq + gte-via-string-coercion)", async () => {
    const h = newHarness();
    const { variantId } = await seedFixture(h, "b1a");
    const r = await submitAnswers(h.env, variantId, {
      coverage: envelope("auto"),
      loan_amount: envelope("55000"), // STRING — exactly what handleInputEvent posts for a range input
    });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json["status"]).toBe("disqualified");
  });

  it("DROPDOWN flip: coverage='home' (string mismatch, Rule A's eq fails) → NOT disqualified", async () => {
    const h = newHarness();
    const { variantId } = await seedFixture(h, "b1b");
    const r = await submitAnswers(h.env, variantId, {
      coverage: envelope("home"),
      loan_amount: envelope("55000"),
    });
    expect(r.json["status"]).not.toBe("disqualified");
  });

  it("SLIDER flip via gte: loan_amount='40000' STRING (< 50000, Rule A's gte fails; not < 10000 either) → NOT disqualified", async () => {
    const h = newHarness();
    const { variantId } = await seedFixture(h, "b1c");
    const r = await submitAnswers(h.env, variantId, {
      coverage: envelope("auto"),
      loan_amount: envelope("40000"),
    });
    expect(r.json["status"]).not.toBe("disqualified");
  });

  it("SLIDER flip via lt (Rule B): loan_amount='5000' STRING (< 10000) → disqualified — proves the LT operator ALSO coerces the string", async () => {
    const h = newHarness();
    const { variantId } = await seedFixture(h, "b1d");
    const r = await submitAnswers(h.env, variantId, {
      coverage: envelope("auto"), // Rule A needs gte 50000 too — 5000 fails it; ONLY Rule B can fire
      loan_amount: envelope("5000"),
    });
    expect(r.json["status"]).toBe("disqualified");
  });

  it("NO answers at all → neither rule can match (missing fields) → NOT disqualified (proves it is the ANSWERS, not an always-on rule)", async () => {
    const h = newHarness();
    const { variantId } = await seedFixture(h, "b1e");
    const r = await submitAnswers(h.env, variantId, {});
    expect(r.json["status"]).not.toBe("disqualified");
  });
});

// ---------------------------------------------------------------------------
// BLOCKER 2 — server-side MultiChoice selection-count enforcement
// (src/leadgen/answers.ts normalizeAnswers), proven through the same HTTP
// round trip: Rule C is a PRESENCE PROXY for "features survived normalization"
// (see the rule's comment at seed time). coverage/loan_amount are held at
// values that trip NEITHER Rule A nor Rule B in every case below, isolating
// Rule C as the only possible disqualifier.
// ---------------------------------------------------------------------------

describeDb("R1 BLOCKER 2 — server-side selection-count enforcement (answers.ts normalizeAnswers)", () => {
  const NEUTRAL = { coverage: envelope("home"), loan_amount: envelope("20000") };

  it("0 selections (below min:2) → server DROPS the answer → Rule C misses → NOT disqualified", async () => {
    const h = newHarness();
    const { variantId } = await seedFixture(h, "b2a");
    const r = await submitAnswers(h.env, variantId, { ...NEUTRAL, features: envelope([]) });
    expect(r.json["status"]).not.toBe("disqualified");
  });

  it("6 selections (above max:3) → server DROPS the answer → Rule C misses → NOT disqualified", async () => {
    const h = newHarness();
    const { variantId } = await seedFixture(h, "b2b");
    const r = await submitAnswers(h.env, variantId, { ...NEUTRAL, features: envelope(["a", "b", "c", "d", "e", "f"]) });
    expect(r.json["status"]).not.toBe("disqualified");
  });

  it("2 selections (in bounds [2,3]) → server KEEPS the answer → Rule C fires → disqualified", async () => {
    const h = newHarness();
    const { variantId } = await seedFixture(h, "b2c");
    const r = await submitAnswers(h.env, variantId, { ...NEUTRAL, features: envelope(["a", "b"]) });
    expect(r.json["status"]).toBe("disqualified");
  });

  it("3 selections (in bounds [2,3]) → server KEEPS the answer → Rule C fires → disqualified", async () => {
    const h = newHarness();
    const { variantId } = await seedFixture(h, "b2d");
    const r = await submitAnswers(h.env, variantId, { ...NEUTRAL, features: envelope(["a", "b", "c"]) });
    expect(r.json["status"]).toBe("disqualified");
  });
});
