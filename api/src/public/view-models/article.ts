// Phase 5 / T9: buildArticleViewModel composes the data the Article
// template (T11) needs from D1, scoped to a single tenant.
//
// PART 12 RED LINE: every visible brand string flows from the site row
// or its `site_settings` overrides — this module MUST NOT hardcode
// TheIWise / theiwise / a vertical brand. Every SELECT scopes by the
// caller-supplied `siteId` so the public Worker cannot leak rows from a
// sibling tenant.
//
// All queries follow the project SQL contract: `db.prepare(<static SQL>)`
// with positional `?` placeholders and `.bind(...)` for values. The
// substring `site_id = ?` appears verbatim in at least one prepared
// statement so the T9.AC2 acceptance grep can verify tenant scoping.
//
// `adaptBodyBlocks` normalises the `articles.content_json` payload into
// a typed sequence of body blocks the Article template can render. When
// `content_json` is null/empty/invalid, it falls back to a single
// {type:"html", html: content_html} block so the article still renders
// for legacy rows that pre-date the structured editor.

import {
  formatDate,
  formatReadTime,
  buildDateline,
} from "../templates/format";

export interface ArticleSiteContext {
  siteId: string;
  hostname: string;
}

export interface ArticleViewModelSite {
  site_id: string;
  name: string;
  hostname: string;
  tagline: string;
  description: string;
  logoUrl: string | null;
  brandTokens: Readonly<Record<string, string>>;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export type BodyBlock =
  | { type: "html"; html: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "image"; src: string; alt: string; caption: string | null }
  | { type: "quote"; text: string; cite: string | null }
  | { type: "list"; ordered: boolean; items: ReadonlyArray<string> }
  | { type: "code"; language: string | null; code: string }
  | { type: "faq"; question: string; answer: string };

export interface ArticleAuthor {
  name: string;
}

export interface ArticleCard {
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

export interface ArticleBreadcrumbItem {
  name: string;
  url: string;
}

export interface ArticleMeta {
  title: string;
  description: string;
  canonicalUrl: string;
  ogImage: string | null;
  publishedAt: string;
  modifiedAt: string;
}

export interface ArticleViewModelArticle {
  id: number;
  slug: string;
  title: string;
  excerpt: string;
  href: string;
  dateline: string;
  publishedAt: string;
  publishedAtDisplay: string;
  updatedAt: string;
  readMinutes: number;
  readMinutesDisplay: string;
  author: ArticleAuthor | null;
  imageUrl: string | null;
  imageAlt: string | null;
  categoryName: string;
  categorySlug: string;
  categoryHref: string;
  body: ReadonlyArray<BodyBlock>;
  contentText: string;
}

export interface ArticleViewModel {
  site: ArticleViewModelSite;
  article: ArticleViewModelArticle;
  breadcrumb: ReadonlyArray<ArticleBreadcrumbItem>;
  faqs: ReadonlyArray<FaqItem>;
  related: ReadonlyArray<ArticleCard>;
  meta: ArticleMeta;
}

interface ArticleDetailRow {
  id: number;
  slug: string;
  title: string;
  content_json: string | null;
  content_html: string | null;
  category_id: number | null;
  status: string;
  published_at: number | null;
  updated_at: number | null;
  author_name: string | null;
  featured_image_id: number | null;
  is_featured: number;
  site_id: string | null;
  category_name: string | null;
  category_slug: string | null;
  image_url: string | null;
  image_alt: string | null;
  seo_title: string | null;
  seo_description: string | null;
}

interface RelatedRow {
  id: number;
  slug: string;
  title: string;
  content_html: string | null;
  category_id: number | null;
  published_at: number | null;
  featured_image_id: number | null;
  is_featured: number;
  category_name: string | null;
  category_slug: string | null;
  image_url: string | null;
  image_alt: string | null;
}

interface SettingsRow {
  key: string;
  value: string | null;
}

const RELATED_LIMIT = 4;

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

function excerptFromText(text: string, limit: number = 200): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  return clean.slice(0, limit) + "…";
}

function htmlToPlainText(html: string | null | undefined): string {
  if (html === null || html === undefined) return "";
  return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function blockToPlainText(block: BodyBlock): string {
  switch (block.type) {
    case "html":
      return htmlToPlainText(block.html);
    case "heading":
      return block.text;
    case "image":
      return block.caption ?? block.alt;
    case "quote":
      return block.text;
    case "list":
      return block.items.join(" ");
    case "code":
      return block.code;
    case "faq":
      return `${block.question} ${block.answer}`;
  }
}

function formatPublishedAtIso(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined) return "";
  const d = new Date(epochSeconds * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function readMinutesFromText(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount === 0) return 1;
  return Math.max(1, Math.ceil(wordCount / 200));
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function asNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// adaptBodyBlocks normalises the article's `content_json` payload into a
// typed sequence of BodyBlocks. The input shape accepted here is the
// shape the admin editor writes: either an array of blocks or an object
// `{ blocks: [...] }`. Each block must have a `type` field; unknown
// types collapse to {type:"html"} so the renderer cannot crash on an
// editor-side schema bump.
//
// Behavioural contract:
//   1. content_json = null/empty/invalid JSON → ONE html block sourced
//      from content_html (T9.AC4).
//   2. faq blocks pass through with their {question, answer} shape so
//      the caller can both render them inline AND emit a FAQPage
//      JSON-LD payload (T9.AC5 requires vm.faqs.length === 2 when
//      content_json carries 2 faq blocks).
export function adaptBodyBlocks(
  contentJson: string | null | undefined,
  contentHtml: string | null | undefined,
): { blocks: BodyBlock[]; faqs: FaqItem[] } {
  const fallback = (): { blocks: BodyBlock[]; faqs: FaqItem[] } => {
    const html = typeof contentHtml === "string" && contentHtml.length > 0 ? contentHtml : "";
    return { blocks: [{ type: "html", html }], faqs: [] };
  };

  if (contentJson === null || contentJson === undefined || contentJson.length === 0) {
    return fallback();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contentJson);
  } catch {
    return fallback();
  }

  let rawBlocks: unknown[] = [];
  if (Array.isArray(parsed)) {
    rawBlocks = parsed;
  } else if (parsed !== null && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.blocks)) {
      rawBlocks = obj.blocks;
    } else if (Array.isArray(obj.body)) {
      rawBlocks = obj.body;
    } else if (Array.isArray(obj.content)) {
      rawBlocks = obj.content;
    }
  }

