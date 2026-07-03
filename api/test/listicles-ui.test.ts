// Listicles Phase 3 — admin UI shell (design contract §4 / §8 / §9 / §25).
//
// Covers, over the REAL admin router + REAL migrations (node:sqlite harness,
// repo pattern from listicles-offers-api.test.ts):
//   - nav entry present + order (Listicles right after Pages, §4)
//   - GET /admin/listicles → 302 /admin/listicles/offers (§4)
//   - the three sub-tab routes render 200 with the §8 anatomy
//     (tabs → toolbar → card/table → empty-state / pager hooks)
//   - offers page carries every §9 management column + analytics column,
//     every Create/Edit-modal field, and the 32 §9.4 macro chips
//   - sections/articles are list-only: disabled Create buttons with the
//     phase notes; articles gate on "Site is required" when no site exists
//   - data-backed render: a created offer's management row is server-rendered
//     and its analytics cells are hydration hooks (skeleton per cell).

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { CANONICAL_MACROS } from "../src/listicles/macros";
import { adminLayout } from "../src/admin/templates/layout";
import { resolveTimeframe } from "../src/admin/listicles/ui-shared";

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
          sdb.prepare(sql).run(...binds);
          return { success: true, meta: {} };
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

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function createListiclesDb(
  DatabaseSync: DatabaseSyncCtor,
  opts: { seedSite: boolean } = { seedSite: true },
): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, vertical_slug TEXT, activity TEXT, status TEXT, settings_version INTEGER, last_provisioned_at TEXT, created_at TEXT, updated_at TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0032_listicles_core.sql"), "utf8"));
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0033_listicles_analytics_mirror.sql"), "utf8"));
  if (opts.seedSite) {
    sdb.prepare("INSERT INTO sites (id, name) VALUES (?, ?)").run("st_test", "Test Site");
  }
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
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

