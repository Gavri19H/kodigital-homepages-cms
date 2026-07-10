// LeadGen redesign v2.5 §10 — contract test `site-logo-inheritance`.
//
// LADDER LEGS ONLY (§10.1 projection + §10.4 fallback ladder + §10.2 resolver
// binding). The serve-BAKE leg — the resolved logo/name/legal actually
// rendered into the cached /lg shell by the quote frame — belongs to a later
// slice (frame renderer) and is intentionally NOT covered here.
//
// Proves, over a seeded node:sqlite D1 (the repo harness pattern from
// leadgen-runtime-api.test.ts, plus the 0003-shape site_settings table):
//   * logo ladder: logo_media_id (media storage key) → mediaUrl() output,
//     outranking site_logo_url; media absent + SAFE site_logo_url → that url;
//     an unsafe (javascript:) url is SKIPPED → null; nothing → null and the
//     consumer falls to the site_name text mark;
//   * site_name: site_settings.site_name (trimmed) else the sites row's host
//     identity (`domain` — the row carries no hostname column);
//   * tagline passthrough: set → value (trimmed); unset/blank → null;
//   * legal_links derivation incl. missing → OMITTED (never empty hrefs):
//     contact_email → /contact; privacy_email → /privacy-policy + /terms
//     (the provisioning-seeded legal slugs; labels mirror the listicle
//     footer);
//   * fail-open: a DB without a site_settings table (minimal harnesses /
//     schema drift) still yields the fallback projection — branding never
//     throws into a funnel serve;
//   * resolver integration (§10.2): a funnel activated through the REAL
//     admin API resolves with `site_branding` populated, identically on BOTH
//     resolveActivatedFunnel and resolveActivatedFunnelByVariant.

import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mintPublicId } from "../src/leadgen/ids";
import { resolveSiteBranding } from "../src/leadgen/branding";
import {
  resolveActivatedFunnel,
  resolveActivatedFunnelByVariant,
} from "../src/public/leadgen/resolver";

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

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

const LEADGEN_MIGRATIONS = [
  "0036_leadgen_core.sql",
  "0037_leadgen_analytics_mirror.sql",
  "0038_leadgen_revenue_infra.sql",
  "0039_leadgen_conversion_dedupe.sql",
] as const;

const TENANT_HOST = "one.example.com";

// The 0003-restructure site_settings shape (site_id nullable global tier,
// UNIQUE(site_id, key)) — the table the minimal runtime harnesses omit.
const SITE_SETTINGS_DDL =
  "CREATE TABLE site_settings (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, key TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(site_id, key));";

// Base schema: what resolveSiteByHostname/branding need (sites/domains/media)
// + site_settings + the real leadgen migrations. site-1 lives on TENANT_HOST.
function createBrandingDb(
  DatabaseSync: DatabaseSyncCtor,
  opts: { withSettingsTable?: boolean; withLeadgen?: boolean } = {},
): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT, domain TEXT, vertical_slug TEXT, status TEXT, content_version INTEGER DEFAULT 1, settings_version INTEGER DEFAULT 1);" +
      "CREATE TABLE domains (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT, hostname TEXT, status TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);" +
      `INSERT INTO sites (id, name, domain, vertical_slug, status) VALUES ('site-1','Site One','${TENANT_HOST}','insurance','active');` +
      `INSERT INTO domains (site_id, hostname, status) VALUES ('site-1','${TENANT_HOST}','active');`,
  );
  if (opts.withSettingsTable !== false) runSql(sdb, SITE_SETTINGS_DDL);
  if (opts.withLeadgen === true) {
    for (const file of LEADGEN_MIGRATIONS) {
      runSql(sdb, readFileSync(join(TEST_DIR, "../migrations", file), "utf8"));
    }
  }
  return sdb;
}

