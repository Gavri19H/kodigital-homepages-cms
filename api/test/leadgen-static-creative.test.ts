// OWNER 2026-09-27 — "When editing a 'Static — no provider request' offer →
// allow building the banner properties (Creative), similar to the fields that
// are available to the offers that do send a request … only the URL is
// available which leads to a very 'thin' creative."
//
// The engine side (the creative on the live card, carrier key stability, CPL
// untouched) is driven through the real auction in
// leadgen-auction-runtime.test.ts ("static Offer banner creative (0060)").
// This file holds the operator side on the real admin router + migrations:
// the field rules, the Offer API, the live-preview endpoint (the REAL banner
// renderer + funnel stylesheet) and the Static tab.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { resolveCreativeLogo, validateStaticCreativeField } from "../src/leadgen/static-creative";

type SqliteDb = Record<string, unknown> & { prepare(sql: string): { run(...a: unknown[]): unknown; get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] } };
type DatabaseSyncCtor = new (path: string) => SqliteDb;
function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    return (createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    const g = (process as unknown as { getBuiltinModule?: (n: string) => unknown }).getBuiltinModule;
    return typeof g === "function" ? (g("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync : null;
  }
}
function d1(sdb: SqliteDb): D1Database {
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) { binds = a; return stmt; },
        async first<T>() { return (sdb.prepare(sql).get(...binds) ?? null) as T | null; },
        async all<T>() { return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} }; },
        async run() { const r = sdb.prepare(sql).run(...binds) as { changes?: number }; return { success: true, meta: { changes: Number(r?.changes ?? 0) } }; },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const out: unknown[] = [];
      for (const s of statements) out.push(await s.run());
      return out;
    },
  } as unknown as D1Database;
}
const DIR = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = [
  "0036_leadgen_core.sql", "0037_leadgen_analytics_mirror.sql", "0038_leadgen_revenue_infra.sql", "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql", "0041_leadgen_frame_theme.sql", "0042_leadgen_pages.sql", "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql", "0045_leadgen_persona_quota.sql", "0046_leadgen_rework_m1_variants.sql", "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql", "0049_leadgen_rework_m4_m5_defaults_templates.sql", "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql", "0052_leadgen_rework_m9_address_fields.sql", "0053_leadgen_rework_m12_othergroup_retirement.sql",
  "0056_leadgen_offer_api_token_vault.sql", "0057_leadgen_offer_test_verdict.sql", "0058_leadgen_offer_clickout_meta.sql",
  "0060_leadgen_offer_static_creative.sql",
];
const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function harness(): { sdb: SqliteDb; env: Env } {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  (sdb["exec"] as (s: string) => void)("CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT); CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
  for (const f of MIGRATIONS) (sdb["exec"] as (s: string) => void)(readFileSync(join(DIR, "../migrations", f), "utf8"));
  const env = {
    DB: d1(sdb), CACHE: {} as KVNamespace, MEDIA: {} as R2Bucket, APP_ENV: "test", ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787", ADMIN_BASE_PATH: "/admin", CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "x", OPENAI_IMAGE_MODEL: "x", SITE_PROVISIONING_DRY_RUN: "true", SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false", DEV_BYPASS_AUTH: "true",
  } as unknown as Env;
  return { sdb, env };
}
function seedOffer(sdb: SqliteDb, opts: { static?: boolean; template?: string | null } = {}): string {
  const id = mintPublicId("offer");
  const isStatic = opts.static ?? true;
  sdb
    .prepare(
      `INSERT INTO leadgen_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type,
         calls_provider_api, bid_source, request_execution_mode, banner_url_template, static_bid_value, static_bid_currency, cap_enabled, status)
       VALUES (?, 'Fora - Tier 3', 'Impact', 'leadgen', 'Business Loans', 's2s_postback', 'cpl', ?, 'static', 'server', ?, 200, 'USD', 0, 'active')`,
    )
    .run(id, isStatic ? 0 : 1, opts.template === undefined ? "https://forafinancial.pxf.io/c/7057150/2115574/24953" : opts.template);
  const row = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(id) as { id: number };
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, 'pl-1', 1)").run(mintPublicId("offer_placement"), row.id);
  return id;
}
const API = "/api/admin/leadgen";
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const CREATIVE = {
  static_brand_name: "Fora Financial",
  static_logo_url: "/media/2026/09/27/fora.png",
  static_headline: "Funding in as little as 24 hours",
  static_subheadline: "Check your options in minutes",
  static_disclaimer: "Not all applicants qualify.",
};

