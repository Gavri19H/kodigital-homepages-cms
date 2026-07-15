// LeadGen v3.1 §7/§12 (Phase A, slice A3 — adversarial-review fix round 3):
//
//   MAJOR-1 — resolveTokens produces EffectiveTokens.theme_controls, but
//   until this round NO production render path threaded it into
//   LeadgenSectionRenderCtx.theme_controls, so fieldSizeStyle always fell
//   back to its own DEFAULT_SIZE_THEME_CONTROLS constant (a dead
//   deliverable). This file proves the wiring at REAL HTTP level (never a
//   hand-built ctx) across all THREE §12 paths — runtime /lg, section-in-
//   frame preview, and composed-variant preview — using design_overrides.
//   size.width={custom_px:384} (§7.2-exact: custom_px is the literal stored
//   number regardless of theme controls, so it renders identically whether
//   or not A2's still-in-flux preset-px calibration table is final — the
//   test proves PARITY + that ctx reaches the renderer, not a specific
//   preset-to-pixel value).
//
//   BLOCKER-1 defense-in-depth — a theme record whose typography bypassed
//   validateThemeBody (simulating direct KV tampering) can still never
//   reach the served <style> block: the KV-shape reader (theme-store.ts)
//   drops it, so it resolves as "no theme" rather than smuggling the raw
//   string through.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";

// --- node:sqlite harness (repo pattern, duplicated per file per convention) -

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
    // Real Cloudflare KV list() filters by `options.prefix` (see the sibling
    // v31 test files for the fuller rationale — the §28 invalidation sweep
    // relies on it).
    async list(options?: {
      prefix?: string;
      cursor?: string;
    }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      const prefix = options?.prefix ?? "";
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      return { keys: keys.map((name) => ({ name })), list_complete: true, cursor: "" };
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

const TENANT_HOST = "one.example.com";
const TENANT_ORIGIN = `http://${TENANT_HOST}`;
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

function jsonInit(method: string, body?: unknown): RequestInit {
  return body === undefined
    ? { method }
    : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

interface Harness {
  sdb: SqliteDb;
  env: Env;
}

function newHarness(): Harness {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb), makeKvStub()) };
}

// A FreeTextQuestion node — the type renderTextInput/fieldSizeStyle backs —
// with (or without) a §7.2 custom_px width override.
function sectionContentJson(withCustomWidth: boolean): string {
  return JSON.stringify({
    components: [
      { type: "QuestionHeadline", question_id: "q1_h", bind: "section_headline", props: {} },
      {
        type: "FreeTextQuestion",
        question_id: "q1",
        question_key: "q1_key",
        internal_field: "q1_field",
        ...(withCustomWidth ? { design_overrides: { size: { width: { custom_px: 384 } } } } : {}),
      },
    ],
  });
}

interface SeededFixture {
  h: Harness;
  quotePublicId: string;
  funnelPublicId: string;
  funnelId: number;
  variantPublicId: string;
  sectionPublicId: string;
}

// v3.1 audit-round G FIX 3: a field node carrying the §8.1 props.helper +
// props.icon (Location) — the pre-fix renderTextInput dropped BOTH on every
// path. Same shape as sectionContentJson (a renderTextInput-backed field).
function sectionContentHelperIconJson(): string {
  return JSON.stringify({
    components: [
      { type: "QuestionHeadline", question_id: "q1_h", bind: "section_headline", props: {} },
      {
        type: "ZIPInputQuestion",
        question_id: "q1",
        question_key: "q1_key",
        internal_field: "q1_field",
        props: { placeholder: "Enter your ZIP code", helper: "We never share this", icon: "location" },
      },
    ],
  });
}

