// T20 — Article page renders the full 12-section theiwise design.
//
// AC1 (RC-036): the rendered article document carries the 12 contract section
// classes IN the exact docs/design-contract §8 order, the design-export screen
// label `data-screen-label=article-page`, the `.article-shell` 3-col grid
// `60px minmax(0, 1fr) 320px`; and it is NOT the bare rescue-2 fallback (it
// roots in the design shell under `<main id="main-content">` with the public
// stylesheet linked).
//
// AC2 (RC-037): every design-contract §12 body block type — p / h2 / ul /
// pullquote / image / callout / affiliate — adapts from content_json and
// renders its design markup; the served stylesheet carries the lede drop-cap
// (`p:first-of-type::first-letter`, 4.2em brand) and the brand dash bullet
// (`ul > li` 16x2px brand dash, li padding-left 28px).
//
// These are render-output behavioural assertions against renderArticle /
// renderLayout + adaptBodyBlocks + the served publicCss string (no DB, no
// network) — the same pure-transform pattern the rest of the public-template
// suite uses.
//
// parse_test_output route (required_evidence_plan RC-036/RC-037): the runner
// aliases parse_test_output -> vitest_text and binds a PASSING test whose
// verbose-reporter name matches expected_test_name_regex
// `api/test/article-design.test.ts`. Each it() title embeds that file-path
// literal plus the L2_AUTO_DISAMBIGUATION:T20-AC<n>:RC-<nnn> disambiguation tag.

import { describe, it, expect } from "vitest";
import { renderArticle } from "../src/public/templates/article";
import { renderLayout } from "../src/public/templates/layout";
import { publicCss } from "../src/public/assets/public-css";
import {
  adaptBodyBlocks,
  type ArticleViewModel,
  type ArticleCard,
  type BodyBlock,
  type FaqItem,
} from "../src/public/view-models/article";

function makeRelated(overrides: Partial<ArticleCard> = {}): ArticleCard {
  return {
    id: 1,
    slug: "related-one",
    title: "Related story one",
    excerpt: "Lede sentence for the related story.",
    href: "/article/related-one",
    imageUrl: "/media/related-one.jpg",
    imageAlt: "Related story image",
    publishedAt: "2026-05-18T10:00:00.000Z",
    categoryName: "Tech",
    categorySlug: "tech",
    readMinutes: 4,
    ...overrides,
  };
}

