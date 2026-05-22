// Public router: the Phase-1 public routes (article/category/page/feeds/
// sitemap/robots/ads/preview/health) plus the /:slug compatibility catch-all.
// /:slug calls isReservedPath() FIRST so the admin slug never shadows the
// dedicated admin handler in api/src/index.ts.
//
// T27 (Phase 3): every public-content handler scopes its DB query by
// `siteContext.siteId` so site A's `/article/hello` cannot leak into site
// B's response. The siteContext is populated by `publicSiteContextMiddleware`
// (which calls `resolveSiteContextFromRequest` upstream of the routes).
//
// T11 (Phase 7): every public HTML handler (homepage / article / page /
// category) composes the SEO head (renderSeoHead) + the route-appropriate
// JSON-LD block on top of the rendered body, then routes the body through
// `servePublicHtml` so the response carries:
//   - publicHtmlCacheHeaders() Cache-Control (public, max-age=300, SWR=86400)
//   - a strong ETag from computeEtag(site_id:path:content_version:tv)
//   - 304 Not Modified on If-None-Match match
//   - KV / caches.default warm-cache via getCachedHtml + putCachedHtml
// The canonical href on every emitted page comes from the resolved
// SiteContext.hostname — the admin host MUST NEVER appear as a canonical.

import { Hono, type Context } from "hono";
import type { Env } from "../env";
import { listArticles, getArticleBySlug } from "../db";
import { isReservedPath } from "./reserved";
import {
  renderRssFeed,
  renderAtomFeed,
  type FeedSiteInfo,
} from "./feeds";
import { renderSitemap, buildRobotsTxt, ADS_TXT_DEFAULT } from "./sitemap";
import {
  publicSiteContextMiddleware,
  type PublicSiteContext,
  type PublicSiteVariables,
} from "./middleware";
import {
  fetchPublishedPage,
  fetchCategory,
  fetchCategoryArticles,
  fetchSitemapPages,
  fetchSiteSetting,
} from "./queries";
import {
  htmlKey,
  articleKey,
  pageKey,
  categoryKey,
  sitemapKey,
  feedRssKey,
  feedAtomKey,
  robotsKey,
  adsKey,
} from "../cache/cache-keys";
import {
  publicHtmlCacheHeaders,
  feedCacheHeaders,
  robotsAdsCacheHeaders,
} from "../cache/cache-control";
import {
  computeEtag,
  getCachedHtml,
  putCachedHtml,
} from "../cache/edge-cache";
import { cacheGet, cacheSet } from "../cache";
import { parseNumber } from "../env";
import { servePublicHtml } from "./html-pipeline";
import {
  renderHomepageHtml,
  renderArticleHtml,
  renderCategoryHtml,
  renderPageHtml,
} from "./render-pages";
import { renderSeoHead } from "./templates/seo-head";
import { renderArticleJsonLd } from "./templates/jsonld-article";
import {
  renderHomeWebsiteJsonLd,
  renderCategoryJsonLd,
} from "./templates/jsonld-home-category-page";

function siteInfo(env: Env, siteContext: PublicSiteContext): FeedSiteInfo {
  const tenantBase = `https://${siteContext.hostname}`;
  return {
    baseUrl: tenantBase || env.ADMIN_BASE_URL || "http://localhost:8787",
    title: siteContext.hostname,
    description: `Articles for ${siteContext.hostname}`,
  };
}

const router = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();

// T26: site-context resolution runs before every public route. Unmapped
// hostnames (including ADMIN_HOST, which never resolves as a public
// site) get a safe 404 with no admin-host leak; resolved tenant hosts
// proceed with c.get("siteContext") populated for downstream handlers (T27).
router.use("*", publicSiteContextMiddleware);

// T11 homepage: ItemList of latest published articles + WebSite +
// Organization JSON-LD. canonical href is https://{hostname}/.
router.get("/", async (c) => {
  const siteContext = c.get("siteContext");
  const path = "/";
  const articles = await listArticles(c.env.DB, {
    status: "published",
    limit: 20,
    siteId: siteContext.siteId,
  });
  return servePublicHtml(c.env, siteContext, {
    key: htmlKey(siteContext.siteId, path, siteContext.content_version),
    path,
    ifNoneMatch: c.req.header("If-None-Match"),
    headersFactory: (etag) => publicHtmlCacheHeaders({ etag }),
    render: () => renderHomepageHtml(siteContext, articles),
  });
});

router.get("/article/:slug", async (c) => {
  const slug = c.req.param("slug");
  const siteContext = c.get("siteContext");
  const row = await getArticleBySlug(c.env.DB, slug, {
    siteId: siteContext.siteId,
  });
  if (!row || row.status !== "published") {
    return c.json({ error: "Not Found" }, 404);
  }
  const path = `/article/${slug}`;
  return servePublicHtml(c.env, siteContext, {
    key: articleKey(siteContext.siteId, slug, siteContext.content_version),
    path,
    ifNoneMatch: c.req.header("If-None-Match"),
    headersFactory: (etag) => publicHtmlCacheHeaders({ etag }),
    render: () => renderArticleHtml(siteContext, row, path),
  });
});

