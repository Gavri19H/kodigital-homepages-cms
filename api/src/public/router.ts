// Public router: the 12 Phase-1 public routes (article/category/page/feeds/
// sitemap/robots/ads/preview/health) plus the /:slug compatibility catch-all.
// /:slug calls isReservedPath() FIRST so the admin slug never shadows the
// dedicated admin handler in api/src/index.ts (wired by T12).
//
// T27 (Phase 3): every public-content handler scopes its DB query by
// `siteContext.siteId` so site A's `/article/hello` cannot leak into site
// B's response. The siteContext is populated by `publicSiteContextMiddleware`
// (which itself calls `resolveSiteContextFromRequest` upstream of the
// routes), so by the time a handler runs, `c.get("siteContext").siteId` is
// guaranteed to be the canonical site_id for the request's hostname.

import { Hono } from "hono";
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
  fetchPublicLayoutSiteInfo,
} from "./queries";
import { buildHomeViewModel } from "./view-models/home";
import { buildArticleViewModel } from "./view-models/article";
import { renderHome } from "./templates/home";
import { renderArticle } from "./templates/article";
import { renderLayout } from "./templates/layout";
import { renderHeader, renderFooter } from "./templates/components";
import { buildHomeJsonLd } from "./templates/seo";
import { publicCss } from "./assets/public-css";
import { publicJs } from "./assets/public-js";

const PUBLIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

