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
//
// T13: the document <head>'s SEO meta block is delegated to renderSeoHead
// (templates/seo-head.ts) so robots / og:type / og:url / twitter:* /
// article:* all flow through the LIVE route — the helper is no longer dead.

import { renderSeoHead } from "./seo-head";

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
  // T13: the full SEO head is built by renderSeoHead (templates/seo-head.ts)
  // — previously this layout hand-rolled only title/description/og:site_name/
  // og:title/og:description (+optional image/canonical) and renderSeoHead was
  // dead code (BCL-055). These fields drive the now-wired head:
  //   ogType                 -> og:type (default "website"; "article" pages)
  //   robots                 -> meta robots (default "index, follow")
  //   articlePublishedTime.. -> article:* tags, emitted only when ogType=article
  //   twitterCard/twitterSite-> twitter:* card
  ogType?: "website" | "article";
  robots?: string;
  twitterCard?: "summary" | "summary_large_image";
  twitterSite?: string;
  articlePublishedTime?: string;
  articleModifiedTime?: string;
  articleSection?: string;
  articleAuthor?: string;
  // Raw, already-stringified JSON-LD blobs from templates/seo.ts (T6).
  // Each entry is emitted as its own `<script type="application/ld+json">`.
  jsonLd?: ReadonlyArray<string>;
  // Optional `<link rel>` tuples (e.g. alternate feeds, rel=prev/next
  // pagination links for paginated category pages — T13-AC2).
  links?: ReadonlyArray<{ rel: string; href: string; type?: string }>;
}

export interface RenderLayoutArgs {
  site: LayoutSite;
  meta: LayoutMeta;
  body: string;
  header?: string;
  footer?: string;
  bodyClass?: string;
  // Extra `<head>` HTML the caller assembled (already escaped). Used for the
  // ad provider/manager scripts and JSON-LD.
  extraHead?: string;
  // T23: operator custom-HTML/script snippets, ALREADY sanitized by
  // renderCustomHead / renderCustomFooter (settings/custom-html.ts).
  //   customHead   -> emitted at the END of <head> (custom_head_html +
  //                   analytics_script + ad_header_script).
  //   customFooter -> emitted just before </body> (custom_footer_html).
  // These close BCL-045: the snippets were stored but never rendered.
  customHead?: string;
  customFooter?: string;
}

