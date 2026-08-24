// LeadGen v2.5 Phase C — `POST /sections/preview` frame_context extension
// (redesign-contract-v2.5 13 §13.4 sections/preview row + 05 §5.3 mode 5) and
// the DEV-57 sectionCtx thread through renderSectionComponentsVisible.
//
//   §13.4: `{frame_context?: {funnel_public_id, variant_public_id?, site_id?}}`
//   — when present the CURRENT unit renders INSIDE that funnel's effective
//   frame via the SAME renderQuoteFrame composition the runtime shell and the
//   variant preview use; absent → today's unit-only path BYTE-IDENTICAL
//   (proven below against a PRE-CHANGE fixture capture); existing design_id /
//   viewport / sim params stay honored in-frame; unknown funnel → 404; a
//   NULL-frame funnel composes via the byte-pinned legacy shell (the same
//   §13.1 fail-safe fork the variant preview takes).
//
// BYTE-PIN PROTOCOL (legacy unit-only capture): the two fixtures under
// test/fixtures/leadgen-section-preview-frame/ were minted from the
// PRE-CHANGE handler (before the frame_context branch and the sectionCtx
// thread landed). Every response field must stay byte-identical, with THREE
// documented exceptions: `preview.css` moved (a) the `.lg-card-subtitle` /
// `.lg-card{position:relative}` / `.lg-card-badge` rules (DEV-57 Phase-C
// item) and (b) the FIX-4a `--lg-sel-bg` consuming rule (DEV-68) from the
// frameRegions-gated block into the base sheet (each carried by a
// coordinated legacy-pin re-pin on the shell/variant surfaces), and (c) the
// R5 state-safe-border grant (register R3a ROUTING NOTES): the
// `.lg-btn.lg-btn-answer` and `.lg-card` BASE rules each gained ONE appended
// declaration — `border-color:var(--lg-field-border, #D2D9E5);` — so a
// per-node design_overrides.border_color rides the custom property (state-
// safe) instead of a direct border-color that would beat the :hover/
// [aria-checked]/[data-selected] rules by inline-style specificity — so the
// css assertion is: live css with the R5 rule bodies mapped back to their
// PRE-R5 text, MINUS exactly the DEV-57/DEV-68 moved chunks, == captured
// css, plus producer equality with funnelChromeCss. Re-mint deliberately with
//   LEADGEN_PIN_UPDATE=1 npx vitest run test/leadgen-section-preview-frame.test.ts
// (an update run fails on purpose; rerun without the flag to verify).

import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import {
  CMS_FALLBACK_LOGO_TEXT,
  LG_BANNERS_MOUNT_HTML,
  renderLegacyShell,
} from "../src/public/leadgen/designs/frame";
import { getFunnelDesign } from "../src/public/leadgen/designs/registry";
import {
  DEFAULT_FUNNEL_SCOPE,
  FUNNEL_DESIGN_SCOPE_ATTR,
  funnelChromeCss,
} from "../src/public/leadgen/designs/default-funnel/styles";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";
import {
  renderSectionComponents,
  renderSectionComponentsVisible,
} from "../src/public/leadgen/components/presets";
import type { LeadgenSectionRenderCtx } from "../src/public/leadgen/components/presets";
import type { LeadgenComponentNode } from "../src/public/leadgen/components/content-schema";
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
    // Real Cloudflare KV list() filters by `options.prefix` — the LIVE §28
    // cache-invalidation sweep (invalidate.ts deleteByPrefix) relies on this
    // to scope its list+delete to `lg-shell:`/`lg-config:` keys ONLY. A stub
    // that ignored `prefix` would report EVERY key as matching an unrelated
    // prefix sweep — a TEST-FIDELITY gap that never happens against real KV,
    // where the prefix filter is enforced server-side (found + fixed while
    // building the v3.1 Themes KV store, leadgen-v31-themes*.test.ts).
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
  "0042_leadgen_pages.sql",
  "0043_leadgen_routing_rules.sql",
  "0044_leadgen_redirect_pct.sql",
  "0045_leadgen_persona_quota.sql",
  // Rework P1 (§5 M1-M12): the full migration set — quotes-handlers.ts's
  // createQuoteHandler/putVariantHandler already write the M4 columns
  // (leadgen_funnels.display_order, leadgen_quotes.default_funnel_id)
  // unconditionally, so this suite's fixture (POST /quotes + PUT
  // /variants/:id) needs the schema they land in; the M2 owner axis is what
  // this slice's sectionCount fix (resolveSectionPreviewFrame) reads.
  "0046_leadgen_rework_m1_variants.sql",
  "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql",
  "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql",
  "0053_leadgen_rework_m12_othergroup_retirement.sql",
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

function newEnv(): { sdb: SqliteDb; env: Env; d1: D1Database } {
  const sdb = createRuntimeDb(DatabaseSync as DatabaseSyncCtor);
  const d1 = d1FromSqlite(sdb);
  return { sdb, env: buildEnv(d1, makeKvStub()), d1 };
}

// --- fixtures -----------------------------------------------------------------

// The parity-v25 composition fixture: header-footer template + funnel theme +
// VARIANT overrides — every §13.2/§9.2 layer participates, so the in-frame
// section preview is proven over the full merge (not a trivial frame).
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
  sections: LeadgenSectionRow[]; // ordered, THIS VARIANT's own sections only
  // §4.3-11: the live serve path composes the quote's shared-page section
  // FIRST, ahead of `sections` — this is that wider list, for comparisons
  // against the served composed output (never used to pick "which section
  // to preview" — that stays `sections[0]`, this variant's own first slide).
  composedSections: LeadgenSectionRow[];
}

// Seed one activated framed funnel (2 sections, frame+theme+variant overrides,
// site-1). `withFrame:false` leaves the 0041 columns NULL (the legacy-shell leg).
async function seedFixture(opts?: { withFrame?: boolean }): Promise<Fixture> {
  const { sdb, env, d1 } = newEnv();

  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Frame Quote", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const created = (await createRes.json()) as {
    id: number;
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

  // Rework M2 (§4.3-1, §4.3-15): activation now also requires the quote's
  // shared first page (leadgen_funnel_pages, quote_id-owned) to carry ≥1
  // section — a section distinct from the funnel/variant's own (§4.3-13
  // uniqueness). Route wiring for POST/PUT /quotes/:id/shared-page is
  // mid-flight in another round, so this seeds the SQL shape directly
  // (mirrors leadgen-rework-handlers.test.ts / leadgen-rework-routing.test.ts).
  const sharedSectionPublicId = mintPublicId("section");
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, 'Shared', 'quote_funnel', 'life', 'Shared', ?, 'button', 'active')",
    )
    .run(sharedSectionPublicId, JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "qs1", question_key: "ks", internal_field: "fs", answer_type: "boolean" }] }));
  const sharedSectionRow = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sharedSectionPublicId) as { id: number };
  const sharedPagePublicId = mintPublicId("funnel_page");
  sdb.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position, name) VALUES (?, ?, 0, NULL)").run(sharedPagePublicId, created.id);
  sdb
    .prepare(
      `INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id)
       VALUES (?, ?, 0, (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?))`,
    )
    .run(created.id, sharedSectionRow.id, sharedPagePublicId);

  if (opts?.withFrame !== false) {
    sdb
      .prepare("UPDATE leadgen_funnels SET frame_config_json = ?, theme_json = ? WHERE public_id = ?")
      .run(JSON.stringify(FRAME_CONFIG), JSON.stringify(THEME_JSON), funnelPublicId);
    sdb
      .prepare("UPDATE leadgen_funnel_variants SET frame_overrides_json = ? WHERE public_id = ?")
      .run(JSON.stringify(FRAME_OVERRIDES), variantPublicId);
  }

  const actRes = await admin.request(
    `${API}/quotes/${created.public_id}/activation/site-1`,
    jsonInit("PUT", { enabled: true, slug: "frame" }),
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
  const sharedSections = (
    sdb
      .prepare(
        `SELECT s.* FROM leadgen_funnel_variant_sections fvs
         JOIN leadgen_sections s ON s.id = fvs.section_id
         WHERE fvs.quote_id = ? AND fvs.variant_id IS NULL ORDER BY fvs.position ASC`,
      )
      .all(quote.id) as unknown[]
  ) as LeadgenSectionRow[];
  const composedSections = [...sharedSections, ...sections];
  return { sdb, env, d1, quote, funnel, variant, sections, composedSections };
}

// The §13.4 preview body for one seeded Section row: the row's own canonical
// fields (exactly what the Studio sends for the CURRENT unit) + frame_context.
function previewBodyFor(
  section: LeadgenSectionRow,
  frameContext?: Record<string, unknown>,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    content_json: section.content_json,
    headline: section.headline_text,
    subheadline: section.subheadline_text,
    continue_mode: section.continue_mode,
    design_overrides: section.design_overrides_json,
    section_public_id: section.public_id,
    ...(frameContext !== undefined ? { frame_context: frameContext } : {}),
    ...(extra ?? {}),
  };
}

interface PreviewResponse {
  preview: {
    css: string;
    desktop: string;
    mobile: string;
    component_count: number;
    design_id: string;
    sim_state: string;
    html?: string;
  };
  dependencies?: Record<string, unknown>;
}

// Served-document extraction boundaries (the parity-v25 idiom).
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
// 1. LEGACY BYTE-PIN — absent frame_context ≡ the pre-change capture
// ===========================================================================

const FIXTURE_DIR = join(TEST_DIR, "fixtures", "leadgen-section-preview-frame");
const FIXTURE_PLAIN = join(FIXTURE_DIR, "unit-only-plain.json");
const FIXTURE_DEP_SIM = join(FIXTURE_DIR, "unit-only-dependency-sim.json");
const UPDATE_MODE = process.env["LEADGEN_PIN_UPDATE"] === "1";

function readOrMintFixture(path: string, actual: string, label: string): string {
  if (UPDATE_MODE || !existsSync(path)) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(path, actual);
    throw new Error(
      `LEADGEN_PIN_UPDATE: minted ${label} fixture (${actual.length} chars) at ${path}. ` +
        "Rerun without LEADGEN_PIN_UPDATE=1 to verify against the pin.",
    );
  }
  return readFileSync(path, "utf8");
}

// The DEV-57 base-sheet move, byte-exact: the ONLY css delta legal against the
// pre-change capture (kept in lockstep with styles.ts — a drift fails here).
const MOVED_CARD_RULES =
  `${DEFAULT_FUNNEL_SCOPE} .lg-card-subtitle{display:block;margin-top:${defaultFunnelDesign.spacing.xs};line-height:1.3}\n` +
  `${DEFAULT_FUNNEL_SCOPE} .lg-card{position:relative}\n` +
  `${DEFAULT_FUNNEL_SCOPE} .lg-card-badge{position:absolute;top:${defaultFunnelDesign.spacing.xs};right:${defaultFunnelDesign.spacing.xs};line-height:1.2;white-space:nowrap}\n`;

// The DEV-68 base-sheet move (FIX 4a follow-through), byte-exact: the
// --lg-sel-bg consuming rule left the frameRegions-gated block for the base
// sheet (the same coordinated legacy-pin re-pin), so it is the SECOND legal
// css delta chunk against the pre-change capture (same lockstep discipline).
// OWNER 2026-08-23 — the disclosure pop-up's own legal delta, same lockstep
// discipline as MOVED_CARD_RULES / MOVED_SEL_BG_RULE above: the link became a
// <details>/<summary> (it was a <button> with NOTHING wired to toggle it — the
// public runtime bundle has zero references to `lg-disclosure`, so clicking it
// did nothing on his live funnel), which needs the marker suppressed and gives
// the open panel its pop-up box. Built from the SAME tokens styles.ts uses, so a
// drift in either place fails here rather than silently re-pinning.
const DISCLOSURE_SUMMARY_DELTA =
  ";list-style:none}\n" +
  `${DEFAULT_FUNNEL_SCOPE} .lg-disclosure::-webkit-details-marker{display:none}\n` +
  `${DEFAULT_FUNNEL_SCOPE} .lg-disclosure::marker{content:""}`;
const DISCLOSURE_POPUP_RULES =
  `${DEFAULT_FUNNEL_SCOPE} .lg-disclosure-wrap{position:relative;display:inline-block}\n` +
  `${DEFAULT_FUNNEL_SCOPE} .lg-disclosure-wrap[open] .lg-disclosure-panel{position:absolute;z-index:30;` +
  `top:calc(100% + 6px);left:50%;transform:translateX(-50%);width:max-content;max-width:min(92vw, 420px);` +
  "box-sizing:border-box;" +
  `background:${defaultFunnelDesign.color.card};border:1px solid ${defaultFunnelDesign.color.borderLight};` +
  `border-radius:${defaultFunnelDesign.radius.md};box-shadow:${defaultFunnelDesign.shadow.lg};` +
  `padding:${defaultFunnelDesign.spacing.md};text-align:left;white-space:normal}\n`;

