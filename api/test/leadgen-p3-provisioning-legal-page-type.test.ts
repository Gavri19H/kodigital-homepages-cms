// R2 P3 flake-fix — the DETERMINISTIC regression for the defect the "firefox
// flake" was hiding (reproduced 5/144 by the investigation round; the raw
// state dumps are scratchpad/p3flake/DFAIL-firefox-{61,73,96,141,145}.txt).
//
// THE DEFECT (pre-fix, legal-renderer.ts:180):
//   every provisioned legal page was inserted with the LITERAL page_type
//   'legal' — VALUES (?, ?, ?, ?, ?, 'published', 'legal', 1, 'legal') —
//   although pages-crud-handlers.ts already exports the vocabulary that tells
//   the four canonical legal pages apart (privacy-policy, terms, do-not-sell,
//   contact). With every provisioned row in ONE bucket, branding.ts
//   resolvePickedLegalPageLinks's page_type fallback leg (first-wins by
//   show_in_footer DESC, display_order ASC, id ASC) returned whichever row was
//   inserted FIRST. Provisioning is async: when its rows land BEFORE a site's
//   own pages they hold the lowest ids, so 'privacy-policy' (the first
//   LEGAL_TEMPLATE_SLUGS entry) won every fallback — four distinct operator
//   picks all served /privacy-policy.
//
// Owner authority — SOURCE-OF-TRUTH.md A.2: "links to legal pages (from the
// 'pages' tab) that the user is choosing". A link the operator picked as
// "Terms of Use" must never serve the Privacy Policy. Legal links are a
// compliance surface, so this is a product defect, not test flake.
//
// WHY THIS FILE IS DETERMINISTIC WHERE THE E2E LOOP WAS 1-IN-29:
//   the e2e (test-ui/leadgen-p3-fixround-footer.gesture.spec.ts, journey D)
//   only hit the collision when the site-provisioning job happened to finish
//   its legal step before the spec created the site's own pages. Here that
//   ordering is CONSTRUCTED: renderLegalPagesForSite (the REAL producer) runs
//   FIRST, the site's own pages are created AFTER through the REAL admin
//   route, and the REAL serve-time resolver reads them back. Both sides of
//   the boundary are the shipped product (E11) — nothing is hand-built.
import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { resolvePickedLegalPageLinks } from "../src/leadgen/branding";
import type { SiteBrandingLegalPagePick } from "../src/leadgen/branding";
import {
  LEGAL_TEMPLATE_SLUGS,
  legalPageTypeForSlug,
  renderLegalPagesForSite,
} from "../src/site-provisioning/legal-renderer";

// --- node:sqlite harness (the repo pattern — same helpers as
// leadgen-p3-fixround-footer.test.ts / leadgen-element-j-pages-links.test.ts,
// plus the legal_templates catalogue the provisioner reads) -----------------

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
          const r = sdb.prepare(sql).run(...binds) as { changes?: number; lastInsertRowid?: number | bigint };
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

// The 4 global legal templates exactly as migration
// 0004_phase3_seed_verticals_and_legal_templates.sql seeds them (slug, title,
// mustache body) — the provisioner's real input.
const TEMPLATE_SEED: Array<[string, string, string]> = [
  ["privacy-policy", "Privacy Policy", "# Privacy Policy for {{site_name}} ({{domain}}) — {{effective_date}}"],
  ["terms", "Terms of Service", "# Terms of Service for {{site_name}} ({{domain}}) — {{effective_date}}"],
  ["do-not-sell", "Do Not Sell My Personal Information", "# Do Not Sell — {{site_name}} ({{domain}})"],
  ["contact", "Contact {{site_name}}", "# Contact {{site_name}} — {{contact_email}}"],
];

function createTestDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      "CREATE TABLE site_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(site_id, key));" +
      "CREATE TABLE legal_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, content_html TEXT, content_json TEXT, content_md TEXT, version INTEGER NOT NULL DEFAULT 1);" +
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
      // migration 0007's per-site UNIQUE slug index — the upsert's conflict target.
      "CREATE UNIQUE INDEX idx_pages_site_slug_unique ON pages(site_id, slug);" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('flake-a','Flake A','a.example.com','insurance','active');" +
      "INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('flake-b','Flake B','b.example.com','insurance','active');",
  );
  for (const [slug, title, md] of TEMPLATE_SEED) {
    sdb.prepare("INSERT INTO legal_templates (slug, title, content_md) VALUES (?, ?, ?)").run(slug, title, md);
  }
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

