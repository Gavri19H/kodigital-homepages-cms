// R2 P8-3 FIX ROUND F5 — MAJOR-3 + MINOR-5 (review-p8-3/REVIEW.md).
//
// MAJOR-3: driven at 1280 with zero presets, the N11 panel's help line
// ("...save one from the Themes manager...", quotes-tabs/themes.ts
// PRESET_ZERO_HELP) and the preset <select>'s own zero-state placeholder
// (quotes-tabs/funnel.ts loadThemePresetOptions) used to disagree — the
// select claimed "create one below" (contract §6 M9.4's own cited stale-
// copy example) when nothing is below it. Fixed: the select now names the
// SAME real place (the Themes manager) the help line does.
// R2 P8-3 FIX ROUND F11 — that last sentence turned out to be one criterion
// too strong: naming the destination INSIDE the select overflows its box by
// +59.05px (review #2's BLOCKER), so F10 shortened the placeholder and the
// destination stayed on the help line beside it. MAJOR-3's assertion is
// re-scoped from the placeholder to the PANEL both strings live in, which is
// what review #1's invariant actually said; the full before/after, the measured
// pixels and the not-weakened argument are on that describe block below.
// F11 also carries a second, unrelated regression: funnelDesignLabel's
// own-property guard (quotes-handlers.ts), at the end of this file.
//
// MINOR-5: the board's Theme chip (quotes-tabs/funnel.ts themeChipLabel)
// used to print the funnel's raw stored `theme_json.theme_id` KV key
// (e.g. "thm_p8-repro") instead of the record's own name ("P8 Repro") —
// an engineering identifier on an operator-facing chip, the exact class of
// defect N1 (contract §7) exists to remove. Fixed: the SSR fallback is now
// a neutral, honest word ("Theme", mirroring templateLabelFor's own
// "Template" fallback), and the raw id is exposed ONLY as a
// `data-theme-preset-id` attribute so the island's existing boot-time
// catalog fetch (loadThemePresetOptions — no NEW request) can rename the
// chip to the real preset name once it resolves.
//
// Both proofs drive the REAL admin router (src/admin/router.ts) against a
// real node:sqlite-backed D1 + an in-memory KV stub (repo pattern,
// duplicated per test file — mirrors leadgen-p8-b2-invalidate.test.ts /
// leadgen-p8-n1-design-label.test.ts): a REAL quote+funnel is minted, a
// REAL theme record is created through the REAL POST /themes endpoint
// (never a hand-built ThemeRecord), assigned to the funnel through the
// REAL PUT /funnels/:id/theme endpoint, and the REAL served editor page is
// read back — never a hand-built HTML fixture.
//
// Environment note (E6): this vitest lane runs in `node` (no DOM). The
// island's client-side rename (applyThemeChipNames, quotes-tabs/funnel.ts)
// cannot execute here — this file proves CODE HEALTH: the real render
// emits an honest SSR label + the exact data the island's existing fetch
// needs, and the SAME catalog endpoint that fetch calls returns the
// matching real name for the real id. The actual DOM swap is a driven-
// product claim for the conductor/reviewer (E6), not this lane.

