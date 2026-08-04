// R2 P8 slice S4.1 — "applying a template must change what the page paints".
//
// OWNER ANCHOR: "how do I define it????" (docs/leadgen/source-of-truth) and the
// apply-template journey. CONTRACT: §4 R2-1, §6 M3 (server half), §6 M10
// (server half), §6 M1 + §4 R7 (render half).
//
// Every leg below drives the REAL producers end to end — the real admin
// handlers over the real leadgen migrations (node:sqlite), the real
// `PUT /funnels/:id/frame` save the Quote Builder performs, the real
// `POST /funnels/:id/apply-template` route, then the real DB row → real
// parseSavedFrameTemplateDefaults → real effectiveFrame → real renderQuoteFrame
// composition the visitor is served. Nothing on either side of a
// producer→consumer boundary is hand-built (E10/E11): the "before" state is
// written by the product's own save chain and the "after" state is read back
// out of the row the product's own route wrote.
//
// THE MEASUREMENT THIS FILE PINS (fail-before, taken on this branch — see the
// FAIL-BEFORE test below, which reproduces the pre-fix write verbatim):
//   a funnel that has ever been saved carries a COMPLETE frame_config_json
//   (the builder PUTs its whole hydrated frame, quotes-tabs/funnel.ts:1675),
//   and a complete funnel layer shadows every leaf a template carries. With a
//   template that disagreed on 46 leaves across nine element groups, the
//   pointer-only apply moved exactly ONE leaf of the served composition —
//   `template`, the identity string no CSS rule is keyed on — and the rendered
//   page was BYTE-IDENTICAL before and after the apply.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { Env } from "../src/env";
import {
  applyFrameTemplateToFunnelHandler,
  createFrameTemplateHandler,
  getFunnelFrameHandler,
  listFrameTemplateRecordsHandler,
  putFunnelFrameHandler,
} from "../src/admin/leadgen/frame-handlers";
import {
  createFunnelExperimentHandler,
  createQuoteHandler,
  forkVariantHandler,
  putVariantHandler,
  startExperimentHandler,
} from "../src/admin/leadgen/quotes-handlers";
import { LG_QUOTES_STYLES } from "../src/admin/leadgen/quotes-tabs/shared";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import {
  resolveEffectiveFrameOnly,
  resolveSavedFrameTemplateDefaultsFor,
} from "../src/public/leadgen/resolver";
import {
  computeTemplateApply,
  effectiveFrame,
  parseSavedFrameTemplateDefaults,
  validateFrameConfig,
} from "../src/public/leadgen/designs/frames";
import type { EffectiveFrameConfig, FrameConfig, StoredFrameConfig } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import { DEFAULT_FUNNEL_SCOPE, funnelChromeCss } from "../src/public/leadgen/designs/default-funnel/styles";
import type { SiteBranding } from "../src/leadgen/branding";

// --- node:sqlite harness (the repo pattern, mirrors leadgen-rework-handlers) --

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
    DB: db, CACHE: {} as KVNamespace, MEDIA: {} as R2Bucket,
    APP_ENV: "test", ADMIN_HOST: "localhost", ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin", CACHE_API_ENABLED: "false", HTML_CACHE_TTL_SECONDS: "60",
    DEV_BYPASS_AUTH: "true",
  } as Env;
}

// The REAL handlers on the REAL route shapes (router.ts:331-338 registers the
// same five rows; leadgen-rework-handlers.test.ts owns the router-reachability
// proof for this surface).
function buildApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post("/quotes", createQuoteHandler);
  app.get("/funnels/:id/frame", getFunnelFrameHandler);
  app.put("/funnels/:id/frame", putFunnelFrameHandler);
  app.post("/funnels/:id/apply-template", applyFrameTemplateToFunnelHandler);
  app.get("/frame-template-records", listFrameTemplateRecordsHandler);
  app.post("/frame-template-records", createFrameTemplateHandler);
  // The A/B-templates flow the Templates tab drives (quotes-tabs/templates.ts
  // wireAbTemplatesDialog: ensure a running test → fork the arm → point the new
  // arm's frame_template_id at the chosen template), on the SAME route shapes
  // router.ts registers.
  app.post("/funnels/:id/experiments", createFunnelExperimentHandler);
  app.post("/experiments/:id/start", startExperimentHandler);
  app.post("/variants/:id/fork", forkVariantHandler);
  app.put("/variants/:id", putVariantHandler);
  return app;
}

interface Harness { sdb: SqliteDb; env: Env; app: Hono<{ Bindings: Env }> }

const DatabaseSync = loadDatabaseSync();
const d = DatabaseSync === null ? describe.skip : describe;

function harness(): Harness {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)), app: buildApp() };
}

function jsonInit(method: string, body?: unknown): RequestInit {
  if (method === "GET" || method === "HEAD") return { method };
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function req(h: Harness, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await h.app.request(path, jsonInit(method, body), h.env as unknown as Record<string, unknown>);
  let json: unknown = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json };
}

// --- the visitor's composition, read back out of the REAL rows ---------------

const TOKENS = resolveTokens(defaultFunnelDesign);
const ROOT = {
  funnelId: "lgf_p8s41",
  funnelVariantId: "lgn_p8s41",
  quoteId: "lgq_p8s41",
  contentVersion: 1,
};

interface FunnelRow { id: number; public_id: string; frame_config_json: string | null; frame_template_id: number | null }
interface VariantRow { id: number; public_id: string; frame_overrides_json: string | null; frame_template_id: number | null }

function readFunnel(h: Harness, publicId: string): FunnelRow {
  return h.sdb.prepare("SELECT id, public_id, frame_config_json, frame_template_id FROM leadgen_funnels WHERE public_id = ?").get(publicId) as FunnelRow;
}

function readVariant(h: Harness, publicId: string): VariantRow {
  return h.sdb
    .prepare("SELECT id, public_id, frame_overrides_json, frame_template_id FROM leadgen_funnel_variants WHERE public_id = ?")
    .get(publicId) as VariantRow;
}

// ONE ARM's served frame, composed by the REAL runtime pair every visitor
// request walks: resolver.ts resolveSavedFrameTemplateDefaultsFor (the M5
// precedence `variant.frame_template_id ?? funnel.frame_template_id ??
// per-quote default`) feeding resolver.ts resolveEffectiveFrameOnly (template
// base ⊕ funnel frame_config_json ⊕ this arm's frame_overrides_json). Both
// sides are the REAL rows the real admin routes wrote — nothing hand-built
// (E10/E11).
async function armFrame(h: Harness, funnelPublic: string, variantPublic: string, quotePublic: string): Promise<EffectiveFrameConfig> {
  const funnel = readFunnel(h, funnelPublic);
  const variant = readVariant(h, variantPublic);
  const savedDefaults = await resolveSavedFrameTemplateDefaultsFor(h.env.DB, {
    funnel: funnel as unknown as Parameters<typeof resolveSavedFrameTemplateDefaultsFor>[1]["funnel"],
    variant: variant as unknown as Parameters<typeof resolveSavedFrameTemplateDefaultsFor>[1]["variant"],
    quote: { public_id: quotePublic } as unknown as Parameters<typeof resolveSavedFrameTemplateDefaultsFor>[1]["quote"],
  });
  const frame = resolveEffectiveFrameOnly({
    frame_config_json: funnel.frame_config_json,
    theme_json: null,
    frame_overrides_json: variant.frame_overrides_json,
    saved_template_defaults: savedDefaults,
  });
  if (frame === null) throw new Error(`no frame resolved for arm ${variantPublic}`);
  return frame;
}

