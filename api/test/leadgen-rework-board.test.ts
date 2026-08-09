// LEADGEN-REWORK-03 P3b (S3b.1) — Funnel-builder BOARD SSR proofs (§8.2).
// Renders the REAL editor page through the admin router on the node:sqlite D1
// harness (the leadgen-quotes-ui.test.ts / p3a-split-parity pattern) after
// seeding the quote via the LANDED P1 endpoints — so this exercises the true
// producer→consumer flow: quoteStructureHandler's board projection (shared_page
// + per-funnel active_variant_pages) → renderBuilderPanel's board. It is NOT a
// hand-built-structure unit test (that would false-green past the projection).
//
// Asserts: columns render by display_order with the pinned "Shared first page"
// FIRST; section chips + per-chip / funnel / page menus; the left section
// library with in-use badges; the trailing "+ Add funnel" stub; Appendix A
// strings A-1 / A-2 / A-3 VERBATIM (L-196); the clean 344px routing-rules mount
// (S3b.2's — empty here); and the §10 removed chrome ABSENT from rendered
// output — canvas iframe / canvas toolbar / frame-studio / old structure list /
// region inspectors (element forms; the shared island's dead byId() string
// literals are inert JS, not rendered chrome, and P5's §10 sweep drops them).

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

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

function seedSection(sdb: SqliteDb, name: string, vertical: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q1", internal_field: "f", answer_type: "boolean" }] });
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, 'quote_funnel', ?, 'Headline', ?, 'button', 'active')")
    .run(publicId, name, vertical, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

interface QuoteDetail {
  public_id: string;
  funnels: Array<{ public_id: string; funnel_name: string; variants: Array<{ public_id: string }> }>;
}

// Owner-reported trap (2026-08-09): the Section library is fetched by ACTIVITY,
// but a save is validated against activity AND vertical — so a Home-vertical
// section was offered inside a Car quote, the PUT refused it, and because the
// board keeps the rejected section in its unsaved model EVERY later save
// (including "+ Add page") resent it and failed the same way until a reload.
// The library must offer only what the save will accept.
describeDb("Section library offers only sections this quote can actually use", () => {
  it("a section in a vertical the quote does not carry is NOT offered, and the save would refuse it", async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const carSection = seedSection(sdb, "CAR Credit Score", "car");
    const homeSection = seedSection(sdb, "HOME Roof Age", "home");

    const cq = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "Car only", activity: "quote_funnel", verticals: ["car"] }),
      env,
    );
    expect(cq.status, `create quote: ${await cq.clone().text()}`).toBe(201);
    const quote = (await cq.json()) as QuoteDetail;
    const variant = quote.funnels[0]!.variants[0]!.public_id;

    const page = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    expect(page).toContain("CAR Credit Score");
    // FAIL-BEFORE: this section WAS listed (measured 5 occurrences in the real
    // rendered page) and clicking it wedged the builder.
    expect(page).not.toContain("HOME Roof Age");

    // ...and the reason it must not be offered: the save refuses it by vertical.
    const put = await admin.request(
      `${API}/variants/${variant}`,
      jsonInit("PUT", { pages: [{ name: null, slots: [{ kind: "fixed", section_id: homeSection.public_id }] }] }),
      env,
    );
    expect(put.status).toBe(400);
    expect(JSON.stringify(await put.json())).toContain("Vertical");
    void carSection;
  });

  it("a quote with NO verticals recorded still sees the whole activity list (fail open, never an empty library)", async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    seedSection(sdb, "CAR Credit Score", "car");
    seedSection(sdb, "HOME Roof Age", "home");
    const cq = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "No verticals", activity: "quote_funnel", verticals: ["car"] }),
      env,
    );
    const quote = (await cq.json()) as QuoteDetail;
    sdb.prepare("UPDATE leadgen_quotes SET verticals_json = ? WHERE public_id = ?").run("[]", quote.public_id);
    const page = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    expect(page).toContain("CAR Credit Score");
    expect(page).toContain("HOME Roof Age");
  });
});

