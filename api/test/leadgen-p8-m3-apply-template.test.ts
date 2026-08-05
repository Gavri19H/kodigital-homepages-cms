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
// THE MEASUREMENT THIS FILE PINS (taken on this branch — see the
// CHARACTERISATION test below, which reproduces the pre-fix write verbatim):
//   a real Save PUTs the STORED column (`frame_config`) plus only the paths
//   the session actually touched (quotes-tabs/funnel.ts:1809, :1921-1933) —
//   NEVER a complete hydrated frame (that premise, corrected in FIX ROUND
//   F11, was false: the builder's hydration source, `effective_frame`, only
//   POPULATES control values, :1877-1886 — it is never the PUT body). So a
//   funnel with two operator edits carries those two leaves plus the identity
//   pair `writeConfigValue` stamps beside every frame write (`template`,
//   `version` — added in FIX ROUND F13), and because today's read-side merge
//   already resolves `frame_template_id` into the composition regardless of
//   materialisation, a pointer-only apply against THAT realistic column moves
//   every OTHER comparable leaf straight to the newly-pointed template.
//   RE-MEASURED in F13 (the run's own log line, after the fixture's two edits
//   moved to leaves a control really offers — see newSavedFunnel): the
//   template disagrees on 28 comparable leaves over ten census groups (nine
//   element groups + the `template` identity leaf), the pointer-only apply
//   shadowed EXACTLY the two the operator had genuinely customised, and
//   honoured the other 26 —
//     [S4.1 CHARACTERISATION] comparable leaves 28 · shadowed 2 · honoured 26
//     · per group ["template 0/1","header 1/5","progress 0/5","back 0/2",
//       "disclosure 0/3","footer 0/1","trust_strip 0/2","benefit_bar 0/3",
//       "background 1/3","section_slot 0/3"]
//   (The text F13 replaced carried 29 · 2 · 27 for the same class with the
//   previous, unauthorable pair of edits, and attributed 28 shadowed / 1
//   honoured to the hand-built-dump fixture before that. Both are quoted as
//   this file's prior text, NOT re-measured here.)
//
// MINOR-3 (FIX ROUND F12), REVISED IN F13 — WHAT THIS MEANS FOR THE
// CHARACTERISATION LEG'S NAME. F12 wrote here that the bare pointer-only
// write's SERVED-PAGE outcome and the real route's PASS-AFTER outcome were
// "the same shape on this fixture … a 2-leaf difference in HOW that is
// counted, shadowed vs. stillShadowed, never a difference in WHICH leaves are
// right". That was true only of a fixture whose two operator edits were
// leaves NO template touches. It is FALSE of the F13 fixture, and the two
// legs' own assertions are what falsify it: CHARACTERISATION asserts the
// pointer-only write leaves `shadowedPaths` == ["background.image_media_id",
// "header.logo_align"], while PASS-AFTER asserts the real route leaves
// `stillShadowed` == []. `header.logo_align` is a leaf the template AUTHORS,
// so the pointer-only write serves the operator's "right" where the real
// route serves the template's "left" — a difference in WHICH leaves are
// right, visible as two different after-shas in the two legs' render logs
// (both start from the same before-sha). So the leg below is a genuine
// pre-fix/post-fix render contrast again, on top of the contrasts F12 listed:
// the confirm dialog/dry-run/`replaced_customisations` count (no route at all
// under a raw SQL write) — "the confirm dialog's promises…" and the F4 F-1
// describe block; the prune/preservation semantics — the F9 F-B describe
// block, whose own header cites the literal pre-fix log; and the cross-arm
// materialise leak — the F4 F-2 describe block. Its NAME is left as
// CHARACTERISATION rather than re-renamed to FAIL-BEFORE: renaming it is a
// judgement about what the leg is FOR, which belongs to the owner of the
// slice, not to a fixture-fidelity fix.
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

// The operator's own picked background image, and the public URL
// media-url.ts mediaUrl() turns that bare storage key into.
const OPERATOR_BG_MEDIA_ID = "lg/roastc-operator-bg.png";
const OPERATOR_BG_SRC = `src="/media/${OPERATOR_BG_MEDIA_ID}"`;

