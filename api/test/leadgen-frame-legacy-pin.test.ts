// A0-pin — LEGACY BYTE-IDENTITY REGRESSION PINS (redesign-contract v2.5).
//
//   13 §13.1: `frame === null` (legacy funnels) → `renderLegacyShell` =
//             byte-compatible current markup (regression-pinned).
//   04 §4.8:  `POST /api/admin/leadgen/variants/:id/preview` with the CURRENT
//             (legacy) body shape → byte-identical legacy response
//             (regression-pinned) — including the `<h2 class="lg-section-
//             headline">` duplicate-headline quirk; that duplication IS part
//             of the pinned contract.
//
// The tree at pin time renders exactly like production v2.4 (no rendering-path
// change has landed). These tests freeze that rendering as committed fixtures
// so the upcoming frame-renderer work PROVABLY cannot change legacy output:
// any byte drift in either surface fails here with a diff.
//
// DETERMINISM PROTOCOL (each surface):
//   1. same-harness double render → RAW bytes must be identical (no
//      per-request variance rides the body);
//   2. two INDEPENDENT harnesses (fresh DB, freshly minted ids) → NORMALIZED
//      bytes must be identical (the normalizer covers exactly the seed-time
//      variance, nothing else varies);
//   3. normalized render === the committed fixture (the pin).
//
// NORMALIZATION LIST (keep minimal — every normalized token weakens the pin):
//   1. lgq_/lgf_/lgn_ ULIDs → `<prefix>_` + 24×"L" + 2-digit first-appearance
//      ordinal. Justification: quote/funnel/variant public ids are minted
//      crypto-randomly INSIDE the admin API at seed time (mintPublicId; the
//      API accepts no explicit id), so they are the one irreducible variance;
//      each DISTINCT id maps to a DISTINCT placeholder so identity
//      relationships (same-id-everywhere, funnel_id ≠ funnel_variant_id) stay
//      pinned, and "L" is outside the Crockford ULID alphabet so a placeholder
//      can never be mistaken for (or re-matched as) a live id. Byte length is
//      preserved (4 + 26 chars).
//   — that is the ONLY normalization. Section public ids are eliminated at the
//     SEED level instead (fixed lgs_…PNSEC0N values inserted via direct SQL),
//     which also freezes section_order_hash. Everything else (design tokens,
//     chrome CSS, assignment dims, content_version, funnel_name) is
//     deterministic, enforced by protocol step 2.
//
// UPDATING THE PIN (only when a legacy-output change is INTENDED and reviewed):
//   LEADGEN_PIN_UPDATE=1 npx vitest run test/leadgen-frame-legacy-pin.test.ts
// rewrites the fixtures and then FAILS the run on purpose (an update run can
// never be green) — rerun without the flag to verify the new pin.

import { describe, expect, it } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// --- node:sqlite harness (the leadgen-runtime-api.test.ts pattern) -----------

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
  const kv = {
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
  return kv;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(TEST_DIR, "fixtures", "leadgen-legacy-pin");
const SHELL_FIXTURE = join(FIXTURE_DIR, "legacy-shell.html");
const PREVIEW_FIXTURE = join(FIXTURE_DIR, "legacy-variant-preview.json");
const UPDATE_MODE = process.env["LEADGEN_PIN_UPDATE"] === "1";

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

// Same env values as the runtime harness — the pin renders under the SAME
// conditions the runtime tests prove. The two secrets are present so the pin
// also freezes the fact that neither rides the pinned bytes.
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
    GOOGLE_MAPS_BROWSER_KEY: "test-browser-maps-key-DO-NOT-CACHE",
    LEADGEN_CONFIG_SIGNING_KEY: "runtime-signing-key-test-only",
  } as unknown as Env;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// --- the pinned legacy funnel (seed-level determinism) ------------------------

// FIXED section public ids (valid Crockford shape) — variance eliminated at the
// seed, which also freezes section_order_hash (hash over public_id:version).
function pinnedSectionId(n: number): string {
  return `lgs_${"0".repeat(19)}PNSEC${String(n).padStart(2, "0")}`;
}

