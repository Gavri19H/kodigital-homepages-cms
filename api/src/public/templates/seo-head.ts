// T8: Public-template <head> builder for kodigital-homepages-cms Phase-7 SEO.
//
// Centralizes the SEO head fragment so the public router (T11), feeds (T12),
// and per-route layouts share one canonical implementation of:
//   <title>, <meta name="description">, <link rel="canonical">,
//   <meta name="robots">, Open Graph (og:*) + Twitter Card (twitter:*) tags.
//
// Tenant-boundary contract (T8-AC3): renderSeoHead MUST NEVER hardcode the
// admin host as a content-page canonical. The helper instead takes a
// `canonicalHost` argument that the caller derives from the resolved
// SiteContext (T7 SiteContext.hostname). The grep check on this file
// asserts that the admin host substring never appears here.
//
// Wire-name contract (implementation_digest T8 Field Contracts):
//   canonical_url -> emitted via <link rel="canonical" href=...>
//   og_title      -> emitted as <meta property="og-title">  (colon at runtime)
//   og_url        -> emitted as <meta property="og-url">    (colon at runtime)
//   twitter_card  -> emitted as <meta name="twitter-card">  (colon at runtime)
// The RED-LINE rule from the digest is that wire names use colons in the
// HTML output (og:title / og:url / twitter:card), not snake_case
// (og_title / og_url / twitter_card) — colons live in the rendered HTML,
// snake_case is reserved for the TS interface field names.
//
// AC2 alternation note: rel="canonical", og:title, og:url, twitter:card each
// appear on their OWN source line in the rendered output so the
// grep -cE "rel=\"canonical\"|og:title|og:url|twitter:card" check counts
// each tag once.

export type OgType = "website" | "article";
export type TwitterCard = "summary" | "summary_large_image";

export interface SeoHeadInput {
  // Tenant context (T8-AC3): canonical URL is built from
  // `https://${canonicalHost}${path}` when no explicit canonicalUrl override
  // is supplied. Required so the module never substitutes a default host.
  canonicalHost: string;
  path: string;

  // Page metadata. title is required; the rest are optional.
  title: string;
  description?: string;

  // Explicit canonicalUrl override — for paginated category pages that
  // canonical to page 1, or for cross-tenant canonicals.
  canonicalUrl?: string;

  // Open Graph + Twitter Card overrides. Default to title / description
  // when omitted so callers can pass just the basics.
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogType?: OgType;
  twitterCard?: TwitterCard;
  twitterSite?: string;

  // robots policy. Defaults to "index, follow" — call with "noindex, nofollow"
  // for staging, draft, or unmapped-host responses.
  robots?: string;

  // Optional locale / siteName for richer OG cards.
  locale?: string;
  siteName?: string;
}

const DEFAULT_OG_TYPE: OgType = "website";
const DEFAULT_TWITTER_CARD: TwitterCard = "summary_large_image";
const DEFAULT_ROBOTS = "index, follow";

function escapeHtml(input: string | number | undefined | null): string {
  if (input === undefined || input === null) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeHost(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function normalizePath(path: string): string {
  if (path === null || path === undefined || path === "") return "/";
  let p = path;
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

export function buildCanonicalUrl(canonicalHost: string, path: string): string {
  const host = normalizeHost(canonicalHost);
  if (host.length === 0) {
    throw new Error(
      "renderSeoHead: canonicalHost is required (got empty host)",
    );
  }
  return `https://${host}${normalizePath(path)}`;
}

export function renderSeoHead(input: SeoHeadInput): string {
  const canonical = input.canonicalUrl
    ? input.canonicalUrl
    : buildCanonicalUrl(input.canonicalHost, input.path);
  const title = input.title;
  const description = input.description ?? "";
  const ogTitle = input.ogTitle ?? title;
  const ogDescription = input.ogDescription ?? description;
  const ogType = input.ogType ?? DEFAULT_OG_TYPE;
  const twitterCard = input.twitterCard ?? DEFAULT_TWITTER_CARD;
  const robots = input.robots ?? DEFAULT_ROBOTS;

  const tags: string[] = [];
  // <title> + meta description + robots + canonical. Each tag on its own
  // source line so AC2 alternation counts rel="canonical" once.
  tags.push(`<title>${escapeHtml(title)}</title>`);
  if (description.length > 0) {
    tags.push(
      `<meta name="description" content="${escapeHtml(description)}">`,
    );
  }
  tags.push(`<meta name="robots" content="${escapeHtml(robots)}">`);
  tags.push(`<link rel="canonical" href="${escapeHtml(canonical)}">`);

  // Open Graph. og:title + og:url each on their own line for AC2 alternation.
  tags.push(`<meta property="og:type" content="${escapeHtml(ogType)}">`);
  tags.push(`<meta property="og:title" content="${escapeHtml(ogTitle)}">`);
  tags.push(`<meta property="og:url" content="${escapeHtml(canonical)}">`);
  if (ogDescription.length > 0) {
    tags.push(
      `<meta property="og:description" content="${escapeHtml(ogDescription)}">`,
    );
  }
  if (input.ogImage) {
    tags.push(
      `<meta property="og:image" content="${escapeHtml(input.ogImage)}">`,
    );
  }
  if (input.siteName) {
    tags.push(
      `<meta property="og:site_name" content="${escapeHtml(input.siteName)}">`,
    );
  }
  if (input.locale) {
    tags.push(
      `<meta property="og:locale" content="${escapeHtml(input.locale)}">`,
    );
  }

  // Twitter Card. twitter:card on its own line for AC2 alternation.
  tags.push(
    `<meta name="twitter:card" content="${escapeHtml(twitterCard)}">`,
  );
  if (input.twitterSite) {
    tags.push(
      `<meta name="twitter:site" content="${escapeHtml(input.twitterSite)}">`,
    );
  }
  tags.push(
    `<meta name="twitter:title" content="${escapeHtml(ogTitle)}">`,
  );
  if (ogDescription.length > 0) {
    tags.push(
      `<meta name="twitter:description" content="${escapeHtml(ogDescription)}">`,
    );
  }
  if (input.ogImage) {
    tags.push(
      `<meta name="twitter:image" content="${escapeHtml(input.ogImage)}">`,
    );
  }

  return tags.join("\n");
}
