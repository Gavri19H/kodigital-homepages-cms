// Editor block engine: turns the editor's content_json document into
// HTML for storage on articles.content_html.
//
// Ten block types: paragraph, heading, list, quote, image, divider, html
// plus the design-contract body blocks pullquote, callout, affiliate
// (T27 / BCL-034). Any other type (notably `embed`, which the legacy CMS
// allowed and the new CMS deliberately drops) is rejected — rejected
// blocks are skipped and contribute the empty string.
//
// All user-supplied text passes through `escapeHtml`. The `html` block
// is the only path that emits markup the author wrote; that markup goes
// through `sanitizeHtml`. The affiliate link href is gated by the
// sanitizer's URL-protocol allowlist (`isSafeUrl` — see ./sanitize.ts).

import { escapeHtml, isSafeUrl, sanitizeHtml } from "./sanitize";

export type BlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "quote"
  | "image"
  | "divider"
  | "html"
  | "pullquote"
  | "callout"
  | "affiliate"
  | "faqgroup";

export const ALLOWED_BLOCK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  "paragraph",
  "heading",
  "list",
  "quote",
  "image",
  "divider",
  "html",
  "pullquote",
  "callout",
  "affiliate",
  "faqgroup",
]);

export interface BaseBlock {
  type: string;
  data?: Record<string, unknown>;
}