function escapeHtmlAttr(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    // properties: e.g. { "tw-brand": "#0f8aa6" } -> --tw-brand: #0f8aa6;
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
  // T23: pre-sanitized operator snippets (renderCustomHead/renderCustomFooter).
  const customHead = args.customHead ?? "";
  const customFooter = args.customFooter ?? "";

  // brandTokens (camelCase) is the canonical view-model shape; brand_tokens
  // (snake_case) is the legacy alias from older callers. Prefer camelCase
  // when both are present.
  const tokens = site.brandTokens ?? site.brand_tokens;
  const styleBlock = renderBrandTokensStyle(tokens);

  // T13: the SEO meta block (title, description, robots, canonical, og:*,
  // twitter:*, article:*) is built ONCE by renderSeoHead so the live <head>
  // carries the complete search/social tag set — not just the legacy
  // title/description/og:site_name subset (BCL-055). canonicalUrl, when the
  // caller supplies it, overrides the host+path derivation; site.hostname is
  // the tenant host (the admin host MUST NEVER appear — mission RED LINE).
  const seoHead = renderSeoHead({
    canonicalHost: site.hostname,
    path: "/",
    canonicalUrl:
      meta.canonicalUrl !== undefined && meta.canonicalUrl.length > 0
        ? meta.canonicalUrl
        : undefined,
    title: meta.title,
    description: meta.description ?? site.description,
    ogImage:
      meta.ogImage !== undefined && meta.ogImage !== null && meta.ogImage.length > 0
        ? meta.ogImage
        : undefined,
    siteName: site.name,
    ogType: meta.ogType,
    robots: meta.robots,
    twitterCard: meta.twitterCard,
    twitterSite: meta.twitterSite,
    articlePublishedTime: meta.articlePublishedTime,
    articleModifiedTime: meta.articleModifiedTime,
    articleSection: meta.articleSection,
    articleAuthor: meta.articleAuthor,
  });
  const jsonLdBlocks = renderJsonLdBlocks(meta.jsonLd);
  const linkTags = renderLinks(meta.links);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${seoHead}
${linkTags}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@400;600;700&family=Nunito:wght@700;800;900&display=swap">
<link rel="stylesheet" href="/assets/public.css">
${styleBlock}
${jsonLdBlocks}
${extraHead}
${customHead}
</head>
<body class="${escapeHtmlAttr(bodyClass)}">
<a class="skip-to-content" href="#main-content">Skip to content</a>
${header}
<main id="main-content">${body}</main>
${footer}
<script src="/assets/public.js" defer></script>
${customFooter}
</body>
</html>`;
}

// --- Phase 7 image-performance helpers (T23) appended below ---

// T23: Performance hardening for the public layout — image rendering helpers
// that emit fixed width/height + loading hints so the browser can reserve
// layout space (no CLS) and pick the right priority for the hero image.
//
// Two public helpers:
//   renderHeroImage(...)       -> above-the-fold image. Emits
//                                 loading="eager" + fetchpriority="high" +
//                                 decoding="async" + explicit width/height.
//   renderBelowFoldImage(...)  -> below-the-fold image. Emits
//                                 loading="lazy" + decoding="async" +
//                                 explicit width/height.
//
// The two helpers above the AC grep contract together emit BOTH
// `loading="lazy"` and `fetchpriority="high"` in this source file so the
// digest test bindings (RC-090, T23-AC1) both pass on a single source-grep
// pass.

export interface PublicImageInput {
  // Absolute or root-relative image URL. The helper does NOT validate the
  // URL — callers must pass an already-escaped, render-safe string.
  src: string;
  // Alt text. Required so we never emit alt-less <img> in production HTML.
  alt: string;
  // Intrinsic display dimensions in CSS pixels. Required so the browser can
  // reserve layout space pre-load (no CLS). Pass the rendered size, not the
  // raw source size.
  width: number;
  height: number;
}

function escapeAttribute(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || Math.floor(value) !== value) {
    throw new Error(`renderImage: ${name} must be a positive integer`);
  }
}

// Above-the-fold hero image. The eager loading hint + fetchpriority="high"
// tells the browser to fetch this resource immediately, before any deferred
// scripts. decoding="async" lets the decode happen off-thread so the rest
// of the page paints without blocking on image decode.
//
// Wire emission (per implementation_digest T23 "goal: emitted"):
//   <img src="..." alt="..." width="..." height="..." loading="eager"
//        fetchpriority="high" decoding="async">
export function renderHeroImage(input: PublicImageInput): string {
  assertPositiveInt("width", input.width);
  assertPositiveInt("height", input.height);
  const src = escapeAttribute(input.src);
  const alt = escapeAttribute(input.alt);
  return (
    `<img src="${src}" alt="${alt}"` +
    ` width="${input.width}" height="${input.height}"` +
    ` loading="eager" fetchpriority="high" decoding="async">`
  );
}

// Below-the-fold lazy image. loading="lazy" + decoding="async" + explicit
// width/height keeps the browser from reserving network for off-screen
// resources and prevents CLS when the image eventually loads.
//
// Wire emission (per implementation_digest T23 "goal: emitted"):
//   <img src="..." alt="..." width="..." height="..." loading="lazy"
//        decoding="async">
export function renderBelowFoldImage(input: PublicImageInput): string {
  assertPositiveInt("width", input.width);
  assertPositiveInt("height", input.height);
  const src = escapeAttribute(input.src);
  const alt = escapeAttribute(input.alt);
  return (
    `<img src="${src}" alt="${alt}"` +
    ` width="${input.width}" height="${input.height}"` +
    ` loading="lazy" decoding="async">`
  );
}

// Reserved-dimension wrapper around an ad slot. Pairs with the .ad-slot
// rule in public.css.ts: callers render the wrapper with the slot's
// intended width/height inline so the browser reserves space before the
// ad script (GPT, AdSense, etc.) injects the iframe.
//
// Returns the OUTER markup; the slot innerHTML stays empty until JS fills
// it. Setting min-width/min-height inline AS WELL AS in the CSS class
// gives the browser the strongest possible layout reservation signal
// (CSS rule may not apply if stylesheet load is deferred).
export function renderAdSlot(opts: {
  id: string;
  width: number;
  height: number;
}): string {
  assertPositiveInt("width", opts.width);
  assertPositiveInt("height", opts.height);
  const id = escapeAttribute(opts.id);
  return (
    `<div class="ad-slot" id="${id}"` +
    ` style="min-width:${opts.width}px;min-height:${opts.height}px;` +
    `width:${opts.width}px;height:${opts.height}px;"` +
    ` data-w="${opts.width}" data-h="${opts.height}"></div>`
  );
}
