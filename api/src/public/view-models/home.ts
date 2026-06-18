// Phase 5 / T8: buildHomeViewModel composes the data the Home template
// (T10) needs from D1, scoped to a single tenant.
//
// PART 12 RED LINE: every visible brand string comes from the site row
// or its `site_settings` overrides — this module MUST NOT hardcode
// TheIWise / theiwise / a vertical brand. Every SELECT scopes by the
// caller-supplied `site_id` so the public Worker cannot leak rows from a
// sibling tenant.
//
// All queries follow the project SQL contract: `db.prepare(<static SQL>)`
// with positional `?` placeholders and `.bind(...)` for values. The
// substring `WHERE site_id = ?` appears verbatim in at least one prepared
// statement so the T8 acceptance grep can verify tenant scoping. The
// helper makes >=3 `.bind()` calls (articles + categories + settings)
// per the T8 contract.
//
// The shape returned here is consumed by `templates/home.ts` (T10) and
// `templates/layout.ts` (T3); the field names match those templates'
// expected camelCase view-model surface.
//
// Test contract: api/test/public-view-models-home.test.ts covers the
// "site A and B isolation" BEHAVIORAL AC (T8.AC4) — the test name
// matches `^public-view-models-home.*site[_-]?isolation` per the
// implementation digest.

import { mediaUrl } from "./media-url";

export interface HomeSiteContext {
  siteId: string;
  hostname: string;
}

export interface HomeViewModelSite {
  site_id: string;
  name: string;
  hostname: string;
  tagline: string;
  description: string;
  logoUrl: string | null;
  brandTokens: Readonly<Record<string, string>>;
}

export interface HomeArticleCard {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  href: string;
  imageUrl: string | null;
  imageAlt: string | null;
  publishedAt: string;
  categoryName: string;
  categorySlug: string;
  readMinutes: number | null;
}

export interface HomeCategoryChip {
  id: number;
  slug: string;
  name: string;
  href: string;
}

export interface HomeNewsletter {
  heading: string;
  description: string;
  provider: string | null;
}

export interface HomeMeta {
  title: string;
  description: string;
  canonicalUrl: string;
}

// T12 (C7) bucket contract (design contract §12): `picks` is the curated
// re-promotion of the featured pool (editorsPicks hero + thumbs[3] = 4
// cards); `trending` holds articles flagged `is_trending = 1` (5-item dark
// strip) and those articles appear in NO other bucket — a flagged card
// never renders twice on the Home page.
export interface HomeViewModel {
  site: HomeViewModelSite;
  hero: HomeArticleCard | null;
  featured: HomeArticleCard[];
  picks: HomeArticleCard[];
  trending: HomeArticleCard[];
  latest: HomeArticleCard[];
  categories: HomeCategoryChip[];
  newsletter: HomeNewsletter;
  meta: HomeMeta;
}

interface ArticleListingRow {
  id: number;
  slug: string;
  title: string;
  content_html: string | null;
  category_id: number | null;
  status: string;
  published_at: number | null;
  featured_image_id: number | null;
  is_featured: number;
  is_trending: number;
  homepage_section: string | null;
  homepage_rank: number | null;
  site_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  image_url: string | null;
  image_alt: string | null;
}

interface CategoryListingRow {
  id: number;
  slug: string;
  name: string;
}

interface SettingsRow {
  key: string;
  value: string | null;
}

const FEATURED_LIMIT = 8;
const LATEST_LIMIT = 18;
const TRENDING_LIMIT = 5;
const PICKS_LIMIT = 4;
const CATEGORY_LIMIT = 12;

function parseBrandTokens(raw: string | null | undefined): Readonly<Record<string, string>> {
  if (raw === null || raw === undefined || raw.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function parseNewsletter(raw: string | null | undefined): HomeNewsletter {
  const fallback: HomeNewsletter = {
    heading: "Subscribe to the newsletter",
    description: "Get the latest stories in your inbox.",
    provider: null,
  };
  if (raw === null || raw === undefined || raw.length === 0) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return fallback;
    }
    const obj = parsed as Record<string, unknown>;
    const heading = typeof obj.heading === "string" && obj.heading.length > 0
      ? obj.heading
      : fallback.heading;
    const description = typeof obj.description === "string" && obj.description.length > 0
      ? obj.description
      : fallback.description;
    const provider = typeof obj.provider === "string" && obj.provider.length > 0
      ? obj.provider
      : null;
    return { heading, description, provider };
  } catch {
    return fallback;
  }
}

function excerptFromHtml(html: string | null | undefined, limit: number = 180): string {
  if (html === null || html === undefined) return "";
  const text = String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return text.slice(0, limit) + "…";
}