const MOVED_SEL_BG_RULE =
  `${DEFAULT_FUNNEL_SCOPE} .lg-btn.lg-btn-answer[aria-checked="true"], ${DEFAULT_FUNNEL_SCOPE} .lg-btn.lg-btn-answer[data-selected="true"]{background:var(--lg-sel-bg, ${defaultFunnelDesign.iconCard.selectedBackground})}\n`;

// The R5 state-safe-border grant (register R3a ROUTING NOTES): the ONLY
// legal delta against the pre-R5 capture is ONE appended declaration per
// rule — `border-color:var(--lg-field-border, ${NEUTRAL});` — inserted
// between the existing `border:` shorthand and the rule's next declaration.
// Mapped OLD (pre-R5) <-> NEW (post-R5) full-rule-body pairs so the actual
// response can be reverse-mapped to its pre-R5 shape before the byte
// comparison below — a targeted full-rule replace (not a bare-substring
// remove) because `border-color:var(--lg-field-border, ...)` ALSO appears,
// pre-existing and unrelated, in the .lg-input rule (a bare-substring removal
// would over-match and silently swallow that unrelated occurrence too).
const R5_BORDER_NEUTRAL = defaultFunnelDesign.color.border; // "#D2D9E5"
const R5_OLD_BTN_ANSWER_RULE =
  `${DEFAULT_FUNNEL_SCOPE} .lg-btn.lg-btn-answer{background:${defaultFunnelDesign.color.card};color:${defaultFunnelDesign.page.textColor};border:${defaultFunnelDesign.input.border};transition:border-color var(--lg-transition-card), background var(--lg-transition-card)}`;
const R5_NEW_BTN_ANSWER_RULE =
  `${DEFAULT_FUNNEL_SCOPE} .lg-btn.lg-btn-answer{background:${defaultFunnelDesign.color.card};color:${defaultFunnelDesign.page.textColor};border:${defaultFunnelDesign.input.border};border-color:var(--lg-field-border, ${R5_BORDER_NEUTRAL});transition:border-color var(--lg-transition-card), background var(--lg-transition-card)}`;
const R5_OLD_CARD_RULE =
  `${DEFAULT_FUNNEL_SCOPE} .lg-card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${defaultFunnelDesign.spacing.xs};border:${defaultFunnelDesign.iconCard.border};border-radius:${defaultFunnelDesign.iconCard.borderRadius};background:${defaultFunnelDesign.iconCard.background};min-height:${defaultFunnelDesign.iconCard.minHeight};padding:${defaultFunnelDesign.iconCard.padding};cursor:pointer;text-align:center;transition:border-color var(--lg-transition-card), background var(--lg-transition-card)}`;
const R5_NEW_CARD_RULE =
  `${DEFAULT_FUNNEL_SCOPE} .lg-card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${defaultFunnelDesign.spacing.xs};border:${defaultFunnelDesign.iconCard.border};border-color:var(--lg-field-border, ${R5_BORDER_NEUTRAL});border-radius:${defaultFunnelDesign.iconCard.borderRadius};background:${defaultFunnelDesign.iconCard.background};min-height:${defaultFunnelDesign.iconCard.minHeight};padding:${defaultFunnelDesign.iconCard.padding};cursor:pointer;text-align:center;transition:border-color var(--lg-transition-card), background var(--lg-transition-card)}`;

// P2b (register R-A completion, product-core phase P2): the ONLY legal delta
// vs. the R5 shape above is the RESTING `background` channel wrapped in
// var(--lg-answer-bg, <same token>) — the state-safe per-choice-color idiom
// (presets.ts choiceItemStyle's --lg-answer-bg emission, styles.ts's read).
// Reverse-mapped FIRST in the chain below (P2b's NEW text -> the R5_NEW_*
// shape), so the EXISTING R5 reverse-map steps then find their expected R5
// input unchanged — kept in lockstep with styles.ts (a drift fails here).
const P2B_NEW_BTN_ANSWER_RULE =
  `${DEFAULT_FUNNEL_SCOPE} .lg-btn.lg-btn-answer{background:var(--lg-answer-bg, ${defaultFunnelDesign.color.card});color:${defaultFunnelDesign.page.textColor};border:${defaultFunnelDesign.input.border};border-color:var(--lg-field-border, ${R5_BORDER_NEUTRAL});transition:border-color var(--lg-transition-card), background var(--lg-transition-card)}`;
const P2B_NEW_CARD_RULE =
  `${DEFAULT_FUNNEL_SCOPE} .lg-card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${defaultFunnelDesign.spacing.xs};border:${defaultFunnelDesign.iconCard.border};border-color:var(--lg-field-border, ${R5_BORDER_NEUTRAL});border-radius:${defaultFunnelDesign.iconCard.borderRadius};background:var(--lg-answer-bg, ${defaultFunnelDesign.iconCard.background});min-height:${defaultFunnelDesign.iconCard.minHeight};padding:${defaultFunnelDesign.iconCard.padding};cursor:pointer;text-align:center;transition:border-color var(--lg-transition-card), background var(--lg-transition-card)}`;

// P2b FIX-ROUND (adversarial review R1 — "per-choice paint PERSISTS across
// states"): hover/selected ALSO read var(--lg-answer-bg, <the SAME token as
// before>) — reverse-mapped the SAME "NEW -> the prior shape" way as the
// resting rule above. R2 (pre-existing discovery, same FIX-ROUND): every
// selected selector grows a THIRD alternative, .lg-selected (the live
// runtime's real marker — render.ts SELECTED_CLASS; aria-checked/data-
// selected are studio/preview-only). MINOR-3: align-items:start is no longer
// inline on the BASE .lg-answer-group/.lg-card-grid rules at all — it moved
// to its OWN net-new conditional rule (below, alongside the other net-new
// rule strips), so there is NO base-rule delta for either grid anymore (the
// base rules are byte-identical to pre-P2b again).
const FR_HOVER_BG = defaultFunnelDesign.iconCard.hoverBackground; // #F2F6FA
const FR_SELECTED_BG = defaultFunnelDesign.iconCard.selectedBackground; // #E8EEF4
const FR_SELECTED_BORDER = defaultFunnelDesign.iconCard.selectedBorderColor; // #1B3A5C
const FR_BTN_SELECTED_SELECTOR =
  `${DEFAULT_FUNNEL_SCOPE} .lg-btn.lg-btn-answer[aria-checked="true"], ${DEFAULT_FUNNEL_SCOPE} .lg-btn.lg-btn-answer[data-selected="true"]`;
const FR_BTN_SELECTED_SELECTOR_WITH_CLASS =
  `${FR_BTN_SELECTED_SELECTOR}, ${DEFAULT_FUNNEL_SCOPE} .lg-btn.lg-btn-answer.lg-selected`;
const FR_CARD_SELECTED_SELECTOR =
  `${DEFAULT_FUNNEL_SCOPE} .lg-card[aria-checked="true"], ${DEFAULT_FUNNEL_SCOPE} .lg-card[data-selected="true"]`;
const FR_CARD_SELECTED_SELECTOR_WITH_CLASS =
  `${FR_CARD_SELECTED_SELECTOR}, ${DEFAULT_FUNNEL_SCOPE} .lg-card.lg-selected`;

const P2B_NEW_BTN_HOVER_RULE = `${DEFAULT_FUNNEL_SCOPE} .lg-btn.lg-btn-answer:hover{border-color:${FR_SELECTED_BORDER};background:var(--lg-answer-bg, ${FR_HOVER_BG})}`;
const R5_OLD_BTN_HOVER_RULE = `${DEFAULT_FUNNEL_SCOPE} .lg-btn.lg-btn-answer:hover{border-color:${FR_SELECTED_BORDER};background:${FR_HOVER_BG}}`;

const P2B_NEW_BTN_SELECTED_BASE_RULE = `${FR_BTN_SELECTED_SELECTOR_WITH_CLASS}{border-color:${FR_SELECTED_BORDER};background:${FR_SELECTED_BG};font-weight:700}`;
const R5_OLD_BTN_SELECTED_BASE_RULE = `${FR_BTN_SELECTED_SELECTOR}{border-color:${FR_SELECTED_BORDER};background:${FR_SELECTED_BG};font-weight:700}`;

const P2B_NEW_SEL_BG_CONSUMER_RULE = `${FR_BTN_SELECTED_SELECTOR_WITH_CLASS}{background:var(--lg-answer-bg, var(--lg-sel-bg, ${FR_SELECTED_BG}))}`;
// The pre-fix-round shape (2-part selector, single-level var) — EXACTLY
// MOVED_SEL_BG_RULE's (DEV-68, below) own rule text minus its trailing \n
// (that constant's \n is consumed by ITS OWN later "delete wholesale" step;
// this step only un-wraps R1's nested var + un-grows R2's selector, a REPLACE
// not a removal, so it must not swallow a newline that belongs to the next
// rule's separator).
const R5_OLD_SEL_BG_CONSUMER_RULE = `${FR_BTN_SELECTED_SELECTOR}{background:var(--lg-sel-bg, ${FR_SELECTED_BG})}`;

const P2B_NEW_CARD_HOVER_RULE = `${DEFAULT_FUNNEL_SCOPE} .lg-card:hover{border-color:${FR_SELECTED_BORDER};background:var(--lg-answer-bg, ${FR_HOVER_BG})}`;
const R5_OLD_CARD_HOVER_RULE = `${DEFAULT_FUNNEL_SCOPE} .lg-card:hover{border-color:${FR_SELECTED_BORDER};background:${FR_HOVER_BG}}`;

const P2B_NEW_CARD_SELECTED_RULE = `${FR_CARD_SELECTED_SELECTOR_WITH_CLASS}{border-color:${FR_SELECTED_BORDER};background:var(--lg-answer-bg, ${FR_SELECTED_BG});font-weight:700}`;
const R5_OLD_CARD_SELECTED_RULE = `${FR_CARD_SELECTED_SELECTOR}{border-color:${FR_SELECTED_BORDER};background:${FR_SELECTED_BG};font-weight:700}`;

// MINOR-3: the TWO new conditional-align-items rules — net-new, wholesale-
// stripped (the SAME "P1a net-new .lg-answer-group rule" bucket idiom;
// .lg-card-grid gets an equivalent net-new rule of its own, since its BASE
// rule carries no delta at all now).
const P2B_ANSWER_GROUP_HEIGHTS_RULE = `\n${DEFAULT_FUNNEL_SCOPE} .lg-answer-group[data-choice-heights="1"]{align-items:start}`;
const P2B_CARD_GRID_HEIGHTS_RULE = `\n${DEFAULT_FUNNEL_SCOPE} .lg-card-grid[data-choice-heights="1"]{align-items:start}`;

// The R5 D11 typography grant (register S4-B2, operator decision 1): the
// headline PRESET inlines font-family/color directly on every rendered
// <h1 class="lg-headline"> (in addition to the base .lg-headline CSS rule,
// covered separately by the funnelChromeCss-level pin in
// leadgen-frame-legacy-pin.test.ts) — so this SAME two-property change also
// shows up in preview.desktop/preview.mobile's rendered HTML. Reverse-mapped
// here, the same targeted-substring-replace idiom as the R5 border rules
// above (not a bare split, since these two exact literal fragments cannot
// collide with anything else in this fixture's small, known content).
const R5_OLD_HEADLINE_INLINE = `style="font-family:&#39;Literata&#39;,serif;color:#1A1F36"`;
const R5_NEW_HEADLINE_INLINE = `style="font-family:&#39;Newsreader&#39;,serif;color:#16324f"`;
function unmapR5Typography(html: string): string {
  return html.split(R5_NEW_HEADLINE_INLINE).join(R5_OLD_HEADLINE_INLINE);
}
// P4b (PC-A2): every answer-producing leaf now emits a hidden auto error slot
// adjacent to its field. That is a NET-NEW additive delta to the composed
// body (the runtime fills it on a validation failure) — strip it before the
// byte-pin comparison, exactly like every other net-new rule/chunk this pin
// reverse-maps away, so the frozen pre-change capture stays the "nothing ELSE
// changed" reference.
function stripAutoErrorSlots(html: string): string {
  return html.replace(/<p class="lg-error lg-error-auto"[^>]*><\/p>/g, "");
}
// Rework §6.7 (P2, register #9 under-filled-grid fix): effective columns are
// now ALSO min(authored, choiceCount) — LEGACY_PLAIN_CONTENT's IconCardAnswerGrid
// carries exactly 2 choices with NO authored columns, so the CORRECTLY
// clamped value is 2 (min(design-default 3, 2)) where the frozen pre-change
// capture shows the un-clamped design default 3. A net-new, deliberate
// behavior change (not a P2 regression) — reverse-mapped before comparison,
// the SAME idiom as unmapR5Typography/stripAutoErrorSlots. LEGACY_DEP_CONTENT
// carries no card grid, so this is a no-op there.
function unmapColumnsClamp(html: string): string {
  return html.split('style="--lg-cols:2;gap:0.5rem"').join('style="--lg-cols:3;gap:0.5rem"');
}
// The SAME R5 D11 typography grant, at the CSS-rule level (.lg-headline base
// rule + .lg-subheadline's color + the NEW question-card-only font-size
// override — see designs/default-funnel/tokens.ts + styles.ts).
const R5_OLD_HEADLINE_RULE =
  `${DEFAULT_FUNNEL_SCOPE} .lg-headline{font-family:'Literata',serif;font-size:1.75rem;font-weight:700;line-height:1.25;color:#1A1F36;text-align:center;text-wrap:balance;margin:0 0 9px 0}`;