// The product's own `writeConfigValue` (quotes-tabs/funnel.ts:1921-1933,
// read-only here), mirrored statement for statement: `setPath` the ONE dotted
// path the control owns into `workingFrame` (the loop is funnel.ts:1798-1807),
// then stamp the identity pair the island stamps beside every frame write —
// `template`, once, from `currentTemplateId()`, and `version = 1`.
function writeConfigValue(workingFrame: Record<string, unknown>, currentTemplateId: string, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = workingFrame;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    const next = cur[part];
    if (next === null || typeof next !== "object" || Array.isArray(next)) cur[part] = {};
    cur = cur[part] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1] as string] = value;
  if (workingFrame["template"] === undefined) workingFrame["template"] = currentTemplateId;
  workingFrame["version"] = 1;
}

// FIX ROUND F14 — THE ONE PLACE THIS FILE IS ALLOWED TO SAVE A FUNNEL LAYOUT.
// The real builder Save, end to end: boot `workingFrame` from the STORED
// column the projection returns (funnel.ts:1809 — never `effective_frame`),
// run each edited control's `writeConfigValue` over it (mirrored above,
// identity stamp included), then PUT the whole still-sparse result (:1696).
//
// FOUR separate sites in this file used to hand-roll that sequence, and all
// four stamped only `version`: `newSavedFunnel` (F13 fixed that one), the F4
// F-1 post-apply edit, `operatorSets` in the F9 block, and the F4 F-2
// funnel-wide edit (F14 folded those three in here). The sharpest evidence
// that this was wrong and not merely untidy: `operatorSets`'s own describe
// block quotes a DRIVEN j12 log recording the real column as
// {"version":1,"template":"centered","header":{"logo_align":"left"}}, while
// the assertion 25 lines below it demanded a column with no `template` key at
// all — the log and the test contradicted each other for four fix rounds.
// Routing every "the operator edits X" step through ONE function is what stops
// that class recurring: a leg can no longer invent a column shape the product
// cannot produce.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function operatorSaves(
  h: Harness,
  funnelPublic: string,
  edits: ReadonlyArray<readonly [string, unknown]>,
): Promise<{ status: number; json: any }> {
  const projection = await req(h, "GET", `/funnels/${funnelPublic}/frame`);
  expect(projection.status, `frame projection for ${funnelPublic}`).toBe(200);
  // The STORED column (`frame_config`), not the `effective_frame`
  // projection — a pristine funnel's is `{}`.
  const workingFrame = JSON.parse(JSON.stringify(projection.json.frame_config ?? {})) as Record<string, unknown>;
  // `currentTemplateId()` verbatim (funnel.ts:1836-1840): the working frame's
  // own stamp, else the served projection's, else 'centered'.
  const currentTemplateId =
    ((workingFrame["template"] as string | undefined) ||
      (projection.json.effective_frame?.template as string | undefined) ||
      "centered") as string;
  for (const [path, value] of edits) writeConfigValue(workingFrame, currentTemplateId, path, value);
  return req(h, "PUT", `/funnels/${funnelPublic}/frame`, { frame_config_json: workingFrame });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// A funnel THE PRODUCT'S OWN SAVE CHAIN has saved, through `operatorSaves`
// directly above (which is where the funnel.ts:1809 / writeConfigValue /
// :1696 citations now live — the projection's `effective_frame` is never the
// PUT body; it only feeds `hydrationBase()`/`clientEffective()`, :1877-1886).
// So a pristine funnel (frame_config_json NULL -> `workingFrame` starts `{}`)
// with the operator's two edits below saves the funnel's OWN difference, never
// a full projection.
//
// FIX ROUND F13 — the two ways this fixture used to misdescribe that chain:
//
// (a) IT WROTE `version` BUT NEVER `template`, so the column was a shape no
//     Save can produce. `writeConfigValue` stamps both (funnel.ts:1928-1929);
//     the value a pristine funnel stamps is `currentTemplateId()`'s second
//     fallback, `effective_frame.template` (:1838) = "centered"
//     (frames.ts:51 DEFAULT_FRAME_TEMPLATE_ID) — the exact column the F9
//     block's verbatim j12 log further down records at its step 2,
//     `{"version":1,"template":"centered","header":{"logo_align":"left"}}`.
//     The stamp changes no census number here: frames.ts:944 destructures
//     `template`/`version` straight back out of the funnel layer before the
//     merge, and the id stamped is the one a template-less funnel already
//     resolved to.
//
// (b) ITS TWO "OPERATOR EDITS" WERE LEAVES NO OPERATOR CAN AUTHOR. MEASURED
//     on this branch:
//       grep -rn 'header\.tagline' src/admin  ->  0 hits
//       grep -rn 'back\.label'     src/admin  ->  1 hit, and it is a
//         normalisation map, not a control (quotes-tabs/funnel.ts:2016
//         `var NOT_NULLABLE_TEXT_KEYS = { 'back.label': 1, … }`)
//     The two used below are REAL offered controls, each measured by its own
//     grep against src/admin:
//       header.logo_align         quotes-tabs/templates.ts:191
//         frameSelect("Alignment", "header.logo_align", FRAME_LOGO_ALIGNS, …)
//       background.image_media_id quotes-tabs/templates.ts:162
//         mediaPickerControl("Background image (optional, from the Media
//         library)", "background.image_media_id") — which emits
//         `data-frame-key="background.image_media_id"` via shared.ts:1146
//         -> mediaFieldMarkup (:1137).
//     They are also the two SHAPES the legs below read: `newSavedTemplate`
//     AUTHORS header.logo_align ("left", differing from this operator's
//     "right"), so exactly ONE customisation is replaced and the dialog's
//     singular sentence stays a real assertion; and it is SILENT on
//     background.image_media_id (the base default is `null`, frames.ts:697,
//     and the fixture never sets it), so "silence never erases" keeps a
//     subject — one that PAINTS, as `<img class="lg-frame-bg-img"
//     src="/media/…">` (frame.ts renderBackgroundRegion :696, the <img> at
//     :701).
async function newSavedFunnel(h: Harness): Promise<{ funnelPublic: string; saved: EffectiveFrameConfig }> {
  const quote = await req(h, "POST", "/quotes", { quote_name: "Q", activity: "quote_funnel", verticals: ["life"] });
  const funnelPublic = quote.json.funnels[0].public_id as string;
  // The operator's own customisations, made in the builder before any template
  // is applied — these are the leaves that must not vanish silently. Each is
  // one control's `writeConfigValue` call, on a key that control really offers
  // (the greps above).
  const put = await operatorSaves(h, funnelPublic, [
    ["header.logo_align", "right"],
    ["background.image_media_id", OPERATOR_BG_MEDIA_ID],
  ]);
  expect(put.status).toBe(200);
  const row = readFunnel(h, funnelPublic);
  expect(row.frame_config_json).not.toBeNull();
  // F13 — the column this fixture claims the product's Save produces, MEASURED
  // rather than described: the two edited paths plus the identity pair, and the
  // stamped id is the one the j12 log records ("centered"). If this ever drifts
  // the fixture has stopped being what its comment above says it is.
  expect(JSON.parse(row.frame_config_json ?? "{}")).toStrictEqual({
    header: { logo_align: "right" },
    background: { image_media_id: OPERATOR_BG_MEDIA_ID },
    template: "centered",
    version: 1,
  });
  return { funnelPublic, saved: put.json.effective_frame as EffectiveFrameConfig };
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
  // RENAMED in FIX ROUND F12 (MINOR-3) from "FAIL-BEFORE: …". Read the
  // MINOR-3 note in the file-top comment block first — F13 revised it. This
  // leg reproduces the literal pre-M3 handler body (`pointerOnlyApply`, a bare
  // SQL pointer write, nothing else) against the SAME realistic fixture
  // PASS-AFTER uses below.
  //
  // F13 CORRECTION to F12's rationale for the rename: F12 wrote that the two
  // legs "differ only by how the preserved-vs-replaced count is taken
  // (shadowed here, stillShadowed in PASS-AFTER), never by which leaves are
  // right". On the F13 fixture that is false, and this leg's own assertions
  // say so: `header.logo_align` is an operator edit the template AUTHORS, so
  // the pointer-only write below serves the operator's "right" (asserted:
  // `shadowedPaths` contains it) where the real route serves the template's
  // "left" (asserted in PASS-AFTER: `stillShadowed` is empty). The two legs
  // therefore end on different served pages from the same starting page.
  //
  // What this leg proves either way: the read-side merge alone ALREADY
  // repaints a funnel on a bare pointer write — the wholesale "template apply
  // silently does nothing" risk was never the gap — while what a pointer-only
  // write still cannot do is warn the operator, offer a dry run, or name the
  // one setting of theirs it is about to overrule. Those are pinned by name in
  // "the confirm dialog's promises…" + the F4 F-1 block, the F9 F-B block
  // (prune/preservation), and the F4 F-2 block (cross-arm leak).
  it("CHARACTERISATION: the bare pointer-only write (pre-M3, reproduced verbatim) already shadows ONLY the operator's own two edits on a realistic column", async () => {
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
    const shadowedPaths: string[] = [];
    const fAfter = flat(after);
    for (const [path, templateValue] of fTpl) {
      if (!fFunnel.has(path) || same(fFunnel.get(path), templateValue)) continue;
      comparable++;
      const group = path.includes(".") ? path.slice(0, path.indexOf(".")) : path;
      const rec = perGroup.get(group) ?? { shadowed: 0, honoured: 0 };
      if (same(fAfter.get(path), templateValue)) { rec.honoured++; honoured.push(path); } else { rec.shadowed++; shadowed++; shadowedPaths.push(path); }
      perGroup.set(group, rec);
    }
    // eslint-disable-next-line no-console
    console.log(
      "[S4.1 CHARACTERISATION] comparable leaves", comparable, "· shadowed", shadowed, "· honoured", honoured.length,
      "· per group", JSON.stringify([...perGroup].map(([g, r]) => `${g} ${r.shadowed}/${r.shadowed + r.honoured}`)),
    );

    // RE-MEASURED in FIX ROUND F13 against a REALISTIC saved column (see
    // newSavedFunnel's own comment — a real Save PUTs the stored column plus
    // only the touched paths, plus the `template`/`version` identity stamp;
    // never a complete dump). Because today's read-side merge (frames.ts
    // effectiveFrame) already resolves `frame_template_id` into
    // `savedTemplateDefaults` regardless of materialisation, a pointer-only
    // write against that column already moves every OTHER comparable leaf —
    // only the operator's own two edits (never a template artefact) continue
    // to win, because the funnel's own JSON always deep-merges last.
    //
    // WHAT F13 MOVED IN THESE NUMBERS, and why: the fixture's two operator
    // edits changed from `header.tagline` + `back.label` (no control offers
    // either) to `header.logo_align` + `background.image_media_id` (both real
    // controls). `comparable` counts the leaves where the template disagrees
    // with the funnel's SERVED "before", so moving which leaves the operator
    // authored necessarily moves it. MEASURED by the console.log directly
    // above, this run: comparable 28 · shadowed 2 · honoured 26 (the text F13
    // replaced carried 29 · 2 · 27 for the previous pair — quoted from this
    // file, not re-run). `shadowed` is the invariant — it is
    // the operator's own edits, whichever two they are. The `template` stamp
    // itself moved nothing: frames.ts:944 destructures `template`/`version`
    // out of the funnel layer before merging, and the stamped id is the one a
    // template-less funnel already resolved to.
    expect(perGroup.size).toBe(10); // nine element groups + `template`
    expect(comparable).toBeGreaterThanOrEqual(25);
    expect(shadowedPaths.sort()).toEqual(["background.image_media_id", "header.logo_align"]); // the operator's own two edits, named
    expect(shadowed).toBe(2);
    expect(honoured).toContain("template");
    expect(honoured.length).toBe(comparable - 2);
    expect(moved).not.toContain("header.logo_align"); // preserved, not moved
    expect(moved).not.toContain("background.image_media_id"); // preserved, not moved
    expect(moved.length).toBeGreaterThanOrEqual(comparable - 2);

    // The rendered page: the operator's own picked background image still
    // paints, while the template's arrangement otherwise takes over — the
    // OPPOSITE of this file's earlier (false, hand-built-fixture)
    // "byte-identical" claim. What a pointer-only write still does NOT do
    // (the real gap the M3 fix closes): warn the operator, offer a dry run, or
    // name which of their own settings survives. F13 correction — the line
    // that used to stand here ("it simply happens to land correctly here
    // because this fixture's funnel never customised anything the template
    // touches") was false and is now measurably so: `header.logo_align` IS a
    // leaf this template authors, and the shadow census above names it, so a
    // pointer-only write leaves the operator's "right" on a page the operator
    // was never told the template wanted "left".
    const renderAfter = renderOf(h, funnelPublic);
    expect(renderAfter).not.toBe(renderBefore);
    expect(renderAfter).toContain(OPERATOR_BG_SRC);
    expect(renderAfter).toContain("lg-frame-slot--bare");
    expect(renderAfter).toContain("lg-frame-trust");
    // eslint-disable-next-line no-console
    console.log("[S4.1 CHARACTERISATION] render", sha(renderBefore), "→", sha(renderAfter), "· moved leaves", moved.length, "· shadowed", JSON.stringify(shadowedPaths.sort()));
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

    // I1: the page paints differently, proven leaf-level across >= 3 groups.
    // F13 correction — the parenthetical that stood here, "(measured: all
    // nine, the exact set the FAIL-BEFORE leg found shadowed)", was false in
    // its second half: the CHARACTERISATION leg above finds exactly TWO
    // shadowed leaves, in two groups. MEASURED here by the console.log
    // directly above, this run: 27 leaves moved over 9 groups — back,
    // background, benefit_bar, disclosure, footer, header, progress,
    // section_slot, trust_strip.
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

    // I1 second half: a leaf the template is SILENT on keeps the operator's own
    // value — applying a template is not a silent wipe. F13 note: the leaf is
    // now the operator's own picked background image (a real control, see
    // newSavedFunnel), and the template's silence is the base default `null`,
    // pinned here rather than asserted in prose.
    expect(tpl.frameJson.background.image_media_id, "the template really is silent on the operator's background image").toBeNull();
    expect(after.background.image_media_id).toBe(OPERATOR_BG_MEDIA_ID);
    expect(renderAfter).toContain(OPERATOR_BG_SRC);

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
    // …the operator's own leaf the template is silent on, kept:
    expect(stored.background.image_media_id).toBe(OPERATOR_BG_MEDIA_ID);
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
    expect(projection.json.effective_frame.background.image_media_id).toBe(OPERATOR_BG_MEDIA_ID);
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
    // FIXTURE'S OPERATOR ACTUALLY DID: newSavedFunnel authors exactly two
    // leaves, each through a control the admin really offers
    // (header.logo_align, background.image_media_id — the greps live in
    // newSavedFunnel's comment). The template is SILENT on the background
    // image (its value there is the base default `null`, pinned in the
    // PASS-AFTER leg above) so that one survives, and it OVERRULES
    // header.logo_align ("left" over the operator's "right"), so exactly ONE
    // customisation is replaced and the sentence is the singular one.
    const replaced = dry.json.replaced_customisations as string[];
    expect(replaced).toEqual(["header.logo_align"]);
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
    // F14: both operator leaves are keys a control really offers —
    // `background.image_media_id` (templates.ts:162 mediaPickerControl) and
    // `progress.style` (templates.ts:716 + :725, the rendered radios carrying
    // data-frame-key="progress.style"; :1955 is the island's own selector for
    // them). The leaf
    // that used to stand in the first slot, `header.tagline`, has 0 hits in
    // src/admin, so calling it an operator's value was untrue of the product.
    const funnelConfig = effectiveFrame("centered").frame as unknown as StoredFrameConfig;
    (funnelConfig as unknown as EffectiveFrameConfig).background.image_media_id = OPERATOR_BG_MEDIA_ID;
    (funnelConfig as unknown as EffectiveFrameConfig).progress.style = "numbered";

    const applied = computeTemplateApply(funnelConfig, sparse, null);
    const after = effectiveFrame(applied.merged, null, null, sparse).frame;
    expect(after.footer.enabled).toBe(true);
    expect(after.background.image_media_id).toBe(OPERATOR_BG_MEDIA_ID); // the template never spoke about background
    expect(after.progress.style).toBe("numbered"); // …nor about progress
    expect(applied.replaced_customisations).not.toContain("progress.style");
    expect(applied.replaced_customisations).not.toContain("background.image_media_id");
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
    // save (`operatorSaves` — the stored config plus the paths the operator
    // touched plus the identity stamp).
    await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t2.publicId });
    // `progress.style` — a real offered control (templates.ts:716 + :725, the
    // rendered radios carrying data-frame-key="progress.style"). F14 routed
    // this write through `operatorSaves`; before, it hand-rolled the column.
    const saved = await operatorSaves(h, funnelPublic, [["progress.style", "percent"]]);
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
    const { funnelPublic } = await newSavedFunnel(h); // authors header.logo_align + background.image_media_id
    const tpl = await newSavedTemplate(h, "ROASTC F1 Saved");
    const dry = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: tpl.publicId, dry_run: true });
    const replaced = dry.json.replaced_customisations as string[];
    // eslint-disable-next-line no-console
    console.log("[F4 F-1] saved-funnel dry run · replaced", JSON.stringify(replaced));
    // The operator authored two leaves; the template is silent on the picked
    // background image and overrules the logo alignment, so ONE customisation
    // is replaced — not the 28 the whole-frame Save's echo used to be counted
    // as.
    expect(replaced).toEqual(["header.logo_align"]); // the operator's "right" → the template's "left"
    expect(dry.json.confirmations).toContain("1 setting you had customised is replaced by this template.");
    // The count is the count of the operator's own leaves, not of every change.
    expect(replaced.length).toBeLessThan((dry.json.changes as unknown[]).length);
  });
});

