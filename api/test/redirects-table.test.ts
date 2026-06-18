// T15 — Wire the custom redirects table (checkRedirect -> 301).
//
// One behavioral claim, proven against the SHIPPED public router (not a source
// grep): every request is dispatched through `app.route("/", publicRouter)`
// exactly as the worker mounts it, so the assertions observe the real served
// response. The DB mock implements the redirects WHERE semantics (source_path
// match + is_active + site scoping) so the proof is behavioral, and it records
// every `articles` read so we can prove the redirect fires BEFORE the article
// lookup. Every it() title embeds the literal [api/test/redirects-table.test.ts]
// plus the L2 disambiguation marker so the parse_test_output evidence parser
// routes each receipt to its claim:
//   RC-029  ->  T15-AC1  (a redirects row produces a 301 to its target on
//                         /:slug, BEFORE the article lookup)

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

const TENANT_HOST = "tenant.example.com";
const ADMIN_HOST = "cms.kodigital.app";
const SITE_ID = "site_T15";
const OTHER_SITE_ID = "site_other";

const SITE_CONTEXT_ROW = {
  site_id: SITE_ID,
  hostname: TENANT_HOST,
  vertical_slug: "news",
  status: "active",
  content_version: 7,
  settings_version: 1,
};

interface RedirectFixture {
  source_path: string;
  destination_path: string;
  status_code: number;
  is_active: number;
  site_id: string | null;
}

interface ArticleFixture {
  slug: string;
  status: string;
}

interface DbStats {
  articleQueries: string[];
  redirectQueries: string[];
}

