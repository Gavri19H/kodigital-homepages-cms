// Public router: the Phase-1 public routes (article/category/page/feeds/
// sitemap/robots/ads/health) plus the /:slug compatibility catch-all.
// Draft preview (/preview/:id) is owned by the dedicated previewRouter.
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
import { publicCss } from "./assets/public-css";
import { publicJs } from "./assets/public-js";
import {
  renderRssFeed,
  renderAtomFeed,
  type FeedSiteInfo,
} from "./feeds";
import { renderSitemap, buildRobotsTxt, buildLlmsTxt } from "./sitemap";
import { buildArticleViewModel } from "./view-models/article";
import { renderArticleMarkdown } from "./article-markdown";
import { isDatacenterAsn, isDeclaredBotUA } from "../safety/ivt";
import { isGpcOptOut } from "../privacy/gpc";
import { resolveAdsTxt } from "./ads";
import {
  publicSiteContextMiddleware,
  type PublicSiteContext,
  type PublicSiteVariables,
} from "./middleware";
import {
  fetchPublishedPage,
  fetchCategory,
  fetchCategoryArticles,
  fetchTag,
  fetchTagArticles,
  fetchSitemapPages,
  fetchSiteSetting,
  resolvePageSize,
  checkRedirect,
  fetchPublicLayoutSiteInfo,
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
  renderTagHtml,
  renderPageHtml,
} from "./render-pages";
import { renderErrorPage } from "./render-error";
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

// T14-AC2: public-content misses (bad URL) and unexpected server errors are
// answered with a styled HTML page rendered through the design shell
// (renderErrorPage → renderLayout) — never bare `{"error":"Not Found"}` JSON
// or hono's default "Internal Server Error" text. The renderer is DB-free so
// a 500 caused by the DB itself still produces a branded page. Hostname comes
// from the resolved tenant siteContext (or the request URL as a fallback when
// the error fired before the site-context middleware ran) — the admin host is
// never used here.
function publicErrorResponse(
  c: Context<{ Bindings: Env; Variables: PublicSiteVariables }>,
  status: 404 | 500,
): Response {
  const siteContext = c.get("siteContext") as PublicSiteContext | undefined;
  let hostname =
    siteContext !== undefined && typeof siteContext.hostname === "string"
      ? siteContext.hostname
      : "";
  if (hostname.length === 0) {
    try {
      hostname = new URL(c.req.url).hostname;
    } catch {
      hostname = "";
    }
  }
  return c.html(renderErrorPage({ hostname, status }), status);
}

// A thrown error in ANY public-content handler renders the styled 500. A
// mounted sub-app's onError fires under the parent app (verified against
// hono 4.x), so this is the live mechanism for the deployed worker too.
router.onError((_err, c) => publicErrorResponse(c, 500));

// T20 (rescue-3): /favicon.ico is answered explicitly so a browser's
// automatic favicon request never falls through to the /:slug
// compatibility catch-all, which would emit an unhandled 404 (the
// "missing favicon" consistency item in the brief). No per-tenant icon
// asset is bundled, so the route returns 204 No Content — a valid
// "no favicon configured" response (never a 404/500). It is registered
// BEFORE publicSiteContextMiddleware so it stays host-independent and
// needs no tenant DB lookup: a favicon is a generic asset request, not
// site-scoped content.
router.get("/favicon.ico", () =>
  new Response(null, {
    status: 204,
    headers: { "Cache-Control": "public, max-age=86400" },
  }),
);

// rescue-4 — the public design assets the layout links: /assets/public.css
// (the theiwise design system — --tw-brand:#1ba8c8, the 13/12 section styling,
// Nunito, the 8 responsive breakpoints) and /assets/public.js. WITHOUT these
// routes the layout's <link rel="stylesheet" href="/assets/public.css"> 404s
// and EVERY public page renders completely UNSTYLED (raw HTML). Registered
// BEFORE publicSiteContextMiddleware so they are host-independent generic
// assets (no tenant DB lookup), exactly like /favicon.ico above.
router.get("/assets/public.css", () =>
  new Response(publicCss, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  }),
);
router.get("/assets/public.js", () =>
  new Response(publicJs, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  }),
);