describe("the field rules", () => {
  it("accepts the creative a marketer writes; empty clears", () => {
    expect(validateStaticCreativeField("static_brand_name", "  Fora Financial ")).toEqual({ ok: true, value: "Fora Financial" });
    expect(validateStaticCreativeField("static_headline", "")).toEqual({ ok: true, value: null });
    expect(validateStaticCreativeField("static_subheadline", "Line one\r\nline two")).toEqual({ ok: true, value: "Line one\nline two" });
    expect(validateStaticCreativeField("static_logo_url", "/media/2026/09/27/a-b_c.png")).toEqual({ ok: true, value: "/media/2026/09/27/a-b_c.png" });
    expect(validateStaticCreativeField("static_logo_url", "https://cdn.example/logo.svg")).toEqual({ ok: true, value: "https://cdn.example/logo.svg" });
  });
  it("refuses what would break or abuse the card", () => {
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "/media/../admin", "https://x.example/a b.png", "logo.png"]) {
      expect(validateStaticCreativeField("static_logo_url", bad).ok, bad).toBe(false);
    }
    expect(validateStaticCreativeField("static_brand_name", "Two\nlines").ok).toBe(false);
    expect(validateStaticCreativeField("static_brand_name", "x".repeat(81)).ok).toBe(false);
    expect(validateStaticCreativeField("static_headline", 12 as unknown as string).ok).toBe(false);
  });
  it("a Media-library logo becomes absolute on the page's own origin; no origin ⇒ no logo", () => {
    expect(resolveCreativeLogo("/media/2026/09/27/a.png", "https://moneylantern.com")).toBe("https://moneylantern.com/media/2026/09/27/a.png");
    expect(resolveCreativeLogo("/media/2026/09/27/a.png", null)).toBeNull();
    expect(resolveCreativeLogo("https://cdn.example/a.png", null)).toBe("https://cdn.example/a.png");
    expect(resolveCreativeLogo("javascript:alert(1)", "https://moneylantern.com")).toBeNull();
  });
});

describeDb("Offer API", () => {
  it("saves, reads back and clears the five fields", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb);
    const save = await admin.request(`${API}/offers/${offer}`, json("PATCH", CREATIVE), h.env);
    expect(save.status).toBe(200);
    const got = (await (await admin.request(`${API}/offers/${offer}`, {}, h.env)).json()) as Record<string, unknown>;
    for (const [k, v] of Object.entries(CREATIVE)) expect(got[k], k).toBe(v);
    const clear = await admin.request(`${API}/offers/${offer}`, json("PATCH", { static_headline: "" }), h.env);
    expect(clear.status).toBe(200);
    expect(((await (await admin.request(`${API}/offers/${offer}`, {}, h.env)).json()) as Record<string, unknown>)["static_headline"]).toBeNull();
  });
  it("rejects a bad logo with a field error", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb);
    const res = await admin.request(`${API}/offers/${offer}`, json("PATCH", { static_logo_url: "javascript:alert(1)" }), h.env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields?: Record<string, string> }).fields?.["static_logo_url"]).toMatch(/Media library|https/);
  });
});

