// LeadGen v2.5 Phase A — contract test `preview-runtime-parity`
// (redesign-contract-v2.5 13 §13.5, string-level legs; the endpoint-level
// preview legs land with the Phase-B/D routes).
//
//   Leg 1 — for the same (funnel, variant, section order, frame, theme, site):
//     the /lg serve FRAME path's body (everything inside #lg-funnel-root) is
//     STRING-IDENTICAL to a direct renderQuoteFrame composition built from the
//     same inputs, AND to renderComposedVariantPreview(...)'s html (the
//     function the Phase-B preview routes consume) — parity by construction,
//     proven byte-for-byte.
//   Leg 3 — token resolution used by the admin canvas css == runtime css: the
//     served <style> block equals the SAME resolveTokens + funnelChromeCss
//     call (frameRegions on) AND renderComposedVariantPreview(...)'s css —
//     asserted by string equality.
//
// Harness: the leadgen-runtime-api node:sqlite pattern + migrations 0036–0041;
// frame/theme/variant-overrides columns set via direct SQL (PUT routes are
// Phase B). The fixture exercises all three composition inputs: a funnel
// frame, a funnel theme, AND variant frame_overrides (progress restyle +
// palette override) so the parity claim covers the full §13.2/§9.2 merge.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import {
  renderVariantSectionsHtml,
  resolveFrameComposition,
} from "../src/public/leadgen/serve";
import { renderQuoteFrame, LG_BANNERS_MOUNT_HTML } from "../src/public/leadgen/designs/frame";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import {
  funnelChromeCss,
  FUNNEL_DESIGN_SCOPE_ATTR,
} from "../src/public/leadgen/designs/default-funnel/styles";
import { resolveSiteBranding } from "../src/leadgen/branding";
import { renderComposedVariantPreview } from "../src/admin/leadgen/quotes-handlers";
import type { ResolvedFunnelSection } from "../src/public/leadgen/resolver";
import type {
  LeadgenFunnelRow,
  LeadgenFunnelVariantRow,
  LeadgenQuoteRow,
  LeadgenSectionRow,
} from "../src/admin/leadgen/db-types";