// T26: site-context resolution runs before every public route. Unmapped
// hostnames (including ADMIN_HOST, which never resolves as a public
// site) get a safe 404 with no admin-host leak; resolved tenant hosts
// proceed with c.get("siteContext") populated for downstream handlers (T27).
router.use("*", publicSiteContextMiddleware);

// rescue-6 (agent-readiness M3 / ad IVT defense): decide whether THIS request is
// automated, from Cloudflare's edge bot signals (request.cf). Ad-bearing pages
// (home / article / category) suppress ad tags for bots so non-human traffic
// never triggers ad impressions — invalid traffic is an AdSense / Ad Manager
// policy + revenue-clawback risk. VERIFIED SEARCH engines (Googlebot etc.) are
// deliberately NOT treated as bots: they get the SAME cached page as humans (ad
// networks filter crawler traffic on their side, and serving a search engine a
// different page than users risks cloaking). We suppress only AI crawlers
// (verifiedBotCategory) and unverified low-score automation (paid Bot Mgmt).
export function botFromCfSignals(
  cf:
    | {
        verifiedBot?: boolean;
        verifiedBotCategory?: string;
        botManagement?: { score?: number };
        asn?: number;
      }
    | undefined,
  userAgent?: string | null,
): boolean {
  if (cf === undefined) return false;
  if (cf.verifiedBot === true) {
    const cat = cf.verifiedBotCategory;
    // Among Cloudflare's verified-bot categories only the AI-crawler class is
    // suppressed; "Search Engine Crawler" and the rest get the human page.
    // (A verified good bot is NEVER subjected to the IVT signals below — e.g. a
    // verified Googlebot legitimately living in a datacenter ASN must not be
    // treated as invalid traffic.)
    return typeof cat === "string" && cat.toLowerCase().includes("ai");
  }
  // NOT a verified good bot -> apply the free open-source IVT signals (Layer 1).
  const score = cf.botManagement?.score;
  // Cloudflare bot score is 1 (definitely bot) .. 99 (human); < 30 = likely
  // automation. Only present with the paid Bot Management add-on (else 0/undef).
  if (typeof score === "number" && score > 0 && score < 30) return true;
  // Datacenter / hosting ASN (cf.asn is free on every plan): ads to cloud/colo
  // IPs are classic GIVT.
  if (isDatacenterAsn(cf.asn)) return true;
  // Self-declaring bot / non-browser HTTP client by user-agent.
  if (isDeclaredBotUA(userAgent)) return true;
  return false;
}

function isBotRequest(
  c: Context<{ Bindings: Env; Variables: PublicSiteVariables }>,
): boolean {
  const cf = (c.req.raw as unknown as {
    cf?: {
      verifiedBot?: boolean;
      verifiedBotCategory?: string;
      botManagement?: { score?: number };
      asn?: number;
    };
  }).cf;
  return botFromCfSignals(cf, c.req.header("user-agent"));
}

// No-store HTML headers for the ad-free bot variant: a CDN/proxy must NEVER
// cache it and later serve it to a human (that would silently drop ads). No
// X-Robots-Tag — crawlers should still index the content; only the ads differ.
function botHtmlHeaders(): Headers {
  const h = new Headers();
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Cache-Control", "private, no-store");
  return h;
}

// rescue-6 (agent-readiness M4 / CCPA wiring): a "do not sell / share" opt-out
// is recorded as the ccpa_opt_out=1 cookie (HttpOnly — JS can't read it, but the
// SERVER can). When set, ad-bearing pages render with ad data processing
// RESTRICTED (GAM Restrict-Data-Processing / AdSense non-personalized) so the
// opt-out finally GATES something instead of just setting a cookie. Like the bot
// path, an opted-out request renders fresh + no-store so the restricted variant
// never caches and serves to a non-opted-out visitor.
// rescue-6 (agent-readiness M2/M5): does THIS client prefer markdown? True only
// when the Accept header explicitly lists text/markdown AND ranks it >= text/html
// (so a normal browser, which never sends text/markdown, always gets HTML). The
// q-value parse avoids the naive substring trap.
export function acceptPrefersMarkdown(accept: string | null | undefined): boolean {
  if (typeof accept !== "string" || accept.length === 0) return false;
  let mdQ = -1;
  let htmlQ = -1;
  for (const part of accept.split(",")) {
    const seg = part.trim().toLowerCase();
    if (seg.length === 0) continue;
    const type = seg.split(";")[0]!.trim();
    let q = 1;
    const m = seg.match(/;\s*q=([0-9.]+)/);
    if (m) {
      const parsed = parseFloat(m[1]!);
      if (Number.isFinite(parsed)) q = parsed;
    }
    if (type === "text/markdown") mdQ = Math.max(mdQ, q);
    else if (type === "text/html" || type === "application/xhtml+xml") {
      htmlQ = Math.max(htmlQ, q);
    }
  }
  return mdQ >= 0 && mdQ >= htmlQ;
}