  if (rawBlocks.length === 0) {
    return fallback();
  }

  const blocks: BodyBlock[] = [];
  const faqs: FaqItem[] = [];

  for (const raw of rawBlocks) {
    if (raw === null || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const type = asString(b.type).toLowerCase();
    switch (type) {
      case "html":
      case "paragraph":
      case "text": {
        const html = asString(b.html).length > 0
          ? asString(b.html)
          : asString(b.text);
        blocks.push({ type: "html", html });
        break;
      }
      case "heading":
      case "h2":
      case "h3": {
        const levelRaw = asNumber(b.level, type === "h3" ? 3 : 2);
        const level = levelRaw === 3 ? 3 : 2;
        blocks.push({ type: "heading", level, text: asString(b.text) });
        break;
      }
      case "image":
      case "img": {
        blocks.push({
          type: "image",
          src: asString(b.src).length > 0 ? asString(b.src) : asString(b.url),
          alt: asString(b.alt),
          caption: typeof b.caption === "string" && b.caption.length > 0 ? b.caption : null,
        });
        break;
      }
      case "quote":
      case "blockquote": {
        blocks.push({
          type: "quote",
          text: asString(b.text).length > 0 ? asString(b.text) : asString(b.quote),
          cite: typeof b.cite === "string" && b.cite.length > 0 ? b.cite : null,
        });
        break;
      }
      case "list":
      case "ul":
      case "ol": {
        const items = Array.isArray(b.items)
          ? b.items.filter((x): x is string => typeof x === "string")
          : [];
        blocks.push({
          type: "list",
          ordered: type === "ol" || b.ordered === true,
          items,
        });
        break;
      }
      case "code":
      case "pre": {
        blocks.push({
          type: "code",
          language: typeof b.language === "string" && b.language.length > 0 ? b.language : null,
          code: asString(b.code).length > 0 ? asString(b.code) : asString(b.text),
        });
        break;
      }
      case "faq":
      case "qa":
      case "question": {
        const question = asString(b.question);
        const answer = asString(b.answer);
        if (question.length === 0 && answer.length === 0) break;
        blocks.push({ type: "faq", question, answer });
        faqs.push({ question, answer });
        break;
      }
      default: {
        // Unknown block: degrade to a raw html block so an editor-side
        // schema bump never crashes the renderer.
        const html = asString(b.html).length > 0 ? asString(b.html) : asString(b.text);
        if (html.length > 0) blocks.push({ type: "html", html });
        break;
      }
    }
  }

  if (blocks.length === 0) {
    return fallback();
  }

  return { blocks, faqs };
}

function toRelatedCard(row: RelatedRow): ArticleCard {
  const plain = htmlToPlainText(row.content_html);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: excerptFromText(plain, 160),
    href: `/article/${row.slug}`,
    imageUrl: row.image_url ?? null,
    imageAlt: row.image_alt ?? null,
    publishedAt: formatPublishedAtIso(row.published_at),
    categoryName: row.category_name ?? "",
    categorySlug: row.category_slug ?? "",
    readMinutes: plain.length > 0 ? readMinutesFromText(plain) : null,
  };
}

