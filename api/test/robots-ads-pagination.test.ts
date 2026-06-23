import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";
import {
  resolvePageSize,
  fetchCategoryArticles,
  PUBLIC_PAGE_SIZE,
} from "../src/public/queries";

// T27 (BCL-049) regression coverage.
//
// AC1 (RC-048): the admin writes `robots_txt_content`/`ads_txt_content`, but
//   the public router read `robots_txt`/`ads_txt`, so operator edits never
//   applied. Proof: a seeded `robots_txt_content` override now surfaces on
//   /robots.txt with {{DOMAIN}} substituted, and the default body carries the
//   required `Allow: /` + `Disallow: /api` directives.
// AC2 (RC-049): `items_per_page` was dead — listings hardcoded
//   PUBLIC_PAGE_SIZE=20. Proof: with items_per_page=12 the category list query
//   returns 12 rows (not 20); with no setting it falls back to the 20 default.

interface SettingSeed {
  site_id: string;
  key: string;
  value: string | null;
}

const HOSTNAME = "example.test";
const SITE_ID = "site_T27";
const SETTINGS_VERSION = 9;

// Public-router fake DB: resolves the tenant site context and the per-site
// site_settings rows the robots/ads handlers read. Mirrors the read shapes in
// robots-ads-cache.test.ts so the tenant-scoping grep stays accurate.
function makeRouterDb(settings: SettingSeed[]): D1Database {
  return {
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
            if (host !== HOSTNAME) return null;
            return {
              site_id: SITE_ID,
              hostname: HOSTNAME,
              vertical_slug: "home",
              status: "active",
              content_version: 2,
              settings_version: SETTINGS_VERSION,
            } as unknown as T;
          }
          if (sql.startsWith("SELECT value FROM site_settings")) {
            const siteId = String(captured[0] ?? "");
            const key = String(captured[1] ?? "");
            const row = settings.find(
              (s) => s.site_id === siteId && s.key === key,
            );
            if (!row) return null;
            return { value: row.value } as unknown as T;
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
}

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: makeKv(),
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  } as unknown as Env;
}

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  app.route("/", publicRouter);
  return app;
}

// Category-articles fake DB for AC2: returns the `items_per_page` setting and
// yields exactly `LIMIT` article rows (capped at a 50-row pool) so the list
// length is governed solely by the resolved page size that drives the LIMIT
// bind — proving the setting controls list length, not the hardcoded 20.
const ARTICLE_POOL = 50;

function makeListDb(itemsPerPage: string | null): D1Database {
  return {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          captured = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.startsWith("SELECT value FROM site_settings")) {
            const key = String(captured[1] ?? "");
            if (key === "items_per_page" && itemsPerPage !== null) {
              return { value: itemsPerPage } as unknown as T;
            }
            return null;
          }
          return null;
        },
        async all<T = unknown>() {
          // rescue-4 round-3 (issue 1): fetchCategoryArticles now LEFT JOINs
          // media for the card image, so the SQL is
          // `SELECT a.*, m.storage_key ... FROM articles a ... WHERE a.category_id = ?`.
          // Match the new shape (the bind order is unchanged:
          // captured[2]=limit, captured[3]=offset still hold).
          if (sql.includes("FROM articles") && sql.includes("category_id")) {
            const limit = Number(captured[2] ?? 0);
            const offset = Number(captured[3] ?? 0);
            const available = Math.max(0, ARTICLE_POOL - offset);
            const count = Math.max(0, Math.min(limit, available));
            const rows = Array.from({ length: count }, (_unused, i) => ({
              id: offset + i + 1,
              slug: `a-${offset + i + 1}`,
              title: `Article ${offset + i + 1}`,
              status: "published",
              image_url: null,
              image_alt: null,
            }));
            return { results: rows as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

describe("T27 robots.txt / ads.txt key-mismatch fix (RC-048)", () => {
  it("L2_AUTO_DISAMBIGUATION:T27-AC1:RC-048 — editing robots.txt in admin reaches live /robots.txt (robots_txt_content key aligned), {{DOMAIN}} is substituted, and the default body carries Allow:/ + Disallow:/api [api/test/robots-ads-pagination.test.ts]", async () => {
    // Operator edit applies + {{DOMAIN}} substituted with the live hostname.
    const override =
      "User-agent: *\nAllow: /\nSitemap: https://{{DOMAIN}}/sitemap.xml\n";
    const editDb = makeRouterDb([
      { site_id: SITE_ID, key: "robots_txt_content", value: override },
    ]);
    const edited = await app_request("/robots.txt", editDb);
    expect(edited.status).toBe(200);
    const editedBody = await edited.text();
    expect(editedBody).toContain(`Sitemap: https://${HOSTNAME}/sitemap.xml`);
    expect(editedBody).not.toContain("{{DOMAIN}}");

    // No override → the default body MUST allow the public surface and
    // disallow the JSON API (BCL-049 said the default omitted both).
    const defaultDb = makeRouterDb([]);
    const def = await app_request("/robots.txt", defaultDb);
    expect(def.status).toBe(200);
    const defBody = await def.text();
    expect(defBody).toContain("Allow: /");
    expect(defBody).toContain("Disallow: /api");
    expect(defBody).toContain("Disallow: /admin/");

    // /ads.txt reads the aligned ads_txt_content key too.
    const adsBody = "google.com, pub-7777, DIRECT, cafef00d\n";
    const adsDb = makeRouterDb([
      { site_id: SITE_ID, key: "ads_txt_content", value: adsBody },
    ]);
    const ads = await app_request("/ads.txt", adsDb);
    expect(ads.status).toBe(200);
    expect(await ads.text()).toBe(adsBody);
  });
});

describe("T27 items_per_page governs listing length (RC-049)", () => {
  it("L2_AUTO_DISAMBIGUATION:T27-AC2:RC-049 — items_per_page=12 makes a category list return 12 (not the hardcoded 20), and an unset setting falls back to the 20 default [api/test/robots-ads-pagination.test.ts]", async () => {
    // items_per_page=12 → resolved page size 12 → exactly 12 rows.
    const dbTwelve = makeListDb("12");
    const size12 = await resolvePageSize(dbTwelve, SITE_ID);
    expect(size12).toBe(12);
    const list12 = await fetchCategoryArticles(dbTwelve, 5, SITE_ID, 1, size12);
    expect(list12.length).toBe(12);
    expect(list12.length).not.toBe(PUBLIC_PAGE_SIZE);

    // Unset → fall back to PUBLIC_PAGE_SIZE (20).
    const dbDefault = makeListDb(null);
    const sizeDefault = await resolvePageSize(dbDefault, SITE_ID);
    expect(sizeDefault).toBe(PUBLIC_PAGE_SIZE);
    expect(sizeDefault).toBe(20);
    const listDefault = await fetchCategoryArticles(
      dbDefault,
      5,
      SITE_ID,
      1,
      sizeDefault,
    );
    expect(listDefault.length).toBe(20);

    // Out-of-range values clamp to the admin 1..100 control bounds.
    expect(await resolvePageSize(makeListDb("0"), SITE_ID)).toBe(PUBLIC_PAGE_SIZE);
    expect(await resolvePageSize(makeListDb("999"), SITE_ID)).toBe(100);
    expect(await resolvePageSize(makeListDb("abc"), SITE_ID)).toBe(PUBLIC_PAGE_SIZE);
  });
});

// Small helper so each scenario gets a fresh KV (no cross-request cache hit).
async function app_request(path: string, db: D1Database): Promise<Response> {
  const app = makeApp();
  return app.request(`https://${HOSTNAME}${path}`, {}, makeEnv(db));
}
