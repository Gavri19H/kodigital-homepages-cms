// LeadGen Phase 9 Stage B — the contract 03 §9.5 Auction UI over the REAL admin
// shell router + REAL migrations (node:sqlite harness). Covers: the list
// columns + enabled Create link + empty-state; the full-page editor's six
// sub-tabs (Settings w/ the §18.3 floor-label switch + §18.1 mixed_payout_warn,
// Participating Offers picker, Rules IF/THEN builder, Banner manual/automatic
// modes, the Simulator P10 placeholder, Analytics); hostile author content is
// escaped; every inline <script> is strict ES5 + parses (node --check);
// /auction/new create form; in-shell 404.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

// --- node:sqlite harness (repo pattern) --------------------------------------

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
  const db = {
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
        for (const statement of statements) results.push(await statement.run());
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

function createLeadgenDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');",
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
  } as Env;
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

async function getHtml(env: Env, path: string): Promise<string> {
  const res = await admin.request(path, {}, env);
  return res.text();
}

// --- seeding ------------------------------------------------------------------

async function createQuote(env: Env): Promise<{ id: number; public_id: string }> {
  const res = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Life Quote", activity: "quote_funnel", verticals: ["life"] }), env);
  const j = (await res.json()) as { id: number; public_id: string };
  return { id: j.id, public_id: j.public_id };
}

async function createAuction(env: Env, body: Record<string, unknown>): Promise<{ id: number; public_id: string; auction_name: string }> {
  const res = await admin.request(`${API}/auctions`, jsonInit("POST", body), env);
  const j = (await res.json()) as { id: number; public_id: string; auction_name: string };
  return j;
}

function seedOfferWithPlacement(sdb: SqliteDb, offerType: string): { offer_id: number; placement_id: number } {
  const offerPublic = mintPublicId("offer");
  sdb
    .prepare("INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type, status) VALUES (?, ?, 'quote_funnel', 'life', 's2s_postback', ?, 'active')")
    .run(offerPublic, `Offer ${offerType}`, offerType);
  const offer = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublic) as { id: number };
  const placementPublic = mintPublicId("offer_placement");
  sdb.prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)").run(placementPublic, offer.id, `plc-${offerPublic.slice(-4)}`);
  const placement = sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number };
  return { offer_id: offer.id, placement_id: placement.id };
}

async function putParticipating(env: Env, auctionPublicId: string, placementIds: number[]): Promise<void> {
  await admin.request(`${API}/auctions/${auctionPublicId}/offers`, jsonInit("PUT", { offers: placementIds.map((p) => ({ offer_placement_id: p })) }), env);
}

// --- List page ---------------------------------------------------------------

describeDb("leadgen auction list page (§9.5)", () => {
  it("renders the §9.5 columns + an ENABLED Create link (no scaffold phase note)", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/auction");
    expect(html).toContain("data-create-auction");
    expect(html).not.toContain("ships in a later phase");
    for (const col of ["Winner logic", "Multi-offer / Backfill", "Fill rate", "Avg bid", "Avg RPC", "Revenue"]) {
      expect(html, `missing column ${col}`).toContain(col);
    }
    // §18.9 analytics hydrate after paint — the table-level hydration marker is
    // always present; the per-row data-metric cells are asserted on a populated
    // list below.
    expect(html).toContain("data-lg-analytics");
  });

  it("renders an empty-state when there are no auctions", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/auction");
    expect(html).toContain("empty-state");
    expect(html).toContain("No auctions yet");
  });

  it("lists a created auction with its quote attribution + participating count", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    await createAuction(env, { auction_name: "Auction One", quote_id: quote.id, auction_type: "dynamic" });
    const html = await getHtml(env, "/admin/leadgen/auction");
    expect(html).toContain("Auction One");
    expect(html).toContain("Life Quote");
    // per-row §18.9 analytics cells (hydrated after paint).
    expect(html).toContain('data-metric="fill_rate"');
  });

  it("escapes hostile auction names in the list", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    await createAuction(env, { auction_name: '<script>alert(1)</script>', quote_id: quote.id });
    const html = await getHtml(env, "/admin/leadgen/auction");
    expect(html).toContain("&lt;script&gt;alert(1)");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});

