// LeadGen — Facebook (Meta) events for LeadGen funnels (0064).
//
// OWNER, 2026-10-08: "we want to fire the browser side event to facebook, the
// system should support it in the offer level, including the generated click
// revenue value ... (with all the data we have on the user including pii if we
// are collecting it in the funnel), and also server side event". Rulings:
//   R1 "Every click" — every banner click is its own event (no dedupe);
//   R2 "Offer + funnel, like [the reference funnel]" — offer level: Purchase
//      (configurable) on click, value = the click's bid x a multiplier (default
//      1); funnel level: PageView on load, Lead after the first answer,
//      AddToCart when offers show. Contact details go hashed for matching;
//      browser + server events for the click share ONE event id.
//
// What this file holds (each block fails on the pre-0064 code):
//   1. the funnel shell loads the pixel ONLY when configured (funnel pixel set
//      through the real admin PATCH, or an Offer's click event on), and the
//      Facebook pixel ID control is on the funnel-settings dialog;
//   2. the shell script, EXECUTED (node:vm over the exact shipped string):
//      PageView on load, Lead once after the first answer, AddToCart once when
//      offers are on screen — fed by the runtime's one beacon path, whose hook
//      call is also proven here;
//   3. the card link carries the click event's data attributes (banner.ts);
//   4. the event id round trip: the shell's click handler mints `eid`, appends
//      it to the REAL rendered card href, and the REAL /lg/lc route sends the
//      server event under that same id — every click, any offer kind;
//   5. the server event: value = bid x multiplier / fixed override, the
//      auction's hashed contact fields passed through, `_fbp`, a forged `eid`
//      ignored, and the anti-forgery checks still holding with an `eid`.

import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { SEED_FACEBOOK_TEMPLATE } from "../src/leadgen/revenue-recon";
import { renderBanners, type BannerRenderCarrier } from "../src/public/leadgen/auction/banner";
import { getBannerDesign } from "../src/public/leadgen/designs/registry";
import { metaMatchFieldMap, metaPixelShellScript, type LeadgenMetaPixelShell } from "../src/public/leadgen/serve";
import { normalizeMetaName, normalizeMetaPhone } from "../src/leadgen/meta-hash";
import type { ResolvedActivatedFunnel } from "../src/public/leadgen/resolver";
import { LgBeaconClient } from "../src/public/leadgen/runtime/events";
import { LEADGEN_RUNTIME_JS } from "../src/public/leadgen/runtime/engine-bundle.generated";
import {
  clickoutMetaCardPixel,
  clickoutMetaEventName,
  clickoutMetaValue,
  sendClickoutMetaConversion,
  type ClickoutMetaClick,
  type ClickoutMetaOffer,
} from "../src/leadgen/clickout-meta";

// --- node:sqlite harness (repo pattern) --------------------------------------

type SqliteDb = Record<string, unknown> & { prepare(sql: string): SqliteStmt };
type SqliteStmt = { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
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
      /* fallthrough */
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
}

function makeKvStub(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async getWithMetadata(key: string) {
      return { value: store.get(key) ?? null, metadata: null };
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [
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
  "0056_leadgen_offer_api_token_vault.sql",
  "0057_leadgen_offer_test_verdict.sql",
  "0058_leadgen_offer_clickout_meta.sql",
  "0064_leadgen_meta_pixel.sql",
] as const;

const TENANT_HOST = "one.example.com";
const ADMIN_HOST = "cms.kodigital.app";
const API = "/api/admin/leadgen";
const FUNNEL_PIXEL = "656145712939950";
const OFFER_PIXEL = "111122223333444";
const TOKEN = "EAAtest-token-value-never-rendered";

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

interface Harness {
  sdb: SqliteDb;
  env: Env;
  kv: Map<string, string>;
}

function newHarness(): Harness {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','${TENANT_HOST}','insurance','active');` +
      `INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','${TENANT_HOST}','active');`,
  );
  for (const file of MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  sdb
    .prepare(
      "INSERT INTO leadgen_media_platforms (platform, enabled, postback_url_template, auth_secret_ref, event_name, value_multiplier) VALUES ('facebook', 0, ?, 'LEADGEN_S2S_TOKEN_FACEBOOK', 'Purchase', 1)",
    )
    .run(SEED_FACEBOOK_TEMPLATE);
  const { kv, store } = makeKvStub();
  const env = {
    DB: d1FromSqlite(sdb),
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST,
    ADMIN_BASE_URL: `https://${ADMIN_HOST}`,
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "300",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    LEADGEN_CONFIG_SIGNING_KEY: "runtime-signing-key-test-only",
    LEADGEN_ALLOWED_OUTBOUND_SECRET_REFS: "LEADGEN_S2S_TOKEN_FACEBOOK,LISTICLE_S2S_TOKEN_FACEBOOK",
    LEADGEN_S2S_TOKEN_FACEBOOK: TOKEN,
  } as unknown as Env;
  return { sdb, env, kv: store };
}

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// One activated funnel with contact questions (email/phone/name/ZIP) through
// the real admin API + section SQL (the legacy-pin harness pattern).
const CONTACT_SECTION = {
  components: [
    { type: "QuestionHeadline", question_id: "h1", props: { text: "Your details" } },
    { type: "EmailInputQuestion", question_id: "q_em", question_key: "email_q", internal_field: "email", answer_type: "string", required: true },
    { type: "PhoneInputQuestion", question_id: "q_ph", question_key: "phone_q", internal_field: "phone", answer_type: "string", required: true },
    { type: "NameFieldsGroup", question_id: "q_nm", question_key: "name_q", answer_type: "string", props: {} },
    { type: "ZIPInputQuestion", question_id: "q_zip", question_key: "zip_q", internal_field: "zip_code", answer_type: "string" },
    { type: "ContinueButton", question_id: "c1", props: { label: "Continue" } },
  ],
};

async function activatedFunnel(h: Harness, slug: string): Promise<{ quoteId: number; funnelPub: string; variantPub: string }> {
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Pixel Quote", activity: "quote_funnel", verticals: ["life"] }),
    h.env,
  );
  expect(createRes.status, await createRes.clone().text()).toBe(201);
  const quote = (await createRes.json()) as { id: number; public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> };
  const funnelPub = quote.funnels[0]!.public_id;
  const variantPub = quote.funnels[0]!.variants[0]!.public_id;
  const sectionPub = mintPublicId("section");
  h.sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, 'Contact', 'quote_funnel', 'life', 'Your details', ?, 'button', 0, 'active')",
    )
    .run(sectionPub, JSON.stringify(CONTACT_SECTION));
  const sec = h.sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sectionPub) as { id: number };
  const put = await admin.request(`${API}/variants/${variantPub}`, jsonInit("PUT", { sections: [{ section_id: sec.id }] }), h.env);
  expect(put.status, await put.clone().text()).toBe(200);
  // Rework M2: activation needs the quote's shared first page to carry a section.
  const sharedPub = mintPublicId("section");
  h.sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, 'Shared', 'quote_funnel', 'life', 'Shared', ?, 'button', 0, 'active')",
    )
    .run(sharedPub, JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "qs1", question_key: "ks", internal_field: "fs", answer_type: "boolean" }] }));
  const shared = h.sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sharedPub) as { id: number };
  const pagePub = mintPublicId("funnel_page");
  h.sdb.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position, name) VALUES (?, ?, 0, NULL)").run(pagePub, quote.id);
  h.sdb
    .prepare(
      "INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id) VALUES (?, ?, 0, (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?))",
    )
    .run(quote.id, shared.id, pagePub);
  const act = await admin.request(`${API}/quotes/${quote.public_id}/activation/site-1`, jsonInit("PUT", { enabled: true, slug }), h.env);
  expect(act.status, await act.clone().text()).toBe(200);
  return { quoteId: quote.id, funnelPub, variantPub };
}

