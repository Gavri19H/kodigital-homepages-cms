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
  "0057_leadgen_offer_test_verdict.sql",
  "0062_leadgen_auction_waterfalls.sql", // traffic share + offer waterfalls
  "0063_leadgen_auction_tier_rules.sql", // Tier-level rules (rule_level tier)
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


// --- 0062 Rules: offer waterfalls + traffic share (OWNER 2026-10-01) ---------

describeDb("leadgen auction editor — Rules: waterfalls + share of traffic (0062)", () => {
  async function editorWithWaterfall(): Promise<{ html: string; names: string[] }> {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env);
    const auction = await createAuction(env, { auction_name: "Business loans", quote_id: quote.id, auction_type: "dynamic" });
    const named = (name: string) => {
      const o = seedOfferWithPlacement(sdb, "cpl");
      sdb.prepare("UPDATE leadgen_offers SET offer_name = ? WHERE id = ?").run(name, o.offer_id);
      return o;
    };
    const fundera = named("Fundera - Tier 1");
    const amone = named("AmONE - Tier 2");
    const fora = named("Fora - Tier 3");
    const honest = named("Honest <Loans> - OW");
    await putParticipating(env, auction.public_id, [fundera, amone, fora, honest].map((o) => o.placement_id));
    const wf = await admin.request(
      `${API}/auctions/${auction.public_id}/rules`,
      jsonInit("POST", { action: "waterfall", traffic_share_pct: 50, tiers: [[fundera.offer_id], [amone.offer_id], [fora.offer_id, honest.offer_id]] }),
      env,
    );
    expect(wf.status, await wf.clone().text()).toBe(201);
    const ex = await admin.request(
      `${API}/auctions/${auction.public_id}/rules`,
      jsonInit("POST", { rule_level: "offer", action: "exclude", target_offer_id: amone.offer_id, traffic_share_pct: 30, conditions_json: { groups: [] } }),
      env,
    );
    expect(ex.status).toBe(201);
    return { html: await getHtml(env, `/admin/leadgen/auction/${auction.public_id}/edit`), names: [] };
  }

  it("the list shows the waterfall by offer NAME, tier by tier, and how much traffic it takes", async () => {
    const { html } = await editorWithWaterfall();
    expect(html).toContain("<h4>Waterfalls</h4>");
    expect(html).toContain("Waterfalls cover <strong>50%</strong> of traffic; the other 50% get the normal auction");
    expect(html).toContain('data-rule-action="waterfall"');
    expect(html).toMatch(/<li data-waterfall-tier="1">Tier 1: Fundera - Tier 1<\/li>/);
    expect(html).toMatch(/<li data-waterfall-tier="2">Tier 2: AmONE - Tier 2<\/li>/);
    expect(html).toContain('<li data-waterfall-tier="3">Tier 3: Fora - Tier 3 + Honest &lt;Loans&gt; - OW <span class="form-help">(shown together)</span></li>');
    expect(html).not.toContain("Honest <Loans>"); // escaped everywhere
    // a share-limited exclude rule says so
    expect(html).toContain('<span data-rule-share>30% of traffic</span>');
  });

  it("the builder offers the waterfall action, a share field and a tier template listing the participating offers", async () => {
    const { html } = await editorWithWaterfall();
    expect(html).toContain('<option value="waterfall">Waterfall — offer tiers</option>');
    expect(html).toContain('id="lg-r-share"');
    expect(html).toContain("data-rule-waterfall-field hidden");
    const template = html.split('<template id="lg-r-tier-template">')[1]?.split("</template>")[0] ?? "";
    for (const name of ["Fundera - Tier 1", "AmONE - Tier 2", "Fora - Tier 3", "Honest &lt;Loans&gt; - OW"]) expect(template).toContain(name);
    expect(template.match(/data-tier-offer value="\d+"/g)).toHaveLength(4);
  });

  it("review fix: every rule has a Disable/Enable switch; a disabled participant is skipped in the list and absent from the picker", async () => {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env);
    const auction = await createAuction(env, { auction_name: "Loans", quote_id: quote.id, auction_type: "dynamic" });
    const a = seedOfferWithPlacement(sdb, "cpl");
    const b = seedOfferWithPlacement(sdb, "cpl");
    sdb.prepare("UPDATE leadgen_offers SET offer_name = 'Kept Offer' WHERE id = ?").run(a.offer_id);
    sdb.prepare("UPDATE leadgen_offers SET offer_name = 'Paused Offer' WHERE id = ?").run(b.offer_id);
    await putParticipating(env, auction.public_id, [a.placement_id, b.placement_id]);
    const wf = await admin.request(`${API}/auctions/${auction.public_id}/rules`, jsonInit("POST", { action: "waterfall", traffic_share_pct: 30, tiers: [[a.offer_id], [b.offer_id]] }), env);
    expect(wf.status).toBe(201);
    sdb.prepare("UPDATE leadgen_auction_offers SET enabled = 0 WHERE offer_id = ?").run(b.offer_id);
    const html = await getHtml(env, `/admin/leadgen/auction/${auction.public_id}/edit`);
    expect(html).toMatch(/data-toggle-rule="lgar_[^"]+" data-rule-enabled="1">Disable<\/button>/);
    expect(html).toContain('id="lg-a-rules-msg"');
    expect(html).toContain('Tier 2: Paused Offer <span class="form-help">(not running in this auction — skipped)</span>');
    const template = html.split('<template id="lg-r-tier-template">')[1]?.split("</template>")[0] ?? "";
    expect(template).toContain("Kept Offer");
    expect(template).not.toContain("Paused Offer");
  });

  it("the Simulator can run a chosen waterfall path, the normal auction, or pick by visitor share", async () => {
    const { html } = await editorWithWaterfall();
    expect(html).toContain('<option value="auto">By visitor share (like a new visitor)</option>');
    expect(html).toContain("50% of traffic: Fundera - Tier 1 → AmONE - Tier 2 → Fora - Tier 3 + Honest &lt;Loans&gt; - OW");
    expect(html).toContain('<option value="none">Normal auction (no waterfall)</option>');
  });
});

