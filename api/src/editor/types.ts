// Editor block model + pure transforms (T6 — contenteditable WYSIWYG port).
//
// This module is the SINGLE SOURCE OF TRUTH for the article block editor's
// data shapes and the conversion/markdown-migration logic. The client-side
// editor script (editor-scripts.ts) mirrors these transforms in ES5 string
// form and builds its own toolbar client-side; vitest tests
// (test/editor-blocks.test.ts) import and exercise the TypeScript versions
// here directly (the proof route runs in the node test environment, so the
// logic must be DOM-free and pure).
//
// Block types match the server renderer in ./blocks.ts. The editor offers the
// reference feature set: paragraph / heading(H2–H4) / list / quote / image /
// divider block conversions plus inline bold / italic / link via the browser's
// document formatting command API. Inline formatting is carried on a block's
// optional `html` field, which ./blocks.ts renders through the tag-whitelist
// sanitizer.

import { sanitizeHtml } from "./sanitize";

export type EditorBlockType =
  | "paragraph"
  | "heading"
  | "list"
  | "quote"
  | "image"
  | "divider"
  | "html"
  | "pullquote"
  | "callout"
  | "affiliate";

export interface EditorBlock {
  type: string;
  data?: Record<string, unknown>;
}

export interface EditorDocument {
  version?: number;
  blocks: EditorBlock[];
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Extract the plain text of a block so a conversion keeps the author's words
// when changing block type (the "->H2 keeps text" contract).
export function blockText(block: EditorBlock): string {
  const data = block.data ?? {};
  if (typeof data.text === "string") return data.text;
  if (Array.isArray(data.items)) {
    return (data.items as unknown[]).map((i) => asString(i)).join("\n");
  }
  if (typeof data.html === "string") return stripTags(data.html as string).trim();
  return "";
}

export interface ConvertOptions {
  level?: number;
  style?: "ordered" | "unordered";
}

// Convert a block to another type IN PLACE, preserving the author's text and
// any inline HTML formatting where the destination type supports it.
export function convertBlock(
  block: EditorBlock,
  toType: EditorBlockType,
  opts: ConvertOptions = {},
): EditorBlock {
  const text = blockText(block);
  const data = block.data ?? {};
  const html = typeof data.html === "string" ? (data.html as string) : undefined;
  const inline = html !== undefined ? { html } : {};
  switch (toType) {
    case "heading":
      return { type: "heading", data: { level: opts.level ?? 2, text, ...inline } };
    case "paragraph":
      return { type: "paragraph", data: { text, ...inline } };
    case "quote":
      return { type: "quote", data: { text, ...inline } };
    case "pullquote":
      return { type: "pullquote", data: { text, ...inline } };
    case "list":
      return {
        type: "list",
        data: { style: opts.style ?? "unordered", items: text ? text.split("\n") : [""] },
      };
    case "divider":
      return { type: "divider", data: {} };
    case "image":
      return { type: "image", data: { src: "", alt: text } };
    default:
      return { type: toType, data: { text, ...inline } };
  }
}

// Serialize the editor's block list into the exact string handleInput writes
// back to the hidden textarea#content_json (saveToInput).
export function documentToContentJson(blocks: EditorBlock[]): string {
  return JSON.stringify({ version: 1, blocks });
}

// Inline markdown → HTML for the small set of inline marks the editor toolbar
// produces (bold / italic / link). Input is first HTML-escaped so any raw
// markup in legacy content is neutralized before the mark patterns run.
function inlineMarkdownToHtml(line: string): string {
  let out = escapeText(line);
  // [text](url) — url is the already-escaped slice; & became &amp; which is
  // a valid href entity, so no scheme smuggling.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_]+)_(?!_)/g, "$1<em>$2</em>");
  return out;
}

// Block-level markdown → HTML migration for legacy plain/markdown content
// loaded into the editor. The result is run through the tag-whitelist
// sanitizer by the caller (loadFromInput / parseContentJson).
export function migrateMarkdownToHtml(raw: string): string {
  const text = asString(raw).replace(/\r\n/g, "\n");
  const groups = text.split(/\n{2,}/);
  const html: string[] = [];
  for (const group of groups) {
    const trimmed = group.trim();
    if (trimmed === "") continue;
    const lines = trimmed.split("\n");
    const firstLine = lines[0] ?? "";
    const heading = firstLine.match(/^(#{1,6})\s+(.*)$/);
    if (heading && lines.length === 1) {
      const level = Math.min(6, (heading[1] ?? "").length || 1);
      html.push(`<h${level}>${inlineMarkdownToHtml(heading[2] ?? "")}</h${level}>`);
      continue;
    }
    if (/^([-*]|\d+\.)\s+/.test(firstLine) && lines.every((l) => /^([-*]|\d+\.)\s+/.test(l))) {
      const ordered = /^\d+\.\s+/.test(firstLine);
      const tag = ordered ? "ol" : "ul";
      const items = lines
        .map((l) => l.replace(/^([-*]|\d+\.)\s+/, ""))
        .map((l) => `<li>${inlineMarkdownToHtml(l)}</li>`)
        .join("");
      html.push(`<${tag}>${items}</${tag}>`);
      continue;
    }
    if (/^>\s?/.test(firstLine)) {
      const body = lines.map((l) => l.replace(/^>\s?/, "")).join(" ");
      html.push(`<blockquote><p>${inlineMarkdownToHtml(body)}</p></blockquote>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      html.push("<hr />");
      continue;
    }
    html.push(`<p>${inlineMarkdownToHtml(lines.join(" "))}</p>`);
  }
  return html.join("");
}

// Sanitize a block's inline HTML on load (tag-whitelist). Pure pass-through to
// the shared sanitizer so the editor and the publish renderer agree.
export function sanitizeBlockHtml(html: string): string {
  return sanitizeHtml(asString(html));
}

// Parse the hidden textarea value into editor blocks (loadFromInput). Valid
// content_json is parsed and each block's inline html is sanitized; anything
// that is not a blocks document is treated as legacy markdown/plain content
// and migrated to a single sanitized html block (no content is silently lost).
export function parseContentJson(raw: string | null | undefined): EditorBlock[] {
  const trimmed = asString(raw).trim();
  if (trimmed === "") return [{ type: "paragraph", data: { text: "" } }];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as { blocks?: unknown }).blocks)
    ) {
      const blocks = (parsed as { blocks: EditorBlock[] }).blocks;
      if (blocks.length === 0) return [{ type: "paragraph", data: { text: "" } }];
      return blocks.map((b) => sanitizeBlockOnLoad(b));
    }
  } catch {
    /* not JSON — fall through to markdown migration */
  }
  return [{ type: "html", data: { html: sanitizeBlockHtml(migrateMarkdownToHtml(trimmed)) } }];
}

function sanitizeBlockOnLoad(block: EditorBlock): EditorBlock {
  const data = { ...(block.data ?? {}) } as Record<string, unknown>;
  if (typeof data.html === "string") data.html = sanitizeBlockHtml(data.html as string);
  return { type: block.type, data };
}
