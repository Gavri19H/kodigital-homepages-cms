// X15: the reverse of blocks-to-html.ts, for Pages only.
//
// Pages written by the site setup (the legal pages) store their live text in
// pages.content_html and a non-block record in pages.content_json
// ({kind:"legal_template_rendered", ...}). The Page editor reads only
// content_json, so it opened EMPTY on those Pages. `htmlToBlocks` turns the
// stored live HTML into an editor document, in memory, so the editor shows
// the real text; nothing is stored until the operator saves.
//
// Input is the CMS's OWN stored page HTML (top-level h1-h6 / p / ul / ol /
// blockquote, inline em/strong/a/br), not arbitrary web HTML. Contract:
// blocksToHtml(htmlToBlocks(x)) reproduces x for that shape (pinned against
// the live Pages by test/pages-html-to-blocks.test.ts). Anything it does not
// recognise is kept verbatim in an `html` block (rendered through the
// sanitizer), so no text is ever dropped.

import type { BaseBlock, ContentDocument } from "./blocks";

const INLINE_TAG_RE = /<\/?[a-z][^>]*>/i;

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeText(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39|#x27);/g, (m) => ENTITY_MAP[m] ?? m);
}

// Inline body for paragraph / heading / quote: plain text when there are no
// tags (blocksToHtml escapes it back), the raw inner HTML when there are
// (blocksToHtml sanitizes it).
function inlineData(inner: string): Record<string, unknown> {
  const trimmed = inner.trim();
  if (INLINE_TAG_RE.test(trimmed)) {
    return { text: decodeText(trimmed.replace(/<[^>]*>/g, "")), html: trimmed };
  }
  return { text: decodeText(trimmed) };
}

function listItem(inner: string): string {
  const trimmed = inner.trim();
  return INLINE_TAG_RE.test(trimmed) ? trimmed : decodeText(trimmed);
}

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return "x15-" + Date.now().toString(36) + "-" + idCounter.toString(36);
}

// Top-level element: <tag ...>inner</tag>. Non-greedy match to the FIRST
// matching close tag; our stored page HTML never nests same-name block tags.
const TOP_LEVEL_RE = /<(h[1-6]|p|ul|ol|blockquote)\b[^>]*>([\s\S]*?)<\/\1\s*>/iy;
const LI_RE = /<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi;

export function htmlToBlocks(html: string | null | undefined): ContentDocument {
  const blocks: BaseBlock[] = [];
  const src = typeof html === "string" ? html : "";
  let pos = 0;
  let stray = "";
  const flushStray = (): void => {
    if (stray.trim() !== "") {
      blocks.push({ id: newId(), type: "html", data: { html: stray.trim() } } as BaseBlock);
    }
    stray = "";
  };
  while (pos < src.length) {
    TOP_LEVEL_RE.lastIndex = pos;
    const m = TOP_LEVEL_RE.exec(src);
    if (m === null) {
      stray += src.charAt(pos);
      pos += 1;
      continue;
    }
    flushStray();
    const tag = (m[1] ?? "").toLowerCase();
    const inner = m[2] ?? "";
    if (tag === "p") {
      blocks.push({ id: newId(), type: "paragraph", data: inlineData(inner) } as BaseBlock);
    } else if (tag === "ul" || tag === "ol") {
      const items: string[] = [];
      let li: RegExpExecArray | null;
      LI_RE.lastIndex = 0;
      while ((li = LI_RE.exec(inner)) !== null) items.push(listItem(li[1] ?? ""));
      blocks.push({
        id: newId(),
        type: "list",
        data: { style: tag === "ol" ? "ordered" : "unordered", items },
      } as BaseBlock);
    } else if (tag === "blockquote") {
      const p = /^\s*<p\b[^>]*>([\s\S]*?)<\/p>\s*$/i.exec(inner);
      blocks.push({ id: newId(), type: "quote", data: inlineData(p ? (p[1] ?? "") : inner) } as BaseBlock);
    } else {
      blocks.push({
        id: newId(),
        type: "heading",
        data: { ...inlineData(inner), level: Number(tag.slice(1)) },
      } as BaseBlock);
    }
    pos = TOP_LEVEL_RE.lastIndex;
  }
  flushStray();
  return { version: 1, blocks } as ContentDocument;
}

// True when a stored content_json is an editor document (has a blocks list).
export function hasEditorBlocks(contentJson: string | null | undefined): boolean {
  if (typeof contentJson !== "string" || contentJson.trim() === "") return false;
  try {
    const parsed = JSON.parse(contentJson) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      Array.isArray((parsed as { blocks?: unknown }).blocks)
    );
  } catch {
    return false;
  }
}

// The editor copy to show on the Page edit screen: the stored content_json
// when it is an editor document, otherwise one rebuilt from the live HTML.
export function editorJsonForPage(
  contentJson: string | null | undefined,
  contentHtml: string | null | undefined,
): string {
  if (hasEditorBlocks(contentJson)) return contentJson as string;
  if (typeof contentHtml !== "string" || contentHtml.trim() === "") {
    return typeof contentJson === "string" ? contentJson : "";
  }
  return JSON.stringify(htmlToBlocks(contentHtml));
}
