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
import { parseAdsConfig } from "../src/public/ads";
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
    expect(doc).toContain('href="/assets/public.css?v=');
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
    // pullquote -> <blockquote class="pullquote"> with the design .pq-mark glyph
    // preceding the quote text (design ArticleApp pullquote DOM).
    expect(body).toContain('<blockquote class="pullquote"><span class="pq-mark" aria-hidden="true">"</span>A standout quote.');
    // image -> <figure class="article-figure"> through the /media route.
    expect(body).toContain('<figure class="article-figure">');
    expect(body).toContain('src="/media/inline.jpg"');
    // callout -> design `.callout-box` is a <div> with an <h4> title + a <p>
    // body (the worker callout VM carries a single free-text body, so the
    // design's <ul><li> checklist form is not emitted — see article.ts).
    expect(body).toContain('<div class="callout-box">');
    expect(body).toContain("<h4>Note</h4>");
    expect(body).toContain("Pay attention to this.");
    // affiliate -> design `.affiliate-card`: rescue-4 round-4 (issue 4c) restored
    // a small thumb that reuses the article's OWN feature image (the affiliate
    // block carries no image field). The WHOLE card is still the sponsored/nofollow
    // <a>, now the 3-col layout: an `.affiliate-img` thumb, an `.affiliate-eyebrow`,
    // an <h4> name and an `.affiliate-cta` "{cta} →" pill (see article.ts).
    expect(body).toContain('<a class="affiliate-card" href="https://shop.example/widget" target="_blank" rel="sponsored nofollow noopener">');
    expect(body).not.toContain("affiliate-card--noimg");
    expect(body).toContain('<span class="affiliate-eyebrow">Editor\'s pick</span>');
    expect(body).toContain("<h4>Best Widget</h4>");
    expect(body).toContain('<span class="affiliate-cta">Buy now →</span>');
    // POSITIVE: the thumb is present and is the article feature image (issue 4c).
    expect(body).toContain('<div class="affiliate-img"><img src="/media/feature.jpg"');

    // drop-cap present in the served stylesheet (contract §11: 4.2em brand).
    expect(publicCss).toContain("p:first-of-type::first-letter");
    expect(publicCss).toMatch(
      /\.article-body > p:first-of-type::first-letter \{[^}]*font-size: 4\.2em;[^}]*color: var\(--tw-brand\)/,
    );
    // brand dash bullets present (contract §11: 16x2px brand dash, li pad 28px).
    expect(publicCss).toMatch(
      /\.article-body > ul > li::before \{[^}]*width: 16px; height: 2px;[^}]*background: var\(--tw-brand\)/,
    );
    expect(publicCss).toMatch(/\.article-body > ul > li \{[^}]*padding-left: 28px/);
  });

  it("rescue-5 (issue 4): in-content ad renders with its OWN gam_unit_in_content after the Nth paragraph (once); falls back to the rect unit without a distinct unit; absent when ads off [api/test/article-design.test.ts]", () => {
    const vm = makeVm();
    const article = {
      ...vm.article,
      body: [
        { type: "paragraph", text: "Para one." },
        { type: "paragraph", text: "Para two." },
        { type: "heading", level: 2, text: "A heading" },
        { type: "paragraph", text: "Para three." },
      ],
    } as ArticleViewModel["article"];

    // GAM live with a DISTINCT in-content unit (issue 4: it MUST differ from the
    // sidebar rect unit, or GAM can't serve the same ad unit twice on one page).
    const ads = parseAdsConfig({
      ads_enabled: "1",
      ad_provider: "gam",
      gam_network_code: "23456789",
      gam_unit_rect: "sidebar_rect",
      gam_unit_in_content: "in_content_rect",
      ad_in_content_position: "2",
    });
    const withAds = renderArticle({ vm: { ...vm, article }, ads, emitJsonLd: false });
    expect(withAds).toContain("ad-slot--in-content");
    // the in-content uses its OWN unit, NOT the sidebar rect unit.
    expect(withAds).toContain('data-gpt-unit="/23456789/in_content_rect"');
    const adAt = withAds.indexOf("ad-slot--in-content");
    expect(withAds.indexOf("Para two.")).toBeLessThan(adAt);
    expect(adAt).toBeLessThan(withAds.indexOf("Para three."));
    expect(withAds.split("ad-slot--in-content").length - 1).toBe(1);

    // rescue-5 (issue 4): GAM live, NO distinct in-content unit -> the in-content slot
    // FALLS BACK to the sidebar rect unit (renders, not skipped). Lazy-load disables
    // SRA so the duplicate rect unit serves both slots as independent requests.
    const noDistinct = parseAdsConfig({
      ads_enabled: "1",
      ad_provider: "gam",
      gam_network_code: "23456789",
      gam_unit_rect: "sidebar_rect",
      ad_in_content_position: "2",
    });
    const fallback = renderArticle({ vm: { ...vm, article }, ads: noDistinct, emitJsonLd: false });
    expect(fallback).toContain("ad-slot--in-content");
    expect(fallback).toContain('data-gpt-unit="/23456789/sidebar_rect"');

    // No ads config -> no in-content slot at all.
    const noAds = renderArticle({ vm: { ...vm, article }, emitJsonLd: false });
    expect(noAds).not.toContain("ad-slot--in-content");
  });
});