describeDb("P3b board SSR — real /structure projection -> renderBuilderPanel (§8.2)", () => {
  let html = "";
  let funnelAPublic = "";
  let funnelBPublic = "";

  beforeAll(async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const credit = seedSection(sdb, "Credit Score", "car");
    const zip = seedSection(sdb, "ZIP code", "car");

    // Quote + its auto funnel A.
    const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Auto & Home", activity: "quote_funnel", verticals: ["car", "home"] }), env);
    expect(cq.status, `create quote: ${await cq.clone().text()}`).toBe(201);
    const quote = (await cq.json()) as QuoteDetail;
    const funnelA = quote.funnels[0]!.public_id;
    funnelAPublic = funnelA;
    const variantA = quote.funnels[0]!.variants[0]!.public_id;

    // A second funnel (kept EMPTY -> Appendix A-1 empty-column state).
    const cf = await admin.request(`${API}/quotes/${quote.public_id}/funnels`, jsonInit("POST", { funnel_name: "Home Insurance" }), env);
    expect(cf.status, `create funnel: ${await cf.clone().text()}`).toBe(201);
    funnelBPublic = ((await cf.json()) as { public_id: string }).public_id;

    // Funnel A gets one page with the Credit Score section (funnel chip + page card).
    const pv = await admin.request(`${API}/variants/${variantA}`, jsonInit("PUT", { pages: [{ name: null, slots: [{ kind: "fixed", section_id: credit.public_id }] }] }), env);
    expect(pv.status, `variant pages: ${await pv.clone().text()}`).toBe(200);

    // Shared first page carries the ZIP section (shared chip + pinned column).
    const sp = await admin.request(`${API}/quotes/${quote.public_id}/shared-page`, jsonInit("POST", { sections: [{ section_id: zip.id }] }), env);
    expect(sp.status, `shared page: ${await sp.clone().text()}`).toBe(201);

    // Funnel A is the default (Appendix A-3 default chip).
    const df = await admin.request(`${API}/quotes/${quote.public_id}/default-funnel`, jsonInit("PUT", { funnel_id: funnelA }), env);
    expect(df.status, `default funnel: ${await df.clone().text()}`).toBe(200);

    html = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
  });

  it("renders the 3-panel board shell (292 library / board / 344 rules mount)", () => {
    expect(html).toContain('data-panel="builder"');
    expect(html).toContain('class="lg-board-shell"');
    expect(html).toContain('class="lg-board-left"');
    expect(html).toContain("data-board");
    expect(html).toContain('class="lg-board-right"');
    expect(html).toContain("data-rules-rail");
  });

  it("LEFT: section library with search, filters, and draggable cards + in-use badges", () => {
    expect(html).toContain("Section library");
    expect(html).toContain("data-lib-search");
    expect(html).toContain("data-lib-filter");
    expect(html).toContain("data-lib-card");
    expect(html).toContain("Credit Score");
    expect(html).toContain("ZIP code");
    // Credit Score is used in the (default/current) funnel -> "In this funnel" badge.
    expect(html).toContain("In this funnel");
  });

  it("CENTER: pinned Shared first page column renders FIRST, before funnel columns", () => {
    const sharedIdx = html.indexOf("lg-col-shared");
    const funnelIdx = html.indexOf("lg-col-funnel");
    expect(sharedIdx).toBeGreaterThan(-1);
    expect(funnelIdx).toBeGreaterThan(-1);
    expect(sharedIdx).toBeLessThan(funnelIdx);
    expect(html).toContain("Shared first page");
    expect(html).toContain("Shared · quote-owned");
  });

  it("funnel columns render by display_order (funnel A's column before the appended funnel's)", () => {
    const aIdx = html.indexOf('data-funnel-public-id="' + funnelAPublic + '"');
    const bIdx = html.indexOf('data-funnel-public-id="' + funnelBPublic + '"');
    expect(aIdx).toBeGreaterThan(-1);
    expect(bIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeLessThan(bIdx);
  });

  it("section chips render on the shared page and the funnel page card", () => {
    expect(html).toContain("data-sec-chip");
    expect(html).toContain('data-chip-scope="shared"');
    expect(html).toContain('data-chip-scope="funnel"');
    expect(html).toContain("data-page-card");
    // shared chip carries the kebab {A/B this slot, Slot rule, Remove}
    expect(html).toContain('data-chip-menu="shared-chip"');
  });

  it("menus present: funnel kebab / shared-chip / funnel-chip / page + guard dialog", () => {
    expect(html).toContain('data-board-menu="funnel"');
    expect(html).toContain('data-board-menu="shared-chip"');
    expect(html).toContain('data-board-menu="funnel-chip"');
    expect(html).toContain('data-board-menu="page"');
    // funnel kebab items
    expect(html).toContain('data-menu-action="duplicate"');
    expect(html).toContain('data-menu-action="set-default"');
    expect(html).toContain('data-menu-action="move-left"');
    expect(html).toContain('data-menu-action="move-right"');
    expect(html).toContain('data-menu-action="delete"');
    // shared-chip items
    expect(html).toContain('data-menu-action="ab-slot"');
    expect(html).toContain('data-menu-action="slot-rule"');
    expect(html).toContain('data-menu-action="remove"');
    // delete-guard dialog scaffold (A-5 blockers rendered by the island)
    expect(html).toContain("data-board-guard");
  });

  it("Appendix A strings A-1 / A-2 / A-3 render VERBATIM (L-196)", () => {
    // A-1: the SECOND (empty) funnel column shows the empty-state hint.
    expect(html).toContain("No pages yet — drag a section here or click + Add page.");
    // A-2: the trailing "+ Add funnel" stub.
    expect(html).toContain("+ Add funnel");
    expect(html).toContain("Visitors reach it through routing rules.");
    // A-3: the Default chip + its tooltip copy.
    expect(html).toContain(">Default<");
    expect(html).toContain("Visitors who match no rule see this funnel.");
  });

  it("Default chip renders on the default funnel column", () => {
    expect(html).toContain("data-default-chip");
    expect(html).toContain('data-pin="4.3-default-chip"');
  });

  it("§10 removed chrome is ABSENT from rendered output (element forms)", () => {
    // canvas iframe + toolbar (renderCanvasPanel deleted)
    expect(html).not.toContain('<iframe id="lg-preview-iframe"');
    expect(html).not.toContain('id="lg-canvas-toolbar"');
    expect(html).not.toContain('id="lg-frame-studio"');
    // old pages-first structure panel + its section list
    expect(html).not.toContain('id="lg-section-list"');
    expect(html).not.toContain('id="lg-structure-panel"');
    // region inspectors (renderInspectorColumn deleted)
    expect(html).not.toContain('data-region-panel="');
    expect(html).not.toContain('id="lg-inspector-column"');
    // The "Rules for this variant ->" goto link lived INSIDE the now-deleted
    // structure panel (id="lg-structure-panel", asserted absent above) — so the
    // rendered link element is gone. (The shared island retains a dead
    // byId()/comment reference to the old ids as inert JS text; P5's §10
    // removal sweep drops those. We assert the rendered CHROME is absent, not
    // the island's dead string literals.)
  });

  // P3b FOLLOW-UP ROUND: the composer (ui-quotes.ts leadgenQuoteEditorPage)
  // now assembles real QuoteRulesRailData (routing rules + per-funnel
  // per-page fields + shared-page fields + answer fields + offers + feed
  // values) and the board calls S3b.2's renderQuoteRulesRail(data) at the
  // mount — no longer an empty hand-off comment. This slice still builds NO
  // rules UI of its OWN; it renders S3b.2's real, data-driven rail.
  it("the routing-rules rail mount is WIRED to S3b.2's renderQuoteRulesRail with real data (not an empty hand-off comment)", () => {
    const railStart = html.indexOf('data-rules-rail');
    expect(railStart).toBeGreaterThan(-1);
    const railSlice = html.slice(railStart, railStart + 600);
    expect(railSlice).toContain('id="lg-qr-rail"');
    expect(railSlice).not.toContain("S3b.2 fills this mount");
  });
});