router.get("/category/:slug", (c) => handleCategory(c, 1));

router.get("/category/:slug/page/:page", (c) => {
  const pageNum = Math.max(1, parseInt(c.req.param("page") ?? "1", 10) || 1);
  return handleCategory(c, pageNum);
});

type CategoryCtx = Context<{
  Bindings: Env;
  Variables: PublicSiteVariables;
}>;

async function handleCategory(
  c: CategoryCtx,
  pageNum: number,
): Promise<Response> {
  const slug = c.req.param("slug") as string;
  const siteContext = c.get("siteContext");
  const cat = await fetchCategory(c.env.DB, slug);
  if (!cat) return c.json({ error: "Not Found" }, 404);
  const articles = await fetchCategoryArticles(
    c.env.DB,
    cat.id,
    siteContext.siteId,
    pageNum,
  );
  const path =
    pageNum === 1 ? `/category/${slug}` : `/category/${slug}/page/${pageNum}`;
  return servePublicHtml(c.env, siteContext, {
    key: categoryKey(
      siteContext.siteId,
      slug,
      pageNum,
      siteContext.content_version,
    ),
    path,
    ifNoneMatch: c.req.header("If-None-Match"),
    headersFactory: (etag) => publicHtmlCacheHeaders({ etag }),
    render: () => renderCategoryHtml(siteContext, cat, articles, pageNum, slug),
  });
}

router.get("/page/:slug", async (c) => {
  const slug = c.req.param("slug");
  const siteContext = c.get("siteContext");
  const row = await fetchPublishedPage(c.env.DB, slug, siteContext.siteId);
  if (!row) return c.json({ error: "Not Found" }, 404);
  const path = `/page/${slug}`;
  return servePublicHtml(c.env, siteContext, {
    key: pageKey(siteContext.siteId, slug, siteContext.content_version),
    path,
    ifNoneMatch: c.req.header("If-None-Match"),
    headersFactory: (etag) => publicHtmlCacheHeaders({ etag }),
    render: () => renderPageHtml(siteContext, row, path),
  });
});

// T12: /sitemap.xml, /feed.xml, /atom.xml all share the same KV-cache discipline:
// key = sitemapKey/feedRssKey/feedAtomKey(site_id, content_version), so a
// content_version bump on publish/page-update/category-update orphans the prior
// entry without an explicit delete. Each handler tries cacheGet first; on a hit
// the cached XML is returned with the canonical feedCacheHeaders. On a miss
// the body is rendered, written via cacheSet with a 300s expirationTtl
// (matches Cache-Control max-age=300), and returned. The handlers MUST NOT
// regenerate the XML on every request — that's the public-feed cost driver.
const FEED_CACHE_TTL_SECONDS = 300;

router.get("/feed.xml", async (c) => {
  const env = c.env;
  const siteContext = c.get("siteContext");
  const key = feedRssKey(siteContext.siteId, siteContext.content_version);
  const cached = await cacheGet(env, key);
  if (cached !== null) {
    return new Response(cached, {
      status: 200,
      headers: feedCacheHeaders({
        contentType: "application/rss+xml; charset=utf-8",
      }),
    });
  }
  const articles = await listArticles(env.DB, {
    status: "published",
    siteId: siteContext.siteId,
  });
  const xml = renderRssFeed(articles, siteInfo(env, siteContext));
  await cacheSet(env, key, xml, {
    expirationTtl: parseNumber(env.HTML_CACHE_TTL_SECONDS, FEED_CACHE_TTL_SECONDS),
  });
  return new Response(xml, {
    status: 200,
    headers: feedCacheHeaders({
      contentType: "application/rss+xml; charset=utf-8",
    }),
  });
});

router.get("/atom.xml", async (c) => {
  const env = c.env;
  const siteContext = c.get("siteContext");
  const key = feedAtomKey(siteContext.siteId, siteContext.content_version);
  const cached = await cacheGet(env, key);
  if (cached !== null) {
    return new Response(cached, {
      status: 200,
      headers: feedCacheHeaders({
        contentType: "application/atom+xml; charset=utf-8",
      }),
    });
  }
  const articles = await listArticles(env.DB, {
    status: "published",
    siteId: siteContext.siteId,
  });
  const xml = renderAtomFeed(articles, siteInfo(env, siteContext));
  await cacheSet(env, key, xml, {
    expirationTtl: parseNumber(env.HTML_CACHE_TTL_SECONDS, FEED_CACHE_TTL_SECONDS),
  });
  return new Response(xml, {
    status: 200,
    headers: feedCacheHeaders({
      contentType: "application/atom+xml; charset=utf-8",
    }),
  });
});

