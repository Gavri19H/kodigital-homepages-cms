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
//     switch leg: {merged, confirmations}, nothing persisted.

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
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
  "0040_leadgen_runtime_context.sql",
  "0041_leadgen_frame_theme.sql",
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
  public_id: string;
  funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
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
  it("renders the studio grid: structure panel, canvas mount, inspector column", async () => {
    const { html } = await harness();
    expect(html).toContain('id="lg-frame-studio"');
    expect(html).toContain('id="lg-structure-panel"');
    expect(html).toContain('id="lg-canvas-toolbar"');
    expect(html).toContain('id="lg-preview-iframe"');
    expect(html).toContain('sandbox="allow-same-origin"');
    expect(html).toContain('id="lg-inspector-column"');
    expect(html).toContain('id="lg-inspector-hint"');
  });

  it("left structure panel: ordered slides (name/vertical/reorder/remove), add picker, mapping dot, slide-vocabulary auction marker", async () => {
    const { html } = await harness();
    expect(html).toContain('id="lg-section-list"');
    expect(html).toContain('id="lg-add-section"');
    expect(html).toContain("data-select-slide");
    expect(html).toContain("data-move-up");
    expect(html).toContain("data-move-down");
    expect(html).toContain("data-remove-section");
    expect(html).toContain('data-mapping-status="unknown"');
    // §2.4: "slide" is Quote-Builder vocabulary; the §15.3 max-position rule
    // keeps exactly one marker.
    expect(html).toContain("Auction runs after this slide");
    expect((html.match(/data-auction-entry="1"/g) ?? []).length).toBe(1);
    // A/B switcher + Rules link out of the structure panel
    expect(html).toContain('data-goto-tab="ab"');
    expect(html).toContain('data-goto-tab="rules"');
  });

  it("canvas toolbar: template picker, theme button, 1280/375 toggle, current-slide/all-slides modes, stepper, site + variant mirrors", async () => {
    const { html } = await harness();
    expect(html).toContain('id="lg-template-btn"');
    expect(html).toContain('id="lg-theme-btn"');
    expect(html).toContain('data-viewport-btn="desktop"');
    expect(html).toContain('data-viewport-btn="mobile"');
    expect(html).toContain("Desktop 1280");
    expect(html).toContain("Mobile 375");
    expect(html).toContain('data-preview-mode-btn="section"');
    expect(html).toContain('data-preview-mode-btn="all"');
    expect(html).toContain("Current slide");
    expect(html).toContain("Step through all slides");
    expect(html).toContain('id="lg-step-prev"');
    expect(html).toContain('id="lg-step-next"');
    expect(html).toContain('id="lg-canvas-site-select"');
    expect(html).toContain('id="lg-canvas-variant-select"');
  });

  it("template picker: one thumbnail card per registry template + the C5 confirm dialog shell", async () => {
    const { html } = await harness();
    for (const id of ["centered", "header-footer", "header-cta", "full-background", "white-trust", "minimal"]) {
      expect(html, `template card ${id}`).toContain(`data-template-pick="${id}"`);
      expect(html, `template thumb ${id}`).toContain(`data-template-thumb="${id}"`);
    }
    expect(html).toContain('id="lg-template-confirm"');
    expect(html).toContain('id="lg-template-apply"');
    expect(html).toContain('id="lg-template-cancel"');
  });

  it("section-slot interior banner: exact §4.1 copy + Open Section affordance", async () => {
    const { html } = await harness();
    expect(html).toContain('id="lg-slot-banner"');
    expect(html).toContain("This area is the Section&#8217;s question unit &#8212; edit it in the Section Builder");
    expect(html).toContain('id="lg-slot-banner-open"');
    expect(html).toContain(">Open Section</a>");
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

// ===========================================================================
// §4.4 — region inspectors, control-by-control (spot asserts)
// ===========================================================================

describeDb("Quote Builder frame studio — §4.4 region inspectors", () => {
  it("renders one inspector shell per clickable region with the §7.1 scope header", async () => {
    const { html } = await harness();
    for (const region of ["header", "progress", "back", "disclosure", "footer", "trust_strip", "benefit_bar", "background", "section_slot"]) {
      expect(html, `panel ${region}`).toContain(`data-region-panel="${region}"`);
    }
    // §7.1 scope-header pattern (frame-region example, verbatim shape)
    expect(html).toContain("Editing: <strong>Funnel frame — Progress</strong>");
    expect(html).toContain("Editing: <strong>Funnel frame — Footer</strong>");
    expect(html).toMatch(/Editing: <strong>Funnel frame — [^<]+<\/strong>[^·]*· affects every slide of this funnel/);
  });

  it("Header: on/off, logo source (site/CMS fallback), size, alignment, tagline, secure badge, call CTA (label+tel+href), disclosure link, sticky + Advanced-gated manual logo w/ warning", async () => {
    const { html } = await harness();
    for (const key of [
      "header.enabled", "header.logo_source", "header.logo_size", "header.logo_align", "header.tagline",
      "header.secure_badge.enabled", "header.secure_badge.text",
      "header.cta.enabled", "header.cta.label", "header.cta.tel", "header.cta.href",
      "header.disclosure_link", "header.sticky", "header.logo_media_id",
    ]) {
      expect(html, `header control ${key}`).toContain(`data-frame-key="${key}"`);
    }
    expect(html).toContain(">Site logo (auto)</option>");
    expect(html).toContain(">CMS fallback</option>");
    expect(html).toContain("data-manual-logo");
    expect(html).toContain("Manual logo overrides site branding.");
  });

  it("Progress: 5 visual style radios, position, thickness, width, color role swatches, show label + the automatic-count note", async () => {
    const { html } = await harness();
    for (const style of ["hidden", "bar", "dots", "numbered", "percent"]) {
      expect(html, `progress style ${style}`).toContain(`name="lg-progress-style" value="${style}"`);
    }
    for (const key of ["progress.position", "progress.thickness", "progress.width", "progress.show_label"]) {
      expect(html, `progress control ${key}`).toContain(`data-frame-key="${key}"`);
    }
    expect(html).toContain('data-role-strip="progress.color_role"');
    expect(html).toContain("Progress counts the slides of this funnel variant automatically.");
  });

  it("Back: style, position, label + the first-slide note", async () => {
    const { html } = await harness();
    for (const key of ["back.style", "back.position", "back.label"]) {
      expect(html, `back control ${key}`).toContain(`data-frame-key="${key}"`);
    }
    expect(html).toContain("Hidden automatically on the first slide.");
  });

  it("Disclosure: on/off, location, link label, panel textarea", async () => {
    const { html } = await harness();
    for (const key of ["disclosure.enabled", "disclosure.location", "disclosure.link_label", "disclosure.text"]) {
      expect(html, `disclosure control ${key}`).toContain(`data-frame-key="${key}"`);
    }
  });

  it("Footer: on/off, show-on, links source (site/manual), manual links editor, trust text, description, show logo, hide on mobile", async () => {
    const { html } = await harness();
    for (const key of [
      "footer.enabled", "footer.show_on", "footer.links_source",
      "footer.trust_text", "footer.description", "footer.show_logo", "footer.hide_on_mobile",
    ]) {
      expect(html, `footer control ${key}`).toContain(`data-frame-key="${key}"`);
    }
    expect(html).toContain('data-frame-list="footer.links"');
    expect(html).toContain('data-add-list-row="footer.links"');
    expect(html).toContain(">From site settings</option>");
    expect(html).toContain(">Manual list</option>");
  });

  it("Trust strip (C7 'funnel-wide'): on/off, source, logo rows w/ REQUIRED alt, placement, mobile behavior", async () => {
    const { html } = await harness();
    for (const key of ["trust_strip.enabled", "trust_strip.source", "trust_strip.placement", "trust_strip.mobile"]) {
      expect(html, `trust control ${key}`).toContain(`data-frame-key="${key}"`);
    }
    expect(html).toContain('data-frame-list="trust_strip.logos"');
    expect(html).toContain('data-list-field="alt"');
    expect(html).toContain("Alt text (required)");
    // C7: the trust-strip scope header carries the funnel-wide chip
    expect(html).toMatch(/Funnel frame — Trust strip<\/strong><span class="lg-scope-chip">funnel-wide<\/span>/);
  });

  it("Benefit bar (C7 'funnel-wide'): on/off, item rows (icon+text), placement", async () => {
    const { html } = await harness();
    for (const key of ["benefit_bar.enabled", "benefit_bar.placement"]) {
      expect(html, `benefit control ${key}`).toContain(`data-frame-key="${key}"`);
    }
    expect(html).toContain('data-frame-list="benefit_bar.items"');
    expect(html).toContain('data-list-field="icon"');
    expect(html).toMatch(/Funnel frame — Benefit bar<\/strong><span class="lg-scope-chip">funnel-wide<\/span>/);
  });

  it("Background: role swatches, optional image, flat/brand/gradient style", async () => {
    const { html } = await harness();
    expect(html).toContain('data-role-strip="background.role"');
    expect(html).toContain('data-frame-key="background.image_media_id"');
    expect(html).toContain('data-frame-key="background.style"');
    expect(html).toContain(">Brand gradient</option>");
  });

  it("Section slot: max width, card/bare, padding, offset, allow-local-card, transition, Continue placement + style role + the button-mode note", async () => {
    const { html } = await harness();
    for (const key of [
      "section_slot.max_width", "section_slot.card", "section_slot.padding", "section_slot.offset_y",
      "section_slot.allow_section_card", "section_slot.transition", "section_slot.continue_placement",
    ]) {
      expect(html, `slot control ${key}`).toContain(`data-frame-key="${key}"`);
    }
    expect(html).toContain('data-role-strip="section_slot.continue_style_role"');
    expect(html).toContain(">Inside the question unit</option>");
    expect(html).toContain(">Below the question unit</option>");
    expect(html).toContain("Continue is only shown when the current Section uses button mode.");
  });

  it("Compatibility (C2): Advanced-collapsed group with the EXACT consequence sentence", async () => {
    const { html } = await harness();
    expect(html).toContain("data-region-panel-compat");
    expect(html).toContain('data-frame-key="compat.allow_section_chrome"');
    expect(html).toContain("Allow slides to keep their own page chrome (legacy)");
    expect(html).toContain(
      "ON: publishing warns instead of blocking when slides contain their own header/progress/footer — the live page may show them twice.",
    );
    // it sits inside a collapsed Advanced disclosure (a <details class="lg-advanced">)
    expect(html).toMatch(/<details class="lg-advanced" data-region-panel-compat>\s*<summary>Advanced<\/summary>/);
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
    expect(h.html).toContain("Same frame as funnel (no overrides)");

    // fork → non-control arm with stored overrides
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
    expect(html2).toContain('data-override-switch="progress"');
    expect(html2).toContain("Same as funnel (default)");
    expect(html2).toContain("Override for this variant");
    // theme override switch in the theme editor too (§4.5 palette overrides)
    expect(html2).toContain('data-override-switch="theme"');
    // the canvas override badge shell
    expect(html2).toContain('id="lg-override-badge"');
    // A/B tab lists the overridden group for the forked arm
    expect(html2).toMatch(/data-arm-overrides="[^"]+">Frame overrides: Progress</);
  });

  it("Rules tab: the B3 builder mount replaces the raw conditions textarea on the normal surface (textarea only behind Advanced)", async () => {
    const { html } = await harness();
    expect(html).toContain('id="lg-rules-builder-root"');
    expect(html).toContain('id="lg-rules-builder-data"');
    expect(html).toContain('data-target-input="lg-rule-conditions"');
    // the old normal-surface label is gone
    expect(html).not.toContain("Conditions JSON");
    // every conditions TEXTAREA sits inside an Advanced <details> disclosure
    // (the island's collectRules selector legitimately names the bare
    // attribute — count rendered textareas, not attribute mentions)
    const textareaCount = (html.match(/<textarea[^>]*data-rule-conditions/g) ?? []).length;
    expect(textareaCount).toBeGreaterThan(0);
    const advancedTextareas = html.match(/<details class="lg-advanced"><summary>Advanced[^<]*<\/summary>\s*<textarea[^>]*data-rule-conditions/g) ?? [];
    expect(advancedTextareas.length).toBe(textareaCount);
  });

  it("JSON data blobs are `<`-escaped (quote data + rules-builder data)", async () => {
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
    for (const blobId of ["lg-quote-data", "lg-rules-builder-data"]) {
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