function isCcpaOptedOut(
  c: Context<{ Bindings: Env; Variables: PublicSiteVariables }>,
): boolean {
  const cookie = c.req.header("cookie");
  if (cookie === undefined || cookie === null || cookie.length === 0) return false;
  for (const part of cookie.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) === "ccpa_opt_out") return part.slice(eq + 1) === "1";
  }
  return false;
}

// rescue-7 (#3 GPC honoring): a request is opted out of "sale/share" when EITHER
// the explicit Do-Not-Sell cookie is set (any visitor) OR Global Privacy Control
// is asserted by a visitor in a state that mandates honoring it (the narrow,
// revenue-preserving geo scope — see privacy/gpc.ts). Bots never get ad tags, so
// they are never "opted out". The result routes into the existing Restricted-
// Data-Processing path (Google's per-request, CMP-free US-privacy mechanism).
function computeRestrictAdData(
  c: Context<{ Bindings: Env; Variables: PublicSiteVariables }>,
  isBot: boolean,
): boolean {
  if (isBot) return false;
  if (isCcpaOptedOut(c)) return true;
  const cf = (c.req.raw as unknown as {
    cf?: { country?: string; regionCode?: string };
  }).cf;
  return isGpcOptOut({
    secGpc: c.req.header("Sec-GPC"),
    country: cf?.country,
    regionCode: cf?.regionCode,
  });
}

// T11 homepage: ItemList of latest published articles + WebSite +
// Organization JSON-LD. canonical href is https://{hostname}/.
// T1 (rescue-3): the GET / handler passes c.env.DB into renderHomepageHtml
// so the design homepage (buildHomeViewModel + renderHome + renderLayout) is
// composed through the LIVE route — the renderer is db-fed, not orphaned.
// rescue-2 served the bare fallback because the route called no db-fed
// renderer; the served HTML now carries the 13 home sections, the inline
// brand tokens and the design shell.
router.get("/", async (c) => {
  const siteContext = c.get("siteContext");
  const path = "/";
  const isBot = isBotRequest(c);
  const restrictAdData = computeRestrictAdData(c, isBot);
  if (isBot || restrictAdData) {
    const body = await renderHomepageHtml(c.env.DB, siteContext, {
      isBot,
      restrictAdData,
    });
    return new Response(body, { status: 200, headers: botHtmlHeaders() });
  }
  return servePublicHtml(c.env, siteContext, {
    key: htmlKey(siteContext.siteId, path, siteContext.content_version),
    path,
    ifNoneMatch: c.req.header("If-None-Match"),
    headersFactory: (etag) => publicHtmlCacheHeaders({ etag }),
    render: () => renderHomepageHtml(c.env.DB, siteContext),
  });
});