import { describe, expect, it, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import {
  assertFunnelDesignLabelsComplete,
  FUNNEL_DESIGN_LABELS,
  funnelDesignLabel,
  listFunnelDesignOptions,
} from "../src/admin/leadgen/quotes-handlers";
import type { Env } from "../src/env";
import type { ThemeRecord } from "../src/public/leadgen/designs/theme";

// --- node:sqlite + KV-stub harness (repo pattern; duplicated per test
// file, e.g. leadgen-p8-b2-invalidate.test.ts, leadgen-p8-n1-design-label
// .test.ts) --------------------------------------------------------------

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
    async list(options?: { prefix?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor: string }> {
      const prefix = options?.prefix ?? "";
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix));
      return { keys: keys.map((name) => ({ name })), list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
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

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db, CACHE: kv, MEDIA: {} as R2Bucket, APP_ENV: "test",
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

interface QuoteDetail {
  public_id: string;
  funnels: Array<{ public_id: string; funnel_name: string; variants: Array<{ public_id: string }> }>;
}

const THEME_BODY = {
  name: "P8 Repro",
  roles: {
    brand_primary: "#0B5FFF",
    accent: "#123456",
    page_bg: "#F0F0F0",
    card: "#FFFFFF",
    text: "#101010",
    success: "#0E7C3A",
    error: "#B23A2C",
  },
  typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
  controls: { field_height: "medium", button_size: "m", corners: "rounded" },
};

// --- markup slicing helpers (mirrors leadgen-p8-n1-design-label.test.ts's
// designSelectBlock/designOptionsOf idiom: slice the REAL served HTML, never
// a hand-built stand-in) -----------------------------------------------

function themeChipTag(html: string, funnelPublicId: string): string {
  const marker = `data-theme-picker data-pin="8.2-theme-picker" data-chip-funnel-public-id="${funnelPublicId}"`;
  const idx = html.indexOf(marker);
  expect(idx, `the theme chip for funnel ${funnelPublicId} must be present in the served board`).toBeGreaterThan(-1);
  const tagStart = html.lastIndexOf("<span", idx);
  const tagEnd = html.indexOf("</span>", idx);
  expect(tagStart, "theme chip span must open").toBeGreaterThan(-1);
  expect(tagEnd, "theme chip span must close").toBeGreaterThan(-1);
  return html.slice(tagStart, tagEnd + "</span>".length);
}

function chipLabel(tag: string): string {
  const m = tag.match(/>([^<]*)<\/span>$/);
  return m ? (m[1] as string) : "";
}

function chipPresetId(tag: string): string {
  const m = tag.match(/data-theme-preset-id="([^"]*)"/);
  return m ? (m[1] as string) : "";
}

// R2 P8-3 FIX ROUND F11 — the whole ELEMENT carrying `id`, sliced out of the
// REAL served bytes by counting <div> depth (renderThemePresetsPanel nests one
// child div, `.lg-preset-apply-row`, so naive indexOf("</div>") would cut the
// panel short). Used to move MAJOR-3's anchor from one string to the panel that
// string lives in — see the re-scope note on that describe block.
function elementHtml(html: string, id: string): string {
  const idIdx = html.indexOf(`id="${id}"`);
  expect(idIdx, `the served page must carry #${id}`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<div", idIdx);
  expect(start, `#${id} must open a <div>`).toBeGreaterThan(-1);
  let depth = 0;
  let i = start;
  for (;;) {
    const open = html.indexOf("<div", i);
    const close = html.indexOf("</div>", i);
    if (close === -1) throw new Error(`unbalanced <div> while slicing #${id}`);
    if (open !== -1 && open < close) {
      depth += 1;
      i = open + "<div".length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return html.slice(start, close + "</div>".length);
    i = close + "</div>".length;
  }
}

// The exact single-quoted JS string literal the SERVED island bytes carry,
// starting with `startsWith` (neither of the two zero-state strings contains an
// escaped quote — both spell their dash as a unicode escape). Real artifact,
// not a re-typed expectation: the assertion below reads the same bytes the
// browser parses.
function servedJsLiteral(html: string, startsWith: string): string {
  const idx = html.indexOf(`'${startsWith}`);
  expect(idx, `the served bytes must carry a JS string literal starting "${startsWith}"`).toBeGreaterThan(-1);
  const end = html.indexOf("'", idx + 1);
  expect(end, `the literal starting "${startsWith}" must terminate`).toBeGreaterThan(-1);
  return html.slice(idx + 1, end);
}

// An instruction that points at a place ON THIS PAGE. The MAJOR-3 defect was
// exactly one of these ("create one below") pointing at an affordance that does
// not exist. "here" is deliberately NOT in this set: PRESET_ZERO_HELP's "then
// it can be applied here" is true — applying IS what this panel does.
const IN_PAGE_LOCATOR = /\b(below|above|beside|on this page|in this panel|to the right|to the left)\b/i;

describeDb("F5 MAJOR-3 + MINOR-5 (review-p8-3) — real rendered admin markup, real theme record, real endpoints", () => {
  let env: Env;
  let quotePublicId = "";
  let funnelPublicId = "";
  let theme: ThemeRecord;

  beforeAll(async () => {
    const sdb = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
    env = buildEnv(d1FromSqlite(sdb), makeKvStub());

    const cq = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "F5 Board Honesty Quote", activity: "quote_funnel", verticals: ["car"] }), env);
    expect(cq.status, `create quote: ${await cq.clone().text()}`).toBe(201);
    const quote = (await cq.json()) as QuoteDetail;
    quotePublicId = quote.public_id;
    funnelPublicId = quote.funnels[0]!.public_id;

    // Real theme record through the REAL POST /themes endpoint (mints a
    // real "thm_..." id from the real name — never a hand-built id/record).
    const ct = await admin.request(`${API}/themes`, jsonInit("POST", THEME_BODY), env);
    expect(ct.status, `create theme: ${await ct.clone().text()}`).toBe(201);
    theme = ((await ct.json()) as { item: ThemeRecord }).item;
    expect(theme.name, "sanity: the created record's name is what MINOR-5 must surface").toBe("P8 Repro");

    // Real assignment through the REAL PUT /funnels/:id/theme endpoint.
    const assign = await admin.request(`${API}/funnels/${funnelPublicId}/theme`, jsonInit("PUT", { theme_json: { theme_id: theme.id } }), env);
    expect(assign.status, `assign theme: ${await assign.clone().text()}`).toBe(200);
  });

  describe("MINOR-5 — the board's Theme chip never prints the raw KV id", () => {
    it("before assignment (theme_json null): the chip reads the honest 'Default' word with no preset-id attribute (regression guard on the untouched branch)", async () => {
      // Independent quote so the null-theme_json branch is exercised on its
      // own funnel, isolated from the assigned-theme funnel above.
      const sdb2 = createLeadgenDb(DatabaseSync as DatabaseSyncCtor);
      const env2 = buildEnv(d1FromSqlite(sdb2), makeKvStub());
      const cq2 = await admin.request(`${API}/quotes`, jsonInit("POST", { quote_name: "F5 Default Chip Quote", activity: "quote_funnel", verticals: ["car"] }), env2);
      const quote2 = (await cq2.json()) as QuoteDetail;
      const html2 = await (await admin.request(`/admin/leadgen/quotes/${quote2.public_id}/edit`, {}, env2)).text();
      const tag = themeChipTag(html2, quote2.funnels[0]!.public_id);
      expect(chipLabel(tag)).toBe("Default");
      expect(chipPresetId(tag)).toBe("");
    });

    it("assigned to a REAL named preset: the SSR chip is a neutral, honest label — never the raw id (N1) — and carries the real id as data for the island's existing catalog fetch to resolve", async () => {
      const html = await (await admin.request(`/admin/leadgen/quotes/${quotePublicId}/edit`, {}, env)).text();
      const tag = themeChipTag(html, funnelPublicId);
      const label = chipLabel(tag);
      expect(label, "the chip must never render the raw KV id").not.toBe(theme.id);
      expect(label, "the chip must never render the operator's theme NAME at SSR time either (that resolution is client-side — asserting it here would assert something SSR does not do)").not.toBe(theme.name);
      expect(label, "SSR fallback is the neutral word themeChipLabel now returns for a preset pointer").toBe("Theme");
      expect(chipPresetId(tag), "the raw id must still be present as DATA (never as the visible label) so the existing boot-time fetch can resolve it").toBe(theme.id);
    });

    it("the SAME catalog endpoint the island's existing fetch calls (GET /api/admin/leadgen/themes) returns this record's real name for this exact id — proving the wiring the client rename depends on is real end-to-end", async () => {
      const listRes = await admin.request(`${API}/themes`, {}, env);
      expect(listRes.status).toBe(200);
      const items = ((await listRes.json()) as { items: ThemeRecord[] }).items;
      const match = items.find((t) => t.id === theme.id);
      expect(match, "the assigned theme id must resolve through the real catalog list").toBeDefined();
      expect(match!.name).toBe("P8 Repro");
    });
  });

  // ---------------------------------------------------------------------------
  // MAJOR-3, RE-SCOPED IN R2 P8-3 FIX ROUND F11 — from the PLACEHOLDER to the
  // PANEL. Two acceptance criteria of this phase contradicted each other and no
  // string could satisfy both; the criterion that stands is review #1's
  // invariant AS WRITTEN: "in the zero-preset state, the panel gives the
  // operator ONE consistent instruction that names a place that exists; the
  // select's empty-state text and the help line must not disagree." It was
  // never "the placeholder must itself name the destination".
  //
  // BEFORE (F5's line, deleted):
  //     const snippet = html.slice(idx, idx + 100);
  //     expect(snippet, "must name the SAME real place the help line points to")
  //       .toMatch(/Themes manager/);
  //   — asserted over the 100 bytes following the select's zero-state
  //   placeholder, i.e. it demanded the PLACEHOLDER ITSELF carry the words
  //   "Themes manager".
  //
  // WHY THE PLACEHOLDER IS NO LONGER THE RIGHT ANCHOR — MEASURED, so the next
  // round does not re-lengthen the string: the text that assertion forced
  // ("No presets yet — create one from the Themes manager") is 347.05px inside
  // #lg-theme-preset-select's 288.00px content box (228.00px at the rail's own
  // declared min-width) — +59.05px, driven at 1280 by review #2 as scrollWidth
  // 363 > clientWidth 312, text-overflow clip, no title, so the operator read
  // "…create one from the Theme⌄": the destination the fix existed to add was
  // the exact part that got clipped, and review #2 filed it as a BLOCKER. F10
  // shortened the placeholder to "No presets yet" (100.50px by the clip
  // suite's conservative model, −197.74px inside the box). NO string satisfies
  // both criteria: naming the destination costs more pixels than this select
  // has. The destination did not disappear — it lives on the wrapping <p> help
  // line directly above the select and on the panel's own "Manage all presets"
  // link, both INSIDE the same panel. So the honest anchor is the panel.
  //
  // NOT WEAKENED. Everything the old line could catch still fails here, plus
  // one thing it never could:
  //   (a) the original defect — an instruction naming an in-page place that
  //       does not exist ("create one below") — fails the IN_PAGE_LOCATOR guard,
  //       now applied to BOTH zero-state strings instead of only the one;
  //   (b) the panel dropping its destination entirely — fails the requirement
  //       that the two strings TOGETHER still name it;
  //   (c) NEW: the named place must really EXIST. The panel's own link is
  //       followed through the REAL admin router and the destination must
  //       answer 200 and carry the create affordance the instruction promises.
  //       A regex on a word never proved that.
  // ---------------------------------------------------------------------------
  describe("MAJOR-3 — the zero-preset panel never tells the operator two different stories", () => {
    it("the select's own zero-preset placeholder string is present in the real served editor page and no longer claims a place that doesn't exist ('below')", async () => {
      const html = await (await admin.request(`/admin/leadgen/quotes/${quotePublicId}/edit`, {}, env)).text();
      const anchor = "No presets yet";
      const idx = html.indexOf(anchor);
      expect(idx, "the select's zero-preset placeholder string must be present in the served page").toBeGreaterThan(-1);
      const snippet = html.slice(idx, idx + 100);
      expect(snippet, "must not claim there is a create-affordance BELOW this select — there is none").not.toMatch(IN_PAGE_LOCATOR);
    });

    it("the PANEL (not the placeholder) carries one consistent instruction: both zero-state strings agree, they name a destination, and that destination really exists", async () => {
      const html = await (await admin.request(`/admin/leadgen/quotes/${quotePublicId}/edit`, {}, env)).text();

      // (1) The REAL panel element, depth-sliced out of the REAL served bytes.
      const panel = elementHtml(html, "lg-theme-presets");

      // (2) Both zero-state strings really land in THIS panel: the select and
      // the help line are its own children, and the islands address them by
      // exactly those ids (quotes-tabs/themes.ts refreshPresetAvailability,
      // quotes-tabs/funnel.ts loadThemePresetOptions).
      expect(panel, "the preset select must live inside this panel").toContain('id="lg-theme-preset-select"');
      expect(panel, "the zero-state help line must live inside this panel").toContain('id="lg-theme-preset-help"');
      expect(html, "the island must write the zero-state help into that element").toContain("byId('lg-theme-preset-help')");
      expect(html, "the island must fill that select").toContain("byId('lg-theme-preset-select')");

      // (3) The two zero-state strings, verbatim out of the served island bytes.
      const placeholder = servedJsLiteral(html, "No presets yet");
      const zeroHelp = servedJsLiteral(html, "No presets saved yet");

      // (4) They must not DISAGREE: neither may point at an in-page place …
      expect(placeholder, "the select's empty-state text must not point at an in-page place").not.toMatch(IN_PAGE_LOCATOR);
      expect(zeroHelp, "the help line must not point at an in-page place").not.toMatch(IN_PAGE_LOCATOR);
      // … and between them the panel must still NAME its destination.
      expect(
        `${placeholder} ${zeroHelp}`,
        "with zero presets the panel must name the place a preset comes from — if neither string names it, the operator is told to do something with no 'where'",
      ).toMatch(/Themes manager/);

      // (5) That place EXISTS: follow the panel's OWN link through the REAL
      // admin router (never a hand-typed URL) and require the destination to
      // answer and to carry the create affordance the instruction promises.
      const linkTag = panel.match(/<a[^>]*id="lg-theme-manage-link"[^>]*>/);
      expect(linkTag, "the panel must carry its own link to the destination it names").not.toBeNull();
      const href = ((linkTag as RegExpMatchArray)[0].match(/href="([^"]+)"/) ?? [])[1] ?? "";
      expect(href, "that link must have an href").not.toBe("");
      const dest = await admin.request(href, {}, env);
      expect(dest.status, `the panel's destination ${href} must be a real page, not a 404`).toBe(200);
      const destHtml = await dest.text();
      expect(destHtml, "the destination must call itself by the name the instruction uses").toMatch(/<span[^>]*>Themes<\/span>/);
      expect(
        destHtml,
        "the destination must actually offer the create affordance the zero-state instruction promises (contract §4 R3 corollary, applied to the instruction rather than to a control)",
      ).toContain('id="tm-new-theme"');
    });

    it("the N11 panel's help-line zero-state string (co-rendered on the SAME page) also names the Themes manager — cross-checked from the real bytes, not two hardcoded expectations", async () => {
      const html = await (await admin.request(`/admin/leadgen/quotes/${quotePublicId}/edit`, {}, env)).text();
      const anchor = "No presets saved yet";
      const idx = html.indexOf(anchor);
      expect(idx, "the help line's zero-state string (quotes-tabs/themes.ts PRESET_ZERO_HELP) must be present in the served page").toBeGreaterThan(-1);
      const snippet = html.slice(idx, idx + 140);
      expect(snippet).toMatch(/Themes manager/);
    });
  });
});