// The site's OWN pages go in through the REAL admin route (the operator's own
// path), never a raw INSERT — so the consumer reads rows the product wrote.
async function createPage(
  env: Env,
  input: { site_id: string; slug: string; title: string; page_type: string; show_in_footer?: boolean },
): Promise<void> {
  const res = await admin.request(
    "/api/admin/pages",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        site_id: input.site_id,
        slug: input.slug,
        title: input.title,
        page_type: input.page_type,
        show_in_footer: input.show_in_footer ?? false,
        status: "published",
      }),
    },
    env,
  );
  expect(res.status, `create page ${input.slug}: ${await res.clone().text()}`).toBe(201);
}

function pageTypesFor(sdb: SqliteDb, siteId: string): Array<{ slug: string; page_type: string }> {
  return sdb
    .prepare("SELECT slug, page_type FROM pages WHERE site_id = ? ORDER BY id ASC")
    .all(siteId) as Array<{ slug: string; page_type: string }>;
}

// ===========================================================================
// 1 — the ROOT: the provisioner types each canonical legal page
// ===========================================================================

describeDb("R2 P3 flake-fix ROOT — site-provisioning types each legal page by its own page_type", () => {
  it("renderLegalPagesForSite writes privacy-policy/terms/do-not-sell/contact (fail-before: four rows all 'legal')", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const env = buildEnv(d1FromSqlite(sdb));

    const result = await renderLegalPagesForSite(env, env.DB, "flake-a");
    expect(result.rendered, "all four templates render").toBe(4);
    expect(result.missing).toEqual([]);

    expect(pageTypesFor(sdb, "flake-a")).toEqual([
      { slug: "privacy-policy", page_type: "privacy-policy" },
      { slug: "terms", page_type: "terms" },
      { slug: "do-not-sell", page_type: "do-not-sell" },
      { slug: "contact", page_type: "contact" },
    ]);
    // and the four are now DISTINGUISHABLE — the property the defect destroyed
    expect(new Set(pageTypesFor(sdb, "flake-a").map((r) => r.page_type)).size).toBe(
      LEGAL_TEMPLATE_SLUGS.length,
    );
    sdb.close();
  });

  it("a site already carrying the stale 'legal' rows SELF-HEALS on its next provisioning run (same row ids, ON CONFLICT DO UPDATE)", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const env = buildEnv(d1FromSqlite(sdb));
    // the production shape: the four pages already exist, all typed 'legal'
    for (const [slug, title] of TEMPLATE_SEED) {
      sdb
        .prepare(
          "INSERT INTO pages (site_id, slug, title, content_json, content_html, status, template, show_in_footer, page_type)" +
            " VALUES (?, ?, ?, '{}', '<p>old</p>', 'published', 'legal', 1, 'legal')",
        )
        .run("flake-a", slug, title);
    }
    const idsBefore = (sdb.prepare("SELECT id, slug FROM pages WHERE site_id = ? ORDER BY id ASC").all("flake-a") as Array<{
      id: number;
      slug: string;
    }>).map((r) => `${r.id}:${r.slug}`);

    await renderLegalPagesForSite(env, env.DB, "flake-a");

    expect(pageTypesFor(sdb, "flake-a").map((r) => r.page_type)).toEqual([
      "privacy-policy",
      "terms",
      "do-not-sell",
      "contact",
    ]);
    const idsAfter = (sdb.prepare("SELECT id, slug FROM pages WHERE site_id = ? ORDER BY id ASC").all("flake-a") as Array<{
      id: number;
      slug: string;
    }>).map((r) => `${r.id}:${r.slug}`);
    expect(idsAfter, "the upsert REWRITES the existing rows — no duplicate pages").toEqual(idsBefore);
    sdb.close();
  });

  it("a NON-canonical slug still lands in the generic 'legal' bucket (vocabulary reuse, not a new taxonomy)", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const env = buildEnv(d1FromSqlite(sdb));
    sdb
      .prepare("INSERT INTO legal_templates (slug, title, content_md) VALUES (?, ?, ?)")
      .run("state-law-notice", "State Law Notice", "# {{site_name}}");
    // the renderer only walks LEGAL_TEMPLATE_SLUGS, so drive the mapper the
    // insert binds — the same function, on the slug a future template would use
    expect(legalPageTypeForSlug("state-law-notice")).toBe("legal");
    expect(legalPageTypeForSlug("terms")).toBe("terms");
    expect(legalPageTypeForSlug("legal")).toBe("legal");
    await renderLegalPagesForSite(env, env.DB, "flake-a");
    expect(pageTypesFor(sdb, "flake-a").some((r) => r.slug === "state-law-notice")).toBe(false);
    sdb.close();
  });
});

