// LeadGen v2.5 Phase D — contract test `endpoint-parity` (13 §13.5 items 1–2,
// ENDPOINT level). The Phase-A `leadgen-preview-runtime-parity-v25` suite
// proved the same legs STRING-level (served /lg vs direct renderer calls);
// THIS suite drives BOTH REAL HTTP PATHS end to end and compares nothing but
// the two responses — zero renderer imports:
//
//   Item 1 — POST /api/admin/leadgen/variants/:id/preview {mode:"section",
//     site_id} html ≡ the served /lg shell's body for the same (funnel,
//     variant, section order, frame, theme, site), and its css ≡ the served
//     <style> block. The §13.5 "modulo" set (per-request splices: Maps key,
//     assignment, GA4; preview marker attrs) lives OUTSIDE the compared
//     region in this implementation — asserted explicitly, so the equality
//     is EXACT bytes (stronger than the contract's floor).
//
//   Item 2 — POST /api/admin/leadgen/sections/preview WITH frame_context ≡
//     the same Section's markup inside the runtime shell, node-for-node on
//     the unit subtree + the frame regions: both documents are split on the
//     `<section data-lg-section …>…</section>` wrappers by pure string
//     mechanics (lossless — reconstruction asserted), then unit block and
//     both frame-region halves compare byte-for-byte.
//
// Fixture: the full-composition parity fixture (header-footer template +
// funnel theme + variant overrides + site branding + activation) so every
// §13.2/§9.2 merge layer participates.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import type { LeadgenSectionRow } from "../src/admin/leadgen/db-types";

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
  "0042_leadgen_pages.sql",
] as const;

const TENANT_ORIGIN = "http://one.example.com";
const API = "/api/admin/leadgen";
const SITE_LOGO_URL = "https://cdn.example.com/site-one-logo.png";

function createRuntimeDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "CREATE TABLE site_settings (site_id TEXT, key TEXT, value TEXT);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','insurance','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','one.example.com','active');" +
      "INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','site_name','Site One Brand');" +
      `INSERT INTO site_settings (site_id, key, value) VALUES ('site-1','site_logo_url','${SITE_LOGO_URL}');`,
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

// --- fixture (the full-composition parity shape) -------------------------------

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
  quotePublicId: string;
  funnelPublicId: string;
  variantPublicId: string;
  sections: LeadgenSectionRow[]; // ordered
}

async function seedFixture(): Promise<Fixture> {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  const env = buildEnv(d1FromSqlite(sdb), makeKvStub());

  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Endpoint Parity Quote", activity: "quote_funnel", verticals: ["life"] }),
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
    jsonInit("PUT", { enabled: true, slug: "parity-e2e" }),
    env,
  );
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);

  const sections = (
    sdb
      .prepare(
        `SELECT s.* FROM leadgen_funnel_variant_sections fvs
         JOIN leadgen_sections s ON s.id = fvs.section_id
         WHERE fvs.variant_id = (SELECT id FROM leadgen_funnel_variants WHERE public_id = ?)
         ORDER BY fvs.position ASC`,
      )
      .all(variantPublicId) as unknown[]
  ) as LeadgenSectionRow[];
  return {
    sdb,
    env,
    quotePublicId: created.public_id,
    funnelPublicId,
    variantPublicId,
    sections,
  };
}

// --- served-document extraction (the parity-v25 idiom) -------------------------

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

// Split a composed body on its `<section data-lg-section …>…</section>`
// wrappers by PURE string mechanics (no renderer imports). Question units
// never nest <section> elements, so the Nth close tag closes the Nth block.
// Losslessness is asserted: before + blocks + between + after reconstructs
// the input byte-for-byte (and `between` must be empty — the section list is
// contiguous).
function splitSections(doc: string): { before: string; blocks: string[]; after: string } {
  const first = doc.indexOf("<section data-lg-section");
  expect(first, "at least one section wrapper present").toBeGreaterThan(-1);
  const blocks: string[] = [];
  let cursor = first;
  let lastEnd = first;
  for (;;) {
    const open = doc.indexOf("<section data-lg-section", cursor);
    if (open === -1) break;
    expect(open, "section list is contiguous (no bytes between blocks)").toBe(lastEnd === first ? first : lastEnd);
    const close = doc.indexOf("</section>", open);
    expect(close, "section wrapper closes").toBeGreaterThan(open);
    const end = close + "</section>".length;
    blocks.push(doc.slice(open, end));
    lastEnd = end;
    cursor = end;
  }
  const before = doc.slice(0, first);
  const after = doc.slice(lastEnd);
  expect(before + blocks.join("") + after, "lossless split").toBe(doc);
  return { before, blocks, after };
}

// ===========================================================================

