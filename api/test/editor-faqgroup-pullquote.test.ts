// PR-3 (issues 3 + 12): the editor's new "Key idea" (pullquote) and "FAQ"
// (faqgroup) blocks, end-to-end.
//
//   - pullquote: blocks.ts renders the design pull-quote with the .pq-mark span
//     (no <p> wrapper), byte-matching the public article template.
//   - faqgroup: a SINGLE editor block storing items:[{q,a}]; the public
//     view-model adapter (adaptBodyBlocks) EXPANDS it into the standard faqs[]
//     so the public render is IDENTICAL to today's hand-authored faq blocks —
//     exactly one .faq-section, no public-render change.

import { describe, it, expect } from "vitest";
import {
  ALLOWED_BLOCK_TYPES,
  isAllowedBlockType,
  contentJsonToHtml,
} from "../src/editor";
import { adaptBodyBlocks } from "../src/public/view-models/article";
import { renderArticle } from "../src/public/templates/article";
import type {
  ArticleViewModel,
  FaqItem,
} from "../src/public/view-models/article";

describe("editor pullquote block (PR-3 / issue 3)", () => {
  it("renders the design pull-quote with .pq-mark and no <p> wrapper", () => {
    expect(
      contentJsonToHtml({ blocks: [{ type: "pullquote", data: { text: "Key thought" } }] }),
    ).toBe(
      '<blockquote class="pullquote"><span class="pq-mark" aria-hidden="true">"</span>Key thought</blockquote>',
    );
  });

  it("keeps the plain quote block on its own <p> form (regression guard)", () => {
    expect(
      contentJsonToHtml({ blocks: [{ type: "quote", data: { text: "Quoted" } }] }),
    ).toBe("<blockquote><p>Quoted</p></blockquote>");
  });
});

describe("editor faqgroup block (PR-3 / issue 12)", () => {
  it("faqgroup is an allowed block type", () => {
    expect(isAllowedBlockType("faqgroup")).toBe(true);
    expect(ALLOWED_BLOCK_TYPES.has("faqgroup" as never)).toBe(true);
  });

  it("blocks.ts renders a faqgroup as a single .faq-section with details rows", () => {
    const html = contentJsonToHtml({
      blocks: [
        {
          type: "faqgroup",
          data: {
            items: [
              { q: "What is it?", a: "A CMS." },
              { q: "Is it free?", a: "Yes & open." },
            ],
          },
        },
      ],
    });
    expect((html.match(/class="faq-section"/g) ?? []).length).toBe(1);
    expect(html).toContain("Frequently asked questions");
    expect(html).toContain("<summary>What is it?</summary>");
    expect(html).toContain("<summary>Is it free?</summary>");
    // Answer text is HTML-escaped.
    expect(html).toContain("<div>Yes &amp; open.</div>");
  });

  it("drops empty rows and renders nothing for an all-empty faqgroup", () => {
    expect(
      contentJsonToHtml({ blocks: [{ type: "faqgroup", data: { items: [{ q: "", a: "" }] } }] }),
    ).toBe("");
    const partial = contentJsonToHtml({
      blocks: [{ type: "faqgroup", data: { items: [{ q: "Q1", a: "A1" }, { q: "", a: "" }] } }] },
    );
    expect((partial.match(/<details/g) ?? []).length).toBe(1);
  });
});

describe("faqgroup public expansion is identical to hand-authored faq blocks (PR-3 / issue 12)", () => {
  it("adaptBodyBlocks expands a faqgroup into the same faqs[] as separate faq blocks", () => {
    const items = [
      { q: "Question one?", a: "Answer one." },
      { q: "Question two?", a: "Answer two." },
    ];
    const fromGroup = adaptBodyBlocks(
      JSON.stringify({ blocks: [{ type: "faqgroup", items }] }),
      null,
    );
    const fromSeparate = adaptBodyBlocks(
      JSON.stringify({
        blocks: [
          { type: "faq", question: "Question one?", answer: "Answer one." },
          { type: "faq", question: "Question two?", answer: "Answer two." },
        ],
      }),
      null,
    );
    expect(fromGroup.faqs).toEqual([
      { question: "Question one?", answer: "Answer one." },
      { question: "Question two?", answer: "Answer two." },
    ]);
    // Byte-identical faqs[] aggregation → identical .faq-section + FAQPage.
    expect(fromGroup.faqs).toEqual(fromSeparate.faqs);
  });

  it("renderArticle emits exactly one .faq-section for the expanded faqs", () => {
    const faqs: FaqItem[] = [
      { question: "Question one?", answer: "Answer one." },
      { question: "Question two?", answer: "Answer two." },
    ];
    const vm = makeVm({ faqs });
    const html = renderArticle({ vm, emitJsonLd: false });
    expect((html.match(/class="faq-section"/g) ?? []).length).toBe(1);
    expect(html).toContain("Frequently asked questions");
    expect(html).toContain("Question one?");
    expect(html).toContain("Question two?");
  });
});

function makeVm(overrides: Partial<ArticleViewModel> = {}): ArticleViewModel {
  return {
    site: {
      site_id: "site-acme",
      name: "Acme Daily",
      hostname: "acme.example",
      tagline: "Tomorrow's news today",
      description: "Acme Daily covers technology.",
      logoUrl: null,
      brandTokens: {},
    },
    article: {
      id: 42,
      slug: "the-feature",
      title: "The Feature That Mattered",
      excerpt: "A look at the new feature.",
      href: "/article/the-feature",
      dateline: "May 18, 2026 · 4 min read",
      publishedAt: "2026-05-18T10:00:00.000Z",
      publishedAtDisplay: "May 18, 2026",
      updatedAt: "2026-05-18T11:00:00.000Z",
      readMinutes: 4,
      readMinutesDisplay: "4 min read",
      author: { name: "Jamie Reporter" },
      imageUrl: "/media/feature.jpg",
      imageAlt: "Feature illustration",
      categoryName: "Tech",
      categorySlug: "tech",
      categoryHref: "/category/tech",
      body: [{ type: "html", html: "<p>Opening paragraph.</p>" }],
      contentText: "Opening paragraph.",
    },
    breadcrumb: [
      { name: "Home", url: "/" },
      { name: "Tech", url: "/category/tech" },
      { name: "The Feature That Mattered", url: "/article/the-feature" },
    ],
    faqs: [],
    related: [],
    meta: {
      title: "The Feature That Mattered — Acme Daily",
      description: "A look at the new feature.",
      canonicalUrl: "https://acme.example/article/the-feature",
      ogImage: "/media/feature.jpg",
      publishedAt: "2026-05-18T10:00:00.000Z",
      modifiedAt: "2026-05-18T11:00:00.000Z",
    },
    ...overrides,
  };
}