const R5_NEW_HEADLINE_RULE =
  `${DEFAULT_FUNNEL_SCOPE} .lg-headline{font-family:'Newsreader',serif;font-size:31px;font-weight:600;line-height:1.15;color:#16324f;text-align:center;text-wrap:balance;margin:0 0 9px 0}`;
const R5_OLD_SUBHEAD_RULE = `${DEFAULT_FUNNEL_SCOPE} .lg-subheadline{font-size:0.825rem;color:#4A5568;text-align:center;margin:0 0 30px 0}`;
const R5_NEW_SUBHEAD_RULE = `${DEFAULT_FUNNEL_SCOPE} .lg-subheadline{font-size:0.825rem;color:#63707F;text-align:center;margin:0 0 30px 0}`;
// the surgical question-card-only 15px override is a NET-NEW appended rule
// (array-join adds its own leading \n separator) — removed the same way
// MOVED_CARD_RULES/MOVED_SEL_BG_RULE remove a net-new addition above.
const R5_NEW_SUBHEAD_OVERRIDE_RULE = `\n${DEFAULT_FUNNEL_SCOPE} .lg-subheadline{font-size:15px}`;

// U14 (operator's 3rd retest — "Continue renders left-aligned, cannot be
// centered any way"): styles.ts adds display:flex to the .lg-continue rule so
// its margin-left/right:auto center the pill (it inherited display:inline-flex
// from the shared .lg-btn base, on which auto margins compute to 0). That is
// the ONLY delta on the .lg-continue rule vs the pre-change capture — reverse-
// mapped NEW->OLD here, the same targeted full-rule-replace idiom as the R5
// rules above (kept in lockstep with styles.ts — a drift fails here).
const U14_OLD_CONTINUE_RULE =
  `${DEFAULT_FUNNEL_SCOPE} .lg-continue{width:100%;max-width:320px;margin-top:26px;margin-left:auto;margin-right:auto;background:var(--lg-btn-bg, #1B3A5C)}`;
const U14_NEW_CONTINUE_RULE =
  `${DEFAULT_FUNNEL_SCOPE} .lg-continue{display:flex;width:100%;max-width:320px;margin-top:26px;margin-left:auto;margin-right:auto;background:var(--lg-btn-bg, #1B3A5C)}`;

// P1a (register PC-1/PC-3/PC-11): the layout-system deltas vs the pre-P1a
// capture, kept in lockstep with styles.ts (a drift fails here). Two NET-NEW
// base rules (the inter-component stack + the .lg-answer-group grid), four
// NET-NEW mobile rules (the mobile stack + its two golden-preserving
// re-assertions + the answer-grid mobile gap) — each carries the array-join's
// own leading \n, removed the same MOVED_* way; PLUS two CHANGED rule bodies
// (.lg-card-icon gains the inline-flex centering; .lg-card min-height 96->140).
// NB: R5_OLD_CARD_RULE above interpolates the CURRENT iconCard.minHeight token
// (now 140px), so the min-height must ALSO be reverted 140->96 to reach the
// pre-P1a fixture's 96px.
const P1A_STACK_BASE_RULE = `\n${DEFAULT_FUNNEL_SCOPE} .lg-question-card > * + *{margin-top:${defaultFunnelDesign.spacing.stack}}`;
// `.lg-answer-group` is P1a's own net-new, wholesale-stripped rule (it never
// existed pre-P1a). P2b FIX-ROUND MINOR-3 (adversarial review) REVERTED this
// constant back to its ORIGINAL P1a shape: align-items:start is no longer
// inline on this base rule at all — it moved to its OWN net-new conditional
// rule (P2B_ANSWER_GROUP_HEIGHTS_RULE, above), stripped separately below, so
// an UNSTYLED group is byte-identical to pre-P2b again. Kept in lockstep with
// styles.ts (a drift fails here).
// LeadGen Rework §6.7 FIX-FIRST F2 (adversarial review, 2026-07-22): the
// grid-template-columns VALUE now reads `var(--lg-tracks, repeat(var(
// --lg-cols, N), minmax(0,1fr)))` instead of the bare `repeat(...)` — the
// doubled-track partial-row centering fix rides the additive --lg-tracks
// inline custom property (presets.ts gridItemColumnEntries) so the mobile
// collapse rule can still out-cascade it normally; a literal inline
// grid-template-columns override (F1's original, WRONG shape) would have
// out-ranked mobile collapse instead. Since this whole rule is
// wholesale-stripped either way (pre-P1a had no .lg-answer-group at all),
// only THIS constant needs updating to keep matching the live text —
// updated in lockstep with styles.ts, same discipline as every other rule
// here.
const P1A_ANSWER_GRID_RULE = `\n${DEFAULT_FUNNEL_SCOPE} .lg-answer-group{display:grid;grid-template-columns:var(--lg-tracks, repeat(var(--lg-cols, ${defaultFunnelDesign.answerGrid.columns}), minmax(0, 1fr)));gap:${defaultFunnelDesign.answerGrid.gap};width:100%}`;
// F2 (adversarial review, 2026-07-22): unlike .lg-answer-group (net-new,
// wholesale-stripped), `.lg-card-grid`'s BASE rule already existed in the
// pre-P1a fixture — only its grid-template-columns VALUE changed (F1/F2
// added the --lg-tracks fallback chain), so this is a targeted fragment
// reverse-map (the U14_OLD/NEW_CONTINUE_RULE idiom), not a whole-rule strip.
// Kept in lockstep with styles.ts (a drift fails here).
const F2_CARD_GRID_TRACKS_NEW = "grid-template-columns:var(--lg-tracks, repeat(var(--lg-cols, 3), minmax(0, 1fr)))";
const F2_CARD_GRID_TRACKS_OLD = "grid-template-columns:repeat(var(--lg-cols, 3), minmax(0, 1fr))";
// F2 FOLLOW-UP (same review pass, 2026-07-22): two NET-NEW rules (never
// existed pre-P1a, wholesale-stripped like .lg-answer-group above) — the
// desktop rule that lets .lg-answer-group's/.lg-card-grid's per-item
// grid-column-start/-end consume the additive --lg-gc-start/--lg-gc-end
// inline custom properties, and the mobile rule that resets them to `auto`
// for cards once the container collapses to 1 column (buttons never
// collapse, so only cards need the mobile reset). Kept in lockstep with
// styles.ts (a drift fails here).
const F2_GC_CONSUMER_RULE = `\n${DEFAULT_FUNNEL_SCOPE} .lg-answer-group > *, ${DEFAULT_FUNNEL_SCOPE} .lg-card-grid > *{grid-column-start:var(--lg-gc-start, auto);grid-column-end:var(--lg-gc-end, auto)}`;
const F2_GC_MOBILE_RESET_RULE = `\n${DEFAULT_FUNNEL_SCOPE} .lg-card-grid > *{grid-column-start:auto;grid-column-end:auto}`;
const P1A_STACK_MOBILE_RULE = `\n${DEFAULT_FUNNEL_SCOPE} .lg-question-card > * + *{margin-top:${defaultFunnelDesign.spacing.stackMobile}}`;
const P1A_SUBHEAD_MOBILE_RESET = `\n${DEFAULT_FUNNEL_SCOPE} .lg-subheadline{margin-top:0}`;
const P1A_CONTINUE_MOBILE_RESET = `\n${DEFAULT_FUNNEL_SCOPE} .lg-continue{margin-top:26px}`;
const P1A_ANSWER_GRID_MOBILE_GAP = `\n${DEFAULT_FUNNEL_SCOPE} .lg-answer-group{gap:${defaultFunnelDesign.answerGrid.gapMobile}}`;
const P1A_NEW_CARD_ICON_RULE = `${DEFAULT_FUNNEL_SCOPE} .lg-card-icon{display:inline-flex;align-items:center;justify-content:center;color:${defaultFunnelDesign.iconCard.iconColor};font-size:${defaultFunnelDesign.iconCard.iconSize};line-height:1}`;
const P1A_OLD_CARD_ICON_RULE = `${DEFAULT_FUNNEL_SCOPE} .lg-card-icon{color:${defaultFunnelDesign.iconCard.iconColor};font-size:${defaultFunnelDesign.iconCard.iconSize};line-height:1}`;
const P1A_OLD_CARD_MIN_HEIGHT = "96px"; // pre-P1a iconCard.minHeight (the frozen fixture's value)

// P1a FIX ROUND (conductor, register PC-3): the grid-follower collapse-
// emulation table — a SINGLE net-new block (5 rules) appended right after the
// P1a additions above, kept in lockstep with styles.ts's OWN construction (a
// drift in either the selector list or a computed margin-top value fails
// here). Each predecessor gets BOTH the direct-sibling selector (the live/
// unwrapped path) AND a `:has()` companion (the studio-canvas selected/
// wrapped path — see styles.ts's own comment for why). Values: Category A
// (mb >= stack 18) -> 0; Category B (mb < stack) -> 18-mb (9 for headline·9,
// 6 for category·12, 2 for trustbar/logo-strip/columns/field·16 — all four
// share the SAME 1rem/16px value).
// P3a (register PC-2): `.lg-el-row` (a flex box, non-collapsing) joined the
// grid-follower set in styles.ts, so the emulation table now emits its
// selectors too — kept in lockstep here (a drift fails the strip below).
function followerSelectorsFixRound(predecessor: string): string {
  return [".lg-answer-group", ".lg-card-grid", ".lg-el-row"]
    .flatMap((f) => [`${DEFAULT_FUNNEL_SCOPE} ${predecessor} + ${f}`, `${DEFAULT_FUNNEL_SCOPE} ${predecessor} + *:has(> ${f})`])
    .join(", ");
}
const P1A_FIX_ROUND_EXCEPTION_TABLE =
  "\n" +
  [followerSelectorsFixRound(".lg-subheadline"), followerSelectorsFixRound(".lg-progress"), followerSelectorsFixRound(".lg-steps"), followerSelectorsFixRound(".lg-grid-container")].join(", ") +
  "{margin-top:0}\n" +
  `${DEFAULT_FUNNEL_SCOPE} .lg-card-grid + *, ${DEFAULT_FUNNEL_SCOPE} *:has(> .lg-card-grid) + *{margin-top:0}\n` +
  followerSelectorsFixRound(".lg-headline") +
  "{margin-top:9px}\n" +
  followerSelectorsFixRound(".lg-category") +
  "{margin-top:6px}\n" +
  [followerSelectorsFixRound(".lg-trustbar"), followerSelectorsFixRound(".lg-logo-strip"), followerSelectorsFixRound(".lg-columns"), followerSelectorsFixRound(".lg-field")].join(", ") +
  "{margin-top:2px}";

// P1 hidden-attribute vs author-display fix (register PC): the SINGLE net-new
// terminal guard styles.ts appends as the LAST base rule (right after the P1a
// grid-follower table above, before the frame-region block). `[hidden]` +
// scope = (0,2,0) ties every force-visible display rule and wins by later
// source order, so a conditionally-hidden component actually hides. Stripped
// here (the ONLY legal delta this fix adds) so the frozen fixture stays the
// pre-change shape — a drift in ANY other byte still fails the pin below.
const P1_HIDDEN_GUARD_RULE = `\n${DEFAULT_FUNNEL_SCOPE} [hidden]{display:none}`;

