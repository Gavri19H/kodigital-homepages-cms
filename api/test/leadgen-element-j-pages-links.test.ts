// R2 P3 S3b — element J's Pages-fed legal-links picker + serve-time
// resolution (fix-contract §5.4 item 2 / §7 D2). Proves, over a seeded
// node:sqlite D1 (the repo harness pattern from leadgen-branding.test.ts):
//
//   * listPickableLegalPages / GET /sites/:site_id/legal-pages — the
//     picker's data source: ONE site's own legal + show_in_footer pages,
//     never another site's;
//   * resolvePickedLegalPageLinks — the D2 serve-time semantic: the SAME
//     pick set (by page_type, the stable identity), resolved against TWO
//     different serving sites, yields EACH site's own href;
//   * the site missing a picked page: OMITTED when no manual_url is set,
//     renders the manual_url when one is set — never a dead link;
//   * SAFE_HREF_RE gating on the manual_url leg (the ONLY new
//     operator-typed href this slice introduces) — a `javascript:` fallback
//     is rejected at resolve time AND, driven through the REAL, unmodified
//     frame.ts render path (renderQuoteFrame / link_row / links_source:
//     "site"), never appears as a clickable anchor; a safe fallback does;
//   * resolveSiteBranding's new 3rd arg is purely additive: absent/empty →
//     byte-identical pre-D2 behavior; non-empty → REPLACES (never merges
//     with) the site_settings-derived legal_links.

import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import {
  listPickableLegalPages,
  resolvePickedLegalPageLinks,
  resolveSiteBranding,
  type SiteBrandingLegalPagePick,
} from "../src/leadgen/branding";
import { LG_BANNERS_MOUNT_HTML, renderQuoteFrame } from "../src/public/leadgen/designs/frame";
import type { RenderQuoteFrameInput } from "../src/public/leadgen/designs/frame";
import { effectiveFrame } from "../src/public/leadgen/designs/frames";
import type { FrameConfig } from "../src/public/leadgen/designs/frames";
import { resolveTokens } from "../src/public/leadgen/designs/theme";
import { defaultFunnelDesign } from "../src/public/leadgen/designs/default-funnel/tokens";