// The SAME layers serve/resolver compose (frames.ts effectiveFrame with the
// funnel's saved-template row as its 4th argument), from the rows the real
// handlers wrote — never a hand-built config.
function servedFrame(h: Harness, publicId: string): EffectiveFrameConfig {
  const funnel = readFunnel(h, publicId);
  let savedDefaults: EffectiveFrameConfig | null = null;
  if (funnel.frame_template_id !== null) {
    const row = h.sdb.prepare("SELECT frame_json FROM leadgen_frame_templates WHERE id = ?").get(funnel.frame_template_id) as { frame_json: string } | undefined;
    savedDefaults = row === undefined ? null : parseSavedFrameTemplateDefaults(row.frame_json);
  }
  const stored = funnel.frame_config_json === null ? null : (JSON.parse(funnel.frame_config_json) as StoredFrameConfig);
  return effectiveFrame(stored, null, null, savedDefaults).frame;
}

function renderFrame(frame: EffectiveFrameConfig, sectionCount = 3, branding: SiteBranding | null = null): string {
  return renderQuoteFrame({
    effectiveTokens: TOKENS,
    frame,
    siteBranding: branding,
    sectionsHtml: "",
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount,
    root: ROOT,
  });
}

const renderOf = (h: Harness, publicId: string): string => renderFrame(servedFrame(h, publicId));
const sha = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 12);