// MINOR-1 (adversarial review, register PC): CardPanel/BackgroundPanel are
// plain-block §8.5 containers with no gap system — `.lg-question-card > * + *`
// (a direct-child combinator) cannot reach a container's own children (its
// grandchildren). styles.ts adds the SAME stack-floor rule scoped to
// `.lg-card-panel > * + *` / `.lg-bg-panel-inner > * + *` (base + mobile),
// emitted immediately after the existing `.lg-question-card > * + *` pair.
// Stripped here (the ONLY legal delta this fix adds) so the frozen fixture
// stays the pre-change shape.
const MINOR1_CARD_PANEL_FLOOR_RULE = `\n${DEFAULT_FUNNEL_SCOPE} .lg-card-panel > * + *{margin-top:${defaultFunnelDesign.spacing.stack}}`;
const MINOR1_BG_PANEL_FLOOR_RULE = `\n${DEFAULT_FUNNEL_SCOPE} .lg-bg-panel-inner > * + *{margin-top:${defaultFunnelDesign.spacing.stack}}`;
const MINOR1_CARD_PANEL_FLOOR_MOBILE_RULE = `\n${DEFAULT_FUNNEL_SCOPE} .lg-card-panel > * + *{margin-top:${defaultFunnelDesign.spacing.stackMobile}}`;
const MINOR1_BG_PANEL_FLOOR_MOBILE_RULE = `\n${DEFAULT_FUNNEL_SCOPE} .lg-bg-panel-inner > * + *{margin-top:${defaultFunnelDesign.spacing.stackMobile}}`;

// P3a (register PC-2 / D1 / R-B): structured placement is a NET-NEW CSS system
// (`.lg-el` / `.lg-el-row`) — 8 base rules + 4 mobile rules. NONE match this
// legacy/no-layout content (no node carries `layout`), so they are wholesale-
// stripped here (the SAME "net-new rule" bucket as P1a's own additions), kept
// in lockstep with styles.ts (a drift in either fails here). The grid-follower
// collapse-emulation table's OWN `.lg-el-row` growth is already reconstructed
// by followerSelectorsFixRound (above), so P1A_FIX_ROUND_EXCEPTION_TABLE still
// strips the CURRENT (expanded) table wholesale.
//
// CONDUCTOR FIX (P3 review MINOR-2, delta classified — the ONLY new rule this
// fix adds): the 8th base rule, the live-funnel hidden-row-member slot
// collapse. No EXISTING rule above changed; this entry is purely additive,
// appended right after the .lg-el transform/nudge rule (matching styles.ts's
// own emission order) and BEFORE the 4 mobile entries.
//
// RE-REVIEW FIX (fresh regression, corrected here in lockstep with
// styles.ts): the FIRST cut of this rule was a plain descendant
// `.lg-el:has([data-lg-question][hidden])`, which also collapsed a CONTAINER
// row member (e.g. CardPanel) whenever ANY inner descendant happened to be
// hidden — even with OTHER, still-visible content inside. The corrected
// selector requires `[data-el-leaf]` (presets.ts wrapRowMember — stamped only
// on a non-container slot), so a container's slot can never match this rule;
// only a true leaf's OWN single `[data-lg-question]` hiding collapses its
// slot.
const P3A_EL_RULES = [
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-el-row{display:flex;gap:${defaultFunnelDesign.answerGrid.gap};align-items:stretch}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-el-row > .lg-el{flex:1 1 0;min-width:0;display:flex;flex-direction:column}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-el-row > .lg-el[data-el-basis]{flex-grow:0;flex-basis:var(--lg-el-basis)}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-el-row > .lg-el[data-align="start"]{align-items:flex-start}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-el-row > .lg-el[data-align="center"]{align-items:center}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-el-row > .lg-el[data-align="end"]{align-items:flex-end}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-el{transform:var(--lg-el-nudge, none);max-width:100%}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-el[data-el-leaf]:has([data-lg-question][hidden]){display:none}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-el-row{flex-direction:column;gap:${defaultFunnelDesign.spacing.stackMobile}}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-el-row > .lg-el{flex:1 1 auto}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-el-row > .lg-el[data-el-basis]{flex:1 1 auto}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-el{transform:none}`,
];

// Round-4 P1b (register R4-14/R4-09/R4-03): strip the NET-NEW studio/preview
// affordance rules this slice adds to the BASE sheet (A-9 ghost out of the grid
// track · A-6 Address composite preview · A-3 MQG zero-row placeholder) — the
// ONLY additional legal css delta P1b introduces. They ride the shared chrome
// sheet but are inert on the live funnel (studio-injected ghost class + the
// `.lg-preview`-scoped composite/empty rules), so reverse-mapping them out
// leaves the frozen pre-change fixture byte-identical. Same idiom + token
// interpolation as the P1a/P3a rule constants above.
const ROUND4_P1B_RULES = [
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-answer-group .studio-choice-ghost, ${DEFAULT_FUNNEL_SCOPE} .lg-card-grid .studio-choice-ghost{grid-column:1 / -1;min-height:0;height:40px;display:flex;align-items:center;justify-content:center;border:1px dashed ${defaultFunnelDesign.page.textSecondaryColor};color:${defaultFunnelDesign.page.textSecondaryColor};border-radius:${defaultFunnelDesign.radius.md};margin-top:${defaultFunnelDesign.spacing.xs}}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-address-composite{display:none}`,
  `\n${DEFAULT_FUNNEL_SCOPE}.lg-preview .lg-address-composite{display:block;margin-top:${defaultFunnelDesign.spacing.sm};padding:${defaultFunnelDesign.spacing.sm};border:1px dashed ${defaultFunnelDesign.page.textSecondaryColor};border-radius:${defaultFunnelDesign.radius.md}}`,
  `\n${DEFAULT_FUNNEL_SCOPE}.lg-preview .lg-address-composite-note{display:block;font-size:12px;color:${defaultFunnelDesign.page.textSecondaryColor};margin-bottom:${defaultFunnelDesign.spacing.xs}}`,
  `\n${DEFAULT_FUNNEL_SCOPE}.lg-preview .lg-address-composite-fields{display:flex;flex-wrap:wrap;gap:${defaultFunnelDesign.spacing.xs}}`,
  `\n${DEFAULT_FUNNEL_SCOPE}.lg-preview .lg-address-chip{display:inline-flex;flex-direction:column;gap:1px;padding:4px 9px;border:1px solid ${defaultFunnelDesign.page.textLightColor};border-radius:${defaultFunnelDesign.radius.sm};font-size:11px}`,
  `\n${DEFAULT_FUNNEL_SCOPE}.lg-preview .lg-address-chip-role{font-weight:700;color:${defaultFunnelDesign.page.textColor}}`,
  `\n${DEFAULT_FUNNEL_SCOPE}.lg-preview .lg-address-chip-field{color:${defaultFunnelDesign.page.textSecondaryColor};font-family:monospace}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-mqg-empty{display:none}`,
  `\n${DEFAULT_FUNNEL_SCOPE}.lg-preview .lg-mqg-empty{display:block;padding:${defaultFunnelDesign.spacing.md};border:1px dashed ${defaultFunnelDesign.page.textSecondaryColor};border-radius:${defaultFunnelDesign.radius.md};text-align:center;color:${defaultFunnelDesign.page.textSecondaryColor};font-size:13px}`,
  `\n${DEFAULT_FUNNEL_SCOPE}.lg-preview .lg-mqg:has(.studio-mqg-empty) .lg-mqg-empty{display:none}`,
];