function jsonInit(method: string, body?: unknown): RequestInit {
  if (body === undefined) return { method };
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

function newHarness(opts?: { seedSite: boolean }): { sdb: SqliteDb; env: Env } {
  const ctor = DatabaseSync as DatabaseSyncCtor;
  const sdb = createListiclesDb(ctor, opts ?? { seedSite: true });
  return { sdb, env: buildEnv(d1FromSqlite(sdb)) };
}

const VALID_OFFER = {
  offer_name: "Shell Render Offer",
  provider: "acmeco",
  activity: "lead",
  vertical: "finance",
  conversion_tracking_method: "s2s_postback",
  offer_url_template: "https://track.acmeco.example/c?cid={click_id}&geo={country}",
  payout_method: "offsite",
};

// --- §4: nav entry (pure template — no DB needed) ----------------------------

describe("nav: Listicles entry (§4)", () => {
  it("inserts Listicles right after Pages in the sidebar", () => {
    const html = adminLayout({
      title: "T",
      activePath: "/admin/listicles/offers",
      content: "<p>x</p>",
    });
    const nav = html.match(/<nav class="sidebar-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";
    const labels = Array.from(nav.matchAll(/<span>([^<]+)<\/span>/g)).map((m) => m[1]);
    const pagesIdx = labels.indexOf("Pages");
    expect(pagesIdx).toBeGreaterThan(-1);
    expect(labels[pagesIdx + 1]).toBe("Listicles");
    expect(nav).toContain('href="/admin/listicles"');
    // active state binds to the Listicles entry for a sub-tab path
    expect(html).toContain('href="/admin/listicles" class="nav-item active"');
    expect((html.match(/nav-item active/g) ?? []).length).toBe(1);
  });
});

describe("timeframe resolver (§8 analytics range)", () => {
  it("defaults to a 30-day window and clamps unknown keys", () => {
    const tf = resolveTimeframe(undefined);
    expect(tf.key).toBe("30d");
    expect(tf.from <= tf.to).toBe(true);
    expect(resolveTimeframe("bogus").key).toBe("30d");
  });
  it("today is a single-day window", () => {
    const tf = resolveTimeframe("today");
    expect(tf.from).toBe(tf.to);
  });
  it("prototype-chain keys are not timeframes (constructor/__proto__/toString)", () => {
    for (const hostile of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const tf = resolveTimeframe(hostile);
      expect(tf.key, `?range=${hostile} must fall back to the default`).toBe("30d");
      expect(tf.from <= tf.to).toBe(true);
    }
  });
});

// --- shell routes over the real admin router ---------------------------------

describeDb("listicles shell routes (§4/§8/§25)", () => {
  it("GET /admin/listicles 302-redirects to the offers tab", async () => {
    const { env } = newHarness();
    const res = await admin.request("/admin/listicles", { redirect: "manual" }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin/listicles/offers");
  });

  it("§24: the HTML shell responses carry Cache-Control: private, no-store", async () => {
    const { env } = newHarness();
    for (const path of [
      "/admin/listicles",
      "/admin/listicles/offers",
      "/admin/listicles/sections",
      "/admin/listicles/articles",
    ]) {
      const res = await admin.request(path, { redirect: "manual" }, env);
      expect(res.headers.get("Cache-Control"), `${path} Cache-Control`).toBe(
        "private, no-store",
      );
      expect(
        res.headers.get("X-Content-Type-Options"),
        `${path} nosniff`,
      ).toBe("nosniff");
    }
  });

  it("§8: a hostile ?range= (__proto__/constructor) renders 200 with the default range", async () => {
    const { env } = newHarness();
    for (const tab of ["offers", "sections", "articles"] as const) {
      for (const hostile of ["__proto__", "constructor"]) {
        const res = await admin.request(
          `/admin/listicles/${tab}?range=${hostile}`,
          {},
          env,
        );
        expect(res.status, `/admin/listicles/${tab}?range=${hostile}`).toBe(200);
        const html = await res.text();
        // the timeframe select falls back to the default 30-day window
        expect(html).toContain('<option value="30d" selected>');
      }
    }
  });

  it("the three sub-tab routes render 200 with tabs/toolbar/table anatomy", async () => {
    const { env } = newHarness();
    for (const tab of ["offers", "sections", "articles"] as const) {
      const res = await admin.request(`/admin/listicles/${tab}`, {}, env);
      expect(res.status, `/admin/listicles/${tab} must render 200`).toBe(200);
      const html = await res.text();
      // adminLayout shell + Listicles page title
      expect(html).toContain('data-marker="kodigital-admin-shell"');
      expect(html).toContain("Listicles");
      // §4 sub-tab bar with the active tab marked
      expect(html).toContain('class="listicles-tabs"');
      expect(html).toContain(`href="/admin/listicles/${tab}" class="listicles-tab active"`);
      // §8 anatomy: toolbar + card/table + timeframe select
      expect(html).toContain('class="toolbar"');
      expect(html).toContain('name="range"');
      // shared analytics hydration hooks
      expect(html).toContain("data-lst-analytics");
    }
  });

  it("offers page: empty-state + CTA when no offers exist (§8)", async () => {
    const { env } = newHarness();
    const res = await admin.request("/admin/listicles/offers", {}, env);
    const html = await res.text();
    expect(html).toContain('class="empty-state"');
    expect(html).toContain("No offers yet.");
    expect(html).toContain("data-open-offer-modal");
  });

  it("offers page: all §9 management + analytics columns and row actions", async () => {
    const { env } = newHarness();
    const created = await admin.request(
      "/api/admin/listicles/offers",
      jsonInit("POST", VALID_OFFER),
      env,
    );
    expect(created.status).toBe(201);

    const res = await admin.request("/admin/listicles/offers", {}, env);
    const html = await res.text();

    // §9 management columns
    for (const th of [
      "Offer name", "Provider", "Vertical", "Activity",
      "Tracking method", "Payout", "Cap", "Status",
    ]) {
      expect(html, `management column ${th}`).toContain(`<th scope="col">${th}</th>`);
    }
    // §9 analytics columns — asserted by wire metric name
    for (const metric of [
      "impressions", "clicks", "unique_clicks", "conversions",
      "ctr", "cvr", "revenue", "rpc", "rpm",
    ]) {
      expect(html, `analytics column ${metric}`).toContain(`data-metric-col="${metric}"`);
      expect(html, `analytics hydration cell ${metric}`).toContain(`data-metric="${metric}"`);
    }
    // server-rendered management row + per-cell skeletons (§8 loading state)
    expect(html).toContain("Shell Render Offer");
    expect(html).toContain("acmeco");
    expect(html).toContain("S2S postback");
    expect(html).toContain('data-entity-id="');
    expect(html).toContain('class="skel"');
    // §9 row actions
    expect(html).toContain("data-offer-edit");
    expect(html).toContain("data-offer-delete");
    expect(html).toContain("data-offer-attribution");
    expect(html).toContain("data-lst-analytics-action");
    // analytics hydration is driven by the offers analytics endpoint
    expect(html).toContain('data-analytics-url-prefix="/api/admin/listicles/offers/"');
  });

  it("offers page: every §9 create/edit-modal field is present", async () => {
    const { env } = newHarness();
    const res = await admin.request("/admin/listicles/offers", {}, env);
    const html = await res.text();
    for (const field of [
      "offer_name", "provider", "activity", "vertical", "tag",
      "conversion_tracking_method", "offer_url_template", "payout_method",
      "payout_currency", "payout_value", "cap_enabled", "cap_amount",
      "cap_timezone", "cap_count_by", "cap_fallback_offer_id", "cap_fallback_url",
    ]) {
      expect(html, `modal field ${field}`).toContain(`name="${field}"`);
    }
    // tracking-method options (§9 labels)
    expect(html).toContain('value="s2s_postback"');
    expect(html).toContain("S2S postback");
    expect(html).toContain('value="browser_side_pixel"');
    expect(html).toContain("Browser-side pixel");
    expect(html).toContain('value="script"');
    // payout conditional reveal containers (§9)
    expect(html).toContain('id="offer-payout-conditional"');
    expect(html).toContain('id="offer-cap-conditional"');
    // {clickid}→{click_id} normalization feedback element (§9.4)
    expect(html).toContain('id="offer-url-normalize-note"');
    expect(html).toContain("normalized to {click_id}");
    // fallback picker fed by /offers/search (§9/§13)
    expect(html).toContain('id="offer-fallback-search"');
    expect(html).toContain("/api/admin/listicles/offers/search");
    // §8 validation + a11y states
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="alert"');
    // §8 unsaved-changes guard wiring
    expect(html).toContain("beforeunload");
  });

  it("offers page: exactly the 32 §9.4 canonical macro chips", async () => {
    const { env } = newHarness();
    const res = await admin.request("/admin/listicles/offers", {}, env);
    const html = await res.text();
    const chipArea = html.match(/<div class="macro-chips"[\s\S]*?<\/div>/)?.[0] ?? "";
    const chips = Array.from(chipArea.matchAll(/data-macro="([^"]+)"/g)).map((m) => m[1]);
    expect(CANONICAL_MACROS.length).toBe(32);
    expect(chips).toEqual([...CANONICAL_MACROS]);
    // canonical chip present; the alias is NOT a chip (it only normalizes)
    expect(chips).toContain("click_id");
    expect(chips).not.toContain("clickid");
  });

  // Phase 4 (§27): the Section editor is LIVE — the Phase-3 disabled button
  // became a real link to /admin/listicles/sections/new (this assertion
  // flipped with the phase, mirroring the DEV-10 declaration).
  it("sections page: live Create Section link + Edit row action + §10 columns", async () => {
    const { env } = newHarness();
    const res = await admin.request("/admin/listicles/sections", {}, env);
    const html = await res.text();
    expect(html).toContain('href="/admin/listicles/sections/new"');
    expect(html).toMatch(/<a[^>]*href="\/admin\/listicles\/sections\/new"[^>]*>\+ Create Section<\/a>/);
    expect(html).not.toContain("Section editor ships in Phase 4");
    for (const th of ["Section name", "Articles using", "Updated", "Status"]) {
      expect(html, `sections column ${th}`).toContain(th);
    }
    expect(html).toContain('data-analytics-url-prefix="/api/admin/listicles/sections/"');
  });

  it("articles page: site-scoped list with the repo site select (§11)", async () => {
    const { env } = newHarness();
    const created = await admin.request(
      "/api/admin/listicles/articles",
      jsonInit("POST", {
        site_id: "st_test",
        article_name: "My Listicle",
        slug: "my-listicle",
        // control-Version fields (§11: creating an Article auto-creates one)
        headline: "The Headline",
        intro_paragraph: "The intro.",
        hero_media_url: "https://cdn.example/hero.jpg",
        layout_style_id: "default",
      }),
      env,
    );
    expect(created.status).toBe(201);

    const res = await admin.request("/admin/listicles/articles", {}, env);
    const html = await res.text();
    // first site auto-selected (repo resolveSiteId pattern)
    expect(html).toMatch(/<option value="st_test"[^>]*selected/);
    expect(html).toContain("My Listicle");
    // Phase 5 (DEV-10 closure): the Create button is a LIVE builder link, the
    // toolbar carries the ?search= box, and rows gain an Edit action.
    expect(html).toContain('href="/admin/listicles/articles/new"');
    expect(html).not.toContain("Article builder ships in Phase 5");
    expect(html).toMatch(/<input[^>]*name="search"[^>]*aria-label="Search articles"/);
    // FIX-4: the Edit link deep-links by the stable art_ public id (the route
    // accepts both identities; public_id is the version-agnostic one that
    // analytics/events carry).
    expect(html).toMatch(/href="\/admin\/listicles\/articles\/art_[A-Za-z0-9]+\/edit"/);
    expect(html).not.toMatch(/href="\/admin\/listicles\/articles\/\d+\/edit"/);
    // §11 summary analytics columns hydrate from the article endpoint's total
    expect(html).toContain('data-analytics-pick="total"');
    for (const metric of ["total_visits", "unique_visits", "pps"]) {
      expect(html, `articles metric ${metric}`).toContain(`data-metric="${metric}"`);
    }
  });

  it("articles page: 'Site is required' gate when no site exists", async () => {
    const { env } = newHarness({ seedSite: false });
    const res = await admin.request("/admin/listicles/articles", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Site is required");
    // no articles table renders behind the gate (the shared script string
    // legitimately mentions the data attribute, so assert on the table class)
    expect(html).not.toContain('class="table articles-list"');
  });

  it("offers page: an invalid status filter degrades to a visible load error, not a 500", async () => {
    const { env } = newHarness();
    const res = await admin.request("/admin/listicles/offers?status=bogus", {}, env);
    expect(res.status).toBe(200);
    const html = await res.text();
    // the bogus value is sanitized out before the API call — page renders clean
    expect(html).toContain('class="toolbar"');
  });
});