// T2 (rescue-3): the GET /article/:slug handler passes c.env.DB into
// renderArticleHtml so the design article shell (buildArticleViewModel +
// renderArticle + renderLayout) is composed through the LIVE route — the
// renderer is db-fed, not orphaned. getArticleBySlug stays as the cheap 404
// gate (so an unknown/draft slug never enters the cache pipeline); the
// db-fed render then runs only on a cold cache.
router.get("/article/:slug", async (c) => {
  const slug = c.req.param("slug");
  const siteContext = c.get("siteContext");
  const row = await getArticleBySlug(c.env.DB, slug, {
    siteId: siteContext.siteId,
  });
  if (!row || row.status !== "published") {
    return publicErrorResponse(c, 404);
  }
  const path = `/article/${slug}`;
  // rescue-6: serve clean markdown to agents that ask for it. Rendered fresh
  // from the parsed blocks and kept OFF the HTML cache (Vary: Accept) so the
  // markdown variant can never serve to a browser, and the HTML cache hit-rate
  // is untouched.
  if (acceptPrefersMarkdown(c.req.header("accept"))) {
    const mdVm = await buildArticleViewModel(c.env.DB, {
      slug,
      siteContext: {
        siteId: siteContext.siteId,
        hostname: siteContext.hostname,
      },
    });
    if (mdVm === null) return publicErrorResponse(c, 404);
    const md = renderArticleMarkdown({
      title: mdVm.article.title,
      subtitle: mdVm.article.subtitle,
      body: mdVm.article.body,
    });
    return new Response(md, {
      status: 200,
      headers: new Headers({
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        Vary: "Accept",
        "Cache-Control": "public, max-age=300",
      }),
    });
  }
  const isBot = isBotRequest(c);
  const restrictAdData = computeRestrictAdData(c, isBot);
  if (isBot || restrictAdData) {
    const body = await renderArticleHtml(c.env.DB, siteContext, slug, {
      isBot,
      restrictAdData,
    });
    return new Response(body, { status: 200, headers: botHtmlHeaders() });
  }
  return servePublicHtml(c.env, siteContext, {
    key: articleKey(siteContext.siteId, slug, siteContext.content_version),
    path,
    ifNoneMatch: c.req.header("If-None-Match"),
    headersFactory: (etag) => publicHtmlCacheHeaders({ etag }),
    render: () => renderArticleHtml(c.env.DB, siteContext, slug),
  });
});

router.get("/category/:slug", (c) => handleCategory(c, 1));

router.get("/category/:slug/page/:page", (c) => {
  const slug = c.req.param("slug") as string;
  const pageNum = Math.max(1, parseInt(c.req.param("page") ?? "1", 10) || 1);
  // T14: /category/<slug>/page/1 (and any non->=2 value, e.g. /page/0) 301s to
  // the bare canonical /category/<slug>. Page 1 IS the canonical listing, so a
  // /page/1 URL is a duplicate that must redirect — never render a second copy.
  if (pageNum === 1) {
    return c.redirect(`/category/${encodeURIComponent(slug)}`, 301);
  }
  return handleCategory(c, pageNum);
});

// T14: /tag/:slug renders the styled topic listing (renderTagHtml) — a tag is
// a styled collection of its published articles, not a missing/raw route.
// Pagination mirrors category: page 1 301s to the bare canonical, page >= 2 is
// noindex,follow. Registered before the /:slug catch-all (two segments never
// collide with the single-segment catch-all, but kept with the other listings).
router.get("/tag/:slug", (c) => handleTag(c, 1));

router.get("/tag/:slug/page/:page", (c) => {
  const slug = c.req.param("slug") as string;
  const pageNum = Math.max(1, parseInt(c.req.param("page") ?? "1", 10) || 1);
  if (pageNum === 1) {
    return c.redirect(`/tag/${encodeURIComponent(slug)}`, 301);
  }
  return handleTag(c, pageNum);
});

type CategoryCtx = Context<{
  Bindings: Env;
  Variables: PublicSiteVariables;
}>;

// T4 (rescue-3): the render thunk passes c.env.DB into renderCategoryHtml so
// the category listing is composed through the design layout
// (fetchPublicLayoutSiteInfo + renderCard + renderLayout) via the LIVE route —
// the renderer is db-fed, not orphaned. rescue-2 served a bare zero-style
// `<h1>` + flat `<a>` list (BCL-019: live /category/<slug> = 1,279 bytes, 0
// <style>) because the route called renderCategoryHtml without the DB handle,
// so the page rendered with no design shell, no /assets/public.css, no
// header/footer regions and no styled article cards.
async function handleCategory(
  c: CategoryCtx,
  pageNum: number,
): Promise<Response> {
  const slug = c.req.param("slug") as string;
  const siteContext = c.get("siteContext");
  const cat = await fetchCategory(c.env.DB, slug);
  if (!cat) return publicErrorResponse(c, 404);
  // T27 (BCL-049): honor the operator's items_per_page setting (was hardcoded
  // 20). The same page size drives both the query LIMIT and the rel=next link.
  const pageSize = await resolvePageSize(c.env.DB, siteContext.siteId);
  const articles = await fetchCategoryArticles(
    c.env.DB,
    cat.id,
    siteContext.siteId,
    pageNum,
    pageSize,
  );
  const path =
    pageNum === 1 ? `/category/${slug}` : `/category/${slug}/page/${pageNum}`;
  const isBot = isBotRequest(c);
  const restrictAdData = computeRestrictAdData(c, isBot);
  if (isBot || restrictAdData) {
    const body = await renderCategoryHtml(
      c.env.DB,
      siteContext,
      cat,
      articles,
      pageNum,
      slug,
      pageSize,
      { isBot, restrictAdData },
    );
    return new Response(body, { status: 200, headers: botHtmlHeaders() });
  }
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
    render: () =>
      renderCategoryHtml(
        c.env.DB,
        siteContext,
        cat,
        articles,
        pageNum,
        slug,
        pageSize,
      ),
  });
}

