// LeadGen v2.5 Phase B (slice B2) — the 04 §4.1 Quote Builder FRAME STUDIO
// over the REAL admin shell router + REAL migrations 0036–0041 (node:sqlite
// harness). Covers:
//
//   * every §4.1 panel SSRs: left structure panel · center canvas mount
//     (srcdoc iframe + toolbar: template picker / theme editor / viewport /
//     preview modes / site selector / variant mirror) · right region
//     inspectors · publish chip (14 §14.2 count copy);
//   * §4.4 region inspectors control-by-control (spot asserts per region) +
//     the EXACT C2 compat consequence sentence + the C7 "funnel-wide" labels;
//   * theme editor (09 §9.3): 14-role swatch grid w/ "Used by" + inheritance
//     source, typography/scales/button/card controls, custom hex ONLY inside
//     the collapsed "Advanced token administration" w/ the exact warning;
//   * site selector (10 §10.5): ALL CMS sites + Active / Activation off /
//     Not activated yet badges + the "CMS fallback branding" entry;
//   * §2.4 vocabulary: the auction marker says "slide";
//   * inline scripts are strict ES5 + parse standalone (node --check);
//     JSON data blobs are `<`-escaped;
//   * NO raw-JSON conditions textarea on the normal Rules surface (the B3
//     builder mount replaces it; the legacy textarea lives BEHIND an
//     Advanced disclosure) and NO hex color text outside Advanced-marked
//     containers in normal-mode SSR (the first no-raw-json/no-hex lint leg);
//   * GET /funnels/:id/frame?switch_to=<id> — the read-only C5 template-
//     switch leg: {merged, confirmations}, nothing persisted;
//   * DEV-60 Phase C polish: (a) media-picker affordances replace the raw
//     media-path inputs + the benefit-bar icon is a curated closed dropdown,
//     (b) quote-name inline edit, (c) drag handles beside the ↑/↓ buttons,
//     (d) §9.3 harmony steps (labels, not hex) + the preset-backed
//     mini-preview mount wired to the real preview endpoint.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { BENEFIT_BAR_ICONS } from "../src/admin/leadgen/ui-quotes";

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
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-1','Site One','one.example.com');" +
      "INSERT INTO sites (id, name, domain) VALUES ('site-2','Site Two','two.example.com');" +
      "INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','site_name','Site One Brand');",
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

function seedSection(sdb: SqliteDb, opts: { activity: string; vertical: string; name: string }): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "insured", answer_type: "boolean" }] });
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, ?, ?, ?, ?, 'button', 'active')")
    .run(publicId, opts.name, opts.activity, opts.vertical, "Headline", content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

interface QuoteDetail {
  id: number;
  public_id: string;
  funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
}

// Rework M2 (§4.3-1, §4.3-15): activation now also requires the quote's
// shared first page (leadgen_funnel_pages, quote_id-owned) to carry ≥1
// section — a section distinct from the funnel/variant's own (§4.3-13
// uniqueness). Route wiring for POST/PUT /quotes/:id/shared-page is
// mid-flight in another round, so this seeds the SQL shape directly
// (mirrors leadgen-rework-handlers.test.ts / leadgen-rework-routing.test.ts).
function seedSharedPageSection(sdb: SqliteDb, quoteId: number): void {
  const sectionPublicId = mintPublicId("section");
  const content = JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "f", answer_type: "boolean" }] });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, 'quote_funnel', 'life', 'Shared', ?, 'button', 'active')",
    )
    .run(sectionPublicId, `Shared ${sectionPublicId.slice(-4)}`, content);
  const sectionId = (sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sectionPublicId) as { id: number }).id;
  const pagePublicId = mintPublicId("funnel_page");
  sdb.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position, name) VALUES (?, ?, 0, NULL)").run(pagePublicId, quoteId);
  sdb
    .prepare(
      `INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id)
       VALUES (?, ?, 0, (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?))`,
    )
    .run(quoteId, sectionId, pagePublicId);
}

interface Harness {
  sdb: SqliteDb;
  env: Env;
  quotePublicId: string;
  funnelPublicId: string;
  variantId: string;
  html: string;
}

// One editor page with 2 ordered sections + 1 rule + an activation row on
// site-1 (enabled) — site-2 stays "Not activated yet" for the §10.5 badges.
async function studioHarness(): Promise<Harness> {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  const env = buildEnv(d1FromSqlite(sdb));
  const create = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Studio Quote", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(create.status, `create quote: ${await create.clone().text()}`).toBe(201);
  const q = (await create.json()) as QuoteDetail;
  const variantId = q.funnels[0]!.variants[0]!.public_id;
  const funnelPublicId = q.funnels[0]!.public_id;
  const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life", name: "First slide" });
  const s2 = seedSection(sdb, { activity: "quote_funnel", vertical: "life", name: "Second slide" });
  const put = await admin.request(
    `${API}/variants/${variantId}`,
    jsonInit("PUT", { sections: [{ section_id: s1.id }, { section_id: s2.id }], rules: [{ rule_type: "eligibility" }] }),
    env,
  );
  expect(put.status, `seed variant: ${await put.clone().text()}`).toBe(200);
  seedSharedPageSection(sdb, q.id);
  const activate = await admin.request(
    `${API}/quotes/${q.public_id}/activation/site-1`,
    jsonInit("PUT", { enabled: true, slug: "studio" }),
    env,
  );
  expect(activate.status, `activate: ${await activate.clone().text()}`).toBe(200);
  const page = await admin.request(`/admin/leadgen/quotes/${q.public_id}/edit`, {}, env);
  expect(page.status).toBe(200);
  return { sdb, env, quotePublicId: q.public_id, funnelPublicId, variantId, html: await page.text() };
}

let cached: Harness | null = null;
async function harness(): Promise<Harness> {
  if (cached === null) cached = await studioHarness();
  return cached;
}

// ===========================================================================
// §4.1 — every studio panel SSRs
// ===========================================================================

