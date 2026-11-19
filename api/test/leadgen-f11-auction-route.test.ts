// F11 — POST /lg/auction with a "Redirect to offer" rule set to "After the
// offer is shown", through the REAL visitor routes (/lg/attempt → /lg/config →
// POST /lg/auction) and the REAL admin API for the rule, over a node:sqlite D1
// with every migration from 0036 on.
//
// serve-auction.ts's part of the contract (BUILD-SPEC "How the pieces
// connect", step 2): when the engine returns the open instruction it reads
// the Template's look with loadRedirectLook (fail-open: an error gives
// look null, never a 500), turns banners_html into the redirect screen with
// renderRedirectScreen, and adds `redirect_after` to the JSON reply; every
// other reply is unchanged. The screen module is the look build's; here it is
// replaced by a recording double, so this file proves the wiring, not the
// screen's markup.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import type { RedirectAfterInstruction } from "../src/public/leadgen/redirect/types";

const screen = vi.hoisted(() => ({
  failLook: false,
  renderMode: "screen" as "screen" | "throw" | "unchanged",
  lookReads: 0,
  renders: [] as Array<{ banners_html: string; instruction: unknown; look: unknown }>,
}));
vi.mock("../src/public/leadgen/redirect/screen", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadRedirectLook: async () => {
    screen.lookReads += 1;
    if (screen.failLook) throw new Error("template read failed");
    return { from: "the funnel's Template" };
  },
  renderRedirectScreen: (input: { banners_html: string; instruction: unknown; look: unknown }) => {
    screen.renders.push(input);
    if (screen.renderMode === "throw") throw new Error("render failed");
    if (screen.renderMode === "unchanged") return input.banners_html;
    return `<div data-test-redirect-screen>${input.banners_html}</div>`;
  },
}));

type SqliteStatement = { run(...p: unknown[]): unknown; get(...p: unknown[]): unknown; all(...p: unknown[]): unknown[] };
type SqliteDb = { prepare(sql: string): SqliteStatement; close(): void; [m: string]: unknown };
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
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
}
function makeKvStub(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) { return store.get(key) ?? null; },
    async getWithMetadata(key: string) { return { value: store.get(key) ?? null, metadata: null }; },
    async put(key: string, value: string) { store.set(key, value); },
    async delete(key: string) { store.delete(key); },
    async list() { return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" }; },
  } as unknown as KVNamespace;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(TEST_DIR, "..", "migrations");
const TENANT_HOST = "loans.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

afterEach(() => {
  screen.failLook = false;
  screen.renderMode = "screen";
  screen.lookReads = 0;
  screen.renders = [];
});

interface Fixture {
  sdb: SqliteDb;
  env: Env;
  variant: { id: number; public_id: string };
  honest: { id: number; public_id: string };
  fora: { id: number; public_id: string };
}

function insertStaticOffer(sdb: SqliteDb, auctionId: number, name: string, provider: string, bid: number, order: number): { id: number; public_id: string } {
  const publicId = mintPublicId("offer");
  const host = provider.toLowerCase().replace(/\s+/g, "");
  sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, static_bid_value, static_bid_currency,
          static_fallback_banner_url, banner_url_template, status)
       VALUES (?, ?, ?, 'quote_funnel', 'life', 's2s_postback', 'cpl', 0, 'static', 'server', ?, 'USD', ?, ?, 'active')`,
    )
    .run(publicId, name, provider, bid, `https://www.${host}.example/apply`, `https://www.${host}.example/apply?sub={click_id}`);
  const id = (sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(publicId) as { id: number }).id;
  const placementPublic = mintPublicId("offer_placement");
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)").run(placementPublic, id, `plc-${host}`);
  const placementId = (sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number }).id;
  sdb
    .prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, static_order, static_bid_override, enabled) VALUES (?, ?, ?, ?, NULL, 1)")
    .run(auctionId, placementId, id, order);
  return { id, public_id: publicId };
}