// P3b relocation round (§8.2 CONDUCTOR RULING): the funnel-builder rebuild
// dropped the old structure panel's "Funnel settings" controls (opening-lander
// + base design + per-variant auction) — NOT a sanctioned §10 removal. They are
// relocated VERBATIM into a dialog opened from the funnel column's kebab, in the
// board's delete-guard dialog vocabulary, saving through the SAME existing
// PUT /variants/:id fields. These SSR proofs render the REAL editor page through
// the admin router on seeded data (the producer->consumer flow), and the last
// one exercises the actual save contract + the money-path no-wipe guarantee.
describeDb("P3b Funnel settings relocation — kebab dialog (§8.2, conductor ruling)", () => {
  let html = "";
  let variantAPublic = "";

  beforeAll(async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Lander Quote", activity: "quote_funnel", verticals: ["car"] }), env);
    expect(cq.status, `create quote: ${await cq.clone().text()}`).toBe(201);
    const quote = (await cq.json()) as QuoteDetail;
    variantAPublic = quote.funnels[0]!.variants[0]!.public_id;

    // Seed the active variant's relocated Funnel-settings fields (through the
    // real PUT /variants/:id) so the SSR dialog renders REAL current values.
    const pv = await admin.request(`${API}/variants/${variantAPublic}`, jsonInit("PUT", {
      lander_enabled: true,
      lander_headline: "Get your free quote",
      lander_subheadline: "Fast & easy",
      lander_hero_media_url: "https://cdn.example.com/hero.png",
      funnel_design_id: "default",
    }), env);
    expect(pv.status, `seed lander: ${await pv.clone().text()}`).toBe(200);

    html = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
  });

  it("the funnel kebab lists a 'Funnel settings' item", () => {
    const menuStart = html.indexOf('data-board-menu="funnel"');
    expect(menuStart).toBeGreaterThan(-1);
    // scoped to the funnel board menu (not the shared-chip / funnel-chip / page menus)
    const menuSlice = html.slice(menuStart, menuStart + 1000);
    expect(menuSlice).toContain('data-menu-action="funnel-settings"');
    expect(menuSlice).toContain("Funnel settings");
    // the pre-existing funnel actions remain (relocation is ADDITIVE)
    expect(menuSlice).toContain('data-menu-action="duplicate"');
    expect(menuSlice).toContain('data-menu-action="delete"');
  });

  it("the relocated dialog renders all six controls with current values", () => {
    // dialog shell in the board delete-guard vocabulary, targeting the active variant
    expect(html).toContain("data-funnel-settings");
    expect(html).toContain(`data-settings-variant="${variantAPublic}"`);
    // 1) opening-lander enable toggle — SSR reflects the seeded true (checked)
    const enIdx = html.indexOf('id="lg-lander-enabled"');
    expect(enIdx).toBeGreaterThan(-1);
    expect(html.slice(enIdx - 48, enIdx + 48)).toContain("checked");
    // 2) headline, 3) subheadline, 4) hero — current values reflected
    expect(html).toContain('id="lg-lander-headline"');
    expect(html).toContain('value="Get your free quote"');
    expect(html).toContain('id="lg-lander-sub"');
    expect(html).toContain('value="Fast &amp; easy"'); // escapeHtml(&)
    expect(html).toContain('id="lg-lander-hero"');
    expect(html).toContain('value="https://cdn.example.com/hero.png"');
    // 5) base funnel-design picker — present, has options, current one selected
    const desIdx = html.indexOf('id="lg-funnel-design"');
    expect(desIdx).toBeGreaterThan(-1);
    const desSlice = html.slice(desIdx, desIdx + 400);
    expect(desSlice).toContain("<option");
    expect(desSlice).toContain("selected");
    // 6) per-variant auction picker — present with its "— none —" current value
    const aucIdx = html.indexOf('id="lg-auction-id"');
    expect(aucIdx).toBeGreaterThan(-1);
    expect(html.slice(aucIdx, aucIdx + 220)).toContain("none");
  });

  it("the board data blob carries per-funnel settings for client re-population", () => {
    // funnelSettingsForBlob threads the active variant's scalars per funnel so
    // the island re-populates the shared dialog on kebab open.
    expect(html).toContain('"settings"');
    expect(html).toContain(`"variant_public_id":"${variantAPublic}"`);
    expect(html).toContain('"lander_headline":"Get your free quote"');
  });

  it("a settings save round-trips through PUT /variants/:id and does NOT wipe the money path", async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const sec = seedSection(sdb, "Credit Score", "car");
    const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "No-Wipe", activity: "quote_funnel", verticals: ["car"] }), env);
    expect(cq.status, `create quote: ${await cq.clone().text()}`).toBe(201);
    const quote = (await cq.json()) as QuoteDetail;
    const variant = quote.funnels[0]!.variants[0]!.public_id;

    // Establish the money path: one page holding a section.
    const seedPage = await admin.request(`${API}/variants/${variant}`, jsonInit("PUT", { pages: [{ name: null, slots: [{ kind: "fixed", section_id: sec.public_id }] }] }), env);
    expect(seedPage.status, `seed page: ${await seedPage.clone().text()}`).toBe(200);

    // The relocated dialog's save payload — EXACTLY the six settings fields
    // (the collectFunnelSettings shape). No pages/sections key -> the page
    // replace-set MUST NOT run (putVariantHandler: absent == no change).
    const save = await admin.request(`${API}/variants/${variant}`, jsonInit("PUT", {
      lander_enabled: true,
      lander_headline: "Edited via settings",
      lander_subheadline: "sub",
      lander_hero_media_url: "",
      funnel_design_id: "default",
      auction_id: null,
    }), env);
    expect(save.status, `settings save: ${await save.clone().text()}`).toBe(200);
    const saved = (await save.json()) as { lander_headline: string; lander_enabled: boolean };
    expect(saved.lander_headline).toBe("Edited via settings");
    expect(saved.lander_enabled).toBe(true);

    // No-wipe proof: the section chip still renders on the funnel column after
    // the settings-only save (pages/sections untouched — read back through the
    // real /structure projection -> board render).
    const after = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    expect(after).toContain("Credit Score");
    expect(after).toContain("data-sec-chip");
  });
});

