// T21 / RC-038 behavioral proof (T21-AC1): article images emit a srcset +
// a blur-up (LQIP) placeholder + a /media/-prefixed src at the design
// dimensions — article hero (1200×630), card 16/10 (640×400), and the
// sidebar 60×60 thumb. The proof renders renderArticle() and inspects the
// emitted <img> markup directly (behavioral, not a source grep); the
// responsiveImg primitive is also unit-tested for srcset correctness +
// comma-safety.
//
// The describe/it labels embed the literal evidence file path
// `[api/test/responsive-images.test.ts]` so the parse_test_output route
// (required_evidence_plan RC-038, expected_test_name_regex
// `api/test/responsive-images.test.ts`) binds the rendered observation.

import { describe, it, expect } from "vitest";
import { renderArticle } from "../src/public/templates/article";
import {
  responsiveImg,
  srcsetWidths,
  cfTransform,
  lqipUrl,
} from "../src/public/templates/responsive-img";
import type {
  ArticleCard,
  ArticleViewModel,
  BodyBlock,
} from "../src/public/view-models/article";

// Pull every <img …> tag out of a rendered HTML string. `.match()` (NOT a
// stateful regex iterator) so the global match returns the full tag list.
function extractImgs(html: string): string[] {
  return html.match(/<img\b[^>]*>/gi) ?? [];
}

// Read a quoted attribute value off a single <img> tag string.
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  if (m === null) return null;
  const value = m[1];
  return value === undefined ? null : value;
}

// Find the first <img> in `html` whose class list contains `cls`.
function imgWithClass(html: string, cls: string): string | undefined {
  return extractImgs(html).find((tag) => {
    const classValue = attr(tag, "class");
    if (classValue === null) return false;
    return classValue.split(/\s+/).includes(cls);
  });
}

// Parse a srcset value into [{url, descriptor}] candidates. Candidates are
// separated by ", " (comma+space); each candidate is "<url> <Nw>".
function parseSrcset(srcset: string): Array<{ url: string; descriptor: string }> {
  return srcset
    .split(", ")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((cand) => {
      const parts = cand.split(/\s+/);
      return { url: parts[0] ?? "", descriptor: parts[1] ?? "" };
    });
}

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