function leaves(value: unknown, prefix: string, out: Map<string, unknown>): void {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      leaves(v, prefix === "" ? k : `${prefix}.${k}`, out);
    }
    return;
  }
  out.set(prefix, value);
}
function flat(value: unknown): Map<string, unknown> {
  const m = new Map<string, unknown>();
  leaves(value, "", m);
  return m;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// Leaves of the served composition that differ between two states.
function movedLeaves(before: EffectiveFrameConfig, after: EffectiveFrameConfig): string[] {
  const b = flat(before);
  const a = flat(after);
  const out: string[] = [];
  for (const [path, value] of a) if (!same(b.get(path), value)) out.push(path);
  for (const [path] of b) if (!a.has(path)) out.push(path);
  return out.sort();
}

// --- fixtures ----------------------------------------------------------------

// A funnel THE PRODUCT'S OWN SAVE CHAIN has saved: hydrate from the server's
// `effective_frame` projection (quotes-tabs/funnel.ts hydrationBase) and PUT
// that whole object back as frame_config_json (funnel.ts:1675). This is what
// makes the stored column complete, which is what shadowed the template.
async function newSavedFunnel(h: Harness): Promise<{ funnelPublic: string; saved: EffectiveFrameConfig }> {
  const quote = await req(h, "POST", "/quotes", { quote_name: "Q", activity: "quote_funnel", verticals: ["life"] });
  const funnelPublic = quote.json.funnels[0].public_id as string;
  const projection = await req(h, "GET", `/funnels/${funnelPublic}/frame`);
  expect(projection.status).toBe(200);
  const workingFrame = projection.json.effective_frame as EffectiveFrameConfig;
  // The operator's own customisations, made in the builder before any template
  // is applied — these are the leaves that must not vanish silently.
  workingFrame.header.tagline = "ROASTC operator tagline";
  workingFrame.back.label = "ROASTC go back";
  const put = await req(h, "PUT", `/funnels/${funnelPublic}/frame`, { frame_config_json: workingFrame });
  expect(put.status).toBe(200);
  const row = readFunnel(h, funnelPublic);
  expect(row.frame_config_json).not.toBeNull();
  return { funnelPublic, saved: workingFrame };
}

// A saved template record written by the REAL create route: the working frame
// of another arrangement family plus the operator's edits ("Save as template").
async function newSavedTemplate(h: Harness, name = "ROASTC Template"): Promise<{ publicId: string; id: number; frameJson: EffectiveFrameConfig }> {
  const frameJson = effectiveFrame("minimal").frame;
  frameJson.progress.style = "dots";
  frameJson.progress.position = "above_unit";
  frameJson.progress.thickness = "l";
  frameJson.progress.width = "full";
  frameJson.progress.show_label = true;
  frameJson.header.logo_align = "left";
  frameJson.header.logo_size = "s";
  frameJson.header.sticky = false;
  frameJson.header.secure_badge.enabled = true;
  frameJson.header.secure_badge.text = "ROASTC secure";
  frameJson.back.style = "button";
  frameJson.back.position = "below_card";
  frameJson.disclosure.enabled = true;
  frameJson.disclosure.location = "top_bar";
  frameJson.disclosure.text = "ROASTC disclosure copy";
  frameJson.footer.enabled = true;
  frameJson.footer.show_logo = true;
  frameJson.trust_strip.enabled = true;
  frameJson.trust_strip.placement = "below_unit";
  frameJson.trust_strip.logos = [{ media_id: "lg/trust1.png", alt: "ROASTC trusted by" }];
  frameJson.benefit_bar.enabled = true;
  frameJson.benefit_bar.placement = "bottom";
  frameJson.benefit_bar.items = [{ icon: "shield-check", text: "ROASTC benefit" }];
  frameJson.background.style = "brand";
  frameJson.background.role = "brand_primary";
  frameJson.section_slot.card = "bare";
  frameJson.section_slot.offset_y = "m";
  frameJson.section_slot.transition = "none";
  const created = await req(h, "POST", "/frame-template-records", { name, frame_json: frameJson });
  expect(created.status).toBe(201);
  return { publicId: created.json.public_id as string, id: created.json.id as number, frameJson };
}

// A SECOND saved template, of the other arrangement family, disagreeing with
// newSavedTemplate's on every leaf the legs below read. Same real create route.
async function newSavedTemplateB(h: Harness, name = "ROASTC Template B"): Promise<{ publicId: string; id: number; frameJson: EffectiveFrameConfig }> {
  const frameJson = effectiveFrame("centered").frame;
  frameJson.progress.style = "numbered";
  frameJson.progress.position = "in_card";
  frameJson.header.sticky = true;
  frameJson.header.logo_align = "right";
  frameJson.back.position = "footer";
  frameJson.footer.enabled = false;
  frameJson.background.style = "brand_gradient";
  frameJson.background.role = "brand_secondary";
  frameJson.section_slot.card = "card";
  const created = await req(h, "POST", "/frame-template-records", { name, frame_json: frameJson });
  expect(created.status).toBe(201);
  return { publicId: created.json.public_id as string, id: created.json.id as number, frameJson };
}

// A funnel exactly as POST /quotes creates it: frame_config_json NULL, ZERO
// operator edits, ever. The state F-1 was reproduced on.
async function newPristineFunnel(h: Harness): Promise<{ quotePublic: string; funnelPublic: string; variantPublic: string }> {
  const quote = await req(h, "POST", "/quotes", { quote_name: "Q", activity: "quote_funnel", verticals: ["life"] });
  expect(quote.status).toBe(201);
  const funnel = quote.json.funnels[0];
  const row = readFunnel(h, funnel.public_id as string);
  expect(row.frame_config_json, "a funnel nobody has saved carries no layout of its own").toBeNull();
  return { quotePublic: quote.json.public_id as string, funnelPublic: funnel.public_id as string, variantPublic: funnel.variants[0].public_id as string };
}

// The PRE-FIX write, verbatim from frame-handlers.ts before this slice:
// "UPDATE leadgen_funnels SET frame_template_id = ?, updated_at = unixepoch() WHERE id = ?".
function pointerOnlyApply(h: Harness, funnelPublic: string, templateId: number): void {
  const row = readFunnel(h, funnelPublic);
  h.sdb.prepare("UPDATE leadgen_funnels SET frame_template_id = ?, updated_at = unixepoch() WHERE id = ?").run(templateId, row.id);
}

const FRAME_CSS = funnelChromeCss(defaultFunnelDesign, DEFAULT_FUNNEL_SCOPE, { frameRegions: true });

// =============================================================================
d("P8 S4.1 — M3/R2-1: applying a template changes what the page paints", () => {
  it("FAIL-BEFORE: the pointer-only write moves ONE leaf (`template`) — nothing but the identity token", async () => {
    const h = harness();
    const { funnelPublic } = await newSavedFunnel(h);
    const tpl = await newSavedTemplate(h);

    const before = servedFrame(h, funnelPublic);
    const renderBefore = renderOf(h, funnelPublic);

    pointerOnlyApply(h, funnelPublic, tpl.id);

    const after = servedFrame(h, funnelPublic);
    const moved = movedLeaves(before, after);

    // Per-group census of what the template DISAGREED on vs what it moved.
    const fTpl = flat(tpl.frameJson);
    const fFunnel = flat(before);
    const perGroup = new Map<string, { shadowed: number; honoured: number }>();
    let comparable = 0;
    let shadowed = 0;
    const honoured: string[] = [];
    const fAfter = flat(after);
    for (const [path, templateValue] of fTpl) {
      if (!fFunnel.has(path) || same(fFunnel.get(path), templateValue)) continue;
      comparable++;
      const group = path.includes(".") ? path.slice(0, path.indexOf(".")) : path;
      const rec = perGroup.get(group) ?? { shadowed: 0, honoured: 0 };
      if (same(fAfter.get(path), templateValue)) { rec.honoured++; honoured.push(path); } else { rec.shadowed++; shadowed++; }
      perGroup.set(group, rec);
    }
    // eslint-disable-next-line no-console
    console.log(
      "[S4.1 FAIL-BEFORE] comparable leaves", comparable, "· shadowed", shadowed, "· honoured", honoured.length,
      "· per group", JSON.stringify([...perGroup].map(([g, r]) => `${g} ${r.shadowed}/${r.shadowed + r.honoured}`)),
    );

    // The contract's class, re-measured on this branch with a template that
    // disagrees across all nine element groups: EVERY leaf it carries is
    // shadowed by the funnel's own saved config except `template` itself — the
    // identity string no CSS rule is keyed on — and the visitor's page does not
    // move a byte. (Contract v3 measured 45/46 with its own fixture; this
    // fixture's own census is printed above and asserted structurally here, so
    // the pin survives an unrelated default change.)
    expect(perGroup.size).toBe(10); // nine element groups + `template`
    expect(comparable).toBeGreaterThanOrEqual(25);
    expect(honoured).toEqual(["template"]);
    expect(shadowed).toBe(comparable - 1);
    expect(moved).toEqual(["template"]);

    // The rendered page: the ONLY thing that moved is that identity token —
    // the root `.lg-frame--<id>` class, `data-frame-template`, and the header
    // region's NAME, which frame.ts keys off the same string
    // (TEMPLATE_HEADER_REGION:212). No layout, no region set, no colour, no
    // copy: with the identity token normalised away the two pages are
    // byte-identical, which is exactly the owner-visible "nothing happened".
    const renderAfter = renderOf(h, funnelPublic);
    const withoutIdentity = (html: string): string =>
      html
        .replace(/lg-frame--[a-z-]+"/, 'lg-frame--TPL"')
        .replace(/data-frame-template="[^"]*"/, 'data-frame-template="TPL"')
        .split('data-frame-region="header"').join('data-frame-region="HEAD"')
        .split('data-frame-region="logo"').join('data-frame-region="HEAD"');
    expect(renderAfter).not.toBe(renderBefore);
    expect(withoutIdentity(renderAfter)).toBe(withoutIdentity(renderBefore));
    // eslint-disable-next-line no-console
    console.log("[S4.1 FAIL-BEFORE] render", sha(renderBefore), "→", sha(renderAfter), "· identical once the identity token is normalised:", withoutIdentity(renderAfter) === withoutIdentity(renderBefore));
  });

  it("PASS-AFTER: the REAL apply-template route moves the page across every element group", async () => {
    const h = harness();
    const { funnelPublic } = await newSavedFunnel(h);
    const tpl = await newSavedTemplate(h);

    const before = servedFrame(h, funnelPublic);
    const renderBefore = renderOf(h, funnelPublic);

    const applied = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: tpl.publicId });
    expect(applied.status).toBe(200);
    expect(applied.json.frame_template_id).toBe(tpl.id);
    expect(applied.json.materialised).toBe(true);

    const after = servedFrame(h, funnelPublic);
    const renderAfter = renderOf(h, funnelPublic);
    const moved = movedLeaves(before, after);
    const groups = new Set(moved.filter((p) => p.includes(".")).map((p) => p.slice(0, p.indexOf("."))));
    // eslint-disable-next-line no-console
    console.log("[S4.1 PASS-AFTER] leaves moved", moved.length, "· groups", JSON.stringify([...groups].sort()), "· render", sha(renderBefore), "→", sha(renderAfter));

    // I1: the page paints differently, proven leaf-level across >= 3 groups
    // (measured: all nine, the exact set the FAIL-BEFORE leg found shadowed).
    expect(renderAfter).not.toBe(renderBefore);
    expect(groups.size).toBeGreaterThanOrEqual(9);
    expect(moved.length).toBeGreaterThanOrEqual(25);

    // Every leaf the template AUTHORED differently is now the template's value
    // in the SERVED composition — nothing shadowed. Every leaf the template is
    // SILENT about (null/empty/[]) keeps the operator's value — nothing wiped.
    const blank = (v: unknown): boolean =>
      v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
    const fTpl = flat(tpl.frameJson);
    const fBefore = flat(before);
    const fAfter = flat(after);
    const stillShadowed: string[] = [];
    const wiped: string[] = [];
    for (const [path, templateValue] of fTpl) {
      if (!fBefore.has(path) || same(fBefore.get(path), templateValue)) continue;
      if (blank(templateValue) && !blank(fBefore.get(path))) {
        if (!same(fAfter.get(path), fBefore.get(path))) wiped.push(path);
        continue;
      }
      if (!same(fAfter.get(path), templateValue)) stillShadowed.push(path);
    }
    expect(stillShadowed).toEqual([]);
    expect(wiped).toEqual([]);

    // …and the paint follows the config, in the REAL markup, per group:
    //   background / section_slot / progress / trust_strip / benefit_bar / footer.
    expect(renderBefore).toContain("lg-frame-bg-style-flat");
    expect(renderAfter).toContain("lg-frame-bg-style-brand");
    expect(renderAfter).toContain("lg-frame-bg-role-brand_primary");
    expect(renderBefore).toContain("lg-frame-slot--card");
    expect(renderAfter).toContain("lg-frame-slot--bare");
    expect(renderBefore).toContain("lg-frame-progress--bar");
    expect(renderAfter).toContain("lg-frame-progress--dots");
    expect(renderAfter).toContain("lg-frame-progress--th-l");
    expect(renderBefore).not.toContain("lg-frame-trust");
    expect(renderAfter).toContain("lg-frame-trust");
    expect(renderAfter).toContain("ROASTC trusted by");
    expect(renderBefore).not.toContain("ROASTC benefit");
    expect(renderAfter).toContain("ROASTC benefit");
    expect(renderAfter).toContain("ROASTC disclosure copy");

    // I1 second half: a leaf the template does NOT author keeps the operator's
    // own value — applying a template is not a silent wipe.
    expect(after.header.tagline).toBe("ROASTC operator tagline");
    expect(renderAfter).toContain("ROASTC operator tagline");

    // WHAT THE COLUMN NOW HOLDS (re-minted in FIX ROUND F4, strictly stronger).
    // Before F4 this leg asserted the template's own values were COPIED into
    // frame_config_json (`stored.section_slot.card === "bare"`, …). That copy is
    // exactly what shadowed a variant's own template (F-2) and what the confirm
    // dialog then miscounted as operator customisations (F-1). The requirement
    // it was standing in for — "the operator can see and edit these values in
    // the builder" — is a SERVED/PROJECTION fact, so it is asserted where it is
    // true: the builder hydrates from `effective_frame` (quotes-tabs/funnel.ts
    // hydrationBase), not from the raw column. Both halves are pinned here.
    const stored = JSON.parse(readFunnel(h, funnelPublic).frame_config_json ?? "{}") as Record<string, any>;
    const storedFlat = flat(stored);
    // …the operator's own leaves, kept:
    expect(stored.header.tagline).toBe("ROASTC operator tagline");
    // …and NOT one echo of the template's own base (the shadow F-2 lived in):
    expect(storedFlat.has("section_slot.card")).toBe(false);
    expect(storedFlat.has("progress.style")).toBe(false);
    expect(storedFlat.has("trust_strip.enabled")).toBe(false);
    // eslint-disable-next-line no-console
    console.log("[S4.1 PASS-AFTER] column leaves after apply", storedFlat.size, JSON.stringify([...storedFlat.keys()]));
    // …while the SERVED composition and the builder's own hydration source both
    // carry every one of them (the same leaves, read where they are true).
    expect(after.section_slot.card).toBe("bare");
    expect(after.progress.style).toBe("dots");
    expect(after.trust_strip.enabled).toBe(true);
    const projection = await req(h, "GET", `/funnels/${funnelPublic}/frame`);
    expect(projection.json.effective_frame.section_slot.card).toBe("bare");
    expect(projection.json.effective_frame.progress.style).toBe("dots");
    expect(projection.json.effective_frame.trust_strip.enabled).toBe(true);
    expect(projection.json.effective_frame.header.tagline).toBe("ROASTC operator tagline");
  });

  it("the confirm dialog's promises are computed from the real diff — each one is true in the rendered page", async () => {
    const h = harness();
    const { funnelPublic } = await newSavedFunnel(h);
    const tpl = await newSavedTemplate(h);

    // dry_run answers the dialog BEFORE anything is written.
    const dry = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: tpl.publicId, dry_run: true });
    expect(dry.status).toBe(200);
    expect(dry.json.applied).toBe(false);
    // nothing persisted by a dry run
    expect(readFunnel(h, funnelPublic).frame_template_id).not.toBe(tpl.id);
    const renderBefore = renderOf(h, funnelPublic);

    const confirmations = dry.json.confirmations as string[];
    // eslint-disable-next-line no-console
    console.log("[S4.1 confirmations]", JSON.stringify(confirmations));
    expect(confirmations).toContain("The question unit changes from a card to a bare layout.");
    expect(confirmations).toContain("Progress changes from a bar to dots.");
    expect(confirmations).toContain("A trust strip will be added.");
    expect(confirmations).toContain("A benefit bar will be added.");
    expect(confirmations).toContain("A disclosure will be added.");
    // R2 P8 FIX ROUND F4 / F-8: four leaves this apply moves that no sentence
    // named — announced by nothing but the (false) count. Each one is asserted
    // against the applied result further down.
    expect(confirmations).toContain("The header scrolls away with the page.");
    expect(confirmations).toContain("Progress moves above the question unit.");
    expect(confirmations).toContain("The back link moves below the card.");
    expect(confirmations).toContain("The page background colour becomes brand primary.");
    // The honesty line I1 requires — the operator is TOLD their own settings
    // are being replaced, with the real count.
    //
    // RE-MINTED in FIX ROUND F4 (F-1): this used to read
    // `toContain(`${replaced.length} settings …`)` — the sentence checked
    // against the very number that produced it, which is why it could not fail
    // while the dialog announced 28 customisations on a funnel whose operator
    // had authored two leaves. The count is now asserted against WHAT THIS
    // FIXTURE'S OPERATOR ACTUALLY DID: newSavedFunnel authors exactly two leaves
    // (header.tagline, back.label); the template is silent on the tagline (so it
    // survives — asserted above) and moves back.label, so exactly ONE
    // customisation is replaced, and the sentence is the singular one.
    const replaced = dry.json.replaced_customisations as string[];
    expect(replaced).toEqual(["back.label"]);
    expect(confirmations).toContain("1 setting you had customised is replaced by this template.");
    expect(confirmations.join(" ")).not.toContain("settings you had customised");
    // No internal clause markers or raw enum tokens in operator copy (R5).
    for (const line of confirmations) {
      expect(line).not.toContain("(§");
      expect(line).not.toContain("_");
    }

    // Now apply for real and check each promised sentence against the markup.
    const applied = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: tpl.publicId });
    expect(applied.json.confirmations).toEqual(confirmations);
    expect(applied.json.changes.length).toBe(dry.json.changes.length);
    const renderAfter = renderOf(h, funnelPublic);

    expect(renderBefore).toContain("lg-frame-slot--card");
    expect(renderAfter).toContain("lg-frame-slot--bare"); // "changes from a card to a bare layout"
    expect(renderAfter).toContain("lg-frame-progress--dots"); // "Progress changes from a bar to dots"
    expect(renderAfter).toContain("lg-frame-trust"); // "A trust strip will be added"
    expect(renderAfter).toContain("lg-frame-benefit"); // "A benefit bar will be added"
    expect(renderAfter).toContain("lg-frame-disclosure--top_bar"); // "A disclosure will be added"
    // F-8's four, each measured in the markup the visitor is served.
    expect(renderBefore).toContain("lg-frame-header--sticky");
    expect(renderAfter).toContain("lg-frame-header--static"); // "The header scrolls away with the page."
    expect(servedFrame(h, funnelPublic).progress.position).toBe("above_unit"); // "Progress moves above the question unit."
    expect(renderBefore).toContain("lg-frame-back--pos-in_card");
    expect(renderAfter).toContain("lg-frame-back--pos-below_card"); // "The back link moves below the card."
    expect(renderAfter).toContain("lg-frame-bg-role-brand_primary"); // "…colour becomes brand primary."

    // Every reported change is real: each `changes` row's `to` is the value
    // the SERVED composition now holds at that path.
    const fAfter = flat(servedFrame(h, funnelPublic));
    const changes = applied.json.changes as Array<{ path: string; from: unknown; to: unknown }>;
    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) {
      expect(fAfter.get(change.path) ?? null).toStrictEqual(change.to);
    }
  });

  it("re-applying the same template is a no-op: 0 changes, byte-identical page (I6)", async () => {
    const h = harness();
    const { funnelPublic } = await newSavedFunnel(h);
    const tpl = await newSavedTemplate(h);
    await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: tpl.publicId });
    const renderOnce = renderOf(h, funnelPublic);

    const again = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: tpl.publicId });
    expect(again.status).toBe(200);
    expect(again.json.changes).toEqual([]);
    expect(again.json.replaced_customisations).toEqual([]);
    expect(again.json.confirmations).toEqual([
      "This template matches what the funnel already shows — nothing on the page changes.",
    ]);
    expect(renderOf(h, funnelPublic)).toBe(renderOnce);
  });

  it("a funnel nobody applied a template to renders byte-identically through the whole journey (I6)", async () => {
    const h = harness();
    const untouched = await newSavedFunnel(h);
    const target = await newSavedFunnel(h);
    const tpl = await newSavedTemplate(h);

    const renderBefore = renderOf(h, untouched.funnelPublic);
    const storedBefore = readFunnel(h, untouched.funnelPublic).frame_config_json;

    await req(h, "POST", `/funnels/${target.funnelPublic}/apply-template`, { template_id: tpl.publicId });

    expect(readFunnel(h, untouched.funnelPublic).frame_config_json).toBe(storedBefore);
    expect(renderOf(h, untouched.funnelPublic)).toBe(renderBefore);
    expect(sha(renderOf(h, untouched.funnelPublic))).toBe(sha(renderBefore));
  });

  it("computeTemplateApply keeps a sparse template's silence: unauthored groups stay the operator's", () => {
    // The exact sparse shape the Templates tab saves when only the footer is
    // edited (leadgen-p3-saved-template-footer.test.ts documents this read-back).
    const sparse = {
      template: "centered",
      version: 1,
      footer: { enabled: true, blocks: [{ type: "about_paragraph", align: "left", text: "ROASTC about" }] },
    } as unknown as EffectiveFrameConfig;
    const funnelConfig = effectiveFrame("centered").frame as unknown as StoredFrameConfig;
    (funnelConfig as unknown as EffectiveFrameConfig).header.tagline = "ROASTC keep me";
    (funnelConfig as unknown as EffectiveFrameConfig).progress.style = "numbered";

    const applied = computeTemplateApply(funnelConfig, sparse, null);
    const after = effectiveFrame(applied.merged, null, null, sparse).frame;
    expect(after.footer.enabled).toBe(true);
    expect(after.header.tagline).toBe("ROASTC keep me");
    expect(after.progress.style).toBe("numbered"); // the template never spoke about progress
    expect(applied.replaced_customisations).not.toContain("progress.style");
  });
});