// A REALISTIC legacy funnel where chrome lives in sections. Section 1 mirrors
// the §13.2 "Dependent" worked example VERBATIM from
// leadgen-components-render.test.ts (ProgressBar chrome + QuestionHeadline +
// TwoButtonYesNo + conditional DropdownQuestion + ContinueButton); sections 2–3
// mirror that file's NODE_SPECS fixtures for the choice grid + free-text input.
// Each section's headline_text EQUALS its QuestionHeadline props.text — that is
// exactly what produces the legacy duplicate-headline markup the preview pin
// must keep (04 §4.8).
const SECTION_SEEDS = [
  {
    public_id: pinnedSectionId(1),
    name: "Pin Section 01",
    headline: "Are you insured?",
    content: {
      components: [
        { type: "ProgressBar", question_id: "p1", props: { mode: "percent", percent: 40 } },
        { type: "QuestionHeadline", question_id: "h1", props: { text: "Are you insured?" } },
        {
          type: "TwoButtonYesNo",
          question_id: "q_ins",
          question_key: "insured_q",
          internal_field: "currently_insured",
          answer_type: "boolean",
          required: true,
          props: { auto_advance: true },
        },
        {
          type: "DropdownQuestion",
          question_id: "q_insurer",
          question_key: "insurer_q",
          internal_field: "insurer",
          answer_type: "enum",
          choices: [
            { label: "Acme", value: "acme", analytics_id: "ins_acme" },
            { label: "Globex", value: "globex", analytics_id: "ins_globex" },
          ],
          conditional: { when: "currently_insured", op: "eq", value: true },
        },
        { type: "ContinueButton", question_id: "cont1", props: { label: "Continue" } },
      ],
    },
  },
  {
    public_id: pinnedSectionId(2),
    name: "Pin Section 02",
    headline: "What type of business?",
    content: {
      components: [
        { type: "ProgressBar", question_id: "p2", props: { mode: "percent", percent: 70 } },
        { type: "QuestionHeadline", question_id: "h2", props: { text: "What type of business?" } },
        {
          type: "IconCardAnswerGrid",
          question_id: "q_biz",
          question_key: "biz_q",
          internal_field: "biz_type",
          answer_type: "enum",
          required: true,
          choices: [
            { label: "Sole Proprietor", value: "sole_prop", analytics_id: "biz_sole", icon: "🏢" },
            { label: "Partnership", value: "partnership", analytics_id: "biz_partner", icon: "🏢" },
          ],
          props: { columns: 3 },
        },
        { type: "ContinueButton", question_id: "cont2", props: { label: "Continue" } },
      ],
    },
  },
  {
    public_id: pinnedSectionId(3),
    name: "Pin Section 03",
    headline: "Anything else we should know?",
    content: {
      components: [
        { type: "QuestionHeadline", question_id: "h3", props: { text: "Anything else we should know?" } },
        {
          type: "FreeTextQuestion",
          question_id: "q_note",
          question_key: "note_q",
          internal_field: "note",
          answer_type: "string",
          props: { placeholder: "Type…", maxLen: 100 },
        },
        { type: "ContinueButton", question_id: "cont3", props: { label: "Continue" } },
      ],
    },
  },
] as const;

interface Captured {
  shellFirst: string;
  shellSecond: string;
  previewFirst: string;
  previewSecond: string;
}