// --- node:sqlite harness (repo pattern) --------------------------------------

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  close(): void;
  [method: string]: unknown;
};
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const { createRequire } = require("node:module") as typeof import("node:module");
    const nodeRequire = createRequire(import.meta.url);
    const mod = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
    return mod.DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
      if (typeof getBuiltin === "function") {
        const mod = getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
        return mod.DatabaseSync;
      }
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
          const r = sdb.prepare(sql).get(...binds);
          return (r ?? null) as T | null;
        },
        async all<T = unknown>() {
          const rows = sdb.prepare(sql).all(...binds);
          return { results: rows as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as {
            changes?: number;
            lastInsertRowid?: number | bigint;
          };
          return {
            success: true,
            meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) },
          };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const results: unknown[] = [];
      try {
        for (const statement of statements) {
          results.push(await statement.run());
        }
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

function makeKvStub(): KVNamespace {
  const store = new Map<string, { value: string; metadata: unknown }>();
  return {
    async get(key: string): Promise<string | null> {
      return store.has(key) ? store.get(key)!.value : null;
    },
    async getWithMetadata(key: string): Promise<{ value: string | null; metadata: unknown }> {
      const e = store.get(key);
      return e ? { value: e.value, metadata: e.metadata ?? null } : { value: null, metadata: null };
    },
    async put(key: string, value: string, opts?: { metadata?: unknown }): Promise<void> {
      store.set(key, { value, metadata: opts?.metadata ?? null });
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
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

const TENANT_ORIGIN = "http://one.example.com";
const API = "/api/admin/leadgen";

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
  for (const file of LEADGEN_MIGRATIONS) {
    runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  }
  return sdb;
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
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
    LEADGEN_CONFIG_SIGNING_KEY: "runtime-signing-key-test-only",
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// --- fixture ------------------------------------------------------------------

// Full-composition fixture: `header-footer` template + funnel patch + theme
// (palette, radius scale, button defaults) + VARIANT overrides (progress
// restyle + a palette override) — every §13.2/§9.2 layer participates.
const FRAME_CONFIG = {
  version: 1,
  template: "header-footer",
  progress: { style: "bar", show_label: true },
  disclosure: { enabled: true, location: "footer", text: "Ad disclosure copy." },
} as const;

const THEME_JSON = {
  version: 1,
  palette: { brand_primary: "#0B5FFF", accent: "#AA3300" },
  scales: { radius: "round" },
  button_defaults: { background_role: "accent" },
} as const;

const FRAME_OVERRIDES = {
  progress: { style: "numbered", position: "above_unit" },
  theme: { palette: { accent: "#116611" } },
} as const;

function seedSection(sdb: SqliteDb, headline: string, qid: string): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({
    components: [
      { type: "QuestionHeadline", question_id: `${qid}_h`, bind: "section_headline", props: {} },
      {
        type: "TwoButtonYesNo",
        question_id: qid,
        question_key: `${qid}_key`,
        internal_field: `${qid}_field`,
        answer_type: "boolean",
      },
      { type: "ContinueButton", question_id: `${qid}_c`, props: { label: "Continue" } },
    ],
  });
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 0, 'active')",
    )
    .run(publicId, `Section ${qid}`, headline, content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as {
    id: number;
  };
  return { id: row.id, public_id: publicId };
}

interface Fixture {
  sdb: SqliteDb;
  env: Env;
  d1: D1Database;
  quote: LeadgenQuoteRow;
  funnel: LeadgenFunnelRow;
  variant: LeadgenFunnelVariantRow;
  sections: LeadgenSectionRow[]; // ordered
}

async function seedFixture(): Promise<Fixture> {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  const d1 = d1FromSqlite(sdb);
  const env = buildEnv(d1, makeKvStub());

  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Parity Quote", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const created = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const funnelPublicId = created.funnels[0]!.public_id;
  const variantPublicId = created.funnels[0]!.variants[0]!.public_id;

  const s1 = seedSection(sdb, "Are you insured?", "q1");
  const s2 = seedSection(sdb, "What is your ZIP?", "q2");
  const putRes = await admin.request(
    `${API}/variants/${variantPublicId}`,
    jsonInit("PUT", { sections: [{ section_id: s1.id }, { section_id: s2.id }] }),
    env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);

  sdb
    .prepare("UPDATE leadgen_funnels SET frame_config_json = ?, theme_json = ? WHERE public_id = ?")
    .run(JSON.stringify(FRAME_CONFIG), JSON.stringify(THEME_JSON), funnelPublicId);
  sdb
    .prepare("UPDATE leadgen_funnel_variants SET frame_overrides_json = ? WHERE public_id = ?")
    .run(JSON.stringify(FRAME_OVERRIDES), variantPublicId);

  const actRes = await admin.request(
    `${API}/quotes/${created.public_id}/activation/site-1`,
    jsonInit("PUT", { enabled: true, slug: "parity" }),
    env,
  );
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);

  const quote = sdb
    .prepare("SELECT * FROM leadgen_quotes WHERE public_id = ?")
    .get(created.public_id) as unknown as LeadgenQuoteRow;
  const funnel = sdb
    .prepare("SELECT * FROM leadgen_funnels WHERE public_id = ?")
    .get(funnelPublicId) as unknown as LeadgenFunnelRow;
  const variant = sdb
    .prepare("SELECT * FROM leadgen_funnel_variants WHERE public_id = ?")
    .get(variantPublicId) as unknown as LeadgenFunnelVariantRow;
  const sections = (
    sdb
      .prepare(
        `SELECT s.* FROM leadgen_funnel_variant_sections fvs
         JOIN leadgen_sections s ON s.id = fvs.section_id
         WHERE fvs.variant_id = ? ORDER BY fvs.position ASC`,
      )
      .all(variant.id) as unknown[]
  ) as LeadgenSectionRow[];
  return { sdb, env, d1, quote, funnel, variant, sections };
}

// Extraction boundaries over the served document: the ONE <style> block and
// the #lg-funnel-root body (everything before the #lg-config script — the
// composed root's last byte is its closing </div>).
function extractStyle(html: string): string {
  const start = html.indexOf("<style>") + "<style>".length;
  const end = html.indexOf("</style>", start);
  expect(start).toBeGreaterThan("<style>".length - 1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

function extractRootBody(html: string): string {
  const start = html.indexOf('<div id="lg-funnel-root"');
  const end = html.indexOf('<script type="application/json" id="lg-config">');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

// ===========================================================================

describeDb("preview-runtime-parity (13 §13.5 legs 1 + 3, string-level)", () => {
  it("leg 1: the /lg frame-path body ≡ direct renderQuoteFrame composition ≡ renderComposedVariantPreview html (byte-for-byte)", async () => {
    const fx = await seedFixture();

    const res = await app.request(`${TENANT_ORIGIN}/lg/parity`, {}, fx.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const servedRoot = extractRootBody(await res.text());

    // --- direct composition from the SAME inputs (the test's own assembly —
    // any serve-side fork/divergence would break byte equality here).
    const design = getFunnelDesign(fx.variant.funnel_design_id);
    const composition = resolveFrameComposition(
      {
        frame_config_json: fx.funnel.frame_config_json,
        theme_json: fx.funnel.theme_json,
        frame_overrides_json: fx.variant.frame_overrides_json,
      },
      design,
    );
    expect(composition).not.toBeNull();
    const resolvedSections: ResolvedFunnelSection[] = fx.sections.map((section, index) => ({
      position: index,
      section,
    }));
    const sectionsHtml = renderVariantSectionsHtml(
      resolvedSections,
      composition!.effectiveTokens.design,
      composition!.frame,
    );
    const branding = await resolveSiteBranding(fx.d1, "site-1");
    const direct = renderQuoteFrame({
      effectiveTokens: composition!.effectiveTokens,
      frame: composition!.frame,
      siteBranding: branding,
      sectionsHtml,
      bannersMountHtml: LG_BANNERS_MOUNT_HTML,
      sectionCount: fx.sections.length,
      root: {
        funnelId: fx.funnel.public_id,
        funnelVariantId: fx.variant.public_id,
        quoteId: fx.quote.public_id,
        contentVersion: fx.variant.content_version,
      },
    });
    expect(servedRoot).toBe(direct);

    // --- the admin composed preview (the Phase-B routes' renderer) emits the
    // IDENTICAL body for the same inputs (leg 2's function-level core).
    const preview = renderComposedVariantPreview({
      quote: fx.quote,
      funnel: fx.funnel,
      variant: fx.variant,
      sections: fx.sections,
      siteBranding: branding,
    });
    expect(preview).not.toBeNull();
    expect(preview!.html).toBe(servedRoot);

    // Sanity on the composition itself: the variant override repositioned the
    // progress mount above the unit + numbered style; the theme+override
    // palette reached the effective tokens.
    expect(servedRoot).toContain("lg-frame-progress--numbered");
    expect(composition!.effectiveTokens.roles.brand_primary).toBe("#0B5FFF");
    expect(composition!.effectiveTokens.roles.accent).toBe("#116611"); // variant override wins over theme
  });

  it("leg 3: admin-canvas css == runtime css — the SAME resolveTokens + funnelChromeCss call, string equality", async () => {
    const fx = await seedFixture();

    const res = await app.request(`${TENANT_ORIGIN}/lg/parity`, {}, fx.env);
    expect(res.status).toBe(200);
    const servedCss = extractStyle(await res.text());

    const design = getFunnelDesign(fx.variant.funnel_design_id);
    const composition = resolveFrameComposition(
      {
        frame_config_json: fx.funnel.frame_config_json,
        theme_json: fx.funnel.theme_json,
        frame_overrides_json: fx.variant.frame_overrides_json,
      },
      design,
    );
    const scope = `[${FUNNEL_DESIGN_SCOPE_ATTR}="${design.id}"]`;
    const directCss = funnelChromeCss(composition!.effectiveTokens.design, scope, {
      frameRegions: true,
    });
    expect(servedCss).toBe(directCss);

    // The admin composed preview serves the SAME string (the canvas css).
    const preview = renderComposedVariantPreview({
      quote: fx.quote,
      funnel: fx.funnel,
      variant: fx.variant,
      sections: fx.sections,
    });
    expect(preview!.css).toBe(servedCss);

    // The css is genuinely the EFFECTIVE sheet: themed brand + frame rules.
    expect(servedCss).toContain("#0B5FFF");
    expect(servedCss).toContain(".lg-frame-region");
  });
});