// R2 P1 §① (register SRC-1/SRC-2, conductor-granted strip-list entry): the
// QuestionGrid container's OWN two chrome rules — the ONLY delta this slice
// adds to the base sheet. NOTHING else grew: the ✓-marker rules the same slice
// needed are emitted DEMAND-DRIVEN from presets.ts (a per-section <style>
// block, only for content that opts a question into the marker), so a wash/
// absent theme's sheet — and this legacy fixture, whose content has no grid and
// no marker opt-in — stays byte-identical everywhere else. Same wholesale-strip
// idiom + token interpolation as the P1a/P3a/P1b rule constants above.
const R2_P1_QUESTION_GRID_RULES = [
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-qgrid{display:grid;grid-template-columns:minmax(0, 1fr);width:100%;box-sizing:border-box}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-qgrid-q{min-width:0;max-width:100%}`,
];

// R2 P4 S4a (contract §5.5 / design-pack §6.8 "Rendered visitor examples"):
// the five slider types now render the PINNED anatomy — handle ON the track,
// stepper −/＋ row, ONE track with TWO handles, a real radial dial — so
// styles.ts grew a NET-NEW block of range rules and CHANGED three
// pre-existing ones. Same lockstep discipline as every entry above (a drift in
// styles.ts fails here): the net-new rules are wholesale-stripped, the changed
// rules are reverse-mapped to their pre-P4 text, so this pin still proves
// "nothing ELSE moved". None of them can alter this fixture's content (it
// carries no slider node at all) — they are sheet-level deltas only.
const R2_P4_RQ = defaultFunnelDesign.rangeQuestion;
const R2_P4_RANGE_NEW_RULES = [
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-handle{position:absolute;left:100%;top:50%;transform:translate(-50%,-50%);width:${R2_P4_RQ.thumbSize};height:${R2_P4_RQ.thumbSize};border-radius:${defaultFunnelDesign.radius.full};background:${R2_P4_RQ.thumbBackground};border:${R2_P4_RQ.thumbBorder};box-shadow:${R2_P4_RQ.thumbShadow};box-sizing:border-box;pointer-events:none;z-index:2}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-handle-min{left:0}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-handle-max{left:100%}`,
  // P8 N15 (owner Image11 — docs/leadgen/r2/evidence/p8/n15/image11-reading.md):
  // the pill's anchor flipped bottom->top (rides UNDER its handle instead of
  // above it). Still a net-new-since-the-frozen-capture rule, so it stays in
  // the wholesale-strip list — only its literal text is re-captured here.
  // Nothing else in the sheet moved.
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-handle-value{position:absolute;top:calc(100% + ${defaultFunnelDesign.spacing.sm});left:50%;transform:translateX(-50%);white-space:nowrap;font-size:0.8125rem;font-weight:700;line-height:1;padding:5px 9px;border-radius:${defaultFunnelDesign.radius.sm};background:${R2_P4_RQ.filledTrackColor};color:${defaultFunnelDesign.color.card}}`,
  // P4 FIX-FIRST (F-2): these two NET-NEW rules' bodies changed from
  // `transform:none` to a proportional inward slide driven by engine.ts's
  // --lg-a / --lg-b, because the static anchor pushed the min pill off-card
  // once the handle was DRIVEN (measured at 375: pill x=319.1..393.0,
  // scrollWidth 393 vs innerWidth 375). Still net-new-since-the-frozen-capture
  // rules, so they stay in the wholesale-strip list — only their literal text
  // is re-captured here. Nothing else in the sheet moved.
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-handle-min .lg-range-handle-value{left:0;transform:translateX(calc(var(--lg-a,0) * -1%))}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-handle-max .lg-range-handle-value{left:auto;right:0;transform:translateX(calc((100 - var(--lg-b,100)) * 1%))}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-input::-webkit-slider-runnable-track{background:transparent}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-input::-moz-range-track{background:transparent}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-input-dual{pointer-events:none}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-input-dual::-webkit-slider-thumb{pointer-events:auto}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-input-dual::-moz-range-thumb{pointer-events:auto}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-stepper-row{display:flex;align-items:center;justify-content:center;gap:${defaultFunnelDesign.spacing.md};margin:${defaultFunnelDesign.spacing.md} 0}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-stepper-row .lg-range-value{margin:0}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-stepper-btn{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;flex-shrink:0;border-radius:${defaultFunnelDesign.radius.md};border:2px solid ${defaultFunnelDesign.color.primary};background:${defaultFunnelDesign.color.card};color:${defaultFunnelDesign.color.primary};font-size:1.5rem;line-height:1;font-weight:600;cursor:pointer;transition:background-color ${defaultFunnelDesign.transitions.btnHoverMs}ms}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-stepper-btn:hover{background:${defaultFunnelDesign.color.primaryGhost}}`,
  // P4 FIX-FIRST-2 (N-2): this NET-NEW rule's body changed from a flat 40px
  // (clearance for ONE pill row) to clearance for the STACKED second row too —
  // the closure review measured the raised min pill landing on the operator's
  // question label at the low clamp. Still a net-new-since-the-frozen-capture
  // rule, so it stays in the wholesale-strip list; only its literal text is
  // re-captured here. Nothing else in the sheet moved.
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-from-to .lg-range-track,${DEFAULT_FUNNEL_SCOPE} .lg-range-dual .lg-range-track{margin-top:calc(40px + ${defaultFunnelDesign.spacing.xl} + ${defaultFunnelDesign.spacing.sm})}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-from-to-inputs{display:flex;gap:${defaultFunnelDesign.spacing.md};margin-top:${defaultFunnelDesign.spacing.md}}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-ft-field{flex:1 1 0;display:flex;flex-direction:column;gap:${defaultFunnelDesign.spacing.xs};min-width:0}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-ft-label{font-size:0.8125rem;font-weight:600;color:${defaultFunnelDesign.page.textSecondaryColor}}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-from,${DEFAULT_FUNNEL_SCOPE} .lg-range-to{width:100%}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-radial{display:flex;flex-direction:column;align-items:center;position:relative;--lg-radial-size:176px;--lg-radial-band:18px}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-radial-outer{position:relative;width:var(--lg-radial-size);height:var(--lg-radial-size);border-radius:${defaultFunnelDesign.radius.full};display:flex;align-items:center;justify-content:center;margin:${defaultFunnelDesign.spacing.md} 0}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-radial-inner{position:relative;width:calc(var(--lg-radial-size) - var(--lg-radial-band) * 2);height:calc(var(--lg-radial-size) - var(--lg-radial-band) * 2);border-radius:${defaultFunnelDesign.radius.full};background:${defaultFunnelDesign.color.card};display:flex;align-items:center;justify-content:center;margin:0;padding:0 ${defaultFunnelDesign.spacing.sm};box-sizing:border-box;line-height:1.1;z-index:1}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-radial-handle{position:absolute;top:50%;left:50%;width:${R2_P4_RQ.thumbSize};height:${R2_P4_RQ.thumbSize};margin-top:calc(${R2_P4_RQ.thumbSize} * -0.5);margin-left:calc(${R2_P4_RQ.thumbSize} * -0.5);border-radius:${defaultFunnelDesign.radius.full};box-sizing:border-box;z-index:2;pointer-events:none;transform:rotate(var(--lg-deg,0deg)) translateY(calc((var(--lg-radial-size) - var(--lg-radial-band)) * -0.5))}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-radial-input{position:absolute;top:0;left:0;width:100%;height:100%;transform:none;opacity:0;pointer-events:none}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-radial:focus-within .lg-range-radial-outer{box-shadow:0 0 0 3px ${defaultFunnelDesign.color.primaryWash}}`,
  // the two mobile-block additions (dial shrink + tighter from/to gap)
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-radial{--lg-radial-size:140px;--lg-radial-band:15px}`,
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-from-to-inputs{gap:${defaultFunnelDesign.spacing.sm}}`,
  // P4 cleanup (Item 1, S4b pin-fidelity finding): a `@container` query on the
  // two-handle `.lg-range-fill` (its own box IS the live handle gap) raises
  // the min pill clear of the max pill once the clamp narrows that gap below
  // 96px — CSS only, no engine change, no other rule's text touched.
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-from-to .lg-range-fill,${DEFAULT_FUNNEL_SCOPE} .lg-range-dual .lg-range-fill{container-type:inline-size;container-name:lg-range-fill}`,
  // P8 N15: the base anchor flipped bottom->top, so the escape direction
  // flips with it — away from the max pill is now DOWN, not up. Still
  // net-new-since-the-frozen-capture; only the literal text is re-captured.
  `\n@container lg-range-fill (max-width:96px){${DEFAULT_FUNNEL_SCOPE} .lg-range-handle-min .lg-range-handle-value{top:calc(100% + ${defaultFunnelDesign.spacing.sm} + ${defaultFunnelDesign.spacing.xl})}}`,
];
// The three CHANGED rules, NEW -> pre-P4 text (targeted full-rule replaces,
// the R5_*_RULE idiom): the input became the track overlay (its thumb now
// paints nothing — the .lg-range-handle div is the visual), and the captions
// gained the clearance the overhanging handle needs.
const R2_P4_RANGE_CHANGED_RULES: ReadonlyArray<readonly [string, string]> = [
  [
    `${DEFAULT_FUNNEL_SCOPE} .lg-range-input{-webkit-appearance:none;appearance:none;position:absolute;top:50%;left:calc(${R2_P4_RQ.thumbSize} * -0.5);width:calc(100% + ${R2_P4_RQ.thumbSize});height:44px;transform:translateY(-50%);background:transparent;margin:0;z-index:3}`,
    `${DEFAULT_FUNNEL_SCOPE} .lg-range-input{-webkit-appearance:none;appearance:none;width:100%;background:transparent;margin:0;min-height:44px}`,
  ],
  [
    `${DEFAULT_FUNNEL_SCOPE} .lg-range-input::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:${R2_P4_RQ.thumbSize};height:${R2_P4_RQ.thumbSize};border-radius:${defaultFunnelDesign.radius.full};background:transparent;border:0;cursor:pointer}`,
    `${DEFAULT_FUNNEL_SCOPE} .lg-range-input::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:${R2_P4_RQ.thumbSize};height:${R2_P4_RQ.thumbSize};border-radius:${defaultFunnelDesign.radius.full};background:${R2_P4_RQ.thumbBackground};border:${R2_P4_RQ.thumbBorder};box-shadow:${R2_P4_RQ.thumbShadow};cursor:pointer}`,
  ],
  [
    `${DEFAULT_FUNNEL_SCOPE} .lg-range-input::-moz-range-thumb{width:${R2_P4_RQ.thumbSize};height:${R2_P4_RQ.thumbSize};border-radius:${defaultFunnelDesign.radius.full};background:transparent;border:0;cursor:pointer}`,
    `${DEFAULT_FUNNEL_SCOPE} .lg-range-input::-moz-range-thumb{width:${R2_P4_RQ.thumbSize};height:${R2_P4_RQ.thumbSize};border-radius:${defaultFunnelDesign.radius.full};background:${R2_P4_RQ.thumbBackground};border:${R2_P4_RQ.thumbBorder};box-shadow:${R2_P4_RQ.thumbShadow};cursor:pointer}`,
  ],
  // P8 N15: margin-top grew a further `+ spacing.xl * 2` term (clears the
  // relocated-below pill AND the worst-case container-query stacked bump —
  // see styles.ts's own comment on this rule). Only the FIRST (live-matching)
  // element updates; the pre-P4 baseline target (second element) is untouched.
  [
    `${DEFAULT_FUNNEL_SCOPE} .lg-range-minmax{display:flex;justify-content:space-between;color:${R2_P4_RQ.minMaxLabelColor};font-size:0.8125rem;margin-top:calc(${R2_P4_RQ.thumbSize} * 0.5 + ${defaultFunnelDesign.spacing.xl} * 2)}`,
    `${DEFAULT_FUNNEL_SCOPE} .lg-range-minmax{display:flex;justify-content:space-between;color:${R2_P4_RQ.minMaxLabelColor};font-size:0.8125rem;margin-top:${defaultFunnelDesign.spacing.sm}}`,
  ],
];

