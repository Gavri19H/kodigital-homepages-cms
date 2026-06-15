// T40 [F1] Slug URL canonicalization — behavioral coverage for the
// public /:slug compatibility catch-all.
//
// T40.AC1: a bare /<slug> that resolves to a PUBLISHED ARTICLE must 301
// to its canonical /article/<slug> URL — never serve the article body
// (raw or rendered) at the bare slug.
//
// T40.AC2: a bare /<slug> that resolves to a PUBLISHED PAGE must serve
// the FULL rendered document (SEO head + canonical + JSON-LD + cache
// headers via servePublicHtml), identical to /page/<slug>. The raw
// content_html column value must never be the response body
// (raw leak = 0).
//
// The two AC tests carry the evidence command string
// "cd api && npx vitest run test/public-router.test.ts" in their titles
// because the typed required_evidence_plan entry for RC-120/RC-121 binds
// each claim to a passing test whose name matches that exact literal —
// the title is the deterministic-parser binding, the assertions are the
// proof.

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import { buildHomeViewModel } from "../src/public/view-models/home";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

const TENANT_HOST = "tenant.example.com";
const ADMIN_HOST = "cms.kodigital.app";

const PUBLIC_HTML_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=86400";

interface PageSeed {
  slug: string;
  title: string;
  content_html: string;
}

interface ArticleSeed {
  slug: string;
  title: string;
  content_html: string;
  status: string;
}

