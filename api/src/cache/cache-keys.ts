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
// v2 (Fix-P4): preset output changed — container/leaf components added and
// style() now HTML-escapes values (font-family tokens render as &#39;-encoded
// entities, computed-style identical). Bumping rolls all cached shells/configs
// forward so no mixed pre/post-P4 markup lingers (the axis's whole purpose).
// v3 (redesign v2.5): the SERVED ENGINE bytes changed three times behind the
// immutable /lg/runtime/{version}.js URL — (A) frame dots/back-button/history
// wiring, (B5) footer show_on handling, (E) the aria-valuetext re-stamp — so
// the URL must move with them: a browser holding the pre-v2.5 engine at an
// unchanged /lg/runtime/2.js (max-age=31536000, immutable) would run framed
// funnels with dead frame-back/history, frozen dots, ignored footer.show_on
// and the a11y fix inert for up to a year. Same reason v2.4 bumped 1→2.
export const LEADGEN_TEMPLATE_VERSION = 3 as const;

const NS_LG_SHELL = "lg-shell";
const NS_LG_CONFIG = "lg-config";

// lg-shell:{site_id}:{quote_slug}:{funnel_id}:{funnel_variant_id}:{content_version}:{ab_rev}:{template_version}:{activation_version}
// (§28). The §16.2 A/B assignment is a cheap deterministic edge hash that picks
// WHICH variant to serve, and "the shell is cached per variant" (§28) — so
// funnel_variant_id is IN the key. A running 2-variant test then serves two
// DISTINCT cached shells (one per assigned variant); WITHOUT the variant segment
// two variants sharing a content_version (every variant defaults to 1) collide on
// one entry and serve the wrong variant's shell body (data-funnel-variant-id +
// per-variant design CSS). site_id first so per-site list+invalidate stays cheap
// (env.CACHE.list({ prefix: "lg-shell:{siteId}:" })); versions as suffix so a
// content_version / LEADGEN_TEMPLATE_VERSION bump orphans old entries. The single
// enabled root activation (NULL slug — at most one per site, §17.1) uses the
// EMPTY slug segment; a named activation uses its slug.
// `abRev` (fix-contract v2.4 03 §3.2) is the SAME running-test axis
// leadgenConfigKey carries (the funnel's RUNNING A/B test revision, else 0).
// The shell now BAKES the LeadgenPublicConfig JSON (#lg-config — incl. the
// §16.3 test dims funnel_ab_test_id/funnel_ab_test_revision/variant_label/
// traffic_allocation_bp/assignment_reason) into the cached body, and an A/B
// start/stop/re-bump flips those dims WITHOUT moving content_version — exactly
// the staleness class the leadgenConfigKey comment below documents. Folding
// ab_rev in makes a start (0→N) / stop (N→0) / re-bump mint a FRESH shell key
// (+ the mirrored ETag) so the baked test dims are never served stale until TTL.
// `activationVersion` = leadgen_site_quotes.updated_at (bumps on EVERY activation
// write — enable/disable/slug/settings_overrides). §28 correctness: the shell body
// bakes in the activation's ga4_measurement_id (from settings_overrides_json), and
// a settings-only edit does NOT bump content_version. Without this axis a GA4-id
// change would serve the stale id: the caches.default colo mirror + distributed
// ETag-holders (the ETag mirrors this material) would 304-loop on the old shell
// until an unrelated content/template bump. Folding updated_at in makes any
// activation edit mint a FRESH key + ETag → self-correcting, mirror-safe, no
// invalidation cron dependency (the invalidate.ts pass is then pure courtesy).
// Segment DISCIPLINE: site_id stays index 1 and funnel_id index 3 (the
// invalidate.ts prefix + funnel-narrowing contract); new axes append as suffix
// segments only.
export function leadgenShellKey(
  siteId: string,
  quoteSlug: string | null,
  funnelId: string,
  funnelVariantId: string,
  contentVersion: number,
  abRev: number,
  activationVersion: number,
): string {
  const slugSeg = quoteSlug ?? "";
  return `${NS_LG_SHELL}:${requireSiteId(siteId)}:${slugSeg}:${funnelId}:${funnelVariantId}:${contentVersion}:${abRev}:${LEADGEN_TEMPLATE_VERSION}:${activationVersion}`;
}

// lg-config:{site_id}:{funnel_id}:{funnel_variant_id}:{content_version}:{ab_rev}.
// The public client config bakes in the SITE-SPECIFIC ga4_measurement_id (resolved
// from the activation's settings_overrides_json) and is VARIANT-scoped, so the
// key MUST carry both site_id and funnel_variant_id. A funnel-only key would
// let one funnel activated on two tenant sites share a single entry (whichever
// site warms it first poisons the other → cross-tenant GA4 bleed + §29
// mis-attribution), and would collide across the per-variant configs P8 serves
// while their ETags already differ per variant.
//
// `ab_rev` is the §16.2 running-test axis = the funnel's RUNNING A/B test revision
// when a test is running, else 0. The DTO (config-dto.ts) bakes the §16.3 dims
// (funnel_ab_test_id / funnel_ab_test_revision / assignment_reason / variant_label
// / traffic_allocation_bp) INTO the cached body, but start/stop only flip the test
// status + bump the test revision — they do NOT touch the variant's content_version.
// Without ab_rev in the key, a start (single_control→ab_hash) or stop (ab_hash→
// single_control) would serve the STALE pre-transition body until the TTL (wrong
// §16.3 dims + broken §16.2 edge/client parity). Folding ab_rev in makes start
// (0→N) / stop / re-bump mint a FRESH key → no stale serve, self-correcting with no
// invalidation cron. site_id is first so per-site list+invalidate stays cheap
// (env.CACHE.list({ prefix: "lg-config:{siteId}:" })), then funnel_id +
// funnel_variant_id, then content_version + ab_rev as suffixes so a bump orphans
// old entries. The /lg/config ETag hashes the SAME material (site + funnel +
// variant + content_version + ab_rev) so key and ETag always agree.
// `activationVersion` (leadgen_site_quotes.updated_at) is folded in for the SAME
// reason as leadgenShellKey: the config DTO bakes in the site's ga4_measurement_id
// from settings_overrides_json, and a settings-only edit does not move
// content_version — so without this axis a GA4-id change would 304-loop the stale
// config. An activation edit mints a fresh key + ETag.
export function leadgenConfigKey(
  siteId: string,
  funnelId: string,
  funnelVariantId: string,
  contentVersion: number,
  abRev: number,
  activationVersion: number,
): string {
  return `${NS_LG_CONFIG}:${requireSiteId(siteId)}:${funnelId}:${funnelVariantId}:${contentVersion}:${abRev}:${activationVersion}`;
}