async function shell(h: Harness, slug: string): Promise<string> {
  const res = await app.request(`http://${TENANT_HOST}/lg/${slug}`, {}, h.env);
  expect(res.status, await res.clone().text()).toBe(200);
  return res.text();
}

function seedOffer(
  h: Harness,
  opts: { type?: string; calls?: number; on?: number; dataset?: string; value?: number | null; multiplier?: number; eventName?: string | null } = {},
): { offerId: number; offerPublicId: string } {
  const offerPublicId = mintPublicId("offer");
  h.sdb
    .prepare(
      `INSERT INTO leadgen_offers
         (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
          calls_provider_api, bid_source, request_execution_mode, banner_url_template,
          static_bid_value, static_bid_currency, cap_enabled, status,
          clickout_meta_conversion, clickout_meta_dataset_id, clickout_meta_event_name, clickout_meta_value, clickout_meta_value_multiplier)
       VALUES (?, 'Home Offer', 'Impact', 'leadgen', 'Home', 's2s_postback', ?, ?, 'static', 'server',
               'https://partner.example/go?cid={click_id}', 4, 'USD', 0, 'active', ?, ?, ?, ?, ?)`,
    )
    .run(
      offerPublicId,
      opts.type ?? "cpc",
      opts.calls ?? 1,
      opts.on ?? 1,
      opts.dataset ?? OFFER_PIXEL,
      opts.eventName ?? null,
      opts.value ?? null,
      opts.multiplier ?? 1,
    );
  const row = h.sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublicId) as { id: number };
  h.sdb
    .prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, 'pl-1', 1)")
    .run(mintPublicId("offer_placement"), row.id);
  return { offerId: row.id, offerPublicId };
}

const SID = "be9974ca-3fd9-46fc-bcfb-27da76a628a4";
const sha = (v: string): string => createHash("sha256").update(v).digest("hex");
const HASHED_USER = { em: sha("jane@example.com"), ph: sha("15551234567"), fn: sha("jane"), zp: sha("90210") };

function seedAuction(
  h: Harness,
  opts: { aiid: string; faid: string; cards: Array<{ offer_id: string; carrier_key?: string; bid: number; slot?: number }>; snapshot?: Record<string, unknown> },
): void {
  const auctionPublicId = mintPublicId("auction");
  h.sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'A', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled', 1, 5, 3, 10, 'disabled', 'on_slot_exhaustion', 1, 'offer', 2500, 1, 'active')`,
    )
    .run(auctionPublicId);
  const snapshot = opts.snapshot ?? { session_id: SID, meta_user_data: HASHED_USER };
  h.sdb
    .prepare(
      "INSERT INTO leadgen_auction_result_log (auction_instance_id, auction_result_id, auction_config_id, session_id, funnel_attempt_id, funnel_id, carriers_shown_json, macro_context_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      opts.aiid,
      `ares-${opts.aiid}`,
      auctionPublicId,
      SID,
      opts.faid,
      "lgf_x",
      JSON.stringify(opts.cards.map((c, i) => ({ carrier_key: c.carrier_key ?? "", offer_id: c.offer_id, bid: c.bid, slot: c.slot ?? i + 1 }))),
      JSON.stringify(snapshot),
    );
}

// FIX-R1 m3: put an offer in the variant's own auction (the shell's click
// handler ships only for offers of THIS funnel's auction).
function attachToFunnelAuction(h: Harness, variantPub: string, offerId: number, enabled = 1): void {
  const auctionPublicId = mintPublicId("auction");
  h.sdb
    .prepare(
      `INSERT INTO leadgen_auctions
         (public_id, auction_name, auction_type, winner_logic, floor_type, floor_value, multi_offer,
          surface_static_bid_offers, banner_slots_count, max_carriers_per_offer, max_total_carriers,
          backfill, backfill_trigger, remove_clicked_offers, removal_scope, timeout_ms, carrier_normalization_version, status)
       VALUES (?, 'Funnel auction', 'dynamic', 'highest_bid', 'percentage_of_max', 10, 'enabled', 1, 5, 3, 10, 'disabled', 'on_slot_exhaustion', 1, 'offer', 2500, 1, 'active')`,
    )
    .run(auctionPublicId);
  const a = h.sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(auctionPublicId) as { id: number };
  const pl = h.sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE offer_id = ?").get(offerId) as { id: number };
  h.sdb.prepare("INSERT INTO leadgen_auction_offers (auction_id, offer_placement_id, offer_id, enabled) VALUES (?, ?, ?, ?)").run(a.id, pl.id, offerId, enabled);
  h.sdb.prepare("UPDATE leadgen_funnel_variants SET auction_id = ? WHERE public_id = ?").run(a.id, variantPub);
}

function stubFetch() {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input instanceof Request ? input.url : input), init });
    return new Response(JSON.stringify({ events_received: 1, fbtrace_id: "Atrace" }), { status: 200, headers: { "content-type": "application/json" } });
  });
  return {
    metaEvents: () =>
      calls
        .filter((c) => c.url.startsWith("https://graph.facebook.com/"))
        .map((c) => (JSON.parse(String(c.init?.body)) as { data: Array<Record<string, unknown>> }).data[0]!),
  };
}

function captureCtx(): { ctx: ExecutionContext; settle: () => Promise<void> } {
  const promises: Promise<unknown>[] = [];
  return {
    ctx: {
      waitUntil(p: Promise<unknown>) {
        promises.push(Promise.resolve(p).catch(() => undefined));
      },
      passThroughOnException() {},
    } as unknown as ExecutionContext,
    settle: async () => {
      await Promise.all(promises);
      await Promise.all(promises);
    },
  };
}

