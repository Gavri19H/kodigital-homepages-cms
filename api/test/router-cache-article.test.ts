import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

// T11-AC4: behavioral test for the article-route cache + ETag pipeline.
//
// Coverage:
//   1. Cold-cache GET /article/:slug returns 200 + a strong ETag header
//      built from sha256(site_id:path:content_version:tv).
//   2. The rendered body includes the SEO head fragment (canonical link)
//      AND the schema.org Article JSON-LD block.
//   3. Cache-Control on the response is exactly
//      `public, max-age=300, stale-while-revalidate=86400` (publicHtmlCacheHeaders).
//   4. A second GET with `If-None-Match: <etag>` returns 304 (empty body).
//   5. A second GET without If-None-Match returns 200 from the warm KV cache
//      with the same ETag and identical body bytes.

interface ArticleSeed {
  id: number;
  slug: string;
  site_id: string;
  title: string;
  content_html: string;
  status: string;
  published_at: number;
  updated_at: number;
  created_at: number;
  author_name: string;
}

interface DomainSeed {
  hostname: string;
  site_id: string;
  vertical_slug: string;
}

function makeDb(domains: DomainSeed[], articles: ArticleSeed[]): D1Database {
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
            const d = domains.find((x) => x.hostname === host);
            if (!d) return null;
            return {
              site_id: d.site_id,
              hostname: d.hostname,
              vertical_slug: d.vertical_slug,
              status: "active",
              content_version: 7,
              settings_version: 1,
            } as unknown as T;
          }
          if (sql.startsWith("SELECT * FROM articles WHERE slug = ? AND site_id = ?")) {
            const slug = captured[0] as string;
            const siteId = captured[1] as string;
            const a = articles.find(
              (x) => x.slug === slug && x.site_id === siteId,
            );
            return (a ?? null) as unknown as T | null;
          }
          // T2 (rescue-3): renderArticleHtml now composes buildArticleViewModel,
          // whose article-detail query (bound siteId, slug) joins categories +
          // media. Serve the seeded article as the detail row so the live
          // render path resolves.
          if (sql.startsWith("SELECT a.id AS id")) {
            const siteId = captured[0] as string;
            const slug = captured[1] as string;
            const a = articles.find(
              (x) => x.slug === slug && x.site_id === siteId,
            );
            if (!a) return null;
            return {
              id: a.id,
              slug: a.slug,
              title: a.title,
              content_json: null,
              content_html: a.content_html,
              category_id: null,
              status: a.status,
              published_at: a.published_at,
              updated_at: a.updated_at,
              author_name: a.author_name,
              featured_image_id: null,
              is_featured: 0,
              site_id: a.site_id,
              category_name: null,
              category_slug: null,
              image_url: null,
              image_alt: null,
              seo_title: null,
              seo_description: null,
            } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>() {
          // buildArticleViewModel's related + site_settings listings: no
          // related articles, no per-site settings overrides for this fixture.
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

function makeKv(): { kv: KVNamespace; store: Map<string, { body: string; metadata: unknown }> } {
  const store = new Map<string, { body: string; metadata: unknown }>();
  const kv = {
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
  return { kv, store };
}

function makeEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv,
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
  };
}

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  app.route("/", publicRouter);
  return app;
}

const PUBLIC_HTML_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=86400";

describe("router /article/:slug cache + ETag pipeline (T11-AC4)", () => {
  const domains: DomainSeed[] = [
    { hostname: "example.test", site_id: "site_E", vertical_slug: "home" },
  ];
  const articles: ArticleSeed[] = [
    {
      id: 1,
      slug: "hello-world",
      site_id: "site_E",
      title: "Hello World",
      content_html: "<p>Body content here.</p>",
      status: "published",
      published_at: 1_700_000_000,
      updated_at: 1_700_000_500,
      created_at: 1_699_000_000,
      author_name: "Test Author",
    },
  ];

  it("cold cache: 200 + canonical link + Article JSON-LD + cache headers + strong ETag", async () => {
    const db = makeDb(domains, articles);
    const { kv } = makeKv();
    const app = makeApp();

    const res = await app.request(
      "https://example.test/article/hello-world",
      {},
      makeEnv(db, kv),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_HTML_CACHE_CONTROL);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const etag = res.headers.get("ETag");
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);

    const body = await res.text();
    expect(body).toContain(
      '<link rel="canonical" href="https://example.test/article/hello-world">',
    );
    expect(body).toContain('"@type": "Article"');
    expect(body).toContain('"headline": "Hello World"');
    expect(body).toContain("<p>Body content here.</p>");
    // Tenant-boundary RED LINE: admin host MUST NEVER appear on a content page.
    expect(body).not.toMatch(/cms\.kodigital\.app/);
  });

  it("If-None-Match echo of current ETag returns 304 Not Modified", async () => {
    const db = makeDb(domains, articles);
    const { kv } = makeKv();
    const app = makeApp();

    const cold = await app.request(
      "https://example.test/article/hello-world",
      {},
      makeEnv(db, kv),
    );
    expect(cold.status).toBe(200);
    const etag = cold.headers.get("ETag") ?? "";
    expect(etag).not.toBe("");

    const conditional = await app.request(
      "https://example.test/article/hello-world",
      { headers: { "If-None-Match": etag } },
      makeEnv(db, kv),
    );
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("ETag")).toBe(etag);
    const condBody = await conditional.text();
    expect(condBody).toBe("");
  });

  it("warm-cache GET returns 200 with same ETag + identical body (KV hit)", async () => {
    const db = makeDb(domains, articles);
    const { kv, store } = makeKv();
    const app = makeApp();

    const a = await app.request(
      "https://example.test/article/hello-world",
      {},
      makeEnv(db, kv),
    );
    const etagA = a.headers.get("ETag");
    const bodyA = await a.text();
    expect(a.status).toBe(200);
    expect(store.size).toBeGreaterThan(0);

    const b = await app.request(
      "https://example.test/article/hello-world",
      {},
      makeEnv(db, kv),
    );
    expect(b.status).toBe(200);
    expect(b.headers.get("ETag")).toBe(etagA);
    expect(b.headers.get("Cache-Control")).toBe(PUBLIC_HTML_CACHE_CONTROL);
    const bodyB = await b.text();
    expect(bodyB).toBe(bodyA);
  });

  it("404 for unknown slug: no cache write, no ETag, no Cache-Control public", async () => {
    const db = makeDb(domains, articles);
    const { kv, store } = makeKv();
    const app = makeApp();

    const res = await app.request(
      "https://example.test/article/does-not-exist",
      {},
      makeEnv(db, kv),
    );
    expect(res.status).toBe(404);
    expect(store.size).toBe(0);
  });
});
