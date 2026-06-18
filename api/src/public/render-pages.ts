// T11: render helpers for public HTML routes. Composes the T8 SEO head +
// T9/T10 JSON-LD blocks + the underlying body into a complete HTML document
// so the router's cache pipeline can store fully-rendered pages.
//
// Tenant-boundary contract: every canonical URL is derived from the
// resolved SiteContext.hostname. The admin host MUST NEVER appear as a
// canonical href / og:url on a content page (mission RED LINE).

import type { ArticleRow } from "../db";
import type { PublicSiteContext } from "./middleware";
import type { PublicPageRow, PublicCategoryRow, PublicTagRow } from "./queries";
import { fetchPublicLayoutSiteInfo, PUBLIC_PAGE_SIZE } from "./queries";
import { renderHeader, renderFooter, renderCard, renderAdSlot } from "./templates/components";
import {
  loadAdsConfig,
  shouldShowAds,
  renderAdProviderHead,
  renderAdManagerScript,
  type AdsConfig,
} from "./ads";
import { buildCanonicalUrl } from "./templates/seo-head";
import {
  renderArticleJsonLd,
  renderBreadcrumbJsonLd,
  renderFaqJsonLd,
} from "./templates/jsonld-article";
import { buildArticleViewModel } from "./view-models/article";
import {
  renderHomeWebsiteJsonLd,
  renderHomeOrganizationJsonLd,
  renderHomeItemListJsonLd,
  renderCategoryJsonLd,
  renderWebPageJsonLd,
} from "./templates/jsonld-home-category-page";
import { buildHomeViewModel, type HomeArticleCard } from "./view-models/home";
import { renderHome } from "./templates/home";
import { renderArticle } from "./templates/article";
import { renderLayout } from "./templates/layout";
import { renderCustomHead, renderCustomFooter } from "../settings/custom-html";

// T23: load the per-site operator snippets (custom_head_html / analytics_script
// / ad_header_script / custom_footer_html) and return the SANITIZED <head>/
// footer fragments renderLayout injects into the LIVE page. Every public
// surface calls this so the stored snippets finally render (BCL-045) — safely.
async function loadCustomLayoutHtml(
  db: D1Database,
  siteId: string,
): Promise<{ customHead?: string; customFooter?: string }> {
  const result = await db
    .prepare("SELECT key AS key, value AS value FROM site_settings WHERE site_id = ?")
    .bind(siteId)
    .all<{ key: string; value: string | null }>();
  const settings: Record<string, string> = {};
  for (const row of result.results ?? []) {
    if (typeof row.value === "string") settings[row.key] = row.value;
  }
  const customHead = renderCustomHead(settings);
  const customFooter = renderCustomFooter(settings);
  return {
    customHead: customHead.length > 0 ? customHead : undefined,
    customFooter: customFooter.length > 0 ? customFooter : undefined,
  };
}

function isoDate(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds)) return new Date(0).toISOString();
  return new Date(seconds * 1000).toISOString();
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// T22: the ad <head> payload — the provider library script + the AdManager
// client JS — emitted ONLY when ads are live for this page (shouldShowAds).
// Returns "" otherwise so the <head> composition is byte-identical on
// no-ads pages (disabled config, excluded page, or signed-in viewer).
function adHeadHtml(config: AdsConfig, on: boolean): string {
  if (!on) return "";
  return `${renderAdProviderHead(config)}\n${renderAdManagerScript(config)}`;
}