// =============================================================================
// R2 P8-4 FIX ROUND F9 — F-B: THE PRUNE DELETED THE OPERATOR'S OWN VALUES.
//
// THE INVARIANT THESE LEGS PIN: a value the operator chose is never silently
// discarded — it is either PRESERVED in the funnel column, or NAMED in the
// warning the confirm dialog shows before the write.
//
// FAIL-BEFORE (fresh-context reviewer, driven API-only against the running
// instance — docs/leadgen/r2/evidence/p8/review-p8-4b/REVIEW.md, `j12` log,
// reproduced verbatim):
//   2 operator sets header.logo_align = "left"  -> column {"version":1,"template":"centered","header":{"logo_align":"left"}}
//   3 apply "Site header + footer" (base = left) DRY: replaced=[]  header.logo_align in changes? false
//   4 after apply                              -> column {"version":1,"template":"header-footer"}   <- the operator's leaf is GONE
//   5 apply "Centered card" DRY: replaced=[]   changes=[{path:"header.logo_align",from:"left",to:"center"}]
//                                               sentences mentioning the logo: []
//   6 FINAL logo_align = center                (the operator chose left)
// F4's pruneEchoedLeaves dropped ANY leaf equal to the newly-applied template's
// base, and its own comment claimed the loss was "still announced by name in
// `changes` and in the sentences below" — measured false: `changes` is not shown
// to the operator and `confirmations` narrates only ~8 leaf shapes, none of them
// the logo. So the leaf vanished at step 4 and the value flipped at step 6 with
// no signal anywhere.
//
// The scenario below is that log, step for step, through the REAL routes: the
// operator's edit goes in the way quotes-tabs/funnel.ts really saves it
// (workingFrame = the stored column + the ONE path the control wrote, PUT to
// /funnels/:id/frame), and every read is the SERVED composition or the stored
// column, never a hand-built object.
// =============================================================================
d("P8 F9 — F-B: an operator's chosen value is preserved, or named — never silently dropped", () => {
  // ONE control's edit, saved the way the product saves it. F14: this used to
  // hand-roll the working frame and stamped only `version`, so the column it
  // produced was a shape no Save can produce — and specifically NOT the column
  // the driven j12 log quoted in this block's header records at step 2. It now
  // delegates to `operatorSaves` (the single mirror of funnel.ts:1809 ->
  // writeConfigValue -> :1696), so the log and the assertion below agree.
  async function operatorSets(h: Harness, funnelPublic: string, group: string, key: string, value: unknown): Promise<void> {
    const saved = await operatorSaves(h, funnelPublic, [[`${group}.${key}`, value]]);
    expect(saved.status, `operator save ${group}.${key}: ${JSON.stringify(saved.json)}`).toBe(200);
  }
  const column = (h: Harness, funnelPublic: string): Record<string, unknown> => {
    const raw = readFunnel(h, funnelPublic).frame_config_json;
    return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>);
  };

  it("the j12 scenario, step for step: the leaf the operator chose survives the apply that agrees with it, and is NAMED by the apply that overrules it", async () => {
    const h = harness();
    const { funnelPublic } = await newPristineFunnel(h);
    const agrees = await newSavedTemplate(h, "ROASTC F9 Agrees"); // header.logo_align = "left"
    const overrules = await newSavedTemplateB(h, "ROASTC F9 Overrules"); // header.logo_align = "right"
    expect(agrees.frameJson.header.logo_align, "the fixture really agrees with the operator").toBe("left");
    expect(overrules.frameJson.header.logo_align, "…and the other really disagrees").toBe("right");

    // step 2 — the operator's own choice, against a base that says "center".
    expect(servedFrame(h, funnelPublic).header.logo_align).toBe("center");
    await operatorSets(h, funnelPublic, "header", "logo_align", "left");
    // F14: now byte-for-byte the column the j12 log in this block's header
    // records at its step 2 — `template` included. Before F14 this assertion
    // demanded a column with no `template` key, contradicting that log.
    expect(column(h, funnelPublic)).toStrictEqual({ version: 1, template: "centered", header: { logo_align: "left" } });

    // step 3/4 — apply the template whose base ALSO says left. The served page
    // does not move, so there is nothing to warn about…
    const dryAgrees = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: agrees.publicId, dry_run: true });
    expect(dryAgrees.status).toBe(200);
    expect((dryAgrees.json.changes as Array<{ path: string }>).map((c) => c.path)).not.toContain("header.logo_align");
    await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: agrees.publicId });
    // …and PRESERVATION is what makes that silence honest: the leaf is still
    // the operator's, in the column, not absorbed into the template.
    const afterAgrees = column(h, funnelPublic);
    // eslint-disable-next-line no-console
    console.log("[F9 F-B] column after the agreeing apply", JSON.stringify(afterAgrees));
    expect((afterAgrees["header"] as Record<string, unknown> | undefined)?.["logo_align"], "the operator's leaf is PRESERVED").toBe("left");
    expect(servedFrame(h, funnelPublic).header.logo_align).toBe("left");

    // step 5 — the template that overrules it MUST say so, by name and in the
    // sentence the dialog paints.
    const dryOverrules = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: overrules.publicId, dry_run: true });
    const replaced = dryOverrules.json.replaced_customisations as string[];
    // eslint-disable-next-line no-console
    console.log("[F9 F-B] overruling apply · replaced", JSON.stringify(replaced), "· confirmations", JSON.stringify(dryOverrules.json.confirmations));
    expect(replaced, "the operator's own leaf is counted as a customisation").toContain("header.logo_align");
    expect((dryOverrules.json.confirmations as string[]).join(" "), "…and the dialog says so").toContain("you had customised");
    expect((dryOverrules.json.changes as Array<{ path: string }>).map((c) => c.path)).toContain("header.logo_align");

    // step 6 — the template really does win, which is why step 5 had to warn.
    await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: overrules.publicId });
    expect(servedFrame(h, funnelPublic).header.logo_align).toBe("right");
  });

  it("a value that differs from EVERY template base: preserved when the template is silent, named when it is not", async () => {
    const h = harness();
    const { funnelPublic } = await newPristineFunnel(h);
    const t1 = await newSavedTemplate(h, "ROASTC F9 Diff One");
    const t2 = await newSavedTemplateB(h, "ROASTC F9 Diff Two");

    // `background.image_media_id` — a REAL offered control (templates.ts:162
    // mediaPickerControl) that BOTH saved records leave at the base default
    // `null` (frames.ts:697), i.e. both are silent on it, so "silence never
    // erases" must hold across BOTH applies. F14 replaced `header.tagline`
    // here: it satisfied the same silence premise but has 0 hits in src/admin,
    // so no operator could ever have set it. The silence premise is pinned
    // below rather than asserted in prose.
    await operatorSets(h, funnelPublic, "background", "image_media_id", OPERATOR_BG_MEDIA_ID);
    // …and `progress.thickness` (templates.ts:821 segmentedControl) — the
    // operator picks a value that is neither base's: t1's base says "l", t2's
    // says the schema default "m".
    await operatorSets(h, funnelPublic, "progress", "thickness", "s");
    expect(t1.frameJson.background.image_media_id, "t1 really is silent on the background image").toBeNull();
    expect(t2.frameJson.background.image_media_id, "…and so is t2").toBeNull();
    expect(t1.frameJson.progress.thickness).toBe("l");
    expect(t2.frameJson.progress.thickness).toBe("m");

    const dry1 = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t1.publicId, dry_run: true });
    const replaced1 = dry1.json.replaced_customisations as string[];
    // eslint-disable-next-line no-console
    console.log("[F9 F-B] differs-from-every-base · replaced", JSON.stringify(replaced1));
    expect(replaced1, "the leaf this template overrules is named").toContain("progress.thickness");
    expect(replaced1, "the leaf it says nothing about is not").not.toContain("background.image_media_id");
    expect((dry1.json.confirmations as string[]).join(" ")).toContain("you had customised");

    await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t1.publicId });
    const served = servedFrame(h, funnelPublic);
    expect(served.background.image_media_id, "silence never erases the operator's own pick").toBe(OPERATOR_BG_MEDIA_ID);
    expect(served.progress.thickness, "…and the warned-about leaf really is replaced").toBe("l");
    expect(
      ((column(h, funnelPublic)["background"] ?? {}) as Record<string, unknown>)["image_media_id"],
      "the preserved leaf stays IN THE COLUMN, so the next template must warn about it too",
    ).toBe(OPERATOR_BG_MEDIA_ID);

    // The next template still owes the operator the same warning for the leaf
    // it kept — the failure mode F-B described was the SECOND apply going quiet.
    const dry2 = await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t2.publicId, dry_run: true });
    expect((dry2.json.changes as Array<{ path: string }>).map((c) => c.path)).not.toContain("background.image_media_id");
    expect(servedFrame(h, funnelPublic).background.image_media_id).toBe(OPERATOR_BG_MEDIA_ID);
  });

  it("an apply never WRITES a leaf of its own into the column — so a leaf found there is the operator's", async () => {
    const h = harness();
    const { funnelPublic } = await newPristineFunnel(h);
    const t1 = await newSavedTemplate(h, "ROASTC F9 Sub One");
    const t2 = await newSavedTemplateB(h, "ROASTC F9 Sub Two");
    const nonIdentityLeaves = (): string[] =>
      [...flat(column(h, funnelPublic)).keys()].filter((k) => k !== "template" && k !== "version").sort();

    await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t1.publicId });
    // eslint-disable-next-line no-console
    console.log("[F9 F-B] column leaves after apply #1 on a pristine funnel", JSON.stringify(nonIdentityLeaves()));
    expect(nonIdentityLeaves(), "apply #1 materialises nothing the base already gives").toEqual([]);

    await operatorSets(h, funnelPublic, "progress", "style", "percent");
    const before = nonIdentityLeaves();
    expect(before).toEqual(["progress.style"]);

    // Applying twice more can only SHRINK that set (the operator authored
    // nothing new); it can never grow, which is what makes "present in the
    // column" mean "the operator chose it".
    await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t2.publicId });
    for (const leaf of nonIdentityLeaves()) expect(before, `apply #2 invented ${leaf}`).toContain(leaf);
    await req(h, "POST", `/funnels/${funnelPublic}/apply-template`, { template_id: t1.publicId });
    for (const leaf of nonIdentityLeaves()) expect(before, `apply #3 invented ${leaf}`).toContain(leaf);
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

    // The operator's own funnel-level choice, made after the apply, through the
    // real Save. F14 moved this off `header.tagline` (0 hits in src/admin, so
    // unauthorable) and onto `header.logo_align` (templates.ts:191 frameSelect)
    // — which makes the leg STRICTLY stronger than before: "center" is a value
    // the arm's own template CONTENDS for (t2 authors "right", t1 "left"), so
    // the funnel layer is now proven to win a real contest rather than an
    // uncontested one. The "…the arm's template decides what the funnel did not
    // author" half is unchanged, still carried by progress.style below.
    expect(t1.frameJson.header.logo_align, "t1 contends for this leaf").toBe("left");
    expect(t2.frameJson.header.logo_align, "…and so does the arm's own template").toBe("right");
    expect((await operatorSaves(h, funnelPublic, [["header.logo_align", "center"]])).status).toBe(200);

    const experiment = await req(h, "POST", `/funnels/${funnelPublic}/experiments`, { name: "ROASTC arms 2" });
    await req(h, "POST", `/experiments/${experiment.json.public_id}/start`, {});
    const fork = await req(h, "POST", `/variants/${variantPublic}/fork`, {});
    const armBPublic = fork.json.public_id as string;
    await req(h, "PUT", `/variants/${armBPublic}`, { frame_template_id: t2.id });

    const armB = await armFrame(h, funnelPublic, armBPublic, quotePublic);
    expect(armB.header.logo_align, "the funnel's own authored leaf still applies to every arm").toBe("center");
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