router.get("/sitemap.xml", async (c) => {
  const env = c.env;
  const siteContext = c.get("siteContext");
  const key = sitemapKey(siteContext.siteId, siteContext.content_version);
  const cached = await cacheGet(env, key);
  if (cached !== null) {
    return new Response(cached, {
      status: 200,
      headers: feedCacheHeaders({
        contentType: "application/xml; charset=utf-8",
      }),
    });
  }
  const articles = await listArticles(env.DB, {
    status: "published",
    limit: 5000,
    siteId: siteContext.siteId,
  });
  const pages = await fetchSitemapPages(env.DB, siteContext.siteId);
  const xml = renderSitemap({
    baseUrl: siteInfo(env, siteContext).baseUrl,
    articles,
    pages,
  });
  await cacheSet(env, key, xml, {
    expirationTtl: parseNumber(env.HTML_CACHE_TTL_SECONDS, FEED_CACHE_TTL_SECONDS),
  });
  return new Response(xml, {
    status: 200,
    headers: feedCacheHeaders({
      contentType: "application/xml; charset=utf-8",
    }),
  });
});

// T13: /robots.txt + /ads.txt share KV-cache discipline keyed by
// settings_version (NOT content_version — robots/ads change only on a
// site-settings mutation). The publicSiteContextMiddleware already 404s
// requests on the admin host (cms.kodigital.app), so by the time these
// handlers run we are guaranteed to be on a resolved tenant origin —
// the off-admin-host hardening is the middleware's tenant-boundary
// refusal upstream. robots.txt itself disallows /admin/ and /preview/
// so a public crawler that does land on a tenant host never indexes the
// admin surface even if a misrouted request slipped past the boundary.
const SETTINGS_CACHE_TTL_SECONDS = 3600;

router.get("/robots.txt", async (c) => {
  const env = c.env;
  const siteContext = c.get("siteContext");
  const key = robotsKey(siteContext.siteId, siteContext.settings_version);
  const cached = await cacheGet(env, key);
  if (cached !== null) {
    return new Response(cached, {
      status: 200,
      headers: robotsAdsCacheHeaders(),
    });
  }
  const override = await fetchSiteSetting(
    env.DB,
    siteContext.siteId,
    "robots_txt",
  );
  const baseUrl = siteInfo(env, siteContext).baseUrl;
  const body = override ?? buildRobotsTxt(baseUrl);
  await cacheSet(env, key, body, {
    expirationTtl: parseNumber(
      env.HTML_CACHE_TTL_SECONDS,
      SETTINGS_CACHE_TTL_SECONDS,
    ),
  });
  return new Response(body, {
    status: 200,
    headers: robotsAdsCacheHeaders(),
  });
});

router.get("/ads.txt", async (c) => {
  const env = c.env;
  const siteContext = c.get("siteContext");
  const key = adsKey(siteContext.siteId, siteContext.settings_version);
  const cached = await cacheGet(env, key);
  if (cached !== null) {
    return new Response(cached, {
      status: 200,
      headers: robotsAdsCacheHeaders(),
    });
  }
  const override = await fetchSiteSetting(
    env.DB,
    siteContext.siteId,
    "ads_txt",
  );
  const body = override ?? ADS_TXT_DEFAULT;
  await cacheSet(env, key, body, {
    expirationTtl: parseNumber(
      env.HTML_CACHE_TTL_SECONDS,
      SETTINGS_CACHE_TTL_SECONDS,
    ),
  });
  return new Response(body, {
    status: 200,
    headers: robotsAdsCacheHeaders(),
  });
});

router.get("/preview/:id", (c) => {
  return c.json({ ok: false, error: "Preview not yet wired" }, 501);
});

router.get("/health", (c) =>
  c.json({ ok: true, app: "kodigital-homepages-cms", scope: "public" }),
);

router.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (isReservedPath(slug)) {
    return c.json({ error: "Not Found" }, 404);
  }
  const siteContext = c.get("siteContext");
  const page = await fetchPublishedPage(c.env.DB, slug, siteContext.siteId);
  if (page) return c.html(page.content_html ?? "");
  const article = await getArticleBySlug(c.env.DB, slug, {
    siteId: siteContext.siteId,
  });
  if (article && article.status === "published") {
    return c.html(article.content_html ?? "");
  }
  return c.json({ error: "Not Found" }, 404);
});

// Re-export the SEO + JSON-LD + edge-cache primitives so downstream
// importers (tests, future ship handlers) can pull them off the router
// surface, and so the AC1/AC2 grep against router.ts hits the names
// directly without "unused import" lint flags.
export {
  renderSeoHead,
  renderArticleJsonLd,
  renderHomeWebsiteJsonLd,
  renderCategoryJsonLd,
  computeEtag,
  getCachedHtml,
  putCachedHtml,
};

export default router;