describeDb("endpoint parity (13 §13.5, Phase D) — item 1: variants/:id/preview ≡ served /lg", () => {
  it("mode:'section' html ≡ the served shell body and css ≡ the served <style>, through BOTH real HTTP paths; splices live outside the compared region", async () => {
    const fx = await seedFixture();

    // --- REAL HTTP path 1: the public /lg serve ------------------------------
    const served = await app.request(`${TENANT_ORIGIN}/lg/parity-e2e`, {}, fx.env);
    expect(served.status, await served.clone().text()).toBe(200);
    const servedHtml = await served.text();
    const servedRoot = extractRootBody(servedHtml);
    const servedCss = extractStyle(servedHtml);

    // --- REAL HTTP path 2: the admin composed preview ------------------------
    const previewRes = await admin.request(
      `${API}/variants/${fx.variantPublicId}/preview`,
      jsonInit("POST", { mode: "section", site_id: "site-1" }),
      fx.env,
    );
    expect(previewRes.status, await previewRes.clone().text()).toBe(200);
    const preview = (await previewRes.json()) as {
      preview: { css: string; html: string; section_count: number };
      config: Record<string, unknown>;
    };

    // §13.5 item 1 — endpoint-level equality. The documented per-request
    // splices (Maps key, assignment, GA4) ride the config script/head OUTSIDE
    // #lg-funnel-root, and this implementation stamps no data-lg-preview
    // marker inside the body, so the equality is EXACT bytes.
    expect(preview.preview.html).toBe(servedRoot);
    expect(preview.preview.css).toBe(servedCss);
    expect(preview.preview.section_count).toBe(2);

    // The parity is over a REAL composition: frame regions + the variant's
    // numbered-progress override + the override palette in the css.
    expect(servedRoot).toContain('data-frame-template="header-footer"');
    expect(servedRoot).toContain("lg-frame-progress--numbered");
    expect(servedRoot).toContain(SITE_LOGO_URL); // §10 branding baked on BOTH paths
    expect(servedCss).toContain("#116611"); // variant palette override

    // Splices OUTSIDE the compared region, stated explicitly: the served page
    // carries the per-request config/assignment script AFTER the root body;
    // the admin response carries `config` as JSON instead of splicing it.
    expect(servedHtml.indexOf('id="lg-config"')).toBeGreaterThan(servedHtml.indexOf('<div id="lg-funnel-root"'));
    expect(preview.preview.html).not.toContain('id="lg-config"');
    expect(preview.config).toBeTruthy();
    // No preview markers on either side of the compared region.
    expect(preview.preview.html).not.toContain("data-lg-preview");
    expect(servedRoot).not.toContain("data-lg-preview");
  });
});

describeDb("endpoint parity (13 §13.5, Phase D) — item 2: sections/preview + frame_context ≡ the Section inside the runtime shell", () => {
  it("node-for-node: the unit subtree byte-equals the served section block; the frame regions byte-equal around it", async () => {
    const fx = await seedFixture();

    // --- REAL HTTP path 1: the public /lg serve ------------------------------
    const served = await app.request(`${TENANT_ORIGIN}/lg/parity-e2e`, {}, fx.env);
    expect(served.status, await served.clone().text()).toBe(200);
    const servedHtml = await served.text();
    const servedSplit = splitSections(extractRootBody(servedHtml));
    expect(servedSplit.blocks).toHaveLength(2);

    // --- REAL HTTP path 2: the section preview WITH frame_context ------------
    const section = fx.sections[0]!;
    const previewRes = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: section.content_json,
        headline: section.headline_text,
        subheadline: section.subheadline_text,
        continue_mode: section.continue_mode,
        design_overrides: section.design_overrides_json,
        section_public_id: section.public_id,
        frame_context: {
          funnel_public_id: fx.funnelPublicId,
          variant_public_id: fx.variantPublicId,
          site_id: "site-1",
        },
      }),
      fx.env,
    );
    expect(previewRes.status, await previewRes.clone().text()).toBe(200);
    const preview = (await previewRes.json()) as { preview: { css: string; desktop: string } };
    const previewSplit = splitSections(preview.preview.desktop);
    expect(previewSplit.blocks).toHaveLength(1);

    // §13.5 item 2 — node-for-node, byte-for-byte:
    //   * the UNIT SUBTREE: the previewed Section's wrapper+content equals the
    //     served shell's block for the same Section;
    expect(previewSplit.blocks[0]).toBe(servedSplit.blocks[0]);
    //   * the FRAME REGIONS: everything around the section list is identical
    //     (header/progress/disclosure/footer/trust regions + banners mount).
    expect(previewSplit.before).toBe(servedSplit.before);
    expect(previewSplit.after).toBe(servedSplit.after);
    // …and the css is the SAME resolveTokens+funnelChromeCss string.
    expect(preview.preview.css).toBe(extractStyle(servedHtml));

    // The compared frame really has regions on both sides (not a trivial
    // shell): template stamp + the variant's progress override.
    expect(servedSplit.before).toContain('data-frame-template="header-footer"');
    expect(servedSplit.before).toContain("lg-frame-progress--numbered");
    // The unit block is the REAL question unit (bound headline + choices).
    expect(previewSplit.blocks[0]).toContain("Are you insured?");
    expect(previewSplit.blocks[0]).toContain('data-question-id="q1"');
  });
});
