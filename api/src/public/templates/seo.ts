// Phase 5 / T6: JSON-LD + meta-tag builders for the public surface.
// PART 12 RED LINE: every visible brand string flows from per-site CMS
// data (site.name / site.tagline / site.description / site.logoUrl) —
// nothing brand-coloured is hardcoded here. Strings returned from these
// builders are wired through `LayoutMeta.jsonLd`, which emits each as
// its own `<script type="application/ld+json">` and escapes embedded
// `</script` so a hostile payload cannot terminate early.

export interface SeoSite {
  name: string;
  hostname: string;
  // Optional fully-qualified origin (e.g. "https://kodigital.example").
  // Falls back to `https://${hostname}` when omitted.
  origin?: string;
  tagline?: string;
  description?: string;
  logoUrl?: string | null;
}

export interface SeoArticleSummary {
  title: string;
  slug: string;
  excerpt?: string;
  imageUrl?: string | null;
  publishedAt?: string;
}

export interface SeoArticle extends SeoArticleSummary {
  author?: { name: string };
  modifiedAt?: string;
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface MetaTags {
  title: string;
  description: string;
  canonicalUrl?: string;
  ogImage?: string | null;
}

function siteOrigin(site: SeoSite): string {
  if (site.origin !== undefined && site.origin.length > 0) {
    return site.origin.replace(/\/+$/, "");
  }
  return `https://${site.hostname}`;
}

function absoluteUrl(origin: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const prefix = path.startsWith("/") ? "" : "/";
  return `${origin}${prefix}${path}`;
}

// Strip undefined values so JSON.stringify omits them rather than emitting
// `"key":null` everywhere. Keeps the rendered ld+json payload tight.
function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

export function buildHomeJsonLd(args: {
  site: SeoSite;
  featured?: ReadonlyArray<SeoArticleSummary>;
}): ReadonlyArray<string> {
  const origin = siteOrigin(args.site);
  const website = compact({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: args.site.name,
    url: origin,
    description: args.site.tagline ?? args.site.description,
  });
  const organization = compact({
    "@context": "https://schema.org",
    "@type": "Organization",
    name: args.site.name,
    url: origin,
    logo: args.site.logoUrl ?? undefined,
  });
  const items = args.featured ?? [];
  const itemList = compact({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${args.site.name} featured articles`,
    itemListElement: items.map((a, i) =>
      compact({
        "@type": "ListItem",
        position: i + 1,
        url: absoluteUrl(origin, `/article/${a.slug}`),
        name: a.title,
      }),
    ),
  });
  return [JSON.stringify(website), JSON.stringify(organization), JSON.stringify(itemList)];
}

export function buildArticleJsonLd(args: {
  site: SeoSite;
  article: SeoArticle;
}): string {
  const origin = siteOrigin(args.site);
  const article = args.article;
  const author =
    article.author !== undefined
      ? compact({ "@type": "Person", name: article.author.name })
      : undefined;
  const publisher = compact({
    "@type": "Organization",
    name: args.site.name,
    logo: args.site.logoUrl ?? undefined,
  });
  const payload = compact({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: article.title,
    description: article.excerpt,
    image: article.imageUrl ?? undefined,
    mainEntityOfPage: absoluteUrl(origin, `/article/${article.slug}`),
    datePublished: article.publishedAt,
    dateModified: article.modifiedAt ?? article.publishedAt,
    author,
    publisher,
  });
  return JSON.stringify(payload);
}

export function buildBreadcrumbJsonLd(args: {
  site: SeoSite;
  items: ReadonlyArray<BreadcrumbItem>;
}): string {
  if (args.items.length === 0) return "";
  const origin = siteOrigin(args.site);
  const payload = compact({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: args.items.map((b, i) =>
      compact({
        "@type": "ListItem",
        position: i + 1,
        name: b.name,
        item: absoluteUrl(origin, b.url),
      }),
    ),
  });
  return JSON.stringify(payload);
}

export function buildFaqJsonLd(args: { faqs: ReadonlyArray<FaqItem> }): string {
  // PART 6 spec: when an Article has no FAQ blocks, the FAQPage payload
  // must be omitted entirely (an empty mainEntity array is forbidden by
  // Google's rich-results validator). Returning "" lets the caller skip
  // the <script type="application/ld+json"> emission.
  if (args.faqs.length === 0) return "";
  const payload = compact({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: args.faqs.map((q) =>
      compact({
        "@type": "Question",
        name: q.question,
        acceptedAnswer: compact({ "@type": "Answer", text: q.answer }),
      }),
    ),
  });
  return JSON.stringify(payload);
}

export function buildMetaTags(args: {
  site: SeoSite;
  page: {
    title: string;
    description?: string;
    canonicalUrl?: string;
    ogImage?: string | null;
  };
}): MetaTags {
  const description =
    args.page.description !== undefined && args.page.description.length > 0
      ? args.page.description
      : args.site.tagline ?? args.site.description ?? "";
  return {
    title: args.page.title,
    description,
    canonicalUrl: args.page.canonicalUrl,
    ogImage: args.page.ogImage ?? null,
  };
}