// =============================================================================
// R2 P8 FIX ROUND F4 — the two defects the materialise fix introduced.
//
// F-1: "9 settings you had customised are replaced by this template." on a
//      funnel whose operator has customised NOTHING — every one of the nine was
//      written by the PREVIOUS apply. The old leg below this one covered only
//      the FIRST apply and asserted the sentence against its own computed
//      count, so it was structurally unable to fail. This one drives THREE
//      consecutive applies and asserts the count against WHAT THE OPERATOR DID.
// F-2: applying a template wrote the funnel-level layer that shadows a
//      variant's own frame_template_id, so no forked arm could ever differ.
d("P8 F4 — F-1: the customisation warning counts the OPERATOR's edits, never a previous apply's writes", () => {
  it("apply #1 → apply #2 → an operator edit → apply #3: 0, 0, then exactly the one leaf the operator changed", async () => {
    const h = harness();
    const { funnelPublic } = await newPristineFunnel(h);
    const t1 = await newSavedTemplate(h, "ROASTC F1 One");
    const t2 = await newSavedTemplateB(h, "ROASTC F1 Two");

    // apply #1 — nothing of the operator's exists yet.
    const first = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t1.publicId });
    expect(first.status).toBe(200);
    expect(first.json.replaced_customisations).toEqual([]);

    // apply #2, dry run — the F-1 repro, verbatim. Every leaf the funnel now
    // carries came from apply #1; the operator has still customised nothing.
    const second = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t2.publicId, dry_run: true });
    expect(second.status).toBe(200);
    // eslint-disable-next-line no-console
    console.log("[F4 F-1] apply #2 dry run · changes", (second.json.changes as unknown[]).length, "· replaced", JSON.stringify(second.json.replaced_customisations));
    expect(second.json.replaced_customisations).toEqual([]);
    expect((second.json.confirmations as string[]).join(" ")).not.toContain("you had customised");
    // …while still saying what DOES change: silence is not the fix.
    expect((second.json.changes as unknown[]).length).toBeGreaterThan(0);
    expect((second.json.confirmations as string[]).length).toBeGreaterThan(0);

    // apply #2 for real, then ONE genuine operator edit through the REAL builder
    // save (quotes-tabs/funnel.ts PUTs its workingFrame — the stored config plus
    // the paths the operator touched).
    await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t2.publicId });
    const projection = await req(h, "GET", `/funnels/${funnelPublic}/frame`);
    const working = JSON.parse(JSON.stringify(projection.json.frame_config ?? {})) as Record<string, unknown>;
    const progress = (working["progress"] ?? {}) as Record<string, unknown>;
    progress["style"] = "percent"; // the operator's own choice, after an apply
    working["progress"] = progress;
    working["version"] = 1;
    const saved = await req(h, "PUT", `/funnels/${funnelPublic}/frame`, { frame_config_json: working });
    expect(saved.status).toBe(200);
    expect(saved.json.effective_frame.progress.style).toBe("percent");

    // apply #3, dry run — THAT edit, and only that edit, is the customisation.
    const third = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t1.publicId, dry_run: true });
    // eslint-disable-next-line no-console
    console.log("[F4 F-1] apply #3 dry run (after one operator edit) · replaced", JSON.stringify(third.json.replaced_customisations));
    expect(third.json.replaced_customisations).toEqual(["progress.style"]);
    expect(third.json.confirmations).toContain("1 setting you had customised is replaced by this template.");

    // …and applying it really does replace that edit (the sentence is true).
    await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t1.publicId });
    expect(servedFrame(h, funnelPublic).progress.style).toBe("dots");
  });

  it("an operator edit made BEFORE any template is applied is still warned about", async () => {
    const h = harness();
    const { funnelPublic } = await newSavedFunnel(h); // authors tagline + back label
    const tpl = await newSavedTemplate(h, "ROASTC F1 Saved");
    const dry = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: tpl.publicId, dry_run: true });
    const replaced = dry.json.replaced_customisations as string[];
    // eslint-disable-next-line no-console
    console.log("[F4 F-1] saved-funnel dry run · replaced", JSON.stringify(replaced));
    // The operator authored two leaves; the template is silent on the tagline
    // and moves the back label, so ONE customisation is replaced — not the 28
    // the whole-frame Save's echo used to be counted as.
    expect(replaced).toEqual(["back.label"]); // "ROASTC go back" → the template's own
    expect(dry.json.confirmations).toContain("1 setting you had customised is replaced by this template.");
    // The count is the count of the operator's own leaves, not of every change.
    expect(replaced.length).toBeLessThan((dry.json.changes as unknown[]).length);
  });
});

