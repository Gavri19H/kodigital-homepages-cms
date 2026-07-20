// Section Builder v3.1 REMEDIATION — phase R4b (Google Maps end-to-end).
//
// The REAL HTTP-boundary proofs for the three per-field Maps jobs, built on the
// EXISTING G2/R1 harness pattern (test/leadgen-r1-auction-roundtrip.test.ts):
// app.request over the tenant-routed public app + admin.request for seeding, a
// signed attempt, envelope-shaped answers.
//
//   * S3-5 — the Validate job runs server-side on POST /lg/auction: a valid ZIP
//     with a (FAKE) server key + a pre-seeded KV ZIP cache enriches the auction
//     with city/state; a malformed ZIP with the key is DROPPED (normalizeAnswers
//     omit discipline); with NO key the leg is byte-identically inert (no drop,
//     no enrichment). NO REAL GOOGLE CALLS — the server key is fake and the
//     geocode leg is served from the KV cache (validateAddress's cache-hit
//     branch never fetches), so nothing ever reaches maps.googleapis.com.
//   * S3-6 — the auction facet with ruled precedence: declared answer > ZIP
//     facet > CF geo, proven through the real route (collisions a/b/c + a
//     state-rule flip driven purely by the ZIP-derived facet).
//   * S3-8 — per-field precedence over the legacy column: funnelNeedsMapsKey
//     (GET /lg/:slug → __LG_MAPS_KEY__ splice) + zipValidation (POST
//     /sections/:id/validate-payload → address_validation), each the documented
//     trio (per-field disabled beats column=1; per-field enabled beats column=0;
//     no per-field config falls back to the column).
//   * S3-7 — sibling-fill authoring round trip: content-schema.ts's new `fills`
//     allowance (conductor-granted ownership) through the REAL PATCH
//     /sections/:id (schema accepts it, persists it, GET re-fetches it
//     unchanged), then mapsConfigJson/renderComponent translate the stored
//     fills into the runtime wire config — shape-parity with
//     parseMapsConfig's reader (the same mirror leadgen-r4b-facet.test.ts uses,
//     runtime/maps.ts being a DOM-lib module excluded from this worker tsconfig
//     program). The Maps-tab picker's live click-driven authoring is proven
//     separately in test-ui/leadgen-r4b-maps-tab.spec.ts (chromium).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import app from "../src/index";
import admin from "../src/admin/router";
import { renderComponent } from "../src/public/leadgen/components/presets";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