async function getClick(h: Harness, href: string, cookie = ""): Promise<Response> {
  const cap = captureCtx();
  const res = await app.request(
    `http://${TENANT_HOST}${href}`,
    { headers: { "cf-connecting-ip": "203.0.113.7", "user-agent": "Mozilla/5.0 (iPhone)", referer: `https://${TENANT_HOST}/lg/home`, ...(cookie !== "" ? { cookie } : {}) } },
    h.env,
    cap.ctx,
  );
  await cap.settle();
  return res;
}

// --- the shell script, executed (node:vm over the exact shipped string) -------

interface FbqCall {
  args: unknown[];
}
interface StubAnchor {
  attrs: Record<string, string>;
  getAttribute(n: string): string | null;
  setAttribute(n: string, v: string): void;
}
function stubAnchor(attrs: Record<string, string>): StubAnchor {
  const a: StubAnchor = {
    attrs: { ...attrs },
    getAttribute(n) {
      return Object.prototype.hasOwnProperty.call(a.attrs, n) ? a.attrs[n]! : null;
    },
    setAttribute(n, v) {
      a.attrs[n] = v;
    },
  };
  return a;
}

function runShellScript(
  cfg: LeadgenMetaPixelShell,
  opts: { cookie?: string; bannersOnScreen?: () => boolean; withFbq?: boolean; storage?: Record<string, string>; sandbox?: Record<string, unknown> } = {},
) {
  const fbq: FbqCall[] = [];
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const injected: Array<{ src?: string; async?: boolean }> = [];
  const storage = new Map<string, string>(Object.entries(opts.storage ?? {}));
  const w: Record<string, unknown> = {
    crypto: (globalThis as unknown as { crypto: unknown }).crypto,
    sessionStorage: {
      getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
      key: (i: number) => [...storage.keys()][i] ?? null,
      get length() {
        return storage.size;
      },
    },
  };
  if (opts.withFbq !== false) {
    w["fbq"] = (...args: unknown[]) => {
      fbq.push({ args });
    };
  }
  const d = {
    cookie: opts.cookie ?? `ko_sid=${SID}`,
    createElement: () => ({}) as { src?: string; async?: boolean },
    getElementsByTagName: () => [{ parentNode: { insertBefore: (el: { src?: string; async?: boolean }) => injected.push(el) } }],
    querySelector: (sel: string) => (sel === "a.lg-banner" && (opts.bannersOnScreen?.() ?? false) ? {} : null),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (listeners[type] ??= []).push(fn);
    },
  };
  const html = metaPixelShellScript(cfg);
  expect(html.startsWith("<script>") && html.endsWith("</script>")).toBe(true);
  runInNewContext(html.slice("<script>".length, -"</script>".length), { window: w, document: d, ...(opts.sandbox ?? {}) });
  const hook = (e: Record<string, unknown>): void => (w["__lgOnEvent"] as (e: unknown) => void)(e);
  const click = (a: StubAnchor, type: "click" | "auxclick" = "click", button = 0): void => {
    for (const fn of listeners[type] ?? []) fn({ type, button, target: { closest: (sel: string) => (sel === "a[data-lg-px]" ? a : null) } });
  };
  return { fbq, hook, click, storage, injected, w };
}

const tracked = (fbq: FbqCall[]) => fbq.filter((c) => c.args[0] === "trackSingle").map((c) => ({ pixel: c.args[1], event: c.args[2], data: c.args[3], id: (c.args[4] as { eventID: string }).eventID }));
const inits = (fbq: FbqCall[]) => fbq.filter((c) => c.args[0] === "init").map((c) => ({ pixel: c.args[1], user: c.args[2] as Record<string, string> }));

// ===========================================================================
// 1. the shell loads the pixel only when configured
// ===========================================================================

describeDb("1. funnel shell — the Facebook pixel loads only when configured", () => {
  it("no funnel pixel and no offer click event ⇒ nothing Meta in the shell", async () => {
    const h = newHarness();
    await activatedFunnel(h, "home");
    const html = await shell(h, "home");
    expect(html).not.toContain("fbevents.js");
    expect(html).not.toContain("__lgOnEvent");
    expect(html).toContain('src="/lg/runtime/10.js"');
  });

  it("the funnel's Facebook pixel ID saved through the real admin PATCH reaches the shell: loader, init, PageView, the contact-field map", async () => {
    const h = newHarness();
    const f = await activatedFunnel(h, "home");
    const before = h.sdb.prepare("SELECT content_version FROM leadgen_funnel_variants WHERE public_id = ?").get(f.variantPub) as { content_version: number };
    expect(await shell(h, "home")).not.toContain("fbevents.js"); // cached pristine shell, pre-pixel

    const res = await admin.request(`${API}/funnels/${f.funnelPub}`, jsonInit("PATCH", { meta_pixel_id: ` ${FUNNEL_PIXEL} ` }), h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as Record<string, unknown>)["meta_pixel_id"]).toBe(FUNNEL_PIXEL);
    // The pixel is baked into the cached shell: the save bumps content_version.
    const after = h.sdb.prepare("SELECT content_version FROM leadgen_funnel_variants WHERE public_id = ?").get(f.variantPub) as { content_version: number };
    expect(after.content_version).toBe(before.content_version + 1);

    const html = await shell(h, "home");
    expect(html).toContain("https://connect.facebook.net/en_US/fbevents.js");
    expect(html).toContain(`"p":"${FUNNEL_PIXEL}"`);
    expect(html).toContain("fbq('dataProcessingOptions',[])");
    expect(html).toContain("'PageView'");
    expect(html).toContain('"email":"em"');
    expect(html).toContain('"phone":"ph"');
    expect(html).toContain('"first":"fn"');
    expect(html).toContain('"last":"ln"');
    expect(html).toContain('"zip_code":"zp"');
    // In <head>, before the deferred runtime.
    expect(html.indexOf("fbevents.js")).toBeLessThan(html.indexOf("</head>"));
  });

  it("the PATCH refuses a non-numeric pixel id; null clears it and the shell drops the pixel", async () => {
    const h = newHarness();
    const f = await activatedFunnel(h, "home");
    const bad = await admin.request(`${API}/funnels/${f.funnelPub}`, jsonInit("PATCH", { meta_pixel_id: "pixel-abc" }), h.env);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { fields?: Record<string, string> }).fields?.["meta_pixel_id"]).toMatch(/Facebook pixel ID/);
    expect((await admin.request(`${API}/funnels/${f.funnelPub}`, jsonInit("PATCH", { meta_pixel_id: FUNNEL_PIXEL }), h.env)).status).toBe(200);
    expect(await shell(h, "home")).toContain(`"p":"${FUNNEL_PIXEL}"`);
    expect((await admin.request(`${API}/funnels/${f.funnelPub}`, jsonInit("PATCH", { meta_pixel_id: null }), h.env)).status).toBe(200);
    expect(await shell(h, "home")).not.toContain("fbevents.js");
  });

  it("FIX-R1 m3: no funnel pixel — an offer's click event ships the handler ONLY when that offer is in THIS funnel's auction (never a global 'any offer' check)", async () => {
    // switched on, but not in this funnel's auction ⇒ nothing Meta
    const h1 = newHarness();
    seedOffer(h1, { on: 1 });
    await activatedFunnel(h1, "home");
    const html1 = await shell(h1, "home");
    expect(html1).not.toContain("fbevents.js");
    expect(html1).not.toContain("a[data-lg-px]");

    // the same offer in the funnel's own auction ⇒ the click handler ships (no funnel init)
    const h2 = newHarness();
    const o = seedOffer(h2, { on: 1 });
    const f = await activatedFunnel(h2, "home");
    attachToFunnelAuction(h2, f.variantPub, o.offerId);
    const html2 = await shell(h2, "home");
    expect(html2).toContain("fbevents.js");
    expect(html2).toContain('"p":""');
    expect(html2).toContain(`"v":"${f.variantPub}"`);
    expect(html2).toContain("a[data-lg-px]");

    // in the funnel's auction but disabled there ⇒ nothing Meta
    const h3 = newHarness();
    const o3 = seedOffer(h3, { on: 1 });
    const f3 = await activatedFunnel(h3, "home");
    attachToFunnelAuction(h3, f3.variantPub, o3.offerId, 0);
    expect(await shell(h3, "home")).not.toContain("fbevents.js");
  });

  it("the funnel-settings dialog carries the Facebook pixel ID control, prefilled, saved by its own PATCH", async () => {
    const h = newHarness();
    const f = await activatedFunnel(h, "home");
    await admin.request(`${API}/funnels/${f.funnelPub}`, jsonInit("PATCH", { meta_pixel_id: FUNNEL_PIXEL }), h.env);
    const q = h.sdb.prepare("SELECT public_id FROM leadgen_quotes WHERE id = ?").get(f.quoteId) as { public_id: string };
    const res = await admin.request(`/admin/leadgen/quotes/${q.public_id}/edit`, {}, h.env);
    expect(res.status).toBe(200);
    const html = await res.text();
    const dialog = html.slice(html.indexOf("data-funnel-settings role=\"dialog\""));
    expect(dialog).toContain('<label class="form-label" for="lg-funnel-meta-pixel">Facebook pixel ID</label>');
    expect(dialog).toContain(`id="lg-funnel-meta-pixel" class="form-input" inputmode="numeric" autocomplete="off" placeholder="Leave empty for no pixel" value="${FUNNEL_PIXEL}"`);
    expect(html).toContain(`"meta_pixel_id":"${FUNNEL_PIXEL}"`); // the board blob, per funnel
    // The island's trim regex is a real \s (template-literal double escape).
    expect(html).toContain("px.value.replace(/^\\s+|\\s+$/g, '')");
    expect(html).toContain("req('PATCH', API + '/funnels/' + encodeURIComponent(fsettingsFunnel), { meta_pixel_id:");
  });
});

