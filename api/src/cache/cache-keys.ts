// Canonical cache-key formatters for kodigital-homepages-cms Phase-7 SEO.
//
// All public-facing cache keys flow through this module so that the wire
// format stays consistent across the router, edge-cache layer, KV bridge,
// publish workflow, invalidate helpers, and warm helpers. Keeping every
// formatter here also makes it easy to grep for cross-site key construction
// and to bump TEMPLATE_VERSION when the rendered HTML shape changes.
//
// Doc-prescribed shapes (proposal.md §"Chosen"):
//   html:{site_id}:{path}:{content_version}:{template_version}
//   homepage-data:{site_id}:{content_version}
//   article:{site_id}:{slug}:{content_version}:{template_version}
//   category:{site_id}:{slug}:{page}:{content_version}:{template_version}
//   page:{site_id}:{slug}:{content_version}:{template_version}
//   sitemap:{site_id}:{content_version}
//   feed:rss:{site_id}:{content_version}
//   feed:atom:{site_id}:{content_version}
//   settings:{site_id}:{settings_version}
//   robots:{site_id}:{settings_version}
//   ads:{site_id}:{settings_version}
//
// site_id is the FIRST component after the namespace so per-site list+invalidate
// stays cheap (env.CACHE.list({ prefix: "html:st_abc:" })). Versions are
// SUFFIXES so a content_version bump orphans old entries without explicit
// deletes (explicit delete in invalidate.ts is a courtesy, not a correctness
// dependency).

// TEMPLATE_VERSION is bumped whenever the rendered HTML shape changes in a
// way that should invalidate ALL public HTML caches across every tenant.
// Bumping content_version on a single site only invalidates that site's
// keys; bumping TEMPLATE_VERSION here invalidates every cached HTML key
// across every site at once (the suffix changes for every key).
export const TEMPLATE_VERSION = 1 as const;

// Namespace prefixes — these are the wire identifiers that appear at the
// start of every cache key. Keep them in sync with the field_contract.fields
// table in the implementation digest (Section "Field Contracts (canonical →
// wire)" for Story T1).
const NS_HTML = "html";
const NS_HOMEPAGE_DATA = "homepage-data";
const NS_ARTICLE = "article";
const NS_CATEGORY = "category";
const NS_PAGE = "page";
const NS_SITEMAP = "sitemap";
const NS_FEED_RSS = "feed:rss";
const NS_FEED_ATOM = "feed:atom";
const NS_SETTINGS = "settings";
const NS_ROBOTS = "robots";
const NS_ADS = "ads";

function requireSiteId(siteId: string): string {
  // RED LINE: forbidden_substitutes for site_id include null/undefined/empty
  // — emitting any of those produces a cross-site key (e.g. "html::/foo:1:1")
  // that collides between tenants. Refuse fast at key construction so the
  // bad key never reaches KV.
  if (siteId === null || siteId === undefined) {
    throw new Error("cache-keys: site_id is required (got null/undefined)");
  }
  const trimmed = String(siteId).trim();
  if (trimmed.length === 0) {
    throw new Error("cache-keys: site_id must be a non-empty tenant id");
  }
  return trimmed;
}

function normalizePath(path: string): string {
  // Cache key path component normalization: leading slash is preserved so the
  // key matches what the router observes (req.path always starts with "/"),
  // trailing slashes are stripped except for the root path so "/article/foo"
  // and "/article/foo/" share one cache entry.
  if (path.length === 0) return "/";
  if (!path.startsWith("/")) path = `/${path}`;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path;
}

export function htmlKey(
  siteId: string,
  path: string,
  contentVersion: number,
): string {
  return `${NS_HTML}:${requireSiteId(siteId)}:${normalizePath(path)}:${contentVersion}:${TEMPLATE_VERSION}`;
}

export function homepageDataKey(siteId: string, contentVersion: number): string {
  return `${NS_HOMEPAGE_DATA}:${requireSiteId(siteId)}:${contentVersion}`;
}

export function articleKey(
  siteId: string,
  slug: string,
  contentVersion: number,
): string {
  return `${NS_ARTICLE}:${requireSiteId(siteId)}:${slug}:${contentVersion}:${TEMPLATE_VERSION}`;
}

export function categoryKey(
  siteId: string,
  slug: string,
  page: number,
  contentVersion: number,
): string {
  return `${NS_CATEGORY}:${requireSiteId(siteId)}:${slug}:${page}:${contentVersion}:${TEMPLATE_VERSION}`;
}

export function pageKey(
  siteId: string,
  slug: string,
  contentVersion: number,
): string {
  return `${NS_PAGE}:${requireSiteId(siteId)}:${slug}:${contentVersion}:${TEMPLATE_VERSION}`;
}

export function sitemapKey(siteId: string, contentVersion: number): string {
  return `${NS_SITEMAP}:${requireSiteId(siteId)}:${contentVersion}`;
}

export function feedRssKey(siteId: string, contentVersion: number): string {
  return `${NS_FEED_RSS}:${requireSiteId(siteId)}:${contentVersion}`;
}