// T1 (rescue-3): the LIVE GET / handler composes the design homepage
// through buildHomeViewModel + renderHome + renderLayout — NOT the bare
// article-list fallback. The DB is threaded from c.env.DB (router.ts) so
// the renderer is wired into the live entry; rescue-2 shipped a route that
// called no db-fed renderer, so the public homepage rendered the bare
// fallback (no design shell, no 13 sections, no brand tokens).
//
// renderLayout owns the full <head> (Nunito + /assets/public.css + the
// inline `--tw-*` brand-token <style> sourced from site_settings
// .brand_tokens_json) plus the <main> scaffold; renderHome owns the 13
// ordered home sections (design-contract §7). The homepage emits WebSite +
// Organization (+ ItemList when there are stories) JSON-LD only — NO
// BreadcrumbList / FAQPage (a one-item home breadcrumb is a negative GEO
// signal, GEO §1/§2).
export async function renderHomepageHtml(
  db: D1Database,
  siteContext: PublicSiteContext,
): Promise<string> {
  const vm = await buildHomeViewModel(db, {
    siteId: siteContext.siteId,
    hostname: siteContext.hostname,
  });
  const canonicalUrl = vm.meta.canonicalUrl;

  // Disjoint buckets (trending removed from the pool, hero = featured[0],
  // featured excludes hero, latest excludes featured) — flatten for the
  // ItemList without de-duping.
  const listed: HomeArticleCard[] = [
    ...(vm.hero !== null ? [vm.hero] : []),
    ...vm.featured,
    ...vm.trending,
    ...vm.latest,
  ];

  const jsonLd: string[] = [
    renderHomeWebsiteJsonLd({
      url: canonicalUrl,
      name: vm.site.name,
      searchRouteEnabled: false,
    }),
    renderHomeOrganizationJsonLd({
      url: canonicalUrl,
      name: vm.site.name,
    }),
  ];
  if (listed.length > 0) {
    jsonLd.push(
      renderHomeItemListJsonLd({
        items: listed.map((c) => ({
          name: c.title,
          url: buildCanonicalUrl(siteContext.hostname, c.href),
        })),
        listName: `Articles on ${vm.site.name}`,
      }),
    );
  }

  // T22: home is one of the ad-bearing surfaces. Load the per-site ad config
  // and gate on shouldShowAds("/") — the §5 leaderboard + §9 in-feed slots
  // carry real <ins> units and the head loads the provider + AdManager JS.
  const adsConfig = await loadAdsConfig(db, siteContext.siteId);
  const adsOn = shouldShowAds(adsConfig, { path: "/", loggedIn: false });
  const adHead = adHeadHtml(adsConfig, adsOn);
  const customHtml = await loadCustomLayoutHtml(db, siteContext.siteId);

  const body = renderHome({ vm, ads: adsOn ? adsConfig : undefined });
  return renderLayout({
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
      canonicalUrl,
      ogImage: vm.hero?.imageUrl ?? null,
      jsonLd,
    },
    body,
    extraHead: adHead.length > 0 ? adHead : undefined,
    customHead: customHtml.customHead,
    customFooter: customHtml.customFooter,
  });
}