// Seed one activated legacy funnel through the REAL Stage-B admin API + direct
// section SQL (the runtime-harness pattern, with FIXED section public ids),
// then capture BOTH pinned surfaces twice (same harness).
async function captureAll(): Promise<Captured> {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createRuntimeDb(ctor);
  const env = buildEnv(d1FromSqlite(sdb), makeKvStub());

  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Legacy Pin Quote", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const quote = (await createRes.json()) as {
    id: number;
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  const sectionRefs: Array<{ section_id: number }> = [];
  for (const seed of SECTION_SEEDS) {
    sdb
      .prepare(
        "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', ?, ?, 'button', 0, 'active')",
      )
      .run(seed.public_id, seed.name, seed.headline, JSON.stringify(seed.content));
    const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(seed.public_id) as {
      id: number;
    };
    sectionRefs.push({ section_id: row.id });
  }

  const putRes = await admin.request(`${API}/variants/${variantId}`, jsonInit("PUT", { sections: sectionRefs }), env);
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);

  // Rework M2 (§4.3-1, §4.3-15): activation now also requires the quote's
  // shared first page (leadgen_funnel_pages, quote_id-owned) to carry ≥1
  // section — a section distinct from the funnel/variant's own (§4.3-13
  // uniqueness). Route wiring for POST/PUT /quotes/:id/shared-page is
  // mid-flight in another round, so this seeds the SQL shape directly
  // (mirrors leadgen-rework-handlers.test.ts / leadgen-rework-routing.test.ts).
  // §4.3-11: the live /lg serve path NOW composes shared-page content too
  // (S1.3's resolver.ts slice) — the SHELL pin (surface A) was regenerated to
  // reflect it (the shared section composes first); the PREVIEW pin (surface
  // B, POST /variants/:id/preview's legacy response) was ALREADY composing it
  // before this landed and needed no change — regenerated anyway via the
  // documented LEADGEN_PIN_UPDATE=1 path (never hand-edited) so both stay in
  // lockstep with the SAME seed.
  const sharedPubId = "lgs_" + "0".repeat(19) + "LEGACY1";
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, 'Shared', 'quote_funnel', 'life', 'Shared', ?, 'button', 0, 'active')",
    )
    .run(sharedPubId, JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "qs1", question_key: "ks", internal_field: "fs", answer_type: "boolean" }] }));
  const sharedRow = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(sharedPubId) as { id: number };
  const sharedPagePubId = "lgfp_" + "0".repeat(19) + "LEGACY1";
  sdb.prepare("INSERT INTO leadgen_funnel_pages (public_id, quote_id, position, name) VALUES (?, ?, 0, NULL)").run(sharedPagePubId, quote.id);
  sdb
    .prepare(
      `INSERT INTO leadgen_funnel_variant_sections (quote_id, section_id, position, page_id)
       VALUES (?, ?, 0, (SELECT id FROM leadgen_funnel_pages WHERE public_id = ?))`,
    )
    .run(quote.id, sharedRow.id, sharedPagePubId);

  const actRes = await admin.request(
    `${API}/quotes/${quote.public_id}/activation/site-1`,
    jsonInit("PUT", { enabled: true, slug: "legacy-pin" }),
    env,
  );
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);

  // Surface A — the public /lg funnel shell (twice: cold render, then the
  // KV-cached pristine + per-request splices — bytes must not differ).
  const shellRes1 = await app.request(`${TENANT_ORIGIN}/lg/legacy-pin`, {}, env);
  expect(shellRes1.status, `shell: ${await shellRes1.clone().text()}`).toBe(200);
  const shellFirst = await shellRes1.text();
  const shellRes2 = await app.request(`${TENANT_ORIGIN}/lg/legacy-pin`, {}, env);
  expect(shellRes2.status).toBe(200);
  const shellSecond = await shellRes2.text();

  // Surface B — the legacy variant preview: the CURRENT admin UI posts exactly
  // `{}` (ui-quotes.ts preview button). Captured raw (full JSON body), twice.
  const prevRes1 = await admin.request(`${API}/variants/${variantId}/preview`, jsonInit("POST", {}), env);
  expect(prevRes1.status, `preview: ${await prevRes1.clone().text()}`).toBe(200);
  const previewFirst = await prevRes1.text();
  const prevRes2 = await admin.request(`${API}/variants/${variantId}/preview`, jsonInit("POST", {}), env);
  expect(prevRes2.status).toBe(200);
  const previewSecond = await prevRes2.text();

  return { shellFirst, shellSecond, previewFirst, previewSecond };
}

// Two INDEPENDENT harnesses (fresh DB ⇒ freshly minted quote/funnel/variant
// ids) — memoized so the whole file seeds exactly twice.
let capturedPromise: Promise<{ first: Captured; second: Captured }> | null = null;
function captureTwice(): Promise<{ first: Captured; second: Captured }> {
  capturedPromise ??= (async () => ({ first: await captureAll(), second: await captureAll() }))();
  return capturedPromise;
}

// --- normalization (see the header NORMALIZATION LIST) ------------------------

// Live minted ids: lgq_/lgf_/lgn_ + 26 Crockford chars (no I/L/O/U).
const LIVE_ID_RE = /\b(lgq|lgf|lgn)_[0-9A-HJKMNP-TV-Z]{26}\b/g;

function normalizeLegacyPin(text: string): string {
  const seen = new Map<string, string>();
  return text.replace(LIVE_ID_RE, (match, prefix: string) => {
    let placeholder = seen.get(match);
    if (placeholder === undefined) {
      // 24×"L" + ordinal: L is OUTSIDE the Crockford alphabet ⇒ a placeholder
      // can never re-match LIVE_ID_RE (idempotent, and meta-test-detectable).
      placeholder = `${prefix}_${"L".repeat(24)}${String(seen.size + 1).padStart(2, "0")}`;
      seen.set(match, placeholder);
    }
    return placeholder;
  });
}

// --- mismatch reporting --------------------------------------------------------

// Report-only pretty split (the comparison itself is the raw `===`): break at
// tag boundaries so the giant single-line HTML/JSON yields a readable diff.
function toReportLines(s: string): string[] {
  return s.replace(/></g, ">\n<").split("\n");
}

function pinMismatchReport(label: string, expected: string, actual: string): string {
  let i = 0;
  const n = Math.min(expected.length, actual.length);
  while (i < n && expected.charCodeAt(i) === actual.charCodeAt(i)) i++;
  const around = (s: string): string => JSON.stringify(s.slice(Math.max(0, i - 80), i + 140));
  const e = toReportLines(expected);
  const a = toReportLines(actual);
  let start = 0;
  const lim = Math.min(e.length, a.length);
  while (start < lim && e[start] === a[start]) start++;
  let endE = e.length - 1;
  let endA = a.length - 1;
  while (endE > start && endA > start && e[endE] === a[endA]) {
    endE--;
    endA--;
  }
  const del = e.slice(start, Math.min(endE + 1, start + 40));
  const add = a.slice(start, Math.min(endA + 1, start + 40));
  return [
    `${label}: pinned bytes DIVERGED (expected ${expected.length} chars, actual ${actual.length} chars).`,
    `First differing char index ${i}:`,
    `  expected …${around(expected)}…`,
    `  actual   …${around(actual)}…`,
    `@@ diverging at pretty-line ${start + 1}; first ≤40 differing lines per side @@`,
    ...del.map((l) => `- ${l}`),
    ...add.map((l) => `+ ${l}`),
  ].join("\n");
}