// R2 P5 F7 (owner A.1 #6 "this is one of your worst executions" + owner A.1
// #8, conductor-granted strip-list entry — the SAME grant
// R2_P1_QUESTION_GRID_RULES / R2_P4_RANGE_NEW_RULES above already carry): the
// P5-F3 commit (28df275) added two rules to the base sheet — the per-SUB-
// FIELD address label (renderAddressFieldSet now labels each field of a
// multi-field composite instead of relying on a placeholder that vanishes the
// instant a visitor types) and the visitor-side authored-"Other" <select>
// full-row span (it was inheriting the trigger's ONE narrow grid track and
// clipping long authored option text). Neither rule ever existed in the
// pre-change pinned baseline — `.lg-address-field-label` and
// `select.lg-other-select` are brand-new selectors, not edits to an existing
// rule's body — so a wholesale strip is the correct mechanism here (a
// reverse-map, like R2_P4_RANGE_CHANGED_RULES above, only applies when an
// EXISTING rule's text changed; neither rule below does). The SAME commit
// also deleted four dead `.lg-address-composite*` rules; those need no entry
// of their own — they already live in ROUND4_P1B_RULES above, and stripping
// text no longer present in the live css is a documented no-op (`.split` on
// a non-matching substring returns the string unchanged), so that bucket now
// simply produces zero delta. Same wholesale-strip idiom + token
// interpolation as the buckets above (kept in lockstep with styles.ts — a
// drift fails here).
const R2_P5_ADDRESS_LABEL_RULES = [
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-address-field-label{display:block;font-size:${defaultFunnelDesign.subheadline.fontSize};color:${defaultFunnelDesign.page.textSecondaryColor};margin-bottom:${defaultFunnelDesign.spacing.xs}}`,
  `\n${DEFAULT_FUNNEL_SCOPE} select.lg-other-select{grid-column:1 / -1}`,
];

// R2 P8-3 S3.10 (contract R3 corollary, "a control that cannot be honoured
// must not be offered") — the icon-card error rule was RE-POINTED, not
// re-valued. WHY THIS IS A RE-MINT AND NOT A LEAK, measured, not asserted:
//   * THE PIN'S CLAIM IS INTACT. The pin says "absent -> byte-identical": a
//     funnel with NO theme authored renders exactly as before. Dumping
//     `cssMinusAll` against this fixture's `preview.css` and diffing the whole
//     17,5xx-char sheet gives exactly ONE differing line out of 397 (the line
//     below) — 17,561 -> 17,552 chars. In particular the OTHER P8-3 change to
//     this area (the question-card box properties becoming theme-writable)
//     produces ZERO delta here: every `.lg-question-card` rule in the
//     unthemed sheet is byte-identical to the capture. So nothing from P8-3
//     leaked into the untheme default; only this selector's TEXT moved.
//   * THE OLD SELECTOR WAS DEAD. `[data-error="true"]` has no producer
//     anywhere in the visitor runtime (0 occurrences of `data-error` in the
//     emitted sheet after this change, and no writer in
//     src/public/leadgen/**). The class the real runtime writes is
//     ERROR_CLASS = "lg-error" (runtime/render.ts:20, added at :240 to the
//     owning `[data-lg-field]` block, removed at :241/:255), with the
//     `.lg-card` buttons as its descendants — so `.lg-error .lg-card` is the
//     state that actually occurs. Same specificity class (scope attr + 2) and
//     same source position as the selector it replaces (styles.ts:1728-1737),
//     so the hover/selected/disabled cascade order is unchanged.
//   * VALUE UNCHANGED: `border-color:#D32F2F` on both sides — this is a
//     selector re-point, not a repaint.
// Mechanism: a targeted full-rule NEW -> OLD replace, the same reverse-map
// idiom R2_P4_RANGE_CHANGED_RULES / F2_CARD_GRID_TRACKS_* use for "an EXISTING
// rule's text changed" (a wholesale strip would silently forgive the rule
// disappearing altogether). The pin keeps ALL of its remaining force: any
// other byte of this sheet still fails it.
const P8_S310_ERROR_SELECTOR_REPOINT: ReadonlyArray<readonly [string, string]> = [
  [
    `${DEFAULT_FUNNEL_SCOPE} .lg-error .lg-card{border-color:${defaultFunnelDesign.iconCard.errorBorderColor}}`,
    `${DEFAULT_FUNNEL_SCOPE} .lg-card[data-error="true"]{border-color:${defaultFunnelDesign.iconCard.errorBorderColor}}`,
  ],
];

// R2 P8-6 (from_to max-rail hit-area partition): styles.ts adds ONE NET-NEW
// rule clipping the MAX rail's hit area. WHY IT EXISTS: both dual rails span
// the whole track at z-index 3, so when the handles coincide DOM order gave
// every press to the max rail — driven on the live r2fix funnel with the
// press at the min handle's own centre (x=477 at 1280, x=29 at 375), a typed
// max of 40 was destroyed and `POST /lg/auction` carried max=50000 instead of
// the operator's 40. clip-path clips HIT TESTING as well as paint and is not
// layout, so the value<->pixel mapping is untouched. P8-6 S2 corrected the
// boundary from the plain MIDPOINT of the two handles — which at coincidence
// IS the shared handle's centre, so that press still posted 50000 — to the
// midpoint OR the min thumb's right edge, whichever is further right: a
// coincident pair is one circle and it belongs to the min alone.
// SAFE FOR THIS PIN: it is net-new since the frozen capture and this fixture
// carries no slider node at all, so it is a sheet-level delta only — same
// wholesale-strip idiom and same token interpolation (R2_P4_RQ.thumbSize) as
// R2_P4_RANGE_NEW_RULES above, kept in lockstep with styles.ts (a drift in
// either fails here). Still exactly ONE rule; nothing ELSE in the sheet moved.
const P8_S6_RANGE_MAX_RAIL_CLIP_RULE = [
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-range-track > span + span > .lg-range-input-dual{clip-path:inset(0 0 0 calc(${R2_P4_RQ.thumbSize} / 2 + max((var(--lg-a,0) + var(--lg-b,100)) * (100% - ${R2_P4_RQ.thumbSize}) / 200, ${R2_P4_RQ.thumbSize} / 2 + var(--lg-a,0) * (100% - ${R2_P4_RQ.thumbSize}) / 100)))}`,
];

// OWNER RULING (2026-08-11, "a freshly added card or logo still shows a broken
// image until you pick one"): the ONE net-new base-sheet rule for the labelled
// image slot a not-yet-picked card renders (presets.ts paints
// <span class="lg-card-img-placeholder">Image</span> for MEDIA_PENDING_REF).
// SAFE FOR THIS PIN: net-new since the frozen capture, and this fixture's icon
// grid carries no image choice at all, so it is a sheet-level delta only — same
// wholesale-strip idiom as P8_S6_RANGE_MAX_RAIL_CLIP_RULE above, kept in lockstep
// with styles.ts (a drift in either fails here). Exactly ONE rule; nothing else
// in the sheet moved.
const R2_CARD_IMG_PLACEHOLDER_RULE = [
  `\n${DEFAULT_FUNNEL_SCOPE} .lg-card-img-placeholder{display:inline-flex;align-items:center;justify-content:center;min-height:32px;padding:0 0.5rem;border:1px dashed #D2D9E5;border-radius:6px;color:#718096;font-size:0.75rem;line-height:1}`,
];

// Legacy plain body: unbound headline + icon grid + ONE continue — a realistic
// v2.4 body carrying NONE of the additive params.
const LEGACY_PLAIN_CONTENT = {
  components: [
    { type: "QuestionHeadline", question_id: "h1", props: { text: "How much coverage?" } },
    {
      type: "IconCardAnswerGrid",
      question_id: "g1",
      question_key: "coverage_q",
      internal_field: "coverage",
      answer_type: "string",
      choices: [
        { label: "Up to $250k", value: "250k", analytics_id: "a_250", icon: "S" },
        { label: "Up to $1m", value: "1m", analytics_id: "a_1m", icon: "L" },
      ],
    },
    { type: "ContinueButton", question_id: "c1", props: { label: "Continue" } },
  ],
};

// Legacy dependency body: conditional leaf + a BOUND headline node WITHOUT the
// headline param (the trickiest identity case: the bound node must keep
// rendering EMPTY text on a legacy body after the sectionCtx thread) + ONE
// ContinueButton (single-control identity through the threaded state).
const LEGACY_DEP_CONTENT = {
  components: [
    { type: "QuestionHeadline", question_id: "h1", bind: "section_headline", props: {} },
    {
      type: "TwoButtonYesNo",
      question_id: "q1",
      question_key: "insured_q",
      internal_field: "insured",
      answer_type: "boolean",
    },
    {
      type: "FreeTextQuestion",
      question_id: "q2",
      question_key: "insurer_q",
      internal_field: "insurer",
      answer_type: "string",
      required: true,
      conditional: { when: "insured", op: "eq", value: true },
    },
    { type: "ContinueButton", question_id: "c1", props: { label: "Continue" } },
  ],
};

// Field-level byte comparison against a pre-change capture: identical key sets
// (no additive key may leak into a legacy response) + byte-equal values, css
// compared modulo EXACTLY the moved card rules.
function assertPinnedResponse(actualText: string, fixtureText: string): void {
  const actual = JSON.parse(actualText) as Record<string, unknown>;
  const expected = JSON.parse(fixtureText) as Record<string, unknown>;
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
  const actualPreview = actual["preview"] as Record<string, unknown>;
  const expectedPreview = expected["preview"] as Record<string, unknown>;
  expect(Object.keys(actualPreview)).toEqual(Object.keys(expectedPreview));
  for (const key of Object.keys(expectedPreview)) {
    if (key === "css") continue;
    // R5 D11: desktop/mobile HTML carries the SAME headline typography
    // delta inline (per-node) — reverse-map before comparing, exactly the
    // css modulo idiom below, so this stays a true "nothing ELSE changed" pin.
    const actualVal = typeof actualPreview[key] === "string" ? stripAutoErrorSlots(unmapR5Typography(unmapColumnsClamp(actualPreview[key] as string))) : actualPreview[key];
    expect(actualVal, `preview.${key}`).toEqual(expectedPreview[key]);
  }
  // css: the ONLY legal deltas are the moved base-sheet chunks (byte-exact):
  // the three DEV-57 card rules + the DEV-68 --lg-sel-bg consumer + the R5
  // state-safe-border rule bodies + the R5 D11 typography rule bodies
  // (headline/subheadline, reverse-mapped to their pre-R5 shape FIRST — a
  // full-rule replace, not a bare-substring remove, since the inserted
  // `border-color:var(--lg-field-border, ...)` text also occurs,
  // pre-existing and unrelated, inside the .lg-input rule).
  const cssMinusMove = (actualPreview["css"] as string)
    // P2b FIX-ROUND (adversarial review MINOR-3): strip the two NET-NEW
    // conditional align-items rules first (neither ever matches this legacy/
    // unstyled content — anyChoiceHasHeight is false throughout — so this is
    // a pure wholesale removal, the SAME bucket as the P1a net-new rules
    // below).
    .split(P2B_ANSWER_GROUP_HEIGHTS_RULE)
    .join("")
    .split(P2B_CARD_GRID_HEIGHTS_RULE)
    .join("")
    // P2b (register R-A completion): reverse-map the RESTING rules back to
    // the R5_NEW_* shape — the EXISTING R5 steps immediately below then find
    // their expected R5 input unchanged (see the P2B_NEW_* constants' own
    // comment).
    .split(P2B_NEW_BTN_ANSWER_RULE)
    .join(R5_NEW_BTN_ANSWER_RULE)
    .split(P2B_NEW_CARD_RULE)
    .join(R5_NEW_CARD_RULE)
    // P2b FIX-ROUND R1 (adversarial review — "per-choice paint PERSISTS
    // across states"): hover/selected background reverse-mapped to their
    // pre-fix-round shape (hover/selected text has been STABLE since P1a —
    // no earlier round ever touched it, so this reverse-maps straight to the
    // frozen fixture's own literal text, verified against it directly).
    .split(P2B_NEW_BTN_HOVER_RULE)
    .join(R5_OLD_BTN_HOVER_RULE)
    .split(P2B_NEW_BTN_SELECTED_BASE_RULE)
    .join(R5_OLD_BTN_SELECTED_BASE_RULE)
    .split(P2B_NEW_SEL_BG_CONSUMER_RULE)
    .join(R5_OLD_SEL_BG_CONSUMER_RULE)
    .split(P2B_NEW_CARD_HOVER_RULE)
    .join(R5_OLD_CARD_HOVER_RULE)
    .split(P2B_NEW_CARD_SELECTED_RULE)
    .join(R5_OLD_CARD_SELECTED_RULE)
    .split(R5_NEW_BTN_ANSWER_RULE)
    .join(R5_OLD_BTN_ANSWER_RULE)
    .split(R5_NEW_CARD_RULE)
    .join(R5_OLD_CARD_RULE)
    .split(R5_NEW_HEADLINE_RULE)
    .join(R5_OLD_HEADLINE_RULE)
    .split(R5_NEW_SUBHEAD_OVERRIDE_RULE)
    .join("")
    .split(R5_NEW_SUBHEAD_RULE)
    .join(R5_OLD_SUBHEAD_RULE)
    .split(MOVED_CARD_RULES)
    .join("")
    .split(MOVED_SEL_BG_RULE)
    .join("")
    // OWNER 2026-08-23 — revert the <summary> tail onto the old <button> rule
    // body, and strip the net-new pop-up rules.
    .split(DISCLOSURE_SUMMARY_DELTA)
    .join("}")
    .split(DISCLOSURE_POPUP_RULES)
    .join("")
    .split(U14_NEW_CONTINUE_RULE)
    .join(U14_OLD_CONTINUE_RULE)
    // P1a (register PC-1/PC-3/PC-11): strip the net-new stack/grid rules, revert
    // the two changed rule bodies (.lg-card-icon centering + .lg-card min-height
    // 140->96) back to the pre-P1a fixture shape.
    .split(P1A_STACK_BASE_RULE)
    .join("")
    .split(P1A_ANSWER_GRID_RULE)
    .join("")
    .split(P1A_STACK_MOBILE_RULE)
    .join("")
    .split(P1A_SUBHEAD_MOBILE_RESET)
    .join("")
    .split(P1A_CONTINUE_MOBILE_RESET)
    .join("")
    .split(P1A_ANSWER_GRID_MOBILE_GAP)
    .join("")
    .split(P1A_NEW_CARD_ICON_RULE)
    .join(P1A_OLD_CARD_ICON_RULE)
    .split(`min-height:${defaultFunnelDesign.iconCard.minHeight}`)
    .join(`min-height:${P1A_OLD_CARD_MIN_HEIGHT}`)
    // P1a FIX ROUND (register PC-3): strip the net-new grid-follower
    // collapse-emulation table (the ONLY legal delta this fix round adds).
    .split(P1A_FIX_ROUND_EXCEPTION_TABLE)
    .join("")
    // P1 hidden-attribute fix (register PC): strip the net-new terminal
    // `[hidden]{display:none}` guard — the ONLY legal delta this fix adds.
    .split(P1_HIDDEN_GUARD_RULE)
    .join("")
    // MINOR-1 (adversarial review, register PC): strip the net-new CardPanel/
    // BackgroundPanel stack-floor rules — the ONLY legal delta this fix adds.
    .split(MINOR1_CARD_PANEL_FLOOR_RULE)
    .join("")
    .split(MINOR1_BG_PANEL_FLOOR_RULE)
    .join("")
    .split(MINOR1_CARD_PANEL_FLOOR_MOBILE_RULE)
    .join("")
    .split(MINOR1_BG_PANEL_FLOOR_MOBILE_RULE)
    .join("")
    // LeadGen Rework §6.7 FIX-FIRST F2 (adversarial review, 2026-07-22):
    // revert .lg-card-grid's grid-template-columns VALUE back to the
    // pre-F1/F2 shape (the --lg-tracks fallback chain is the ONLY delta this
    // fix adds to this rule — see F2_CARD_GRID_TRACKS_NEW/OLD's own comment).
    .split(F2_CARD_GRID_TRACKS_NEW)
    .join(F2_CARD_GRID_TRACKS_OLD)
    // F2 FOLLOW-UP: strip the two NET-NEW --lg-gc-start/--lg-gc-end consumer
    // rules (see F2_GC_CONSUMER_RULE/F2_GC_MOBILE_RESET_RULE's own comment) —
    // neither existed pre-P1a, same wholesale-strip treatment as
    // P1A_ANSWER_GRID_RULE above.
    .split(F2_GC_CONSUMER_RULE)
    .join("")
    .split(F2_GC_MOBILE_RESET_RULE)
    .join("");
  // P3a (register PC-2 / D1 / R-B): strip the net-new .lg-el/.lg-el-row rules
  // (the ONLY additional legal delta this slice adds — the grid-follower table
  // growth is already handled by followerSelectorsFixRound above).
  const cssMinusEl = P3A_EL_RULES.reduce((s, r) => s.split(r).join(""), cssMinusMove);
  const cssMinusP1b = ROUND4_P1B_RULES.reduce((s, r) => s.split(r).join(""), cssMinusEl);
  // R2 P1 §①: strip the two net-new QuestionGrid container rules (see their
  // constant above — the only base-sheet delta this slice adds).
  const cssMinusGrid = R2_P1_QUESTION_GRID_RULES.reduce((s, r) => s.split(r).join(""), cssMinusP1b);
  // R2 P4 S4a: strip the net-new §6.8 slider rules, then reverse-map the three
  // changed ones to their pre-P4 text (see the constants above).
  const cssMinusRange = R2_P4_RANGE_NEW_RULES.reduce((s, r) => s.split(r).join(""), cssMinusGrid);
  const cssMinusRangeChanged = R2_P4_RANGE_CHANGED_RULES.reduce(
    (s, [next, prev]) => s.split(next).join(prev),
    cssMinusRange,
  );
  // R2 P5 F7: strip the two net-new address-label/Other-select rules (see
  // R2_P5_ADDRESS_LABEL_RULES's own comment above — the only base-sheet
  // delta this slice adds).
  const cssMinusAll = R2_P5_ADDRESS_LABEL_RULES.reduce(
    (s, r) => s.split(r).join(""),
    cssMinusRangeChanged,
  );
  // R2 P8-3 S3.10: reverse-map the ONE re-pointed selector (see
  // P8_S310_ERROR_SELECTOR_REPOINT's own comment) back to its pre-change text.
  const cssMinusRepoint = P8_S310_ERROR_SELECTOR_REPOINT.reduce(
    (s, [next, prev]) => s.split(next).join(prev),
    cssMinusAll,
  );
  // R2 P8-6: strip the ONE net-new max-rail hit-area clip rule (see
  // P8_S6_RANGE_MAX_RAIL_CLIP_RULE's own comment above — the only base-sheet
  // delta this slice adds).
  const cssMinusRailClip = P8_S6_RANGE_MAX_RAIL_CLIP_RULE.reduce(
    (s, r) => s.split(r).join(""),
    cssMinusRepoint,
  );
  // 2026-08-11: strip the ONE net-new not-picked-yet card-image slot rule (see
  // R2_CARD_IMG_PLACEHOLDER_RULE's own comment above).
  const cssMinusCardPlaceholder = R2_CARD_IMG_PLACEHOLDER_RULE.reduce(
    (s, r) => s.split(r).join(""),
    cssMinusRailClip,
  );
  expect(
    cssMinusCardPlaceholder,
    "preview.css modulo the DEV-57 + DEV-68 moved rules + the R5 state-safe-border + R5 D11 typography rule bodies + the P1a layout system + the P3a structured-placement (.lg-el/.lg-el-row) rules + the Round-4 P1b studio/preview affordances (ghost/address-composite/mqg-empty) + the R2 P4 §6.8 slider anatomy rules + the R2 P5 F7 address-field-label/Other-select rules + the R2 P8-6 from_to max-rail hit-area clip rule + the not-picked-yet card-image slot rule",
  ).toBe(expectedPreview["css"]);
  // and the live producer still owns the string (the sections-api :863 idiom).
  expect(actualPreview["css"]).toBe(funnelChromeCss(getFunnelDesign(null)));
  if (expected["dependencies"] !== undefined) {
    expect(actual["dependencies"]).toEqual(expected["dependencies"]);
  }
}

describeDb("POST /sections/preview — legacy unit-only byte-pin (13 §13.4 'absent → byte-identical')", () => {
  it("plain legacy body: every response field byte-equals the pre-change capture", async () => {
    const { env } = newEnv();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", { content_json: JSON.stringify(LEGACY_PLAIN_CONTENT), viewport: "desktop" }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const text = await res.text();
    const fixture = readOrMintFixture(FIXTURE_PLAIN, text, "unit-only-plain");
    assertPinnedResponse(text, fixture);
  });

  it("dependency-sim legacy body (bound node, no headline param): byte-equals the pre-change capture", async () => {
    const { env } = newEnv();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(LEGACY_DEP_CONTENT),
        sample_answers: { insured: false },
      }),
      env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const text = await res.text();
    const fixture = readOrMintFixture(FIXTURE_DEP_SIM, text, "unit-only-dependency-sim");
    assertPinnedResponse(text, fixture);
    // ground the capture itself: the conditional leaf IS hidden in the pinned markup.
    const body = JSON.parse(text) as PreviewResponse;
    expect(body.preview.component_count).toBe(3); // h1 + q1 + c1 visible, q2 hidden
    expect(body.preview.desktop).not.toContain('data-question-id="q2"');
  });
});

