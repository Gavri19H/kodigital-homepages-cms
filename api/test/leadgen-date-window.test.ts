// Backlog F21 — the LeadGen list date control (src/admin/leadgen/date-window.ts)
// on Offers · Sections · Quotes · Auction.
//
// 1. resolveDateWindow: the new presets (yesterday, 3d), From / To dates,
//    old ?range links, bad input → "Last 30 days", the date-button label.
//    The four old presets resolve to exactly the window the old Listicles
//    resolveTimeframe gave, so the analytics columns ask for the same days
//    (and so show the same numbers) as before.
// 2. The arrows (shiftDateWindow): move by the window's own length, forward
//    stops at today.
// 3. The served pages (REAL admin router over the node:sqlite D1 harness,
//    repo pattern): the control replaces the old select, the table asks the
//    analytics routes for the chosen days, paging keeps search + dates on
//    Sections, the LeadGen tab links carry the dates, Auction's GET form
//    carries them as hidden inputs.
// 4. The panel script (strict ES5) executed in a node:vm with a minimal fake
//    DOM (jsdom is not installed — no-new-deps): open / close, Apply builds
//    ?from&to (dropping page and range, keeping the rest), bad dates show an
//    error and never navigate.

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { resolveTimeframe } from "../src/admin/listicles/ui-shared";
import {
  resolveDateWindow,
  shiftDateWindow,
  dateWindowParams,
  dateWindowSuffix,
  formatDateSpan,
  LG_DATE_WINDOW_SCRIPT,
} from "../src/admin/leadgen/date-window";

const NOW = new Date("2026-11-09T12:00:00.000Z"); // a Monday, mid-day UTC

// ---------------------------------------------------------------------------
// 1. resolveDateWindow
// ---------------------------------------------------------------------------

