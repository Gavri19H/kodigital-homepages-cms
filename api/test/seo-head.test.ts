// T13 — Wire the full SEO head (renderSeoHead).
//
// Defect (BCL-055): renderSeoHead existed but was DEAD — the live <head>
// (templates/layout.ts) emitted only title/description/og:site_name/og:title/
// og:description (+optional image/canonical). No robots, og:type/url,
// twitter:*, or article:*. renderLayout now delegates the SEO meta block to
// renderSeoHead, so the complete search/social tag set flows through the LIVE
// route.
//
// Both claims are proven against the SHIPPED render path — a real Hono request
// through the public router (middleware -> renderArticleHtml/renderCategoryHtml
// -> renderLayout -> renderSeoHead) with a fake D1 — NOT a synthetic helper
// call or a source grep. Every it() title embeds the literal
// [api/test/seo-head.test.ts] plus the L2 disambiguation marker so the
// parse_test_output evidence parser routes each receipt to its claim:
//   RC-025  ->  T13-AC1  (an article render's head: twitter:card +
//                         og:type=article + article:published_time + canonical)
//   RC-026  ->  T13-AC2  (paginated category pages: noindex,follow + prev/next)

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";
import { PUBLIC_PAGE_SIZE } from "../src/public/queries";

const TENANT_HOST = "tenant-a.example";
const SITE_ID = "site_A";
const ADMIN_HOST = "cms.kodigital.app";

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

// A full page of published articles in the "news" category so the category
// render emits a rel=next link (articles.length >= PUBLIC_PAGE_SIZE).
function makeCategoryRows(): ArticleSeed[] {
  const rows: ArticleSeed[] = [];
  for (let i = 0; i < PUBLIC_PAGE_SIZE; i++) {
    rows.push({
      id: 100 + i,
      slug: `news-${i}`,
      site_id: SITE_ID,
      title: `News story ${i}`,
      content_html: "<p>Body.</p>",
      status: "published",
      published_at: 1_700_000_000 - i,
      updated_at: 1_700_000_500 - i,
      created_at: 1_699_000_000 - i,
      author_name: "Desk",
    });
  }
  return rows;
}

