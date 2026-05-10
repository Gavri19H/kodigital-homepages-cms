// Editor block engine: turns the editor's content_json document into
// HTML for storage on articles.content_html.
//
// Phase-1 supports exactly seven block types: paragraph, heading, list,
// quote, image, divider, html. Any other type (notably `embed`, which
// the legacy CMS allowed and the new CMS deliberately drops) is rejected
// — rejected blocks are skipped and their contribution to the output is
// the empty string.
//
// All user-supplied text passes through `escapeHtml`. The `html` block
// is the only path that emits markup the author wrote; that markup goes
// through `sanitizeHtml` (defense-in-depth: see ./sanitize.ts).

import { escapeHtml, sanitizeHtml } from "./sanitize";

export type BlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "quote"
  | "image"
  | "divider"
  | "html";

export const ALLOWED_BLOCK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  "paragraph",
  "heading",
  "list",
  "quote",
  "image",
  "divider",
  "html",
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

function renderParagraph(data: Record<string, unknown>): string {
  const text = escapeHtml(asString(data.text));
  return `<p>${text}</p>`;
}

function renderHeading(data: Record<string, unknown>): string {
  const rawLevel = asNumber(data.level, 2);
  const level = Math.min(6, Math.max(1, Math.trunc(rawLevel)));
  const text = escapeHtml(asString(data.text));
  return `<h${level}>${text}</h${level}>`;
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
  const text = escapeHtml(asString(data.text));
  const cite = asString(data.cite).trim();
  if (cite === "") return `<blockquote><p>${text}</p></blockquote>`;
  return `<blockquote><p>${text}</p><cite>${escapeHtml(cite)}</cite></blockquote>`;
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
};

export function isAllowedBlockType(type: string): type is BlockType {
  return ALLOWED_BLOCK_TYPES.has(type as BlockType);
}

export function renderBlock(block: BaseBlock): string {
  if (!isAllowedBlockType(block.type)) return "";
  const data = (block.data ?? {}) as Record<string, unknown>;
  return BLOCK_RENDERERS[block.type](data);
}

export function contentJsonToHtml(doc: ContentDocument | string | null | undefined): string {
  if (doc === null || doc === undefined) return "";
  const parsed = typeof doc === "string" ? safeParseDocument(doc) : doc;
  if (!parsed || !Array.isArray(parsed.blocks)) return "";
  return parsed.blocks.map(renderBlock).join("");
}

function safeParseDocument(json: string): ContentDocument | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    const blocks = (parsed as { blocks?: unknown }).blocks;
    if (!Array.isArray(blocks)) return null;
    return { blocks: blocks as BaseBlock[] };
  } catch {
    return null;
  }
}