// ---------------------------------------------------------------------------
// R2 P8-3 FIX ROUND F11 — an unguarded object index on the quote-editor render
// path. `funnelDesignLabel` (quotes-handlers.ts) read
// `FUNNEL_DESIGN_LABELS[id]` off a plain object literal, which inherits
// Object.prototype: for an inherited key the lookup returns a FUNCTION rather
// than undefined, the `!== undefined` branch is taken, and a function object is
// handed back through a `string` return type — straight onto the operator's
// editor (listFunnelDesignOptions runs on every GET /quotes/:id/edit) as
// "function Object() { [native code] }". That is the raw-engineering-identifier
// class N1 exists to remove, arriving through a different door. Fixed with an
// own-property guard; the F5 MINOR-7 rule that this function must NOT throw on
// the render path is preserved (an unknown id still degrades to "Design"), and
// the completeness guarantee stays where MINOR-7 put it, in
// assertFunnelDesignLabelsComplete.
//
// This is a pure-function leg (no D1, no router), so it runs outside describeDb.
// FAIL-BEFORE / PASS-AFTER is in this slice's report.
// ---------------------------------------------------------------------------
describe("F11 — the design-label lookup is own-property guarded", () => {
  it("an inherited Object.prototype key returns the neutral word, never a function", () => {
    for (const inherited of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      const label = funnelDesignLabel(inherited);
      expect(typeof label, `funnelDesignLabel("${inherited}") must return a string, not a ${typeof label}`).toBe("string");
      expect(label, `funnelDesignLabel("${inherited}") must degrade to the neutral design word`).toBe("Design");
    }
  });

  it("every REAL distinct design id the registry resolves to still gets its own label (the guard changed nothing that matters)", () => {
    const options = listFunnelDesignOptions();
    expect(options.length, "the real registry must resolve at least one distinct design").toBeGreaterThan(0);
    for (const opt of options) {
      expect(opt.label, `design "${opt.id}" must keep a real label`).toBe(FUNNEL_DESIGN_LABELS[opt.id]);
      expect(opt.label, `design "${opt.id}" must never render its raw registry id (N1)`).not.toBe(opt.id);
    }
    // …and the developer-facing completeness guarantee is still armed.
    expect(() => assertFunnelDesignLabelsComplete()).not.toThrow();
    expect(() => assertFunnelDesignLabelsComplete(["a-design-nobody-labelled"])).toThrow(/FUNNEL_DESIGN_LABELS is missing an entry/);
  });
});
