// Phase 5 / T3: public HTML scaffold for Home + Article + Category + Page.
// renderLayout returns the full `<html>` document. Visible brand strings
// come exclusively from the view model (site.name / site.tagline /
// site.description / site.brandTokens) — no hardcoded TheIWise /
// theiwise / cms.kodigital.app substring (PART 12 RED LINE).
//
// site.brandTokens is the parsed shape of site_settings.brand_tokens_json.
// renderLayout emits one `<style data-source="brand_tokens">` block that
// overrides the `--tw-*` CSS variables defined in public-css.ts (T1).
// When the map is empty or omitted, the style block is omitted entirely.

export interface LayoutSite {
  name: string;
  hostname: string;
  tagline?: string;
  description?: string;
  brandTokens?: Readonly<Record<string, string>>;
  // Snake_case alias kept so callers may hand us the D1 row shape directly.
  brand_tokens?: Readonly<Record<string, string>>;
  logoUrl?: string | null;
}

export interface LayoutMeta {
  title: string;
  description?: string;
  canonicalUrl?: string;
  ogImage?: string | null;
  // Raw, already-stringified JSON-LD blobs from templates/seo.ts (T6).
  // Each entry is emitted as its own `<script type="application/ld+json">`.
  jsonLd?: ReadonlyArray<string>;
  // Optional `<link rel>` tuples (e.g. alternate feeds).
  links?: ReadonlyArray<{ rel: string; href: string; type?: string }>;
}

export interface RenderLayoutArgs {
  site: LayoutSite;
  meta: LayoutMeta;
  body: string;
  header?: string;
  footer?: string;
  bodyClass?: string;
  // Extra `<head>` HTML the caller assembled (already escaped). Used by
  // T15 to inject site_settings.custom_head_html.
  extraHead?: string;
}

function escapeHtmlAttr(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlText(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// CSS-token sanitiser: brand_tokens_json comes from the admin UI so we
// defend against `<` / `>` / closing-tag injection inside the inline
// `<style>` block. Property names allow [A-Za-z0-9_-]; values strip any
// character that could break out of a declaration.
function sanitiseTokenName(name: string): string | null {
  if (typeof name !== "string" || name.length === 0) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return null;
  return name;
}

function sanitiseTokenValue(value: string): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/;/g, "")
    .replace(/\/\*/g, "")
    .replace(/\*\//g, "")
    .trim();
}

export function renderBrandTokensStyle(
  brandTokens: Readonly<Record<string, string>> | undefined,
): string {
  if (brandTokens === undefined || brandTokens === null) return "";
  const decls: string[] = [];
  for (const [rawName, rawValue] of Object.entries(brandTokens)) {
    const name = sanitiseTokenName(rawName);
    if (name === null) continue;
    const value = sanitiseTokenValue(rawValue);
    if (value.length === 0) continue;
    // Tokens are written with a leading `--` so they map onto CSS custom
    // properties: e.g. { "tw-brand": "#1d4ed8" } -> --tw-brand: #1d4ed8;
    const prop = name.startsWith("--") ? name : `--${name}`;
    decls.push(`  ${prop}: ${value};`);
  }
  if (decls.length === 0) return "";
  return `<style data-source="brand_tokens">:root {\n${decls.join("\n")}\n}</style>`;
}

function renderJsonLdBlocks(blocks: ReadonlyArray<string> | undefined): string {
  if (blocks === undefined || blocks.length === 0) return "";
  const safe = blocks
    .filter((s) => typeof s === "string" && s.length > 0)
    // Per WHATWG, closing `</script` inside a script body must be escaped
    // so the parser doesn't terminate the block early.
    .map((s) => s.replace(/<\/script/gi, "<\\/script"));
  if (safe.length === 0) return "";
  return safe
    .map((s) => `<script type="application/ld+json">${s}</script>`)
    .join("\n");
}

function renderLinks(
  links: ReadonlyArray<{ rel: string; href: string; type?: string }> | undefined,
): string {
  if (links === undefined || links.length === 0) return "";
  return links
    .map((l) => {
      const rel = escapeHtmlAttr(l.rel);
      const href = escapeHtmlAttr(l.href);
      const typeAttr = l.type !== undefined && l.type.length > 0
        ? ` type="${escapeHtmlAttr(l.type)}"`
        : "";
      return `<link rel="${rel}" href="${href}"${typeAttr}>`;
    })
    .join("\n");
}

export function renderLayout(args: RenderLayoutArgs): string {
  const { site, meta, body } = args;
  const header = args.header ?? "";
  const footer = args.footer ?? "";
  const bodyClass = args.bodyClass ?? "";
  const extraHead = args.extraHead ?? "";

  // brandTokens (camelCase) is the canonical view-model shape; brand_tokens
  // (snake_case) is the legacy alias from older callers. Prefer camelCase
  // when both are present.
  const tokens = site.brandTokens ?? site.brand_tokens;
  const styleBlock = renderBrandTokensStyle(tokens);

  const safeTitle = escapeHtmlText(meta.title);
  const safeDescription = escapeHtmlAttr(meta.description ?? site.description ?? "");
  const safeSiteName = escapeHtmlAttr(site.name);
  const canonicalLink = meta.canonicalUrl !== undefined && meta.canonicalUrl.length > 0
    ? `<link rel="canonical" href="${escapeHtmlAttr(meta.canonicalUrl)}">`
    : "";
  const ogImageMeta = meta.ogImage !== undefined && meta.ogImage !== null && meta.ogImage.length > 0
    ? `<meta property="og:image" content="${escapeHtmlAttr(meta.ogImage)}">`
    : "";
  const jsonLdBlocks = renderJsonLdBlocks(meta.jsonLd);
  const linkTags = renderLinks(meta.links);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<meta name="description" content="${safeDescription}">
<meta property="og:site_name" content="${safeSiteName}">
<meta property="og:title" content="${escapeHtmlAttr(meta.title)}">
<meta property="og:description" content="${safeDescription}">
${ogImageMeta}
${canonicalLink}
${linkTags}
<link rel="stylesheet" href="/assets/public.css">
${styleBlock}
${jsonLdBlocks}
${extraHead}
</head>
<body class="${escapeHtmlAttr(bodyClass)}">
<a class="skip-to-content" href="#main-content">Skip to content</a>
${header}
<main id="main-content">${body}</main>
${footer}
<script src="/assets/public.js" defer></script>
</body>
</html>`;
}