describe("1b. the contact-field map, by component type", () => {
  it("email/phone/name parts/ZIP/address city-state-zip/birth date; a non-birth date and an arbitrary free text are not contact data", () => {
    const content = {
      components: [
        { type: "EmailInputQuestion", question_id: "a", internal_field: "e_mail_x" },
        { type: "PhoneInputQuestion", question_id: "b", internal_field: "cell_x" },
        { type: "NameFieldsGroup", question_id: "c", props: { fields: ["given", "family"] } },
        { type: "AddressAutocompleteQuestion", question_id: "d", internal_field: "addr" },
        { type: "DateQuestion", question_id: "e", internal_field: "date_of_birth" },
        { type: "DateQuestion", question_id: "f", internal_field: "move_date" },
        { type: "FreeTextQuestion", question_id: "g", internal_field: "first_name" },
        { type: "FreeTextQuestion", question_id: "h", internal_field: "notes" },
        // FIX-R1 M1: the ONE name list (meta-hash.ts) — "telephone" was only in
        // the auction's old private list, never in this map.
        { type: "FreeTextQuestion", question_id: "i", internal_field: "telephone" },
      ],
    };
    const resolved = { sections: [{ section: { content_json: JSON.stringify(content) } }] } as unknown as ResolvedActivatedFunnel;
    const map = metaMatchFieldMap(resolved);
    expect(map["e_mail_x"]).toBe("em");
    expect(map["cell_x"]).toBe("ph");
    expect(map["given"]).toBe("fn");
    expect(map["family"]).toBe("ln");
    expect(map["addr_city"]).toBe("ct");
    expect(map["addr_state"]).toBe("st");
    expect(map["addr_zip"]).toBe("zp");
    expect(map["date_of_birth"]).toBe("db");
    expect(map["move_date"]).toBeUndefined();
    expect(map["first_name"]).toBe("fn");
    expect(map["notes"]).toBeUndefined();
    expect(map["telephone"]).toBe("ph");
  });
});

// ===========================================================================
// 2. funnel-level events, executed
// ===========================================================================