describeDb("live preview — the real card, unsaved values", () => {
  async function preview(h: { env: Env }, offer: string, body: Record<string, unknown>) {
    const res = await admin.request(`http://localhost:8787${API}/offers/${offer}/creative-preview`, json("POST", body), h.env);
    return { status: res.status, body: (await res.json()) as { document?: string; shown?: boolean; dropped_reason?: string | null; fields?: Record<string, string> } };
  }
  it("renders the typed creative with the funnel stylesheet, logo resolved on this origin", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb);
    const r = await preview(h, offer, CREATIVE);
    expect(r.status).toBe(200);
    expect(r.body.shown).toBe(true);
    const doc = r.body.document!;
    expect(doc).toContain('<div class="lg-banner-name">Fora Financial</div>');
    expect(doc).toContain('src="http://localhost:8787/media/2026/09/27/fora.png"');
    expect(doc).toContain("Funding in as little as 24 hours");
    expect(doc).toContain("Check your options in minutes");
    expect(doc).toContain("Not all applicants qualify.");
    expect(doc).toContain('data-funnel-design="default-funnel"'); // the funnel's own scope, so its card styles apply
    expect(doc).toContain('[data-funnel-design="default-funnel"] .lg-banner');
  });
  it("nothing saved: the stored offer is unchanged after previewing", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb);
    await preview(h, offer, CREATIVE);
    const row = h.sdb.prepare("SELECT static_brand_name FROM leadgen_offers WHERE public_id = ?").get(offer) as { static_brand_name: string | null };
    expect(row.static_brand_name).toBeNull();
  });
  it("empty creative: the card as visitors see it today — the Provider name", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb);
    const r = await preview(h, offer, {});
    expect(r.body.document).toContain('<div class="lg-banner-name">Impact</div>');
  });
  it("says plainly when the card would not be shown (no click destination)", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb, { template: null });
    const r = await preview(h, offer, CREATIVE);
    expect(r.body.shown).toBe(false);
    expect(r.body.dropped_reason).toBe("missing_click_url");
  });
  it("an invalid field is reported, not rendered", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb);
    const r = await preview(h, offer, { static_logo_url: "javascript:alert(1)" });
    expect(r.status).toBe(400);
    expect(r.body.fields?.["static_logo_url"]).toBeDefined();
  });
  it("copy is escaped — markup typed into a field cannot inject into the card", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb);
    const r = await preview(h, offer, { static_headline: '<img src=x onerror="alert(1)">' });
    expect(r.body.document).not.toContain('<img src=x onerror="alert(1)">');
    expect(r.body.document).toContain("&lt;img");
  });
});

describeDb("the Static tab", () => {
  async function editor(h: { env: Env }, offer: string): Promise<string> {
    const res = await admin.request(`/admin/leadgen/offers/${offer}/edit`, {}, h.env);
    expect(res.status).toBe(200);
    return res.text();
  }
  function card(html: string): string {
    const at = html.indexOf('<div class="card lg-static-creative"');
    expect(at, "the creative card is rendered").toBeGreaterThan(-1);
    return html.slice(at, html.indexOf('<div class="lg-offer-media-overlay"', at));
  }
  it("static offer: the Banner creative card with the five fields, current values, picker and preview", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb);
    await admin.request(`${API}/offers/${offer}`, json("PATCH", CREATIVE), h.env);
    const html = await editor(h, offer);
    const c = card(html);
    expect(c.slice(0, c.indexOf(">"))).not.toContain("hidden");
    for (const name of ["static_brand_name", "static_logo_url", "static_headline", "static_subheadline", "static_disclaimer"]) {
      expect(c, name).toContain(`name="${name}"`);
    }
    expect(c).toContain('value="Fora Financial"');
    expect(c).toContain('value="/media/2026/09/27/fora.png"');
    expect(c).toContain("Choose from Media library");
    expect(c).toContain('id="lg-creative-preview"');
    expect(c).toContain("Empty = the Provider name (&ldquo;Impact&rdquo;)");
    // it lives on the Static tab, after the destination fields
    const staticPanel = html.indexOf('data-lg-tab-panel="static"');
    expect(html.indexOf('<div class="card lg-static-creative"')).toBeGreaterThan(html.indexOf('name="banner_url_template"', staticPanel));
    expect(html).toContain('id="lg-offer-media-picker"');
  });
  it("FOUND IN THE BROWSER DRIVE: every inline script on the editor page compiles (a stray <script> tag once broke the whole editor, tabs included)", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb);
    const html = await editor(h, offer);
    const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? "");
    expect(scripts.length).toBeGreaterThan(0);
    for (const [i, code] of scripts.entries()) {
      expect(() => new Function(code), `inline script #${i}`).not.toThrow();
    }
    expect(scripts.join("\n")).toContain("lg-creative-preview"); // the creative island is among them
  });

  it("the preview copy of the card drops the logo's hide-on-error handler (a broken logo must stay visible while editing)", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb);
    const res = await admin.request(`http://localhost:8787${API}/offers/${offer}/creative-preview`, json("POST", CREATIVE), h.env);
    const doc = ((await res.json()) as { document: string }).document;
    expect(doc).toContain('class="lg-banner-logo"');
    expect(doc).not.toContain("onerror");
  });

  it("a provider-request offer: the card is rendered hidden (its copy comes from the response parser)", async () => {
    const h = harness();
    const offer = seedOffer(h.sdb, { static: false });
    const c = card(await editor(h, offer));
    expect(c.slice(0, c.indexOf(">"))).toContain("hidden");
  });
});