function seed(): Fixture {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','${TENANT_HOST}','insurance','active');` +
      `INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','${TENANT_HOST}','active');`,
  );
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 36).sort()) {
    runSql(sdb, readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  }
  const env = {
    DB: d1FromSqlite(sdb),
    CACHE: makeKvStub(),
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "f11-route-signing-key-test-only",
  } as unknown as Env;

  const quotePublic = mintPublicId("quote");
  sdb.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status) VALUES (?, 'SMB Loans', 'quote_funnel', '[\"life\"]', 'active')").run(quotePublic);
  const quoteId = (sdb.prepare("SELECT id FROM leadgen_quotes WHERE public_id = ?").get(quotePublic) as { id: number }).id;
  const auctionPublic = mintPublicId("auction");
  sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'A Bussines loans', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled', 1, 5, 3, 10,
               'disabled', 'on_slot_exhaustion', 1, 'offer', 2500, 1, 'active')`,
    )
    .run(auctionPublic);
  const auctionId = (sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(auctionPublic) as { id: number }).id;
  const sectionPublic = mintPublicId("section");
  const comp = { type: "TwoButtonYesNo", question_id: "q_a1", question_key: "a1", internal_field: "a1", answer_type: "boolean" };
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, 'a1', 'quote_funnel', 'life', 'Headline', ?, 'button', 0, 'active')")
    .run(sectionPublic, JSON.stringify({ components: [comp] }));
  const sectionId = (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sectionPublic) as { id: number }).id;
  const funnelPublic = mintPublicId("funnel");
  sdb.prepare("INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status, display_order) VALUES (?, ?, 'Business Loans Match', 'active', 1)").run(funnelPublic, quoteId);
  const funnelId = (sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelPublic) as { id: number }).id;
  const variantPublic = mintPublicId("funnel_variant");
  sdb
    .prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp, funnel_design_id, status, content_version, auction_id) VALUES (?, ?, 'A', 10000, 'default', 'active', 1, ?)")
    .run(variantPublic, funnelId, auctionId);
  const variantId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(variantPublic) as { id: number }).id;
  sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, quote_id, section_id, position) VALUES (?, NULL, ?, 0)").run(variantId, sectionId);
  sdb.prepare("UPDATE leadgen_quotes SET default_funnel_id = ? WHERE id = ?").run(funnelId, quoteId);
  sdb.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES ('site-1', ?, 1, NULL)").run(quoteId);
  const honest = insertStaticOffer(sdb, auctionId, "Honest Loans - OW", "Honest Loans", 212, 0);
  const fora = insertStaticOffer(sdb, auctionId, "Fora - Tier 3", "Fora", 200, 1);
  return { sdb, env, variant: { id: variantId, public_id: variantPublic }, honest, fora };
}

async function addAfterRule(f: Fixture, offerId: number, pct: number): Promise<string> {
  const res = await admin.request(
    `/api/admin/leadgen/variants/${f.variant.public_id}/rules`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rule_type: "redirect_direct_offer", rule_name: "Show, then open", conditions_json: { groups: [] },
        target_offer_id: offerId, redirect_pct: pct, redirect_show_seconds: 5, redirect_display: "banner",
      }),
    },
    f.env,
  );
  expect(res.status, await res.clone().text()).toBe(201);
  return ((await res.json()) as { public_id: string }).public_id;
}

interface Reply {
  status: string;
  banners_html: string;
  banners: Array<{ slot: number; offer_public_id: string; carrier_key: string }>;
  banner_render_id: string;
  auction_instance_id: string;
  redirect_after?: RedirectAfterInstruction;
  [k: string]: unknown;
}

async function visit(f: Fixture, session: string): Promise<{ reply: Reply; log: { redirect_json: string | null } | undefined }> {
  const cookie = { Cookie: `ko_sid=${session}` };
  const landing = `${TENANT_ORIGIN}/lg?utm_source=google`;
  const attemptRes = await app.request(`${TENANT_ORIGIN}/lg/attempt?vid=${f.variant.public_id}&u=${encodeURIComponent(landing)}`, { headers: cookie }, f.env);
  expect(attemptRes.status).toBe(200);
  const attempt = (await attemptRes.json()) as { funnel_attempt_id: string; signed_config_token: string; session_id: string };
  const config = (await (await app.request(`${TENANT_ORIGIN}/lg/config/${f.variant.public_id}`, {}, f.env)).json()) as { section_order_hash: string };
  const promises: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => promises.push(Promise.resolve(p).catch(() => undefined)), passThroughOnException: () => {} } as unknown as ExecutionContext;
  const res = await app.request(
    new Request(`${TENANT_ORIGIN}/lg/auction`, {
      method: "POST",
      headers: { "content-type": "application/json", Cookie: `ko_sid=${attempt.session_id}` },
      body: JSON.stringify({
        funnel_variant_id: f.variant.public_id,
        funnel_attempt_id: attempt.funnel_attempt_id,
        section_order_hash: config.section_order_hash,
        signed_config_token: attempt.signed_config_token,
        session_id: attempt.session_id,
        page_view_id: "pv-1",
        answers: {},
      }),
    }),
    undefined,
    f.env,
    ctx,
  );
  expect(res.status, await res.clone().text()).toBe(200);
  const reply = (await res.json()) as Reply;
  await Promise.all(promises);
  const log = f.sdb.prepare("SELECT redirect_json FROM leadgen_auction_result_log WHERE funnel_attempt_id = ?").get(attempt.funnel_attempt_id) as
    | { redirect_json: string | null }
    | undefined;
  return { reply, log };
}

describeDb("F11 — POST /lg/auction with an \"After the offer is shown\" rule", () => {
  it("the reply carries redirect_after, and banners_html is the redirect screen built from the normal cards and the Template's look", async () => {
    const f = seed();
    const rule = await addAfterRule(f, f.honest.id, 100);
    const { reply, log } = await visit(f, "s-open");

    expect(reply.status).toBe("ok");
    const card = reply.banners.find((b) => b.offer_public_id === f.honest.public_id)!;
    expect(reply.redirect_after).toEqual({
      rule_public_id: rule,
      offer_public_id: f.honest.public_id,
      slot: card.slot,
      carrier_key: card.carrier_key,
      seconds: 5,
      display: "banner",
      brand: "Honest Loans",
      logo_url: null,
      // this Auction has "Remove clicked offers" on, scope Offer
      stay_hides: { mode: "offer", offer_public_id: f.honest.public_id },
      banner_render_id: reply.banner_render_id,
    });
    // the screen got the untouched cards, the instruction and the look…
    expect(screen.lookReads).toBe(1);
    expect(screen.renders).toHaveLength(1);
    expect(screen.renders[0]!.instruction).toEqual(reply.redirect_after);
    expect(screen.renders[0]!.look).toEqual({ from: "the funnel's Template" });
    expect(screen.renders[0]!.banners_html).toContain(`data-slot="${card.slot}"`);
    // …and its markup is what the page receives; the rest of the reply is as always
    expect(reply.banners_html).toBe(`<div data-test-redirect-screen>${screen.renders[0]!.banners_html}</div>`);
    expect(new Set(reply.banners.map((b) => b.offer_public_id))).toEqual(new Set([f.honest.public_id, f.fora.public_id]));
    expect(reply).not.toHaveProperty("redirect");
    expect(reply).not.toHaveProperty("go");
    expect(JSON.parse(log?.redirect_json ?? "null")).toEqual({ rule_id: rule, offer_id: f.honest.public_id, outcome: "opened" });
  });

  it("a Template look that cannot be read never fails the page: the screen is built with look null", async () => {
    const f = seed();
    await addAfterRule(f, f.honest.id, 100);
    screen.failLook = true;
    const { reply } = await visit(f, "s-look-fails");
    expect(reply.status).toBe("ok");
    expect(reply.redirect_after?.offer_public_id).toBe(f.honest.public_id);
    expect(screen.renders).toHaveLength(1);
    expect(screen.renders[0]!.look).toBeNull();
  });

  for (const mode of ["throw", "unchanged"] as const) {
    it(`a redirect screen that ${mode === "throw" ? "fails to render" : "cannot be built"} never breaks the page: today's results, no redirect_after`, async () => {
      const f = seed();
      await addAfterRule(f, f.honest.id, 100);
      screen.renderMode = mode;
      const { reply, log } = await visit(f, `s-render-${mode}`);
      expect(reply.status).toBe("ok");
      expect(reply).not.toHaveProperty("redirect_after");
      expect(reply.banners_html).toContain('class="lg-banners"');
      expect(reply.banners_html).not.toContain("data-test-redirect-screen");
      // the visitor was assigned to the "opened" half; the record says so
      expect(JSON.parse(log?.redirect_json ?? "null")).toMatchObject({ outcome: "opened" });
    });
  }

  it("[compat] when no rule opens a card, the reply is exactly as before: no redirect_after, no screen, the normal cards", async () => {
    const f = seed();
    await addAfterRule(f, f.honest.id, 0); // "Redirect %" 0: every visitor is held back
    const { reply, log } = await visit(f, "s-held");
    expect(reply.status).toBe("ok");
    expect(reply).not.toHaveProperty("redirect_after");
    expect(screen.lookReads).toBe(0);
    expect(screen.renders).toHaveLength(0);
    expect(reply.banners_html).toContain('class="lg-banners"');
    expect(reply.banners_html).not.toContain("data-test-redirect-screen");
    expect(JSON.parse(log?.redirect_json ?? "null")).toMatchObject({ outcome: "held_back" });
  });
});