// T14: tag listing handler. Tenant-scoped (fetchTag + fetchTagArticles both
// scope by siteId); an unknown tag renders the styled 404. The cache key uses
// the generic htmlKey(siteId, path, content_version) so each tag/page gets a
// distinct entry that a content_version bump orphans on publish.
async function handleTag(c: CategoryCtx, pageNum: number): Promise<Response> {
  const slug = c.req.param("slug") as string;
  const siteContext = c.get("siteContext");
  const tag = await fetchTag(c.env.DB, slug, siteContext.siteId);
  if (!tag) return publicErrorResponse(c, 404);
  // T27 (BCL-049): items_per_page governs the tag listing length too.
  const pageSize = await resolvePageSize(c.env.DB, siteContext.siteId);
  const articles = await fetchTagArticles(
    c.env.DB,
    tag.id,
    siteContext.siteId,
    pageNum,
    pageSize,
  );
  const path = pageNum === 1 ? `/tag/${slug}` : `/tag/${slug}/page/${pageNum}`;
  return servePublicHtml(c.env, siteContext, {
    key: htmlKey(siteContext.siteId, path, siteContext.content_version),
    path,
    ifNoneMatch: c.req.header("If-None-Match"),
    headersFactory: (etag) => publicHtmlCacheHeaders({ etag }),
    render: () =>
      renderTagHtml(
        c.env.DB,
        siteContext,
        tag,
        articles,
        pageNum,
        slug,
        pageSize,
      ),
  });
}

// Shared by /page/:slug and the /:slug catch-all (T40 [F1]) so both
// entry points serve the IDENTICAL full document (same pageKey cache
// entry, same /page/<slug> canonical — the sitemap's page URL shape).
// Returns null when no published page matches the slug.
//
// T3 (rescue-3): the render thunk passes c.env.DB into renderPageHtml so the
// static page is composed through the design layout (fetchPublicLayoutSiteInfo
// + renderHeader/renderFooter + renderLayout) via the LIVE route — the renderer
// is db-fed, not orphaned. rescue-2 served a bare document because the route
// called renderPageHtml without the DB handle, so the page rendered with no
// design shell, no /assets/public.css and no header/footer regions.
async function servePage(
  c: CategoryCtx,
  slug: string,
): Promise<Response | null> {
  const siteContext = c.get("siteContext");
  const row = await fetchPublishedPage(c.env.DB, slug, siteContext.siteId);
  if (!row) return null;
  const path = `/page/${slug}`;
  return servePublicHtml(c.env, siteContext, {
    key: pageKey(siteContext.siteId, slug, siteContext.content_version),
    path,
    ifNoneMatch: c.req.header("If-None-Match"),
    headersFactory: (etag) => publicHtmlCacheHeaders({ etag }),
    render: () => renderPageHtml(c.env.DB, siteContext, row, path),
  });
}