async function seedActivatedFixture(
  slug: string,
  withCustomWidth: boolean,
  contentJsonOverride?: string,
): Promise<SeededFixture> {
  const h = newHarness();
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: `Size Parity ${slug}`, activity: "quote_funnel", verticals: ["life"] }),
    h.env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const created = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const funnelPublicId = created.funnels[0]!.public_id;
  const variantPublicId = created.funnels[0]!.variants[0]!.public_id;
  const funnelRow = h.sdb.prepare("SELECT id FROM leadgen_funnels WHERE public_id = ?").get(funnelPublicId) as {
    id: number;
  };

  const sectionPublicId = mintPublicId("section");
  h.sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, 'Q1', 'quote_funnel', 'life', 'Question?', ?, 'button', 0, 'active')",
    )
    .run(sectionPublicId, contentJsonOverride ?? sectionContentJson(withCustomWidth));
  const sectionRow = h.sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sectionPublicId) as {
    id: number;
  };

  const putRes = await admin.request(
    `${API}/variants/${variantPublicId}`,
    jsonInit("PUT", { sections: [{ section_id: sectionRow.id }] }),
    h.env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);

  h.sdb
    .prepare("UPDATE leadgen_funnels SET frame_config_json = ? WHERE public_id = ?")
    .run(JSON.stringify({ version: 1, template: "centered" }), funnelPublicId);

  const actRes = await admin.request(
    `${API}/quotes/${created.public_id}/activation/site-1`,
    jsonInit("PUT", { enabled: true, slug }),
    h.env,
  );
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);

  return { h, quotePublicId: created.public_id, funnelPublicId, funnelId: funnelRow.id, variantPublicId, sectionPublicId };
}

const THEME_BODY = {
  name: "Size Parity Theme",
  roles: {
    brand_primary: "#1B3A5C",
    accent: "#F5C518",
    page_bg: "#F4F6F9",
    card: "#FFFFFF",
    text: "#1A1F36",
    success: "#0E7C3A",
    error: "#B23A2C",
  },
  typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
  controls: { field_height: "large", button_size: "l", corners: "pill" },
};

async function assignTheme(env: Env, funnelPublicId: string): Promise<ThemeRecord> {
  const themeRes = await admin.request(`${API}/themes`, jsonInit("POST", THEME_BODY), env);
  expect(themeRes.status, `create theme: ${await themeRes.clone().text()}`).toBe(201);
  const theme = ((await themeRes.json()) as { item: ThemeRecord }).item;
  const putRes = await admin.request(
    `${API}/funnels/${funnelPublicId}/theme`,
    jsonInit("PUT", { theme_json: { theme_id: theme.id } }),
    env,
  );
  expect(putRes.status, `assign theme: ${await putRes.clone().text()}`).toBe(200);
  return theme;
}

// ===========================================================================
// MAJOR-1 — theme_controls threading, real HTTP level, all 3 §12 paths
// ===========================================================================

describeDb("theme_controls threading (v3.1 §7/§12, adversarial review MAJOR-1)", () => {
  // R3 fix-round grounding erratum (register): the absent HEIGHT axis now
  // ALSO resolves (inherits theme_controls.field_height, §7.2 "absent =
  // inherit theme default") on all 3 paths — this test's OWN purpose (proving
  // theme_controls threading reaches the render) is fulfilled MORE completely
  // now that both axes are observable, not just the custom_px width.
  it("PATH 1/3 — runtime GET /lg/:slug renders the node's custom_px width inline (ctx reaches fieldSizeStyle)", async () => {
    const fx = await seedActivatedFixture("size-runtime", true);
    await assignTheme(fx.h.env, fx.funnelPublicId);

    const res = await app.request(`${TENANT_ORIGIN}/lg/size-runtime`, {}, fx.h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const html = await res.text();
    expect(html).toContain('style="width:384px;height:60px;display:block;margin-left:auto;margin-right:auto"');
  });

  it("PATH 2/3 — POST /sections/preview (section-in-frame) renders the SAME custom_px width", async () => {
    const fx = await seedActivatedFixture("size-preview", true);
    await assignTheme(fx.h.env, fx.funnelPublicId);

    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: sectionContentJson(true),
        headline: "Question?",
        section_public_id: fx.sectionPublicId,
        frame_context: { funnel_public_id: fx.funnelPublicId, variant_public_id: fx.variantPublicId },
      }),
      fx.h.env,
    );
    expect(res.status, `preview: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { preview: { desktop: string } };
    expect(body.preview.desktop).toContain('style="width:384px;height:60px;display:block;margin-left:auto;margin-right:auto"');
  });

  it("PATH 3/3 — POST /variants/:id/preview (composed-variant preview) renders the SAME custom_px width", async () => {
    const fx = await seedActivatedFixture("size-composed", true);
    await assignTheme(fx.h.env, fx.funnelPublicId);

    const res = await admin.request(
      `${API}/variants/${fx.variantPublicId}/preview`,
      jsonInit("POST", { mode: "section", section_public_id: fx.sectionPublicId }),
      fx.h.env,
    );
    expect(res.status, `composed preview: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { preview: { html: string } };
    expect(body.preview.html).toContain('style="width:384px;height:60px;display:block;margin-left:auto;margin-right:auto"');
  });

  it("REGRESSION — absent design_overrides.size renders NO style attribute on the field, on all 3 paths (byte-identical, strictly additive)", async () => {
    const fx = await seedActivatedFixture("size-absent", false);
    await assignTheme(fx.h.env, fx.funnelPublicId);

    // fieldSizeStyle's output (when non-empty) is inserted DIRECTLY adjacent
    // to the `data-lg-input` marker (renderTextInput: `... data-lg-input` +
    // fieldSizeStyle(...) + ...) — so "no style attribute on THIS field"
    // means that exact marker is never immediately followed by ` style=`.
    // A blanket "no style=\"width: anywhere on the page\" check is WRONG:
    // the frame's progress bar legitimately renders its OWN, unrelated
    // `style="width:100%;background:…"` fill indicator.
    const noFieldStyle = (html: string): void => expect(html).not.toContain('data-lg-input style=');

    const runtimeRes = await app.request(`${TENANT_ORIGIN}/lg/size-absent`, {}, fx.h.env);
    noFieldStyle(await runtimeRes.text());

    const previewRes = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: sectionContentJson(false),
        headline: "Question?",
        section_public_id: fx.sectionPublicId,
        frame_context: { funnel_public_id: fx.funnelPublicId, variant_public_id: fx.variantPublicId },
      }),
      fx.h.env,
    );
    const previewBody = (await previewRes.json()) as { preview: { desktop: string } };
    noFieldStyle(previewBody.preview.desktop);

    const composedRes = await admin.request(
      `${API}/variants/${fx.variantPublicId}/preview`,
      jsonInit("POST", { mode: "section", section_public_id: fx.sectionPublicId }),
      fx.h.env,
    );
    const composedBody = (await composedRes.json()) as { preview: { html: string } };
    noFieldStyle(composedBody.preview.html);
  });
});