// --- OWNER 2026-10-01 (PM feedback): rule fields, offer picker, tier rules ---

describeDb("rules condition fields — only this funnel's questions, no ids, answers attached (rule-fields.ts)", () => {
  // A section with questions: a labelled enum choice, a labelled number choice
  // (answer_type number), a yes/no, and a question with NO label of its own.
  function seedSection(sdb: SqliteDb, name: string, vertical: string, components: unknown[]): number {
    const pub = mintPublicId("section");
    sdb
      .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, 'quote_funnel', ?, 'H', ?, 'button', 'active')")
      .run(pub, name, vertical, JSON.stringify({ components }));
    return (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(pub) as { id: number }).id;
  }
  async function seedFunnel(): Promise<{ env: Env; sdb: SqliteDb; variantPub: string; auctionPub: string }> {
    const { env, sdb } = newHarness();
    const res = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "SMB Loans", activity: "quote_funnel", verticals: ["life"] }), env);
    const quote = (await res.json()) as { id: number; public_id: string; funnels: Array<{ variants: Array<{ id: number; public_id: string }> }> };
    const variant = quote.funnels[0]!.variants[0]!;
    const industry = seedSection(sdb, "Industry", "life", [
      { type: "DropdownQuestion", question_id: "q_ind", internal_field: "field_mrulh4c7_6g4v", answer_type: "enum", props: { label: "Which industry is your business in?" },
        choices: [{ label: "Retail", value: "retail" }, { label: "Consumer goods & services", value: "consumer_goods_services" }] },
      { type: "ButtonAnswerGroup", question_id: "q_fund", internal_field: "field_fund", answer_type: "number", props: { label: "How much funding do you need?" },
        choices: [{ label: "$75,000", value: "75000" }, { label: "$150,000", value: "150000" }] },
    ]);
    const bank = seedSection(sdb, "Business bank account", "life", [
      { type: "TwoButtonYesNo", question_id: "q_bank", internal_field: "field_mruk20kn_l4q4", answer_type: "boolean",
        choices: [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }] },
    ]);
    // another vertical's section — NOT in this funnel
    seedSection(sdb, "Install Immediacy", "home_security", [
      { type: "DropdownQuestion", question_id: "q_inst", internal_field: "field_mupksp32_goe4", answer_type: "enum", props: { label: "When do you need it installed?" }, choices: [{ label: "Now", value: "now" }] },
    ]);
    sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, 0), (?, ?, 1)").run(variant.id, industry, variant.id, bank);
    const auction = await createAuction(env, { auction_name: "Loans", quote_id: quote.id, auction_type: "dynamic" });
    sdb.prepare("UPDATE leadgen_funnel_variants SET auction_id = ? WHERE id = ?").run(auction.id, variant.id);
    return { env, sdb, variantPub: variant.public_id, auctionPub: auction.public_id };
  }
  type Field = { internal_field: string; label: string; group: string; stored_choices?: Array<{ label: string; stored: unknown }> };

  it("a variant's fields: its own questions (no other vertical), labelled in words, with typed answers; then the visitor facts", async () => {
    const { env, variantPub } = await seedFunnel();
    const res = await admin.request(`${API}/variants/${variantPub}/rule-fields`, {}, env);
    expect(res.status).toBe(200);
    const { fields } = (await res.json()) as { fields: Field[] };
    const questions = fields.filter((f) => f.group === "question");
    expect(questions.map((f) => [f.internal_field, f.label])).toEqual([
      ["field_mrulh4c7_6g4v", "Which industry is your business in?"],
      ["field_fund", "How much funding do you need?"],
      ["field_mruk20kn_l4q4", "Business bank account"], // no label of its own → its section's name
    ]);
    expect(fields.some((f) => f.internal_field === "field_mupksp32_goe4")).toBe(false); // other vertical left out
    expect(fields.every((f) => !/field_|·/.test(f.label))).toBe(true); // no ids in any label
    const fund = questions.find((f) => f.internal_field === "field_fund");
    expect(fund?.stored_choices).toEqual([{ label: "$75,000", stored: 75000 }, { label: "$150,000", stored: 150000 }]); // numbers stay numbers
    const bank = questions.find((f) => f.internal_field === "field_mruk20kn_l4q4");
    expect(bank?.stored_choices).toEqual([{ label: "Yes", stored: true }, { label: "No", stored: false }]);
    expect(fields.filter((f) => f.group === "visitor").map((f) => f.internal_field)).toEqual([
      "state", "device", "os", "utm_source", "utm_medium", "utm_campaign", "utm_content", "placement", "date_et", "time_et", "weekday_et",
    ]);
  });

  it("an auction's fields are its funnels' questions; the editor embeds them for the IF builder", async () => {
    const { env, auctionPub } = await seedFunnel();
    const { fields } = (await (await admin.request(`${API}/auctions/${auctionPub}/rule-fields`, {}, env)).json()) as { fields: Field[] };
    expect(fields.filter((f) => f.group === "question").map((f) => f.internal_field)).toEqual(["field_mrulh4c7_6g4v", "field_fund", "field_mruk20kn_l4q4"]);
    const html = await getHtml(env, `/admin/leadgen/auction/${auctionPub}/edit`);
    const blob = html.split('<script type="application/json" id="lg-r-cond-fields">')[1]?.split("</script>")[0] ?? "";
    expect((JSON.parse(blob) as Field[]).map((f) => f.label)).toContain("Which industry is your business in?");
    expect(html).toContain('id="lg-r-cond-mount"');
    expect(html).not.toContain("IF — conditions JSON (groups[])");
  });

  it("two questions with the same words get their section's name; the funnel pop-up no longer lists every section", async () => {
    const { questionRuleFields } = await import("../src/admin/leadgen/rule-fields");
    const q = (field: string, label?: string) => ({ type: "FreeTextQuestion", question_id: `q_${field}`, internal_field: field, answer_type: "string", ...(label ? { props: { label } } : {}) });
    const fields = questionRuleFields([
      { id: 1, section_name: "Owner", content_json: JSON.stringify({ components: [q("f1", "Your name"), q("f2")] }) },
      { id: 2, section_name: "Co-owner", content_json: JSON.stringify({ components: [q("f3", "Your name"), q("f4")] }) },
    ]);
    expect(fields.map((f) => f.label)).toEqual(["Your name (Owner)", "Owner", "Your name (Co-owner)", "Co-owner"]);
    const { RELOCATED_RULES_SCRIPT } = await import("../src/admin/leadgen/ui-rules-builder");
    expect(RELOCATED_RULES_SCRIPT).toContain("/rule-fields");
    expect(RELOCATED_RULES_SCRIPT).not.toContain("/sections?activity=");
  });

  // PM follow-up 2026-10-02: Date and Time of day are pickers (minutes too).
  it("Date and Time of day are calendar / clock pickers; the hour-only field is gone", async () => {
    const { env, variantPub } = await seedFunnel();
    const { fields } = (await (await admin.request(`${API}/variants/${variantPub}/rule-fields`, {}, env)).json()) as { fields: Array<Field & { input?: string; hint?: string }> };
    expect(fields.find((f) => f.internal_field === "date_et")).toMatchObject({ label: "Date (US Eastern)", input: "date" });
    expect(fields.find((f) => f.internal_field === "time_et")).toMatchObject({ label: "Time of day (US Eastern)", input: "time" });
    expect(fields.some((f) => f.internal_field === "hour_et")).toBe(false);
    expect(fields.find((f) => f.internal_field === "date_et")?.hint).toBeUndefined(); // no "type a number like 20261031"
  });

  // PM follow-up 2026-10-02: a Yes / No question's answers are its own words.
  it("a Yes / No question offers its authored answers (\"I own\" / \"I rent\") and reads a rule back with them", async () => {
    const { questionRuleFields } = await import("../src/admin/leadgen/rule-fields");
    const fields = questionRuleFields([
      { id: 1, section_name: "Home", content_json: JSON.stringify({ components: [
        { type: "TwoButtonYesNo", question_id: "q_own", internal_field: "homeowner", answer_type: "boolean", props: { label: "Do you own or rent?", yesLabel: "I own", noLabel: "I rent" } },
        { type: "TwoButtonYesNo", question_id: "q_ins", internal_field: "insured", answer_type: "boolean", props: { label: "Are you insured?" } },
      ] }) },
    ]);
    expect(fields[0]).toMatchObject({
      label: "Do you own or rent?",
      stored_choices: [{ label: "I own", stored: true }, { label: "I rent", stored: false }],
      choices: [{ value: "true", label: "I own" }, { value: "false", label: "I rent" }],
    });
    expect(fields[1]?.stored_choices).toEqual([{ label: "Yes", stored: true }, { label: "No", stored: false }]);
  });

  // PM follow-up 2026-10-02: a question with no label of its own is named by
  // the headline it is asked under; two such questions by their type.
  it("a label-less question takes its headline's words; twins under one headline are told apart by type, then number", async () => {
    const { questionRuleFields } = await import("../src/admin/leadgen/rule-fields");
    const fields = questionRuleFields([
      { id: 1, section_name: "Carrier Buttons", content_json: JSON.stringify({ components: [
        { type: "QuestionHeadline", question_id: "h1", props: { text: "Which carrier do you want a quote from?" } },
        { type: "ButtonAnswerGroup", question_id: "q_a", internal_field: "carrier_a", answer_type: "enum", choices: [{ label: "Acme", value: "acme" }] },
        { type: "TwoButtonYesNo", question_id: "q_b", internal_field: "carrier_b", answer_type: "boolean" },
        { type: "QuestionHeadline", question_id: "h2", props: { text: "Pick two more" } },
        { type: "ButtonAnswerGroup", question_id: "q_c", internal_field: "carrier_c", answer_type: "enum", choices: [{ label: "Beta", value: "beta" }] },
        { type: "ButtonAnswerGroup", question_id: "q_d", internal_field: "carrier_d", answer_type: "enum", choices: [{ label: "Gamma", value: "gamma" }] },
      ] }) },
    ]);
    const { LEADGEN_COMPONENT_OPERATOR_NAMES } = await import("../src/public/leadgen/components/content-schema");
    expect(fields.map((f) => f.label)).toEqual([
      `Which carrier do you want a quote from? (${LEADGEN_COMPONENT_OPERATOR_NAMES.ButtonAnswerGroup})`,
      `Which carrier do you want a quote from? (${LEADGEN_COMPONENT_OPERATOR_NAMES.TwoButtonYesNo})`,
      "Pick two more",
      "Pick two more (2)",
    ]);
    // confirmation review m6: a headline inside a container names only what
    // follows it there — it never leaks to a question after the container
    const scoped = questionRuleFields([
      { id: 2, section_name: "Page B", content_json: JSON.stringify({ components: [
        { type: "QuestionGrid", question_id: "g", props: {}, children: [
          { type: "QuestionHeadline", question_id: "h3", props: { text: "Grid question" } },
          { type: "ButtonAnswerGroup", question_id: "q4", internal_field: "grid_a", answer_type: "enum", choices: [{ label: "A", value: "a" }] },
        ] },
        { type: "TwoButtonYesNo", question_id: "q5", internal_field: "after_grid", answer_type: "boolean" },
        { type: "QuestionHeadline", question_id: "h4", props: { text: "Your home" } },
        { type: "QuestionGrid", question_id: "g2", props: {}, children: [
          { type: "ButtonAnswerGroup", question_id: "q6", internal_field: "in_grid", answer_type: "enum", choices: [{ label: "B", value: "b" }] },
        ] },
      ] }) },
    ]);
    expect(scoped.map((f) => [f.internal_field, f.label])).toEqual([["grid_a", "Grid question"], ["after_grid", "Page B"], ["in_grid", "Your home"]]);
    // confirmation review N3: nested containers — a headline in the left
    // column does not name the right column's question
    const columns = questionRuleFields([
      { id: 3, section_name: "Two columns page", content_json: JSON.stringify({ components: [
        { type: "Columns", question_id: "cols", props: {}, children: [
          { type: "Stack", question_id: "left", props: {}, children: [
            { type: "QuestionHeadline", question_id: "hl", props: { text: "Left column headline" } },
            { type: "ButtonAnswerGroup", question_id: "ql", internal_field: "left_q", answer_type: "enum", choices: [{ label: "A", value: "a" }] },
          ] },
          { type: "Stack", question_id: "right", props: {}, children: [
            { type: "ButtonAnswerGroup", question_id: "qr", internal_field: "right_q", answer_type: "enum", choices: [{ label: "B", value: "b" }] },
          ] },
        ] },
      ] }) },
    ]);
    expect(columns.map((f) => [f.internal_field, f.label])).toEqual([["left_q", "Left column headline"], ["right_q", "Two columns page"]]);
    // scoped review M1: questions placed straight into Columns / a grid are
    // cells of their own — a headline cell names no other cell
    const cells = questionRuleFields([
      { id: 4, section_name: "Cells page", content_json: JSON.stringify({ components: [
        { type: "QuestionHeadline", question_id: "top", props: { text: "Top headline" } },
        { type: "Columns", question_id: "cols2", props: {}, children: [
          { type: "QuestionHeadline", question_id: "hc", props: { text: "Left headline" } },
          { type: "TwoButtonYesNo", question_id: "qa", internal_field: "cell_right", answer_type: "boolean" },
          { type: "ButtonAnswerGroup", question_id: "qb", internal_field: "cell_below", answer_type: "enum", choices: [{ label: "C", value: "c" }] },
        ] },
      ] }) },
    ]);
    expect(cells.map((f) => [f.internal_field, f.label])).toEqual([
      ["cell_right", "Top headline (Yes / No)"],
      ["cell_below", "Top headline (Simple answer buttons)"],
    ]);
  });

  // Review fix 2026-10-01: when the field list cannot load, the editor says
  // so instead of showing a builder with nothing to pick.
  it("a failed field load shows an error on the auction editor (the rest of the page still renders)", async () => {
    const { env, sdb, auctionPub } = await seedFunnel();
    const ok = await getHtml(env, `/admin/leadgen/auction/${auctionPub}/edit`);
    expect(ok).not.toContain("data-rule-fields-error");
    sdb.prepare("DROP TABLE leadgen_funnel_variant_sections").run(); // the rule-fields read now fails
    expect((await admin.request(`${API}/auctions/${auctionPub}/rule-fields`, {}, env)).status).toBe(500);
    const failed = await getHtml(env, `/admin/leadgen/auction/${auctionPub}/edit`);
    expect(failed).toContain("data-rule-fields-error");
    expect(failed).toContain("Could not load this auction");
    expect(failed).toContain('id="lg-r-cond-mount"');
  });

  // Review fix 2026-10-01: a funnel that ASKS for the state must not list
  // "State" twice — the visitor's answer is the state a rule tests.
  it("a question answering `state` replaces the visitor fact of the same key (listed once)", async () => {
    const { env, sdb, variantPub } = await seedFunnel();
    const variantId = (sdb.prepare("SELECT id FROM leadgen_funnel_variants WHERE public_id = ?").get(variantPub) as { id: number }).id;
    const where = seedSection(sdb, "Location", "life", [
      { type: "DropdownQuestion", question_id: "q_state", internal_field: "state", answer_type: "enum", props: { label: "Which state is your business in?" },
        choices: [{ label: "California", value: "CA" }, { label: "Texas", value: "TX" }] },
    ]);
    sdb.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, 2)").run(variantId, where);
    const { fields } = (await (await admin.request(`${API}/variants/${variantPub}/rule-fields`, {}, env)).json()) as { fields: Field[] };
    const states = fields.filter((f) => f.internal_field === "state");
    expect(states).toHaveLength(1);
    expect(states[0]).toMatchObject({ group: "question", label: "Which state is your business in?" });
    expect(fields.filter((f) => f.group === "visitor").map((f) => f.internal_field)).not.toContain("state");
  });
});