describe("2. funnel pixel — PageView on load, Lead once after the first answer, AddToCart once when offers show", () => {
  const cfg: LeadgenMetaPixelShell = { funnel_pixel_id: FUNNEL_PIXEL, click_events: false, fields: { email: "em" } };

  it("on load: dataProcessingOptions [] BEFORE init, init with the ko_sid external id (FIX-R1 m8: no hardcoded country), then PageView with its own event id", () => {
    const run = runShellScript(cfg);
    expect(run.fbq[0]!.args).toEqual(["dataProcessingOptions", []]);
    expect(inits(run.fbq)).toEqual([{ pixel: FUNNEL_PIXEL, user: { external_id: SID } }]);
    const t = tracked(run.fbq);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ pixel: FUNNEL_PIXEL, event: "PageView" });
    expect(t[0]!.id).toMatch(/^lgp_[A-Za-z0-9]{20}$/);
  });

  it("the standard loader injects fbevents.js when fbq is not on the page yet", () => {
    const run = runShellScript(cfg, { withFbq: false });
    expect(run.injected).toHaveLength(1);
    expect(run.injected[0]!.src).toBe("https://connect.facebook.net/en_US/fbevents.js");
    expect(run.injected[0]!.async).toBe(true);
    expect(typeof run.w["fbq"]).toBe("function");
  });

  it("Lead fires once on the first answer (click or typed), never again; AddToCart once when the cards are on screen", () => {
    let onScreen = false;
    const run = runShellScript(cfg, { bannersOnScreen: () => onScreen });
    run.hook({ event_type: "section_view", funnel_attempt_id: "att_1" });
    run.hook({ event_type: "answer_click", funnel_attempt_id: "att_1", internal_field: "insured", answer_value_normalized: "yes" });
    run.hook({ event_type: "answer_change", funnel_attempt_id: "att_1", internal_field: "email", answer_value_normalized: "a@b.co" });
    run.hook({ event_type: "quote_complete", funnel_attempt_id: "att_1", banner_render_id: "" }); // unfilled / not yet shown
    onScreen = true;
    run.hook({ event_type: "quote_complete", funnel_attempt_id: "att_1", banner_render_id: "br_1" });
    run.hook({ event_type: "quote_complete", funnel_attempt_id: "att_1", banner_render_id: "br_1" });
    const events = tracked(run.fbq).map((t) => t.event);
    expect(events).toEqual(["PageView", "Lead", "AddToCart"]);
    const ids = tracked(run.fbq).map((t) => t.id);
    expect(ids[1]).toMatch(/^lgl_[A-Za-z0-9]{20}$/);
    expect(ids[2]).toMatch(/^lga_[A-Za-z0-9]{20}$/);
    expect(new Set(ids).size).toBe(3);
  });

  it("the runtime's one beacon path calls the shell hook with each event — and a missing or throwing hook never costs the beacon", () => {
    const seen: string[] = [];
    const sent: string[] = [];
    const client = new LgBeaconClient({
      send: (_u, body) => {
        sent.push(body);
        return true;
      },
      now: () => 1790500000000,
      rand: (n) => new Uint8Array(n),
      schedule: () => null,
      cancel: () => undefined,
    });
    const g = globalThis as { __lgOnEvent?: unknown };
    try {
      delete g.__lgOnEvent;
      client.enqueue("quote_view");
      g.__lgOnEvent = (e: { event_type: string }) => void seen.push(e.event_type);
      client.enqueue("answer_click", { internal_field: "email" });
      g.__lgOnEvent = () => {
        throw new Error("hook broke");
      };
      client.enqueue("answer_change");
    } finally {
      delete g.__lgOnEvent;
    }
    expect(seen).toEqual(["answer_click"]);
    expect(client.pendingCount()).toBe(3);
    // FIX-R1 m6: the SERVED bundle reads the global ONCE and calls it only when
    // it is a function (no blind call that throws on every beacon).
    expect(LEADGEN_RUNTIME_JS).not.toContain("globalThis.__lgOnEvent(");
    expect(LEADGEN_RUNTIME_JS).toMatch(/let (\w+)=globalThis\.__lgOnEvent;typeof \1=="function"&&\1\(/);
    // a non-function value is ignored (not called), the beacon still queues
    const g2 = globalThis as { __lgOnEvent?: unknown };
    try {
      g2.__lgOnEvent = 42;
      client.enqueue("quote_complete");
    } finally {
      delete g2.__lgOnEvent;
    }
    expect(client.pendingCount()).toBe(4);
  });

  it("FIX-R1 M3: a reload mid-funnel — the funnel pixel's FIRST init carries the contact data this visitor already gave THIS funnel (sessionStorage), never another funnel's", () => {
    const run = runShellScript(
      { funnel_pixel_id: FUNNEL_PIXEL, click_events: false, fields: { email: "em", first: "fn", phone: "ph" }, variant_id: "lgn_THIS" },
      {
        storage: {
          "lg:att_old": JSON.stringify({ v: 1, tuple: { funnel_variant_id: "lgn_THIS", section_order_hash: "h", content_version: 1 }, answers: { email: { value: " Jane@Example.com " }, first: { value: "Mary-Jane" }, phone: { value: "0015551234567" } }, saved_at: 2 }),
          "lg:att_other": JSON.stringify({ v: 1, tuple: { funnel_variant_id: "lgn_OTHER", section_order_hash: "h", content_version: 1 }, answers: { email: { value: "other@x.com" } }, saved_at: 3 }),
          "lg:corrupt": "{not json",
          unrelated: "x",
        },
      },
    );
    expect(inits(run.fbq)).toEqual([{ pixel: FUNNEL_PIXEL, user: { external_id: SID, em: "jane@example.com", fn: "maryjane", ph: "15551234567" } }]);
    expect(tracked(run.fbq).map((t) => t.event)).toEqual(["PageView"]);
  });

  it("FIX-R1 m1/m2: the browser normalises like the server — names letters only (Unicode kept), phone without leading zeros; values capped to 254 chars", () => {
    const run = runShellScript({ funnel_pixel_id: null, click_events: true, fields: { first: "fn", last: "ln", phone: "ph", city: "ct" } });
    const typed = { first: "Анна-Мария 2nd", last: "a".repeat(300), phone: "0015551234567", city: "New York!" };
    for (const [f, v] of Object.entries(typed)) run.hook({ event_type: "answer_change", funnel_attempt_id: "att_1", internal_field: f, answer_value_normalized: v });
    run.click(stubAnchor({ href: "/lg/lc/lgo_x?ck=a", "data-lg-px": OFFER_PIXEL, "data-lg-px-event": "Purchase" }));
    const user = inits(run.fbq).find((i) => i.pixel === OFFER_PIXEL)!.user;
    expect(user).toEqual({ external_id: SID, fn: "аннамарияnd", ln: "a".repeat(254), ph: "15551234567", ct: "newyork" });
    // the server rules give the same text
    expect(normalizeMetaName(typed.first)).toBe(user["fn"]);
    expect(normalizeMetaName(typed.last)).toBe(user["ln"]);
    expect(normalizeMetaPhone(typed.phone)).toBe(user["ph"]);
  });

  it("FIX-R1 m1: an engine without the RegExp `u` flag (ES5) still keeps the cased letters of any script", () => {
    const Real = RegExp;
    const NoU = function (p: string, f?: string) {
      if (typeof f === "string" && f.indexOf("u") >= 0) throw new SyntaxError("u flag unsupported");
      return new Real(p, f);
    };
    const run = runShellScript({ funnel_pixel_id: null, click_events: true, fields: { first: "fn" } }, { sandbox: { RegExp: NoU } });
    run.hook({ event_type: "answer_change", funnel_attempt_id: "att_1", internal_field: "first", answer_value_normalized: "Zoë-Анна O'Neil 3" });
    run.click(stubAnchor({ href: "/lg/lc/lgo_x", "data-lg-px": OFFER_PIXEL }));
    expect(inits(run.fbq).find((i) => i.pixel === OFFER_PIXEL)!.user["fn"]).toBe("zoëаннаoneil");
  });
});

// ===========================================================================
// 3. the card link carries the click event (banner.ts)
// ===========================================================================