function escapeText(input: string | null | undefined): string {
  if (input === null || input === undefined) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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

// T12: GET / on a resolved tenant returns the public Home page. The view
// model is built from D1 (site_settings + articles + categories), the body
// is composed by renderHome (PART 1, 13 sections), and renderLayout wraps
// the body in the <html> scaffold (site header + footer markers come from
// renderHome's §1 and §13 sections; layout adds the head + skip-to-content
// link + brand-token style + JSON-LD blocks). PART 12 RED LINE: no
// hardcoded TheIWise / cms.kodigital.app strings — every brand string
// flows from buildHomeViewModel's site/site_settings reads.
router.get("/", async (c) => {
  const siteContext = c.get("siteContext");
  const vm = await buildHomeViewModel(c.env.DB, {
    siteId: siteContext.siteId,
    hostname: siteContext.hostname,
  });
  const body = renderHome({ vm });
  const jsonLd = buildHomeJsonLd({
    site: {
      name: vm.site.name,
      hostname: vm.site.hostname,
      tagline: vm.site.tagline,
      description: vm.site.description,
      logoUrl: vm.site.logoUrl,
    },
    featured: vm.featured.map((a) => ({
      title: a.title,
      slug: a.slug,
      excerpt: a.excerpt,
      imageUrl: a.imageUrl,
      publishedAt: a.publishedAt,
    })),
  });
  const html = renderLayout({
    site: {
      name: vm.site.name,
      hostname: vm.site.hostname,
      tagline: vm.site.tagline,
      description: vm.site.description,
      brandTokens: vm.site.brandTokens,
      logoUrl: vm.site.logoUrl,
    },
    meta: {
      title: vm.meta.title,
      description: vm.meta.description,
      canonicalUrl: vm.meta.canonicalUrl,
      jsonLd,
    },
    body,
  });
  return c.html(html);
});

// T13: /article/:slug builds the full Article view model (T9) and renders
// it through the public Article template (T11) wrapped in the public layout
// (T3). When the template pipeline throws (e.g. a malformed body block
// surface), the handler falls back to serving the raw content_html so the
// article still loads — T13.AC4 BEHAVIORAL.
router.get("/article/:slug", async (c) => {
  const slug = c.req.param("slug");
  const siteContext = c.get("siteContext");
  const vm = await buildArticleViewModel(c.env.DB, {
    slug,
    siteContext: {
      siteId: siteContext.siteId,
      hostname: siteContext.hostname,
    },
  });
  if (vm === null) {
    return c.json({ error: "Not Found" }, 404);
  }
  try {
    const body = renderArticle({ vm });
    const html = renderLayout({
      site: {
        name: vm.site.name,
        hostname: vm.site.hostname,
        tagline: vm.site.tagline,
        description: vm.site.description,
        brandTokens: vm.site.brandTokens,
        logoUrl: vm.site.logoUrl,
      },
      meta: {
        title: vm.meta.title,
        description: vm.meta.description,
        canonicalUrl: vm.meta.canonicalUrl,
        ogImage: vm.meta.ogImage,
      },
      body,
    });
    return c.html(html);
  } catch {
    const row = await getArticleBySlug(c.env.DB, slug, {
      siteId: siteContext.siteId,
    });
    return c.html(row?.content_html ?? "");
  }
});

// T15: /category/:slug renders the site-aware layout wrapper so the public
// category landing page carries the same `<header class="site-header">`,
// brand-token style block, and PART 12 no-hardcoded-brand discipline as
// Home + Article. The body lists the category name + paginated article
// links so the layout has meaningful per-tenant content above the header.
function renderCategoryBody(
  cat: { id: number; slug: string; name: string },
  articles: ReadonlyArray<{ slug: string; title: string }>,
  pageNum: number,
): string {
  const items =
    articles.length === 0
      ? '<p class="category-page__empty">No articles yet.</p>'
      : `<ul class="category-page__list">${articles
          .map(
            (a) =>
              `<li class="category-page__item"><a href="/article/${escapeText(a.slug)}">${escapeText(a.title)}</a></li>`,
          )
          .join("")}</ul>`;
  return `<section class="category-page" data-category-slug="${escapeText(cat.slug)}" data-page="${pageNum}">
  <h1 class="category-page__heading">${escapeText(cat.name)}</h1>
  ${items}
</section>`;
}

router.get("/category/:slug", async (c) => {
  const slug = c.req.param("slug");
  const siteContext = c.get("siteContext");
  const cat = await fetchCategory(c.env.DB, slug);
  if (!cat) return c.json({ error: "Not Found" }, 404);
  const articles = await fetchCategoryArticles(
    c.env.DB,
    cat.id,
    siteContext.siteId,
    1,
  );
  const site = await fetchPublicLayoutSiteInfo(c.env.DB, siteContext);
  const body = renderCategoryBody(cat, articles, 1);
  const html = renderLayout({
    site,
    meta: {
      title: site.name.length > 0 ? `${cat.name} — ${site.name}` : cat.name,
      description: site.description,
      canonicalUrl: `https://${siteContext.hostname}/category/${cat.slug}`,
    },
    body,
    header: renderHeader({ site }),
    footer: renderFooter({ site }),
  });
  return c.html(html);
});

router.get("/category/:slug/page/:page", async (c) => {
  const slug = c.req.param("slug");
  const pageNum = Math.max(1, parseInt(c.req.param("page") ?? "1", 10) || 1);
  const siteContext = c.get("siteContext");
  const cat = await fetchCategory(c.env.DB, slug);
  if (!cat) return c.json({ error: "Not Found" }, 404);
  const articles = await fetchCategoryArticles(
    c.env.DB,
    cat.id,
    siteContext.siteId,
    pageNum,
  );
  const site = await fetchPublicLayoutSiteInfo(c.env.DB, siteContext);
  const body = renderCategoryBody(cat, articles, pageNum);
  const html = renderLayout({
    site,
    meta: {
      title: site.name.length > 0 ? `${cat.name} — ${site.name}` : cat.name,
      description: site.description,
      canonicalUrl: `https://${siteContext.hostname}/category/${cat.slug}/page/${pageNum}`,
    },
    body,
    header: renderHeader({ site }),
    footer: renderFooter({ site }),
  });
  return c.html(html);
});

// T15: /page/:slug renders the published page's content_html inside the
// same site-aware layout wrapper as Home + Article + Category so every
// public route carries the tenant's brand-token style + site-header +
// footer. The raw content_html is embedded inside a `<section>` so the
// layout's `<main>` element wraps a structural container, not bare HTML.
router.get("/page/:slug", async (c) => {
  const slug = c.req.param("slug");
  const siteContext = c.get("siteContext");
  const row = await fetchPublishedPage(c.env.DB, slug, siteContext.siteId);
  if (!row) return c.json({ error: "Not Found" }, 404);
  const site = await fetchPublicLayoutSiteInfo(c.env.DB, siteContext);
  const pageTitle = row.title.length > 0 ? row.title : slug;
  const body = `<article class="cms-page" data-page-slug="${escapeText(row.slug)}">
  <h1 class="cms-page__heading">${escapeText(pageTitle)}</h1>
  <div class="cms-page__content">${row.content_html ?? ""}</div>
</article>`;
  const html = renderLayout({
    site,
    meta: {
      title: site.name.length > 0 ? `${pageTitle} — ${site.name}` : pageTitle,
      description: site.description,
      canonicalUrl: `https://${siteContext.hostname}/page/${row.slug}`,
    },
    body,
    header: renderHeader({ site }),
    footer: renderFooter({ site }),
  });
  return c.html(html);
});

router.get("/feed.xml", async (c) => {
  const siteContext = c.get("siteContext");
  const articles = await listArticles(c.env.DB, {
    status: "published",
    siteId: siteContext.siteId,
  });
  const xml = renderRssFeed(articles, siteInfo(c.env, siteContext));
  c.header("Content-Type", "application/rss+xml; charset=utf-8");
  return c.body(xml);
});

router.get("/atom.xml", async (c) => {
  const siteContext = c.get("siteContext");
  const articles = await listArticles(c.env.DB, {
    status: "published",
    siteId: siteContext.siteId,
  });
  const xml = renderAtomFeed(articles, siteInfo(c.env, siteContext));
  c.header("Content-Type", "application/atom+xml; charset=utf-8");
  return c.body(xml);
});

router.get("/sitemap.xml", async (c) => {
  const siteContext = c.get("siteContext");
  const articles = await listArticles(c.env.DB, {
    status: "published",
    limit: 5000,
    siteId: siteContext.siteId,
  });
  const pages = await fetchSitemapPages(c.env.DB, siteContext.siteId);
  const xml = renderSitemap({
    baseUrl: siteInfo(c.env, siteContext).baseUrl,
    articles,
    pages,
  });
  c.header("Content-Type", "application/xml; charset=utf-8");
  return c.body(xml);
});

router.get("/robots.txt", async (c) => {
  const siteContext = c.get("siteContext");
  const override = await fetchSiteSetting(
    c.env.DB,
    siteContext.siteId,
    "robots_txt",
  );
  const baseUrl = siteInfo(c.env, siteContext).baseUrl;
  c.header("Content-Type", "text/plain; charset=utf-8");
  return c.body(override ?? buildRobotsTxt(baseUrl));
});

router.get("/ads.txt", async (c) => {
  const siteContext = c.get("siteContext");
  const override = await fetchSiteSetting(
    c.env.DB,
    siteContext.siteId,
    "ads_txt",
  );
  c.header("Content-Type", "text/plain; charset=utf-8");
  return c.body(override ?? ADS_TXT_DEFAULT);
});

router.get("/preview/:id", (c) => {
  // Phase 1 placeholder — T11 replaces this with HMAC-signed token validation.
  return c.json({ ok: false, error: "Preview not yet wired (T11)" }, 501);
});

router.get("/health", (c) =>
  c.json({ ok: true, app: "kodigital-homepages-cms", scope: "public" }),
);

// T14: cacheable public asset routes. Both literal paths are registered
// BEFORE the /:slug catch-all so they always win over any planted page
// whose slug starts with `assets` (the catch-all also short-circuits
// reserved heads via isReservedPath, so defense-in-depth is preserved
// even if a future refactor moves these). Cache-Control max-age=31536000
// + immutable matches PART 6 (PART 6.5 caching strategy) — the
// underlying string modules are versioned by deploy, never by URL.
router.get("/assets/public.css", (c) => {
  c.header("Content-Type", "text/css; charset=utf-8");
  c.header("Cache-Control", PUBLIC_ASSET_CACHE_CONTROL);
  return c.body(publicCss);
});

router.get("/assets/public.js", (c) => {
  c.header("Content-Type", "application/javascript; charset=utf-8");
  c.header("Cache-Control", PUBLIC_ASSET_CACHE_CONTROL);
  return c.body(publicJs);
});

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

export default router;