function makeVm(overrides: Partial<ArticleViewModel> = {}): ArticleViewModel {
  return {
    site: {
      site_id: "site-acme",
      name: "Acme Daily",
      hostname: "acme.example",
      tagline: "Tomorrow's news today",
      description: "Acme Daily covers technology, world, and culture.",
      logoUrl: null,
      brandTokens: { "tw-brand": "#0f8aa6" },
    },
    article: {
      id: 42,
      slug: "the-feature",
      title: "The Feature That Mattered",
      excerpt: "A look at the new feature and why it matters.",
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
      body: [
        { type: "paragraph", text: "Opening paragraph of the story." },
        { type: "heading", level: 2, text: "Why it matters" },
        { type: "paragraph", text: "The point of the story." },
      ],
      contentText: "Opening paragraph of the story. Why it matters The point of the story.",
    },
    breadcrumb: [
      { name: "Home", url: "/" },
      { name: "Tech", url: "/category/tech" },
      { name: "The Feature That Mattered", url: "/article/the-feature" },
    ],
    faqs: [],
    related: [
      makeRelated({ id: 2, slug: "r2", title: "Second related", href: "/article/r2" }),
      makeRelated({ id: 3, slug: "r3", title: "Third related", href: "/article/r3" }),
    ],
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

function renderDoc(v: ArticleViewModel): string {
  return renderLayout({
    site: {
      name: v.site.name,
      hostname: v.site.hostname,
      tagline: v.site.tagline,
      description: v.site.description,
      brandTokens: v.site.brandTokens,
      logoUrl: v.site.logoUrl,
    },
    meta: { title: v.meta.title, description: v.meta.description, canonicalUrl: v.meta.canonicalUrl },
    body: renderArticle({ vm: v, emitJsonLd: false }),
  });
}

describe("article-design (T20)", () => {
  it("T20-AC1 render-output: article document emits the 12 contract section classes in §8 order + data-screen-label=article-page + the .article-shell grid, not the bare fallback [api/test/article-design.test.ts] L2_AUTO_DISAMBIGUATION:T20-AC1:RC-036", () => {
    // FAQs are non-empty so the §7 `.faq-section` class renders (the marker
    // always renders, but the class is conditional on faqs[] — the contract
    // ordering test requires the class to be present).
    const faqs: FaqItem[] = [
      { question: "What is it?", answer: "A new feature." },
      { question: "Why now?", answer: "Because it matters." },
    ];
    const doc = renderDoc(makeVm({ faqs }));

    // The 12 contract section root selectors, in the exact docs/design-contract
    // §8 order (§§5–9 nest inside the §4 article-shell; §§7–8 inside §6 body).
    const orderedSelectors = [
      'class="reading-progress"', // §1
      'class="site-header"', // §2
      'class="article-hero"', // §3
      'class="article-shell container"', // §4
      'class="share-rail"', // §5
      'class="article-body"', // §6
      'class="faq-section"', // §7 (nested in body)
      'class="article-share-bottom"', // §8 (nested in body)
      'class="article-sidebar"', // §9
      'class="related-section section--soft"', // §10
      'class="newsletter"', // §11
      'class="site-footer"', // §12
    ];
    let prev = -1;
    for (const sel of orderedSelectors) {
      const idx = doc.indexOf(sel);
      expect(idx, `selector ${sel} present`).toBeGreaterThan(-1);
      expect(idx, `selector ${sel} after previous (${prev})`).toBeGreaterThan(prev);
      prev = idx;
    }

    // Design-export screen label + the §5 article-shell 3-col grid contract.
    expect(doc).toContain("data-screen-label=article-page");
    expect(doc).toContain('data-grid="60px minmax(0, 1fr) 320px"');
    expect(doc).toContain("minmax(0, 1fr)");

    // not-the-bare-fallback: rescue-2 served a bare <body><div> with no design
    // shell. The design body roots in data-screen-label=article-page inside
    // <main id="main-content"> and the page links the public stylesheet.
    expect(doc).toContain('<main id="main-content"><div data-screen-label=article-page>');
    expect(doc).toContain('href="/assets/public.css"');
  });

  it("T20-AC2 render-output: each §12 body block type (p/h2/ul/pullquote/image/callout/affiliate) adapts + renders, and the stylesheet carries the drop-cap + brand dash bullets [api/test/article-design.test.ts] L2_AUTO_DISAMBIGUATION:T20-AC2:RC-037", () => {
    // The contract §12 TIW_ARTICLE.body shape is FLAT ({type, text?/items?/...}),
    // which is what the AI generators emit and what adaptBodyBlocks reads.
    const contentJson = JSON.stringify({
      blocks: [
        { type: "p", text: "Opening paragraph that earns the drop cap." },
        { type: "h2", text: "Why it matters" },
        { type: "ul", items: ["First point", "Second point"] },
        { type: "pullquote", text: "A standout quote.", cite: "Jane Doe" },
        { type: "image", src: "/media/inline.jpg", alt: "Inline illustration" },
        { type: "callout", title: "Note", text: "Pay attention to this." },
        {
          type: "affiliate",
          title: "Best Widget",
          description: "A great widget for the job.",
          url: "https://shop.example/widget",
          cta: "Buy now",
        },
      ],
    });

    // adaptBodyBlocks maps each contract type to its typed block, in order.
    const adapted = adaptBodyBlocks(contentJson, null);
    expect(adapted.blocks.map((b) => b.type)).toEqual([
      "paragraph",
      "heading",
      "list",
      "quote",
      "image",
      "callout",
      "affiliate",
    ]);

    const body = renderArticle({
      vm: makeVm({ article: { ...makeVm().article, body: adapted.blocks as BodyBlock[] } }),
      emitJsonLd: false,
    });

    // p -> a real <p> (drop-cap target).
    expect(body).toContain("<p>Opening paragraph that earns the drop cap.</p>");
    // h2 -> article-body heading.
    expect(body).toMatch(/<h2[^>]*class="article-body__heading"[^>]*>Why it matters<\/h2>/);
    // ul -> <ul> with brand-dash list items.
    expect(body).toMatch(/<ul><li>First point<\/li><li>Second point<\/li><\/ul>/);
    // pullquote -> <blockquote class="pullquote">.
    expect(body).toContain('<blockquote class="pullquote">A standout quote.');
    // image -> <figure class="article-figure"> through the /media route.
    expect(body).toContain('<figure class="article-figure">');
    expect(body).toContain('src="/media/inline.jpg"');
    // callout -> .callout-box with a title.
    expect(body).toContain('<aside class="callout-box">');
    expect(body).toContain('<strong class="callout-title">Note</strong>');
    expect(body).toContain("Pay attention to this.");
    // affiliate -> .affiliate-card with a sponsored/nofollow CTA.
    expect(body).toContain('<aside class="affiliate-card">');
    expect(body).toContain('<strong class="affiliate-card-title">Best Widget</strong>');
    expect(body).toContain('href="https://shop.example/widget"');
    expect(body).toContain('rel="sponsored nofollow noopener"');
    expect(body).toContain(">Buy now</a>");

    // drop-cap present in the served stylesheet (contract §11: 4.2em brand).
    expect(publicCss).toContain("p:first-of-type::first-letter");
    expect(publicCss).toMatch(
      /\.article-body > p:first-of-type::first-letter \{[^}]*font-size: 4\.2em;[^}]*color: var\(--tw-brand\)/,
    );
    // brand dash bullets present (contract §11: 16x2px brand dash, li pad 28px).
    expect(publicCss).toMatch(
      /\.article-body ul > li::before \{[^}]*width: 16px; height: 2px;[^}]*background: var\(--tw-brand\)/,
    );
    expect(publicCss).toMatch(/\.article-body ul > li \{[^}]*padding-left: 28px/);
  });
});