describe("3. banner card — the click event's data attributes ride the governed link", () => {
  const DESIGN = getBannerDesign(null);
  const entry = (clickout: Partial<ClickoutMetaOffer> | null, bid = 4): BannerRenderCarrier => ({
    carrier: { carrier_key: "ck1", carrier_key_source: "slug", carrier_name: "Acme", click_url: "https://partner.example/x" } as BannerRenderCarrier["carrier"],
    offer_public_id: "lgo_01TESTOFFER0000000000000000",
    slot: 1,
    source: "winner",
    bid,
    clickout_offer: clickout,
  });
  const render = (e: BannerRenderCarrier): string =>
    renderBanners([e], { auction_instance_id: "ai_1", funnel_attempt_id: "att_1" }, { mode: "automatic" }, DESIGN, { mintId: () => "lgbr_FIXED" }).html;

  it("switch on, CPC: pixel id, event (Purchase by default), value = bid x multiplier, USD", () => {
    const html = render(entry({ clickout_meta_conversion: 1, clickout_meta_dataset_id: OFFER_PIXEL, offer_type: "cpc", clickout_meta_value_multiplier: 1.5 }));
    expect(html).toContain(`data-lg-px="${OFFER_PIXEL}" data-lg-px-event="Purchase" data-lg-px-value="6" data-lg-px-currency="USD"`);
  });

  it("a fixed value overrides bid x multiplier; a saved event name is kept", () => {
    const html = render(entry({ clickout_meta_conversion: 1, clickout_meta_dataset_id: OFFER_PIXEL, offer_type: "cpc", clickout_meta_value: 12.5, clickout_meta_value_multiplier: 3, clickout_meta_event_name: "Lead" }));
    expect(html).toContain('data-lg-px-event="Lead" data-lg-px-value="12.5"');
  });

  it("no bid / not CPC ⇒ the event still rides, with no value attribute", () => {
    expect(render(entry({ clickout_meta_conversion: 1, clickout_meta_dataset_id: OFFER_PIXEL, offer_type: "cpl" }))).not.toContain("data-lg-px-value");
    expect(render(entry({ clickout_meta_conversion: 1, clickout_meta_dataset_id: OFFER_PIXEL, offer_type: "cpc" }, 0))).not.toContain("data-lg-px-value");
  });

  it("switch off / no dataset / no offer ⇒ byte-identical card, no bid on the page", () => {
    const plain = render(entry(null));
    expect(plain).not.toContain("data-lg-px");
    expect(render(entry({ clickout_meta_conversion: 0, clickout_meta_dataset_id: OFFER_PIXEL, offer_type: "cpc" }))).toBe(plain);
    expect(render(entry({ clickout_meta_conversion: 1, clickout_meta_dataset_id: "pixel-abc", offer_type: "cpc" }))).toBe(plain);
  });

  it("FIX-R1 m4: with no saved name the event follows the offer type — cpc Purchase, cpl/cpa/cpi Lead; a saved name is kept", () => {
    for (const [t, want] of [["cpc", "Purchase"], ["cpl", "Lead"], ["cpa", "Lead"], ["cpi", "Lead"]] as const) {
      expect(clickoutMetaEventName({ clickout_meta_event_name: null, offer_type: t }), t).toBe(want);
      expect(render(entry({ clickout_meta_conversion: 1, clickout_meta_dataset_id: OFFER_PIXEL, offer_type: t })), t).toContain(`data-lg-px-event="${want}"`);
    }
    expect(clickoutMetaEventName({ clickout_meta_event_name: "Contact", offer_type: "cpc" })).toBe("Contact");
    expect(clickoutMetaEventName({ clickout_meta_event_name: "Purchase", offer_type: "cpl" })).toBe("Purchase");
  });

  it("the shared value rule: fixed wins; CPC bid x multiplier rounded to cents; multiplier out of range ⇒ 1", () => {
    expect(clickoutMetaValue({ clickout_meta_value: 9, clickout_meta_value_multiplier: 2, offer_type: "cpc" }, 4)).toBe(9);
    expect(clickoutMetaValue({ clickout_meta_value: null, clickout_meta_value_multiplier: 1.333, offer_type: "cpc" }, 3)).toBe(4);
    expect(clickoutMetaValue({ clickout_meta_value: null, clickout_meta_value_multiplier: 0, offer_type: "cpc" }, 3)).toBe(3);
    expect(clickoutMetaValue({ clickout_meta_value: null, clickout_meta_value_multiplier: 2, offer_type: "cpl" }, 3)).toBeNull();
    expect(clickoutMetaCardPixel({ clickout_meta_conversion: 1, clickout_meta_dataset_id: OFFER_PIXEL }, 3)).toEqual({ dataset_id: OFFER_PIXEL, event_name: "Purchase", value: null, currency: "USD" });
  });
});

// ===========================================================================
// 4. browser → server: one click, one event id, both halves
// ===========================================================================