function setSetting(sdb: SqliteDb, siteId: string, key: string, value: string): void {
  sdb
    .prepare("INSERT OR REPLACE INTO site_settings (site_id, key, value) VALUES (?, ?, ?)")
    .run(siteId, key, value);
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
const ctor = () => DatabaseSync as DatabaseSyncCtor;

// ===========================================================================
// §10.1 / §10.4 — resolveSiteBranding fallback ladder
// ===========================================================================

describeDb("site-logo-inheritance — resolveSiteBranding ladder (§10.1/§10.4)", () => {
  it("logo: logo_media_id storage key wins → mediaUrl output (site_logo_url present but outranked)", async () => {
    const sdb = createBrandingDb(ctor());
    setSetting(sdb, "site-1", "logo_media_id", "logos/one.png");
    setSetting(sdb, "site-1", "site_logo_url", "https://cdn.example.com/other.svg");
    const branding = await resolveSiteBranding(d1FromSqlite(sdb), "site-1");
    expect(branding.logo_url).toBe("/media/logos/one.png");
  });

  it("logo: media absent + SAFE site_logo_url → that url verbatim", async () => {
    const sdb = createBrandingDb(ctor());
    setSetting(sdb, "site-1", "logo_media_id", ""); // seeded-empty (provisioning default)
    setSetting(sdb, "site-1", "site_logo_url", "https://cdn.example.com/logo.svg");
    const branding = await resolveSiteBranding(d1FromSqlite(sdb), "site-1");
    expect(branding.logo_url).toBe("https://cdn.example.com/logo.svg");
  });

  it("logo: unsafe site_logo_url (javascript:) is SKIPPED → null", async () => {
    const sdb = createBrandingDb(ctor());
    setSetting(sdb, "site-1", "site_logo_url", "javascript:alert(1)");
    const branding = await resolveSiteBranding(d1FromSqlite(sdb), "site-1");
    expect(branding.logo_url).toBeNull();
  });

  it("nothing → logo_url null; site_name = settings.site_name, else the sites row's domain", async () => {
    // With a site_name setting: the text-mark leg carries the brand name.
    const named = createBrandingDb(ctor());
    setSetting(named, "site-1", "site_name", "  Acme Insure  ");
    const withName = await resolveSiteBranding(d1FromSqlite(named), "site-1");
    expect(withName.logo_url).toBeNull();
    expect(withName.site_name).toBe("Acme Insure"); // trimmed, mirrors brandFromSettings

    // Without one (or blank): the sites row's host identity (domain).
    const bare = createBrandingDb(ctor());
    setSetting(bare, "site-1", "site_name", "   ");
    const fallback = await resolveSiteBranding(d1FromSqlite(bare), "site-1");
    expect(fallback.logo_url).toBeNull();
    expect(fallback.site_name).toBe(TENANT_HOST);
  });

  it("tagline passthrough: set → value (trimmed); unset/blank → null", async () => {
    const sdb = createBrandingDb(ctor());
    setSetting(sdb, "site-1", "tagline", " Compare and save. ");
    expect((await resolveSiteBranding(d1FromSqlite(sdb), "site-1")).tagline).toBe(
      "Compare and save.",
    );

    const blank = createBrandingDb(ctor());
    setSetting(blank, "site-1", "tagline", "   ");
    expect((await resolveSiteBranding(d1FromSqlite(blank), "site-1")).tagline).toBeNull();

    const unset = createBrandingDb(ctor());
    expect((await resolveSiteBranding(d1FromSqlite(unset), "site-1")).tagline).toBeNull();
  });

  it("legal_links: contact_email → /contact; privacy_email → /privacy-policy + /terms; missing → OMITTED (never empty hrefs)", async () => {
    const full = createBrandingDb(ctor());
    setSetting(full, "site-1", "contact_email", "contact@one.example.com");
    setSetting(full, "site-1", "privacy_email", "privacy@one.example.com");
    const both = await resolveSiteBranding(d1FromSqlite(full), "site-1");
    expect(both.legal_links).toEqual([
      { label: "Contact", href: "/contact" },
      { label: "Privacy policy", href: "/privacy-policy" },
      { label: "Terms of use", href: "/terms" },
    ]);
    for (const link of both.legal_links) {
      expect(link.href.length).toBeGreaterThan(0);
      expect(link.label.length).toBeGreaterThan(0);
    }

    // Only the contact signal → only the contact link.
    const contactOnly = createBrandingDb(ctor());
    setSetting(contactOnly, "site-1", "contact_email", "contact@one.example.com");
    setSetting(contactOnly, "site-1", "privacy_email", ""); // seeded-empty (blank domain)
    expect((await resolveSiteBranding(d1FromSqlite(contactOnly), "site-1")).legal_links).toEqual([
      { label: "Contact", href: "/contact" },
    ]);

    // No signals at all → the group is omitted entirely.
    const none = createBrandingDb(ctor());
    expect((await resolveSiteBranding(d1FromSqlite(none), "site-1")).legal_links).toEqual([]);
  });

  it("fail-open: a DB without a site_settings table still yields the fallback projection (branding never throws)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const sdb = createBrandingDb(ctor(), { withSettingsTable: false });
      const branding = await resolveSiteBranding(d1FromSqlite(sdb), "site-1");
      expect(branding).toEqual({
        site_name: TENANT_HOST,
        logo_url: null,
        tagline: null,
        legal_links: [],
      });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// ===========================================================================
// §10.2 — resolver integration: the resolved bundle carries site_branding
// ===========================================================================

const API = "/api/admin/leadgen";

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Minimal section matching the quote's activity+vertical (repo seeding pattern).
function seedSection(sdb: SqliteDb): { id: number } {
  const publicId = mintPublicId("section");
  sdb
    .prepare(
      "INSERT INTO leadgen_sections (public_id, section_name, activity, vertical, headline_text, content_json, continue_mode, address_validation_enabled, status) VALUES (?, ?, 'quote_funnel', 'life', 'Headline', ?, 'button', 0, 'active')",
    )
    .run(
      publicId,
      `Section ${publicId.slice(-4)}`,
      JSON.stringify({
        components: [
          {
            type: "TwoButtonYesNo",
            question_id: "q1",
            question_key: "k",
            internal_field: "f",
            answer_type: "boolean",
          },
        ],
      }),
    );
  const row = sdb.prepare("SELECT id FROM leadgen_sections WHERE public_id = ?").get(publicId) as {
    id: number;
  };
  return { id: row.id };
}

// Quote (→ active funnel + control variant) + one section + ROOT activation on
// site-1, through the REAL admin API (leadgen-runtime-api.test.ts pattern).
async function seedActivatedFunnel(env: Env, sdb: SqliteDb): Promise<{ variantId: string }> {
  const createRes = await admin.request(
    `${API}/quotes`,
    jsonInit("POST", { quote_name: "Branding Quote", activity: "quote_funnel", verticals: ["life"] }),
    env,
  );
  expect(createRes.status, `create quote: ${await createRes.clone().text()}`).toBe(201);
  const quote = (await createRes.json()) as {
    public_id: string;
    funnels: Array<{ public_id: string; variants: Array<{ public_id: string }> }>;
  };
  const variantId = quote.funnels[0]!.variants[0]!.public_id;

  const section = seedSection(sdb);
  const putRes = await admin.request(
    `${API}/variants/${variantId}`,
    jsonInit("PUT", { sections: [{ section_id: section.id }] }),
    env,
  );
  expect(putRes.status, `put sections: ${await putRes.clone().text()}`).toBe(200);

  const actRes = await admin.request(
    `${API}/quotes/${quote.public_id}/activation/site-1`,
    jsonInit("PUT", { enabled: true }),
    env,
  );
  expect(actRes.status, `activate: ${await actRes.clone().text()}`).toBe(200);

  return { variantId };
}

const EXPECTED_BRANDING = {
  site_name: "Acme Insure",
  logo_url: "/media/logos/acme.png",
  tagline: "Compare and save.",
  legal_links: [
    { label: "Contact", href: "/contact" },
    { label: "Privacy policy", href: "/privacy-policy" },
    { label: "Terms of use", href: "/terms" },
  ],
};

describeDb("resolver integration — the resolved bundle carries site_branding (§10.2)", () => {
  it("resolveActivatedFunnel + resolveActivatedFunnelByVariant both load the SAME site_branding for the resolved site_id", async () => {
    const sdb = createBrandingDb(ctor(), { withLeadgen: true });
    setSetting(sdb, "site-1", "site_name", "Acme Insure");
    setSetting(sdb, "site-1", "logo_media_id", "logos/acme.png");
    setSetting(sdb, "site-1", "tagline", "Compare and save.");
    setSetting(sdb, "site-1", "contact_email", "contact@one.example.com");
    setSetting(sdb, "site-1", "privacy_email", "privacy@one.example.com");
    const env = buildEnv(d1FromSqlite(sdb));
    const { variantId } = await seedActivatedFunnel(env, sdb);

    // Forward resolution (the cache-miss shell path).
    const resolved = await resolveActivatedFunnel(env, { site_id: "site-1" });
    expect(resolved).not.toBeNull();
    expect(resolved!.site_branding).toEqual(EXPECTED_BRANDING);

    // Reverse resolution (config/attempt/preview path) — consistent field.
    const byVariant = await resolveActivatedFunnelByVariant(env, "site-1", variantId);
    expect(byVariant).not.toBeNull();
    expect(byVariant!.site_branding).toEqual(EXPECTED_BRANDING);
    expect(byVariant!.site_branding).toEqual(resolved!.site_branding);
  });
});