function makeArticleVm(overrides: Partial<ArticleViewModel> = {}): ArticleViewModel {
  const body: BodyBlock[] = [
    { type: "html", html: "<p>Opening paragraph of the story.</p>" },
    { type: "heading", level: 2, text: "Why it matters" },
    { type: "html", html: "<p>The point of the story.</p>" },
  ];
  return {
    site: {
      site_id: "site-acme",
      name: "Acme Daily",
      hostname: "acme.example",
      tagline: "Tomorrow's news today",
      description: "Acme Daily covers technology, world, and culture.",
      logoUrl: "https://acme.example/logo.png",
      brandTokens: {},
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
      body,
      contentText: "Opening paragraph of the story. Why it matters.",
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

// A responsive <img> must: src start with /media/ (the always-served public
// route, never a /cdn-cgi transform); carry a srcset of ≥2 candidates each
// with a `Nw` descriptor and a /cdn-cgi/image/.../media/ transform URL; carry
// a data-lqip blur-up placeholder; and declare explicit width/height.
function assertResponsive(
  tag: string | undefined,
  expectMediaKey: string,
  expectWidth: string,
  expectHeight: string,
): void {
  expect(tag, "responsive <img> not rendered").toBeDefined();
  const img = tag as string;

  const src = attr(img, "src");
  expect(src, `missing src: ${img}`).not.toBeNull();
  expect(src!.startsWith("/media/"), `src not /media/-prefixed: ${src}`).toBe(true);
  expect(src!).toContain(expectMediaKey);
  expect(src!).not.toContain("/cdn-cgi/");

  const srcset = attr(img, "srcset");
  expect(srcset, `missing srcset: ${img}`).not.toBeNull();
  const candidates = parseSrcset(srcset!);
  expect(candidates.length, `srcset has <2 candidates: ${srcset}`).toBeGreaterThanOrEqual(2);
  for (const c of candidates) {
    expect(c.descriptor, `candidate missing Nw descriptor: ${srcset}`).toMatch(/^\d+w$/);
    expect(c.url, `candidate not a /cdn-cgi image transform: ${c.url}`).toContain(
      "/cdn-cgi/image/",
    );
    expect(c.url, `candidate transform must point at the /media source: ${c.url}`).toContain(
      `/media/${expectMediaKey}`,
    );
  }

  const lqip = attr(img, "data-lqip");
  expect(lqip, `missing blur-up LQIP placeholder: ${img}`).not.toBeNull();
  expect(lqip!, `LQIP must be a blurred transform: ${lqip}`).toContain("blur=");
  expect(lqip!).toContain("/cdn-cgi/image/");

  const style = attr(img, "style");
  expect(style, `LQIP must paint as the element background: ${img}`).not.toBeNull();
  expect(style!).toContain(`background-image:url(${lqip})`);

  expect(attr(img, "width")).toBe(expectWidth);
  expect(attr(img, "height")).toBe(expectHeight);
}

describe("responsive-images", () => {
  it("T21.AC1 article hero + card 16/10 + sidebar 60×60 emit srcset + blur-up LQIP + /media/ src at design dims [api/test/responsive-images.test.ts]", () => {
    const html = renderArticle({ vm: makeArticleVm(), emitJsonLd: false });

    // Article hero (LCP candidate): 1200×630, eager + fetchpriority="high".
    const hero = imgWithClass(html, "article-hero-img");
    assertResponsive(hero, "feature.jpg", "1200", "630");
    expect(attr(hero!, "loading")).toBe("eager");
    expect(attr(hero!, "fetchpriority")).toBe("high");

    // Related card: 16/10 (640×400). Below-fold → lazy, no fetchpriority.
    const card = imgWithClass(html, "card-img");
    assertResponsive(card, "related-one.jpg", "640", "400");
    expect(640 / 400).toBeCloseTo(16 / 10, 5);
    expect(attr(card!, "loading")).toBe("lazy");
    expect(attr(card!, "fetchpriority")).toBeNull();

    // Sidebar popular thumb: 60×60. Below-fold → lazy.
    const pop = imgWithClass(html, "pop-img");
    assertResponsive(pop, "related-one.jpg", "60", "60");
    expect(attr(pop!, "loading")).toBe("lazy");
    expect(attr(pop!, "fetchpriority")).toBeNull();
  });

  it("T21.AC1 responsiveImg primitive: /media/ src, ≥2 srcset widths, comma-safe candidates, blurred LQIP [api/test/responsive-images.test.ts]", () => {
    // A bare storage key resolves to the /media/ public route.
    const tag = responsiveImg({
      src: "abc123.jpg",
      alt: "Alt text",
      width: 1200,
      height: 630,
      className: "x",
      loading: "lazy",
    });
    expect(attr(tag, "src")).toBe("/media/abc123.jpg");

    // srcset widths: ≥2, sorted ascending, unique, include the display width.
    const widths = srcsetWidths(640);
    expect(widths.length).toBeGreaterThanOrEqual(2);
    expect([...widths].sort((a, b) => a - b)).toEqual(widths);
    expect(new Set(widths).size).toBe(widths.length);
    expect(widths).toContain(640);

    // Comma-safety: even though each /cdn-cgi transform URL contains commas
    // in its option list, splitting the srcset on ", " yields exactly one
    // "<url> <Nw>" candidate per width (the descriptor is the whitespace
    // boundary the HTML srcset parser keys on).
    const srcset = attr(tag, "srcset")!;
    const candidates = parseSrcset(srcset);
    expect(candidates.length).toBe(srcsetWidths(1200).length);
    for (const c of candidates) {
      expect(c.descriptor).toMatch(/^\d+w$/);
      expect(c.url).toContain("/cdn-cgi/image/");
    }

    // LQIP is a tiny blurred transform of the same /media source.
    const lqip = lqipUrl("/media/abc123.jpg");
    expect(lqip).toContain("blur=");
    expect(lqip).toContain("width=32");
    expect(lqip).toContain("/media/abc123.jpg");
    expect(cfTransform("/media/abc123.jpg", "width=80")).toBe(
      "/cdn-cgi/image/width=80/media/abc123.jpg",
    );

    // Empty/absent src → no <img> at all (no /media/null, no broken tag).
    expect(responsiveImg({ src: null, alt: "x", width: 10, height: 10 })).toBe("");
    expect(responsiveImg({ src: "   ", alt: "x", width: 10, height: 10 })).toBe("");
  });
});