export interface ContentDocument {
  version?: number;
  blocks: BaseBlock[];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

// Inline formatting: a block produced by the contenteditable editor may carry
// `data.html` (bold/italic/link spans the author created via the toolbar).
// When present it is rendered through the tag-whitelist sanitizer; otherwise
// the plain `data.text` is HTML-escaped. Blocks with only `text` (the legacy
// shape test/editor.test.ts pins) take the escape path byte-for-byte.
function inlineBody(data: Record<string, unknown>): string {
  if (typeof data.html === "string" && data.html.trim() !== "") {
    return sanitizeHtml(data.html);
  }
  return escapeHtml(asString(data.text));
}

function renderParagraph(data: Record<string, unknown>): string {
  return `<p>${inlineBody(data)}</p>`;
}

function renderHeading(data: Record<string, unknown>): string {
  const rawLevel = asNumber(data.level, 2);
  const level = Math.min(6, Math.max(1, Math.trunc(rawLevel)));
  return `<h${level}>${inlineBody(data)}</h${level}>`;
}

function renderList(data: Record<string, unknown>): string {
  const style = asString(data.style, "unordered");
  const tag = style === "ordered" ? "ol" : "ul";
  const items = Array.isArray(data.items) ? (data.items as unknown[]) : [];
  const li = items
    .map((item) => `<li>${escapeHtml(asString(item))}</li>`)
    .join("");
  return `<${tag}>${li}</${tag}>`;
}

function renderQuote(data: Record<string, unknown>): string {
  const inner = inlineBody(data);
  const cite = asString(data.cite).trim();
  if (cite === "") return `<blockquote><p>${inner}</p></blockquote>`;
  return `<blockquote><p>${inner}</p><cite>${escapeHtml(cite)}</cite></blockquote>`;
}

function renderImage(data: Record<string, unknown>): string {
  const src = asString(data.src).trim();
  if (src === "") return "";
  const alt = escapeHtml(asString(data.alt));
  // loading defaults to "lazy" UNLESS the author flagged the image as
  // above-the-fold (e.g. hero image) — that's the contractual default
  // from the AC ("loading=\"lazy\" unless data.aboveTheFold is true").
  const aboveTheFold = asBoolean(data.aboveTheFold);
  const loading = aboveTheFold ? "eager" : "lazy";
  // src may itself be untrusted user input; run it through sanitizeHtml
  // as an attribute fragment to drop javascript: / data: schemes via
  // the URL allowlist. We attach it as an attribute and then sanitize.
  const wrapper = `<img src="${escapeAttribute(src)}" alt="${alt}" loading="${loading}" />`;
  return sanitizeHtml(wrapper);
}

function renderDivider(): string {
  return "<hr />";
}

// Contract body blocks (T27): markup matches the public design-contract
// classes (.pullquote / .callout-box / .affiliate-card in public-css.ts).

function renderPullquote(data: Record<string, unknown>): string {
  const hasHtml = typeof data.html === "string" && data.html.trim() !== "";
  const text = escapeHtml(asString(data.text));
  if (!hasHtml && text === "") return "";
  const inner = inlineBody(data);
  const cite = asString(data.cite).trim();
  const citeHtml = cite === "" ? "" : `<cite>${escapeHtml(cite)}</cite>`;
  // PR-3 (issue 3): the design pull-quote (the "Key idea" unit). Emit the
  // decorative `.pq-mark` quote glyph + the quote text directly (no <p>
  // wrapper) so this byte-matches the public article template's pullquote
  // (api/src/public/templates/article.ts) and the .pullquote .pq-mark CSS.
  return `<blockquote class="pullquote"><span class="pq-mark" aria-hidden="true">"</span>${inner}${citeHtml}</blockquote>`;
}

function renderCallout(data: Record<string, unknown>): string {
  const title = asString(data.title).trim();
  const text = escapeHtml(asString(data.text));
  if (title === "" && text === "") return "";
  const titleHtml =
    title === "" ? "" : `<strong class="callout-title">${escapeHtml(title)}</strong>`;
  return `<aside class="callout-box">${titleHtml}<p>${text}</p></aside>`;
}

function renderAffiliate(data: Record<string, unknown>): string {
  const title = asString(data.title).trim();
  const url = asString(data.url).trim();
  const description = asString(data.description).trim();
  const ctaRaw = asString(data.cta).trim();
  if (title === "" && url === "" && description === "") return "";
  const cta = ctaRaw === "" ? "Learn more" : ctaRaw;
  const titleHtml =
    title === "" ? "" : `<strong class="affiliate-card-title">${escapeHtml(title)}</strong>`;
  const descHtml =
    description === "" ? "" : `<p class="affiliate-card-desc">${escapeHtml(description)}</p>`;
  // Unsafe protocols (javascript:, data:, ...) fail the sanitizer's URL
  // allowlist and the outbound link is dropped entirely.
  const ctaHtml =
    url !== "" && isSafeUrl(url)
      ? `<a class="affiliate-card-cta" href="${escapeAttribute(url)}" target="_blank" rel="sponsored nofollow noopener">${escapeHtml(cta)}</a>`
      : "";
  return `<aside class="affiliate-card">${titleHtml}${descHtml}${ctaHtml}</aside>`;
}

// PR-3 (issue 12): the FAQ group. The editor stores a single faqgroup block
// carrying { items: [{ q, a }] }; on publish it renders the design
// `.faq-section` (h2 + a `.faq-list` of <details> rows) — the same structure
// the public article template (api/src/public/templates/article.ts) emits from
// vm.faqs. Empty rows (both q and a blank) are dropped; an all-empty group
// renders nothing. The stored content_html therefore carries a real, readable
// FAQ section as well as the canonical content_json the view-model expands.
function renderFaqGroup(data: Record<string, unknown>): string {
  const rawItems = Array.isArray(data.items) ? (data.items as unknown[]) : [];
  const rows: string[] = [];
  for (const raw of rawItems) {
    if (raw === null || typeof raw !== "object") continue;
    const it = raw as Record<string, unknown>;
    const q = asString(it.q).trim();
    const a = asString(it.a).trim();
    if (q === "" && a === "") continue;
    rows.push(
      `<details class="faq-item"><summary>${escapeHtml(q)}</summary><div>${escapeHtml(a)}</div></details>`,
    );
  }
  if (rows.length === 0) return "";
  return `<section class="faq-section"><h2>Frequently asked questions</h2><div class="faq-list">${rows.join("")}</div></section>`;
}

function renderHtml(data: Record<string, unknown>): string {
  const raw = asString(data.html);
  if (raw === "") return "";
  return sanitizeHtml(raw);
}

function escapeAttribute(value: string): string {
  return value.replace(/"/g, "&quot;");
}

const BLOCK_RENDERERS: Record<
  BlockType,
  (data: Record<string, unknown>) => string
> = {
  paragraph: renderParagraph,
  heading: renderHeading,
  list: renderList,
  quote: renderQuote,
  image: renderImage,
  divider: renderDivider,
  html: renderHtml,
  pullquote: renderPullquote,
  callout: renderCallout,
  affiliate: renderAffiliate,
  faqgroup: renderFaqGroup,
};

export function isAllowedBlockType(type: string): type is BlockType {
  return ALLOWED_BLOCK_TYPES.has(type as BlockType);
}

export function renderBlock(block: BaseBlock): string {
  if (!isAllowedBlockType(block.type)) return "";
  const data = (block.data ?? {}) as Record<string, unknown>;
  return BLOCK_RENDERERS[block.type](data);
}

// Document-level rendering (contentJsonToHtml / blocksToHtml) lives in
// ./blocks-to-html.ts — the publish/preview entry points import it from there
// (re-exported through ./index). This module owns per-block markup only.