// ---------------------------------------------------------------------------
// node:sqlite + D1 shim + KV stub (R1 convention).
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
    async list(opts?: { prefix?: string; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      // MUST respect `prefix` (real KV semantics): the funnel cache invalidation
      // (invalidate.ts deleteByPrefix) lists a shell/config prefix and deletes
      // the matches — a prefix-blind list would wipe the pre-seeded `lg-zip:`
      // ZIP cache too, silently forcing validateAddress into a REAL geocode fetch.
      const prefix = opts?.prefix ?? "";
      return {
        keys: [...store.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cursor: "",
      };
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0042_leadgen_pages.sql",
] as const;

const TENANT_HOST = "one.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const FAKE_SERVER_KEY = "r4b-fake-server-key-test-only";
const FAKE_BROWSER_KEY = "r4b-fake-browser-key-test-only";

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

interface KeyOpts {
  serverKey?: boolean;
  browserKey?: boolean;
}
function buildEnv(db: D1Database, kv: KVNamespace, keys: KeyOpts = {}): Env {
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
    LEADGEN_CONFIG_SIGNING_KEY: "r4b-roundtrip-signing-key-test-only",
    ...(keys.serverKey ? { GOOGLE_MAPS_SERVER_KEY: FAKE_SERVER_KEY } : {}),
    ...(keys.browserKey ? { GOOGLE_MAPS_BROWSER_KEY: FAKE_BROWSER_KEY } : {}),
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;
const API = "/api/admin/leadgen";

interface Harness {
  sdb: SqliteDb;
  env: Env;
  store: Map<string, string>;
}
function newHarness(keys: KeyOpts = {}): Harness {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  const { kv, store } = makeKvStub();
  return { sdb, env: buildEnv(d1FromSqlite(sdb), kv, keys), store };
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

beforeEach(() => {
  // NO REAL GOOGLE CALLS: every validateAddress leg in this suite is served from
  // the pre-seeded KV ZIP cache (its no-fetch branch) or short-circuits on a
  // malformed ZIP before the key check. Any outbound fetch is therefore a bug —
  // fail loudly instead of hitting maps.googleapis.com with the fake key.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      throw new Error(`NO REAL GOOGLE CALLS in R4b tests — unexpected outbound fetch to ${String(url)}`);
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Seeders (R1 conventions).
// ---------------------------------------------------------------------------

// A Section with caller-supplied components + column value (raw INSERT — bypasses
// content validation, matching R1's seedSectionWithComponents).
function seedSectionWithComponents(
  sdb: SqliteDb,
  components: unknown[],
  addressValidation: boolean,
): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({ components });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', 'Headline', ?, 'button', ?, 'active')",
    )
    .run(publicId, `Section ${publicId.slice(-4)}`, content, addressValidation ? 1 : 0);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

interface DisqualRule {
  field: string;
  op: string;
  value: unknown;
}
function disqualify(field: string, op: string, value: unknown): DisqualRule {
  return { field, op, value };
}

// Seed the full quote → auction → section → variant → activation chain through
// the REAL admin API (R1's seedFixture), then attach disqualification rules via
// raw INSERT. Returns the ids the runtime routes key on.
async function seedFunnel(
  h: Harness,
  slug: string,
  opts: { components: unknown[]; addressValidation?: boolean; rules?: DisqualRule[] },
): Promise<{ variantId: string; sectionPublicId: string; slug: string }> {
  const { sdb, env } = h;
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: `Q ${slug}`, activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const quote = (await createRes.json()) as { public_id: string; funnels: Array<{ variants: Array<{ public_id: string }> }> };
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  const section = seedSectionWithComponents(sdb, opts.components, opts.addressValidation ?? false);

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

  const putRes = await admin.request(
    `${API}/variants/${variantId}`,
    jsonInit("PUT", { auction_id: auction.id, sections: [{ section_id: section.id, position: 0 }] }),
    env,
  );
  expect(putRes.status, `put variant: ${await putRes.clone().text()}`).toBe(200);

  const actRes = await admin.request(`${API}/quotes/${quote.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true, slug }), env);
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);

  const variantNumericId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(variantId) as { id: number }).id;
  let priority = 0;
  for (const r of opts.rules ?? []) {
    sdb
      .prepare(
        "INSERT INTO leadgen_funnel_rules (public_id, variant_id, rule_type, conditions_json, conditions_hash, priority, enabled) VALUES (?, ?, 'disqualification', ?, ?, ?, 1)",
      )
      .run(
        mintPublicId("funnel_rule"),
        variantNumericId,
        JSON.stringify({ groups: [{ field: r.field, op: r.op, value: r.value }] }),
        `h${priority}`,
        priority,
      );
    priority += 1;
  }
  return { variantId, sectionPublicId: section.public_id, slug };
}

async function mintLiveAttempt(env: Env, variantId: string): Promise<{
  section_order_hash: string;
  funnel_attempt_id: string;
  signed_config_token: string;
  session_id: string;
}> {
  const config = (await reqTenant(env, `/lg/config/${variantId}`).then((r) => r.json())) as { section_order_hash: string };
  const attemptRes = await reqTenant(
    env,
    `/lg/attempt?funnel_variant_id=${variantId}&u=${encodeURIComponent("https://one.example.com/lg/r4b?utm_source=test")}`,
  );
  expect(attemptRes.status, `attempt: ${await attemptRes.clone().text()}`).toBe(200);
  const attempt = (await attemptRes.json()) as { funnel_attempt_id: string; signed_config_token: string; session_id: string };
  return { section_order_hash: config.section_order_hash, ...attempt };
}

function envelope(value: unknown): { value: unknown; answer_source: string } {
  return { value, answer_source: "user_selected" };
}

// One full round trip: mint a fresh attempt, POST /lg/auction through the REAL
// app.request boundary. `cf` fabricates the CF edge geo (survives Hono's
// pass-through fetch — the leadgen-gates.test.ts idiom).
async function submitAnswers(
  env: Env,
  variantId: string,
  answers: Record<string, { value: unknown; answer_source: string }>,
  cf?: Record<string, unknown>,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const attempt = await mintLiveAttempt(env, variantId);
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
  if (cf !== undefined) Object.assign(req, { cf });
  const res = await app.request(req, undefined, env, captured.ctx);
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, json };
}

// Component factories.
function zipComp(maps: unknown, field = "zip"): unknown {
  const node: Record<string, unknown> = { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: field, answer_type: "string" };
  if (maps !== undefined) node["props"] = { maps };
  return node;
}
function stateComp(): unknown {
  return {
    type: "DropdownQuestion",
    question_id: "q_state",
    internal_field: "state",
    answer_type: "enum",
    choices: [
      { label: "CA", value: "CA", analytics_id: "s_ca" },
      { label: "NY", value: "NY", analytics_id: "s_ny" },
      { label: "FL", value: "FL", analytics_id: "s_fl" },
    ],
    props: {},
  };
}
const newMaps = (jobs: Record<string, boolean>) => ({ enabled: true, jobs });

// Pre-seed the KV ZIP cache so validateAddress resolves city/state from cache
// (its no-fetch branch — NO real Google call).
function seedZipCache(h: Harness, zip: string, city: string, state: string): void {
  h.store.set(`lg-zip:${zip}`, JSON.stringify({ city, state }));
}

// ===========================================================================
// S3-5 — the Validate job runs server-side on the live /lg/auction path
// ===========================================================================

describeDb("R4b S3-5 — server-side Maps validate leg on POST /lg/auction", () => {
  it("valid ZIP + FAKE server key → geocode city/state reach the auction (a state rule keyed on the ZIP-derived state fires)", async () => {
    const h = newHarness({ serverKey: true });
    seedZipCache(h, "90210", "Beverly Hills", "CA");
    const { variantId } = await seedFunnel(h, "s35a", {
      components: [zipComp(newMaps({ validate: true, auction: true }))],
      rules: [disqualify("state", "eq", "CA")],
    });
    const r = await submitAnswers(h.env, variantId, { zip: envelope("90210") });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json["status"]).toBe("disqualified"); // state=CA came from the validated ZIP
  });

  it("NO server key → the validate leg no-ops (byte-identical): the SAME valid ZIP yields NO state enrichment, so the state rule misses", async () => {
    const h = newHarness(); // no server key
    seedZipCache(h, "90210", "Beverly Hills", "CA"); // present, but the keyless leg never reads it
    const { variantId } = await seedFunnel(h, "s35b", {
      components: [zipComp(newMaps({ validate: true, auction: true }))],
      rules: [disqualify("state", "eq", "CA")],
    });
    const r = await submitAnswers(h.env, variantId, { zip: envelope("90210") });
    expect(r.json["status"]).not.toBe("disqualified"); // ZIP-only facet, no state ⇒ rule misses
  });

  it("invalid ZIP + FAKE server key → the answer is DROPPED (a presence-proxy rule on the ZIP field misses)", async () => {
    const h = newHarness({ serverKey: true });
    const { variantId } = await seedFunnel(h, "s35c", {
      components: [zipComp(newMaps({ validate: true }))],
      rules: [disqualify("zip", "neq", "__never__")], // fires iff `zip` survived normalization
    });
    const r = await submitAnswers(h.env, variantId, { zip: envelope("1234") }); // malformed → validateAddress invalid → drop
    expect(r.json["status"]).not.toBe("disqualified");
  });

  it("invalid ZIP + NO server key → byte-identical to today: the answer is KEPT (the presence-proxy rule fires)", async () => {
    const h = newHarness(); // no server key ⇒ no validate leg ⇒ no drop
    const { variantId } = await seedFunnel(h, "s35d", {
      components: [zipComp(newMaps({ validate: true }))],
      rules: [disqualify("zip", "neq", "__never__")],
    });
    const r = await submitAnswers(h.env, variantId, { zip: envelope("1234") });
    expect(r.json["status"]).toBe("disqualified"); // "1234" kept as a string answer, exactly as pre-R4b
  });
});

// ===========================================================================
// S3-6 — the auction facet with the ruled precedence (declared > facet > CF)
// ===========================================================================

describeDb("R4b S3-6 — auction location facet precedence through POST /lg/auction", () => {
  it("collision (a): a DECLARED state answer wins over the ZIP-derived facet state", async () => {
    const h = newHarness({ serverKey: true });
    seedZipCache(h, "10001", "New York", "NY"); // ZIP → facet state NY
    const { variantId } = await seedFunnel(h, "s36a", {
      components: [stateComp(), zipComp(newMaps({ validate: true, auction: true }))],
      rules: [disqualify("state", "eq", "NY")], // fires only if the facet's NY reached the context
    });
    // Declared state=CA + a ZIP whose facet says NY. Declared must win ⇒ NOT NY ⇒ NOT disqualified.
    const r = await submitAnswers(h.env, variantId, { state: envelope("CA"), zip: envelope("10001") });
    expect(r.json["status"], "declared CA must beat facet NY").not.toBe("disqualified");
  });

  it("collision (b): the facet beats CF-derived request geo", async () => {
    const h = newHarness({ serverKey: true });
    seedZipCache(h, "10001", "New York", "NY");
    const { variantId } = await seedFunnel(h, "s36b", {
      components: [zipComp(newMaps({ validate: true, auction: true }))], // NO declared state field
      rules: [disqualify("state", "eq", "NY")],
    });
    // CF says FL; the ZIP facet says NY. Facet must beat CF ⇒ state=NY ⇒ disqualified.
    const r = await submitAnswers(h.env, variantId, { zip: envelope("10001") }, { regionCode: "FL", country: "US" });
    expect(r.json["status"], "facet NY must beat CF FL").toBe("disqualified");
  });

  it("collision (c): NO auction field ⇒ facet absent ⇒ context byte-identical (CF geo still seen)", async () => {
    const h = newHarness({ serverKey: true });
    seedZipCache(h, "10001", "New York", "NY");
    const { variantId } = await seedFunnel(h, "s36c", {
      components: [zipComp(newMaps({ validate: true }))], // validate-only ⇒ NO facet
      rules: [disqualify("state", "eq", "FL")], // the CF-derived state
    });
    // No facet ⇒ ruleContext.state is the CF regionCode FL, unchanged ⇒ disqualified on FL.
    const r = await submitAnswers(h.env, variantId, { zip: envelope("10001") }, { regionCode: "FL", country: "US" });
    expect(r.json["status"], "no facet ⇒ CF FL still drives the rule").toBe("disqualified");
  });

  it("e2e flip: an auction disqualification rule keyed on `state` flips on the ZIP-derived facet", async () => {
    const h = newHarness({ serverKey: true });
    seedZipCache(h, "90210", "Beverly Hills", "CA");
    seedZipCache(h, "10001", "New York", "NY");
    const { variantId } = await seedFunnel(h, "s36e", {
      components: [zipComp(newMaps({ validate: true, auction: true }))],
      rules: [disqualify("state", "eq", "CA")],
    });
    const ca = await submitAnswers(h.env, variantId, { zip: envelope("90210") });
    expect(ca.json["status"], "ZIP 90210 → facet CA → rule fires").toBe("disqualified");
    const ny = await submitAnswers(h.env, variantId, { zip: envelope("10001") });
    expect(ny.json["status"], "ZIP 10001 → facet NY → rule misses").not.toBe("disqualified");
  });
});

// ===========================================================================
// Adversarial-review MAJOR F1 fix — an AUCTION-ONLY field (validate:false,
// auction:true) must still get the server-side geocode enrichment when the
// key is present. The bug: applyMapsAuctionLegs (serve-auction.ts) gated the
// WHOLE geocode call on `f.validate`, so an auction-only field never called
// validateAddress at all — the facet stayed ZIP-only even with a working key,
// contradicting the Maps-tab degradation note's own promise ("without [the
// server key], only the ZIP itself is available" implies WITH it, state/city
// ARE available). Fixed: geocode runs for validate OR auction; the drop-on-
// invalid-ZIP discipline stays gated to validate alone (the only job with
// rejection semantics) — an auction-only field never drops an answer, it just
// fails to enrich the facet.
// ===========================================================================

describeDb("R4b MAJOR-F1 — auction-only field geocode gating (serve-auction.ts applyMapsAuctionLegs)", () => {
  it("reviewer's exact probe: auction-only + fake key + cached ZIP 90210 → the state-eq-CA rule FIRES (facet enriched)", async () => {
    const h = newHarness({ serverKey: true });
    seedZipCache(h, "90210", "Beverly Hills", "CA");
    const { variantId } = await seedFunnel(h, "f1a", {
      components: [zipComp(newMaps({ auction: true }))], // AUCTION ONLY — validate is false
      rules: [disqualify("state", "eq", "CA")],
    });
    const r = await submitAnswers(h.env, variantId, { zip: envelope("90210") });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json["status"], "auction-only field's ZIP must still geocode-enrich the facet with state=CA").toBe(
      "disqualified",
    );
  });

  it("auction-only + key + a MOCKED geocode failure → ZIP-only facet (rule misses), answer KEPT (presence-proxy rule fires), geocode WAS attempted", async () => {
    const h = newHarness({ serverKey: true });
    // Deliberately NOT cached — forces validateAddress into its geocode leg.
    const fetchMock = vi.fn(async () => ({ ok: false }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { variantId } = await seedFunnel(h, "f1b", {
      components: [zipComp(newMaps({ auction: true }))], // AUCTION ONLY
      // Two independent, mutually-exclusive-in-effect rules: a state rule that
      // must MISS (no enrichment reached it) and a zip-presence proxy that
      // must FIRE (the answer was never dropped on the geocode no_op).
      rules: [disqualify("state", "eq", "CA"), disqualify("zip", "neq", "__never__")],
    });
    const r = await submitAnswers(h.env, variantId, { zip: envelope("90210") });
    expect(fetchMock, "the F1 fix means an auction-only field DOES attempt the geocode").toHaveBeenCalledTimes(1);
    expect(r.json["status"], "zip kept (presence-proxy rule c fires) even though state rule a missed (no_op ⇒ ZIP-only facet)").toBe(
      "disqualified",
    );
  });

  it("auction-only + NO server key → ZIP-only facet, unchanged (existing §9.3 degradation stays green)", async () => {
    const h = newHarness(); // no server key
    seedZipCache(h, "90210", "Beverly Hills", "CA"); // present but unreachable without a key
    const { variantId } = await seedFunnel(h, "f1c", {
      components: [zipComp(newMaps({ auction: true }))], // AUCTION ONLY
      rules: [disqualify("state", "eq", "CA")],
    });
    const r = await submitAnswers(h.env, variantId, { zip: envelope("90210") });
    expect(r.json["status"], "no key ⇒ no geocode ⇒ ZIP-only facet ⇒ the state rule cannot fire").not.toBe(
      "disqualified",
    );
  });
});

// ===========================================================================
// S3-8 — per-field precedence over the legacy address_validation column
// ===========================================================================

describeDb("R4b S3-8 — funnelNeedsMapsKey per-field precedence (GET /lg/:slug __LG_MAPS_KEY__ splice)", () => {
  async function shellHtml(h: Harness, slug: string): Promise<string> {
    const res = await reqTenant(h.env, `/lg/${slug}`);
    expect(res.status, `shell: ${await res.clone().text()}`).toBe(200);
    return res.text();
  }

  it("(a) per-field maps DISABLED but column=1 → key NOT injected (per-field wins)", async () => {
    const h = newHarness({ browserKey: true });
    await seedFunnel(h, "s38a", {
      components: [{ type: "AddressAutocompleteQuestion", question_id: "q_a", props: { maps: { enabled: false, jobs: {} } } }],
      addressValidation: true, // column=1
    });
    expect(await shellHtml(h, "s38a")).not.toContain("__LG_MAPS_KEY__");
  });

  it("(b) per-field ENABLED, column=0 → key injected", async () => {
    const h = newHarness({ browserKey: true });
    await seedFunnel(h, "s38b", {
      components: [{ type: "AddressAutocompleteQuestion", question_id: "q_a", props: { maps: newMaps({ autocomplete: true }) } }],
      addressValidation: false, // column=0
    });
    expect(await shellHtml(h, "s38b")).toContain("__LG_MAPS_KEY__");
  });

  it("(c) no per-field config anywhere, column=1 → legacy behavior preserved (key injected)", async () => {
    const h = newHarness({ browserKey: true });
    await seedFunnel(h, "s38c", {
      components: [{ type: "AddressAutocompleteQuestion", question_id: "q_a", props: {} }], // no maps config
      addressValidation: true, // column=1
    });
    expect(await shellHtml(h, "s38c")).toContain("__LG_MAPS_KEY__");
  });
});

describeDb("R4b S3-8 — zipValidation per-field precedence (POST /sections/:id/validate-payload)", () => {
  async function addressValidationFor(
    env: Env,
    sectionPublicId: string,
    answers: Record<string, unknown>,
  ): Promise<{ enabled: boolean; has_malformed: boolean } | null> {
    const res = await admin.request(
      `${API}/sections/${sectionPublicId}/validate-payload`,
      jsonInit("POST", { answers }),
      env,
    );
    expect(res.status, `validate-payload: ${await res.clone().text()}`).toBe(200);
    const json = (await res.json()) as { address_validation: { enabled: boolean; has_malformed: boolean } | null };
    return json.address_validation;
  }

  it("(a) per-field validate DISABLED but column=1 → NOT validated (per-field wins → null)", async () => {
    const h = newHarness();
    const s = seedSectionWithComponents(h.sdb, [zipComp({ enabled: false, jobs: {} })], true /* column=1 */);
    expect(await addressValidationFor(h.env, s.public_id, { zip: "1234" })).toBeNull();
  });

  it("(b) per-field validate ENABLED, column=0 → validated (a malformed ZIP is flagged)", async () => {
    const h = newHarness();
    const s = seedSectionWithComponents(h.sdb, [zipComp(newMaps({ validate: true }))], false /* column=0 */);
    const av = await addressValidationFor(h.env, s.public_id, { zip: "1234" });
    expect(av).not.toBeNull();
    expect(av!.has_malformed).toBe(true);
  });

  it("(c) no per-field config, column=1 → legacy column validates (malformed ZIP flagged)", async () => {
    const h = newHarness();
    const s = seedSectionWithComponents(h.sdb, [zipComp(undefined)], true /* column=1 */);
    const av = await addressValidationFor(h.env, s.public_id, { zip: "1234" });
    expect(av).not.toBeNull();
    expect(av!.has_malformed).toBe(true);
  });
});

// ===========================================================================
// S3-7 — sibling-fill authoring round trip through the REAL PATCH /sections/:id
// ===========================================================================

// A faithful LOCAL mirror of runtime/maps.ts parseMapsConfig's nested-`fills`
// reader (runtime/maps.ts:42-58 pick(flat, nested)) — the SAME mirror
// leadgen-r4b-facet.test.ts uses. runtime/maps.ts is a browser (DOM-lib)
// module excluded from this worker tsconfig program, so it cannot be imported
// directly here; this mirror is the parity source both suites check against.
function fillsAsRuntimeReads(wire: Record<string, unknown>): Record<string, string> {
  const fillsRaw = wire["fills"] !== null && typeof wire["fills"] === "object" ? (wire["fills"] as Record<string, unknown>) : {};
  const pick = (flat: string, nested: string): string | undefined => {
    const v = wire[flat] !== undefined ? wire[flat] : fillsRaw[nested];
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  const out: Record<string, string> = {};
  for (const slot of ["street", "city", "state", "zip"] as const) {
    const v = pick(`autofill_${slot}`, slot);
    if (v !== undefined) out[slot] = v;
  }
  return out;
}

function decodeMapsAttr(rendered: string): Record<string, unknown> {
  const m = rendered.match(/data-lg-maps="([^"]*)"/);
  if (m === null) throw new Error("no data-lg-maps attribute in render");
  const decoded = m[1]!
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  return JSON.parse(decoded) as Record<string, unknown>;
}

describeDb("R4b S3-7 — fills authoring round trip (real PATCH → GET → render → parseMapsConfig parity)", () => {
  it("set fills (as the picker's collectMapsFill authors them) → PATCH → GET → mapsConfigJson carries fills, shape-parity with parseMapsConfig", async () => {
    const h = newHarness();
    const seeded = seedSectionWithComponents(
      h.sdb,
      [zipComp(undefined, "zip"), { type: "FreeTextQuestion", question_id: "q_city", internal_field: "city_field", answer_type: "string", props: { placeholder: "City" } }],
      false,
    );
    // Exactly the shape collectMapsFill authors: {enabled,jobs,fills}, fills
    // carrying only the ONE slot the operator picked (city → city_field).
    const contentWithFills = {
      components: [
        {
          type: "ZIPInputQuestion",
          question_id: "q_zip",
          internal_field: "zip",
          answer_type: "string",
          props: { maps: { enabled: true, jobs: { autocomplete: true }, fills: { city: "city_field" } } },
        },
        { type: "FreeTextQuestion", question_id: "q_city", internal_field: "city_field", answer_type: "string", props: { placeholder: "City" } },
      ],
    };
    const patchRes = await admin.request(
      `${API}/sections/${seeded.public_id}`,
      jsonInit("PATCH", { content_json: JSON.stringify(contentWithFills) }),
      h.env,
    );
    expect(patchRes.status, `PATCH: ${await patchRes.clone().text()}`).toBe(200);

    const getRes = await admin.request(`${API}/sections/${seeded.public_id}`, { method: "GET" }, h.env);
    expect(getRes.status, `GET: ${await getRes.clone().text()}`).toBe(200);
    const detail = (await getRes.json()) as { content_json: { components: LeadgenComponentNode[] } };
    const zipNode = detail.content_json.components.find((n) => n.question_id === "q_zip");
    expect(zipNode, "zip node survives the round trip").toBeDefined();
    expect(zipNode!.props?.["maps"]).toEqual({ enabled: true, jobs: { autocomplete: true }, fills: { city: "city_field" } });

    // …and the REAL preset renderer translates the stored fills into the
    // runtime's wire config (mapsConfigJson, presets.ts) — the SAME
    // translation the R4b facet suite pins in isolation.
    const rendered = renderComponent(zipNode!, defaultFunnelDesign);
    const wire = decodeMapsAttr(rendered);
    expect(wire).toEqual({ enable_autocomplete: true, validate: false, fills: { city: "city_field" } });
    expect(fillsAsRuntimeReads(wire)).toEqual({ city: "city_field" });
  });

  it("unknown fills slot is REJECTED by content-schema (the new allowance is additive, not permissive)", async () => {
    const h = newHarness();
    const seeded = seedSectionWithComponents(h.sdb, [zipComp(undefined, "zip")], false);
    const badContent = {
      components: [
        {
          type: "ZIPInputQuestion",
          question_id: "q_zip",
          internal_field: "zip",
          answer_type: "string",
          props: { maps: { enabled: true, jobs: { autocomplete: true }, fills: { country: "nope" } } },
        },
      ],
    };
    const patchRes = await admin.request(`${API}/sections/${seeded.public_id}`, jsonInit("PATCH", { content_json: JSON.stringify(badContent) }), h.env);
    expect(patchRes.status, `PATCH: ${await patchRes.clone().text()}`).toBe(400);
  });

  it("a non-string / empty-string fill value is REJECTED by content-schema", async () => {
    const h = newHarness();
    const seeded = seedSectionWithComponents(h.sdb, [zipComp(undefined, "zip")], false);
    const badContent = {
      components: [
        {
          type: "ZIPInputQuestion",
          question_id: "q_zip",
          internal_field: "zip",
          answer_type: "string",
          props: { maps: { enabled: true, jobs: { autocomplete: true }, fills: { city: "" } } },
        },
      ],
    };
    const patchRes = await admin.request(`${API}/sections/${seeded.public_id}`, jsonInit("PATCH", { content_json: JSON.stringify(badContent) }), h.env);
    expect(patchRes.status, `PATCH: ${await patchRes.clone().text()}`).toBe(400);
  });

  it("a fills-less new-shape config still round-trips byte-identically (no stray fills:{})", async () => {
    const h = newHarness();
    const seeded = seedSectionWithComponents(h.sdb, [zipComp(undefined, "zip")], false);
    const content = {
      components: [
        { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string", props: { maps: { enabled: true, jobs: { validate: true } } } },
      ],
    };
    const patchRes = await admin.request(`${API}/sections/${seeded.public_id}`, jsonInit("PATCH", { content_json: JSON.stringify(content) }), h.env);
    expect(patchRes.status, `PATCH: ${await patchRes.clone().text()}`).toBe(200);
    const getRes = await admin.request(`${API}/sections/${seeded.public_id}`, { method: "GET" }, h.env);
    const detail = (await getRes.json()) as { content_json: { components: LeadgenComponentNode[] } };
    const zipNode = detail.content_json.components.find((n) => n.question_id === "q_zip");
    expect(zipNode!.props?.["maps"]).toEqual({ enabled: true, jobs: { validate: true } });
    expect(decodeMapsAttr(renderComponent(zipNode!, defaultFunnelDesign))).toEqual({ enable_autocomplete: false, validate: true });
  });
});
