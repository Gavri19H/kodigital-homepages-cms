import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

// T11-AC5: canonical-host tenant-boundary discipline for the public router.
//
// RED LINE (proposal §"Tenant boundary"): the CMS admin host
// (cms.kodigital.app) MUST NEVER appear as a canonical href, og:url, or
// any other tenant-facing URL on a public content page. This test pins
// the contract by exercising the homepage / article / page / category
// handlers and asserting:
//   - canonical href = "https://{request-hostname}{path}"  (NOT admin host)
//   - schema.org JSON-LD url field = same canonical URL    (NOT admin host)
//   - admin host substring never appears anywhere in the response body
//
// The fixture seeds a tenant on `tenant-a.example` with one article + one
// page + one category and asserts the canonical/og URLs are all
// `https://tenant-a.example/...` — never `https://cms.kodigital.app/...`.

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

interface PageSeed {
  id: number;
  slug: string;
  site_id: string | null;
  title: string;
  content_html: string;
  status: string;
  updated_at: number;
}

interface CategorySeed {
  id: number;
  slug: string;
  name: string;
}

interface DomainSeed {
  hostname: string;
  site_id: string;
  vertical_slug: string;
}

function makeDb(
  domains: DomainSeed[],
  articles: ArticleSeed[],
  pages: PageSeed[],
  categories: CategorySeed[],
): D1Database {
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
              content_version: 3,
              settings_version: 1,
            } as unknown as T;
          }
          if (sql.startsWith("SELECT * FROM articles WHERE slug = ? AND site_id = ?")) {
            const slug = captured[0] as string;
            const siteId = captured[1] as string;
            return (articles.find(
              (x) => x.slug === slug && x.site_id === siteId,
            ) ?? null) as unknown as T | null;
          }
          if (sql.startsWith("SELECT id, slug, title, content_html, status, updated_at, site_id FROM pages")) {
            const slug = captured[0] as string;
            const siteId = captured[1] as string;
            return (pages.find(
              (p) =>
                p.slug === slug &&
                p.status === "published" &&
                (p.site_id === siteId || p.site_id === null),
            ) ?? null) as unknown as T | null;
          }
          if (sql.startsWith("SELECT id, slug, name FROM categories")) {
            const slug = captured[0] as string;
            return (categories.find((c) => c.slug === slug) ??
              null) as unknown as T | null;
          }
          // T2 (rescue-3): renderArticleHtml composes buildArticleViewModel,
          // whose article-detail query (bound siteId, slug) joins categories +
          // media. Serve the seeded article as the detail row so the live
          // /article render resolves through the design shell.
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
          if (sql.startsWith("SELECT * FROM articles WHERE site_id = ?") ||
              sql.startsWith("SELECT * FROM articles WHERE status = ? AND site_id = ?") ||
              sql.includes("SELECT * FROM articles") && sql.includes("ORDER BY published_at")) {
            const filtered = articles.filter(
              (a) => captured.includes(a.site_id) || captured.includes(a.status),
            );
            return {
              results: filtered as unknown as T[],
              success: true,
              meta: {},
            };
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
  };
}

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  app.route("/", publicRouter);
  return app;
}

describe("router canonical-host tenant-boundary (T11-AC5)", () => {
  const domains: DomainSeed[] = [
    { hostname: "tenant-a.example", site_id: "site_A", vertical_slug: "home" },
  ];
  const articles: ArticleSeed[] = [
    {
      id: 1,
      slug: "first-post",
      site_id: "site_A",
      title: "First Post",
      content_html: "<p>Article body.</p>",
      status: "published",
      published_at: 1_700_000_000,
      updated_at: 1_700_000_500,
      created_at: 1_699_000_000,
      author_name: "Test Author",
    },
  ];
  const pages: PageSeed[] = [
    {
      id: 10,
      slug: "about",
      site_id: "site_A",
      title: "About",
      content_html: "<p>About page body.</p>",
      status: "published",
      updated_at: 1_700_000_700,
    },
  ];
  const categories: CategorySeed[] = [
    { id: 5, slug: "news", name: "News" },
  ];

  it("homepage canonical href + JSON-LD url use the tenant hostname, not the admin host", async () => {
    const db = makeDb(domains, articles, pages, categories);
    const res = await makeApp().request(
      "https://tenant-a.example/",
      {},
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      '<link rel="canonical" href="https://tenant-a.example/">',
    );
    expect(body).toContain('"url": "https://tenant-a.example/"');
    expect(body).not.toMatch(/cms\.kodigital\.app/);
  });

  it("article canonical href + JSON-LD url use the tenant hostname", async () => {
    const db = makeDb(domains, articles, pages, categories);
    const res = await makeApp().request(
      "https://tenant-a.example/article/first-post",
      {},
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      '<link rel="canonical" href="https://tenant-a.example/article/first-post">',
    );
    expect(body).toContain(
      '"@id": "https://tenant-a.example/article/first-post"',
    );
    expect(body).not.toMatch(/cms\.kodigital\.app/);
  });

  it("page canonical href + WebPage JSON-LD url use the tenant hostname", async () => {
    const db = makeDb(domains, articles, pages, categories);
    const res = await makeApp().request(
      "https://tenant-a.example/page/about",
      {},
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      '<link rel="canonical" href="https://tenant-a.example/page/about">',
    );
    expect(body).toContain('"@type": "WebPage"');
    expect(body).toContain('"url": "https://tenant-a.example/page/about"');
    expect(body).not.toMatch(/cms\.kodigital\.app/);
  });

  it("category canonical href + CollectionPage JSON-LD url use the tenant hostname", async () => {
    const db = makeDb(domains, articles, pages, categories);
    const res = await makeApp().request(
      "https://tenant-a.example/category/news",
      {},
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      '<link rel="canonical" href="https://tenant-a.example/category/news">',
    );
    expect(body).toContain('"@type": "CollectionPage"');
    expect(body).toContain('"url": "https://tenant-a.example/category/news"');
    expect(body).not.toMatch(/cms\.kodigital\.app/);
  });

  it("paginated category page /page/2 canonicals back to page 1 (no duplicate-content signal)", async () => {
    const db = makeDb(domains, articles, pages, categories);
    const res = await makeApp().request(
      "https://tenant-a.example/category/news/page/2",
      {},
      makeEnv(db),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(
      '<link rel="canonical" href="https://tenant-a.example/category/news">',
    );
    expect(body).not.toContain(
      '<link rel="canonical" href="https://tenant-a.example/category/news/page/2">',
    );
    expect(body).not.toMatch(/cms\.kodigital\.app/);
  });
});