// =============================================================================
d("P8 F4 — F-2: a variant's own template wins for that arm, so A/B templates produce two different arms", () => {
  it("fork an arm on an APPLIED funnel, point it at another template: the two arms render differently, leaf by leaf", async () => {
    const h = harness();
    const { quotePublic, funnelPublic, variantPublic } = await newPristineFunnel(h);
    const t1 = await newSavedTemplate(h, "ROASTC Arm Base");
    const t2 = await newSavedTemplateB(h, "ROASTC Arm Other");

    // "Apply to funnel…" — the step that used to disable A/B-templating forever.
    const applied = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t1.publicId });
    expect(applied.status).toBe(200);

    // The Templates tab's own A/B flow: ensure a running test → fork → set the
    // new arm's template (quotes-tabs/templates.ts wireAbTemplatesDialog).
    const experiment = await req(h, "POST", `/funnels/${funnelPublic}/experiments`, { name: "ROASTC arms" });
    expect(experiment.status).toBe(201);
    const started = await req(h, "POST", `/experiments/${experiment.json.public_id}/start`, {});
    expect(started.status).toBe(200);
    const fork = await req(h, "POST", `/variants/${variantPublic}/fork`, {});
    expect(fork.status, `fork: ${JSON.stringify(fork.json)}`).toBe(201);
    const armBPublic = fork.json.public_id as string;
    const pointed = await req(h, "PUT", `/variants/${armBPublic}`, { frame_template_id: t2.id });
    expect(pointed.status, `point the arm: ${JSON.stringify(pointed.json)}`).toBe(200);
    expect(pointed.json.frame_template_id).toBe(t2.id);

    // Both arms, composed by the REAL runtime resolver and rendered by the REAL
    // renderer.
    const armA = await armFrame(h, funnelPublic, variantPublic, quotePublic);
    const armB = await armFrame(h, funnelPublic, armBPublic, quotePublic);
    const htmlA = renderFrame(armA);
    const htmlB = renderFrame(armB);
    const moved = movedLeaves(armA, armB);
    // eslint-disable-next-line no-console
    console.log("[F4 F-2] arms · leaves differing", moved.length, "· render", sha(htmlA), "vs", sha(htmlB), "· sample", JSON.stringify(moved.slice(0, 8)));

    expect(htmlB).not.toBe(htmlA);
    expect(moved.length).toBeGreaterThanOrEqual(5);
    // Each arm renders ITS OWN template, not the funnel's materialised config.
    expect(armA.progress.style).toBe("dots");
    expect(armB.progress.style).toBe("numbered");
    expect(armA.section_slot.card).toBe("bare");
    expect(armB.section_slot.card).toBe("card");
    expect(armA.background.style).toBe("brand");
    expect(armB.background.style).toBe("brand_gradient");
    expect(htmlA).toContain("lg-frame-progress--dots");
    expect(htmlB).toContain("lg-frame-progress--numbered");
    expect(htmlA).toContain("lg-frame-slot--bare");
    expect(htmlB).toContain("lg-frame-slot--card");
  });

  it("the funnel's OWN authored leaves still win over an arm's template — an apply is not a licence to overwrite the operator", async () => {
    const h = harness();
    const { quotePublic, funnelPublic, variantPublic } = await newPristineFunnel(h);
    const t1 = await newSavedTemplate(h, "ROASTC Arm Base 2");
    const t2 = await newSavedTemplateB(h, "ROASTC Arm Other 2");
    await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t1.publicId });

    // The operator's own funnel-level choice, made after the apply.
    const projection = await req(h, "GET", `/funnels/${funnelPublic}/frame`);
    const working = JSON.parse(JSON.stringify(projection.json.frame_config ?? {})) as Record<string, unknown>;
    working["header"] = { ...((working["header"] ?? {}) as Record<string, unknown>), tagline: "ROASTC funnel-wide tagline" };
    working["version"] = 1;
    expect((await req(h, "PUT", `/funnels/${funnelPublic}/frame`, { frame_config_json: working })).status).toBe(200);

    const experiment = await req(h, "POST", `/funnels/${funnelPublic}/experiments`, { name: "ROASTC arms 2" });
    await req(h, "POST", `/experiments/${experiment.json.public_id}/start`, {});
    const fork = await req(h, "POST", `/variants/${variantPublic}/fork`, {});
    const armBPublic = fork.json.public_id as string;
    await req(h, "PUT", `/variants/${armBPublic}`, { frame_template_id: t2.id });

    const armB = await armFrame(h, funnelPublic, armBPublic, quotePublic);
    expect(armB.header.tagline, "the funnel's own authored leaf still applies to every arm").toBe("ROASTC funnel-wide tagline");
    expect(armB.progress.style, "…while the arm's template decides everything the funnel did not author").toBe("numbered");
  });
});