describeDb("Quote Builder frame studio — §4.1 panels", () => {
  // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10): the ENTIRE §4.1 studio grid
  // (structure panel / canvas mount / inspector column, `lg-studio` 260/1fr/320
  // three-column layout) is REPLACED by the §8.2 board's OWN three-column
  // anatomy (292px library / fluid board / 344px rules rail — a DIFFERENT
  // right column with a DIFFERENT purpose). Replacement coverage:
  // test/leadgen-rework-board.test.ts ("renders the 3-panel board shell") +
  // test-ui/leadgen-rework-p3b-board.gesture.spec.ts.
  it("renders the §8.2 board's 3-panel shell (library / board / rules rail) — the OLD studio grid is gone", async () => {
    const { html } = await harness();
    expect(html).not.toContain('id="lg-frame-studio"');
    expect(html).not.toContain('id="lg-structure-panel"');
    expect(html).not.toContain('id="lg-canvas-toolbar"');
    expect(html).not.toContain('id="lg-preview-iframe"');
    expect(html).not.toContain('id="lg-inspector-column"');
    expect(html).toContain('class="lg-board-shell"');
    expect(html).toContain('class="lg-board-left"');
    expect(html).toContain("data-board");
    expect(html).toContain('id="lg-qr-rail"');
  });

  // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10): the OLD flat structure panel
  // (id="lg-section-list"/"lg-add-section", data-select-slide/-move-up/-down/
  // -remove-section) is REPLACED by the board's library + per-page section
  // chips (data-sec-chip, with per-chip kebab {Move up, Move down, Remove} —
  // the a11y menu-equivalent of the chip-reorder drag). The auction-entry SSR
  // hint and the "Rules for this variant" goto-link are contract-silent
  // GAPS/removals — see test/leadgen-quotes-ui.test.ts's own retirements for
  // the detailed disposition of each (auction-entry hint = cosmetic-only gap;
  // "Rules for this variant" link = §10-sanctioned removal, superseded by the
  // §8.2 RIGHT rail). data-goto-tab="ab" no longer exists as a structure-panel
  // link — the board's own A/B badge (data-ab-badge) is the replacement,
  // proven by test-ui/leadgen-rework-p3b-board.gesture.spec.ts's "A/B badge
  // navigates to the A/B tab".
  it("§8.2 board: section chips (with menu-equivalent reorder) replace the old flat structure-panel rows", async () => {
    const { html } = await harness();
    expect(html).not.toContain('id="lg-section-list"');
    expect(html).not.toContain('id="lg-add-section"');
    // NOTE: a bare "data-select-slide" substring check is NOT used here — the
    // shared island still carries a dead el.getAttribute('data-select-slide')
    // JS reference (P5 orphan-scan territory, unreachable since the row
    // markup that carried this attribute is deleted), which would
    // false-positive a bare substring check the same way data-move-up/-down
    // did above.
    expect(html).not.toContain('data-goto-tab="rules"');
    expect(html).toContain("data-sec-chip");
    expect(html).toContain('data-menu-action="chip-up"');
    expect(html).toContain('data-menu-action="chip-down"');
    expect(html).toContain("data-ab-badge");
    // DEV-59: the dot still shows REAL per-section mapping status (now on the
    // board's chips) — these sections have no linked Offers → "none".
    expect(html).not.toContain('data-mapping-status="unknown"');
    expect(html).toMatch(/lg-map-dot" data-mapping-status="none" title="No Offers selected yet"/);
  });

  it("DEV-59: the mapping dot decodes the section's REAL Offer-mapping verdict (complete/incomplete/none) end-to-end from the DB aggregates", async () => {
    // fresh harness (never the cached one — this seeds offer rows)
    const h = await studioHarness();
    const rows = h.sdb
      .prepare("SELECT s.id, s.public_id, s.section_name FROM leadgen_sections s ORDER BY s.id ASC")
      .all() as Array<{ id: number; public_id: string; section_name: string }>;
    const [s1, s2] = [rows[0]!, rows[1]!];
    // seed one COMPLETE offer link on s1 and one SELECTED/not-started on s2
    h.sdb
      .prepare(
        "INSERT INTO leadgen_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type, status) VALUES ('lgo_dotcomplete0000000000000000', 'Dot Offer A', 'p', 'quote_funnel', 'life', 's2s_postback', 'cpc', 'active')",
      )
      .run();
    h.sdb
      .prepare(
        "INSERT INTO leadgen_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type, status) VALUES ('lgo_dotselected0000000000000000', 'Dot Offer B', 'p', 'quote_funnel', 'life', 's2s_postback', 'cpc', 'active')",
      )
      .run();
    const offerA = (h.sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = 'lgo_dotcomplete0000000000000000'").get() as { id: number }).id;
    const offerB = (h.sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = 'lgo_dotselected0000000000000000'").get() as { id: number }).id;
    h.sdb
      .prepare("INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected, mapping_state, required_fields_total, required_fields_mapped) VALUES (?, ?, 1, 'complete', 1, 1)")
      .run(s1.id, offerA);
    h.sdb
      .prepare("INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected, mapping_state) VALUES (?, ?, 1, 'selected')")
      .run(s2.id, offerB);

    // the structure API projects the DEV-59 verdicts…
    const structure = await admin.request(`${API}/quotes/${h.quotePublicId}/structure`, {}, h.env);
    expect(structure.status).toBe(200);
    const body = (await structure.json()) as {
      funnels: Array<{
        variants: Array<{ sections: Array<{ section_id: number; mapping_status: string }> }>;
        // §10/S5.3: the board's OWN data source — quoteStructureHandler's
        // attachMappingStatusToPages attaches this per candidate (asserted below).
        active_variant_pages?: Array<{ slots: Array<{ candidates: Array<{ section_id: string; mapping_status?: string }> }> }>;
      }>;
    };
    const sections = body.funnels[0]!.variants[0]!.sections;
    expect(sections.find((s) => s.section_id === s1.id)!.mapping_status).toBe("complete");
    expect(sections.find((s) => s.section_id === s2.id)!.mapping_status).toBe("incomplete");

    // …and the §8.2 board paints them (green/amber via the status attribute;
    // titles in operator words) on its per-page section CHIP. P3b follow-up
    // FIX (not a retirement — the underlying data wiring IS correct,
    // quotes-handlers.ts attachMappingStatusToPages): a section's public id
    // now appears TWICE in the rendered page (once on the LEFT library card,
    // which carries no mapping-status dot at all, and once on its board
    // CHIP, which does) — data-section-public-id="X" alone is no longer a
    // unique locator the way it was in the OLD flat structure panel, so this
    // targets the chip specifically via its data-chip-scope="funnel" sibling
    // attribute (renderSectionChip's exact attribute order).
    const page = await admin.request(`/admin/leadgen/quotes/${h.quotePublicId}/edit`, {}, h.env);
    const html = await page.text();
    const rowOf = (publicId: string): string => {
      const at = html.indexOf(`data-chip-scope="funnel" data-section-public-id="${publicId}"`);
      expect(at, `board chip for ${publicId}`).toBeGreaterThan(-1);
      return html.slice(at, html.indexOf("</div>", at));
    };
    expect(rowOf(s1.public_id)).toContain('data-mapping-status="complete" title="Offer mapping complete"');
    expect(rowOf(s2.public_id)).toContain('data-mapping-status="incomplete" title="Offer mapping incomplete"');
    // an edge on a section makes non-complete edges count too (mappingSummaryOf
    // parity): flip s1's edge set to carry one orphaned edge → incomplete
    h.sdb
      .prepare(
        "INSERT INTO leadgen_offer_payload_schemas (public_id, offer_id, version, schema_json, source) VALUES ('lgp_dotschema000000000000000000', ?, 1, '{\"version\":1,\"root\":{\"type\":\"object\",\"children\":[]}}', 'manual')",
      )
      .run(offerA);
    const schemaId = (h.sdb.prepare("SELECT id FROM leadgen_offer_payload_schemas WHERE public_id = 'lgp_dotschema000000000000000000'").get() as { id: number }).id;
    h.sdb
      .prepare(
        "INSERT INTO leadgen_section_answer_maps (public_id, section_id, offer_id, payload_schema_id, payload_schema_public_id, question_id, question_key, internal_field, answer_type, offer_payload_field_path, provider_expected_type, required_for_offer, mapping_status) VALUES ('lgm_dotorphan000000000000000000', ?, ?, ?, 'lgp_dotschema000000000000000000', 'q1', 'k', 'insured', 'boolean', 'data.gone', 'boolean', 1, 'orphaned')",
      )
      .run(s1.id, offerA, schemaId);
    const structure2 = await admin.request(`${API}/quotes/${h.quotePublicId}/structure`, {}, h.env);
    const body2 = (await structure2.json()) as {
      funnels: Array<{ variants: Array<{ sections: Array<{ section_id: number; mapping_status: string }> }> }>;
    };
    expect(body2.funnels[0]!.variants[0]!.sections.find((s) => s.section_id === s1.id)!.mapping_status).toBe("incomplete");

    // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10) — UPDATED §10/S5.3: the OLD
    // <select id="lg-add-section-select"> add-picker DOM was already gone since
    // P3b (the board's "+ section" is a plain-list popover, openPopoverList,
    // with no mapping-status shown at add-time), but its per-<option> live dot-
    // copy JS (fixedSlotFromOption, reading opt.getAttribute('data-mapping-
    // status') off the vanished <option> and painting it onto a freshly cloned
    // row) survived as UNREACHABLE dead code until S5.3 deleted it (the §10/§8.9
    // orphan-scan sweep) — this test's substring assertions on that dead JS are
    // what broke, not the guarantee itself. There is no separate client-side
    // add-time decode step to assert any more: every board mutation (add/move/
    // remove) round-trips a PUT then reloadPage(), so a chip's dot is ALWAYS
    // freshly server-rendered, never client-painted.
    //
    // The end-to-end mechanism is now asserted directly at its two REAL
    // server-side layers, both already exercised by REAL admin.request() calls
    // above (never injected markup, never a bare unit call on MAPPING_DOT_TITLES
    // alone): (1) "the board blob" — quoteStructureHandler's
    // attachMappingStatusToPages attaches the SAME per-section verdict onto
    // EACH board-page candidate in the /structure response
    // (funnels[].active_variant_pages[].slots[].candidates[].mapping_status —
    // what renderBoardPageCard's chips are actually built from); (2)
    // renderSectionChip + MAPPING_DOT_TITLES (quotes-tabs/funnel.ts) paint that
    // SAME verdict into the chip's data-mapping-status/title at SSR time —
    // proven above (lines 356-362) against the REAL rendered admin HTML.
    const candidatesFor = (publicId: string): Array<{ section_id: string; mapping_status?: string }> =>
      (body.funnels[0]!.active_variant_pages ?? []).flatMap((p) => p.slots).flatMap((s) => s.candidates).filter((c) => c.section_id === publicId);
    expect(candidatesFor(s1.public_id)[0]?.mapping_status, "board-blob candidate for s1").toBe("complete");
    expect(candidatesFor(s2.public_id)[0]?.mapping_status, "board-blob candidate for s2").toBe("incomplete");
  });

  it("DEV-59 corner: a SELECTED Offer with ZERO required fields keeps the Sections-list amber (dot == list badge) while the §12.11 publish gate passes it", async () => {
    const h = await studioHarness();
    const rows = h.sdb
      .prepare("SELECT s.id, s.public_id FROM leadgen_sections s ORDER BY s.id ASC")
      .all() as Array<{ id: number; public_id: string }>;
    const s1 = rows[0]!;
    h.sdb
      .prepare(
        "INSERT INTO leadgen_offers (public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_type, status) VALUES ('lgo_dotzeroreq00000000000000000', 'Dot Offer Zero Required', 'p', 'quote_funnel', 'life', 's2s_postback', 'cpc', 'active')",
      )
      .run();
    const offerId = (
      h.sdb.prepare("SELECT id FROM leadgen_offers WHERE public_id = 'lgo_dotzeroreq00000000000000000'").get() as {
        id: number;
      }
    ).id;
    // the corner EXPLICITLY: mapping not started ('selected', no edges) with
    // required_fields_total = 0 — publishable per sectionValidationStatus
    // ("an Offer with 0 required fields + no errors is publishable even if
    // nothing is mapped").
    h.sdb
      .prepare(
        "INSERT INTO leadgen_section_available_offers (section_id, offer_id, selected, mapping_state, required_fields_total, required_fields_mapped) VALUES (?, ?, 1, 'selected', 0, 0)",
      )
      .run(s1.id, offerId);

    // the DOT decodes the not-started amber…
    const structure = await admin.request(`${API}/quotes/${h.quotePublicId}/structure`, {}, h.env);
    expect(structure.status).toBe(200);
    const body = (await structure.json()) as {
      funnels: Array<{ variants: Array<{ sections: Array<{ section_id: number; mapping_status: string }> }> }>;
    };
    expect(
      body.funnels[0]!.variants[0]!.sections.find((s) => s.section_id === s1.id)!.mapping_status,
      "the dot keeps the not-started amber for the zero-required corner",
    ).toBe("incomplete");

    // …in PARITY with the Sections-list badge (ONE color per section across
    // both admin surfaces — the variantSectionMappingStatus contract)…
    const list = await admin.request(`${API}/sections`, {}, h.env);
    expect(list.status).toBe(200);
    const items = ((await list.json()) as { items: Array<{ id: number; completeness: string }> }).items;
    expect(
      items.find((i) => i.id === s1.id)!.completeness,
      "the Sections-list badge shows the SAME amber",
    ).toBe("incomplete");

    // …while the §12.11 publish gate PASSES the same corner: the activation
    // PUT (the REAL sectionValidationStatus preflight) stays 200 — the dot's
    // amber is a workflow nudge, never an activation block.
    const activate = await admin.request(
      `${API}/quotes/${h.quotePublicId}/activation/site-1`,
      jsonInit("PUT", { enabled: true, slug: "dot-corner" }),
      h.env,
    );
    expect(activate.status, await activate.clone().text()).toBe(200);
  });

  // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10): "canvas + all controllers
  // (Template/Theme/Desktop/Mobile/Current-slide/Step-through)" is EXPLICITLY
  // named in the contract's REMOVED list — the entire canvas toolbar
  // (viewport toggle, preview-mode toggle, stepper, site/variant mirrors) is
  // gone with no replacement in the funnel-builder tab (the board has its own
  // per-funnel Preview action instead — data-pin="8.2-preview", proven in
  // test/leadgen-quotes-ui.test.ts + the gesture spec).
  it("the OLD canvas toolbar is gone (§8.2/§10: canvas + ALL controllers explicitly removed)", async () => {
    const { html } = await harness();
    expect(html).not.toContain('id="lg-canvas-toolbar"');
    expect(html).not.toContain('id="lg-template-btn"');
    expect(html).not.toContain('id="lg-theme-btn"');
    expect(html).not.toContain('data-viewport-btn="desktop"');
    expect(html).not.toContain('id="lg-canvas-site-select"');
    expect(html).not.toContain('id="lg-canvas-variant-select"');
  });

  // LEADGEN-REWORK-03 P3b RETIREMENT (§10 explicit): "canvas template picker"
  // is named VERBATIM in the removal inventory. M5's SAVED templates
  // (leadgen_frame_templates) replace the old hardcoded 6-arrangement
  // registry this test pinned; the board's own per-funnel template pickchip
  // (data-template-picker) opens a popover of the quote's SAVED templates —
  // a different control entirely, proven by the board gesture spec (no
  // dedicated SSR test needed: the popover is populated client-side from the
  // #lg-board-data blob, not server-rendered per-template markup).
  it("the OLD canvas-embedded template picker is gone (§10: 'canvas template picker' explicitly removed)", async () => {
    const { html } = await harness();
    expect(html).not.toContain('id="lg-template-picker"');
    expect(html).not.toContain('data-template-pick="centered"');
    expect(html).not.toContain('id="lg-template-confirm"');
  });

  // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10): the slot-interior banner was
  // canvas-only chrome (the click-to-select region model no longer exists
  // without the canvas) — gone with the canvas.
  it("the OLD section-slot interior banner is gone (canvas-only chrome, §8.2/§10)", async () => {
    const { html } = await harness();
    expect(html).not.toContain('id="lg-slot-banner"');
  });

  it("E4: the island's click-walk resolves a no-region canvas click to `background` (the served layer is pointer-events:none behind #lg-funnel-root and can never be the click target)", async () => {
    const { html } = await harness();
    const island = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)!.join("\n");
    // the walk-miss fallback: no data-frame-region ancestor + no slot
    // interior → the background region (04 §4.1 click-select reaches the
    // §4.4 Background inspector)
    const fallbackSrc = "if (region === null && !interior) { region = 'background'; }";
    expect(island).toContain(fallbackSrc);
    // precedence: the slot-interior banner short-circuit RETURNS before the
    // fallback line runs, and a real region hit breaks the walk before both
    const bannerSrc = "if (region === 'section_slot' && interior) { showSlotBanner(); return; }";
    const bannerAt = island.indexOf(bannerSrc);
    expect(bannerAt).toBeGreaterThan(-1);
    expect(island.indexOf(fallbackSrc)).toBeGreaterThan(bannerAt);
  });

  it("top bar: publish chip (14 §14.2 count copy), activity chip, site selector chip, one Save", async () => {
    const { html } = await harness();
    expect(html).toContain('id="lg-publish-badge"');
    expect(html).toMatch(/data-publish-verdict="(ok|blocked)"[^>]*>(Ready|Blocked \(\d+ errors?\))/);
    expect(html).toContain("data-quote-activity");
    expect(html).toContain('id="lg-site-select"');
    expect(html).toContain('id="lg-variant-save"');
    expect(html).toContain('data-goto-tab="activation"');
  });

  it("preview site selector (10 §10.5): ALL CMS sites with status badges + the CMS-fallback entry", async () => {
    const { html } = await harness();
    // site-1 has an ENABLED activation row; site-2 has none.
    expect(html).toContain("Site One — Active");
    expect(html).toContain("Site Two — Not activated yet");
    expect(html).toContain(">CMS fallback branding</option>");
    expect(html).toContain('data-badge="Active"');
    expect(html).toContain('data-badge="Not activated yet"');
  });

  it("§10.5 'Activation off' badge renders for a disabled activation row", async () => {
    const h = await studioHarness();
    const off = await admin.request(
      `${API}/quotes/${h.quotePublicId}/activation/site-2`,
      jsonInit("PUT", { enabled: false, slug: "off-slug" }),
      h.env,
    );
    expect(off.status, await off.clone().text()).toBe(200);
    const html = await (await admin.request(`/admin/leadgen/quotes/${h.quotePublicId}/edit`, {}, h.env)).text();
    expect(html).toContain("Site Two — Activation off");
  });
});

// A minimal, balanced slice of the Templates tab panel (from
// `data-panel="templates"` to its matching closing </div>), so a Progress-
// control assertion can never accidentally match a same-named string from a
// sibling tab panel. Test-file-local (this codebase's own convention — no
// shared export exists for it); the identical pattern lives in
// test/leadgen-rework-templates-ui.test.ts (P4/S4.1's own SSR coverage).
function templatesPanelSlice(html: string): string {
  const start = html.indexOf('data-panel="templates"');
  expect(start, "templates panel present").toBeGreaterThan(-1);
  const openTagStart = html.lastIndexOf("<div", start);
  const rest = html.slice(openTagStart);
  const tagRe = /<div\b|<\/div>/g;
  let depth = 0;
  let end = -1;
  for (const match of rest.matchAll(tagRe)) {
    if (match[0] === "<div") depth++;
    else depth--;
    if (depth === 0) { end = openTagStart + (match.index ?? 0) + match[0].length; break; }
  }
  expect(end, "templates panel has a balanced closing </div>").toBeGreaterThan(-1);
  return html.slice(openTagStart, end);
}

// ===========================================================================
// §4.4 — region inspectors, control-by-control (spot asserts)
// ===========================================================================

describeDb("Quote Builder frame studio — §4.4 region inspectors [RETIRED: §8.2/§10; PARTIALLY replaced in Templates tab]", () => {
  // LEADGEN-REWORK-03 P3b RETIREMENT — ALL NINE region-inspector SHELLS below
  // (Header/Progress/Back/Disclosure/Footer/TrustStrip/BenefitBar/Background/
  // SectionSlot + Compatibility) are gone from the funnel-builder tab.
  // Disposition, verified precisely by CALL-SITE grep against
  // quotes-tabs/templates.ts (frameSelect/frameCheck/mediaPickerControl/
  // renderRoleStrip/renderFrameList argument literals — NOT a rendered-
  // attribute-text grep, which under-counts since these are constructed via
  // shared helper functions):
  //   (1) STRUCTURALLY SANCTIONED by §8.2/§10: the funnel-builder tab's right
  //       column is REPURPOSED from "region-settings editor" to "routing
  //       rules" (§8.2 RIGHT) — the click-a-canvas-region-to-edit-it model
  //       this whole panel family depended on cannot exist without the canvas
  //       ("canvas + ALL controllers", §10, explicitly removed).
  //   (2) REPLACEMENT STATUS IN THE TEMPLATES TAB (§8.3), VERIFIED PER GROUP
  //       (grep -oE '"(header|progress|back|disclosure|footer|trust_strip|
  //       benefit_bar|background|section_slot|compat)\.[a-z_.]*"'
  //       quotes-tabs/templates.ts):
  //         Background — FULLY landed: role/image_media_id/style all present
  //           (asserted as a PRESENT replacement below, not a gap).
  //         Header — PARTIALLY landed: logo_source/logo_size/logo_align
  //           present; enabled/tagline/secure_badge.*/cta.*/disclosure_link/
  //           sticky/logo_media_id have NO current surface anywhere.
  //         Footer / Disclosure — a DIFFERENT, redesigned shape is present
  //           (footer.blocks/palette_scope.*/typography_scope.size;
  //           disclosure.entries) — the OLD flat keys this test pinned
  //           (footer.enabled/show_on/links_source; disclosure.enabled/
  //           location/link_label/text) are genuinely gone (not merely
  //           renamed 1:1), so their absence-check stands.
  //         Progress — FULLY landed (P4/S4.1, contract §8.3, merged into this
  //           tree at the P3b union): the Templates tab's NEW box I·Progress
  //           carries all six §8.3 controls (position/align/thickness/width/
  //           color_role/show_label) over the SAME progress.* frame keys,
  //           plus a 5-real-style thumbnail picker (style:'hidden' is a
  //           "Show progress bar" toggle, not a 6th visible style) — asserted
  //           as a PRESENT replacement below, not a gap. This falsified the
  //           P3b-authored "no current admin surface" gap-pin that predated
  //           S4.1 landing in this tree; re-pinned to the new truth here.
  //         Back / TrustStrip / BenefitBar / SectionSlot / Compatibility —
  //           ZERO presence anywhere; a REAL, program-level gap (P4's "after
  //           P3a's split" sequencing has not reached these groups yet).
  //           Flagged prominently in the phase report.
  // Each test below is retained (not deleted) as a verified-absence OR
  // verified-replacement guard so a future P4 landing has a precise,
  // per-group starting point instead of a blanket "everything's missing."
  it("the OLD per-region inspector shells are gone (§8.2/§10 structural — replacement status is per-group, see below)", async () => {
    const { html } = await harness();
    for (const region of ["header", "progress", "back", "disclosure", "footer", "trust_strip", "benefit_bar", "background", "section_slot"]) {
      expect(html, `panel ${region} absent`).not.toContain(`data-region-panel="${region}"`);
    }
  });

  it("Header: logo controls (source/size/align) are landed in the Templates tab; enabled/tagline/CTA/secure-badge/sticky/manual-logo are NOT (see describe-block citation)", async () => {
    const { html } = await harness();
    // still-missing keys (verified absent everywhere)
    for (const key of ["header.enabled", "header.cta.enabled", "header.logo_media_id"]) {
      expect(html, `header control ${key} absent`).not.toContain(`data-frame-key="${key}"`);
    }
    // landed replacement (Templates tab, quotes-tabs/templates.ts frameSelect calls)
    for (const key of ["header.logo_source", "header.logo_size", "header.logo_align"]) {
      expect(html, `header control ${key} landed in Templates tab`).toContain(`data-frame-key="${key}"`);
    }
  });

  it("Progress: landed in the Templates tab's box I (contract §8.3, S4.1 coverage — see describe-block citation), all six controls + the 5-real-style picker via the real rendered panel", async () => {
    const { html } = await harness();
    const panel = templatesPanelSlice(html);
    expect(panel).toContain('data-tplbox-panel="progress"');
    // the 5 real styles (thumbnail radios) + the "hidden" proxy the Show-
    // progress-bar toggle drives (never rendered as a 6th visible thumbnail)
    for (const style of ["bar", "dots", "numbered", "percent", "icon_on_track"]) {
      expect(panel, `progress style option ${style} present`).toContain(`value="${style}" data-frame-key="progress.style"`);
    }
    expect(panel).toContain('id="lg-tpl-progress-hidden-radio"');
    expect(panel).toContain('id="lg-tpl-progress-show-checkbox"');
    // ALL SIX §8.3 controls: Position/Alignment/Thickness/Width/Color/Show label
    for (const key of ["progress.position", "progress.align", "progress.thickness", "progress.width", "progress.show_label"]) {
      expect(panel, `progress control ${key} present`).toContain(`data-frame-key="${key}"`);
    }
    expect(panel).toContain('data-role-strip="progress.color_role"');
  });

  it("Back region-inspector controls have no current admin surface (see describe-block citation)", async () => {
    const { html } = await harness();
    for (const key of ["back.style", "back.position", "back.label"]) {
      expect(html, `back control ${key} absent`).not.toContain(`data-frame-key="${key}"`);
    }
  });

  it("Disclosure region-inspector controls have no current admin surface (see describe-block citation)", async () => {
    const { html } = await harness();
    for (const key of ["disclosure.enabled", "disclosure.location", "disclosure.link_label", "disclosure.text"]) {
      expect(html, `disclosure control ${key} absent`).not.toContain(`data-frame-key="${key}"`);
    }
  });

  it("Footer region-inspector controls have no current admin surface (see describe-block citation)", async () => {
    const { html } = await harness();
    for (const key of ["footer.enabled", "footer.show_on", "footer.links_source"]) {
      expect(html, `footer control ${key} absent`).not.toContain(`data-frame-key="${key}"`);
    }
    expect(html).not.toContain('data-frame-list="footer.links"');
  });

  it("Trust-strip region-inspector controls have no current admin surface (see describe-block citation)", async () => {
    const { html } = await harness();
    for (const key of ["trust_strip.enabled", "trust_strip.source", "trust_strip.placement", "trust_strip.mobile"]) {
      expect(html, `trust control ${key} absent`).not.toContain(`data-frame-key="${key}"`);
    }
    expect(html).not.toContain('data-frame-list="trust_strip.logos"');
  });

  it("Benefit-bar region-inspector controls have no current admin surface (see describe-block citation)", async () => {
    const { html } = await harness();
    for (const key of ["benefit_bar.enabled", "benefit_bar.placement"]) {
      expect(html, `benefit control ${key} absent`).not.toContain(`data-frame-key="${key}"`);
    }
    expect(html).not.toContain('data-frame-list="benefit_bar.items"');
  });

  // CORRECTION: Background is the ONE group FULLY landed in the Templates
  // tab already (the contract's §10 text explicitly named ONLY "funnel-layout
  // Background inspector" for removal — consistent with Background's
  // replacement having landed in the SAME coordinated effort). This is a
  // verified PRESENT-elsewhere proof, not a gap.
  it("Background: role/image/style controls are FULLY landed in the Templates tab (§10's one explicitly-named region, not a gap)", async () => {
    const { html } = await harness();
    expect(html).toContain('data-role-strip="background.role"');
    expect(html).toContain('data-frame-key="background.image_media_id"');
    expect(html).toContain('data-frame-key="background.style"');
  });

  it("Section-slot region-inspector controls have no current admin surface (see describe-block citation)", async () => {
    const { html } = await harness();
    for (const key of ["section_slot.max_width", "section_slot.card", "section_slot.continue_placement"]) {
      expect(html, `slot control ${key} absent`).not.toContain(`data-frame-key="${key}"`);
    }
  });

  it("Compatibility (C2) region-inspector controls have no current admin surface (see describe-block citation)", async () => {
    const { html } = await harness();
    expect(html).not.toContain("data-region-panel-compat");
    expect(html).not.toContain('data-frame-key="compat.allow_section_chrome"');
  });
});

// ===========================================================================
// 09 §9.3 — theme editor
// ===========================================================================

describeDb("Quote Builder frame studio — theme editor (09 §9.3)", () => {
  it("renders all 14 role rows: swatch + label + 'Used by' + inheritance source + reset", async () => {
    const { html } = await harness();
    const roles = [
      "brand_primary", "brand_secondary", "accent", "success", "error", "page_background",
      "card_background", "surface_wash", "border", "text_primary", "text_muted",
      "button_primary_bg", "button_primary_text", "button_secondary_bg",
    ];
    for (const role of roles) {
      expect(html, `theme role ${role}`).toContain(`data-theme-role="${role}"`);
      expect(html, `reset ${role}`).toContain(`data-role-reset="${role}"`);
    }
    expect((html.match(/data-theme-role="/g) ?? []).length).toBe(14);
    expect(html).toContain("Used by: buttons, progress fill, selected borders, logo text");
    expect(html).toContain("data-role-source");
    expect(html).toContain(">Base design</span>");
  });

  it("typography, scales, button + card default controls (curated closed sets)", async () => {
    const { html } = await harness();
    for (const key of [
      "typography.display", "typography.body", "typography.size",
      "scales.spacing", "scales.radius", "scales.shadow",
      "button_defaults.radius", "button_defaults.min_height", "button_defaults.casing",
      "card_defaults.radius", "card_defaults.shadow",
    ]) {
      expect(html, `theme control ${key}`).toContain(`data-theme-key="${key}"`);
    }
    for (const strip of [
      "theme:button_defaults.background_role", "theme:button_defaults.text_role",
      "theme:card_defaults.background_role", "theme:card_defaults.border_role",
    ]) {
      expect(html, `theme strip ${strip}`).toContain(`data-role-strip="${strip}"`);
    }
    expect(html).toContain(">Literata</option>");
    expect(html).toContain(">Roomy</option>");
    expect(html).toContain(">Round</option>");
  });

  it("custom hex ONLY inside the collapsed 'Advanced token administration' with the exact warning copy; live mini-preview strip present", async () => {
    const { html } = await harness();
    expect(html).toContain('id="lg-theme-advanced"');
    expect(html).toContain("Advanced token administration");
    expect(html).toContain("Custom colors skip the design system &#8212; check contrast.");
    expect(html).toContain('id="lg-theme-hex-role"');
    expect(html).toContain('id="lg-theme-hex-value"');
    expect(html).toContain('id="lg-theme-minipreview"');
    // the hex input sits INSIDE the Advanced details element
    const advanced = html.slice(html.indexOf('id="lg-theme-advanced"'));
    expect(advanced.slice(0, advanced.indexOf("</details>"))).toContain('id="lg-theme-hex-value"');
  });
});

// ===========================================================================
// §4.5 variant overrides + Rules surface + blob/hex/ES5 lints
// ===========================================================================

describeDb("Quote Builder frame studio — overrides, Rules mount, lint legs", () => {
  it("control arm: no override switches; forked arm: 'Same as funnel / Override for this variant' per region group + A/B tab per-arm listing", async () => {
    const h = await studioHarness();
    // control variant page (default) → no SSR'd switches (the ="…" attribute
    // form is SSR-only; the island script references the bare selector name)
    expect(h.html).not.toContain('data-override-switch="');
    expect(h.html).not.toContain('data-override-group="');
    expect(h.html).toContain("data-arm-overrides");
    expect(h.html).toContain("Same layout as funnel (no overrides)");

    // fork → non-control arm with stored overrides. Rework M1 (§4.3-10):
    // forkVariantHandler now unconditionally refuses a 2nd active variant —
    // archiving the source first is the minimal way to still exercise the
    // real fork endpoint (this test's point is the FORKED page's rendering,
    // not fork's own guard).
    h.sdb.prepare("UPDATE leadgen_funnel_variants SET status = 'archived' WHERE public_id = ?").run(h.variantId);
    const fork = await admin.request(`${API}/variants/${h.variantId}/fork`, { method: "POST" }, h.env);
    expect(fork.status, await fork.clone().text()).toBe(201);
    const forked = (await fork.json()) as { public_id: string };
    const put = await admin.request(
      `${API}/variants/${forked.public_id}`,
      jsonInit("PUT", { frame_overrides_json: { progress: { style: "dots" } } }),
      h.env,
    );
    expect(put.status, await put.clone().text()).toBe(200);
    const html2 = await (
      await admin.request(`/admin/leadgen/quotes/${h.quotePublicId}/edit?variant=${forked.public_id}`, {}, h.env)
    ).text();
    // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10 + P4 sequencing, same
    // disposition as the §4.4 region-inspectors describe block above): the
    // PROGRESS region's override switch (renderOverrideSwitch("progress",…),
    // called from the now-deleted renderProgressInspector) has no current
    // admin surface. The GENERIC "Same as funnel (default)"/"Override for
    // this variant" copy and the switch mechanism itself are UNCHANGED and
    // still verified below via the THEME group (themes.ts still calls
    // renderOverrideSwitch("theme", …), untouched by this rebuild).
    expect(html2).not.toContain('data-override-switch="progress"');
    // theme override switch in the theme editor still renders (untouched)
    expect(html2).toContain('data-override-switch="theme"');
    expect(html2).toContain("Same as funnel (default)");
    expect(html2).toContain("Override for this variant");
    // the canvas override badge shell is gone with the canvas (§8.2/§10)
    expect(html2).not.toContain('id="lg-override-badge"');
    // A/B tab's overridden-group label (ab.ts overriddenGroupLabels) reads
    // frame_overrides_json DIRECTLY — set via the API PUT above, independent
    // of any funnel-tab UI — so the ORIGINAL, stronger assertion still holds
    // unchanged: ab.ts is untouched by this rebuild.
    expect(html2).toMatch(/data-arm-overrides="[^"]+">Funnel-layout overrides: Progress</);
  });

  // LEADGEN-REWORK-03 M3/§13-D5 RETIREMENT: the LEGACY persistent B3
  // condition-cluster builder mount (id="lg-rules-builder-root", a
  // PERSISTENT always-in-DOM root the OLD renderRulesPanel embedded via
  // renderRulesBuilderPanel) is gone — the §8.2 RIGHT rail's NEW rule modal
  // (S3b.2, ui-rules-builder.ts renderQuoteRulesRail) mounts window.
  // lgRulesBuilder DYNAMICALLY, scoped per-rule, only while its modal is
  // open (no persistent root at all). RULES_BUILDER_SCRIPT (the
  // window.lgRulesBuilder library itself) is STILL bundled — it is a
  // documented REQUIRED dependency of the new rail's modal, per
  // renderQuoteRulesRail's own doc comment. Replacement coverage:
  // test/leadgen-rework-rules-ui.test.ts (S3b.2's own SSR/ES5 proofs) +
  // test-ui/leadgen-rework-p3b-rules.gesture.spec.ts.
  it("the OLD persistent B3 rules-builder mount is gone (M3/§13-D5: the §8.2 rail mounts it dynamically instead)", async () => {
    const { html } = await harness();
    expect(html).not.toContain('id="lg-rules-builder-root"');
    expect(html).not.toContain('data-target-input="lg-rule-conditions"');
    expect(html).toContain('id="lg-qr-rail"');
  });

  it("JSON data blobs are `<`-escaped (quote data + the §8.2 rail's data)", async () => {
    const h = await studioHarness();
    // hostile name flows into the quote blob
    const hostile = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "</script><img src=x>", activity: "quote_funnel", verticals: ["life"] }),
      h.env,
    );
    expect(hostile.status).toBe(201);
    const hq = (await hostile.json()) as QuoteDetail;
    const html = await (await admin.request(`/admin/leadgen/quotes/${hq.public_id}/edit`, {}, h.env)).text();
    // P3b RETIREMENT: id="lg-rules-builder-data" was the OLD persistent B3
    // mount's own blob (gone with it, see the test above); id="lg-qr-data"
    // is the §8.2 rail's own JSON blob (renderQuoteRulesRail) — the SAME
    // `<`-escaping guarantee, proven against its real replacement.
    for (const blobId of ["lg-quote-data", "lg-qr-data"]) {
      const at = html.indexOf(`id="${blobId}"`);
      expect(at, `${blobId} present`).toBeGreaterThan(-1);
      const body = html.slice(html.indexOf(">", at) + 1, html.indexOf("</script>", at));
      expect(body, `${blobId} < escaped`).not.toContain("<");
      expect(JSON.parse(body), `${blobId} parses`).toBeTruthy();
    }
  });

  it("no hex color TEXT outside Advanced-marked containers in normal-mode SSR (09 §9.6 first leg)", async () => {
    const { html } = await harness();
    // strip non-normal surfaces: scripts (incl. JSON blobs), styles, and
    // Advanced-marked <details class="lg-advanced"> containers; then strip
    // all remaining tags and scan the visible TEXT for hex literals.
    const withoutScripts = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<details class="lg-advanced"[\s\S]*?<\/details>/gi, " ");
    const text = withoutScripts.replace(/<[^>]*>/g, " ");
    // (?<!&) — numeric character references (&#8212; …) are not hex colors
    expect(text).not.toMatch(/(?<!&)#[0-9a-fA-F]{3,8}\b/);
  });
});

// ===========================================================================
// DEV-60 Phase C polish — media pickers · icon dropdown · inline rename ·
// drag handles · §9.3 harmonies + preset-backed mini preview
// ===========================================================================

describeDb("Quote Builder studio — DEV-60 Phase C polish", () => {
  // LEADGEN-REWORK-03 P3b RETIREMENT + CORRECTION (§8.2/§10 + P4 sequencing,
  // same disposition as the §4.4 region-inspectors describe block):
  // header.logo_media_id (the MANUAL-logo override, distinct from the
  // logo_source/size/align landed above) lived in the now-deleted Header
  // inspector and has no current admin surface anywhere.
  // background.image_media_id is NOT checked here — it IS present, via the
  // Templates tab (see the "Background: … FULLY landed" test above).
  // The bare data-list-field="media_id" attribute is ALSO NOT checked here:
  // it is a GENERIC marker mediaFieldMarkup emits for EVERY media-kind list
  // field, and templates.ts's OWN "Brand logos"/"Images" boxes use the
  // IDENTICAL attribute for an unrelated feature (verified via grep) — so a
  // bare substring check can't isolate "the trust-strip's copy" from "some
  // other box's copy" one way or the other; asserting either presence or
  // absence here would be a false claim. The shared media-picker MECHANISM
  // itself (the modal, data-media-choose/-thumb/-clear affordance shell) is
  // UNTOUCHED and still SSRs once — proven by the very next test ("the
  // shared Media-library chooser SSRs once…", unaffected, still passing).
  it("Header's manual-logo media-picker field has no current admin surface (see §4.4 describe-block citation)", async () => {
    const { html } = await harness();
    expect(html).not.toContain('<input type="hidden" data-frame-key="header.logo_media_id"');
  });

  it("(a) the shared Media-library chooser SSRs once; the island reuses the EXISTING media endpoints (list + upload) — no new API surface", async () => {
    const { html } = await harness();
    expect((html.match(/id="lg-media-picker"/g) ?? []).length).toBe(1);
    expect(html).toContain('id="lg-media-picker-grid"');
    expect(html).toContain('id="lg-media-upload-file"');
    expect(html).toContain('id="lg-media-upload-btn"');
    expect(html).toContain('id="lg-media-picker-close"');
    const script = extractScripts(html).join("\n");
    expect(script).toContain("'/api/admin/media'");
    expect(script).toContain("'/api/admin/media/upload'");
  });

  // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10 + P4 sequencing): the
  // benefit-bar icon dropdown lived INSIDE the now-deleted Benefit-bar region
  // inspector (see the §4.4 describe-block citation above). BENEFIT_BAR_ICONS
  // itself (the curated closed vocabulary) is UNCHANGED and still exported.
  it("the OLD benefit-bar icon dropdown has no current admin surface (see §4.4 describe-block citation)", async () => {
    const { html } = await harness();
    expect(html).not.toMatch(/<select class="form-select" data-list-field="icon"/);
    expect(BENEFIT_BAR_ICONS.length).toBeGreaterThan(0);
  });

  it("(b) quote-name inline edit: pencil affordance beside the title + editor controls; the island saves via the real rename PATCH", async () => {
    const { html } = await harness();
    expect(html).toMatch(/<h2 class="lg-editor-title" id="lg-quote-title">Studio Quote<\/h2>/);
    expect(html).toContain('id="lg-quote-rename"');
    expect(html).toContain('aria-label="Rename this quote"');
    expect(html).toContain('id="lg-quote-rename-input"');
    expect(html).toContain('id="lg-quote-rename-save"');
    expect(html).toContain('id="lg-quote-rename-cancel"');
    const script = extractScripts(html).join("\n");
    expect(script).toContain("method: 'PATCH'");
    expect(script).toContain("quote_name: name");
  });

  // LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§9 DELIBERATE mechanism change,
  // not a gap): the OLD structure panel's per-row native-HTML5-DnD drag
  // handles (draggable="true" + dragstart/dragover/drop/dragend) are GONE
  // along with the structure panel itself — replaced by the board's in-house
  // MOUSE-EVENT drag engine (§9: "in-house engine over SortableJS", the SAME
  // U13/studio pointer-drag pattern this rebuild reuses, NOT native HTML5
  // DnD). The board's chip/page menus (data-menu-action="chip-up"/"chip-
  // down"/"page-up"/"page-down") are the keyboard-accessible a11y path,
  // proven by test/leadgen-rework-board.test.ts ("menus present…") + the
  // gesture spec's real mouse-drag journeys.
  it("the OLD native-HTML5-DnD drag handles are gone (§8.2/§9: replaced by the in-house mouse engine, not native DnD)", async () => {
    const { html } = await harness();
    // NOTE: bare "data-move-up"/"data-move-down" substrings are NOT checked
    // here — the shared island still carries dead
    // el.hasAttribute('data-move-up') JS references (P5 orphan-scan territory,
    // unreachable since the rendering that created those attributes is
    // gone), which would false-positive a bare substring check. The rendered
    // TAG form (renderSectionRow's own markup) is fully deleted, so there is
    // no rendered form left to search for either way.
    expect(html).not.toContain('data-drag-handle draggable="true"');
    expect(html).toContain('data-menu-action="chip-up"');
    expect(html).toContain('data-menu-action="chip-down"');
  });

  it("(d) §9.3 harmonies: every role edit offers base/wash/darker/lighter steps as LABELS (chips painted client-side; base writes the ROLE alias, derived steps route through the Advanced hex path)", async () => {
    const { html } = await harness();
    const roleCount = 14;
    expect((html.match(/data-harmony-row="/g) ?? []).length).toBe(roleCount);
    for (const step of ["base", "wash", "darker", "lighter"]) {
      expect((html.match(new RegExp(`data-harmony-step="${step}"`, "g")) ?? []).length, `step ${step}`).toBe(roleCount);
    }
    expect(html).toContain(">Base</button>");
    expect(html).toContain("Soft wash</button>");
    expect(html).toContain("Darker</button>");
    expect(html).toContain("Lighter</button>");
    // the island derives from the BASE design's tokens (SSR blob carries them)
    const blobAt = html.indexOf('id="lg-quote-data"');
    const blob = JSON.parse(html.slice(html.indexOf(">", blobAt) + 1, html.indexOf("</script>", blobAt))) as {
      base_tokens?: Record<string, string>;
    };
    expect(Object.keys(blob.base_tokens ?? {}).length).toBe(roleCount);
    const script = extractScripts(html).join("\n");
    expect(script).toContain("applyPaletteValue(role, role)"); // base = the role-VALUE alias
    expect(script).toContain("applyAdvancedHex()"); // derived = the Advanced custom-color path
  });

  it("(d) mini preview is preset-backed: iframe mount wired to the SAME preview endpoint in frame-only mode; hand-rolled spans gone", async () => {
    const { html } = await harness();
    expect(html).toContain('id="lg-theme-minipreview"');
    expect(html).toContain('data-mini-preview-mode="frame"');
    expect(html).toContain('id="lg-theme-minipreview-frame"');
    expect(html).not.toContain("data-mini-button");
    expect(html).not.toContain("data-mini-card");
    expect(html).not.toContain("data-mini-input");
    expect(html).not.toContain("data-mini-progress");
    const script = extractScripts(html).join("\n");
    expect(script).toContain("function previewUrl()"); // ONE endpoint constant serves canvas + mini
    expect(script).toContain("function renderMiniPreview()");
    expect(script).toContain("scheduleMiniPreview");
    expect(script).toContain("data-mini-preview-mode");
  });
});

// ===========================================================================
// ES5-only inline scripts (token scan + node --check) — the studio island
// ===========================================================================

const SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

function extractScripts(html: string): string[] {
  const blocks: string[] = [];
  for (const match of html.matchAll(SCRIPT_RE)) {
    if ((match[0] ?? "").includes('type="application/json"')) continue; // data blob, not a script
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

const scratchDir = mkdtempSync(join(tmpdir(), "leadgen-quote-builder-parse-"));
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

describeDb("Quote Builder studio — ES5-only inline scripts", () => {
  it("every inline <script> is ES5 (no arrow/const/let/async/await/backtick) and parses standalone", async () => {
    const { html } = await harness();
    const scripts = extractScripts(html);
    expect(scripts.length, "studio page must ship inline scripts").toBeGreaterThan(0);
    const errors: string[] = [];
    scripts.forEach((script, i) => {
      expect(script, `script ${i + 1} arrow`).not.toMatch(/=>/);
      expect(script, `script ${i + 1} const`).not.toMatch(/\bconst\b/);
      expect(script, `script ${i + 1} let`).not.toMatch(/\blet\b/);
      expect(script, `script ${i + 1} async`).not.toMatch(/\basync\b/);
      expect(script, `script ${i + 1} await`).not.toMatch(/\bawait\b/);
      expect(script, `script ${i + 1} backtick`).not.toContain("`");
      const err = parseError(`studio-script${i + 1}`, script);
      if (err) errors.push(err);
    });
    expect(errors, errors.join("\n\n")).toEqual([]);
  });
});

// ===========================================================================
// GET /funnels/:id/frame?switch_to=<id> — the read-only C5 switch leg
// ===========================================================================

describeDb("GET /funnels/:id/frame?switch_to (04 §4.3, C5)", () => {
  it("returns {merged, confirmations} for a content-rich stored config and persists NOTHING", async () => {
    const h = await studioHarness();
    // store a frame with content the switch classes act on
    const stored = {
      version: 1,
      template: "centered",
      header: { tagline: "Trusted", logo_align: "left" },
      trust_strip: {
        enabled: true,
        logos: [
          { media_id: "logos/a.png", alt: "A" },
          { media_id: "logos/b.png", alt: "B" },
        ],
      },
    };
    const putRes = await admin.request(
      `${API}/funnels/${h.funnelPublicId}/frame`,
      jsonInit("PUT", { frame_config_json: stored }),
      h.env,
    );
    expect(putRes.status, await putRes.clone().text()).toBe(200);

    const res = await admin.request(`${API}/funnels/${h.funnelPublicId}/frame?switch_to=minimal`, {}, h.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { merged: Record<string, unknown>; confirmations: string[] };
    // merged: operator content preserved, layout dropped, target template set
    expect(body.merged["template"]).toBe("minimal");
    expect((body.merged["header"] as Record<string, unknown>)["tagline"]).toBe("Trusted");
    expect((body.merged["header"] as Record<string, unknown>)["logo_align"]).toBeUndefined();
    // trust strip unsupported on minimal → enabled dropped, logos kept inert
    const trust = body.merged["trust_strip"] as Record<string, unknown>;
    expect(trust["enabled"]).toBeUndefined();
    expect((trust["logos"] as unknown[]).length).toBe(2);
    // confirmations name what stops rendering (§4.3 a-class line)
    expect(body.confirmations.join(" ")).toContain("Trust strip isn't part of 'minimal'");
    expect(body.confirmations.join(" ")).toContain("logos are kept but won't show");

    // READ-ONLY: the stored column is untouched
    const after = await admin.request(`${API}/funnels/${h.funnelPublicId}/frame`, {}, h.env);
    const afterBody = (await after.json()) as { frame_config: Record<string, unknown> };
    expect(afterBody.frame_config["template"]).toBe("centered");
    expect((afterBody.frame_config["trust_strip"] as Record<string, unknown>)["enabled"]).toBe(true);
  });

  it("unknown switch_to falls back to 'centered' with an explanatory confirmation; empty switch_to takes the normal GET", async () => {
    const h = await studioHarness();
    const res = await admin.request(`${API}/funnels/${h.funnelPublicId}/frame?switch_to=nope`, {}, h.env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { merged: Record<string, unknown>; confirmations: string[] };
    expect(body.merged["template"]).toBe("centered");
    expect(body.confirmations.join(" ")).toContain("isn't available any more");

    const plain = await admin.request(`${API}/funnels/${h.funnelPublicId}/frame?switch_to=`, {}, h.env);
    const plainBody = (await plain.json()) as Record<string, unknown>;
    expect(plainBody["effective_frame"]).toBeDefined();
    expect(plainBody["merged"]).toBeUndefined();
  });
});

// ===========================================================================
// 14 §14.2 (C2 LIVE, Phase D) — the Activation tab surfaces problems[] grouped
// by scope with severity chips + fix_url deep links; blocked ⇔ the activation
// PUT would 409 (blocks OR any error-severity problem). SSR legs here; the
// EXECUTED island legs (activation 409 → grouped re-render) live in
// leadgen-quote-builder-seam.test.ts.
// ===========================================================================

describeDb("Activation tab problems[] surfacing (14 §14.2, C2 LIVE)", () => {
  // A section carrying a frame-scope node (StepIndicator) — the C2 offender.
  function seedChromeSection(sdb: SqliteDb, name: string): { id: number; public_id: string } {
    const publicId = mintPublicId("section");
    const content = JSON.stringify({
      components: [
        { type: "StepIndicator", question_id: "si1", props: { steps: 3, current: 1 } },
        { type: "QuestionHeadline", question_id: "h1", props: { text: "Where?" } },
        { type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "f1", answer_type: "boolean" },
      ],
    });
    sdb
      .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 'active')")
      .run(publicId, name, "Headline", content);
    const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
    return { id: row.id, public_id: publicId };
  }

  async function chromeHarness(compatOn: boolean): Promise<{ html: string; chromePublicId: string }> {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    const env = buildEnv(d1FromSqlite(sdb));
    const create = await admin.request(
      `${API}/quotes`,
      jsonInit("POST", { quote_name: "Chrome Quote", activity: "quote_funnel", verticals: ["life"] }),
      env,
    );
    expect(create.status, `create quote: ${await create.clone().text()}`).toBe(201);
    const q = (await create.json()) as QuoteDetail;
    const variantId = q.funnels[0]!.variants[0]!.public_id;
    const funnelPublicId = q.funnels[0]!.public_id;
    const chrome = seedChromeSection(sdb, "Chrome slide");
    const put = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", { sections: [{ section_id: chrome.id }] }),
      env,
    );
    expect(put.status, `seed variant: ${await put.clone().text()}`).toBe(200);
    seedSharedPageSection(sdb, q.id);
    // Configure the frame through the REAL PUT (compat defaults OFF).
    const frame = await admin.request(
      `${API}/funnels/${funnelPublicId}/frame`,
      jsonInit("PUT", {
        frame_config_json: compatOn
          ? { version: 1, template: "centered", compat: { allow_section_chrome: true } }
          : { version: 1, template: "centered" },
      }),
      env,
    );
    expect(frame.status, `frame put: ${await frame.clone().text()}`).toBe(200);
    const page = await admin.request(`/admin/leadgen/quotes/${q.public_id}/edit`, {}, env);
    expect(page.status).toBe(200);
    return { html: await page.text(), chromePublicId: chrome.public_id };
  }

  it("compat OFF: the panel SSRs BLOCKED with the section-scope error group, severity chip, §14.1 copy and the Review-slide fix link; chip says Blocked", async () => {
    const { html, chromePublicId } = await chromeHarness(false);
    // blocked state — an error-severity problem alone blocks (zero blocks).
    expect(html).toContain('data-preflight-state="blocked"');
    expect(html).toContain("Cannot activate this Quote.");
    // the problems wrap + the section-scope group with its operator label
    expect(html).toContain('id="lg-preflight-problems"');
    expect(html).toContain('data-problem-scope="section"');
    expect(html).toContain(">Slides</h4>");
    // the §14.1 row: severity chip + copy + path identity
    expect(html).toContain('data-problem-severity="error"');
    expect(html).toContain('data-severity="error"');
    expect(html).toContain(`data-problem-path="section.${chromePublicId}.content"`);
    expect(html).toContain("contains funnel-layout elements"); // MAJOR-1: renamed from "page-frame elements"
    expect(html).toContain("render twice");
    // §14.1 full copy: the [Move to funnel layout] remedy SSRs in the message
    // ("slide"/"[Move to funnel layout]" are Quote-Builder activation copy —
    // legal vocabulary on this surface per the C6 glossary scope). U15
    // fix-round (2026-07-15): renamed from "[Move to Quote frame]".
    expect(html).toContain("[Move to funnel layout] in the Section Builder");
    // the fix_url deep link with the derived label
    expect(html).toContain(`href="/admin/leadgen/sections/${chromePublicId}/edit"`);
    expect(html).toContain(">Review slide</a>");
    // the head publish chip mirrors the verdict (counts include the error)
    expect(html).toMatch(/data-publish-verdict="blocked"[^>]*>Blocked \(\d+ errors?\)/);
  });

  it("compat ON: the SAME chrome downgrades to a warning — panel PASS + warning group; chip says Ready (N warnings)", async () => {
    const { html, chromePublicId } = await chromeHarness(true);
    expect(html).toContain('data-preflight-state="pass"');
    expect(html).toContain("Ready to activate — all preflight checks pass.");
    // the warnings still surface, grouped by scope with their fix links
    expect(html).toContain('id="lg-preflight-problems"');
    expect(html).toContain('data-problem-severity="warning"');
    expect(html).toContain("Legacy override is ON");
    expect(html).toContain(`href="/admin/leadgen/sections/${chromePublicId}/edit"`);
    // no error-severity rows anywhere
    expect(html).not.toContain('data-problem-severity="error"');
    expect(html).toMatch(/data-publish-verdict="ok"[^>]*>Ready \(\d+ warnings?\)/);
  });

  it("clean quote: no problems wrap at all — the v2.4 pass panel is byte-unchanged", async () => {
    const { html } = await harness(); // the clean cached harness
    expect(html).toContain('data-preflight-state="pass"');
    expect(html).not.toContain('id="lg-preflight-problems"');
  });
});

// ===========================================================================
// DEV-66 routing (Phase D) — the Quote-Builder canvas mobile toggle drives a
// REAL iframe: SSR ships the canvas as <iframe id="lg-preview-iframe"> (srcdoc
// island contract) + both viewport buttons; the EXECUTED 375px-width +
// media-query legs live in leadgen-quote-builder-seam.test.ts.
// ===========================================================================

// LEADGEN-REWORK-03 P3b RETIREMENT (§8.2/§10): "canvas + ALL controllers
// (Template/Theme/Desktop/Mobile/Current-slide/Step-through)" is the
// contract's own verbatim removal text — the entire DEV-66 mobile-canvas
// mechanism (the srcdoc iframe + its 1280/375 viewport toggle) is gone with
// it. The board's OWN 1280/375 responsive proof is a DIFFERENT mechanism
// (the admin page itself, not a canvas iframe) — pinned by
// test-ui/leadgen-rework-p3b-board.gesture.spec.ts's "board renders library /
// board / rules-mount + responsive screenshots (1280 & 375)" test (both
// widths, no page-body horizontal scroll).
describeDb("Quote Builder canvas mobile = real 375 iframe [RETIRED: §8.2/§10, canvas removed]", () => {
  it("the OLD canvas iframe + viewport toggle are gone (§8.2/§10)", async () => {
    const { html } = await harness();
    expect(html).not.toMatch(/<iframe id="lg-preview-iframe"/);
    expect(html).not.toContain('data-viewport-btn="mobile"');
  });
});