// --- node:sqlite harness (repo pattern, mirrors leadgen-branding.test.ts) ----

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
    return (nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor }).DatabaseSync;
  } catch {
    try {
      const getBuiltin = (process as unknown as {
        getBuiltinModule?: (name: string) => unknown;
      }).getBuiltinModule;
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
  const db = {
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
        for (const statement of statements) results.push(await statement.run());
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

// Base schema: sites/domains/media (site-logo-inheritance's own minimal
// shape) + site_settings + a hand-rolled `pages` table matching the REAL
// post-migration column set (pages-crud-handlers.ts PAGE_COLUMNS) so the
// REAL createPageHandler / getPageHandler run unmodified against it — three
// sites seeded: site-1 + site-2 (each will get their OWN privacy+terms
// pages), site-3 (privacy only — the "missing page" leg).
function createTestDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "CREATE TABLE site_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(site_id, key));" +
      "CREATE TABLE pages (" +
      " id INTEGER PRIMARY KEY AUTOINCREMENT," +
      " site_id TEXT," +
      " slug TEXT NOT NULL," +
      " title TEXT NOT NULL," +
      " content_json TEXT NOT NULL," +
      " content_html TEXT," +
      " status TEXT NOT NULL DEFAULT 'draft'," +
      " template TEXT NOT NULL DEFAULT 'default'," +
      " show_in_footer INTEGER NOT NULL DEFAULT 0," +
      " display_order INTEGER NOT NULL DEFAULT 0," +
      " page_type TEXT NOT NULL DEFAULT 'generic'," +
      " seo_title TEXT," +
      " seo_description TEXT," +
      " created_at INTEGER NOT NULL DEFAULT (unixepoch())," +
      " updated_at INTEGER NOT NULL DEFAULT (unixepoch())" +
      ");" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','one.example.com','insurance','active');" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-2','Site Two','two.example.com','insurance','active');" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-3','Site Three','three.example.com','insurance','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','one.example.com','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-2','two.example.com','active');" +
      "INSERT INTO domains (site_id, hostname, status) VALUES ('site-3','three.example.com','active');",
  );
  return sdb;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: makeKvStub(),
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

// Authors ONE page through the REAL admin API (POST /api/admin/pages) —
// "author your rows via the admin APIs", never a raw INSERT for the rows
// under test.
async function createPage(
  env: Env,
  input: {
    site_id: string;
    slug: string;
    title: string;
    page_type: string;
    show_in_footer?: boolean;
    status?: string;
  },
): Promise<{ id: number; slug: string }> {
  const res = await admin.request(
    "/api/admin/pages",
    jsonInit("POST", {
      site_id: input.site_id,
      slug: input.slug,
      title: input.title,
      page_type: input.page_type,
      show_in_footer: input.show_in_footer ?? false,
      status: input.status ?? "published",
    }),
    env,
  );
  expect(res.status, `create page ${input.slug}: ${await res.clone().text()}`).toBe(201);
  const body = (await res.json()) as { page: { id: number; slug: string } };
  return body.page;
}

// ===========================================================================
// The picker's data source — listPickableLegalPages + GET .../legal-pages
// ===========================================================================

describeDb("element J D2 — picker data source (listPickableLegalPages)", () => {
  it("returns ONE site's own legal + show_in_footer pages, never another site's", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const db = d1FromSqlite(sdb);
    const env = buildEnv(db);
    await createPage(env, { site_id: "site-1", slug: "privacy-policy", title: "Privacy Policy", page_type: "privacy-policy" });
    await createPage(env, { site_id: "site-1", slug: "accessibility", title: "Accessibility Statement", page_type: "generic", show_in_footer: true });
    await createPage(env, { site_id: "site-1", slug: "careers", title: "Careers", page_type: "generic", show_in_footer: false }); // NOT pickable (neither legal nor footer-flagged)
    await createPage(env, { site_id: "site-2", slug: "privacy-policy", title: "Site Two Privacy", page_type: "privacy-policy" });

    const pages = await listPickableLegalPages(db, "site-1");
    expect(pages.map((p) => p.slug).sort()).toEqual(["accessibility", "privacy-policy"]);
    expect(pages.every((p) => p.slug !== "careers")).toBe(true);
    expect(pages.some((p) => p.slug === "privacy-policy" && p.title === "Privacy Policy")).toBe(true);
  });

  it("GET /api/admin/leadgen/sites/:site_id/legal-pages serves the same catalog over the real route; 404 on an unknown site", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const db = d1FromSqlite(sdb);
    const env = buildEnv(db);
    await createPage(env, { site_id: "site-1", slug: "terms", title: "Terms of Use", page_type: "terms" });

    const res = await admin.request("/api/admin/leadgen/sites/site-1/legal-pages", { method: "GET" }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { site_id: string; pages: Array<{ page_type: string; slug: string }> };
    expect(body.site_id).toBe("site-1");
    expect(body.pages).toEqual([{ page_type: "terms", slug: "terms", title: "Terms of Use", show_in_footer: false }]);

    const missing = await admin.request("/api/admin/leadgen/sites/no-such-site/legal-pages", { method: "GET" }, env);
    expect(missing.status).toBe(404);
  });
});

// ===========================================================================
// The D2 serve-time semantic — the SAME pick set resolves per SERVING site
// ===========================================================================