describeDb("auction Add-a-rule form — offers by name, Tier-level, readable rules (PM feedback)", () => {
  async function editor(): Promise<{ env: Env; sdb: SqliteDb; html: string; ids: Record<string, number>; auctionPub: string }> {
    const { env, sdb } = newHarness();
    const quote = await createQuote(env);
    const auction = await createAuction(env, { auction_name: "Loans", quote_id: quote.id, auction_type: "dynamic" });
    const named = (name: string) => {
      const o = seedOfferWithPlacement(sdb, "cpl");
      sdb.prepare("UPDATE leadgen_offers SET offer_name = ? WHERE id = ?").run(name, o.offer_id);
      return o;
    };
    const fundera = named("Fundera - Tier 1");
    const fora = named("Fora - Tier 3");
    const honest = named("Honest Loans - OW");
    await putParticipating(env, auction.public_id, [fundera, fora, honest].map((o) => o.placement_id));
    const post = (body: unknown) => admin.request(`${API}/auctions/${auction.public_id}/rules`, jsonInit("POST", body), env);
    const funderaPub = (sdb.prepare("SELECT public_id FROM leadgen_offers WHERE id = ?").get(fundera.offer_id) as { public_id: string }).public_id;
    // the PM's case: the offer's "lgo_…" id works as the target
    expect((await post({ rule_level: "offer", action: "exclude", target_offer_id: funderaPub, conditions_json: { groups: [{ field: "os", op: "eq", value: "ios" }] } })).status).toBe(201);
    expect((await post({ rule_level: "tier", action: "include_only", tier_offer_ids: [fora.offer_id, honest.offer_id], conditions_json: { groups: [{ field: "device", op: "eq", value: "mobile" }] } })).status).toBe(201);
    const html = await getHtml(env, `/admin/leadgen/auction/${auction.public_id}/edit`);
    return { env, sdb, html, ids: { fundera: fundera.offer_id, fora: fora.offer_id, honest: honest.offer_id }, auctionPub: auction.public_id };
  }

  it("Target offer is a dropdown of the auction's offers by name (no number box)", async () => {
    const { html, ids } = await editor();
    expect(html).toMatch(new RegExp(`<select id="lg-r-target-offer" class="form-select"><option value="">— choose an offer —</option>.*<option value="${ids.fundera}">Fundera - Tier 1</option>`));
    expect(html).not.toContain('id="lg-r-target-offer" type="number"');
  });

  it("Rule level offers Tier-level with the auction's offers to tick", async () => {
    const { html, ids } = await editor();
    expect(html).toContain('<option value="tier">Tier-level (a group of offers)</option>');
    expect(html).toContain(`<input type="checkbox" data-tier-group-offer value="${ids.fora}" /> Fora - Tier 3`);
  });

  it("the rules list reads in words: the offer by name, the tier's offers, and the IF as a sentence", async () => {
    const { html } = await editor();
    expect(html).toContain('<p class="form-help" data-rule-target>offer: Fundera - Tier 1</p>');
    expect(html).toContain("<h4>Tier-level</h4>");
    expect(html).toContain("offers: Fora - Tier 3 + Honest Loans - OW (shown together)");
    expect(html).toContain("IF: Matches when OS is &quot;iOS&quot;.");
    expect(html).toContain("IF: Matches when Device is &quot;Mobile&quot;.");
    expect(html).not.toMatch(/IF: <code>/); // no raw JSON for a rule the builder can read
  });

  // PM follow-up 2026-10-02 ("THEN shows raw words like include_only")
  it("THEN reads in words for each level; the form's actions and heading too", async () => {
    const { html } = await editor();
    expect(html).toContain("<span><strong>Offer-level</strong> rule</span>");
    expect(html).toContain("<span data-rule-then>THEN <strong>hide this offer</strong></span>");
    expect(html).toContain("<span><strong>Tier-level</strong> rule</span>");
    expect(html).toContain("<span data-rule-then>THEN <strong>show only these offers, together</strong></span>");
    expect(html).not.toMatch(/THEN <strong>(include_only|exclude|allow_list|block_list)<\/strong>/);
    expect(html).toContain("<h3>Rules — IF/THEN for offers, tiers and carriers</h3>");
    expect(html).toContain('<option value="include_only">Show only</option><option value="exclude">Hide</option>');
    expect(html).toContain("<input type=\"checkbox\" id=\"lg-r-strictly\" /> Overrides other rules</label>");
    expect(html).not.toContain("> strictly_override</label>");
  });

  // PM follow-up (confirmation review N2 / N4): the pop-ups show a refusal in
  // words (the API keeps its machine code), and the Simulator says when the
  // funnel's rules ended a visit before any auction.
  it("pop-up refusals read in words; the Simulator names a funnel rule that ended the visit", async () => {
    const { RELOCATED_RULES_SCRIPT, QUOTE_RULES_SCRIPT } = await import("../src/admin/leadgen/ui-rules-builder");
    for (const script of [RELOCATED_RULES_SCRIPT, QUOTE_RULES_SCRIPT]) {
      const src = /function plainReason\(text\) \{[^\n]*\}/.exec(script)?.[0];
      expect(src).toBeDefined();
      const plainReason = new Function(`${src}; return plainReason;`)() as (t: string) => string;
      expect(plainReason("conditions_invalid: Date (US Eastern): pick a date")).toBe("Date (US Eastern): pick a date");
      expect(plainReason("redirect_offer_missing_target: a redirect needs an offer; raw_redirect_url_invalid: not a web address")).toBe("a redirect needs an offer; not a web address");
      expect(plainReason("Date (US Eastern): pick a date")).toBe("Date (US Eastern): pick a date");
      expect(plainReason("tier offers: offer ids must be integer ids")).toBe("tier offers: offer ids must be integer ids");
      expect(script).toContain("lines.push(plainReason(body.fields[k]))");
    }
    const { html } = await editor();
    expect(html).toContain("'Ended before the auction: ' + endedReason + '. No offer was asked and no waterfall ran.'");
    expect(html).toContain("not_eligible: 'the visitor matches none of the funnel");
  });

  // PM follow-up (review): the Simulator runs a funnel's rules — pick which.
  it("the Simulator offers the funnels that use this auction, plus auction rules only", async () => {
    const { env, sdb, html: before, auctionPub } = await editor();
    expect(before).not.toContain('id="lg-sim-funnel"'); // no funnel runs it yet → no picker
    const auctionId = (sdb.prepare("SELECT id FROM leadgen_auctions WHERE public_id = ?").get(auctionPub) as { id: number }).id;
    const variant = sdb.prepare("SELECT v.public_id AS pub FROM leadgen_funnel_variants v ORDER BY v.id ASC LIMIT 1").get() as { pub: string };
    sdb.prepare("UPDATE leadgen_funnel_variants SET auction_id = ? WHERE public_id = ?").run(auctionId, variant.pub);
    const html = await getHtml(env, `/admin/leadgen/auction/${auctionPub}/edit`);
    expect(html).toContain('<select id="lg-sim-funnel" class="form-select" data-sim-funnel>');
    expect(html).toMatch(new RegExp(`<option value="${variant.pub}">[^<]+ \\(variant A\\)</option>`));
    expect(html).toContain('<option value="none">No funnel (auction rules only)</option>');
    expect(html).toContain("funnel_variant_id: byId('lg-sim-funnel') ? val('lg-sim-funnel') : undefined");
    // a funnel name that already starts with its quote's name is not repeated
    const q = sdb.prepare("SELECT q.quote_name AS quote FROM leadgen_funnel_variants v JOIN leadgen_funnels f ON f.id = v.funnel_id JOIN leadgen_quotes q ON q.id = f.quote_id WHERE v.public_id = ?").get(variant.pub) as { quote: string };
    sdb.prepare("UPDATE leadgen_funnels SET funnel_name = ? WHERE id = (SELECT funnel_id FROM leadgen_funnel_variants WHERE public_id = ?)").run(`${q.quote} | Match`, variant.pub);
    const renamed = await getHtml(env, `/admin/leadgen/auction/${auctionPub}/edit`);
    expect(renamed).toContain(`<option value="${variant.pub}">${q.quote} | Match (variant A)</option>`);
  });
  // PM follow-up 2026-10-02: a rule on the date / time of day reads as a date
  // and a clock time, not as 20261031 / 930.
  it("a rule on Date / Time of day reads \"1 Oct 2026\" / \"between 9:30 and 17:00\" in the list", async () => {
    const { env, auctionPub, ids } = await editor();
    const res = await admin.request(`${API}/auctions/${auctionPub}/rules`, jsonInit("POST", {
      rule_level: "offer", action: "exclude", target_offer_id: ids.fora,
      conditions_json: { groups: [{ field: "date_et", op: "eq", value: 20261001 }, { field: "time_et", op: "range", from: 930, to: 1700 }] },
    }), env);
    expect(res.status, await res.clone().text()).toBe(201);
    const html = await getHtml(env, `/admin/leadgen/auction/${auctionPub}/edit`);
    expect(html).toContain("IF: Matches when Date (US Eastern) is &quot;1 Oct 2026&quot; and Time of day (US Eastern) is between 9:30 and 17:00.");
  });
});