function makeKv(): KVNamespace {
  const store = new Map<string, { body: string; metadata: unknown }>();
  return {
    async get(key: string) {
      return store.get(key)?.body ?? null;
    },
    async put(key: string, value: string, opts?: KVNamespacePutOptions) {
      store.set(key, { body: value, metadata: opts?.metadata });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
    async getWithMetadata(key: string) {
      const e = store.get(key);
      if (!e) return { value: null, metadata: null, cacheStatus: null };
      return { value: e.body, metadata: e.metadata, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

// Content DB: resolves the tenant site, then serves the redirects lookup and
// the article lookup. The redirects branch faithfully mirrors the SQL the
// router issues — `WHERE source_path = ? AND is_active = 1 AND (site_id = ? OR
// site_id IS NULL) ORDER BY site_id IS NULL` — so the test exercises real
// matching/scoping/precedence, not a stubbed boolean. Pages always miss (null)
// so /:slug falls through to the article lookup when no redirect matches.
function makeDb(
  redirects: RedirectFixture[],
  articles: ArticleFixture[],
): { db: D1Database; stats: DbStats } {
  const stats: DbStats = { articleQueries: [], redirectQueries: [] };
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          captured = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.startsWith("SELECT s.id AS site_id")) {
            const host = String(captured[0] ?? "").toLowerCase();
            if (host !== TENANT_HOST) return null;
            return { ...SITE_CONTEXT_ROW } as unknown as T;
          }
          if (sql.startsWith("SELECT destination_path, status_code FROM redirects")) {
            const sourcePath = captured[0] as string;
            const siteId = captured[1] as string;
            stats.redirectQueries.push(sourcePath);
            const matches = redirects.filter(
              (r) =>
                r.source_path === sourcePath &&
                r.is_active === 1 &&
                (r.site_id === siteId || r.site_id === null),
            );
            // ORDER BY site_id IS NULL → site-specific (non-null) wins over global.
            matches.sort(
              (a, b) =>
                (a.site_id === null ? 1 : 0) - (b.site_id === null ? 1 : 0),
            );
            const hit = matches[0];
            if (!hit) return null;
            return {
              destination_path: hit.destination_path,
              status_code: hit.status_code,
            } as unknown as T;
          }
          if (sql.startsWith("SELECT id, slug, title, content_html, status")) {
            // fetchPublishedPage (servePage) — always a miss in these fixtures.
            return null;
          }
          if (sql.startsWith("SELECT * FROM articles WHERE slug")) {
            const slug = captured[0] as string;
            stats.articleQueries.push(slug);
            const hit = articles.find((a) => a.slug === slug);
            return (hit ? { ...hit } : null) as unknown as T | null;
          }
          return null;
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, stats };
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: makeKv(),
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST,
    ADMIN_BASE_URL: `https://${ADMIN_HOST}`,
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  };
}

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  app.route("/", publicRouter);
  return app;
}

// ---------------------------------------------------------------------------
// T15-AC1 (RC-029)
// ---------------------------------------------------------------------------
describe("T15-AC1 redirects table → 301 on /:slug before article lookup", () => {
  it("[api/test/redirects-table.test.ts] T15-AC1: a configured, active redirect row on /:slug produces a 301 to its destination_path L2_AUTO_DISAMBIGUATION:T15-AC1:RC-029", async () => {
    const { db } = makeDb(
      [
        {
          source_path: "/old-story",
          destination_path: "/article/new-story",
          status_code: 301,
          is_active: 1,
          site_id: SITE_ID,
        },
      ],
      [],
    );

    const res = await makeApp().request(
      `https://${TENANT_HOST}/old-story`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/article/new-story");
  });

  it("[api/test/redirects-table.test.ts] T15-AC1: the redirect fires BEFORE the article lookup — a matching redirect wins even when a published article occupies the same slug, and the articles table is never queried L2_AUTO_DISAMBIGUATION:T15-AC1:RC-029", async () => {
    // Same slug is BOTH a redirect source AND a live published article. If the
    // redirect were checked after the article lookup, the response would be the
    // canonical /article/<slug> 301; instead it must be the redirect's own
    // destination — and the articles read must never happen.
    const { db, stats } = makeDb(
      [
        {
          source_path: "/launch",
          destination_path: "/promo-2026",
          status_code: 301,
          is_active: 1,
          site_id: SITE_ID,
        },
      ],
      [{ slug: "launch", status: "published" }],
    );

    const res = await makeApp().request(
      `https://${TENANT_HOST}/launch`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(301);
    // The redirect destination, NOT the article-canonicalization /article/launch.
    expect(res.headers.get("Location")).toBe("/promo-2026");
    expect(res.headers.get("Location")).not.toBe("/article/launch");
    // Decisive proof of ordering: the article lookup was short-circuited.
    expect(stats.redirectQueries).toContain("/launch");
    expect(stats.articleQueries).toEqual([]);
  });

  it("[api/test/redirects-table.test.ts] T15-AC1: the stored status_code is honored — a 302 row issues a 302 (temporary), not a forced 301 L2_AUTO_DISAMBIGUATION:T15-AC1:RC-029", async () => {
    const { db } = makeDb(
      [
        {
          source_path: "/temp",
          destination_path: "/seasonal",
          status_code: 302,
          is_active: 1,
          site_id: SITE_ID,
        },
      ],
      [],
    );

    const res = await makeApp().request(
      `https://${TENANT_HOST}/temp`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/seasonal");
  });

  it("[api/test/redirects-table.test.ts] T15-AC1: an INACTIVE redirect row (is_active=0) does NOT fire — the request falls through to the normal article lookup L2_AUTO_DISAMBIGUATION:T15-AC1:RC-029", async () => {
    const { db, stats } = makeDb(
      [
        {
          source_path: "/retired",
          destination_path: "/somewhere",
          status_code: 301,
          is_active: 0,
          site_id: SITE_ID,
        },
      ],
      [{ slug: "retired", status: "published" }],
    );

    const res = await makeApp().request(
      `https://${TENANT_HOST}/retired`,
      {},
      makeEnv(db),
    );

    // The disabled redirect is ignored; the published article's canonical 301
    // wins instead, proving the row was filtered by is_active = 1.
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/article/retired");
    expect(stats.articleQueries).toContain("retired");
  });

  it("[api/test/redirects-table.test.ts] T15-AC1: a slug with no redirect row falls through to a styled 404 (the redirect path never hijacks ordinary requests) L2_AUTO_DISAMBIGUATION:T15-AC1:RC-029", async () => {
    const { db } = makeDb([], []);

    const res = await makeApp().request(
      `https://${TENANT_HOST}/nothing-here`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(res.headers.get("Location")).toBeNull();
  });

  it("[api/test/redirects-table.test.ts] T15-AC1: redirects are tenant-scoped — a row for a DIFFERENT site never fires, while a global (site_id NULL) row does, and a site-specific row wins over a global one L2_AUTO_DISAMBIGUATION:T15-AC1:RC-029", async () => {
    const { db: foreignDb, stats: foreignStats } = makeDb(
      [
        {
          source_path: "/scoped",
          destination_path: "/leaked",
          status_code: 301,
          is_active: 1,
          site_id: OTHER_SITE_ID,
        },
      ],
      [],
    );
    const foreign = await makeApp().request(
      `https://${TENANT_HOST}/scoped`,
      {},
      makeEnv(foreignDb),
    );
    // Another tenant's redirect MUST NOT leak onto this host.
    expect(foreign.status).toBe(404);
    expect(foreign.headers.get("Location")).toBeNull();
    expect(foreignStats.redirectQueries).toContain("/scoped");

    // A global redirect (site_id NULL) applies on this host.
    const { db: globalDb } = makeDb(
      [
        {
          source_path: "/legacy",
          destination_path: "/global-target",
          status_code: 301,
          is_active: 1,
          site_id: null,
        },
      ],
      [],
    );
    const global = await makeApp().request(
      `https://${TENANT_HOST}/legacy`,
      {},
      makeEnv(globalDb),
    );
    expect(global.status).toBe(301);
    expect(global.headers.get("Location")).toBe("/global-target");

    // When both a site-specific and a global row share a source_path, the
    // site-specific destination wins (ORDER BY site_id IS NULL).
    const { db: bothDb } = makeDb(
      [
        {
          source_path: "/dup",
          destination_path: "/global-dest",
          status_code: 301,
          is_active: 1,
          site_id: null,
        },
        {
          source_path: "/dup",
          destination_path: "/site-dest",
          status_code: 301,
          is_active: 1,
          site_id: SITE_ID,
        },
      ],
      [],
    );
    const both = await makeApp().request(
      `https://${TENANT_HOST}/dup`,
      {},
      makeEnv(bothDb),
    );
    expect(both.status).toBe(301);
    expect(both.headers.get("Location")).toBe("/site-dest");
  });
});