describeDb("element J D2 — resolvePickedLegalPageLinks (serve-time resolution)", () => {
  it("the SAME picks resolve to EACH site's own page (site A's privacy on A, site B's on B)", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const db = d1FromSqlite(sdb);
    const env = buildEnv(db);
    await createPage(env, { site_id: "site-1", slug: "privacy-policy", title: "Site One Privacy", page_type: "privacy-policy" });
    await createPage(env, { site_id: "site-1", slug: "terms", title: "Site One Terms", page_type: "terms" });
    // Site Two deliberately uses DIFFERENT slugs — proves resolution is a
    // real per-site DB lookup, not string-matching luck on a shared slug.
    await createPage(env, { site_id: "site-2", slug: "site-two-privacy-notice", title: "Site Two Privacy", page_type: "privacy-policy" });
    await createPage(env, { site_id: "site-2", slug: "site-two-terms", title: "Site Two Terms", page_type: "terms" });

    const picks: SiteBrandingLegalPagePick[] = [
      { page_type: "privacy-policy", label: "Privacy Policy" },
      { page_type: "terms", label: "Terms of Use" },
    ];

    const siteOneLinks = await resolvePickedLegalPageLinks(db, "site-1", picks);
    expect(siteOneLinks).toEqual([
      { label: "Privacy Policy", href: "/privacy-policy" },
      { label: "Terms of Use", href: "/terms" },
    ]);

    const siteTwoLinks = await resolvePickedLegalPageLinks(db, "site-2", picks);
    expect(siteTwoLinks).toEqual([
      { label: "Privacy Policy", href: "/site-two-privacy-notice" },
      { label: "Terms of Use", href: "/site-two-terms" },
    ]);
  });

  it("a site missing a picked page: OMITTED when no manual_url; renders the manual_url when one is set", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const db = d1FromSqlite(sdb);
    const env = buildEnv(db);
    await createPage(env, { site_id: "site-3", slug: "privacy-policy", title: "Site Three Privacy", page_type: "privacy-policy" });
    // site-3 has NO "terms" page.

    const noFallback = await resolvePickedLegalPageLinks(db, "site-3", [
      { page_type: "privacy-policy", label: "Privacy Policy" },
      { page_type: "terms", label: "Terms of Use" },
    ]);
    expect(noFallback).toEqual([{ label: "Privacy Policy", href: "/privacy-policy" }]); // terms OMITTED — never a dead link

    const withFallback = await resolvePickedLegalPageLinks(db, "site-3", [
      { page_type: "privacy-policy", label: "Privacy Policy" },
      { page_type: "terms", label: "Terms of Use", manual_url: "https://legal.example.com/terms" },
    ]);
    expect(withFallback).toEqual([
      { label: "Privacy Policy", href: "/privacy-policy" },
      { label: "Terms of Use", href: "https://legal.example.com/terms" },
    ]);
  });

  it("a draft (unpublished) page never resolves at serve time — treated as no match", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const db = d1FromSqlite(sdb);
    const env = buildEnv(db);
    await createPage(env, { site_id: "site-1", slug: "terms", title: "Draft Terms", page_type: "terms", status: "draft" });

    const links = await resolvePickedLegalPageLinks(db, "site-1", [{ page_type: "terms", label: "Terms of Use" }]);
    expect(links).toEqual([]); // no manual_url set → omitted, exactly as if the page did not exist
  });

  it("SAFE_HREF_RE gates the manual_url fallback: javascript: is rejected (omitted), a safe URL passes", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const db = d1FromSqlite(sdb);

    const unsafe = await resolvePickedLegalPageLinks(db, "site-1", [
      { page_type: "terms", label: "Terms of Use", manual_url: "javascript:alert(1)" },
    ]);
    expect(unsafe).toEqual([]);

    const protocolRelative = await resolvePickedLegalPageLinks(db, "site-1", [
      { page_type: "terms", label: "Terms of Use", manual_url: "//evil.example.com/terms" },
    ]);
    expect(protocolRelative).toEqual([]); // rejected same as SAFE_HREF_RE (frames.ts:856) — NOT the more permissive isSafeUrl

    const safe = await resolvePickedLegalPageLinks(db, "site-1", [
      { page_type: "terms", label: "Terms of Use", manual_url: "https://legal.example.com/terms" },
    ]);
    expect(safe).toEqual([{ label: "Terms of Use", href: "https://legal.example.com/terms" }]);
  });
});

// ===========================================================================
// resolveSiteBranding's new 3rd arg — additive, REPLACE semantics
// ===========================================================================