describe("F21 resolveDateWindow — presets, dates, fallbacks", () => {
  it("no params → Last 30 days (today + 29 back), the old default", () => {
    const w = resolveDateWindow({}, NOW);
    expect(w).toMatchObject({ key: "30d", from: "2026-10-11", to: "2026-11-09", today: "2026-11-09", custom: false });
    expect(w.label).toBe("Last 30 days · 11 Oct – 9 Nov 2026");
    expect(dateWindowParams(w)).toEqual({});
    expect(dateWindowSuffix(w)).toBe("");
  });

  it("?range=yesterday → the one UTC day before today", () => {
    const w = resolveDateWindow({ range: "yesterday" }, NOW);
    expect(w).toMatchObject({ key: "yesterday", from: "2026-11-08", to: "2026-11-08", custom: false });
    expect(w.label).toBe("Yesterday · 8 Nov 2026");
    expect(dateWindowParams(w)).toEqual({ range: "yesterday" });
  });

  it("?range=3d → today + the 2 days before (the Last 7 days rule)", () => {
    const w = resolveDateWindow({ range: "3d" }, NOW);
    expect(w).toMatchObject({ key: "3d", from: "2026-11-07", to: "2026-11-09" });
    expect(w.label).toBe("Last 3 days · 7 Nov – 9 Nov 2026");
    expect(dateWindowSuffix(w)).toBe("?range=3d");
  });

  it("old ?range links (today / 7d / 30d / 90d) give exactly the old window, so the numbers can't move", () => {
    for (const key of ["today", "7d", "30d", "90d"]) {
      const old = resolveTimeframe(key);
      const w = resolveDateWindow({ range: key });
      expect({ key: w.key, from: w.from, to: w.to }, key).toEqual({ key: old.key, from: old.from, to: old.to });
    }
    expect(resolveDateWindow({ range: "today" }, NOW).label).toBe("Today · 9 Nov 2026");
    expect(resolveDateWindow({ range: "7d" }, NOW)).toMatchObject({ from: "2026-11-03", to: "2026-11-09", label: "Last 7 days · 3 Nov – 9 Nov 2026" });
    expect(resolveDateWindow({ range: "90d" }, NOW)).toMatchObject({ from: "2026-08-12", to: "2026-11-09" });
  });

  it("?from&to → a custom window labelled with its dates; the address keeps from / to", () => {
    const w = resolveDateWindow({ from: "2026-10-30", to: "2026-11-01" }, NOW);
    expect(w).toMatchObject({ key: "custom", from: "2026-10-30", to: "2026-11-01", custom: true });
    expect(w.label).toBe("30 Oct – 1 Nov 2026");
    expect(dateWindowParams(w)).toEqual({ from: "2026-10-30", to: "2026-11-01" });
    expect(dateWindowSuffix(w)).toBe("?from=2026-10-30&to=2026-11-01");
    expect(resolveDateWindow({ from: "2026-10-30", to: "2026-10-30" }, NOW).label).toBe("30 Oct 2026");
    // From / To win over a range sent alongside them
    expect(resolveDateWindow({ range: "7d", from: "2026-10-30", to: "2026-11-01" }, NOW).key).toBe("custom");
  });

  it("dates that are exactly a preset's window show that preset's name", () => {
    expect(resolveDateWindow({ from: "2026-11-07", to: "2026-11-09" }, NOW)).toMatchObject({ key: "3d", custom: true, label: "Last 3 days · 7 Nov – 9 Nov 2026" });
    expect(resolveDateWindow({ from: "2026-11-08", to: "2026-11-08" }, NOW)).toMatchObject({ key: "yesterday", label: "Yesterday · 8 Nov 2026" });
  });

  it("bad input falls back to Last 30 days", () => {
    const bad: Array<Record<string, string>> = [
      { range: "constructor" },
      { range: "__proto__" },
      { range: "14d" },
      { from: "2026-11-02", to: "2026-11-01" }, // from after to
      { from: "2026-11-01", to: "2026-11-10" }, // to after today
      { from: "2026-02-30", to: "2026-03-01" }, // not a real day
      { from: "2026-13-01", to: "2026-13-02" },
      { from: "2026-11-01" }, // only one side
      { to: "2026-11-01" },
      { from: "1/11/2026", to: "2/11/2026" },
      { from: "2026-11-01T00:00", to: "2026-11-02" },
    ];
    for (const q of bad) {
      expect(resolveDateWindow(q, NOW), JSON.stringify(q)).toMatchObject({ key: "30d", from: "2026-10-11", to: "2026-11-09", custom: false });
    }
    // a bad From / To with a good range keeps the range
    expect(resolveDateWindow({ range: "7d", from: "2026-11-05", to: "2026-11-04" }, NOW).key).toBe("7d");
  });

  it("a From / To window longer than 366 days falls back (each row would sum years of data)", () => {
    expect(resolveDateWindow({ from: "2025-11-09", to: "2026-11-09" }, NOW)).toMatchObject({ key: "custom", custom: true }); // 366 days
    expect(resolveDateWindow({ from: "2025-11-08", to: "2026-11-09" }, NOW)).toMatchObject({ key: "30d", custom: false }); // 367
    expect(resolveDateWindow({ from: "1900-01-01", to: "2026-11-09" }, NOW).key).toBe("30d");
  });

  it("labels across years and months", () => {
    expect(formatDateSpan("2025-12-30", "2026-01-02")).toBe("30 Dec 2025 – 2 Jan 2026");
    expect(formatDateSpan("2026-10-30", "2026-11-01")).toBe("30 Oct – 1 Nov 2026");
  });
});

// ---------------------------------------------------------------------------
// 2. Arrows
// ---------------------------------------------------------------------------

