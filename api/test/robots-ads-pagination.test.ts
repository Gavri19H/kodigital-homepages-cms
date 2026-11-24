import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";
import {
  fetchListing,
  PUBLIC_PAGE_SIZE,
} from "../src/public/queries";
import { d1FromSqlite } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb } from "./helpers/x06-a2-sqlite";

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
          if (sql.startsWith("SELECT key, value FROM site_settings")) {
            const rows = settings.filter((row) => row.site_id === captured[0] &&
              (row.key === "robots_txt_content" || row.key === "ai_block_training"));
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
    // rescue-6 (agent-readiness M1.1): default body states the Content Signals
    // preference (allow search + AI live-answer retrieval, decline AI training).
    expect(defBody).toContain("Content-Signal: search=yes, ai-input=yes, ai-train=no");

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
    const sqlite = createDb();
    try {
      addSite(sqlite, SITE_ID, "Journal", "travel");
      sqlite.prepare("INSERT INTO categories (id, slug, name) VALUES (501, 'notes', 'Notes')").run();
      const article = sqlite.prepare(
        "INSERT INTO articles (site_id, category_id, slug, title, content_json, status) VALUES (?, 501, ?, 'Story', '{}', 'published')",
      );
      for (let i = 0; i < 50; i++) article.run(SITE_ID, "story-" + i);
      const db = d1FromSqlite(sqlite);
      const listing = () => fetchListing(db, "category", SITE_ID, "notes", 1);
      const setSize = sqlite.prepare("INSERT OR REPLACE INTO site_settings (site_id, key, value) VALUES (?, 'items_per_page', ?)");

      const defaultPage = await listing();
      expect(defaultPage?.pageSize).toBe(PUBLIC_PAGE_SIZE);
      expect(defaultPage?.pageSize).toBe(20);
      expect(defaultPage?.articles).toHaveLength(20);

      setSize.run(SITE_ID, "12");
      const twelve = await listing();
      expect(twelve?.pageSize).toBe(12);
      expect(twelve?.articles).toHaveLength(12);
      expect(twelve?.articles.length).not.toBe(PUBLIC_PAGE_SIZE);

      for (const [raw, expected] of [
        ["0", PUBLIC_PAGE_SIZE], ["999", 100], ["abc", PUBLIC_PAGE_SIZE],
        ["9".repeat(310), PUBLIC_PAGE_SIZE], ["\u00a0+4e300", 4],
      ] as const) {
        setSize.run(SITE_ID, raw);
        expect((await listing())?.pageSize).toBe(expected);
      }
    } finally {
      sqlite.close();
    }
  });
});

// Small helper so each scenario gets a fresh KV (no cross-request cache hit).
async function app_request(path: string, db: D1Database): Promise<Response> {
  const app = makeApp();
  return app.request(`https://${HOSTNAME}${path}`, {}, makeEnv(db));
}
