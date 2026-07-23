// LEADGEN-REWORK-03 §12 P3a — behavior-freeze proof for the mechanical split
// of ui-quotes.ts into api/src/admin/leadgen/quotes-tabs/*. Re-renders the
// SAME seeded fixture quote through the REAL (post-split) admin router — the
// same node:sqlite D1 harness pattern as test/leadgen-quotes-ui.test.ts — and
// asserts the current SSR output is BYTE-IDENTICAL to the fixtures captured
// by src/scripts/capture-p3a-presplit.ts BEFORE any split edit landed
// (test/fixtures/p3a-presplit/*.html). Covers every page ui-quotes.ts serves
// (List empty/seeded, New, Editor, quote-not-found) and every one of the
// Editor's six tab panels (builder/templates/themes/ab/activation/analytics),
// sliced out of the full response with the identical balanced-<div> slicer
// the capture script uses.
//
// A failure here means the split changed rendered output — i.e. it is no
// longer "mechanical." It does NOT re-derive expected content (that would
// just test the code against itself); the expected bytes are the pre-split
// fixtures on disk, captured once, before this phase touched ui-quotes.ts.

import { describe, expect, it, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";

// --- node:sqlite harness (repo pattern; see test/leadgen-quotes-ui.test.ts) --

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
const FIXTURE_DIR = join(TEST_DIR, "fixtures", "p3a-presplit");

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

function newHarness(): { sdb: SqliteDb; env: Env } {
  const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

async function getHtml(env: Env, path: string): Promise<string> {
  const res = await admin.request(path, {}, env);
  return res.text();
}

function seedSection(sdb: SqliteDb, opts: { activity: string; vertical: string; name: string }): { id: number; public_id: string } {
  const publicId = mintPublicId("section");
  const content = JSON.stringify({ components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "k", internal_field: "f", answer_type: "boolean" }] });
  sdb
    .prepare("INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, status) VALUES (?, ?, ?, ?, ?, ?, 'button', 'active')")
    .run(publicId, opts.name, opts.activity, opts.vertical, "Headline", content);
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as { id: number };
  return { id: row.id, public_id: publicId };
}

interface QuoteDetail {
  id: number;
  public_id: string;
  funnels: Array<{ variants: Array<{ public_id: string }> }>;
}

async function createQuote(env: Env, overrides: Record<string, unknown> = {}): Promise<QuoteDetail> {
  const res = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "Life Quote", activity: "quote_funnel", verticals: ["life", "health"], ...overrides }), env);
  expect(res.status, `create quote: ${await res.clone().text()}`).toBe(201);
  return (await res.json()) as QuoteDetail;
}

// --- panel slicer (byte-for-byte the same algorithm capture-p3a-presplit.ts
// uses — duplicated deliberately so this test has zero dependency on
// src/scripts/, matching the repo's harness-duplication convention). --------
function extractPanel(html: string, tabName: string): string {
  const marker = `data-panel="${tabName}"`;
  const markerIdx = html.indexOf(marker);
  if (markerIdx === -1) throw new Error(`panel marker not found: ${tabName}`);
  const openIdx = html.lastIndexOf("<div", markerIdx);
  if (openIdx === -1) throw new Error(`enclosing <div not found for panel: ${tabName}`);
  let depth = 0;
  let pos = openIdx;
  for (;;) {
    const nextOpen = html.indexOf("<div", pos);
    const nextClose = html.indexOf("</div>", pos);
    if (nextClose === -1) throw new Error(`unbalanced <div>/</div> while slicing panel: ${tabName}`);
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      pos = nextOpen + 4;
    } else {
      depth -= 1;
      pos = nextClose + 6;
      if (depth === 0) return html.slice(openIdx, pos);
    }
  }
}

function fixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf8");
}

// Every leadgen public id is <prefix> + a 26-char ULID = 10 time chars
// (Date.now()) + 16 random chars (crypto.getRandomValues) — src/leadgen/
// ids.ts. Both are REAL entropy/clock sources by design (ids must be
// unpredictable + time-sortable in production), so this capture (run once,
// at session start) and this test (run later, in a separate process) mint
// DIFFERENT ids for a quote/section/variant even though every other byte of
// the rendered output is identical. Confirmed by direct diff: every failing
// assertion's ONLY delta was these minted ids (never structure/text/logic).
// Normalize them to stable, first-seen-order placeholders before comparing —
// this keeps the proof honest (a real structural change still fails the
// comparison; only the expected, split-unrelated id churn is absorbed) while
// leaving the on-disk fixtures as the untouched, literal pre-split capture.
const ID_RE = /\blg[a-z]{0,4}_[0-9A-Z]{26}\b/g;
// The preflight blob embeds `computed_at` (wall-clock Date.now() epoch-ms,
// quotes-handlers.ts's preflight computation) — the other source of
// real-clock non-determinism found by direct diff (isolated to exactly this
// one field; every surrounding byte, incl. the full frame/theme/template
// JSON, matched). Normalized the same way as the ids: fixed placeholder, not
// derived from either side, so a real future difference here still fails.
const COMPUTED_AT_RE = /"computed_at":\d+/g;
// P1 MAJOR fix (adversarial review): the two quotes-list-*.html fixtures
// embed resolveTimeframe's rolling last-30-days window (data-analytics-from
// / -to, ui-shared.ts's `new Date()` read AT REQUEST TIME — see the
// durability proof below). Same third source of wall-clock non-determinism
// as computed_at above (isolated to exactly these two attributes; direct
// diff showed nothing else moves) — normalized the identical way: a fixed
// placeholder, not derived from either side, so a real future difference
// (e.g. the from/to pairing itself going wrong) still fails the comparison.
const ANALYTICS_DATE_RE = /(data-analytics-(?:from|to))="[^"]*"/g;
function normalizeIds(html: string): string {
  const seen = new Map<string, string>();
  return html
    .replace(ID_RE, (m) => {
      let placeholder = seen.get(m);
      if (placeholder === undefined) {
        placeholder = `ID_PLACEHOLDER_${seen.size + 1}`;
        seen.set(m, placeholder);
      }
      return placeholder;
    })
    .replace(COMPUTED_AT_RE, `"computed_at":0`)
    .replace(ANALYTICS_DATE_RE, '$1="0000-00-00"');
}