describeDb("element J D2 — resolveSiteBranding(db, siteId, legalPagePicks?)", () => {
  it("absent/empty picks → byte-identical pre-D2 behavior (site_settings derivation)", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const db = d1FromSqlite(sdb);
    sdb.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)").run("site-1", "privacy_email", "privacy@one.example.com");

    const noArg = await resolveSiteBranding(db, "site-1");
    const emptyArg = await resolveSiteBranding(db, "site-1", []);
    expect(noArg.legal_links).toEqual([
      { label: "Privacy policy", href: "/privacy-policy" },
      { label: "Terms of use", href: "/terms" },
    ]);
    expect(emptyArg).toEqual(noArg);
  });

  it("non-empty picks REPLACE (never merge with) the site_settings-derived legal_links", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const db = d1FromSqlite(sdb);
    const env = buildEnv(db);
    sdb.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)").run("site-1", "privacy_email", "privacy@one.example.com");
    await createPage(env, { site_id: "site-1", slug: "our-privacy", title: "Our Privacy", page_type: "privacy-policy" });

    const withPicks = await resolveSiteBranding(db, "site-1", [{ page_type: "privacy-policy", label: "Privacy" }]);
    // ONLY the picked-page resolution — the site_settings-derived /terms
    // (which would otherwise ride along with privacy_email) is ABSENT.
    expect(withPicks.legal_links).toEqual([{ label: "Privacy", href: "/our-privacy" }]);
  });
});

// ===========================================================================
// Real render-path proof — the EXISTING, unmodified frame.ts renderQuoteFrame
// (link_row / links_source:"site") consuming MY resolver's real output
// ===========================================================================

const TOKENS = resolveTokens(defaultFunnelDesign);
const ROOT = {
  funnelId: "lgf_0000000000000000000ELEMJ01",
  funnelVariantId: "lgn_0000000000000000000ELEMJ02",
  quoteId: "lgq_0000000000000000000ELEMJ03",
  contentVersion: 1,
};

function renderFooterWithBranding(legalLinks: Array<{ label: string; href: string }>): string {
  const patch: FrameConfig = {
    footer: {
      enabled: true,
      blocks: [{ type: "link_row", links_source: "site" }],
    },
  };
  const { frame, problems } = effectiveFrame("centered", patch);
  expect(problems).toEqual([]);
  const input: RenderQuoteFrameInput = {
    effectiveTokens: TOKENS,
    frame,
    siteBranding: {
      site_name: "Acme Insure",
      logo_url: null,
      tagline: null,
      legal_links: legalLinks,
      trust_logos: null,
    },
    sectionsHtml: "",
    bannersMountHtml: LG_BANNERS_MOUNT_HTML,
    sectionCount: 2,
    root: ROOT,
  };
  return renderQuoteFrame(input);
}

describe("element J D2 — driven through the REAL, unmodified frame.ts render path", () => {
  it("a resolver-produced safe link renders as a real clickable anchor", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const db = d1FromSqlite(sdb);
    const env = buildEnv(db);
    await createPage(env, { site_id: "site-1", slug: "privacy-policy", title: "Privacy Policy", page_type: "privacy-policy" });

    const links = await resolvePickedLegalPageLinks(db, "site-1", [{ page_type: "privacy-policy", label: "Privacy Policy" }]);
    const html = renderFooterWithBranding(links);
    expect(html).toContain('<a class="lg-frame-footer2-link" href="/privacy-policy">Privacy Policy</a>');
  });

  it("a rejected javascript: manual_url never reaches the render path as a link at all (resolver already omitted it)", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const db = d1FromSqlite(sdb);

    const links = await resolvePickedLegalPageLinks(db, "site-1", [
      { page_type: "terms", label: "Evil", manual_url: "javascript:alert(1)" },
    ]);
    expect(links).toEqual([]); // the resolver's own boundary — nothing to hand the renderer
    const html = renderFooterWithBranding(links);
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("lg-frame-footer2-links"); // link_row renders NOTHING when its links array is empty
  });

  it("REGRESSION: if a caller ever bypassed the resolver and handed frame.ts a raw javascript: href directly, the CURRENT render path would emit it (escapeHtml only, no SAFE_HREF_RE re-check) — documents why the resolver, not the renderer, is this leg's safety boundary", () => {
    const html = renderFooterWithBranding([{ label: "Evil", href: "javascript:alert(1)" }]);
    // This is the EXISTING, unmodified frame.ts behavior (link_row / "site"
    // mode has never re-validated branding-derived hrefs — they were always
    // code-derived-safe before this slice). Documents the exact bypass route
    // named in the dispatch (frame.ts renderFooterBlock ~916-924) rather
    // than silently patching an unowned file.
    expect(html).toContain("javascript:alert(1)");
  });
});