describe("F21 shiftDateWindow — the ‹ › arrows", () => {
  it("move a custom window by its own length", () => {
    const w = resolveDateWindow({ from: "2026-10-30", to: "2026-11-01" }, NOW);
    expect(shiftDateWindow(w, -1)).toEqual({ from: "2026-10-27", to: "2026-10-29" });
    expect(shiftDateWindow(w, 1)).toEqual({ from: "2026-11-02", to: "2026-11-04" });
  });

  it("a single day moves one day; Yesterday → › → Today", () => {
    const y = resolveDateWindow({ range: "yesterday" }, NOW);
    expect(shiftDateWindow(y, -1)).toEqual({ from: "2026-11-07", to: "2026-11-07" });
    const next = shiftDateWindow(y, 1);
    expect(next).toEqual({ from: "2026-11-09", to: "2026-11-09" });
    expect(resolveDateWindow(next!, NOW).label).toBe("Today · 9 Nov 2026");
  });

  it("Last 3 days moves 3 days back; › is off when the window ends today", () => {
    const w = resolveDateWindow({ range: "3d" }, NOW);
    expect(shiftDateWindow(w, -1)).toEqual({ from: "2026-11-04", to: "2026-11-06" });
    expect(shiftDateWindow(w, 1)).toBeNull();
  });

  it("› never runs past today: a window that would end after today ends today instead", () => {
    const w = resolveDateWindow({ from: "2026-11-05", to: "2026-11-07" }, NOW);
    expect(shiftDateWindow(w, 1)).toEqual({ from: "2026-11-07", to: "2026-11-09" });
  });
});

// ---------------------------------------------------------------------------
// 3. Served pages (node:sqlite harness, repo pattern)
// ---------------------------------------------------------------------------

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
      if (typeof getBuiltin === "function") {
        return (getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
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
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return (sdb.prepare(sql).get(...binds) ?? null) as T | null;
        },
        async all<T = unknown>() {
          return { results: sdb.prepare(sql).all(...binds) as T[], success: true, meta: {} };
        },
        async run() {
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
          return { success: true, meta: { changes: Number(r?.changes ?? 0), last_row_id: Number(r?.lastInsertRowid ?? 0) } };
        },
      };
      return stmt;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      runSql(sdb, "BEGIN");
      const out: unknown[] = [];
      try {
        for (const s of statements) out.push(await s.run());
        runSql(sdb, "COMMIT");
      } catch (err) {
        runSql(sdb, "ROLLBACK");
        throw err;
      }
      return out;
    },
  } as unknown as D1Database;
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
  "0046_leadgen_rework_m1_variants.sql",
  "0047_leadgen_rework_m2_shared_pages.sql",
  "0048_leadgen_rework_m3_routing.sql",
  "0049_leadgen_rework_m4_m5_defaults_templates.sql",
  "0050_leadgen_rework_m6_grid_expansion.sql",
  "0051_leadgen_rework_m7_slider_collapse.sql",
  "0052_leadgen_rework_m9_address_fields.sql",
  "0053_leadgen_rework_m12_othergroup_retirement.sql",
  "0057_leadgen_offer_test_verdict.sql", // the Offers list reads last_test_status
  "0060_leadgen_offer_static_creative.sql",
  "0061_leadgen_routing_present_only_offer.sql",
  "0062_leadgen_auction_waterfalls.sql",
  "0063_leadgen_auction_tier_rules.sql",
] as const;

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newEnv(): Env {
  const sdb = new (DatabaseSync as DatabaseSyncCtor)(":memory:");
  runSql(sdb, "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);");
  for (const file of LEADGEN_MIGRATIONS) runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
  return {
    DB: d1FromSqlite(sdb),
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  };
}

async function getHtml(env: Env, path: string): Promise<string> {
  const res = await admin.request(path, {}, env);
  expect(res.status, `${path} status`).toBe(200);
  const html = await res.text();
  return html.includes("data-lg-dw-today") ? rememberToday(html) : html;
}

async function createSection(env: Env, name: string): Promise<void> {
  const res = await admin.request(
    "/api/admin/leadgen/sections",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        section_name: name,
        activity: "quote_funnel",
        vertical: "home",
        headline_text: name,
        content_json: JSON.stringify({
          components: [{ type: "TwoButtonYesNo", question_id: "q1", question_key: "own_q", internal_field: "owns_home", answer_type: "boolean" }],
        }),
      }),
    },
    env,
  );
  expect(res.status, `create section: ${await res.clone().text()}`).toBe(201);
}