// =============================================================================
d("P8 S4.1 — M10 (server half): a saved template can have a real thumbnail", () => {
  it("every saved-template read carries thumbnail_html derived from the row's OWN values", async () => {
    const h = harness();
    const tpl = await newSavedTemplate(h, "ROASTC Thumb");

    const list = await req(h, "GET", "/frame-template-records");
    expect(list.status).toBe(200);
    const row = (list.json.items as any[]).find((t) => t.public_id === tpl.publicId);
    const thumb = row.thumbnail_html as string;
    // eslint-disable-next-line no-console
    console.log("[S4.1 M10 thumbnail]", thumb);

    // Identity + the bands the row's own config implies (bare slot, dots
    // progress, brand background, trust + benefit + footer on).
    expect(thumb).toContain(`data-template-thumb="${tpl.publicId}"`);
    expect(thumb).toContain("lg-tpl-thumb--bg-brand");
    expect(thumb).toContain("lg-tpl-slot--bare");
    expect(thumb).toContain("lg-tpl-progress--dots");
    expect(thumb).toContain("lg-tpl-disclosure");
    expect(thumb).toContain("lg-tpl-trust");
    expect(thumb).toContain("lg-tpl-benefit");
    expect(thumb).toContain("lg-tpl-footer");
    // Every band class the thumb emits is a class the ADMIN SHEET paints —
    // no invented hooks (the picker CSS lives in quotes-tabs/shared.ts).
    expect(thumb).toContain('class="lg-tpl-band lg-tpl-slot lg-tpl-slot--bare"');

    // The 6 seeded built-ins each get one too, and a row whose config differs
    // gets a DIFFERENT picture (the thumbnail is data, not decoration).
    const others = (list.json.items as any[]).filter((t) => t.public_id !== tpl.publicId);
    expect(others.length).toBeGreaterThanOrEqual(6);
    for (const other of others) expect(typeof other.thumbnail_html).toBe("string");
    expect(new Set((list.json.items as any[]).map((t) => t.thumbnail_html)).size).toBeGreaterThan(1);
  });

  // R2 P8 FIX ROUND F4 / F-5 — "White + trust bar" painted a trust band its own
  // config switches OFF: frameThumbnailData fired the band on
  // `trust_strip.placement === "footer"` (and on the built-ins' arrangement
  // prose), while the renderer emits the region ONLY when `enabled` is true
  // (frame.ts renderTrustStripRegion). The picture must be the paint.
  it("a saved record's bands are the regions the REAL renderer emits — never a placement or a prose word the config disables", async () => {
    const h = harness();
    // The measured row, re-created through the REAL create route.
    const whiteTrust = effectiveFrame("minimal").frame;
    whiteTrust.trust_strip.enabled = false;
    whiteTrust.trust_strip.placement = "footer";
    whiteTrust.benefit_bar.enabled = false;
    const created = await req(h, "POST", "/frame-template-records", { name: "ROASTC White + trust bar", frame_json: whiteTrust });
    expect(created.status).toBe(201);
    // …and one row that genuinely carries a strip, so the leg proves the band
    // is DERIVED, not merely absent everywhere.
    const withStrip = await newSavedTemplate(h, "ROASTC With trust");

    const list = await req(h, "GET", "/frame-template-records");
    const items = list.json.items as any[];
    const rows: string[] = [];
    for (const item of items) {
      const { frame } = effectiveFrame(null, null, null, item.frame_json as EffectiveFrameConfig);
      const html = renderFrame(frame);
      const bandTrust = (item.thumbnail_html as string).includes("lg-tpl-trust");
      const bandBenefit = (item.thumbnail_html as string).includes("lg-tpl-benefit");
      const paintsTrust = html.includes('data-frame-region="trust_strip"');
      const paintsBenefit = html.includes('data-frame-region="benefit_bar"');
      rows.push(`${item.name}: trust band=${bandTrust}/paint=${paintsTrust} benefit band=${bandBenefit}/paint=${paintsBenefit}`);
      expect(bandTrust, `${item.name}: trust band vs rendered region`).toBe(paintsTrust);
      expect(bandBenefit, `${item.name}: benefit band vs rendered region`).toBe(paintsBenefit);
      // the data twin the island mounts says the same thing
      expect((item.thumbnail.bands as string[]).some((b) => b.includes("lg-tpl-trust"))).toBe(paintsTrust);
    }
    // eslint-disable-next-line no-console
    console.log("[F4 F-5] band vs paint, per record\n  " + rows.join("\n  "));
    const white = items.find((t) => t.public_id === created.json.public_id);
    expect(white.thumbnail_html).not.toContain("lg-tpl-trust");
    const strip = items.find((t) => t.public_id === withStrip.publicId);
    expect(strip.thumbnail_html).toContain("lg-tpl-trust");
  });

  // R2 P8 F2 (N12 fallout): a funnel whose logo is aligned `right` must not
  // render `center` in the thumbnail band — that would be the thumbnail
  // LYING about the arrangement (M10's whole point). Drives the REAL create
  // + list round trip for all three FRAME_LOGO_ALIGNS values.
  it("logo alignment paints a DIFFERENT thumbnail band for left / center / right — the band must not lie about the arrangement", async () => {
    const h = harness();
    for (const align of ["left", "center", "right"] as const) {
      const frameJson = effectiveFrame("minimal").frame;
      frameJson.header.logo_align = align;
      const created = await req(h, "POST", "/frame-template-records", { name: `ROASTC Logo ${align}`, frame_json: frameJson });
      expect(created.status).toBe(201);
      const list = await req(h, "GET", "/frame-template-records");
      const row = (list.json.items as any[]).find((t) => t.public_id === created.json.public_id);
      const thumb = row.thumbnail_html as string;
      // frame-handlers.ts (unowned, unchanged here) already emits the real
      // per-align class — the gap this leg proves closed is the PAINT for it.
      expect(thumb).toContain(`class="lg-tpl-band lg-tpl-logo lg-tpl-logo--${align}"`);
    }
    // quotes-tabs/shared.ts (owned here) must give `left` and `right` their
    // OWN, DIFFERENT declarations — pre-fix, only `--left` existed, so a
    // `right`-aligned funnel's thumbnail fell through to the base
    // `.lg-tpl-logo{margin:0 auto}` rule and rendered indistinguishable from
    // `center`. `center` needs no override — it IS that base rule's default.
    expect(LG_QUOTES_STYLES).toContain(".lg-tpl-logo--left{margin:0}");
    expect(LG_QUOTES_STYLES).toContain(".lg-tpl-logo--right{margin:0 0 0 auto}");
  });
});