// ===========================================================================
// 2. frame_context — the §13.4 composed render
// ===========================================================================

describeDb("POST /sections/preview — frame_context (13 §13.4 unit-in-frame)", () => {
  it("renders the unit INSIDE the funnel's effective frame — 13 §13.5 leg 2 byte-parity with the runtime shell", async () => {
    const fx = await seedFixture();

    // The runtime shell for the same (funnel, variant, site) inputs.
    const served = await app.request(`${TENANT_ORIGIN}/lg/frame`, {}, fx.env);
    expect(served.status, await served.clone().text()).toBe(200);
    const servedHtml = await served.text();
    const servedRoot = extractRootBody(servedHtml);
    const servedCss = extractStyle(servedHtml);

    // The composed preview of section 0 under the same frame_context.
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit(
        "POST",
        previewBodyFor(fx.sections[0]!, {
          funnel_public_id: fx.funnel.public_id,
          variant_public_id: fx.variant.public_id,
          site_id: "site-1",
        }),
      ),
      fx.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as PreviewResponse;

    // Expected body: the SERVED shell with its section list narrowed to the
    // previewed unit — byte-level (same renderQuoteFrame, same effective
    // tokens, same branding, same sectionCount ⇒ identical frame regions; the
    // unit subtree is the shell's own section-0 block, bound headline included).
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
    // §4.3-11: the served shell now composes the shared-page section too
    // (composedSections = shared + this variant's own, shared first) —
    // proves servedRoot's real structure still matches renderVariantSectionsHtml
    // over the full composed list.
    const resolvedSections: ResolvedFunnelSection[] = fx.composedSections.map((section, index) => ({
      position: index,
      section,
    }));
    const servedSectionsHtml = renderVariantSectionsHtml(
      resolvedSections,
      composition!.effectiveTokens.design,
      composition!.frame,
    );
    expect(servedRoot).toContain(servedSectionsHtml);
    // The previewed unit itself (fx.sections[0]) is rendered SOLO by
    // /sections/preview — position 0, visible — regardless of its real
    // index/hidden state within the wider composed list (index 1, hidden,
    // now that the shared section composes first). The "expected" comparison
    // must use that SAME solo rendering (the same renderVariantSectionsHtml
    // call, a one-element list), not a slice out of the multi-section
    // composed html — those two representations of the SAME section are
    // legitimately byte-different (index/hidden), by design, not a bug.
    const soloSectionHtml = renderVariantSectionsHtml(
      [{ position: 0, section: fx.sections[0]! }],
      composition!.effectiveTokens.design,
      composition!.frame,
    );
    // Rework §8.8 (follow-up round, conductor-granted): previewSectionHandler
    // is UNCONDITIONALLY an admin preview leg (never a live visitor path —
    // that is serve.ts, the SEPARATE call `served` above already made), so it
    // now also passes adminPreview:true + a real siteSettingsHref (built from
    // this test's OWN frame_context.site_id:"site-1") into renderQuoteFrame.
    // frame.ts's renderLogoFallbackChip renders the "Open Site settings" link
    // ONLY on that admin leg — servedRoot (the LIVE path) never gets it. This
    // is the CONTRACT'S OWN "live serve passes nothing" distinction, not a
    // parity bug: splice in the ONE known, deterministic admin-only fragment
    // before comparing, so the assertion still proves byte-parity for
    // EVERYTHING else.
    const siteSettingsLink =
      '<div class="lg-frame-logo-fallback-link" data-admin-preview-hint="1" style="text-align:center;margin-top:8px">' +
      '<a href="/admin/settings?site_id=site-1" style="font-size:11.5px;font-weight:700;color:#1B3A5C;' +
      'border-bottom:1px solid #9DBCDD;text-decoration:none">Open Site settings &rarr;</a></div>';
    const expectedBodyLive = servedRoot.replace(servedSectionsHtml, soloSectionHtml);
    expect(expectedBodyLive).not.toContain("lg-frame-logo-fallback-link"); // calibration: the live shell truly never carries it
    const expectedBody = expectedBodyLive.replace('<div class="lg-frame-header-extras">', siteSettingsLink + '<div class="lg-frame-header-extras">');
    expect(body.preview.desktop).toBe(expectedBody);
    expect(body.preview.mobile).toBe(expectedBody); // composed body is viewport-invariant

    // Frame regions + unit are BOTH present.
    expect(body.preview.desktop).toContain('data-frame-template="header-footer"');
    expect(body.preview.desktop).toContain("<section data-lg-section");
    expect(body.preview.desktop).toContain('data-question-id="q1"');
    expect(body.preview.desktop).toContain(">Are you insured?</h1>"); // bound headline text
    expect(body.preview.desktop).toContain(LG_BANNERS_MOUNT_HTML);

    // css: the SAME resolveTokens+funnelChromeCss string the runtime embeds.
    expect(body.preview.css).toBe(servedCss);
    expect(body.preview.design_id).toBe(design.id);
  });

  // Rework §4.3-11 ("Progress bar total = shared pages + pages of the
  // currently-known funnel") + §5-M2 P1 entry gate: resolveSectionPreviewFrame's
  // sectionCount must add the QUOTE's shared-page (quote_id-owned) section
  // count to the chosen variant's own count, not just the variant's own rows —
  // otherwise the in-frame preview under-reports steps relative to what a live
  // visitor of this funnel would eventually see once the shared page ships.
  it("sectionCount adds the quote's shared-page sections to the chosen variant's own count (§4.3-11)", async () => {
    const fx = await seedFixture();
    // fx already carries 2 variant-owned sections (q1, q2) PLUS 1 shared-page
    // section (seedFixture's own M2 activation prerequisite — see its
    // doc comment). Add a SECOND section placed on the QUOTE's shared page
    // directly — quote_id set, variant_id NULL (the M2 owner axis) — never
    // referenced by fx.variant at all, to prove MULTIPLE shared-page
    // sections all count, not just a single fixed one.
    const shared = seedSection(fx.sdb, "Shared first page question", "q3");
    // position 1 — position 0 is seedFixture's own shared-page section (its
    // M2 activation prerequisite).
    fx.sdb
      .prepare("INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position) VALUES (?, ?, 1)")
      .run(fx.quote.id, shared.id);

    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit(
        "POST",
        previewBodyFor(fx.sections[0]!, {
          funnel_public_id: fx.funnel.public_id,
          variant_public_id: fx.variant.public_id,
        }),
      ),
      fx.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as PreviewResponse;
    // 2 variant-owned + 2 shared-page (fixture's default + this test's own) = 4.
    expect(body.preview.desktop).toContain('aria-valuemax="4"');
    expect(body.preview.desktop).not.toContain('aria-valuemax="2"');
  });

  it("variant leg: variant_public_id applies the variant frame_overrides; absent variant → funnel-level frame only", async () => {
    const fx = await seedFixture();

    const withVariant = await admin.request(
      `${API}/sections/preview`,
      jsonInit(
        "POST",
        previewBodyFor(fx.sections[0]!, {
          funnel_public_id: fx.funnel.public_id,
          variant_public_id: fx.variant.public_id,
        }),
      ),
      fx.env,
    );
    expect(withVariant.status).toBe(200);
    const withVariantBody = (await withVariant.json()) as PreviewResponse;
    // the variant override restyled progress to numbered/above_unit.
    expect(withVariantBody.preview.desktop).toContain("lg-frame-progress--numbered");

    const funnelOnly = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", previewBodyFor(fx.sections[0]!, { funnel_public_id: fx.funnel.public_id })),
      fx.env,
    );
    expect(funnelOnly.status).toBe(200);
    const funnelOnlyBody = (await funnelOnly.json()) as PreviewResponse;
    // funnel config says bar — the variant's numbered restyle must NOT apply.
    expect(funnelOnlyBody.preview.desktop).toContain('data-frame-template="header-footer"');
    expect(funnelOnlyBody.preview.desktop).not.toContain("lg-frame-progress--numbered");
  });

  it("site leg: site_id bakes that site's branding; no site_id → ladder floor; unknown site → 404", async () => {
    const fx = await seedFixture();
    const frameContext = {
      funnel_public_id: fx.funnel.public_id,
      variant_public_id: fx.variant.public_id,
    };

    const withSite = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", previewBodyFor(fx.sections[0]!, { ...frameContext, site_id: "site-1" })),
      fx.env,
    );
    expect(withSite.status).toBe(200);
    const withSiteBody = (await withSite.json()) as PreviewResponse;
    // §10 branding ladder with no site_settings rows → the site's canonical
    // hostname renders as the logo text mark.
    expect(withSiteBody.preview.desktop).toContain(">one.example.com</span>");
    expect(withSiteBody.preview.desktop).not.toContain(CMS_FALLBACK_LOGO_TEXT);

    const noSite = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", previewBodyFor(fx.sections[0]!, frameContext)),
      fx.env,
    );
    expect(noSite.status).toBe(200);
    const noSiteBody = (await noSite.json()) as PreviewResponse;
    expect(noSiteBody.preview.desktop).toContain(CMS_FALLBACK_LOGO_TEXT); // §10.2 floor
    expect(noSiteBody.preview.desktop).not.toContain("one.example.com");

    const badSite = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", previewBodyFor(fx.sections[0]!, { ...frameContext, site_id: "nope" })),
      fx.env,
    );
    expect(badSite.status).toBe(404);
  });

  // R2 P3 tail — item 4 (coordinator-extended scope, both resolveFrameComposition
  // AND resolveEffectiveFrameOnly threaded with saved_template_defaults): a
  // template-seeded funnel (frame_template_id set, frame_config_json truly
  // absent — the state "apply template" leaves behind) now composes a REAL
  // frame here too, so the Sections-tab preview shows the SAME footer region
  // the live page (resolver.ts) and the Templates-tab activation preview
  // (quotes-handlers.ts) already render — one truth on every surface.
  it("R2 P3 tail item 4: a template-seeded funnel's footer region renders in the Sections-tab preview", async () => {
    const fx = await seedFixture({ withFrame: false });
    const templateJson = JSON.stringify({
      version: 1,
      template: "centered",
      footer: {
        enabled: true,
        show_on: "all",
        links_source: "site",
        links: [],
        trust_text: null,
        description: null,
        show_logo: true,
        hide_on_mobile: false,
      },
    });
    fx.sdb
      .prepare("INSERT INTO leadgen_frame_templates (public_id, name, frame_json) VALUES (?, ?, ?)")
      .run("lgft_p3tailitem4test", "P3 tail item 4 test template", templateJson);
    const tpl = fx.sdb
      .prepare("SELECT id FROM leadgen_frame_templates WHERE public_id = ?")
      .get("lgft_p3tailitem4test") as { id: number };
    fx.sdb.prepare("UPDATE leadgen_funnels SET frame_template_id = ? WHERE id = ?").run(tpl.id, fx.funnel.id);

    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit(
        "POST",
        previewBodyFor(fx.sections[0]!, {
          funnel_public_id: fx.funnel.public_id,
          variant_public_id: fx.variant.public_id,
          site_id: "site-1",
        }),
      ),
      fx.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as PreviewResponse;
    // FAIL-BEFORE (both fixes reverted): this was absent — composition
    // resolved null and previewSectionHandler took the renderLegacyShell
    // fork, which carries no frame regions at all.
    expect(body.preview.desktop, "template-seeded funnel must show its footer region here too").toContain(
      'data-frame-region="footer"',
    );
    expect(body.preview.desktop).toContain('data-show-on="all"');
  });

  it("sim + viewport honored in-frame: selected-state markup renders inside the frame; viewport names preview.html", async () => {
    const fx = await seedFixture();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit(
        "POST",
        previewBodyFor(
          fx.sections[0]!,
          {
            funnel_public_id: fx.funnel.public_id,
            variant_public_id: fx.variant.public_id,
            site_id: "site-1",
          },
          { viewport: "mobile", sim: { state: "selected", answers: { q1_field: true } } },
        ),
      ),
      fx.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as PreviewResponse;
    expect(body.preview.sim_state).toBe("selected");
    // the selected sim is server-rendered INTO the in-frame unit markup.
    expect(body.preview.desktop).toContain('data-frame-template="header-footer"');
    expect(body.preview.desktop).toContain('aria-checked="true"');
    // viewport named → preview.html carries the composed (viewport-invariant) body.
    expect(body.preview.html).toBe(body.preview.mobile);
    expect(body.preview.html).toBe(body.preview.desktop);
    // the answer basis also yields the §12.3 dependencies echo, frame or not.
    expect(body.dependencies).toBeDefined();
  });

  it("dependency sim in-frame: hidden leaf dropped inside the frame; bound headline renders the canonical text (DEV-57 lifted)", async () => {
    const fx = await seedFixture();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(LEGACY_DEP_CONTENT),
        headline: "Are you insured?",
        section_public_id: fx.sections[0]!.public_id,
        sample_answers: { insured: false },
        frame_context: {
          funnel_public_id: fx.funnel.public_id,
          variant_public_id: fx.variant.public_id,
        },
      }),
      fx.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as PreviewResponse;
    expect(body.preview.desktop).toContain('data-frame-template="header-footer"');
    expect(body.preview.desktop).not.toContain('data-question-id="q2"'); // unmet conditional hidden
    expect(body.preview.desktop).toContain(">Are you insured?</h1>"); // bound node renders ctx text
  });

  it("unit-only dependency sim now threads the sectionCtx: bound headline renders when the body names it (no frame)", async () => {
    const { env } = newEnv();
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", {
        content_json: JSON.stringify(LEGACY_DEP_CONTENT),
        headline: "Are you insured?",
        sample_answers: { insured: false },
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as PreviewResponse;
    expect(body.preview.desktop).toContain(">Are you insured?</h1>");
    expect(body.preview.desktop).not.toContain('data-question-id="q2"');
  });

  it("unknown funnel → 404; unknown variant → 404; a variant of ANOTHER funnel → 404", async () => {
    const fx = await seedFixture();

    const badFunnel = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", previewBodyFor(fx.sections[0]!, { funnel_public_id: mintPublicId("funnel") })),
      fx.env,
    );
    expect(badFunnel.status).toBe(404);

    const badVariant = await admin.request(
      `${API}/sections/preview`,
      jsonInit(
        "POST",
        previewBodyFor(fx.sections[0]!, {
          funnel_public_id: fx.funnel.public_id,
          variant_public_id: mintPublicId("funnel_variant"),
        }),
      ),
      fx.env,
    );
    expect(badVariant.status).toBe(404);

    // a real variant that belongs to a DIFFERENT funnel is not resolvable here.
    const other = await seedFixture();
    const crossVariant = await admin.request(
      `${API}/sections/preview`,
      jsonInit(
        "POST",
        previewBodyFor(fx.sections[0]!, {
          funnel_public_id: fx.funnel.public_id,
          variant_public_id: other.variant.public_id,
        }),
      ),
      fx.env,
    );
    expect(crossVariant.status).toBe(404);
  });

  it("a funnel with NULL frame composes via the byte-pinned legacy shell (the §13.1 fail-safe fork)", async () => {
    const fx = await seedFixture({ withFrame: false });
    const section = fx.sections[0]!;
    const res = await admin.request(
      `${API}/sections/preview`,
      jsonInit(
        "POST",
        previewBodyFor(section, {
          funnel_public_id: fx.funnel.public_id,
          variant_public_id: fx.variant.public_id,
        }),
      ),
      fx.env,
    );
    expect(res.status, await res.clone().text()).toBe(200);
    const body = (await res.json()) as PreviewResponse;

    // byte-equal to renderLegacyShell over the same inputs: base design, the
    // row identity attrs, and the ONE section wrapper (frame=null ctx).
    const design = getFunnelDesign(fx.variant.funnel_design_id);
    const sectionsHtml = renderVariantSectionsHtml([{ position: 0, section }], design, null);
    const expected = renderLegacyShell({
      designId: design.id,
      funnelId: fx.funnel.public_id,
      funnelVariantId: fx.variant.public_id,
      quoteId: fx.quote.public_id,
      contentVersion: fx.variant.content_version,
      sectionsHtml,
      bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    });
    expect(body.preview.desktop).toBe(expected);
    expect(body.preview.desktop).not.toContain("lg-frame");
    // css: the legacy sheet — NO frame-region rules.
    expect(body.preview.css).toBe(funnelChromeCss(design, `[${FUNNEL_DESIGN_SCOPE_ATTR}="${design.id}"]`));
    expect(body.preview.css).not.toContain(".lg-frame-");
  });

  it("frame_context shape validation: non-object / missing funnel_public_id → 400 path-precise", async () => {
    const fx = await seedFixture();

    const notObject = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", previewBodyFor(fx.sections[0]!, undefined, { frame_context: "nope" })),
      fx.env,
    );
    expect(notObject.status).toBe(400);
    const notObjectBody = (await notObject.json()) as { fields: Record<string, string> };
    expect(notObjectBody.fields["frame_context"]).toBeDefined();

    const noFunnel = await admin.request(
      `${API}/sections/preview`,
      jsonInit("POST", previewBodyFor(fx.sections[0]!, {})),
      fx.env,
    );
    expect(noFunnel.status).toBe(400);
    const noFunnelBody = (await noFunnel.json()) as { fields: Record<string, string> };
    expect(noFunnelBody.fields["frame_context.funnel_public_id"]).toBeDefined();

    const badVariantType = await admin.request(
      `${API}/sections/preview`,
      jsonInit(
        "POST",
        previewBodyFor(fx.sections[0]!, { funnel_public_id: fx.funnel.public_id, variant_public_id: 7 }),
      ),
      fx.env,
    );
    expect(badVariantType.status).toBe(400);
    const badVariantBody = (await badVariantType.json()) as { fields: Record<string, string> };
    expect(badVariantBody.fields["frame_context.variant_public_id"]).toBeDefined();
  });
});