function makeDb(article: ArticleSeed, categoryRows: ArticleSeed[]): D1Database {
  return {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          captured = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          // Domain -> site resolution (public middleware).
          if (sql.startsWith("SELECT s.id AS site_id")) {
            const host = String(captured[0] ?? "").toLowerCase();
            if (host !== TENANT_HOST) return null;
            return {
              site_id: SITE_ID,
              hostname: TENANT_HOST,
              vertical_slug: "home",
              status: "active",
              content_version: 3,
              settings_version: 1,
            } as unknown as T;
          }
          // getArticleBySlug 404 gate.
          if (sql.startsWith("SELECT * FROM articles WHERE slug = ? AND site_id = ?")) {
            const slug = captured[0] as string;
            const siteId = captured[1] as string;
            return (slug === article.slug && siteId === article.site_id
              ? article
              : null) as unknown as T | null;
          }
          // fetchCategory (category route).
          if (sql.startsWith("SELECT id, slug, name FROM categories")) {
            const slug = captured[0] as string;
            return (slug === "news"
              ? { id: 5, slug: "news", name: "News" }
              : null) as unknown as T | null;
          }
          // buildArticleViewModel article-detail row (joins categories + media).
          if (sql.startsWith("SELECT a.id AS id")) {
            const siteId = captured[0] as string;
            const slug = captured[1] as string;
            if (slug !== article.slug || siteId !== article.site_id) return null;
            return {
              id: article.id,
              slug: article.slug,
              title: article.title,
              content_json: null,
              content_html: article.content_html,
              category_id: 5,
              status: article.status,
              published_at: article.published_at,
              updated_at: article.updated_at,
              author_name: article.author_name,
              featured_image_id: null,
              is_featured: 0,
              site_id: article.site_id,
              category_name: "News",
              category_slug: "news",
              image_url: null,
              image_alt: null,
              seo_title: null,
              seo_description: null,
            } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>() {
          // fetchCategoryArticles: a full page so the next-link is emitted.
          if (
            sql.startsWith("SELECT * FROM articles WHERE category_id = ?") &&
            sql.includes("ORDER BY published_at")
          ) {
            return {
              results: categoryRows as unknown as T[],
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
    ADMIN_HOST: ADMIN_HOST,
    ADMIN_BASE_URL: `https://${ADMIN_HOST}`,
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

const ARTICLE: ArticleSeed = {
  id: 1,
  slug: "first-post",
  site_id: SITE_ID,
  title: "First Post",
  content_html: "<p>Article body.</p>",
  status: "published",
  published_at: 1_700_000_000,
  updated_at: 1_700_000_500,
  created_at: 1_699_000_000,
  author_name: "Test Author",
};

async function render(path: string): Promise<{ status: number; body: string }> {
  const db = makeDb(ARTICLE, makeCategoryRows());
  const res = await makeApp().request(
    `https://${TENANT_HOST}${path}`,
    {},
    makeEnv(db),
  );
  return { status: res.status, body: await res.text() };
}

describe("T13 full SEO head — article render (RC-025 / T13-AC1)", () => {
  it("[api/test/seo-head.test.ts] T13-AC1: article head carries twitter:card + og:type=article + article:published_time + canonical L2_AUTO_DISAMBIGUATION:T13-AC1:RC-025", async () => {
    const { status, body } = await render("/article/first-post");
    expect(status).toBe(200);

    // og:type=article — proves renderArticleHtml forwarded ogType through the
    // newly-wired head (default would have been "website").
    expect(body).toContain('<meta property="og:type" content="article">');
    // article:published_time — the article:* namespace only renders because
    // ogType is "article"; the ISO timestamp comes from the article row.
    expect(body).toMatch(
      /<meta property="article:published_time" content="20[0-9]{2}-[^"]+">/,
    );
    // twitter:card — wholly absent from the legacy hand-rolled head.
    expect(body).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    );
    // canonical — tenant host, never the admin host (mission RED LINE).
    expect(body).toContain(
      `<link rel="canonical" href="https://${TENANT_HOST}/article/first-post">`,
    );
    // robots + og:url are now present too (previously missing entirely).
    expect(body).toContain('<meta name="robots" content="index, follow">');
    expect(body).toContain(
      `<meta property="og:url" content="https://${TENANT_HOST}/article/first-post">`,
    );
    expect(body).not.toMatch(/cms\.kodigital\.app/);
  });
});

describe("T13 full SEO head — paginated category (RC-026 / T13-AC2)", () => {
  it("[api/test/seo-head.test.ts] T13-AC2: /category/news/page/2 emits noindex,follow + rel=prev/next L2_AUTO_DISAMBIGUATION:T13-AC2:RC-026", async () => {
    const { status, body } = await render("/category/news/page/2");
    expect(status).toBe(200);

    // Paginated page (page >= 2) is noindex,follow — the page-1 canonical owns
    // the index entry; the crawler still follows the article links.
    expect(body).toContain('<meta name="robots" content="noindex, follow">');
    // rel=prev points back at page 1 in its bare /category/<slug> canonical
    // shape; rel=next walks forward (the seeded page is full).
    expect(body).toContain(
      `<link rel="prev" href="https://${TENANT_HOST}/category/news">`,
    );
    expect(body).toContain(
      `<link rel="next" href="https://${TENANT_HOST}/category/news/page/3">`,
    );
    // The page-1 canonical is preserved (no duplicate-content signal) and the
    // admin host never appears.
    expect(body).toContain(
      `<link rel="canonical" href="https://${TENANT_HOST}/category/news">`,
    );
    expect(body).not.toMatch(/cms\.kodigital\.app/);
  });

  it("[api/test/seo-head.test.ts] T13-AC2: page 1 stays index,follow with a next link and no prev L2_AUTO_DISAMBIGUATION:T13-AC2:RC-026", async () => {
    const { status, body } = await render("/category/news");
    expect(status).toBe(200);
    // Page 1 is indexable; only a forward link (no rel=prev on the first page).
    expect(body).toContain('<meta name="robots" content="index, follow">');
    expect(body).toContain(
      `<link rel="next" href="https://${TENANT_HOST}/category/news/page/2">`,
    );
    expect(body).not.toContain('<link rel="prev"');
  });
});