// P3b adversarial-review finding (P2-D): slot-preservation proof for the
// board's page-mutation save path (funnel.ts ~4004-4046 — slotToPut /
// funnelPagesToPut / saveFunnel). saveFunnel ALWAYS full-replaces a variant's
// `pages` from the board's CURRENT in-memory model on every mutating action
// (add/reorder/remove a chip or page) — never a partial diff — so an A/B
// slot's allocations and a ruled slot's per-condition cases + default must
// round-trip through that full-replace with the SAME section pairing every
// time, or a routine board edit would silently re-shuffle who sees what.
//
// The board blob (boardDataBlob) hands the ES5 island each slot's candidates
// as an ORDERED array of PUBLIC section ids, alongside the RAW, numeric-
// section-id-keyed `rules`/`allocations` JSON the DB stores untouched
// (quotes-handlers.ts pageToApi). slotToPut recovers the public-id pairing by
// POSITION: for an "ab" slot, candidate[k] <-> allocation[k]; for a "ruled"
// slot, candidate[j] <-> the j-th distinct numeric id in "cases-in-order, then
// default" (its own `order`/`seen` construction, mirrored by preparePages'
// OWN `candidateIds` Set on save — case order then default — which is why
// `ORDER BY fvs.id ASC` on read reproduces the same correspondence). This test
// does not assume that invariant — it proves it, end to end, through the
// real router.
//
// The real slotToPut/funnelPagesToPut are ES5 functions embedded inside a
// template-literal string (QUOTE_EDITOR_SCRIPT) with no standalone export —
// they cannot be executed outside a browser. This proof ports the algorithm
// faithfully (byte-for-byte the same branching) and drives it through the
// REAL PUT /variants/:id — the actual code under test is the SERVER'S
// round-trip of whatever payload that algorithm produces, exercised via a
// REAL board blob (producer) rather than a hand-built one.
describeDb("P3b board page-mutation save — slot-preservation proof (funnel.ts saveFunnel/slotToPut, adversarial review)", () => {
  interface BoardBlobSlot {
    slot_id: number;
    kind: string;
    section_ids: string[];
    allocations: { section_id: number; bp: number }[] | null;
    rules: { cases: { conditions: { groups: { field: string; op: string; value: string }[] }; section_id: number }[]; default_section_id: number } | null;
  }
  interface BoardBlobFunnel {
    public_id: string;
    pages: { page_id: string; slots: BoardBlobSlot[] }[];
  }
  interface BoardBlob {
    funnels: BoardBlobFunnel[];
  }

  function extractBoardBlob(html: string): BoardBlob {
    const marker = 'id="lg-board-data">';
    const start = html.indexOf(marker);
    expect(start, "lg-board-data blob present in the SSR'd editor page").toBeGreaterThan(-1);
    const jsonStart = start + marker.length;
    const end = html.indexOf("</script>", jsonStart);
    return JSON.parse(html.slice(jsonStart, end)) as BoardBlob;
  }

  // --- faithful port of funnel.ts's slotToPut/funnelPagesToPut (~4004-4031) --
  function slotToPut(slot: BoardBlobSlot): Record<string, unknown> {
    if (slot.kind === "ab" && slot.allocations) {
      const allocs: { section_id: string; bp: number }[] = [];
      for (let k = 0; k < slot.allocations.length; k++) {
        allocs.push({ section_id: slot.section_ids[k]!, bp: slot.allocations[k]!.bp });
      }
      return { kind: "ab", allocations: allocs };
    }
    if (slot.kind === "ruled" && slot.rules) {
      const cs = slot.rules.cases || [];
      const order: number[] = [];
      const seen: Record<number, 1> = {};
      for (let i = 0; i < cs.length; i++) {
        const sid = cs[i]!.section_id;
        if (!seen[sid]) { seen[sid] = 1; order.push(sid); }
      }
      const def = slot.rules.default_section_id;
      if (def !== null && def !== undefined && !seen[def]) order.push(def);
      const map: Record<number, string> = {};
      for (let j = 0; j < order.length; j++) map[order[j]!] = slot.section_ids[j]!;
      const cases = cs.map((c) => ({ conditions: c.conditions, section_id: map[c.section_id]! }));
      const out: Record<string, unknown> = { kind: "ruled", cases };
      if (def !== null && def !== undefined) out.default_section_id = map[def];
      return out;
    }
    return { kind: "fixed", section_id: slot.section_ids[0] };
  }
  function funnelPagesToPut(funnel: BoardBlobFunnel): Array<{ name: null; slots: Record<string, unknown>[] }> {
    return (funnel.pages || []).map((p) => ({ name: null, slots: (p.slots || []).map(slotToPut) }));
  }

  it("an in-page A/B slot + a ruled slot survive a board full-replace save with correct index remap", async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const abX = seedSection(sdb, "AB Section X", "car");
    const abY = seedSection(sdb, "AB Section Y", "car");
    const ruledMobile = seedSection(sdb, "Ruled Mobile", "car");
    const ruledDesktop = seedSection(sdb, "Ruled Desktop", "car");
    const ruledDefault = seedSection(sdb, "Ruled Default", "car");

    const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Slot Preservation", activity: "quote_funnel", verticals: ["car"] }), env);
    expect(cq.status, `create quote: ${await cq.clone().text()}`).toBe(201);
    const quote = (await cq.json()) as QuoteDetail;
    const variant = quote.funnels[0]!.variants[0]!.public_id;

    // Seed ONE page: an A/B slot (70/30 split) + a ruled slot (2 device cases
    // + a default) — through the real PUT (the SAME "pages" replace-set the
    // board's own saveFunnel uses).
    const seed = await admin.request(
      `${API}/variants/${variant}`,
      jsonInit("PUT", {
        pages: [
          {
            name: null,
            slots: [
              { kind: "ab", allocations: [{ section_id: abX.public_id, bp: 7000 }, { section_id: abY.public_id, bp: 3000 }] },
              {
                kind: "ruled",
                cases: [
                  { conditions: { groups: [{ field: "device", op: "eq", value: "mobile" }] }, section_id: ruledMobile.public_id },
                  { conditions: { groups: [{ field: "device", op: "eq", value: "desktop" }] }, section_id: ruledDesktop.public_id },
                ],
                default_section_id: ruledDefault.public_id,
              },
            ],
          },
        ],
      }),
      env,
    );
    expect(seed.status, `seed pages: ${await seed.clone().text()}`).toBe(200);

    // Read the REAL board blob — exactly what the ES5 island receives
    // (producer -> consumer; not a hand-built structure).
    const html1 = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    const blob1 = extractBoardBlob(html1);
    const funnel1 = blob1.funnels[0]!;
    const page1 = funnel1.pages[0]!;
    const abSlot1 = page1.slots.find((s) => s.kind === "ab");
    const ruledSlot1 = page1.slots.find((s) => s.kind === "ruled");
    expect(abSlot1, "seeded A/B slot present in the board blob").toBeTruthy();
    expect(ruledSlot1, "seeded ruled slot present in the board blob").toBeTruthy();

    // Drive the board page-mutation save: build the PUT payload via the EXACT
    // client remap algorithm from the real board-blob-shaped input.
    const putBody = { pages: funnelPagesToPut(funnel1) };
    type PutAbSlot = { kind: string; allocations: { section_id: string; bp: number }[] };
    type PutRuledSlot = {
      kind: string;
      cases: { conditions: { groups: { field: string; op: string; value: string }[] }; section_id: string }[];
      default_section_id: string;
    };
    const putSlots = putBody.pages[0]!.slots as Array<PutAbSlot | PutRuledSlot>;
    const putAbSlot = putSlots.find((s) => s.kind === "ab") as PutAbSlot;
    const putRuledSlot = putSlots.find((s) => s.kind === "ruled") as PutRuledSlot;

    // Remap correctness (PRE-send): the client's index remap must recover the
    // ORIGINAL public-id pairing from the raw numeric rules/allocations plus
    // the candidate-order section_ids — the exact concern under review.
    const abByPub = new Map(putAbSlot.allocations.map((a) => [a.section_id, a.bp]));
    expect(abByPub.get(abX.public_id)).toBe(7000);
    expect(abByPub.get(abY.public_id)).toBe(3000);
    const mobileCase = putRuledSlot.cases.find((c) => c.conditions.groups[0]!.value === "mobile")!;
    const desktopCase = putRuledSlot.cases.find((c) => c.conditions.groups[0]!.value === "desktop")!;
    expect(mobileCase.section_id).toBe(ruledMobile.public_id);
    expect(desktopCase.section_id).toBe(ruledDesktop.public_id);
    expect(putRuledSlot.default_section_id).toBe(ruledDefault.public_id);

    // Drive the save through the REAL router (funnel.ts saveFunnel's own PUT).
    const resave = await admin.request(`${API}/variants/${variant}`, jsonInit("PUT", putBody), env);
    expect(resave.status, `board page-mutation resave: ${await resave.clone().text()}`).toBe(200);

    // Read back AGAIN (fresh SSR render -> fresh board blob) and assert both
    // slots' allocations/rules SURVIVED the full-replace with the SAME
    // section pairing — proving the round trip (blob -> client remap -> PUT
    // -> DB -> blob) never silently swaps or misassigns a section.
    const html2 = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    const blob2 = extractBoardBlob(html2);
    const page2 = blob2.funnels[0]!.pages[0]!;
    const abSlot2 = page2.slots.find((s) => s.kind === "ab")!;
    const ruledSlot2 = page2.slots.find((s) => s.kind === "ruled")!;
    const abByNumId = new Map(abSlot2.allocations!.map((a) => [a.section_id, a.bp]));
    expect(abByNumId.get(abX.id)).toBe(7000);
    expect(abByNumId.get(abY.id)).toBe(3000);
    const mobileCase2 = ruledSlot2.rules!.cases.find((c) => c.conditions.groups[0]!.value === "mobile")!;
    const desktopCase2 = ruledSlot2.rules!.cases.find((c) => c.conditions.groups[0]!.value === "desktop")!;
    expect(mobileCase2.section_id).toBe(ruledMobile.id);
    expect(desktopCase2.section_id).toBe(ruledDesktop.id);
    expect(ruledSlot2.rules!.default_section_id).toBe(ruledDefault.id);
  });
});