// ===========================================================================
// 3. renderSectionComponentsVisible sectionCtx thread (DEV-57) — renderer level
// ===========================================================================

const DESIGN = defaultFunnelDesign;

const q = (id: string, field: string): LeadgenComponentNode => ({
  type: "TwoButtonYesNo",
  question_id: id,
  question_key: `${id}_key`,
  internal_field: field,
  answer_type: "boolean",
});

describe("renderSectionComponentsVisible — sectionCtx thread (DEV-57, legacy identity)", () => {
  const BOUND_TREE: LeadgenComponentNode[] = [
    { type: "QuestionHeadline", question_id: "h1", bind: "section_headline", props: {} },
    q("q1", "insured"),
    { type: "ContinueButton", question_id: "c1", props: { label: "Go on" } },
  ];
  const ALL = new Set(["h1", "q1", "c1"]);
  const CTX: LeadgenSectionRenderCtx = {
    headline_text: "Bound headline",
    subheadline_text: null,
    design_overrides: { palette: { button_primary_text: "#00AA00" }, gapDefault: "1.25rem" },
  };

  it("no-ctx call renders byte-identically (3-arg ≡ explicit-undefined ≡ filter-then-render)", () => {
    const threeArg = renderSectionComponentsVisible(BOUND_TREE, DESIGN, ALL);
    expect(renderSectionComponentsVisible(BOUND_TREE, DESIGN, ALL, undefined)).toBe(threeArg);
    // the bound node keeps rendering EMPTY text without a ctx (DEV-57 legacy).
    expect(threeArg).toContain('class="lg-headline"');
    expect(threeArg).not.toContain("Bound headline");
  });

  it("all-visible flat content WITH ctx ≡ renderSectionComponents with the same ctx (byte-for-byte)", () => {
    const viaVisible = renderSectionComponentsVisible(BOUND_TREE, DESIGN, ALL, CTX);
    const viaFull = renderSectionComponents(BOUND_TREE, DESIGN, CTX);
    expect(viaVisible).toBe(viaFull);
    expect(viaVisible).toContain(">Bound headline</h1>"); // bound text
    expect(viaVisible).toContain("color:#00AA00"); // §9.5 layer-4 palette re-point
  });

  it("all-visible CONTAINER tree WITH ctx ≡ renderSectionComponents (state threads through wrappers)", () => {
    const tree: LeadgenComponentNode[] = [
      {
        type: "Stack",
        question_id: "s1",
        props: {},
        children: [
          { type: "QuestionHeadline", question_id: "h1", bind: "section_headline", props: {} },
          q("q1", "insured"),
        ],
      } as LeadgenComponentNode,
      { type: "ContinueButton", question_id: "c1", props: { label: "Go on" } },
    ];
    const ids = new Set(["h1", "q1", "c1"]);
    expect(renderSectionComponentsVisible(tree, DESIGN, ids, CTX)).toBe(
      renderSectionComponents(tree, DESIGN, CTX),
    );
  });

  it("continue semantics thread: auto_advance renders ZERO continue controls; below_unit defers to the single end slot", () => {
    const auto = renderSectionComponentsVisible(BOUND_TREE, DESIGN, ALL, {
      headline_text: "H",
      subheadline_text: null,
      continue_mode: "auto_advance",
    });
    expect(auto).not.toContain("data-lg-continue");

    const below = renderSectionComponentsVisible(BOUND_TREE, DESIGN, ALL, {
      headline_text: "H",
      subheadline_text: null,
      continue_placement: "below_unit",
      continue_style_role: "button_primary",
    });
    expect(below).toContain('class="lg-continue-slot"');
    expect(below).toContain('data-continue-style-role="button_primary"');
    expect(below.split("data-lg-continue").length - 1).toBe(1); // exactly one control
    expect(below).toContain("Go on"); // the node's props feed the slot control
    // …and it byte-equals the full renderer under the same ctx.
    expect(below).toBe(
      renderSectionComponents(BOUND_TREE, DESIGN, {
        headline_text: "H",
        subheadline_text: null,
        continue_placement: "below_unit",
        continue_style_role: "button_primary",
      }),
    );
  });

  it("dependency filtering still drops hidden leaves under a ctx (wrapper-keeping semantics unchanged)", () => {
    const partial = renderSectionComponentsVisible(BOUND_TREE, DESIGN, new Set(["h1", "c1"]), CTX);
    expect(partial).not.toContain('data-question-id="q1"');
    expect(partial).toContain(">Bound headline</h1>");
  });
});
