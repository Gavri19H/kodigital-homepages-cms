// Publish renderer (T6): turns the editor's content_json document into the
// stored HTML on articles.content_html. The per-block markup lives in
// ./blocks.ts (renderBlock); this module owns the document-level entry points
// the publish/preview pipeline calls.
//
// `contentJsonToHtml` is kept as the historical name (publish.ts / preview
// import it via ./index) and is now an alias of the canonical `blocksToHtml`
// — so "publish renders via blocks-to-html.ts" holds without touching the
// publish call sites. Behavior is byte-identical to the prior blocks.ts
// implementation; test/editor.test.ts pins the exact output strings.

import { renderBlock } from "./blocks";
import type { BaseBlock, ContentDocument } from "./blocks";

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

// Render a content document (object or JSON string) to its publish HTML.
// Malformed JSON, a non-object, or a missing/!array `blocks` field all yield
// the empty string (defensive — never throws on stored content).
export function blocksToHtml(
  doc: ContentDocument | string | null | undefined,
): string {
  if (doc === null || doc === undefined) return "";
  const parsed = typeof doc === "string" ? safeParseDocument(doc) : doc;
  if (!parsed || !Array.isArray(parsed.blocks)) return "";
  return parsed.blocks.map(renderBlock).join("");
}

// Historical alias retained for publish.ts / preview / index re-export.
export const contentJsonToHtml = blocksToHtml;