// =============================================================================
// M1 + R7 (render half). The owner: "I chose 'icon on track' - where is the
// icon on track??? how do I define it????"
//
// R2 P8 FIX ROUND F2: `custom` SHIPPED. designs/frames.ts's own note (right
// above FRAME_PROGRESS_ICONS) names the four pieces an earlier ENUM-ALONE
// attempt was missing — the PAINT (default-funnel/styles.ts now emits the
// image-mark pseudo pair for `.lg-frame-progress--icon-custom` exactly as it
// has for `--icon-site_logo` since P7), `progress.icon_media_id` (the
// operator's OWN media pick), the operator control, and the dead-controls-
// guard universe — and all four now land together, so `custom` walks the
// IDENTICAL resolve-URL → CSS-custom-property → pseudo-pair path `site_logo`
// already walks (frame.ts:519-535). Offering it is no longer the "control
// that cannot be honoured" §4 R3 forbids. The state below is what IS true
// today.
d("P8 S4.1 — M1/R7: the icon source today — seven built-ins, two reach an image", () => {
  it("`custom` — the operator's own picked image — validates and paints the SAME path as `site_logo`, with the SAME dot fallback when it can't resolve", () => {
    const validation = validateFrameConfig({ progress: { style: "icon_on_track", icon: "custom" } });
    expect(validation.config).not.toBeNull(); // `custom` is offered — F2 shipped it
    expect(validation.problems.some((p) => p.severity === "error" && p.path === "frame.progress.icon")).toBe(false);

    // The operator's OWN image, stamped as the identical CSS custom property
    // `site_logo` rides.
    const withImage = renderFrame(effectiveFrame("centered", { progress: { style: "icon_on_track", icon: "custom", icon_media_id: "picked-mark.png" } } as unknown as FrameConfig).frame);
    expect(withImage).toContain('style="--lg-progress-icon-url:url(&quot;/media/picked-mark.png&quot;)"');
    expect(FRAME_CSS).toContain("background-image:var(--lg-progress-icon-url)");
    // …and it is keyed on its OWN class, painted by the identical pair
    // `site_logo` uses (styles.ts emits both from one loop — §4 R1).
    expect(FRAME_CSS).toContain(".lg-frame-progress--icon-custom .lg-progress-fill::before");

    // No image authored at all → the plain dot, never an empty url().
    const noImage = renderFrame(effectiveFrame("centered", { progress: { style: "icon_on_track", icon: "custom" } } as unknown as FrameConfig).frame);
    expect(noImage).toContain("lg-frame-progress--icon-dot");
    expect(noImage).not.toContain("--lg-progress-icon-url");

    // The stronger negative leg: an UNUSABLE media reference (fails the
    // cssSafeMarkUrl gate BOTH mark sources share, e.g. a stray quote) must
    // fall back to the SAME plain dot, never leak a broken/unsafe url() into
    // the stylesheet.
    const unresolvable = renderFrame(effectiveFrame("centered", { progress: { style: "icon_on_track", icon: "custom", icon_media_id: 'bad"key' } } as unknown as FrameConfig).frame);
    expect(unresolvable).toContain("lg-frame-progress--icon-dot");
    expect(unresolvable).not.toContain("--lg-progress-icon-url");
  });
});

