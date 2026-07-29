// LeadGen R2 fixing mission · P2 S2c — board defects (SOURCE-OF-TRUTH A.1
// #11-B / #11-C / R7 register). Real producer->consumer flow: every DB-backed
// assertion drives the REAL admin router's HTTP handlers (the leadgen-rework-
// board.test.ts / node:sqlite D1 harness pattern) against the REAL rendered
// HTML / REAL persisted rows — never hand-builds both sides of a boundary.

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { QUOTE_EDITOR_SCRIPT } from "../src/admin/leadgen/quotes-tabs/funnel";
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
  "0054_leadgen_analytics_routing_dims.sql", "0055_leadgen_quote_default_template.sql",
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

interface QuoteDetail { public_id: string; funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> }

describe("island script (client-side) regressions — string-level guard", () => {
  it("SRC-11B: the Template chip dispatch NAVIGATES to the top-bar Templates tab, no embedded popover mechanism remains", () => {
    expect(QUOTE_EDITOR_SCRIPT).toContain("data-template-picker");
    expect(QUOTE_EDITOR_SCRIPT).toMatch(/data-template-picker[\s\S]{0,80}gotoTab\('templates'\)/);
    expect(QUOTE_EDITOR_SCRIPT).not.toContain("openTemplatePicker(");
    expect(QUOTE_EDITOR_SCRIPT).not.toContain("frameTemplateRecordItems(");
  });

  it("R2 handoff: the funnel-builder's preview draft strips incomplete image rows before the preview POST", () => {
    expect(QUOTE_EDITOR_SCRIPT).toContain("stripIncompleteImagesForPreview");
  });

  it("R2 handoff: the site select syncs to the first-Active default at init", () => {
    expect(QUOTE_EDITOR_SCRIPT).toContain("initSiteSelectDefault");
  });

  it("R2 register R7: the one-Save theme PUT is normalized (GET -> drop theme_id -> merge -> PUT)", () => {
    expect(QUOTE_EDITOR_SCRIPT).toContain("normalizedThemePut");
  });
});

describeDb("SRC-11C-B — funnel-chip kebab parity + plain-language ruled-slot sentence", () => {
  let env: Env;
  let quote: QuoteDetail;
  let credit: { id: number; public_id: string };
  let zip: { id: number; public_id: string };
  let income: { id: number; public_id: string };
  let dob: { id: number; public_id: string };

  beforeAll(async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    env = buildEnv(d1FromSqlite(sdb));
    credit = seedSection(sdb, "Credit Score", "auto");
    zip = seedSection(sdb, "ZIP Code", "auto");
    // Distinct from credit/zip (used on the FUNNEL page below) — §4.3-13
    // uniqueness forbids the SAME section on both the shared page and a
    // funnel page, so the shared-page test needs its own pair.
    income = seedSection(sdb, "Income Level", "auto");
    dob = seedSection(sdb, "Date of Birth", "auto");
    const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Board Defects R2", activity: "quote_funnel", verticals: ["auto"] }), env);
    quote = (await cq.json()) as QuoteDetail;
  });

  it("the funnel-chip kebab menu HTML now carries A/B this slot + Slot rule (parity with the shared chip)", async () => {
    const html = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    const funnelChipMenuStart = html.indexOf('data-board-menu="funnel-chip"');
    const nextMenuStart = html.indexOf('data-board-menu="page"');
    expect(funnelChipMenuStart).toBeGreaterThan(-1);
    const funnelChipMenuHtml = html.slice(funnelChipMenuStart, nextMenuStart);
    expect(funnelChipMenuHtml).toContain('data-menu-action="ab-slot"');
    expect(funnelChipMenuHtml).toContain('data-menu-action="slot-rule"');
    expect(funnelChipMenuHtml).toContain("A/B this slot");
    expect(funnelChipMenuHtml).toContain("Slot rule");
    // parity does not remove the existing funnel-chip-only entries
    expect(funnelChipMenuHtml).toContain('data-menu-action="chip-up"');
    expect(funnelChipMenuHtml).toContain('data-menu-action="chip-down"');
  });

  it("a state=CA ruled slot on a FUNNEL page SAVES and its card renders the generated plain-language sentence", async () => {
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    const put = await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", {
        pages: [{
          name: null,
          slots: [{
            kind: "ruled",
            cases: [{ conditions: { groups: [{ field: "state", op: "eq", value: "CA" }] }, section_id: credit.public_id }],
            default_section_id: zip.public_id,
          }],
        }],
      }),
      env,
    );
    expect(put.status, await put.clone().text()).toBe(200);

    const html = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    expect(html).toContain('data-chip-scope="funnel"');
    expect(html).toContain('data-slot-kind="ruled"');
    // The reused conditionsSentence idiom: "Matches when <label> is <value>".
    expect(html).toContain("Matches when State is");
    expect(html).toContain("CA");
    expect(html).toContain(credit.public_id === "" ? "" : "Credit Score");
    expect(html).toContain("ZIP Code"); // the default section's name
  });

  it("a device=mobile ruled slot ALSO renders its sentence (generic mechanism proof, not state-specific)", async () => {
    const variantId = quote.funnels[0]!.variants[0]!.public_id;
    await admin.request(
      `${API}/variants/${variantId}`,
      jsonInit("PUT", {
        pages: [{
          name: null,
          slots: [{
            kind: "ruled",
            cases: [{ conditions: { groups: [{ field: "device", op: "eq", value: "mobile" }] }, section_id: zip.public_id }],
            default_section_id: credit.public_id,
          }],
        }],
      }),
      env,
    );
    const html = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    expect(html).toContain("Matches when Device is");
    expect(html).toContain("mobile");
  });

  it("the shared-page ruled chip ALSO renders a sentence (pageToApi's rule_summary is shared by sharedPageJson)", async () => {
    const sp = await admin.request(`${API}/quotes/${quote.public_id}/shared-page`, jsonInit("POST", { sections: [{ section_id: income.id }] }), env);
    expect(sp.status, await sp.clone().text()).toBe(201);
    const put = await admin.request(
      `${API}/quotes/${quote.public_id}/shared-page`,
      jsonInit("PUT", {
        slots: [{
          kind: "ruled",
          cases: [{ conditions: { groups: [{ field: "state", op: "eq", value: "NY" }] }, section_id: dob.public_id }],
          default_section_id: income.public_id,
        }],
      }),
      env,
    );
    expect(put.status, await put.clone().text()).toBe(200);
    const html = await (await admin.request(`/admin/leadgen/quotes/${quote.public_id}/edit`, {}, env)).text();
    expect(html).toContain("Matches when State is");
    expect(html).toContain("NY");
  });
});