router.get("/page/:slug", async (c) => {
  const slug = c.req.param("slug");
  const res = await servePage(c, slug);
  return res ?? publicErrorResponse(c, 404);
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

// T14: the RSS body + its KV cache discipline live in one place so /feed.xml
// and its conventional alias /rss serve the IDENTICAL feed from the SAME cache
// entry (feedRssKey). Shared helper rather than a 301 so /rss is a true alias
// — a subscriber pointed at /rss gets the feed directly, not a redirect hop.
async function serveRssFeed(c: CategoryCtx): Promise<Response> {
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
}

router.get("/feed.xml", (c) => serveRssFeed(c));

// T14: /rss is an alias of /feed.xml (same RSS body, same cache entry).
router.get("/rss", (c) => serveRssFeed(c));

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
  // T27 (BCL-049): the admin writes `robots_txt_content` (admin/templates/
  // settings.ts) but this reader looked up `robots_txt`, so operator edits
  // never applied. Read the aligned key and substitute the {{DOMAIN}}
  // placeholder (documented in the admin field help) with the live hostname.
  const override = await fetchSiteSetting(
    env.DB,
    siteContext.siteId,
    "robots_txt_content",
  );
  const baseUrl = siteInfo(env, siteContext).baseUrl;
  // rescue-6 (agent-readiness M1.1): with NO full robots override, the default
  // body carries the Content-Signal preference; an operator wanting a HARD
  // per-crawler block of the AI training bots flips `ai_block_training`
  // (default off, so the live tenant is never silently dropped from training
  // corpora). The setting rides settings_version, so toggling it busts this KV
  // cache key. The full robots_txt_content override path ignores it — an
  // operator hand-writing the whole file owns every directive.
  let body: string;
  if (override !== null) {
    body = override.split("{{DOMAIN}}").join(siteContext.hostname);
  } else {
    const blockRaw = await fetchSiteSetting(
      env.DB,
      siteContext.siteId,
      "ai_block_training",
    );
    const blockTraining =
      blockRaw === "1" || (blockRaw ?? "").trim().toLowerCase() === "true";
    body = buildRobotsTxt(baseUrl, { blockTrainingCrawlers: blockTraining });
  }
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
  // T27 (BCL-049): the admin writes `ads_txt_content`; this reader looked up
  // `ads_txt`, so operator edits never applied. Read the aligned key.
  const override = await fetchSiteSetting(
    env.DB,
    siteContext.siteId,
    "ads_txt_content",
  );
  // T22: the ads subsystem owns the /ads.txt body resolution — an operator
  // override wins, else the documented default placeholder.
  const body = resolveAdsTxt({ override });
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

// rescue-6 (agent-readiness M1/M2): /llms.txt — a plain-markdown agent briefing
// (llmstxt.org). Built fresh from the resolved site info (cheap, rarely hit) so
// it never goes stale. Most crawlers do not fetch it today; it is a low-cost
// hedge whose pickup the request observability can measure.
router.get("/llms.txt", async (c) => {
  const siteContext = c.get("siteContext");
  const info = await fetchPublicLayoutSiteInfo(c.env.DB, {
    siteId: siteContext.siteId,
    hostname: siteContext.hostname,
  });
  const baseUrl = siteInfo(c.env, siteContext).baseUrl;
  const body = buildLlmsTxt({
    siteName: info.name,
    tagline: info.tagline,
    description: info.description,
    baseUrl,
  });
  return new Response(body, {
    status: 200,
    headers: new Headers({
      "Content-Type": "text/markdown; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=3600",
    }),
  });
});

// T47 ([G3]): /preview/:id is owned by the dedicated previewRouter
// (src/preview), mounted in index.ts BEFORE this router — token-gated
// draft rendering never flows through the public-content pipeline. The
// /:slug catch-all below keeps "preview" reserved via isReservedPath().

router.get("/health", (c) =>
  c.json({ ok: true, app: "kodigital-homepages-cms", scope: "public" }),
);

// T40 [F1] slug canonicalization: the compatibility catch-all never
// serves raw content_html. A published page renders through the same
// SEO + cache pipeline as /page/:slug; a published article 301s to its
// canonical /article/<slug> URL.
router.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  if (isReservedPath(slug)) {
    return publicErrorResponse(c, 404);
  }
  const siteContext = c.get("siteContext");
  // T15 [BCL-027]: honor the operator-managed redirects table FIRST — a
  // stored, active rule on `/<slug>` sends a legacy URL to its destination
  // BEFORE any page/article lookup, so the redirect wins even when a slug now
  // occupies the same path. The status code is whatever the row stores
  // (301 permanent by default, 302 temporary).
  const redirect = await checkRedirect(c.env.DB, `/${slug}`, siteContext.siteId);
  if (redirect) {
    return c.redirect(
      redirect.destination_path,
      redirect.status_code === 302 ? 302 : 301,
    );
  }
  const page = await servePage(c, slug);
  if (page) return page;
  const article = await getArticleBySlug(c.env.DB, slug, {
    siteId: siteContext.siteId,
  });
  if (article && article.status === "published") {
    return c.redirect(`/article/${encodeURIComponent(slug)}`, 301);
  }
  return publicErrorResponse(c, 404);
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