// =============================================================================
// M1 render truths, RE-MEASURED on this branch (the contract's three shas were
// taken at an older sha; two of the three verdicts changed).
d("P8 S4.1 — M1: the three progress render truths, re-measured", () => {
  const renderPatch = (patch: FrameConfig): string => renderFrame(effectiveFrame("centered", patch).frame);

  it("'Show label' is honoured by four of the five styles — `numbered` is the reported conflict", () => {
    // Four styles: ON and OFF are distinct renders (re-measured, unchanged).
    for (const style of ["dots", "bar", "percent", "icon_on_track"] as const) {
      const sOn = renderPatch({ progress: { style, show_label: true } } as unknown as FrameConfig);
      const sOff = renderPatch({ progress: { style, show_label: false } } as unknown as FrameConfig);
      expect(sOff).not.toBe(sOn);
    }
    // `numbered`: the contract's finding reproduced on this branch. The one-
    // line fix (add `lg-frame-progress--no-label`, whose painted rule is
    // asserted below to exist) contradicts the assertion at
    // test/leadgen-frame-progress-back.test.ts:98, '"numbered" always shows the
    // step label (that IS the style)', taken on the DEFAULT config — a file
    // outside this slice. Measured here, NOT pinned as desired behaviour: the
    // number is reported for the ruling, and this leg asserts only the two
    // facts that ruling needs — the switch is inert, and the mechanism that
    // would honour it is already painted.
    const on = renderPatch({ progress: { style: "numbered", show_label: true } } as unknown as FrameConfig);
    const off = renderPatch({ progress: { style: "numbered", show_label: false } } as unknown as FrameConfig);
    // eslint-disable-next-line no-console
    console.log("[S4.1 M1 show_label numbered — CONFLICT, unfixed] on", sha(on), "off", sha(off), "identical:", on === off);
    expect(FRAME_CSS).toContain(".lg-frame-progress--no-label .lg-progress-text{display:none}");
  });

  it("alignment now moves the unit, not only inline label text", () => {
    const left = renderPatch({ progress: { align: "left" } } as unknown as FrameConfig);
    const center = renderPatch({ progress: { align: "center" } } as unknown as FrameConfig);
    const right = renderPatch({ progress: { align: "right" } } as unknown as FrameConfig);
    // eslint-disable-next-line no-console
    console.log("[S4.1 M1 align] l/c/r", sha(left), sha(center), sha(right));
    expect(new Set([left, center, right]).size).toBe(3);
    // The width band centres the unit with margin:auto, which text-align (the
    // only rule keyed on --align-left/right) cannot override — so the margins
    // ride the region itself.
    expect(FRAME_CSS).toContain(".lg-frame-progress--w-content{max-width:");
    expect(left).toContain('style="margin-left:0;margin-right:auto"');
    expect(right).toContain('style="margin-left:auto;margin-right:0"');
    expect(center).not.toContain("margin-left");
    // …and it composes with the icon URL in ONE style attribute on the region
    // (two `style=` attributes on one element would silently drop the second).
    const both = renderFrame(
      effectiveFrame("centered", { progress: { style: "icon_on_track", icon: "site_logo", align: "right" } } as unknown as FrameConfig).frame,
      3,
      { site_name: "Acme", logo_url: "/media/m.png", tagline: null, legal_links: [], trust_logos: null },
    );
    const progressTag = (both.match(/<div class="lg-frame-region lg-frame-progress[^>]*>/) ?? [""])[0];
    expect(progressTag.match(/style="/g) ?? []).toHaveLength(1);
    expect(both).toContain('style="--lg-progress-icon-url:url(&quot;/media/m.png&quot;);margin-left:auto;margin-right:0"');
  });

  it("position under_header vs above_unit: identical ONLY when nothing sits between them", () => {
    const under = renderPatch({ progress: { position: "under_header" } } as unknown as FrameConfig);
    const above = renderPatch({ progress: { position: "above_unit" } } as unknown as FrameConfig);
    // The contract's finding, reproduced: with an empty band between the two
    // slots the two positions ARE the same place in the document.
    expect(under).toBe(above);
    // But the control is honoured — put a back link between them and the
    // progress region moves across it.
    const underBack = renderPatch({ progress: { position: "under_header" }, back: { style: "text", position: "under_header_left" } } as unknown as FrameConfig);
    const aboveBack = renderPatch({ progress: { position: "above_unit" }, back: { style: "text", position: "under_header_left" } } as unknown as FrameConfig);
    // eslint-disable-next-line no-console
    console.log("[S4.1 M1 position] empty band", sha(under), sha(above), "· with a back link", sha(underBack), sha(aboveBack));
    expect(underBack).not.toBe(aboveBack);
    const at = (html: string, name: string): number => html.indexOf(`data-frame-region="${name}"`);
    expect(at(underBack, "progress")).toBeLessThan(at(underBack, "back"));
    expect(at(aboveBack, "progress")).toBeGreaterThan(at(aboveBack, "back"));
  });
});