// --- New page ----------------------------------------------------------------

describeDb("leadgen new-auction page", () => {
  it("renders the create form (name + quote picker + type) + submit script", async () => {
    const { env } = newHarness();
    await createQuote(env);
    const html = await getHtml(env, "/admin/leadgen/auction/new");
    expect(html).toContain('id="lg-auction-new-form"');
    expect(html).toContain('id="lg-a-quote"'); // quote attribution picker
    expect(html).toContain("Life Quote"); // the quote option
    expect(html).toContain('id="lg-a-type"'); // static/dynamic
  });
});

// --- Editor page -------------------------------------------------------------

async function seedEditorAuction(
  opts: { floorType?: string; mixed?: boolean } = {},
): Promise<{ env: Env; sdb: SqliteDb; publicId: string; html: string }> {
  const { env, sdb } = newHarness();
  const quote = await createQuote(env);
  const auction = await createAuction(env, { auction_name: "Editor Auction", quote_id: quote.id, auction_type: "static" });
  if (opts.floorType) {
    await admin.request(`${API}/auctions/${auction.public_id}`, jsonInit("PATCH", { floor_type: opts.floorType }), env);
  }
  if (opts.mixed) {
    const cpc = seedOfferWithPlacement(sdb, "cpc");
    const cpl = seedOfferWithPlacement(sdb, "cpl");
    await putParticipating(env, auction.public_id, [cpc.placement_id, cpl.placement_id]);
  }
  const html = await getHtml(env, `/admin/leadgen/auction/${auction.public_id}/edit`);
  return { env, sdb, publicId: auction.public_id, html };
}