function expectByteIdenticalModuloIds(actual: string, expected: string): void {
  expect(normalizeIds(actual)).toBe(normalizeIds(expected));
}

const TAB_NAMES = ["builder", "templates", "themes", "ab", "activation", "analytics"] as const;

describeDb("P3a split parity — post-split render == pre-split captured fixtures (byte-identical)", () => {
  it("List page, empty state", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/quotes");
    expectByteIdenticalModuloIds(html, fixture("quotes-list-empty.html"));
  });

  // Durability proof for the ANALYTICS_DATE_RE normalizer above. resolveTimeframe
  // (ui-shared.ts) calls `new Date()` INSIDE the function body, at request time —
  // not a module-scope read — so faking the system clock around the SAME render
  // call the other list-page tests make proves the gate survives indefinitely,
  // not just today. Renders under a wall-clock date FAR past this fixture's
  // capture day (2026-07-23) and still asserts byte-parity against the
  // untouched, frozen fixture — proving the normalizer, not luck-of-the-day,
  // is what keeps this gate green.
  it("List page, empty state: parity survives a faked future wall-clock (rolling analytics window normalized, not luck-of-the-day)", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2027-03-15T12:00:00.000Z"));
      const { env } = newHarness();
      const html = await getHtml(env, "/admin/leadgen/quotes");
      // Sanity: the faked clock actually took effect (else this test would
      // vacuously pass without ever exercising the normalizer).
      expect(html).toContain('data-analytics-to="2027-03-15"');
      expect(html).toContain('data-analytics-from="2027-02-14"'); // 29 days back
      expect(html).not.toContain('data-analytics-to="2026-07-23"');
      // Yet still byte-identical (modulo ids/computed_at/analytics-dates) to
      // the fixture captured on a DIFFERENT wall-clock day entirely.
      expectByteIdenticalModuloIds(html, fixture("quotes-list-empty.html"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("List page, one hostile-named quote seeded", async () => {
    const { env } = newHarness();
    await createQuote(env, { quote_name: "<img src=x onerror=alert(1)>" });
    const html = await getHtml(env, "/admin/leadgen/quotes");
    expectByteIdenticalModuloIds(html, fixture("quotes-list-seeded.html"));
  });

  it("/quotes/new create form", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/quotes/new");
    expectByteIdenticalModuloIds(html, fixture("quotes-new.html"));
  });

  it("quote-not-found page", async () => {
    const { env } = newHarness();
    const html = await getHtml(env, "/admin/leadgen/quotes/does-not-exist/edit");
    expectByteIdenticalModuloIds(html, fixture("quotes-not-found.html"));
  });

  describe("Editor page — rich fixture (2 ordered sections + 1 rule)", () => {
    let html = "";

    beforeAll(async () => {
      const { sdb, env } = newHarness();
      const q = await createQuote(env, { quote_name: "<b>Quote</b>" });
      const variantId = q.funnels[0]!.variants[0]!.public_id;
      const s1 = seedSection(sdb, { activity: "quote_funnel", vertical: "life", name: "<i>First</i>" });
      const s2 = seedSection(sdb, { activity: "quote_funnel", vertical: "health", name: "Second" });
      const put = await admin.request(
        `${API}/variants/${variantId}`,
        jsonInit("PUT", { sections: [{ section_id: s1.id }, { section_id: s2.id }], rules: [{ rule_type: "eligibility" }] }),
        env,
      );
      expect(put.status, `seed variant: ${await put.clone().text()}`).toBe(200);
      html = await getHtml(env, `/admin/leadgen/quotes/${q.public_id}/edit`);
    });

    it("full page is byte-identical to the pre-split capture", () => {
      expectByteIdenticalModuloIds(html, fixture("editor-full.html"));
    });

    for (const tab of TAB_NAMES) {
      it(`tab panel "${tab}" is byte-identical to the pre-split capture`, () => {
        const panel = extractPanel(html, tab);
        expectByteIdenticalModuloIds(panel, fixture(`editor-panel-${tab}.html`));
      });
    }
  });
});