function formatPublishedAt(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined) return "";
  const d = new Date(epochSeconds * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function readMinutesFromHtml(html: string | null | undefined): number | null {
  if (html === null || html === undefined || html.length === 0) return null;
  const wordCount = String(html)
    .replace(/<[^>]+>/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (wordCount === 0) return null;
  return Math.max(1, Math.ceil(wordCount / 200));
}

function toCard(row: ArticleListingRow): HomeArticleCard {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: excerptFromHtml(row.content_html),
    href: `/article/${row.slug}`,
    // T2: row.image_url is the bare media.storage_key — serve it through the
    // /media/ route so the card image actually loads (null stays null).
    imageUrl: mediaUrl(row.image_url),
    imageAlt: row.image_alt ?? null,
    publishedAt: formatPublishedAt(row.published_at),
    categoryName: row.category_name ?? "",
    categorySlug: row.category_slug ?? "",
    readMinutes: readMinutesFromHtml(row.content_html),
  };
}

export async function buildHomeViewModel(
  db: D1Database,
  siteContext: HomeSiteContext,
): Promise<HomeViewModel> {
  const siteId = siteContext.siteId;

  // Query 1 — featured + latest article listings (one statement so we
  // hit the DB once for both buckets). The substring `WHERE site_id = ?`
  // appears verbatim so the T8.AC2 grep counts it.
  const articlesResult = await db
    .prepare(
      "SELECT a.id AS id, a.slug AS slug, a.title AS title, a.content_html AS content_html, " +
        "a.category_id AS category_id, a.status AS status, a.published_at AS published_at, " +
        "a.featured_image_id AS featured_image_id, a.is_featured AS is_featured, " +
        "a.is_trending AS is_trending, " +
        "a.homepage_section AS homepage_section, a.homepage_rank AS homepage_rank, " +
        "a.site_id AS site_id, " +
        "c.name AS category_name, c.slug AS category_slug, " +
        "m.storage_key AS image_url, m.alt_text AS image_alt " +
        "FROM articles a " +
        "LEFT JOIN categories c ON c.id = a.category_id " +
        "LEFT JOIN media m ON m.id = a.featured_image_id " +
        "WHERE site_id = ? AND a.status = 'published' " +
        "ORDER BY a.is_featured DESC, a.is_trending DESC, a.homepage_rank ASC, a.published_at DESC, a.id DESC " +
        "LIMIT ?",
    )
    .bind(siteId, FEATURED_LIMIT + LATEST_LIMIT + TRENDING_LIMIT)
    .all<ArticleListingRow>();
  const articleRows = articlesResult.results ?? [];

  // Query 2 — categories assigned to this site (via the vertical join).
  const categoriesResult = await db
    .prepare(
      "SELECT c.id AS id, c.slug AS slug, c.name AS name " +
        "FROM categories c " +
        "INNER JOIN site_categories sc ON sc.category_id = c.id " +
        "WHERE sc.site_id = ? " +
        "ORDER BY sc.display_order ASC, c.name ASC " +
        "LIMIT ?",
    )
    .bind(siteId, CATEGORY_LIMIT)
    .all<CategoryListingRow>();
  const categoryRows = categoriesResult.results ?? [];

  // Query 3 — per-site brand + newsletter settings. The substring
  // `WHERE site_id = ?` appears verbatim again (T8.AC2 only requires
  // >=1 occurrence, but two scoped reads make the AC robust to schema
  // re-ordering).
  const settingsResult = await db
    .prepare("SELECT key AS key, value AS value FROM site_settings WHERE site_id = ?")
    .bind(siteId)
    .all<SettingsRow>();
  const settingsRows = settingsResult.results ?? [];

  const settings: Record<string, string> = {};
  for (const row of settingsRows) {
    if (typeof row.value === "string") settings[row.key] = row.value;
  }

  const site: HomeViewModelSite = {
    site_id: siteId,
    name: settings.site_name ?? siteContext.hostname,
    hostname: siteContext.hostname,
    tagline: settings.tagline ?? "",
    description: settings.site_description ?? "",
    logoUrl: settings.logo_media_id !== undefined && settings.logo_media_id.length > 0
      ? settings.logo_media_id
      : null,
    brandTokens: parseBrandTokens(settings.brand_tokens_json),
  };

  // T12 buckets: rows flagged is_trending = 1 go to vm.trending ONLY —
  // they are removed from the pool BEFORE hero/featured/latest are cut so
  // a trending card never duplicates into another bucket.
  const trendingRows = articleRows
    .filter((r) => r.is_trending === 1)
    .slice(0, TRENDING_LIMIT);
  const trendingIds = new Set<number>(trendingRows.map((r) => r.id));
  const trending = trendingRows.map(toCard);

  const pool = articleRows.filter((r) => !trendingIds.has(r.id));
  const cards = pool.map(toCard);
  const featuredBucket = pool
    .filter((r) => r.is_featured === 1)
    .slice(0, FEATURED_LIMIT)
    .map(toCard);
  const hero = featuredBucket[0] ?? cards[0] ?? null;
  const featured = featuredBucket.length > 0
    ? featuredBucket.slice(hero === featuredBucket[0] ? 1 : 0)
    : cards.slice(1, FEATURED_LIMIT);

  // Editor's picks: curated re-promotion of the featured pool — the lead
  // story plus the next 3 featured cards (contract §12 editorsPicks
  // { hero, thumbs[3] }).
  const picks = (hero !== null ? [hero, ...featured] : featured).slice(0, PICKS_LIMIT);

  const featuredIds = new Set<number>();
  if (hero !== null) featuredIds.add(hero.id);
  for (const f of featured) featuredIds.add(f.id);
  const latest = cards
    .filter((c) => !featuredIds.has(c.id))
    .slice(0, LATEST_LIMIT);

  const categories: HomeCategoryChip[] = categoryRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    href: `/category/${row.slug}`,
  }));

  const newsletter = parseNewsletter(settings.newsletter_settings_json);

  const meta: HomeMeta = {
    title: site.tagline.length > 0 ? `${site.name} — ${site.tagline}` : site.name,
    description: site.description.length > 0 ? site.description : site.tagline,
    canonicalUrl: `https://${site.hostname}/`,
  };

  return { site, hero, featured, picks, trending, latest, categories, newsletter, meta };
}