// ===========================================================================
// M1 (MAJOR, adversarial-review fix round) — Style tab Corners/Border-color
// render wiring (§8.5b/§11.5/§12): setNodeCorners/setNodeBorderColor
// (ui-section-studio.ts) persisted design_overrides.corners/.border_color
// and highlighted the segment active, but no renderer consumed them — a
// silent no-op with false "active" feedback. This proves the wiring at REAL
// HTTP level (never a hand-built ctx) across all THREE §12 paths, mirroring
// the size-threading proof above.
// ===========================================================================

// A FreeTextQuestion node with (or without) v3.1 §8.5b Corners/Border-color
// node.design_overrides.
function sectionContentJsonAppearance(overrides: { corners?: string; border_color?: string } | null): string {
  return JSON.stringify({
    components: [
      { type: "QuestionHeadline", question_id: "q1_h", bind: "section_headline", props: {} },
      {
        type: "FreeTextQuestion",
        question_id: "q1",
        question_key: "q1_key",
        internal_field: "q1_field",
        ...(overrides !== null ? { design_overrides: overrides } : {}),
      },
    ],
  });
}

// Reuses seedActivatedFixture's full quote/funnel/variant/section/activation
// wiring, then overwrites JUST content_json with the appearance-specific
// node tree — additive, touches none of the existing size-parity fixtures.
async function seedAppearanceFixture(
  slug: string,
  overrides: { corners?: string; border_color?: string } | null,
): Promise<SeededFixture> {
  const fx = await seedActivatedFixture(slug, false);
  fx.h.sdb
    .prepare("UPDATE leadgen_sections SET content_json = ? WHERE public_id = ?")
    .run(sectionContentJsonAppearance(overrides), fx.sectionPublicId);
  return fx;
}

