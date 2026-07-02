// The one-vocabulary red-line gate.
//
// Provisioned articles store content_json in the pipeline's FLAT block shape;
// the block editor saves the NESTED {id,type,data} shape. This suite pins, on
// the FROZEN real bytes of live article 345 (test/fixtures/article-345-content.json),
// that an editor round-trip (flat → normalize → save nested) renders the LIVE
// page, the publish HTML, and the markdown surface IDENTICALLY — the failure
// this gate guards is an editor save blanking or altering a live article.
//
// normalizeDocumentBlocks (server) and the editor's _normalizeStoredBlock/
// loadFromInput (client, same mapping by construction) are the two halves;
// the client half is exercised end-to-end in the browser matrix.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adaptBodyBlocks } from "../src/public/view-models/article";
import { renderBlockHtml } from "../src/public/templates/article";
import { renderArticleMarkdown } from "../src/public/article-markdown";
import { normalizeDocumentBlocks } from "../src/editor/blocks-normalize";
import { blocksToHtml } from "../src/editor/blocks-to-html";

const FLAT_JSON = readFileSync(
  join(__dirname, "fixtures", "article-345-content.json"),
  "utf-8",
);

function nestedJsonFromFlat(flatJson: string): string {
  const parsed = JSON.parse(flatJson) as { blocks: unknown[] };
  // The editor's save shape: {version:1, blocks:[{id,type,data}]} — ids added.
  const blocks = normalizeDocumentBlocks(parsed.blocks).map((b, i) => ({
    id: `block-fixture-${i}`,
    ...(b as Record<string, unknown>),
  }));
  return JSON.stringify({ version: 1, blocks });
}

function renderAll(json: string) {
  const { blocks, faqs } = adaptBodyBlocks(json, "");
  const html = blocks
    .map((b, i) =>
      renderBlockHtml(
        b as never,
        i,
        { title: "T", subtitle: "", imageUrl: null } as never,
      ),
    )
    .join("");
  const markdown = renderArticleMarkdown({ title: "T", body: blocks });
  return { blocks, faqs, html, markdown };
}

describe("one-vocabulary equivalence (article 345's real bytes)", () => {
  const flat = renderAll(FLAT_JSON);
  const nested = renderAll(nestedJsonFromFlat(FLAT_JSON));

  it("fixture sanity: the full article is present in the flat render", () => {
    expect(FLAT_JSON.length).toBeGreaterThan(9000);
    expect(flat.blocks.length).toBeGreaterThanOrEqual(28);
    expect(flat.html).toContain("The recruiter asks");
    expect(flat.faqs.length).toBe(3);
  });

  it("T-A1: adaptBodyBlocks — nested save renders the SAME blocks + faqs", () => {
    expect(nested.blocks).toEqual(flat.blocks);
    expect(nested.faqs).toEqual(flat.faqs);
  });

  it("T-A2: the article template emits byte-identical HTML for both", () => {
    expect(nested.html).toBe(flat.html);
  });

  it("T-A3: the markdown surface is byte-identical for both", () => {
    expect(nested.markdown).toBe(flat.markdown);
  });

  it("T-A4: publish HTML (blocks-to-html) renders the flat document too", () => {
    const flatPublish = blocksToHtml(FLAT_JSON);
    const nestedPublish = blocksToHtml(nestedJsonFromFlat(FLAT_JSON));
    expect(flatPublish).toBe(nestedPublish);
    expect(flatPublish).toContain("The recruiter asks");
    expect(flatPublish).toContain("callout-box");
  });

  it("T-F: normalization is idempotent (second pass byte-stable)", () => {
    const once = normalizeDocumentBlocks(JSON.parse(FLAT_JSON).blocks);
    const twice = normalizeDocumentBlocks(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("T-G: faq blocks collapse to ONE faqgroup and expand back to 3 faqs", () => {
    const normalized = normalizeDocumentBlocks(JSON.parse(FLAT_JSON).blocks) as Array<{
      type: string;
      data: { items?: unknown[] };
    }>;
    const groups = normalized.filter((b) => b.type === "faqgroup");
    expect(groups.length).toBe(1);
    expect(groups[0]?.data.items?.length).toBe(3);
  });

  it("C14: an unknown flat type survives normalization with every field", () => {
    const weird = [{ type: "weird-block", foo: 1, bar: "x" }];
    const [n] = normalizeDocumentBlocks(weird) as Array<{
      type: string;
      data: Record<string, unknown>;
    }>;
    expect(n?.type).toBe("weird-block");
    expect(n?.data).toEqual({ foo: 1, bar: "x" });
  });
});

describe("T-B/T-E: inline formatting on the live block path", () => {
  it("T-B: editor data.html bold renders as real markup, plain stays escaped", () => {
    const doc = JSON.stringify({
      version: 1,
      blocks: [
        { id: "a", type: "paragraph", data: { text: "bold word", html: "bold <b>word</b>" } },
        { id: "b", type: "paragraph", data: { text: "2 < 3 stays escaped" } },
        { id: "c", type: "list", data: { style: "unordered", items: ["plain", "with <b>bold</b>"] } },
      ],
    });
    const { blocks } = adaptBodyBlocks(doc, "");
    const html = blocks
      .map((b, i) => renderBlockHtml(b as never, i, { title: "T", subtitle: "", imageUrl: null } as never))
      .join("");
    expect(html).toContain("bold <b>word</b>");
    expect(html).toContain("2 &lt; 3 stays escaped");
    expect(html).toContain("<li>plain</li>");
    expect(html).toContain("<li>with <b>bold</b></li>");
  });

  it("T-E: hostile markup smuggled into data.html is stripped on render", () => {
    const doc = JSON.stringify({
      version: 1,
      blocks: [
        {
          id: "x",
          type: "paragraph",
          data: {
            text: "x",
            html: 'x <b>ok</b><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a>',
          },
        },
      ],
    });
    const { blocks } = adaptBodyBlocks(doc, "");
    const html = blocks
      .map((b, i) => renderBlockHtml(b as never, i, { title: "T", subtitle: "", imageUrl: null } as never))
      .join("");
    expect(html).toContain("<b>ok</b>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
  });
});