describeDb("leadgen auction editor page (§9.5)", () => {
  it("renders all six editor sub-tabs + the Save control", async () => {
    const { html } = await seedEditorAuction();
    for (const tab of ["settings", "participating", "rules", "banner", "simulator", "analytics"]) {
      expect(html, `missing tab ${tab}`).toContain(`data-tab="${tab}"`);
    }
    expect(html).toContain('id="lg-a-save"');
  });

  it("Settings: floor label = '% of top bid' + %-suffix for percentage_of_max", async () => {
    const { html } = await seedEditorAuction({ floorType: "percentage_of_max" });
    expect(html).toContain("Floor (% of top bid)");
    expect(html).toContain("Floor (minimum bid)"); // both labels present (JS switches)
    // the % suffix is shown, the currency prefix is hidden
    expect(html).toContain("data-floor-suffix>%");
    expect(html).toContain("data-floor-prefix hidden>");
  });

  it("Settings: floor label = 'minimum bid' + currency prefix for absolute_bid", async () => {
    const { html } = await seedEditorAuction({ floorType: "absolute_bid" });
    // the currency prefix is shown, the % suffix is hidden
    expect(html).toContain("data-floor-prefix>$");
    expect(html).toContain("data-floor-suffix hidden>");
    expect(html).toContain("data-floor-label-abs>"); // abs label active (not hidden)
    expect(html).toContain("data-floor-label-pct hidden>"); // pct label hidden
  });

  it("Settings: shows the mixed_payout_warn banner for a mixed participating set", async () => {
    const { html } = await seedEditorAuction({ mixed: true });
    expect(html).toContain("data-mixed-payout-warn");
    expect(html).toContain("absolute_bid"); // the recommendation
  });

  it("Settings: NO mixed_payout_warn banner for a single-payout-type set", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env);
    const auction = await createAuction(env, { auction_name: "A", quote_id: quote.id, auction_type: "static" });
    const cpc1 = seedOfferWithPlacement(sdb, "cpc");
    const cpc2 = seedOfferWithPlacement(sdb, "cpc");
    await putParticipating(env, auction.public_id, [cpc1.placement_id, cpc2.placement_id]);
    const html = await getHtml(env, `/admin/leadgen/auction/${auction.public_id}/edit`);
    expect(html).not.toContain("data-mixed-payout-warn");
  });

  it("Participating Offers: picker (search + vertical filter) is present", async () => {
    const { html } = await seedEditorAuction();
    expect(html).toContain("data-offer-picker");
    expect(html).toContain('id="lg-a-offer-search"');
    expect(html).toContain('id="lg-a-offer-search-btn"');
  });

  it("Rules: offer/carrier IF/THEN builder is present (rule_level + action + conditions)", async () => {
    const { html } = await seedEditorAuction();
    expect(html).toContain('id="lg-r-level"'); // rule level
    expect(html).toContain('id="lg-r-action"'); // THEN action
    expect(html).toContain('id="lg-r-conditions"'); // IF §21.4 groups
    expect(html).toContain("data-rule-carrier-field"); // carrier_match for carrier rules
  });

  it("Banner: manual + automatic modes with the canonical Carrier field map", async () => {
    const { html } = await seedEditorAuction();
    expect(html).toContain('data-banner-panel="manual"');
    expect(html).toContain('data-banner-panel="automatic"');
    // the automatic map exposes canonical Carrier fields only
    expect(html).toContain('data-fieldmap-key="carrier_name"');
    expect(html).toContain('data-fieldmap-key="click_url"');
  });

  // §7.6 (S1): the P10 placeholder is replaced by the real dry-run readout.
  it("Simulator: renders the §7.6 dry-run trace panel (enabled Run + results region)", async () => {
    const { html } = await seedEditorAuction();
    // F9: the dry-run note is factually exact — no writes, but the STAGING
    // carrier resolve DOES fire (DEV-40 MAJOR-5), so the old "no provider
    // call ... nothing is written" claim is gone.
    expect(html).toContain("data-simulator-dryrun");
    expect(html).toContain("No writes; staging-only carrier resolve.");
    expect(html).not.toContain("No provider call is made");
    expect(html).not.toContain("data-simulator-p10");
    expect(html).not.toContain("Ships in P10");
    // Run button is ENABLED now (not the disabled P10 stub)
    const runIdx = html.indexOf('id="lg-a-simulate"');
    expect(runIdx).toBeGreaterThan(-1);
    const runOpen = html.lastIndexOf("<", runIdx);
    const runTag = html.slice(runOpen, html.indexOf(">", runIdx) + 1);
    expect(runTag).not.toContain("disabled");
    // sample-answers / context inputs + results region
    expect(html).toContain("data-sim-answers");
    expect(html).toContain("data-sim-context");
    expect(html).toContain("data-simulate-results");
  });

  it("Simulator: the island renders the §7.6 per-offer trace fields + reuses the eligibility labels", async () => {
    const { html } = await seedEditorAuction();
    // POSTs the dry-run to the simulate endpoint
    expect(html).toContain("apiBase + '/simulate'");
    expect(html).toContain("sample_answers");
    // S1 seam: the per-offer explainability rides `offers_payload_explain`
    // (NOT offers_considered, which is only {offer_id, placement_id}). The
    // island MUST read that array or the whole §7.6 panel renders empty.
    expect(html, "reads the offers_payload_explain array").toContain("offers_payload_explain");
    // every §7.6 per-offer additive field is read + rendered
    for (const field of [
      "payload_preview",
      "parser_id",
      "carrier_parse_version",
      "expected_response_fields",
      "excluded_reason",
    ]) {
      expect(html, `simulate trace reads ${field}`).toContain(field);
    }
    // eligibility verdict + reasons reuse the shared label map (eligibilityLabel)
    expect(html).toContain("offer.eligibility");
    expect(html).toContain("eligibilityLabel(reasons[ri])");
    // redacted payload preview rendered into a masked <pre> (createTextNode)
    expect(html).toContain("data-sim-payload");
    // dry-run readout note — F9 exact wording (the false "no provider calls,
    // nothing written" claim is gone; staging carrier resolve DOES fire)
    expect(html).toContain("data-sim-dryrun-note");
    expect(html).toContain("no writes; staging-only carrier resolve.");
    expect(html).not.toContain("no provider calls, nothing written");
    // verdict hooks for both states
    expect(html).toContain('data-sim-verdict');
  });

  it("Analytics: renders the §18.9 read-only table scaffold", async () => {
    const { html } = await seedEditorAuction();
    expect(html).toContain('id="lg-a-analytics-table"');
    expect(html).toContain("Carrier CTR");
  });

  it("escapes hostile auction names in the editor head", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const auction = await createAuction(env, { auction_name: '<img src=x onerror=alert(1)>', quote_id: quote.id });
    const html = await getHtml(env, `/admin/leadgen/auction/${auction.public_id}/edit`);
    expect(html).toContain("&lt;img src=x");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("404s in-shell for an unknown auction", async () => {
    const { env } = newHarness();
    const res = await admin.request(`/admin/leadgen/auction/${mintPublicId("auction")}/edit`, {}, env);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("Auction not found");
  });
});