// T2 (rescue-3): the LIVE GET /article/:slug handler composes the design
// article shell through buildArticleViewModel + renderArticle + renderLayout
// — NOT the rescue-2 bare `<div>${content_html}</div>` fallback. The DB is
// threaded from c.env.DB (router.ts) so the renderer is db-fed and wired into
// the live entry; rescue-2 served bare HTML (no design shell, no 12 §8
// sections, no header/footer, no per-article SEO head). renderArticle owns
// the design body (reading-progress + header + article-hero + .article-shell
// with its 12 ordered sections + footer); renderLayout owns the <head>
// (Nunito + /assets/public.css + the inline `--tw-*` brand-token override +
// the per-article SEO title/description from the view-model).
//
// The GEO-conformant Article + root-first BreadcrumbList (+ FAQPage only when
// the article carries FAQ blocks) JSON-LD is emitted ONCE — in the <head> via
// renderLayout.extraHead, sourced from the view-model. renderArticle is
// therefore composed with emitJsonLd:false so the page never carries a second
// (compact, design-template) Article block. The canonical href is always the
// resolved SiteContext.hostname — the admin host MUST NEVER appear (RED LINE).
export async function renderArticleHtml(
  db: D1Database,
  siteContext: PublicSiteContext,
  slug: string,
): Promise<string> {
  const vm = await buildArticleViewModel(db, {
    slug,
    siteContext: {
      siteId: siteContext.siteId,
      hostname: siteContext.hostname,
    },
  });
  if (vm === null) {
    // The router's getArticleBySlug gate already proved this slug is a
    // published article before this render thunk runs (cold-cache only), so a
    // null view-model here is an unpublish/delete race between the two
    // cold-cache queries. Surface it rather than caching an empty shell.
    throw new Error(
      `renderArticleHtml: article '${slug}' not found for site ${siteContext.siteId}`,
    );
  }

  const canonicalUrl = vm.meta.canonicalUrl;

  // GEO checklist (docs/geo-checklist.md §1–§5): one Article block whose
  // @id + mainEntityOfPage are the canonical URL, a Person byline (or the
  // publisher Organization for anonymous content, §3), ISO-8601
  // datePublished/dateModified (§4 — dateModified falls back to
  // datePublished when the row has no update). The root-first BreadcrumbList
  // (§2) carries absolute canonical-host URLs; the FAQPage (§1) is emitted
  // ONLY when faqs are present (an empty FAQPage is a negative signal).
  const jsonLdHead: string[] = [
    renderArticleJsonLd({
      url: canonicalUrl,
      headline: vm.article.title,
      datePublished: vm.article.publishedAt,
      dateModified:
        vm.article.updatedAt.length > 0
          ? vm.article.updatedAt
          : vm.article.publishedAt,
      authorName: vm.article.author?.name ?? siteContext.hostname,
      authorType: vm.article.author !== null ? "Person" : "Organization",
      publisherName: siteContext.hostname,
    }),
    renderBreadcrumbJsonLd({
      items: vm.breadcrumb.map((b) => ({
        name: b.name,
        url: buildCanonicalUrl(siteContext.hostname, b.url),
      })),
    }),
  ];
  if (vm.faqs.length > 0) {
    jsonLdHead.push(
      renderFaqJsonLd({
        questions: vm.faqs.map((f) => ({
          question: f.question,
          answer: f.answer,
        })),
      }),
    );
  }

  // T22: article is an ad-bearing surface. Gate on shouldShowAds for this
  // article path so the §11 sidebar rectangle carries its real <ins> unit and
  // the head loads the provider + AdManager JS (appended after the JSON-LD).
  const adsConfig = await loadAdsConfig(db, siteContext.siteId);
  const adsOn = shouldShowAds(adsConfig, {
    path: `/article/${slug}`,
    loggedIn: false,
  });
  const adHead = adHeadHtml(adsConfig, adsOn);
  const customHtml = await loadCustomLayoutHtml(db, siteContext.siteId);

  const body = renderArticle({
    vm,
    emitJsonLd: false,
    ads: adsOn ? adsConfig : undefined,
  });

  return renderLayout({
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
      canonicalUrl,
      ogImage: vm.meta.ogImage,
      // T13-AC1: an article render's head carries og:type=article +
      // article:published_time/modified_time (+ section/author) + twitter:card
      // + canonical. The article:* namespace is emitted by renderSeoHead only
      // because ogType is "article" here.
      ogType: "article",
      articlePublishedTime: vm.meta.publishedAt,
      articleModifiedTime: vm.meta.modifiedAt,
      articleSection: vm.article.categoryName.length > 0
        ? vm.article.categoryName
        : undefined,
      articleAuthor: vm.article.author?.name,
    },
    body,
    extraHead:
      adHead.length > 0
        ? `${jsonLdHead.join("\n")}\n${adHead}`
        : jsonLdHead.join("\n"),
    customHead: customHtml.customHead,
    customFooter: customHtml.customFooter,
  });
}