describeDb("4. the click: the shell mints the event id, the real /lg/lc sends the server half under it — every click", () => {
  async function scenario(opts: { type?: string; calls?: number; multiplier?: number; samePixel?: boolean } = {}) {
    const h = newHarness();
    const dataset = opts.samePixel === true ? FUNNEL_PIXEL : OFFER_PIXEL;
    const { offerPublicId } = seedOffer(h, { type: opts.type ?? "cpc", calls: opts.calls ?? 1, multiplier: opts.multiplier ?? 1.5, dataset });
    seedAuction(h, { aiid: "aiid-1", faid: "att_1", cards: [{ offer_id: offerPublicId, carrier_key: "ck1", bid: 4, slot: 1 }] });
    // The card exactly as banner.ts renders it from the REAL offer row.
    const offerRow = h.sdb.prepare("SELECT * FROM leadgen_offers WHERE public_id = ?").get(offerPublicId) as Partial<ClickoutMetaOffer>;
    const card = renderBanners(
      [{ carrier: { carrier_key: "ck1", carrier_key_source: "slug", carrier_name: "Acme", click_url: "https://partner.example/x" } as BannerRenderCarrier["carrier"], offer_public_id: offerPublicId, slot: 1, source: "winner", bid: 4, clickout_offer: offerRow }],
      { auction_instance_id: "aiid-1", funnel_attempt_id: "att_1" },
      { mode: "automatic" },
      getBannerDesign(null),
      { mintId: () => "lgbr_FIXED" },
    ).html;
    const attrs: Record<string, string> = {};
    for (const m of card.matchAll(/ (href|data-lg-px[a-z-]*)="([^"]*)"/g)) attrs[m[1]!] = m[2]!.replace(/&amp;/g, "&");
    const run = runShellScript({ funnel_pixel_id: FUNNEL_PIXEL, click_events: true, fields: { email: "em", phone: "ph", first: "fn", last: "ln" } });
    return { h, offerPublicId, anchor: stubAnchor(attrs), run };
  }

  it("ONE event id: the browser trackSingle eventID == the `eid` on the link == the server event_id; value 6 (= 4 x 1.5) on both; the server adds the auction's hashed contact fields + _fbp", async () => {
    const { h, anchor, run } = await scenario();
    const f = stubFetch();
    // What the visitor typed, as the runtime beacons / persists it.
    run.hook({ event_type: "answer_change", funnel_attempt_id: "att_1", internal_field: "email", answer_value_normalized: " Jane@Example.com " });
    run.hook({ event_type: "answer_change", funnel_attempt_id: "att_1", internal_field: "phone", answer_value_normalized: "(555) 123-4567" });
    run.storage.set("lg:att_1", JSON.stringify({ answers: { first: { value: "Jane" }, last: { value: "O'Neil" } } }));
    run.hook({ event_type: "quote_complete", funnel_attempt_id: "att_1", banner_render_id: "lgbr_FIXED" });

    run.click(anchor);
    const href = anchor.attrs["href"]!;
    const eid = new URL(href, "http://x").searchParams.get("eid")!;
    expect(eid).toMatch(/^lgc_[A-Za-z0-9]{20}$/);

    // Browser half: the offer's pixel inited at click time WITH what was typed.
    expect(inits(run.fbq).find((i) => i.pixel === OFFER_PIXEL)?.user).toEqual({
      external_id: SID,
      em: "jane@example.com",
      ph: "15551234567",
      fn: "jane",
      ln: "oneil",
    });
    const browser = tracked(run.fbq).filter((t) => t.pixel === OFFER_PIXEL);
    expect(browser).toEqual([{ pixel: OFFER_PIXEL, event: "Purchase", data: { currency: "USD", value: 6 }, id: eid }]);

    // Server half through the REAL route, with the visitor's _fbp cookie.
    const res = await getClick(h, href, "_fbp=fb.1.1790451641000.1234567890");
    expect(res.status).toBe(302);
    const sent = f.metaEvents();
    expect(sent).toHaveLength(1);
    expect(sent[0]!["event_id"]).toBe(eid);
    expect(sent[0]!["event_name"]).toBe("Purchase");
    expect(sent[0]!["custom_data"]).toEqual({ value: 6, currency: "USD" });
    const user = sent[0]!["user_data"] as Record<string, unknown>;
    expect(user["em"]).toEqual([HASHED_USER.em]);
    expect(user["ph"]).toEqual([HASHED_USER.ph]);
    expect(user["fn"]).toEqual([HASHED_USER.fn]);
    expect(user["zp"]).toEqual([HASHED_USER.zp]);
    expect(user["fbp"]).toBe("fb.1.1790451641000.1234567890");
    expect(user["external_id"]).toEqual([sha(SID)]);
  });

  it("OWNER R1: a second click is a NEW event on both halves (new eid replaces the old one on the link; no second init)", async () => {
    const { h, anchor, run } = await scenario();
    const f = stubFetch();
    run.click(anchor);
    const first = anchor.attrs["href"]!;
    await getClick(h, first);
    run.click(anchor, "auxclick", 1); // middle-click: a new tab, the same rule
    const second = anchor.attrs["href"]!;
    await getClick(h, second);
    run.click(anchor, "auxclick", 2); // right button: not a click-out
    expect(anchor.attrs["href"]).toBe(second);

    const e1 = new URL(first, "http://x").searchParams.getAll("eid");
    const e2 = new URL(second, "http://x").searchParams.getAll("eid");
    expect(e1).toHaveLength(1);
    expect(e2).toHaveLength(1);
    expect(e1[0]).not.toBe(e2[0]);
    expect(inits(run.fbq).filter((i) => i.pixel === OFFER_PIXEL)).toHaveLength(1);
    expect(tracked(run.fbq).filter((t) => t.pixel === OFFER_PIXEL).map((t) => t.id)).toEqual([e1[0], e2[0]]);
    expect(f.metaEvents().map((e) => e["event_id"])).toEqual([e1[0], e2[0]]);
  });

  it("the offer's pixel IS the funnel's (already inited on load): no re-init, the browser event still fires; the server half carries the contact hashes", async () => {
    const { h, anchor, run } = await scenario({ samePixel: true });
    const f = stubFetch();
    run.click(anchor);
    expect(inits(run.fbq)).toHaveLength(1);
    const eid = new URL(anchor.attrs["href"]!, "http://x").searchParams.get("eid");
    expect(tracked(run.fbq).filter((t) => t.event === "Purchase").map((t) => t.id)).toEqual([eid]);
    await getClick(h, anchor.attrs["href"]!);
    expect((f.metaEvents()[0]!["user_data"] as Record<string, unknown>)["em"]).toEqual([HASHED_USER.em]);
  });

  it("an API (provider-request) CPL offer sends too — no click bid, so no value; FIX-R1 m4: with no saved name a CPL offer sends Lead on both halves", async () => {
    const { h, anchor, run } = await scenario({ type: "cpl", calls: 1 });
    const f = stubFetch();
    expect(anchor.attrs["data-lg-px-value"]).toBeUndefined();
    expect(anchor.attrs["data-lg-px-event"]).toBe("Lead");
    run.click(anchor);
    expect(tracked(run.fbq).find((t) => t.event === "Lead")?.data).toEqual({ currency: "USD" });
    await getClick(h, anchor.attrs["href"]!);
    expect(f.metaEvents()).toHaveLength(1);
    expect(f.metaEvents()[0]!["event_name"]).toBe("Lead");
    expect(f.metaEvents()[0]).not.toHaveProperty("custom_data");
  });

  it("FIX-R1 M4: six clicks of one card in one funnel attempt — six 302s, five Facebook sends, five ledger bookings", async () => {
    const { h, anchor, run } = await scenario();
    const f = stubFetch();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      run.click(anchor);
      statuses.push((await getClick(h, anchor.attrs["href"]!)).status);
    }
    expect(statuses).toEqual([302, 302, 302, 302, 302, 302]);
    expect(f.metaEvents()).toHaveLength(5);
    const rows = h.sdb.prepare("SELECT booking_trigger, revenue FROM leadgen_revenue_raw").all() as Array<{ booking_trigger: string; revenue: number }>;
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.booking_trigger === "click" && r.revenue === 4)).toBe(true);
    // another funnel attempt is its own budget
    seedAuction(h, { aiid: "aiid-2", faid: "att_2", cards: [{ offer_id: new URL(anchor.attrs["href"]!, "http://x").pathname.split("/").pop()!, carrier_key: "ck1", bid: 4, slot: 1 }] });
    const other = anchor.attrs["href"]!.replace("aiid=aiid-1", "aiid=aiid-2").replace("faid=att_1", "faid=att_2");
    expect((await getClick(h, other)).status).toBe(302);
    expect(f.metaEvents()).toHaveLength(6);
  });
});

// ===========================================================================
// 5. the server half on its own
// ===========================================================================