// The table's analytics window, as the hydration script reads it.
function analyticsWindow(html: string): { from: string; to: string } {
  const m = /data-analytics-from="([^"]*)"\s+data-analytics-to="([^"]*)"/.exec(html);
  expect(m, "table carries data-analytics-from / -to").not.toBeNull();
  return { from: m![1] as string, to: m![2] as string };
}

// "Today" as the page itself resolved it (data-lg-dw-today), so a run that
// crosses UTC midnight between the request and the assertion can't fail.
let pageToday = "";
function rememberToday(html: string): string {
  const m = /data-lg-dw-today="(\d{4}-\d{2}-\d{2})"/.exec(html);
  expect(m, "control carries data-lg-dw-today").not.toBeNull();
  pageToday = m![1] as string;
  return html;
}

function today(): string {
  return pageToday;
}

function daysBefore(n: number): string {
  return new Date(Date.parse(`${pageToday}T00:00:00Z`) - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const LIST_PAGES = [
  ["offers", "/admin/leadgen/offers"],
  ["sections", "/admin/leadgen/sections"],
  ["quotes", "/admin/leadgen/quotes"],
  ["auction", "/admin/leadgen/auction"],
] as const;

describeDb("F21 — the four LeadGen list pages", () => {
  it("each shows ‹ [dates] › instead of the old range select, with the 6 presets in order", async () => {
    const env = newEnv();
    for (const [label, path] of LIST_PAGES) {
      const html = await getHtml(env, path);
      expect(html, label).not.toContain('<select name="range"');
      expect(html, label).toContain('<div class="lg-dw" data-lg-dw');
      expect(html, label).toContain('aria-label="Previous period"');
      expect(html, label).toContain('aria-label="Next period" disabled'); // the default window ends today
      expect(html, label).toContain('aria-haspopup="dialog"');
      const presets = [...html.matchAll(/data-lg-dw-preset="([^"]+)"/g)].map((m) => m[1]);
      expect(presets, label).toEqual(["today", "yesterday", "3d", "7d", "30d", "90d"]);
      expect(html, label).toContain("Dates are in UTC.");
      expect(analyticsWindow(html), label).toEqual({ from: daysBefore(29), to: today() });
    }
  });

  it("?range=yesterday, ?range=3d and ?from&to drive the table's analytics window and the label", async () => {
    const env = newEnv();
    for (const [label, path] of LIST_PAGES) {
      const y = await getHtml(env, `${path}?range=yesterday`);
      expect(analyticsWindow(y), label).toEqual({ from: daysBefore(1), to: daysBefore(1) });
      expect(y, label).toMatch(/<span class="lg-dw-label">Yesterday · [^<]+<\/span>/);
      expect(y, label).toContain('data-lg-dw-preset="yesterday" aria-current="true"');

      const three = await getHtml(env, `${path}?range=3d`);
      expect(analyticsWindow(three), label).toEqual({ from: daysBefore(2), to: today() });

      const custom = await getHtml(env, `${path}?from=2026-10-30&to=2026-11-01`);
      expect(analyticsWindow(custom), label).toEqual({ from: "2026-10-30", to: "2026-11-01" });
      expect(custom, label).toContain('<span class="lg-dw-label">30 Oct – 1 Nov 2026</span>');
      // ‹ / › step by 3 days; neither keeps page
      expect(custom, label).toContain('href="?from=2026-10-27&amp;to=2026-10-29" aria-label="Previous period"');
      expect(custom, label).toContain('href="?from=2026-11-02&amp;to=2026-11-04" aria-label="Next period"');
      expect(custom, label).not.toContain('data-lg-dw-preset="3d" aria-current="true"');
      expect(custom, label).not.toMatch(/data-lg-dw-preset="[^"]+" aria-current="true"/);
      // From / To that are exactly "Last 3 days" light up that preset too
      const shaped = await getHtml(env, `${path}?from=${daysBefore(2)}&to=${today()}`);
      expect(shaped, label).toContain('data-lg-dw-preset="3d" aria-current="true"');

      const old = await getHtml(env, `${path}?range=7d`);
      expect(analyticsWindow(old), label).toEqual({ from: daysBefore(6), to: today() });
      expect(old, label).toMatch(/<span class="lg-dw-label">Last 7 days · [^<]+<\/span>/);
    }
  });

  it("preset and arrow links keep search and filters, and drop page", async () => {
    const env = newEnv();
    const html = await getHtml(env, "/admin/leadgen/sections?search=Home&status=active&page=2&range=3d");
    expect(html).toContain('href="?search=Home&amp;status=active&amp;range=yesterday" data-lg-dw-preset="yesterday"');
    const prev = /href="([^"]*)" aria-label="Previous period"/.exec(html)?.[1] ?? "";
    expect(prev).toBe(`?search=Home&amp;status=active&amp;from=${daysBefore(5)}&amp;to=${daysBefore(3)}`);
  });

  it("Sections: Next keeps the search and the dates (page 1 → 2)", async () => {
    const env = newEnv();
    for (let i = 1; i <= 26; i++) await createSection(env, `Home question ${i}`);
    const preset = await getHtml(env, "/admin/leadgen/sections?search=Home&range=3d");
    expect(preset).toContain('<a href="?search=Home&range=3d&page=2" rel="next">Next</a>');
    const custom = await getHtml(env, "/admin/leadgen/sections?search=Home&from=2026-10-30&to=2026-11-01");
    expect(custom).toContain('<a href="?search=Home&from=2026-10-30&to=2026-11-01&page=2" rel="next">Next</a>');
    const page2 = await getHtml(env, "/admin/leadgen/sections?search=Home&from=2026-10-30&to=2026-11-01&page=2");
    expect(analyticsWindow(page2)).toEqual({ from: "2026-10-30", to: "2026-11-01" });
    expect(page2).toContain('<a href="?search=Home&from=2026-10-30&to=2026-11-01&page=1" rel="prev">Previous</a>');
  });

  it("the LeadGen tab links carry the chosen dates (none for the default window)", async () => {
    const env = newEnv();
    const plain = await getHtml(env, "/admin/leadgen/quotes");
    expect(plain).toContain('<a href="/admin/leadgen/offers" class="leadgen-tab">Offers</a>');
    const custom = await getHtml(env, "/admin/leadgen/quotes?from=2026-10-30&to=2026-11-01");
    for (const tab of ["offers", "sections", "auction"]) {
      expect(custom).toContain(`<a href="/admin/leadgen/${tab}?from=2026-10-30&amp;to=2026-11-01" class="leadgen-tab">`);
    }
    expect(custom).toContain('<a href="/admin/leadgen/quotes?from=2026-10-30&amp;to=2026-11-01" class="leadgen-tab active" aria-current="page">Quotes</a>');
    const preset = await getHtml(env, "/admin/leadgen/offers?range=yesterday");
    expect(preset).toContain('<a href="/admin/leadgen/auction?range=yesterday" class="leadgen-tab">Auction</a>');
  });

  it("Auction: the search form carries the dates as hidden inputs (Enter in search keeps them)", async () => {
    const env = newEnv();
    const custom = await getHtml(env, "/admin/leadgen/auction?from=2026-10-30&to=2026-11-01");
    const form = /<form class="toolbar-filters"[\s\S]*?<\/form>/.exec(custom)?.[0] ?? "";
    expect(form).toContain('<input type="hidden" name="from" value="2026-10-30" /><input type="hidden" name="to" value="2026-11-01" />');
    expect(form).not.toContain("data-lg-dw"); // the panel's own date inputs are outside the form
    const preset = await getHtml(env, "/admin/leadgen/auction?range=3d");
    expect(/<form class="toolbar-filters"[\s\S]*?<\/form>/.exec(preset)?.[0]).toContain('<input type="hidden" name="range" value="3d" />');
    const plain = await getHtml(env, "/admin/leadgen/auction");
    expect(/<form class="toolbar-filters"[\s\S]*?<\/form>/.exec(plain)?.[0]).not.toContain('type="hidden"');
  });
});

// ---------------------------------------------------------------------------
// 4. The panel script — ES5 + behavior
// ---------------------------------------------------------------------------

describe("F21 panel script", () => {
  it("is strict ES5 and parses on its own (node --check)", () => {
    const s = LG_DATE_WINDOW_SCRIPT;
    expect(s).not.toMatch(/=>/);
    expect(s).not.toMatch(/\bconst\b/);
    expect(s).not.toMatch(/\blet\b/);
    expect(s).not.toMatch(/\basync\b|\bawait\b/);
    expect(s).not.toContain("`");
    const file = join(mkdtempSync(join(tmpdir(), "lg-dw-")), "script.js");
    writeFileSync(file, s, "utf-8");
    expect(() => execFileSync(process.execPath, ["--check", file], { stdio: "pipe" })).not.toThrow();
  });

  // A minimal DOM: just what the script touches.
  type Listener = (e: Record<string, unknown>) => void;
  class FakeEl {
    attrs: Record<string, string> = {};
    hidden = false;
    value = "";
    textContent = "";
    focused = false;
    listeners: Record<string, Listener[]> = {};
    classes = new Set<string>();
    rect = { right: 400 };
    children: FakeEl[] = [];
    classList = {
      add: (c: string) => this.classes.add(c),
      remove: (c: string) => this.classes.delete(c),
    };
    getAttribute(n: string): string | null {
      return n in this.attrs ? (this.attrs[n] as string) : null;
    }
    setAttribute(n: string, v: string): void {
      this.attrs[n] = v;
    }
    addEventListener(t: string, fn: Listener): void {
      (this.listeners[t] ??= []).push(fn);
    }
    fire(t: string, e: Record<string, unknown> = {}): void {
      for (const fn of this.listeners[t] ?? []) fn({ target: this, preventDefault: () => undefined, ...e });
    }
    focus(): void {
      this.focused = true;
    }
    getBoundingClientRect(): { right: number } {
      return this.rect;
    }
    contains(el: unknown): boolean {
      return el === this || this.children.includes(el as FakeEl);
    }
  }

  function boot(href: string, from: string, to: string, pageToday = "2026-11-09") {
    const root = new FakeEl();
    root.attrs["data-lg-dw-today"] = pageToday;
    root.attrs["data-lg-dw-max-days"] = "366";
    const parts: Record<string, FakeEl> = {};
    for (const name of ["toggle", "panel", "from", "to", "error", "apply", "cancel"]) {
      parts[name] = new FakeEl();
      root.children.push(parts[name] as FakeEl);
    }
    const p = parts as Record<"toggle" | "panel" | "from" | "to" | "error" | "apply" | "cancel", FakeEl>;
    p.panel.hidden = true;
    p.error.hidden = true;
    (p.panel as unknown as { querySelector: (s: string) => FakeEl | null }).querySelector = () => null;
    p.from.value = from;
    p.to.value = to;
    const docListeners = new FakeEl();
    const outside = new FakeEl();
    const location = { href };
    const document = {
      querySelector: (sel: string) => (sel === "[data-lg-dw]" ? root : null),
      addEventListener: (t: string, fn: Listener) => docListeners.addEventListener(t, fn),
      documentElement: { clientWidth: 1280 },
    };
    (root as unknown as { querySelector: (s: string) => FakeEl | null }).querySelector = (sel: string) => {
      const map: Record<string, FakeEl> = {
        "[data-lg-dw-toggle]": p.toggle,
        "[data-lg-dw-panel]": p.panel,
        "[data-lg-dw-from]": p.from,
        "[data-lg-dw-to]": p.to,
        "[data-lg-dw-error]": p.error,
        "[data-lg-dw-apply]": p.apply,
        "[data-lg-dw-cancel]": p.cancel,
      };
      return map[sel] ?? null;
    };
    runInNewContext(LG_DATE_WINDOW_SCRIPT, { document, window: { location, innerWidth: 1280 }, URL });
    return { p, location, docListeners, outside };
  }

  it("opens and closes; focus moves into the panel; Cancel and Escape restore the dates and return focus", () => {
    const { p, docListeners } = boot("https://cms.test/admin/leadgen/offers", "2026-10-11", "2026-11-09");
    p.toggle.fire("click");
    expect(p.panel.hidden).toBe(false);
    expect(p.from.focused).toBe(true);
    expect(p.toggle.attrs["aria-expanded"]).toBe("true");
    p.from.value = "2026-10-01";
    p.cancel.fire("click");
    expect(p.panel.hidden).toBe(true);
    expect(p.from.value).toBe("2026-10-11");
    expect(p.toggle.focused).toBe(true);
    p.toggle.fire("click");
    docListeners.fire("keydown", { key: "Escape" });
    expect(p.panel.hidden).toBe(true);
    expect(p.toggle.attrs["aria-expanded"]).toBe("false");
  });

  it("a click outside closes the panel; a panel too far right flips to the right edge", () => {
    const { p, docListeners, outside } = boot("https://cms.test/admin/leadgen/offers", "2026-10-11", "2026-11-09");
    p.panel.rect = { right: 1300 };
    p.toggle.fire("click");
    expect(p.panel.classes.has("lg-dw-panel--right")).toBe(true);
    docListeners.fire("click", { target: p.from }); // inside: stays open
    expect(p.panel.hidden).toBe(false);
    docListeners.fire("click", { target: outside });
    expect(p.panel.hidden).toBe(true);
  });

  it("Apply writes from / to, drops page and range, keeps every other param", () => {
    const { p, location } = boot("https://cms.test/admin/leadgen/sections?search=Home&range=7d&page=3", "2026-11-03", "2026-11-09");
    p.toggle.fire("click");
    p.from.value = "2026-10-30";
    p.to.value = "2026-11-01";
    p.apply.fire("click");
    expect(location.href).toBe("https://cms.test/admin/leadgen/sections?search=Home&from=2026-10-30&to=2026-11-01");
  });

  it("a page left open past midnight UTC still accepts the new day", () => {
    // the page was rendered on 1 Oct 2026; the browser clock is later
    const { p, location } = boot("https://cms.test/admin/leadgen/offers", "2026-09-02", "2026-10-01", "2026-10-01");
    p.toggle.fire("click");
    const realToday = new Date().toISOString().slice(0, 10);
    expect(realToday > "2026-10-01").toBe(true);
    p.from.value = realToday;
    p.to.value = realToday;
    p.apply.fire("click");
    expect(p.error.hidden).toBe(true);
    expect(location.href).toBe(`https://cms.test/admin/leadgen/offers?from=${realToday}&to=${realToday}`);
    expect(p.to.attrs["max"]).toBe(realToday);
  });

  it("Enter in a date field applies too", () => {
    const { p, location } = boot("https://cms.test/admin/leadgen/quotes", "2026-10-11", "2026-11-09");
    p.from.value = "2026-11-01";
    p.to.value = "2026-11-02";
    p.to.fire("keydown", { key: "Enter" });
    expect(location.href).toBe("https://cms.test/admin/leadgen/quotes?from=2026-11-01&to=2026-11-02");
  });

  it("bad dates show an error and never navigate", () => {
    const start = "https://cms.test/admin/leadgen/offers";
    const cases: Array<[string, string, string]> = [
      ["", "2026-11-01", "Pick both a From and a To date."],
      ["2026-11-02", "2026-11-01", "From must be on or before To."],
      ["2026-11-01", "2999-01-01", "To must be today or earlier (UTC)."],
      ["2025-11-01", "2026-11-09", "Pick at most 366 days."],
    ];
    for (const [from, to, message] of cases) {
      const { p, location } = boot(start, "2026-10-11", "2026-11-09");
      p.toggle.fire("click");
      p.from.value = from;
      p.to.value = to;
      p.apply.fire("click");
      expect(location.href, message).toBe(start);
      expect(p.error.hidden, message).toBe(false);
      expect(p.error.textContent).toBe(message);
    }
  });
});