// T4 (rescue-3): the LIVE GET /category/:slug handler composes the category
// listing through fetchPublicLayoutSiteInfo + renderCard + renderLayout — NOT
// the rescue-2 bare zero-style `<h1>` + flat `<a>` list. BCL-019 (W1-EXTENDED)
// found the live /category/<slug> rendering BARE (1,279 bytes, 0 <style>); the
// orphaned-render defect covered home + article + page + CATEGORY, and this is
// the fourth renderer wired into the design layout. The DB is threaded from
// c.env.DB (router.ts) so the renderer is db-fed and wired into the live entry.
// renderLayout owns the <head> (Nunito + /assets/public.css + the inline
// `--tw-*` brand-token override sourced from site_settings.brand_tokens_json)
// plus the banner/contentinfo regions via its header/footer slots; the body is
// the design card grid (renderCard → `.card` article cards using the Home
// §4/§10 `home-grid` vocabulary), not the bare anchor list.
//
// Paginated category pages canonical to page 1 (no duplicate-content signal):
// the canonical href + breadcrumb both point at /category/<slug> regardless of
// pageNum, and the page number rides a data-page attribute only (never a
// /category/<slug>/page/<n> URL in the body). The GEO-conformant CollectionPage
// + root-first BreadcrumbList JSON-LD is emitted ONCE in the <head> via
// renderLayout.extraHead (both renderers already return wrapped <script> tags).
// The canonical href is always the resolved SiteContext.hostname — the admin
// host MUST NEVER appear (mission RED LINE).
export async function renderCategoryHtml(
  db: D1Database,
  siteContext: PublicSiteContext,
  cat: PublicCategoryRow,
  articles: ArticleRow[],
  pageNum: number,
  slug: string,
  pageSize: number = PUBLIC_PAGE_SIZE,
): Promise<string> {
  const site = await fetchPublicLayoutSiteInfo(db, {
    siteId: siteContext.siteId,
    hostname: siteContext.hostname,
  });
  const customHtml = await loadCustomLayoutHtml(db, siteContext.siteId);

  // Paginated category pages canonical to page 1 (no duplicate-content signal).
  const canonicalPath = `/category/${slug}`;
  const canonicalUrl = buildCanonicalUrl(siteContext.hostname, canonicalPath);
  const articleEntries = articles.map((a) => ({
    name: a.title,
    url: buildCanonicalUrl(siteContext.hostname, `/article/${a.slug}`),
  }));

  const headerSite = {
    name: site.name,
    tagline: site.tagline,
    logoUrl: site.logoUrl,
    hostname: site.hostname,
  };

  const jsonLdHead: string[] = [
    renderCategoryJsonLd({
      url: canonicalUrl,
      name: cat.name,
      articles: articleEntries,
    }),
    // GEO checklist §2: content routes emit a root-first BreadcrumbList.
    renderBreadcrumbJsonLd({
      items: [
        { name: "Home", url: buildCanonicalUrl(siteContext.hostname, "/") },
        { name: cat.name, url: canonicalUrl },
      ],
    }),
  ];

  // Design card grid: renderCard emits the styled `.card` article cards; the
  // listing rides the same `home-grid` wrapper Home uses for its card sections.
  // pageNum is surfaced as a data-page attribute only — never a /page/<n> URL,
  // which would be a duplicate-content signal against the page-1 canonical.
  const cards = articles
    .map(
      (a) =>
        `<li class="home-grid__item">${renderCard({
          href: `/article/${a.slug}`,
          title: a.title,
          categoryName: cat.name,
          publishedAt: a.published_at ? isoDate(a.published_at) : undefined,
        })}</li>`,
    )
    .join("");
  const listing =
    cards.length > 0
      ? `<ul class="home-grid home-grid--category">${cards}</ul>`
      : `<p class="section-empty">No articles in this category yet.</p>`;
  // T22: category is an ad-bearing surface. Gate on shouldShowAds for this
  // category path; when live, a leaderboard slot rides above the listing and
  // the head loads the provider + AdManager JS.
  const adsConfig = await loadAdsConfig(db, siteContext.siteId);
  const adsOn = shouldShowAds(adsConfig, {
    path: `/category/${slug}`,
    loggedIn: false,
  });
  const adHead = adHeadHtml(adsConfig, adsOn);
  const adSlot = adsOn
    ? renderAdSlot({
        type: "leaderboard",
        slotId: "category-leaderboard",
        surface: "category",
        ads: adsConfig,
      })
    : "";

  const body =
    `<section class="home-section home-section--category" data-page="${pageNum}">` +
    `<div class="container">` +
    `<div class="section-head"><h1 class="category-title">${escapeHtml(cat.name)}</h1></div>` +
    adSlot +
    listing +
    `</div></section>`;

  // T13-AC2: paginated category pages (page >= 2) are noindex,follow — the
  // page-1 canonical owns the index entry while the crawler still follows the
  // article links — and carry rel=prev/next so the crawler walks the series.
  // prev points at page 1 as the bare /category/<slug> (its canonical shape);
  // next is emitted only when the current page is full (likely more to come).
  const prevPath =
    pageNum > 1
      ? pageNum - 1 === 1
        ? `/category/${slug}`
        : `/category/${slug}/page/${pageNum - 1}`
      : null;
  const nextPath =
    articles.length >= pageSize
      ? `/category/${slug}/page/${pageNum + 1}`
      : null;
  const paginationLinks: Array<{ rel: string; href: string }> = [];
  if (prevPath !== null) {
    paginationLinks.push({
      rel: "prev",
      href: buildCanonicalUrl(siteContext.hostname, prevPath),
    });
  }
  if (nextPath !== null) {
    paginationLinks.push({
      rel: "next",
      href: buildCanonicalUrl(siteContext.hostname, nextPath),
    });
  }

  return renderLayout({
    site: {
      name: site.name,
      hostname: site.hostname,
      tagline: site.tagline,
      description: site.description,
      brandTokens: site.brandTokens,
      logoUrl: site.logoUrl,
    },
    meta: {
      title: cat.name,
      description: site.description,
      canonicalUrl,
      robots: pageNum > 1 ? "noindex, follow" : undefined,
      links: paginationLinks.length > 0 ? paginationLinks : undefined,
    },
    body,
    header: renderHeader({ site: headerSite }),
    footer: renderFooter({ site: headerSite }),
    customHead: customHtml.customHead,
    customFooter: customHtml.customFooter,
    extraHead:
      adHead.length > 0
        ? `${jsonLdHead.join("\n")}\n${adHead}`
        : jsonLdHead.join("\n"),
  });
}

