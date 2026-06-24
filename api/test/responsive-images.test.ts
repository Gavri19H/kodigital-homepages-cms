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

// RESCUE-4 round-5 (issue 5, live-verified 2026-06-24): Cloudflare Image
// Resizing IS enabled on the zone, so a rendered responsive <img> carries the
// bare /media/-prefixed src (the always-served Worker fallback), explicit
// width/height (anti-CLS), AND a srcset of /cdn-cgi/image/...,format=auto
// candidates (the ~2MB source PNG served as a resized WebP/AVIF). Every srcset
// candidate points at the transform route, which now returns 200.
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
  expect(src!.startsWith("/media/"), `src not /media/-prefixed (fallback): ${src}`).toBe(true);
  expect(src!).toContain(expectMediaKey);

  // The responsive srcset of Cloudflare transform candidates (resize + WebP).
  const srcset = attr(img, "srcset");
  expect(srcset, `missing srcset: ${img}`).not.toBeNull();
  const cands = parseSrcset(srcset as string);
  expect(cands.length, `srcset needs >=2 candidates: ${srcset}`).toBeGreaterThanOrEqual(2);
  for (const cand of cands) {
    expect(cand.url, `srcset candidate must be a /cdn-cgi/image transform: ${cand.url}`).toContain(
      "/cdn-cgi/image/",
    );
    expect(cand.url, "srcset candidate must auto-format (WebP/AVIF)").toContain("format=auto");
    expect(cand.url).toContain(expectMediaKey);
    expect(cand.descriptor, `srcset candidate needs a <N>w descriptor: ${cand.descriptor}`).toMatch(/^\d+w$/);
  }

  expect(attr(img, "width")).toBe(expectWidth);
  expect(attr(img, "height")).toBe(expectHeight);
}

describe("responsive-images", () => {
  it("T21.AC1 article hero + card 16/10 + sidebar 60×60 emit a /cdn-cgi srcset (resize+WebP) + /media/ src fallback at design dims [api/test/responsive-images.test.ts]", () => {
    const html = renderArticle({ vm: makeArticleVm(), emitJsonLd: false });

    // Article hero (LCP candidate): 1200×630, eager + fetchpriority="high".
    // RESCUE-4 design: the hero <img> lives INSIDE a `<div class="article-hero-img">`
    // wrapper (the <img> itself carries no class), so find it by its /media/ src
    // + the 1200 hero width.
    const hero = extractImgs(html).find(
      (t) => /\/media\/feature\.jpg/.test(t) && attr(t, "width") === "1200",
    );
    assertResponsive(hero, "feature.jpg", "1200", "630");
    expect(attr(hero!, "loading")).toBe("eager");
    expect(attr(hero!, "fetchpriority")).toBe("high");

    // Related card: 16/11 (640×440). Below-fold → lazy, no fetchpriority.
    // RESCUE-4 design: the card image is the design 16/11 treatment and lives
    // INSIDE a `<div class="card-img">` (the <img> itself carries no class), so
    // find it by its src + the 640 card width (the 60×60 pop thumb shares the
    // same src). 16/11 is the design `.card-img` aspect-ratio.
    const card = extractImgs(html).find(
      (t) => /\/media\/related-one\.jpg/.test(t) && attr(t, "width") === "640",
    );
    assertResponsive(card, "related-one.jpg", "640", "440");
    expect(640 / 440).toBeCloseTo(16 / 11, 5);
    expect(attr(card!, "loading")).toBe("lazy");
    expect(attr(card!, "fetchpriority")).toBeNull();

    // Sidebar popular thumb: 60×60. Below-fold → lazy.
    // RESCUE-4 design: the thumb lives INSIDE a `<span class="pop-img">` wrapper
    // (the <img> itself carries no class), so find it by its /media/ src + the
    // 60 thumb width.
    const pop = extractImgs(html).find(
      (t) => /\/media\/related-one\.jpg/.test(t) && attr(t, "width") === "60",
    );
    assertResponsive(pop, "related-one.jpg", "60", "60");
    expect(attr(pop!, "loading")).toBe("lazy");
    expect(attr(pop!, "fetchpriority")).toBeNull();
  });

  it("T21.AC1 responsiveImg primitive: bare /media/ src fallback + a /cdn-cgi srcset (resize+WebP, Image Resizing on), transform helpers correct [api/test/responsive-images.test.ts]", () => {
    // A bare storage key resolves to the /media/ public route (the fallback src).
    const tag = responsiveImg({
      src: "abc123.jpg",
      alt: "Alt text",
      width: 1200,
      height: 630,
      className: "x",
      loading: "lazy",
      sizes: "100vw",
    });
    expect(attr(tag, "src")).toBe("/media/abc123.jpg");
    expect(attr(tag, "width")).toBe("1200");
    expect(attr(tag, "height")).toBe("630");
    expect(attr(tag, "sizes")).toBe("100vw");

    // RESCUE-4 round-5: the markup now carries a srcset of /cdn-cgi/image
    // transform candidates (resize + format=auto), each resolving to the same
    // /media/ source — the zone has Image Resizing enabled.
    const psrcset = attr(tag, "srcset");
    expect(psrcset).not.toBeNull();
    const pcands = parseSrcset(psrcset as string);
    expect(pcands.length).toBeGreaterThanOrEqual(2);
    for (const cand of pcands) {
      expect(cand.url).toContain("/cdn-cgi/image/");
      expect(cand.url).toContain("format=auto");
      expect(cand.url).toContain("/media/abc123.jpg");
      expect(cand.descriptor).toMatch(/^\d+w$/);
    }

    // An off-origin (absolute) src can't use the same-origin transform route ->
    // it degrades to a bare <img> with NO srcset (never a broken transform).
    const ext = responsiveImg({ src: "https://cdn.example/x.jpg", alt: "x", width: 100, height: 100 });
    expect(attr(ext, "src")).toBe("https://cdn.example/x.jpg");
    expect(attr(ext, "srcset")).toBeNull();
    expect(ext).not.toContain("/cdn-cgi/");

    // The transform helpers are RETAINED and still produce correct Cloudflare
    // URLs (exercised in isolation; lqipUrl kept for a future blur-up pass).
    const widths = srcsetWidths(640);
    expect(widths.length).toBeGreaterThanOrEqual(2);
    expect([...widths].sort((a, b) => a - b)).toEqual(widths);
    expect(new Set(widths).size).toBe(widths.length);
    expect(widths).toContain(640);
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