export async function buildArticleViewModel(
  db: D1Database,
  args: { slug: string; siteContext: ArticleSiteContext },
): Promise<ArticleViewModel | null> {
  const siteId = args.siteContext.siteId;
  const slug = args.slug;

  // Query 1 — fetch the article row scoped by site_id + slug. The
  // substring `site_id = ?` appears verbatim so T9.AC2's grep counts it.
  const articleRow = await db
    .prepare(
      "SELECT a.id AS id, a.slug AS slug, a.title AS title, " +
        "a.content_json AS content_json, a.content_html AS content_html, " +
        "a.category_id AS category_id, a.status AS status, " +
        "a.published_at AS published_at, a.updated_at AS updated_at, " +
        "a.author_name AS author_name, a.featured_image_id AS featured_image_id, " +
        "a.is_featured AS is_featured, a.site_id AS site_id, " +
        "c.name AS category_name, c.slug AS category_slug, " +
        "m.storage_key AS image_url, m.alt_text AS image_alt, " +
        "a.seo_title AS seo_title, a.seo_description AS seo_description " +
        "FROM articles a " +
        "LEFT JOIN categories c ON c.id = a.category_id " +
        "LEFT JOIN media m ON m.id = a.featured_image_id " +
        "WHERE a.site_id = ? AND a.slug = ? AND a.status = 'published' " +
        "LIMIT 1",
    )
    .bind(siteId, slug)
    .first<ArticleDetailRow>();

  if (articleRow === null) return null;

  // Query 2 — related articles in the same category (or recent if none).
  const relatedSql = articleRow.category_id !== null
    ? "SELECT a.id AS id, a.slug AS slug, a.title AS title, a.content_html AS content_html, " +
        "a.category_id AS category_id, a.published_at AS published_at, " +
        "a.featured_image_id AS featured_image_id, a.is_featured AS is_featured, " +
        "c.name AS category_name, c.slug AS category_slug, " +
        "m.storage_key AS image_url, m.alt_text AS image_alt " +
        "FROM articles a " +
        "LEFT JOIN categories c ON c.id = a.category_id " +
        "LEFT JOIN media m ON m.id = a.featured_image_id " +
        "WHERE a.site_id = ? AND a.category_id = ? AND a.status = 'published' AND a.id != ? " +
        "ORDER BY a.published_at DESC, a.id DESC LIMIT ?"
    : "SELECT a.id AS id, a.slug AS slug, a.title AS title, a.content_html AS content_html, " +
        "a.category_id AS category_id, a.published_at AS published_at, " +
        "a.featured_image_id AS featured_image_id, a.is_featured AS is_featured, " +
        "c.name AS category_name, c.slug AS category_slug, " +
        "m.storage_key AS image_url, m.alt_text AS image_alt " +
        "FROM articles a " +
        "LEFT JOIN categories c ON c.id = a.category_id " +
        "LEFT JOIN media m ON m.id = a.featured_image_id " +
        "WHERE a.site_id = ? AND a.status = 'published' AND a.id != ? " +
        "ORDER BY a.published_at DESC, a.id DESC LIMIT ?";

  const relatedBind = articleRow.category_id !== null
    ? [siteId, articleRow.category_id, articleRow.id, RELATED_LIMIT]
    : [siteId, articleRow.id, RELATED_LIMIT];

  const relatedResult = await db
    .prepare(relatedSql)
    .bind(...relatedBind)
    .all<RelatedRow>();
  const relatedRows = relatedResult.results ?? [];

  // Query 3 — per-site brand + meta settings.
  const settingsResult = await db
    .prepare("SELECT key AS key, value AS value FROM site_settings WHERE site_id = ?")
    .bind(siteId)
    .all<SettingsRow>();
  const settingsRows = settingsResult.results ?? [];

  const settings: Record<string, string> = {};
  for (const row of settingsRows) {
    if (typeof row.value === "string") settings[row.key] = row.value;
  }

  const site: ArticleViewModelSite = {
    site_id: siteId,
    name: settings.site_name ?? args.siteContext.hostname,
    hostname: args.siteContext.hostname,
    tagline: settings.tagline ?? "",
    description: settings.site_description ?? "",
    logoUrl: settings.logo_media_id !== undefined && settings.logo_media_id.length > 0
      ? settings.logo_media_id
      : null,
    brandTokens: parseBrandTokens(settings.brand_tokens_json),
  };

  const { blocks, faqs } = adaptBodyBlocks(articleRow.content_json, articleRow.content_html);
  const contentText = blocks.map(blockToPlainText).join(" ").replace(/\s+/g, " ").trim();
  const readMinutes = readMinutesFromText(contentText);
  const excerpt = excerptFromText(contentText, 200);
  const publishedAtIso = formatPublishedAtIso(articleRow.published_at);
  const updatedAtIso = formatPublishedAtIso(articleRow.updated_at);
  const categorySlug = articleRow.category_slug ?? "";
  const categoryName = articleRow.category_name ?? "";
  const author: ArticleAuthor | null =
    articleRow.author_name !== null && articleRow.author_name.length > 0
      ? { name: articleRow.author_name }
      : null;

  const article: ArticleViewModelArticle = {
    id: articleRow.id,
    slug: articleRow.slug,
    title: articleRow.title,
    excerpt,
    href: `/article/${articleRow.slug}`,
    publishedAt: publishedAtIso,
    publishedAtDisplay: formatDate(publishedAtIso),
    updatedAt: updatedAtIso,
    readMinutes,
    readMinutesDisplay: formatReadTime(contentText),
    dateline: buildDateline(publishedAtIso, contentText),
    author,
    imageUrl: articleRow.image_url ?? null,
    imageAlt: articleRow.image_alt ?? null,
    categoryName,
    categorySlug,
    categoryHref: categorySlug.length > 0 ? `/category/${categorySlug}` : "/",
    body: blocks,
    contentText,
  };

  const breadcrumb: ArticleBreadcrumbItem[] = [{ name: "Home", url: "/" }];
  if (categorySlug.length > 0 && categoryName.length > 0) {
    breadcrumb.push({ name: categoryName, url: `/category/${categorySlug}` });
  }
  breadcrumb.push({ name: articleRow.title, url: article.href });

  const related = relatedRows.map(toRelatedCard);

  const metaTitle =
    typeof articleRow.seo_title === "string" && articleRow.seo_title.length > 0
      ? articleRow.seo_title
      : site.name.length > 0
        ? `${articleRow.title} — ${site.name}`
        : articleRow.title;
  const metaDescription =
    typeof articleRow.seo_description === "string" && articleRow.seo_description.length > 0
      ? articleRow.seo_description
      : excerpt.length > 0
        ? excerpt
        : site.description;

  const meta: ArticleMeta = {
    title: metaTitle,
    description: metaDescription,
    canonicalUrl: `https://${site.hostname}/article/${articleRow.slug}`,
    ogImage: article.imageUrl,
    publishedAt: publishedAtIso,
    modifiedAt: updatedAtIso.length > 0 ? updatedAtIso : publishedAtIso,
  };

  return { site, article, breadcrumb, faqs, related, meta };
}