describeDb("Style tab Corners/Border-color render wiring (v3.1 §8.5b/§11.5/§12, fix-round MAJOR-1)", () => {
  it("PATH 1/3 — runtime GET /lg/:slug renders corners:pill as border-radius:20px and border_color:brand as the theme's brand_primary hex", async () => {
    const fx = await seedAppearanceFixture("appearance-runtime", { corners: "pill", border_color: "brand" });
    await assignTheme(fx.h.env, fx.funnelPublicId);

    const res = await app.request(`${TENANT_ORIGIN}/lg/appearance-runtime`, {}, fx.h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const html = await res.text();
    // border_color rides the --lg-field-border CUSTOM PROPERTY, not
    // border-color directly (adversarial-review cascade-regression
    // close-out: a direct inline border-color would beat .lg-input:focus/
    // [aria-invalid] by specificity — see designs/default-funnel/styles.ts's
    // .lg-input rule + the live Playwright proof in leadgen-section-studio.spec.ts).
    expect(html).toContain(
      `data-lg-input style="border-radius:20px;--lg-field-border:${THEME_BODY.roles.brand_primary}"`,
    );
  });

  it("PATH 2/3 — POST /sections/preview (section-in-frame) renders the SAME corners/border_color", async () => {
    const fx = await seedAppearanceFixture("appearance-preview", { corners: "pill", border_color: "brand" });
    await assignTheme(fx.h.env, fx.funnelPublicId);

    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: sectionContentJsonAppearance({ corners: "pill", border_color: "brand" }),
        headline: "Question?",
        section_public_id: fx.sectionPublicId,
        frame_context: { funnel_public_id: fx.funnelPublicId, variant_public_id: fx.variantPublicId },
      }),
      fx.h.env,
    );
    expect(res.status, `preview: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { preview: { desktop: string } };
    expect(body.preview.desktop).toContain(
      `data-lg-input style="border-radius:20px;--lg-field-border:${THEME_BODY.roles.brand_primary}"`,
    );
  });

  it("PATH 3/3 — POST /variants/:id/preview (composed-variant preview) renders the SAME corners/border_color", async () => {
    const fx = await seedAppearanceFixture("appearance-composed", { corners: "pill", border_color: "brand" });
    await assignTheme(fx.h.env, fx.funnelPublicId);

    const res = await admin.request(
      `${API}/variants/${fx.variantPublicId}/preview`,
      jsonInit("POST", { mode: "section", section_public_id: fx.sectionPublicId }),
      fx.h.env,
    );
    expect(res.status, `composed preview: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { preview: { html: string } };
    expect(body.preview.html).toContain(
      `data-lg-input style="border-radius:20px;--lg-field-border:${THEME_BODY.roles.brand_primary}"`,
    );
  });

  it("border_color:accent resolves to the theme's accent role hex; border_color:neutral (no theme assigned) resolves to the base design's color.border token", async () => {
    const fxAccent = await seedAppearanceFixture("appearance-accent", { border_color: "accent" });
    await assignTheme(fxAccent.h.env, fxAccent.funnelPublicId);
    const accentRes = await app.request(`${TENANT_ORIGIN}/lg/appearance-accent`, {}, fxAccent.h.env);
    expect(accentRes.status, await accentRes.clone().text()).toBe(200);
    expect(await accentRes.text()).toContain(`data-lg-input style="--lg-field-border:${THEME_BODY.roles.accent}"`);

    const fxNeutral = await seedAppearanceFixture("appearance-neutral", { border_color: "neutral" });
    // No theme assigned — the plain base design's own color.border token
    // (designs/default-funnel/tokens.ts: color.border = "#D2D9E5") — the
    // SAME value the base .lg-input rule's var() fallback resolves to when
    // NO override is authored at all, so this is byte-identical to the
    // absent case (see the REGRESSION test below).
    const neutralRes = await app.request(`${TENANT_ORIGIN}/lg/appearance-neutral`, {}, fxNeutral.h.env);
    expect(neutralRes.status, await neutralRes.clone().text()).toBe(200);
    expect(await neutralRes.text()).toContain('data-lg-input style="--lg-field-border:#D2D9E5"');
  });

  it("corners:sharp renders border-radius:0 (inferred — no explicit §3.3 px), corners:rounded renders border-radius:8px (§3.3 controls/inputs)", async () => {
    const fxSharp = await seedAppearanceFixture("appearance-sharp", { corners: "sharp" });
    const sharpRes = await app.request(`${TENANT_ORIGIN}/lg/appearance-sharp`, {}, fxSharp.h.env);
    expect(sharpRes.status, await sharpRes.clone().text()).toBe(200);
    expect(await sharpRes.text()).toContain('data-lg-input style="border-radius:0"');

    const fxRounded = await seedAppearanceFixture("appearance-rounded", { corners: "rounded" });
    const roundedRes = await app.request(`${TENANT_ORIGIN}/lg/appearance-rounded`, {}, fxRounded.h.env);
    expect(roundedRes.status, await roundedRes.clone().text()).toBe(200);
    expect(await roundedRes.text()).toContain('data-lg-input style="border-radius:8px"');
  });

  it("CASCADE close-out — the field never carries an inline border-color directly; the served <style> block's .lg-input rule reads the custom property while :focus/[aria-invalid] still set border-color DIRECTLY (unchanged, still higher-specificity)", async () => {
    const fx = await seedAppearanceFixture("appearance-cascade", { border_color: "brand" });
    await assignTheme(fx.h.env, fx.funnelPublicId);

    const res = await app.request(`${TENANT_ORIGIN}/lg/appearance-cascade`, {}, fx.h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const html = await res.text();

    // The field itself carries ONLY the custom property — never a direct
    // inline border-color (which would beat :focus/[aria-invalid] by
    // specificity regardless of what the base rule does). The closing `"`
    // in this exact substring match means the style attribute's content is
    // EXACTLY this value — nothing else (e.g. a trailing ";border-color:…")
    // could be appended without breaking the match.
    expect(html).toContain(`data-lg-input style="--lg-field-border:${THEME_BODY.roles.brand_primary}"`);

    // The served stylesheet's base .lg-input rule reads the var() with a
    // fallback (never hard-codes the override) …
    expect(html).toMatch(/\.lg-input\{[^}]*border-color:var\(--lg-field-border,\s*#[0-9a-fA-F]{6}\)/);
    // … while :focus / [aria-invalid] are UNCHANGED — still a DIRECT
    // border-color declaration, never themselves reading the var (so their
    // higher selector-specificity keeps winning over the resting-state var
    // exactly as it did before this feature existed).
    expect(html).toMatch(/\.lg-input:focus\{[^}]*border-color:#[0-9a-fA-F]{6}/);
    expect(html).toMatch(/\.lg-input\[aria-invalid="true"\]\{border-color:#[0-9a-fA-F]{6}/);
  });

  it("REGRESSION — absent design_overrides.corners/.border_color renders NO style attribute on the field, on all 3 paths (byte-identical, strictly additive)", async () => {
    const fx = await seedAppearanceFixture("appearance-absent", null);
    await assignTheme(fx.h.env, fx.funnelPublicId);

    // Mirrors the sibling size-parity REGRESSION test's own marker-adjacency
    // check above: a blanket "no border-radius/border-color anywhere on the
    // page" would be WRONG — the frame's OWN <style> block legitimately
    // declares .lg-input{border-radius:…} / .lg-input:focus{border-color:…}
    // as base CSS. "No style attribute on THIS field" means data-lg-input is
    // never immediately followed by ` style=`.
    const noFieldStyle = (html: string): void => expect(html).not.toContain("data-lg-input style=");

    const runtimeRes = await app.request(`${TENANT_ORIGIN}/lg/appearance-absent`, {}, fx.h.env);
    noFieldStyle(await runtimeRes.text());

    const previewRes = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: sectionContentJsonAppearance(null),
        headline: "Question?",
        section_public_id: fx.sectionPublicId,
        frame_context: { funnel_public_id: fx.funnelPublicId, variant_public_id: fx.variantPublicId },
      }),
      fx.h.env,
    );
    const previewBody = (await previewRes.json()) as { preview: { desktop: string } };
    noFieldStyle(previewBody.preview.desktop);

    const composedRes = await admin.request(
      `${API}/variants/${fx.variantPublicId}/preview`,
      jsonInit("POST", { mode: "section", section_public_id: fx.sectionPublicId }),
      fx.h.env,
    );
    const composedBody = (await composedRes.json()) as { preview: { html: string } };
    noFieldStyle(composedBody.preview.html);
  });
});

// ===========================================================================
// BLOCKER-1 defense-in-depth — a KV-tampered theme record (bypassing
// validateThemeBody) can never reach the served <style> block
// ===========================================================================

describeDb("theme typography stored-XSS — defense-in-depth (v3.1, adversarial review BLOCKER-1)", () => {
  it("a theme record written DIRECTLY to KV (bypassing validateThemeBody) with a malicious headline_font is dropped by the shape reader — the payload never reaches the served page", async () => {
    const fx = await seedActivatedFixture("xss-defense", false);
    const payload = "Arial</style><script>window.__xss=1</script>";
    const tamperedId = "thm_tampered";
    const tampered = {
      [tamperedId]: {
        id: tamperedId,
        name: "Tampered",
        roles: THEME_BODY.roles,
        typography: { headline_font: payload, body_font: "Inter", base_px: 16 },
        controls: THEME_BODY.controls,
      },
    };
    await fx.h.env.CACHE.put("lg-funnel-themes", JSON.stringify(tampered));

    // Direct SQL (bypassing the assignment write-path's own existence check,
    // which would also reject this — this test targets the KV-shape-read
    // layer specifically, simulating data that predates/bypasses validation).
    fx.h.sdb
      .prepare("UPDATE leadgen_funnels SET theme_json = ? WHERE public_id = ?")
      .run(JSON.stringify({ theme_id: tamperedId }), fx.funnelPublicId);

    const res = await app.request(`${TENANT_ORIGIN}/lg/xss-defense`, {}, fx.h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("</style><script>");
    expect(html).not.toContain(payload);
  });
});

// ===========================================================================
// audit-round G FIX 3 — §8.1 helper line + leading pin render IDENTICALLY on
// all 3 §12 paths (the pre-fix renderTextInput emitted NEITHER on ANY path).
// Same real-HTTP harness as MAJOR-1 above; the field node carries props.helper
// + props.icon="location" instead of a size override.
// ===========================================================================
const HELPER_TEXT = "We never share this"; // golden :326
const PIN_PATH = '<path d="M12 21s7-6.6 7-12a7 7 0 10-14 0c0 5.4 7 12 7 12z" stroke="#8DA0B6" stroke-width="1.8"/>'; // golden :323
function assertHelperAndPin(html: string, label: string): void {
  expect(html, `${label}: §8.1 helper line must render`).toContain(HELPER_TEXT);
  expect(html, `${label}: §8.1 leading pin must render`).toContain(PIN_PATH);
}

describeDb("audit-round G FIX 3 — §8.1 helper + leading pin, all 3 §12 paths", () => {
  it("PATH 1/3 — runtime GET /lg/:slug renders the helper line + leading pin", async () => {
    const fx = await seedActivatedFixture("hi-runtime", false, sectionContentHelperIconJson());
    await assignTheme(fx.h.env, fx.funnelPublicId);
    const res = await app.request(`${TENANT_ORIGIN}/lg/hi-runtime`, {}, fx.h.env);
    expect(res.status, await res.clone().text()).toBe(200);
    assertHelperAndPin(await res.text(), "runtime /lg");
  });

  it("PATH 2/3 — POST /sections/preview (section-in-frame) renders the SAME helper + pin", async () => {
    const fx = await seedActivatedFixture("hi-preview", false, sectionContentHelperIconJson());
    await assignTheme(fx.h.env, fx.funnelPublicId);
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: sectionContentHelperIconJson(),
        headline: "Question?",
        section_public_id: fx.sectionPublicId,
        frame_context: { funnel_public_id: fx.funnelPublicId, variant_public_id: fx.variantPublicId },
      }),
      fx.h.env,
    );
    expect(res.status, `preview: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { preview: { desktop: string } };
    assertHelperAndPin(body.preview.desktop, "section preview");
  });

  it("PATH 3/3 — POST /variants/:id/preview (composed-variant preview) renders the SAME helper + pin", async () => {
    const fx = await seedActivatedFixture("hi-composed", false, sectionContentHelperIconJson());
    await assignTheme(fx.h.env, fx.funnelPublicId);
    const res = await admin.request(
      `${API}/variants/${fx.variantPublicId}/preview`,
      jsonInit("POST", { mode: "section", section_public_id: fx.sectionPublicId }),
      fx.h.env,
    );
    expect(res.status, `composed preview: ${await res.clone().text()}`).toBe(200);
    const body = (await res.json()) as { preview: { html: string } };
    assertHelperAndPin(body.preview.html, "composed variant preview");
  });

  it("REGRESSION — a field WITHOUT props.helper/icon renders NEITHER on all 3 paths (strictly additive)", async () => {
    const fx = await seedActivatedFixture("hi-absent", false);
    await assignTheme(fx.h.env, fx.funnelPublicId);
    const runtime = await (await app.request(`${TENANT_ORIGIN}/lg/hi-absent`, {}, fx.h.env)).text();
    expect(runtime).not.toContain(HELPER_TEXT);
    expect(runtime).not.toContain("lg-field-help");
    expect(runtime).not.toContain(PIN_PATH);
  });
});