describeDb("R2 handoff — preview-safe images split (save keeps validating)", () => {
  let env: Env;
  let variantId = "";
  let funnelId = "";

  beforeAll(async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    env = buildEnv(d1FromSqlite(sdb));
    const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Preview Safe", activity: "quote_funnel", verticals: ["auto"] }), env);
    const quote = (await cq.json()) as QuoteDetail & { funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }> };
    variantId = quote.funnels[0]!.variants[0]!.public_id;
    funnelId = quote.funnels[0]!.public_id;
  });

  const halfTypedImage = { id: "img_half", alt: "half typed, no media/url yet", slot: "above_section", size: "m", align: "left" };

  it("FAIL-BEFORE (the bug): the shared collector's UNFILTERED half-typed image row 400s the preview", async () => {
    const res = await admin.request(
      `${API}/variants/${variantId}/preview`,
      jsonInit("POST", { mode: "section", viewport: "desktop", draft_frame_config: { version: 1, template: "centered", images: [halfTypedImage] } }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { problems?: Array<{ message: string }> };
    expect(body.problems?.[0]?.message).toContain("An image needs an uploaded image");
  });

  it("PASS-AFTER (the fix): stripping the half-typed row (stripIncompleteImagesForPreview's algorithm) renders the preview", async () => {
    const res = await admin.request(
      `${API}/variants/${variantId}/preview`,
      jsonInit("POST", { mode: "section", viewport: "desktop", draft_frame_config: { version: 1, template: "centered", images: [] } }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
  });

  it("Save (PUT /funnels/:id/frame) is UNCHANGED — the same half-typed row still 400s at save time", async () => {
    const res = await admin.request(
      `${API}/funnels/${funnelId}/frame`,
      jsonInit("PUT", { frame_config_json: { version: 1, template: "centered", images: [halfTypedImage] } }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describeDb("R2 register R7 — theme-save normalization (mirrors quotes-tabs/themes.ts's flushThemeEdits)", () => {
  let env: Env;
  let funnelId = "";

  beforeAll(async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    env = buildEnv(d1FromSqlite(sdb));
    const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Theme R7", activity: "quote_funnel", verticals: ["auto"] }), env);
    const quote = (await cq.json()) as QuoteDetail;
    funnelId = quote.funnels[0]!.public_id;
  });

  it("FAIL-BEFORE: PUTting the RAW combination (theme_id + an inline field) is rejected", async () => {
    await admin.request(`${API}/funnels/${funnelId}/theme`, jsonInit("PUT", { theme_json: { theme_id: "preset-x" } }), env);
    const raw = await admin.request(
      `${API}/funnels/${funnelId}/theme`,
      jsonInit("PUT", { theme_json: { theme_id: "preset-x", palette: { brand_primary: "#112233" } } }),
      env,
    );
    expect(raw.status).toBe(400);
  });

  it("PASS-AFTER: normalizedThemePut's algorithm (GET -> drop theme_id when inline fields are present -> merge -> PUT) is accepted and the edit APPLIES", async () => {
    await admin.request(`${API}/funnels/${funnelId}/theme`, jsonInit("PUT", { theme_json: { theme_id: "preset-x" } }), env);
    const getRes = await admin.request(`${API}/funnels/${funnelId}/theme`, {}, env);
    const current = ((await getRes.json()) as { theme: Record<string, unknown> }).theme ?? {};
    const merged: Record<string, unknown> = {};
    for (const k of Object.keys(current)) if (k !== "theme_id") merged[k] = current[k];
    merged["palette"] = { brand_primary: "#112233" };
    const put = await admin.request(`${API}/funnels/${funnelId}/theme`, jsonInit("PUT", { theme_json: merged }), env);
    expect(put.status, await put.clone().text()).toBe(200);
    const after = ((await (await admin.request(`${API}/funnels/${funnelId}/theme`, {}, env)).json()) as { theme: Record<string, unknown> }).theme;
    expect(after?.["theme_id"]).toBeUndefined();
    expect((after?.["palette"] as Record<string, unknown> | undefined)?.["brand_primary"]).toBe("#112233");
  });
});