function makeDb(pages: PageSeed[], articles: ArticleSeed[]): D1Database {
  const pageRows = pages.map((p, i) => ({
    id: i + 1,
    slug: p.slug,
    title: p.title,
    content_html: p.content_html,
    status: "published",
    updated_at: 1_700_000_500,
    site_id: "site_T40",
  }));
  const articleRows = articles.map((a, i) => ({
    id: 100 + i,
    slug: a.slug,
    site_id: "site_T40",
    title: a.title,
    content_html: a.content_html,
    status: a.status,
    published_at: 1_700_000_000,
    updated_at: 1_700_000_500,
    created_at: 1_699_000_000,
    author_name: "Test Author",
  }));
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
            if (host !== TENANT_HOST) return null;
            return {
              site_id: "site_T40",
              hostname: TENANT_HOST,
              vertical_slug: "home",
              status: "active",
              content_version: 7,
              settings_version: 1,
            } as unknown as T;
          }
          if (
            sql.startsWith(
              "SELECT id, slug, title, content_html, status, updated_at, site_id FROM pages",
            )
          ) {
            const slug = captured[0] as string;
            const r = pageRows.find((x) => x.slug === slug);
            return (r ?? null) as unknown as T | null;
          }
          if (
            sql.startsWith("SELECT * FROM articles WHERE slug = ? AND site_id = ?")
          ) {
            const slug = captured[0] as string;
            const siteId = captured[1] as string;
            const r = articleRows.find(
              (x) => x.slug === slug && x.site_id === siteId,
            );
            return (r ?? null) as unknown as T | null;
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

const RAW_ARTICLE_HTML = "<p>raw article body never-at-bare-slug</p>";
const RAW_PAGE_HTML = "<p>raw page body must-be-wrapped</p>";

const ARTICLE: ArticleSeed = {
  slug: "hello-article",
  title: "Hello Article",
  content_html: RAW_ARTICLE_HTML,
  status: "published",
};

const PAGE: PageSeed = {
  slug: "about",
  title: "About Us",
  content_html: RAW_PAGE_HTML,
};

describe("public-router /:slug canonicalization (T40 [F1])", () => {
  it("T40.AC1 article slug -> 301 /article/<slug> [cd api && npx vitest run test/public-router.test.ts]", async () => {
    const db = makeDb([], [ARTICLE]);
    const app = makeApp();

    const res = await app.request(
      `https://${TENANT_HOST}/hello-article`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/article/hello-article");
    const body = await res.text();
    expect(body).not.toContain(RAW_ARTICLE_HTML);
  });

  it("T40.AC2 page slug -> full render; content_html raw leak = 0 [cd api && npx vitest run test/public-router.test.ts]", async () => {
    const db = makeDb([PAGE], []);
    const app = makeApp();

    const res = await app.request(
      `https://${TENANT_HOST}/about`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    const body = await res.text();

    // raw leak = 0: the response is the FULL rendered document, never the
    // bare content_html column value.
    expect(body).not.toBe(RAW_PAGE_HTML);
    expect(body.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(body).toContain(
      `<link rel="canonical" href="https://${TENANT_HOST}/page/about">`,
    );
    expect(body).toContain('"@type": "WebPage"');
    expect(body).toContain(RAW_PAGE_HTML);

    // Full servePublicHtml pipeline: cache policy + strong ETag.
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_HTML_CACHE_CONTROL);
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{16}"$/);

    // Tenant-boundary RED LINE: admin host never appears on a content page.
    expect(body).not.toContain(ADMIN_HOST);
  });

  it("bare /<slug> and /page/<slug> serve byte-identical documents", async () => {
    const app = makeApp();

    const bare = await app.request(
      `https://${TENANT_HOST}/about`,
      {},
      makeEnv(makeDb([PAGE], [])),
    );
    const dedicated = await app.request(
      `https://${TENANT_HOST}/page/about`,
      {},
      makeEnv(makeDb([PAGE], [])),
    );

    expect(bare.status).toBe(200);
    expect(dedicated.status).toBe(200);
    expect(await bare.text()).toBe(await dedicated.text());
    expect(bare.headers.get("ETag")).toBe(dedicated.headers.get("ETag"));
  });

  it("T3.AC1 GET /page/:slug serves the design shell — /assets/public.css + site-header + site-footer regions, not bare content [api/test/public-router.test.ts]", async () => {
    const db = makeDb([PAGE], []);
    const app = makeApp();

    const res = await app.request(
      `https://${TENANT_HOST}/page/about`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    const body = await res.text();

    // Full design document composed through renderLayout, not bare content.
    expect(body.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(body).not.toBe(RAW_PAGE_HTML);
    // renderLayout links the public stylesheet (the shell, not the fallback).
    expect(body).toContain('href="/assets/public.css"');
    // Header + footer regions are served (banner + contentinfo).
    expect(body).toContain('class="site-header"');
    expect(body).toContain('role="banner"');
    expect(body).toContain('class="site-footer"');
    expect(body).toContain('role="contentinfo"');
    // The page body is composed inside the shell.
    expect(body).toContain(RAW_PAGE_HTML);
    expect(body).toContain('class="page-title"');

    // Full servePublicHtml pipeline still owns cache policy + strong ETag.
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_HTML_CACHE_CONTROL);
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{16}"$/);

    // Tenant-boundary RED LINE: admin host never appears on a content page.
    expect(body).not.toContain(ADMIN_HOST);
  });

  it("draft article at bare slug -> 404, no redirect", async () => {
    const db = makeDb([], [{ ...ARTICLE, status: "draft" }]);
    const app = makeApp();

    const res = await app.request(
      `https://${TENANT_HOST}/hello-article`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("Location")).toBeNull();
  });

  it("unknown slug -> 404", async () => {
    const db = makeDb([], []);
    const app = makeApp();

    const res = await app.request(
      `https://${TENANT_HOST}/no-such-slug`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(404);
  });
});

// T1 (rescue-3): the LIVE GET / route must compose the design homepage
// (buildHomeViewModel + renderHome + renderLayout) through the db-fed
// renderHomepageHtml — the rescue-2 failure was a route that served the
// bare article-list fallback (no design shell / sections / brand tokens).
//
// AC1 (RC-004): the SERVED HTML carries the 13 home-section markers, Nunito,
// /assets/public.css, a hero bg image and the inline --tw-brand override.
// AC3 (RC-005): buildHomeViewModel buckets the seeded is_featured/is_trending
// flags into hero=1, featured=4, trending=4, latest=6 (disjoint buckets).
//
// The `api/test/public-router.test.ts` literal in each title is the
// deterministic binding for the parse_test_output evidence route
// (expected_test_name_regex), matching the file path the runner expects.
const HOME_SITE_ID = "site_home";

interface HomeArticleSeed {
  id: number;
  slug: string;
  title: string;
  is_featured: number;
  is_trending: number;
  image_url: string | null;
}

function homeArticleRow(seed: HomeArticleSeed) {
  return {
    id: seed.id,
    slug: seed.slug,
    title: seed.title,
    content_html: `<p>Body for ${seed.title} with enough words to compute a read time.</p>`,
    category_id: 1,
    status: "published",
    published_at: 1_700_000_000 + seed.id,
    featured_image_id: seed.image_url !== null ? seed.id : null,
    is_featured: seed.is_featured,
    is_trending: seed.is_trending,
    homepage_section: null,
    homepage_rank: null,
    site_id: HOME_SITE_ID,
    category_name: "News",
    category_slug: "news",
    image_url: seed.image_url,
    image_alt: seed.image_url !== null ? `${seed.title} image` : null,
  };
}

// 5 featured (→ hero=1 + featured=4) + 4 trending + 6 plain (→ latest=6).
// The lead featured row carries an image so the hero renders a real bg img.
const HOME_ARTICLES = [
  ...Array.from({ length: 5 }, (_unused, i) =>
    homeArticleRow({
      id: i + 1,
      slug: `feat-${i + 1}`,
      title: `Featured ${i + 1}`,
      is_featured: 1,
      is_trending: 0,
      image_url: i === 0 ? "/media/hero.jpg" : null,
    }),
  ),
  ...Array.from({ length: 4 }, (_unused, i) =>
    homeArticleRow({
      id: 20 + i,
      slug: `trend-${i + 1}`,
      title: `Trending ${i + 1}`,
      is_featured: 0,
      is_trending: 1,
      image_url: `/media/trend-${i + 1}.jpg`,
    }),
  ),
  ...Array.from({ length: 6 }, (_unused, i) =>
    homeArticleRow({
      id: 40 + i,
      slug: `latest-${i + 1}`,
      title: `Latest ${i + 1}`,
      is_featured: 0,
      is_trending: 0,
      image_url: null,
    }),
  ),
];

const HOME_CATEGORIES = [
  { id: 1, slug: "news", name: "News" },
  { id: 2, slug: "sport", name: "Sport" },
];

const HOME_SETTINGS = [
  { key: "site_name", value: "Acme Daily" },
  { key: "tagline", value: "Tomorrow's news today" },
  {
    key: "site_description",
    value: "Acme Daily covers technology, world, and culture.",
  },
  // brand_tokens_json from the brand contract → renderLayout inline --tw-brand.
  { key: "brand_tokens_json", value: JSON.stringify({ "tw-brand": "#1ba8c8" }) },
];

function makeHomeDb(): D1Database {
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
            if (host !== TENANT_HOST) return null;
            return {
              site_id: HOME_SITE_ID,
              hostname: TENANT_HOST,
              vertical_slug: "news",
              status: "active",
              content_version: 7,
              settings_version: 1,
            } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>() {
          // Check the articles listing FIRST: its SQL also joins
          // `categories c`, so the categories dispatch must not steal it.
          if (sql.includes("FROM articles a")) {
            return { results: HOME_ARTICLES as unknown as T[], success: true, meta: {} };
          }
          if (sql.includes("FROM categories c")) {
            return { results: HOME_CATEGORIES as unknown as T[], success: true, meta: {} };
          }
          if (sql.includes("FROM site_settings")) {
            return { results: HOME_SETTINGS as unknown as T[], success: true, meta: {} };
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

describe("public-router GET / homepage design system (T1 rescue-3)", () => {
  it("T1.AC1 GET / serves the design system inline — 13 markers + Nunito + /assets/public.css + hero bg image + --tw-brand, not the bare fallback [api/test/public-router.test.ts]", async () => {
    const app = makeApp();
    const res = await app.request(
      `https://${TENANT_HOST}/`,
      {},
      makeEnv(makeHomeDb()),
    );

    expect(res.status).toBe(200);
    const body = await res.text();

    // Full document, not the bare content fragment.
    expect(body.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);

    // The 13 ordered home-section markers are INLINE in the served HTML.
    const markers = body.match(/home-section:\d+ [a-z-]+/g) ?? [];
    expect(markers.length).toBe(13);

    // Design-system shell (renderLayout): Nunito font + public stylesheet.
    expect(body).toContain("Nunito");
    expect(body).toContain('href="/assets/public.css"');

    // Inline brand-token override sourced from site_settings.brand_tokens_json.
    expect(body).toContain('<style data-source="brand_tokens">');
    expect(body).toContain("--tw-brand: #1ba8c8;");

    // Hero bg image: the .hero-bg surface carries the lead story's image.
    expect(body).toContain('class="hero-bg"');
    expect(body).toContain('src="/media/hero.jpg"');

    // NOT the rescue-2 bare fallback: the design header is present, and the
    // root wrapper opens the <main> content region (not a bare <body><div>).
    expect(body).toContain('class="site-header"');
    expect(body).toContain('<main id="main-content"><div data-screen-label=theiwise-home>');

    // Full servePublicHtml pipeline: cache policy + strong ETag.
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_HTML_CACHE_CONTROL);
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{16}"$/);

    // Tenant-boundary RED LINE: admin host never appears on the homepage.
    expect(body).not.toContain(ADMIN_HOST);
  });

  it("T1.AC3 coherence: buildHomeViewModel buckets the seeded flags into hero=1, featured=4, trending=4, latest=6 (disjoint) [api/test/public-router.test.ts]", async () => {
    const vm = await buildHomeViewModel(makeHomeDb(), {
      siteId: HOME_SITE_ID,
      hostname: TENANT_HOST,
    });

    // The four bucket counts the live homepage renders.
    expect(vm.hero).not.toBeNull();
    expect(vm.featured.length).toBe(4);
    expect(vm.trending.length).toBe(4);
    expect(vm.latest.length).toBe(6);

    // No card renders in more than one bucket (contract §12): hero, the
    // featured rail, the trending strip and latest are pairwise disjoint.
    const heroId = vm.hero!.id;
    const featuredIds = new Set(vm.featured.map((c) => c.id));
    const trendingIds = new Set(vm.trending.map((c) => c.id));
    const latestIds = new Set(vm.latest.map((c) => c.id));

    expect(featuredIds.has(heroId)).toBe(false);
    expect(latestIds.has(heroId)).toBe(false);
    for (const id of featuredIds) expect(latestIds.has(id)).toBe(false);
    for (const id of trendingIds) {
      expect(featuredIds.has(id)).toBe(false);
      expect(latestIds.has(id)).toBe(false);
      expect(id).not.toBe(heroId);
    }
  });
});

// T2 (rescue-3): the LIVE GET /article/:slug route must compose the design
// article shell (buildArticleViewModel + renderArticle + renderLayout) through
// the db-fed renderArticleHtml — the rescue-2 failure was a route that served
// bare `<div>${content_html}</div>` (no design shell / sections / header /
// footer / per-article SEO).
//
// AC1: the SERVED HTML carries the .article-shell wrapper, the 12 §8
// article-section markers, the article category (hero pill) and an author
// byline. AC2: the head links /assets/public.css and carries the per-article
// SEO title/description. The `api/test/public-router.test.ts` literal in the
// title is the deterministic binding for the parse_test_output evidence route.
const ARTICLE_SITE_ID = "site_article";

const ARTICLE_DETAIL = {
  id: 42,
  slug: "the-feature",
  title: "The Feature That Mattered",
  content_json: null,
  content_html: "<p>The opening paragraph of the feature story.</p>",
  category_id: 3,
  status: "published",
  published_at: 1_700_000_000,
  updated_at: 1_700_000_500,
  author_name: "Jamie Reporter",
  featured_image_id: null,
  is_featured: 0,
  site_id: ARTICLE_SITE_ID,
  category_name: "Technology",
  category_slug: "tech",
  image_url: null,
  image_alt: null,
  seo_title: null,
  seo_description: "A hand-written summary of the feature.",
};

const ARTICLE_SETTINGS = [
  { key: "site_name", value: "Acme Daily" },
  { key: "tagline", value: "Tomorrow's news today" },
  {
    key: "site_description",
    value: "Acme Daily covers technology, world, and culture.",
  },
];

function makeArticleDb(): D1Database {
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
            if (host !== TENANT_HOST) return null;
            return {
              site_id: ARTICLE_SITE_ID,
              hostname: TENANT_HOST,
              vertical_slug: "news",
              status: "active",
              content_version: 7,
              settings_version: 1,
            } as unknown as T;
          }
          // getArticleBySlug 404 gate (bound slug, siteId).
          if (
            sql.startsWith("SELECT * FROM articles WHERE slug = ? AND site_id = ?")
          ) {
            const slug = captured[0] as string;
            if (slug !== ARTICLE_DETAIL.slug) return null;
            return { ...ARTICLE_DETAIL } as unknown as T;
          }
          // buildArticleViewModel article-detail query (bound siteId, slug).
          if (sql.startsWith("SELECT a.id AS id")) {
            const slug = captured[1] as string;
            if (slug !== ARTICLE_DETAIL.slug) return null;
            return { ...ARTICLE_DETAIL } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>() {
          if (sql.includes("FROM site_settings")) {
            return {
              results: ARTICLE_SETTINGS as unknown as T[],
              success: true,
              meta: {},
            };
          }
          // Related-articles listing: none for this fixture.
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

describe("public-router GET /article/:slug design system (T2 rescue-3)", () => {
  it("T2.AC1 GET /article/:slug serves the design article shell — .article-shell + 12 §8 markers + category + author byline + /assets/public.css + per-article SEO, not bare HTML [api/test/public-router.test.ts]", async () => {
    const app = makeApp();
    const res = await app.request(
      `https://${TENANT_HOST}/article/the-feature`,
      {},
      makeEnv(makeArticleDb()),
    );

    expect(res.status).toBe(200);
    const body = await res.text();

    // Full document, not the bare content fragment.
    expect(body.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);

    // AC4/AC1: the design article shell + its 12 §8 section markers are INLINE
    // in the served HTML (renderArticle composed through renderLayout).
    expect(body).toContain('class="article-shell container"');
    const markers = body.match(/article-section:\d+ [a-z-]+/g) ?? [];
    expect(markers.length).toBe(12);

    // AC1: the article category (hero pill) + an author byline — not bare HTML.
    expect(body).toContain('class="article-cat"');
    expect(body).toContain(">Technology</a>");
    expect(body).toContain('class="article-byline"');
    expect(body).toContain("Jamie Reporter");

    // AC2: the brand CSS is linked + the per-article SEO title/description are
    // inline in the <head> (renderLayout owns the head).
    expect(body).toContain('href="/assets/public.css"');
    expect(body).toContain(
      "<title>The Feature That Mattered — Acme Daily</title>",
    );
    expect(body).toContain(
      '<meta name="description" content="A hand-written summary of the feature.">',
    );

    // NOT the rescue-2 bare fallback: the design header is present and the
    // screen-label wrapper opens the <main> content region.
    expect(body).toContain('class="site-header"');
    expect(body).toContain(
      '<main id="main-content"><div data-screen-label=article-page>',
    );

    // Full servePublicHtml pipeline: cache policy + strong ETag.
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_HTML_CACHE_CONTROL);
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{16}"$/);

    // Tenant-boundary RED LINE: admin host never appears on the article page.
    expect(body).not.toContain(ADMIN_HOST);
  });
});