describeDb("5. server event — value, contact hashes, event id hygiene, anti-forgery with an eid", () => {
  function click(overrides: Partial<ClickoutMetaClick> = {}): ClickoutMetaClick {
    return {
      click_id: "lgl_01CLICK",
      auction_instance_id: "aiid-1",
      funnel_attempt_id: "att_1",
      ip: "203.0.113.7",
      ua: "Mozilla/5.0",
      page_url: "https://one.example.com/lg/home",
      host: "one.example.com",
      carrier_key: "ck1",
      slot: 1,
      ...overrides,
    };
  }
  function offer(h: Harness, publicId: string): ClickoutMetaOffer {
    return h.sdb.prepare("SELECT * FROM leadgen_offers WHERE public_id = ?").get(publicId) as ClickoutMetaOffer;
  }

  it("value = the CLICKED card's recorded USD bid x multiplier (the slot picks the card; nothing priced from the request)", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h, { multiplier: 2 });
    seedAuction(h, {
      aiid: "aiid-1",
      faid: "att_1",
      cards: [
        { offer_id: offerPublicId, carrier_key: "ck1", bid: 3, slot: 1 },
        { offer_id: offerPublicId, carrier_key: "ck2", bid: 7.25, slot: 2 },
      ],
    });
    const f = stubFetch();
    await sendClickoutMetaConversion(h.env, h.env.DB, offer(h, offerPublicId), click({ carrier_key: "ck2", slot: 2 }));
    await sendClickoutMetaConversion(h.env, h.env.DB, offer(h, offerPublicId), click({ click_id: "lgl_02", carrier_key: "ck-unknown", slot: 9 }));
    expect(f.metaEvents()[0]!["custom_data"]).toEqual({ value: 14.5, currency: "USD" });
    expect(f.metaEvents()[1]).not.toHaveProperty("custom_data"); // no such card ⇒ no value
  });

  it("a fixed value overrides bid x multiplier", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h, { multiplier: 2, value: 1.75 });
    seedAuction(h, { aiid: "aiid-1", faid: "att_1", cards: [{ offer_id: offerPublicId, carrier_key: "ck1", bid: 3 }] });
    const f = stubFetch();
    await sendClickoutMetaConversion(h.env, h.env.DB, offer(h, offerPublicId), click());
    expect(f.metaEvents()[0]!["custom_data"]).toEqual({ value: 1.75, currency: "USD" });
  });

  it("meta_user_data passes through as hashed arrays; malformed entries / unknown keys are dropped; a forged eid shape is ignored", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h);
    seedAuction(h, {
      aiid: "aiid-1",
      faid: "att_1",
      cards: [{ offer_id: offerPublicId, carrier_key: "ck1", bid: 3 }],
      snapshot: { session_id: SID, fbp: "fb.1.1790451641000.987654321", meta_user_data: { em: HASHED_USER.em, ph: "jane@example.com", ln: HASHED_USER.em.toUpperCase(), xx: HASHED_USER.em, country: sha("us") } },
    });
    const f = stubFetch();
    const out = await sendClickoutMetaConversion(h.env, h.env.DB, offer(h, offerPublicId), click({ eid: "lgc_<script>" }));
    expect(out).toMatchObject({ status: "fired", event_id: "lgc_lgl_01CLICK" });
    const user = f.metaEvents()[0]!["user_data"] as Record<string, unknown>;
    expect(user["em"]).toEqual([HASHED_USER.em]);
    expect(user["country"]).toEqual([sha("us")]);
    expect(user).not.toHaveProperty("ph"); // plain text never forwarded
    expect(user).not.toHaveProperty("ln"); // not lowercase hex
    expect(user).not.toHaveProperty("xx");
    expect(user["fbp"]).toBe("fb.1.1790451641000.987654321"); // the auction's _fbp when the click has none
    expect(f.metaEvents()[0]!["event_id"]).toBe("lgc_lgl_01CLICK");
  });

  it("a well-formed eid names the event; a malformed _fbp cookie is dropped", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h);
    seedAuction(h, { aiid: "aiid-1", faid: "att_1", cards: [{ offer_id: offerPublicId, carrier_key: "ck1", bid: 3 }], snapshot: { session_id: SID } });
    const f = stubFetch();
    const out = await sendClickoutMetaConversion(h.env, h.env.DB, offer(h, offerPublicId), click({ eid: "lgc_AbC123xyz789", fbp: "fb.1.<img>.1" }));
    expect(out).toMatchObject({ status: "fired", event_id: "lgc_AbC123xyz789" });
    expect(f.metaEvents()[0]!["user_data"]).not.toHaveProperty("fbp");
  });

  it("anti-forgery still holds with a perfectly-shaped eid: no auction / another attempt / an offer that auction never showed ⇒ nothing", async () => {
    const h = newHarness();
    const { offerPublicId } = seedOffer(h);
    const other = seedOffer(h);
    seedAuction(h, { aiid: "aiid-1", faid: "att_1", cards: [{ offer_id: other.offerPublicId, carrier_key: "ck1", bid: 3 }] });
    const f = stubFetch();
    const eid = "lgc_AbC123xyz789";
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offer(h, offerPublicId), click({ eid, auction_instance_id: "forged" }))).toEqual({ status: "skipped", reason: "no_auction" });
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offer(h, other.offerPublicId), click({ eid, funnel_attempt_id: "att_forged" }))).toEqual({ status: "skipped", reason: "attempt_mismatch" });
    expect(await sendClickoutMetaConversion(h.env, h.env.DB, offer(h, offerPublicId), click({ eid }))).toEqual({ status: "skipped", reason: "offer_not_shown" });
    expect(f.metaEvents()).toHaveLength(0);
  });

  it("0064 pins a switched-on 0058 offer with no saved event name to Lead (no live offer changes event); new ones default to Purchase", () => {
    const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
    runSql(
      sdb,
      "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
        "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
        "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
    );
    for (const file of MIGRATIONS.filter((m) => m !== "0064_leadgen_meta_pixel.sql")) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
    const ins = (pub: string, on: number) =>
      sdb
        .prepare(
          `INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type, calls_provider_api, bid_source, request_execution_mode, status, clickout_meta_conversion)
           VALUES (?, 'o', 'leadgen', 'x', 's2s_postback', 'cpc', 0, 'static', 'server', 'active', ?)`,
        )
        .run(pub, on);
    ins("lgo_ON", 1);
    ins("lgo_OFF", 0);
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", "0064_leadgen_meta_pixel.sql"), "utf8"));
    const rows = sdb.prepare("SELECT public_id, clickout_meta_event_name AS e, clickout_meta_value_multiplier AS m FROM leadgen_offers ORDER BY public_id").all() as Array<{ public_id: string; e: string | null; m: number }>;
    expect(rows).toEqual([
      { public_id: "lgo_OFF", e: null, m: 1 },
      { public_id: "lgo_ON", e: "Lead", m: 1 },
    ]);
  });
});