function assertPinned(label: string, fixturePath: string, actualNormalized: string): void {
  if (UPDATE_MODE) {
    mkdirSync(FIXTURE_DIR, { recursive: true });
    writeFileSync(fixturePath, actualNormalized);
    throw new Error(
      `LEADGEN_PIN_UPDATE=1: rewrote ${fixturePath} (${actualNormalized.length} chars). ` +
        "An update run never passes — rerun WITHOUT the flag to verify the new pin.",
    );
  }
  const expected = readFileSync(fixturePath, "utf8");
  if (actualNormalized !== expected) {
    throw new Error(pinMismatchReport(label, expected, actualNormalized));
  }
  expect(actualNormalized).toBe(expected);
}

// ===========================================================================

describeDb("legacy byte-identity pins (v2.5 13 §13.1 + 04 §4.8)", () => {
  it("A. GET /lg/:slug legacy shell — deterministic and byte-identical to the committed pin", async () => {
    const { first, second } = await captureTwice();
    // Protocol 1: same-harness double render — RAW bytes identical (no
    // per-request variance in the body; splices are visitor-invariant here).
    if (first.shellFirst !== first.shellSecond) {
      throw new Error(pinMismatchReport("shell same-harness re-render", first.shellFirst, first.shellSecond));
    }
    // Protocol 2: independent harnesses (different minted ids) — NORMALIZED
    // bytes identical, proving the normalizer covers ALL variance.
    const normA = normalizeLegacyPin(first.shellFirst);
    const normB = normalizeLegacyPin(second.shellFirst);
    if (normA !== normB) {
      throw new Error(pinMismatchReport("shell cross-harness normalized", normA, normB));
    }
    // Protocol 3: the committed pin.
    assertPinned("legacy /lg shell pin", SHELL_FIXTURE, normA);
  });

  it("B. POST /variants/:id/preview with the legacy {} body — deterministic and byte-identical to the committed pin", async () => {
    const { first, second } = await captureTwice();
    if (first.previewFirst !== first.previewSecond) {
      throw new Error(pinMismatchReport("preview same-harness re-render", first.previewFirst, first.previewSecond));
    }
    const normA = normalizeLegacyPin(first.previewFirst);
    const normB = normalizeLegacyPin(second.previewFirst);
    if (normA !== normB) {
      throw new Error(pinMismatchReport("preview cross-harness normalized", normA, normB));
    }
    assertPinned("legacy variant-preview pin", PREVIEW_FIXTURE, normA);
  });

  it("meta: the committed pins are non-trivial and fully normalized", () => {
    const shell = readFileSync(SHELL_FIXTURE, "utf8");
    const preview = readFileSync(PREVIEW_FIXTURE, "utf8");

    // An accidentally-empty pin can never pass: the shell is a real funnel
    // document with the section/mount contract markers.
    expect(shell.length, "shell pin must be a real funnel document").toBeGreaterThan(5000);
    expect(shell).toContain("data-lg-section");
    expect(shell).toContain("data-lg-mount");

    // The preview keeps the legacy duplicate-headline markup: one
    // h2.lg-section-headline per section per viewport (3 sections × 2 wraps).
    expect(preview).toContain("lg-section-headline");
    expect((preview.match(/lg-section-headline/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(preview.length, "preview pin must be a real render payload").toBeGreaterThan(5000);

    // Both pins are valid captures of THE pinned funnel: the seed-fixed
    // section ids are present raw, and no live (unnormalized) minted id
    // survived normalization.
    for (const doc of [shell, preview]) {
      expect(doc).toContain(pinnedSectionId(1));
      expect(doc).toContain(pinnedSectionId(2));
      expect(doc).toContain(pinnedSectionId(3));
      expect(doc.match(LIVE_ID_RE), "no unnormalized minted id may remain in a pin").toBeNull();
      expect(doc).toContain("_LLLLLLLLLLLLLLLLLLLLLLLL"); // ≥1 normalized placeholder present
    }
    // The preview pin is well-formed JSON with the legacy response shape.
    const parsed = JSON.parse(preview) as {
      preview: { css: string; desktop: string; mobile: string; section_count: number };
      config: { sections: unknown[] };
    };
    expect(parsed.preview.section_count).toBe(3);
    expect(parsed.config.sections.length).toBe(3);
  });
});