// T14: the LIVE GET /tag/:slug handler composes the tag listing through the
// same design layout the category listing uses (fetchPublicLayoutSiteInfo +
// renderCard + renderLayout) — a topic page is a styled collection of the
// published articles carrying that tag, not a bare list. Mirrors
// renderCategoryHtml: the canonical href is always /tag/<slug> (page 1), the
// page number rides a data-page attribute only, paginated pages (page >= 2)
// are noindex,follow with rel=prev/next, and the CollectionPage +
// root-first BreadcrumbList JSON-LD ride the head once. The canonical href is
// always the resolved SiteContext.hostname — the admin host MUST NEVER appear
// (mission RED LINE).
export async function renderTagHtml(
  db: D1Database,
  siteContext: PublicSiteContext,
  tag: PublicTagRow,
  articles: ArticleRow[],
  pageNum: number,
  slug: string,
  pageSize: number = PUBLIC_PAGE_SIZE,
): Promise<string> {
  const site = await fetchPublicLayoutSiteInfo(db, {
    siteId: siteContext.siteId,
    hostname: siteContext.hostname,
  });
  const customHtml = await loadCustomLayoutHtml(db, siteContext.siteId);

  // Paginated tag pages canonical to page 1 (no duplicate-content signal).
  const canonicalPath = `/tag/${slug}`;
  const canonicalUrl = buildCanonicalUrl(siteContext.hostname, canonicalPath);
  const articleEntries = articles.map((a) => ({
    name: a.title,
    url: buildCanonicalUrl(siteContext.hostname, `/article/${a.slug}`),
  }));

  const headerSite = {
    name: site.name,
    tagline: site.tagline,
    logoUrl: site.logoUrl,
    hostname: site.hostname,
  };

  const jsonLdHead: string[] = [
    renderCategoryJsonLd({
      url: canonicalUrl,
      name: tag.name,
      articles: articleEntries,
    }),
    renderBreadcrumbJsonLd({
      items: [
        { name: "Home", url: buildCanonicalUrl(siteContext.hostname, "/") },
        { name: tag.name, url: canonicalUrl },
      ],
    }),
  ];

  const cards = articles
    .map(
      (a) =>
        `<li class="home-grid__item">${renderCard({
          href: `/article/${a.slug}`,
          title: a.title,
          publishedAt: a.published_at ? isoDate(a.published_at) : undefined,
        })}</li>`,
    )
    .join("");
  const listing =
    cards.length > 0
      ? `<ul class="home-grid home-grid--tag">${cards}</ul>`
      : `<p class="section-empty">No articles tagged "${escapeHtml(tag.name)}" yet.</p>`;
  const body =
    `<section class="home-section home-section--tag" data-page="${pageNum}">` +
    `<div class="container">` +
    `<div class="section-head"><h1 class="tag-title">${escapeHtml(tag.name)}</h1></div>` +
    listing +
    `</div></section>`;

  // page >= 2 is noindex,follow (the page-1 canonical owns the index entry)
  // and carries rel=prev/next so the crawler walks the series.
  const prevPath =
    pageNum > 1
      ? pageNum - 1 === 1
        ? `/tag/${slug}`
        : `/tag/${slug}/page/${pageNum - 1}`
      : null;
  const nextPath =
    articles.length >= pageSize
      ? `/tag/${slug}/page/${pageNum + 1}`
      : null;
  const paginationLinks: Array<{ rel: string; href: string }> = [];
  if (prevPath !== null) {
    paginationLinks.push({
      rel: "prev",
      href: buildCanonicalUrl(siteContext.hostname, prevPath),
    });
  }
  if (nextPath !== null) {
    paginationLinks.push({
      rel: "next",
      href: buildCanonicalUrl(siteContext.hostname, nextPath),
    });
  }

  return renderLayout({
    site: {
      name: site.name,
      hostname: site.hostname,
      tagline: site.tagline,
      description: site.description,
      brandTokens: site.brandTokens,
      logoUrl: site.logoUrl,
    },
    meta: {
      title: tag.name,
      description: site.description,
      canonicalUrl,
      robots: pageNum > 1 ? "noindex, follow" : undefined,
      links: paginationLinks.length > 0 ? paginationLinks : undefined,
    },
    body,
    header: renderHeader({ site: headerSite }),
    footer: renderFooter({ site: headerSite }),
    customHead: customHtml.customHead,
    customFooter: customHtml.customFooter,
    extraHead: jsonLdHead.join("\n"),
  });
}