// ---------------------------------------------------------------------------
// ES5-only inline scripts (token scan + node --check)
// ---------------------------------------------------------------------------

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function extractScripts(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    if ((match[0] ?? "").includes('type="application/json"')) continue; // data blob, not a script
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

const scratchDir = mkdtempSync(join(tmpdir(), "leadgen-auctions-parse-"));
let fileSeq = 0;

function parseError(label: string, source: string): string | null {
  const file = join(scratchDir, `${++fileSeq}-${label.replace(/[^\w-]/g, "_")}.js`);
  writeFileSync(file, source, "utf-8");
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    return null;
  } catch (err) {
    const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? String(err);
    return `${label}: ${stderr.split("\n").slice(0, 5).join("\n")}`;
  }
}

describeDb("leadgen auction pages — ES5-only inline scripts", () => {
  async function renderedPages(): Promise<Array<[string, string]>> {
    const { env, html } = await seedEditorAuction();
    return [
      ["auction-list", await getHtml(env, "/admin/leadgen/auction")],
      ["auction-new", await getHtml(env, "/admin/leadgen/auction/new")],
      ["auction-editor", html],
    ];
  }

  it("every inline <script> is ES5 (no arrow/const/let/async/await/backtick)", async () => {
    for (const [label, html] of await renderedPages()) {
      const scripts = extractScripts(html);
      expect(scripts.length, `${label} must ship an inline script`).toBeGreaterThan(0);
      for (const script of scripts) {
        expect(script, `${label} arrow`).not.toMatch(/=>/);
        expect(script, `${label} const`).not.toMatch(/\bconst\b/);
        expect(script, `${label} let`).not.toMatch(/\blet\b/);
        expect(script, `${label} async`).not.toMatch(/\basync\b/);
        expect(script, `${label} await`).not.toMatch(/\bawait\b/);
        expect(script, `${label} backtick`).not.toContain("`");
      }
    }
  });

  it("every emitted inline <script> parses as standalone JavaScript (node --check)", async () => {
    for (const [label, html] of await renderedPages()) {
      const errors: string[] = [];
      extractScripts(html).forEach((script, i) => {
        const err = parseError(`${label}-script${i + 1}`, script);
        if (err) errors.push(err);
      });
      expect(errors, errors.join("\n\n")).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// 05 §5.1 site 2 (fix-contract v2.4, R4) — participating-offer eligibility
// warnings: the PUT response's warnings[] surface as per-offer chips + the
// quote-activation notice; rows carry the offer public id for matching.
// ---------------------------------------------------------------------------

// A DYNAMIC offer (calls_provider_api=1) with no schema/test/endpoint →
// ineligible → the auctions PUT emits {offer_id, eligible:false, reasons[]}.
function seedDynamicOfferWithPlacement(sdb: SqliteDb): { offer_public_id: string; placement_id: number } {
  const offerPublic = mintPublicId("offer");
  sdb
    .prepare(
      "INSERT INTO leadgen_offers (public_id, offer_name, activity, vertical, conversion_tracking_method, offer_type, calls_provider_api, bid_source, status) VALUES (?, 'Unready Dynamic', 'quote_funnel', 'life', 's2s_postback', 'cpc', 1, 'response', 'active')",
    )
    .run(offerPublic);
  const offer = sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = ?").get(offerPublic) as { id: number };
  const placementPublic = mintPublicId("offer_placement");
  sdb
    .prepare("INSERT INTO leadgen_offer_placements (public_id, offer_id, placement_id, is_default) VALUES (?, ?, ?, 1)")
    .run(placementPublic, offer.id, `plc-${offerPublic.slice(-4)}`);
  const placement = sdb.prepare("SELECT id FROM leadgen_offer_placements WHERE public_id = ?").get(placementPublic) as { id: number };
  return { offer_public_id: offerPublic, placement_id: placement.id };
}

describeDb("Participating-offer eligibility warnings (05 §5.1)", () => {
  it("the PUT returns warnings[] for an ineligible dynamic offer and the row SSRs its public id for chip matching", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env);
    const auction = await createAuction(env, { auction_name: "Warn Auction", quote_id: quote.id, auction_type: "dynamic" });
    const dyn = seedDynamicOfferWithPlacement(sdb);

    const put = await admin.request(
      `${API}/auctions/${auction.public_id}/offers`,
      jsonInit("PUT", { offers: [{ offer_placement_id: dyn.placement_id }] }),
      env,
    );
    expect(put.status, `put offers: ${await put.clone().text()}`).toBe(200);
    const body = (await put.json()) as {
      items: Array<{ offer_public_id: string | null }>;
      warnings: Array<{ offer_id: string; eligible: false; reasons: string[] }>;
    };
    // the save LANDS with warnings (draft auctions may reference unready offers)
    expect(body.items.length).toBe(1);
    expect(body.warnings.length).toBe(1);
    expect(body.warnings[0]!.offer_id).toBe(dyn.offer_public_id);
    expect(body.warnings[0]!.reasons).toContain("no_active_schema");

    // the editor SSRs the row with data-offer-public-id (the chip anchor)
    const html = await getHtml(env, `/admin/leadgen/auction/${auction.public_id}/edit`);
    expect(html).toContain(`data-offer-public-id="${dyn.offer_public_id}"`);
  });

  it("the editor ships the warning-chip wiring: operator labels for all 8 codes + the quote-activation notice", async () => {
    const { env } = newHarness();
    const quote = await createQuote(env);
    const auction = await createAuction(env, { auction_name: "Chips", quote_id: quote.id, auction_type: "dynamic" });
    const html = await getHtml(env, `/admin/leadgen/auction/${auction.public_id}/edit`);

    // per-offer inline chips: rebuilt from the PUT response's warnings[]
    expect(html).toContain("renderEligibilityWarnings(res.body && res.body.warnings");
    expect(html).toContain("data-offer-warning");
    expect(html).toContain("'Ineligible: '");
    // the notice: ineligible offers block QUOTE activation, not the save
    expect(html).toContain("they block QUOTE activation, not this save");
    expect(html).toContain("data-eligibility-note");
    expect(html).toContain("block activating any Quote this auction serves");
    // the embedded §5.1 label map carries ALL 8 operator labels
    for (const pair of [
      '"no_active_schema":"No active payload schema"',
      '"schema_validation_errors":"Active payload schema has validation errors"',
      '"test_untested":"Provider test has not been run yet"',
      '"test_failed":"Last provider test failed"',
      '"endpoint_missing":"No endpoint configured for the live (production) environment"',
      '"invalid_headers":"A request header cannot resolve (empty name or missing macro/secret reference)"',
      '"carrier_parse_missing":"Response parsing (carrier parse) is not configured"',
      '"carrier_parse_invalid":"Response parsing (carrier parse) configuration is invalid"',
    ]) {
      expect(html, `embedded label ${pair}`).toContain(pair);
    }
  });
});