// ===========================================================================
// 2 — the DUMPED STATE, constructed: provisioning rows land BEFORE the site's
//     own pages, four picks reach the page_type fallback leg
// ===========================================================================

describeDb("R2 P3 flake-fix — the reproduced state (provisioning first, then the site's own pages)", () => {
  // The picks a template carries when the operator picked on a REFERENCE site
  // and the serving site RENAMED its addresses: the slug leg misses, so every
  // pick reaches the page_type fallback — the leg the defect lived on.
  const RENAMED_PICKS: SiteBrandingLegalPagePick[] = [
    { page_type: "privacy-policy", slug: "ref-privacy-policy", label: "Privacy Policy" },
    { page_type: "terms", slug: "ref-terms", label: "Terms of Use" },
    { page_type: "do-not-sell", slug: "ref-do-not-sell", label: "Your Privacy Choices" },
    { page_type: "contact", slug: "ref-contact", label: "Contact" },
  ];

  it("four picks on the page_type fallback leg serve FOUR DISTINCT hrefs (fail-before: the four canonical rows were one bucket)", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const env = buildEnv(d1FromSqlite(sdb));

    // (a) async provisioning lands FIRST — ids 1..4, privacy-policy lowest
    await renderLegalPagesForSite(env, env.DB, "flake-a");
    // (b) the site's own pages are created AFTER, through the real admin route
    await createPage(env, { site_id: "flake-a", slug: "about", title: "About", page_type: "about" });
    await createPage(env, { site_id: "flake-a", slug: "site-notice", title: "Site Notice", page_type: "legal", show_in_footer: true });

    const links = await resolvePickedLegalPageLinks(env.DB, "flake-a", RENAMED_PICKS);
    expect(links.map((l) => l.label)).toEqual([
      "Privacy Policy",
      "Terms of Use",
      "Your Privacy Choices",
      "Contact",
    ]);
    const hrefs = links.map((l) => l.href);
    expect(hrefs, "each pick serves ITS OWN page").toEqual([
      "/privacy-policy",
      "/terms",
      "/do-not-sell",
      "/contact",
    ]);
    expect(new Set(hrefs).size, 'FAIL-BEFORE: every pick served the first-inserted row').toBe(4);
    sdb.close();
  });

  it("the compliance claim itself: the pick labelled \"Terms of Use\" never serves the privacy policy", async () => {
    const sdb = createTestDb(DatabaseSync!);
    const env = buildEnv(d1FromSqlite(sdb));
    await renderLegalPagesForSite(env, env.DB, "flake-a");
    await createPage(env, { site_id: "flake-a", slug: "site-notice", title: "Site Notice", page_type: "legal", show_in_footer: true });

    const links = await resolvePickedLegalPageLinks(env.DB, "flake-a", RENAMED_PICKS);
    const byLabel = new Map(links.map((l) => [l.label, l.href]));
    expect(byLabel.get("Terms of Use")).toBe("/terms");
    expect(byLabel.get("Your Privacy Choices")).toBe("/do-not-sell");
    expect(byLabel.get("Contact")).toBe("/contact");
    expect(byLabel.get("Privacy Policy")).toBe("/privacy-policy");
    sdb.close();
  });

  it("the e2e's own failing assertion, deterministically: every href site B serves is one of B's OWN pages", async () => {
    // Journey D of test-ui/leadgen-p3-fixround-footer.gesture.spec.ts failed
    // 5/144 on firefox with `B href /privacy-policy must be one of B's OWN
    // pages` — /privacy-policy being a PROVISIONING row that won the 'legal'
    // bucket's first-wins tie-break on site B. Same ordering, constructed.
    const sdb = createTestDb(DatabaseSync!);
    const env = buildEnv(d1FromSqlite(sdb));

    await renderLegalPagesForSite(env, env.DB, "flake-b"); // provisioning first
    const B_OWN = [
      { slug: "p3fx-b-contact", title: "Contact B", show_in_footer: true },
      { slug: "p3fx-b-do-not-sell", title: "Choices B", show_in_footer: false },
      { slug: "p3fx-b-state-notice", title: "State Notice B", show_in_footer: false },
      { slug: "p3fx-b-datenschutz", title: "Privacy B", show_in_footer: false },
      { slug: "p3fx-b-terms-of-use", title: "Terms B", show_in_footer: false },
    ];
    for (const p of B_OWN) {
      await createPage(env, { site_id: "flake-b", slug: p.slug, title: p.title, page_type: "legal", show_in_footer: p.show_in_footer });
    }

    // the saved pick set was authored on site A: page_type 'legal' (what the
    // picker stored for A's own rows) plus A's slugs, none of which B publishes
    const picks: SiteBrandingLegalPagePick[] = [
      { page_type: "legal", slug: "p3fx-a-state-law-privacy-notice", label: "State Law Privacy Notice" },
      { page_type: "legal", slug: "p3fx-a-licenses-disclosure", label: "Licenses & Disclosure" },
      { page_type: "legal", slug: "p3fx-a-privacy-policy", label: "Privacy Policy" },
      { page_type: "legal", slug: "p3fx-a-terms", label: "Terms of Use" },
    ];
    const links = await resolvePickedLegalPageLinks(env.DB, "flake-b", picks);
    const bOwn = new Set(B_OWN.map((p) => `/${p.slug}`));
    for (const l of links) {
      expect(bOwn.has(l.href), `FAIL-BEFORE: B href ${l.href} must be one of B's OWN pages`).toBe(true);
    }
    // and no provisioned canonical row can be borrowed into B's footer
    for (const slug of LEGAL_TEMPLATE_SLUGS) {
      expect(links.map((l) => l.href), `B must never serve the provisioned /${slug}`).not.toContain(`/${slug}`);
    }
    // The loop above must not be able to pass VACUOUSLY, and on this
    // legacy-shaped site it now does resolve to nothing: B's own five pages
    // all share page_type 'legal', so the fallback is ambiguous and every
    // pick omits (conductor ruling — a missing link over a wrong one). State
    // that explicitly, so "0 links" can never be mistaken for "0 checks".
    expect(links, "an all-'legal' site cannot identify a page by type ⇒ every pick omits").toEqual([]);
    sdb.close();
  });

  it("a site provisioned AFTER the fix (one row per type, renamed slugs) still resolves every pick by page_type — non-vacuously", async () => {
    // The other side of the ruling: omission is only for genuine ambiguity.
    // With the provisioner writing one canonical type per page, a site that
    // RENAMED its addresses keeps exactly one row per type, so the owner's
    // renamed-site clause resolves — to that site's OWN distinct pages.
    const sdb = createTestDb(DatabaseSync!);
    const env = buildEnv(d1FromSqlite(sdb));
    const B_RENAMED = [
      { slug: "p3fx-b-datenschutz", title: "Privacy B", page_type: "privacy-policy" },
      { slug: "p3fx-b-terms-of-use", title: "Terms B", page_type: "terms" },
      { slug: "p3fx-b-choices", title: "Choices B", page_type: "do-not-sell" },
      { slug: "p3fx-b-reach-us", title: "Contact B", page_type: "contact" },
      { slug: "p3fx-b-state-notice", title: "State Notice B", page_type: "legal" },
    ];
    for (const p of B_RENAMED) {
      await createPage(env, { site_id: "flake-b", slug: p.slug, title: p.title, page_type: p.page_type });
    }
    // picks authored on the reference site: canonical types, the reference
    // site's slugs (which B does not publish) → every pick takes the type leg
    const picks: SiteBrandingLegalPagePick[] = [
      { page_type: "privacy-policy", slug: "p3fx-a-privacy-policy", label: "Privacy Policy" },
      { page_type: "terms", slug: "p3fx-a-terms", label: "Terms of Use" },
      { page_type: "do-not-sell", slug: "p3fx-a-do-not-sell", label: "Your Privacy Choices" },
      { page_type: "contact", slug: "p3fx-a-contact", label: "Contact" },
      { page_type: "legal", slug: "p3fx-a-state-law-privacy-notice", label: "State Law Privacy Notice" },
    ];
    const links = await resolvePickedLegalPageLinks(env.DB, "flake-b", picks);
    expect(links, "five picks, five of B's OWN pages, each by its own type").toEqual([
      { label: "Privacy Policy", href: "/p3fx-b-datenschutz" },
      { label: "Terms of Use", href: "/p3fx-b-terms-of-use" },
      { label: "Your Privacy Choices", href: "/p3fx-b-choices" },
      { label: "Contact", href: "/p3fx-b-reach-us" },
      { label: "State Law Privacy Notice", href: "/p3fx-b-state-notice" },
    ]);
    expect(new Set(links.map((l) => l.href)).size, "five DISTINCT hrefs").toBe(5);
    sdb.close();
  });
});