// T3 (rescue-3): the LIVE GET /page/:slug handler composes the static page
// through fetchPublicLayoutSiteInfo + renderHeader/renderFooter + renderLayout
// — NOT the rescue-2 bare `wrapHtmlDocument(head, content_html)` fallback. The
// DB is threaded from c.env.DB (router.ts) so the renderer is db-fed and wired
// into the live entry; rescue-2 served a bare document (no design shell, no
// /assets/public.css, no site-header / site-footer regions). renderLayout owns
// the <head> (Nunito + /assets/public.css + the inline `--tw-*` brand-token
// override sourced from site_settings.brand_tokens_json) plus the
// banner/contentinfo regions via its header/footer slots; the page body is the
// row's content_html under an <article>.
//
// The GEO-conformant WebPage + root-first BreadcrumbList JSON-LD is emitted
// ONCE — in the <head> via renderLayout.extraHead (renderWebPageJsonLd /
// renderBreadcrumbJsonLd already return wrapped <script> tags, so they ride
// extraHead verbatim, exactly like the article renderer). The canonical href is
// always the resolved SiteContext.hostname — the admin host MUST NEVER appear
// (mission RED LINE).
export async function renderPageHtml(
  db: D1Database,
  siteContext: PublicSiteContext,
  row: PublicPageRow,
  path: string,
): Promise<string> {
  const site = await fetchPublicLayoutSiteInfo(db, {
    siteId: siteContext.siteId,
    hostname: siteContext.hostname,
  });
  const customHtml = await loadCustomLayoutHtml(db, siteContext.siteId);
  const canonicalUrl = buildCanonicalUrl(siteContext.hostname, path);

  const headerSite = {
    name: site.name,
    tagline: site.tagline,
    logoUrl: site.logoUrl,
    hostname: site.hostname,
  };

  const jsonLdHead: string[] = [
    renderWebPageJsonLd({
      url: canonicalUrl,
      name: row.title,
      dateModified: row.updated_at ? isoDate(row.updated_at) : undefined,
    }),
    // GEO checklist §2: content routes emit a root-first BreadcrumbList.
    renderBreadcrumbJsonLd({
      items: [
        { name: "Home", url: buildCanonicalUrl(siteContext.hostname, "/") },
        { name: row.title, url: canonicalUrl },
      ],
    }),
  ];

  const body =
    `<article class="page-article">` +
    `<h1 class="page-title">${escapeHtml(row.title)}</h1>` +
    `<div class="page-content">${row.content_html ?? ""}</div>` +
    `</article>`;

  return renderLayout({
    site: {
      name: site.name,
      hostname: site.hostname,
      tagline: site.tagline,
      description: site.description,
      brandTokens: site.brandTokens,
      logoUrl: site.logoUrl,
    },
    meta: {
      title: row.title,
      description: site.description,
      canonicalUrl,
    },
    body,
    header: renderHeader({ site: headerSite }),
    footer: renderFooter({ site: headerSite }),
    customHead: customHtml.customHead,
    customFooter: customHtml.customFooter,
    extraHead: jsonLdHead.join("\n"),
  });
}
