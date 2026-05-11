// Public router: the 12 Phase-1 public routes (article/category/page/feeds/
// sitemap/robots/ads/preview/health) plus the /:slug compatibility catch-all.
// /:slug calls isReservedPath() FIRST so the admin slug never shadows the
// dedicated admin handler in api/src/index.ts (wired by T12).

import { Hono } from "hono";
import type { Env } from "../env";
import { listArticles, type ArticleRow } from "../db";
import { isReservedPath } from "./reserved";
import {
  renderRssFeed,
  renderAtomFeed,
  type FeedSiteInfo,
} from "./feeds";
import {
  renderSitemap,
  buildRobotsTxt,
  ADS_TXT_DEFAULT,
  type SitemapPageRow,
} from "./sitemap";
import {
  publicSiteContextMiddleware,
  type PublicSiteVariables,
} from "./middleware";

interface PageRow {
  id: number;
  slug: string;
  title: string;
  content_html: string | null;
  status: string;
  updated_at: number | null;
}

interface CategoryRow {
  id: number;
  slug: string;
  name: string;
}

const PAGE_SIZE = 20;

function siteInfo(env: Env): FeedSiteInfo {
  return {
    baseUrl: env.ADMIN_BASE_URL || "http://localhost:8787",
    title: "Kodigital",
    description: "Kodigital homepages",
  };
}

async function fetchPublishedPage(
  db: D1Database,
  slug: string,
): Promise<PageRow | null> {
  const row = await db
    .prepare(
      "SELECT id, slug, title, content_html, status, updated_at FROM pages WHERE slug = ? AND status = 'published' LIMIT 1",
    )
    .bind(slug)
    .first<PageRow>();
  return row ?? null;
}

async function fetchCategory(
  db: D1Database,
  slug: string,
): Promise<CategoryRow | null> {
  const row = await db
    .prepare("SELECT id, slug, name FROM categories WHERE slug = ? LIMIT 1")
    .bind(slug)
    .first<CategoryRow>();
  return row ?? null;
}

async function fetchCategoryArticles(
  db: D1Database,
  categoryId: number,
  page: number,
): Promise<ArticleRow[]> {
  const offset = Math.max(0, (page - 1) * PAGE_SIZE);
  const result = await db
    .prepare(
      "SELECT * FROM articles WHERE category_id = ? AND status = 'published' ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?",
    )
    .bind(categoryId, PAGE_SIZE, offset)
    .all<ArticleRow>();
  return result.results ?? [];
}

async function fetchSitemapPages(db: D1Database): Promise<SitemapPageRow[]> {
  const result = await db
    .prepare(
      "SELECT slug, updated_at FROM pages WHERE status = 'published' ORDER BY updated_at DESC",
    )
    .all<SitemapPageRow>();
  return result.results ?? [];
}

const router = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();

// T26: site-context resolution runs before every public route. Unmapped
// hostnames (including ADMIN_HOST, which never resolves as a public
// site) get a safe 404 with no admin-host leak; resolved tenant hosts
// proceed with c.get("site") populated for downstream handlers (T27).
router.use("*", publicSiteContextMiddleware);

router.get("/article/:slug", async (c) => {
  const slug = c.req.param("slug");
  const row = await c.env.DB
    .prepare(
      "SELECT * FROM articles WHERE slug = ? AND status = 'published' LIMIT 1",
    )
    .bind(slug)
    .first<ArticleRow>();
  if (!row) return c.json({ error: "Not Found" }, 404);
  return c.html(row.content_html ?? "");
});

router.get("/category/:slug", async (c) => {
  const slug = c.req.param("slug");
  const cat = await fetchCategory(c.env.DB, slug);
  if (!cat) return c.json({ error: "Not Found" }, 404);
  const articles = await fetchCategoryArticles(c.env.DB, cat.id, 1);
  return c.json({ category: cat, page: 1, articles });
});

router.get("/category/:slug/page/:page", async (c) => {
  const slug = c.req.param("slug");
  const pageNum = Math.max(1, parseInt(c.req.param("page") ?? "1", 10) || 1);
  const cat = await fetchCategory(c.env.DB, slug);
  if (!cat) return c.json({ error: "Not Found" }, 404);
  const articles = await fetchCategoryArticles(c.env.DB, cat.id, pageNum);
  return c.json({ category: cat, page: pageNum, articles });
});

router.get("/page/:slug", async (c) => {
  const slug = c.req.param("slug");
  const row = await fetchPublishedPage(c.env.DB, slug);
  if (!row) return c.json({ error: "Not Found" }, 404);
  return c.html(row.content_html ?? "");
});

router.get("/feed.xml", async (c) => {
  const articles = await listArticles(c.env.DB, { status: "published" });
  const xml = renderRssFeed(articles, siteInfo(c.env));
  c.header("Content-Type", "application/rss+xml; charset=utf-8");
  return c.body(xml);
});

router.get("/atom.xml", async (c) => {
  const articles = await listArticles(c.env.DB, { status: "published" });
  const xml = renderAtomFeed(articles, siteInfo(c.env));
  c.header("Content-Type", "application/atom+xml; charset=utf-8");
  return c.body(xml);
});

router.get("/sitemap.xml", async (c) => {
  const articles = await listArticles(c.env.DB, { status: "published", limit: 5000 });
  const pages = await fetchSitemapPages(c.env.DB);
  const xml = renderSitemap({ baseUrl: siteInfo(c.env).baseUrl, articles, pages });
  c.header("Content-Type", "application/xml; charset=utf-8");
  return c.body(xml);
});

router.get("/robots.txt", (c) => {
  c.header("Content-Type", "text/plain; charset=utf-8");
  return c.body(buildRobotsTxt(siteInfo(c.env).baseUrl));
});

router.get("/ads.txt", (c) => {
  c.header("Content-Type", "text/plain; charset=utf-8");
  return c.body(ADS_TXT_DEFAULT);
});

router.get("/preview/:id", (c) => {
  // Phase 1 placeholder — T11 replaces this with HMAC-signed token validation.
  return c.json({ ok: false, error: "Preview not yet wired (T11)" }, 501);
});

router.get("/health", (c) =>
  c.json({ ok: true, app: "kodigital-homepages-cms", scope: "public" }),
);

router.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (isReservedPath(slug)) {
    return c.json({ error: "Not Found" }, 404);
  }
  const page = await fetchPublishedPage(c.env.DB, slug);
  if (page) return c.html(page.content_html ?? "");
  const article = await c.env.DB
    .prepare(
      "SELECT * FROM articles WHERE slug = ? AND status = 'published' LIMIT 1",
    )
    .bind(slug)
    .first<ArticleRow>();
  if (article) return c.html(article.content_html ?? "");
  return c.json({ error: "Not Found" }, 404);
});

export default router;