export function feedAtomKey(siteId: string, contentVersion: number): string {
  return `${NS_FEED_ATOM}:${requireSiteId(siteId)}:${contentVersion}`;
}

export function settingsKey(siteId: string, settingsVersion: number): string {
  return `${NS_SETTINGS}:${requireSiteId(siteId)}:${settingsVersion}`;
}

export function robotsKey(siteId: string, settingsVersion: number): string {
  return `${NS_ROBOTS}:${requireSiteId(siteId)}:${settingsVersion}`;
}

export function adsKey(siteId: string, settingsVersion: number): string {
  return `${NS_ADS}:${requireSiteId(siteId)}:${settingsVersion}`;
}

// Listicles Phase 6 (design contract §22) — ADDITIVE key formatters.
//
// listicleKey: `html:{site_id}:/{slug}:{lander_v}:{content_version}:{template_version}`
// — the per-Version cached shell. `lander_v` (= the rendered Version's
// public_id, §15.6) is IN the key so each article-A/B Version is a distinct
// cached artifact; the Version's own content_version bump (§22.2 fan-out)
// changes cache identity without touching other Versions. Lives in the
// existing `html:` namespace with site_id first, so the per-site
// invalidate/list discipline (prefix `html:{siteId}:`) already covers it,
// and `html:{siteId}:/{slug}:` scopes one article's shells.
export function listicleKey(
  siteId: string,
  slug: string,
  landerV: string,
  contentVersion: number,
): string {
  return `${NS_HTML}:${requireSiteId(siteId)}:${normalizePath(`/${slug}`)}:${landerV}:${contentVersion}:${TEMPLATE_VERSION}`;
}

// Per-candidate lazy-hydration fragment (§22.4 over-budget path,
// GET /lst-cand/:candidate_public_id). Keyed by the OWNING Version's
// content_version — the §22.2 fan-out bumps it on any consumed Section save,
// so candidate fragments and shells change cache identity together.
export function listicleCandidateKey(
  siteId: string,
  candidatePublicId: string,
  versionContentVersion: number,
): string {
  return `${NS_HTML}:${requireSiteId(siteId)}:/lst-cand/${candidatePublicId}:${versionContentVersion}:${TEMPLATE_VERSION}`;
}

// LeadGen Phase 7 (contract 09 §28) — the funnel-shell + client-config cache
// keys. LEADGEN_TEMPLATE_VERSION is the shell-shape version axis: bumping it
// rolls ALL cached funnel shells + configs forward at once (the §28 global
// axis), exactly as TEMPLATE_VERSION does for CMS/Listicles HTML. It is a CODE
// DEFAULT CONSTANT (mirroring TEMPLATE_VERSION above) — NOT a wrangler.toml
// [vars] key — so no Env-interface change and no verify:worker-config impact.
export const LEADGEN_TEMPLATE_VERSION = 1 as const;

const NS_LG_SHELL = "lg-shell";
const NS_LG_CONFIG = "lg-config";

// lg-shell:{site_id}:{quote_slug}:{funnel_id}:{content_version}:{template_version}
// (§28). site_id first so per-site list+invalidate stays cheap
// (env.CACHE.list({ prefix: "lg-shell:{siteId}:" })), versions as suffix so a
// content_version / LEADGEN_TEMPLATE_VERSION bump orphans old entries. The
// single enabled root activation (NULL slug — at most one per site, §17.1) uses
// the EMPTY slug segment; a named activation uses its slug.
export function leadgenShellKey(
  siteId: string,
  quoteSlug: string | null,
  funnelId: string,
  contentVersion: number,
): string {
  const slugSeg = quoteSlug ?? "";
  return `${NS_LG_SHELL}:${requireSiteId(siteId)}:${slugSeg}:${funnelId}:${contentVersion}:${LEADGEN_TEMPLATE_VERSION}`;
}

// lg-config:{site_id}:{funnel_id}:{funnel_variant_id}:{content_version}. The
// public client config bakes in the SITE-SPECIFIC ga4_measurement_id (resolved
// from the activation's settings_overrides_json) and is VARIANT-scoped, so the
// key MUST carry both site_id and funnel_variant_id. A funnel-only key would
// let one funnel activated on two tenant sites share a single entry (whichever
// site warms it first poisons the other → cross-tenant GA4 bleed + §29
// mis-attribution), and would collide across the per-variant configs P8 serves
// while their ETags already differ per variant. site_id is first so per-site
// list+invalidate stays cheap (env.CACHE.list({ prefix: "lg-config:{siteId}:" })),
// then funnel_id + funnel_variant_id, then content_version as the suffix so a
// bump orphans old entries. The /lg/config ETag hashes the SAME material
// (site + funnel + variant + content_version) so key and ETag always agree.
export function leadgenConfigKey(
  siteId: string,
  funnelId: string,
  funnelVariantId: string,
  contentVersion: number,
): string {
  return `${NS_LG_CONFIG}:${requireSiteId(siteId)}:${funnelId}:${funnelVariantId}:${contentVersion}`;
}
