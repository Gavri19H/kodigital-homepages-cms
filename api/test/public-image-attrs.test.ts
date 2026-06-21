// Phase 5 / T20 regression: every <img> emitted by renderHome and
// renderArticle MUST carry alt + width + height attributes (T20.AC1),
// and every below-fold <img> MUST carry loading="lazy" (T20.AC2).
//
// Above-fold images (site-header logo, hero, article-hero-img) are
// allowed to use loading="eager" — those are the LCP candidates and
// should NOT be lazy-loaded. Below-fold images (cards, inline article
// figures, floating-next preview) MUST be lazy.
//
// Test bindings (from implementation_digest.md / T20):
//   T20.AC1 — `^public-image-attrs.*alt[_-]?width[_-]?height`
//   T20.AC2 — `^public-image-attrs.*lazy[_-]?below[_-]?fold`
//
// The describe label is `public-image-attrs`; the two it() names start
// with `alt-width-height` and `lazy-below-fold` so vitest renders them
// as `public-image-attrs > alt-width-height — …` /
// `public-image-attrs > lazy-below-fold — …`, which matches the
// AC1/AC2 name-regex bindings.

import { describe, it, expect } from "vitest";
import { renderHome } from "../src/public/templates/home";
import { renderArticle } from "../src/public/templates/article";
import { publicCss } from "../src/public/assets/public-css";
import { PUBLIC_CSS } from "../src/public/templates/public.css";
import type {
  HomeArticleCard,
  HomeViewModel,
} from "../src/public/view-models/home";
import type {
  ArticleCard,
  ArticleViewModel,
  BodyBlock,
} from "../src/public/view-models/article";

interface ImgAttrs {
  raw: string;
  alt: string | null;
  width: string | null;
  height: string | null;
  loading: string | null;
  fetchpriority: string | null;
  classes: ReadonlyArray<string>;
}

// Pull every <img …> tag out of a rendered HTML string and return its
// parsed attributes. We use a permissive attribute regex (allowing
// arbitrary attribute order + quoted values) so any future templates
// that add an <img> with a different attribute order still surface in
// the result set.
function extractImgs(html: string): ReadonlyArray<ImgAttrs> {
  const imgRe = /<img\b([^>]*)>/gi;
  const out: ImgAttrs[] = [];
  let match: RegExpExecArray | null;
  while ((match = imgRe.exec(html)) !== null) {
    const attrs = match[1] ?? "";
    const get = (name: string): string | null => {
      const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
      const m = re.exec(attrs);
      if (m === null) return null;
      const value = m[1];
      return value === undefined ? null : value;
    };
    const cls = get("class");
    out.push({
      raw: match[0],
      alt: get("alt"),
      width: get("width"),
      height: get("height"),
      loading: get("loading"),
      fetchpriority: get("fetchpriority"),
      classes: cls === null ? [] : cls.split(/\s+/).filter((s) => s.length > 0),
    });
  }
  return out;
}

// "Above-fold" images use loading="eager" (LCP candidates: site-header
// logo, Home hero, Article hero). Every other rendered <img> in the
// public surfaces (card thumbnails, inline article figures, the
// floating-next preview) is "below-fold" and MUST be lazy. Because the
// hero/card images are emitted through a shared imgTag() helper that
// does NOT attach a CSS class, we cannot key off `class` alone — but
// the loading="eager" / loading="lazy" attribute itself is the
// authored contract, so we use that as the discriminator.
function isAboveFold(img: ImgAttrs): boolean {
  return img.loading === "eager";
}

function isBelowFold(img: ImgAttrs): boolean {
  return img.loading === "lazy";
}

// Slice a rendered HTML string into the segments between the
// `<!-- home-section:N name -->` / `<!-- article-section:N name -->`
// markers so a test can ask "which images appear in §3 (chip-rail) and
// later?" — i.e. the below-the-fold region.
function sectionRegions(html: string, prefix: "home" | "article"): Map<string, string> {
  const markerRe = new RegExp(
    `<!--\\s*${prefix}-section:(\\d+)\\s+([a-z0-9-]+)\\s*-->`,
    "gi",
  );
  const matches: Array<{ idx: number; name: string; start: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(html)) !== null) {
    const idxRaw = m[1] ?? "0";
    const nameRaw = m[2] ?? "";
    matches.push({ idx: Number(idxRaw), name: nameRaw, start: m.index });
  }
  const regions = new Map<string, string>();
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    if (cur === undefined) continue;
    const nxt = matches[i + 1];
    const start = cur.start;
    const end = nxt !== undefined ? nxt.start : html.length;
    regions.set(cur.name, html.slice(start, end));
  }
  return regions;
}

function makeHomeCard(overrides: Partial<HomeArticleCard> = {}): HomeArticleCard {
  return {
    id: 1,
    slug: "story-one",
    title: "Story one",
    excerpt: "Lede sentence for story one.",
    href: "/article/story-one",
    imageUrl: "/media/story-one.jpg",
    imageAlt: "Story one image",
    publishedAt: "2026-05-18T10:00:00.000Z",
    categoryName: "Tech",
    categorySlug: "tech",
    readMinutes: 4,
    ...overrides,
  };
}

function makeHomeVm(overrides: Partial<HomeViewModel> = {}): HomeViewModel {
  const hero = makeHomeCard({
    id: 100,
    slug: "hero",
    title: "Hero story",
    href: "/article/hero",
    imageUrl: "/media/hero.jpg",
    imageAlt: "Hero illustration",
  });
  const featured = [
    makeHomeCard({ id: 1, slug: "f1", title: "Featured one", href: "/article/f1" }),
    makeHomeCard({ id: 2, slug: "f2", title: "Featured two", href: "/article/f2" }),
    makeHomeCard({ id: 3, slug: "f3", title: "Featured three", href: "/article/f3" }),
  ];
  const latest = Array.from({ length: 8 }).map((_, i) =>
    makeHomeCard({
      id: 10 + i,
      slug: `l${i + 1}`,
      title: `Latest ${i + 1}`,
      href: `/article/l${i + 1}`,
    }),
  );
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
    hero,
    featured,
    picks: [],
    trending: [],
    latest,
    categories: [
      { id: 1, slug: "tech", name: "Tech", href: "/category/tech" },
      { id: 2, slug: "world", name: "World", href: "/category/world" },
      { id: 3, slug: "culture", name: "Culture", href: "/category/culture" },
    ],
    newsletter: {
      heading: "Acme Daily newsletter",
      description: "Get the brief in your inbox.",
      provider: "buttondown",
    },
    meta: {
      title: "Acme Daily — Tomorrow's news today",
      description: "Acme Daily covers technology, world, and culture.",
      canonicalUrl: "https://acme.example/",
    },
    ...overrides,
  };
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
  // Body includes an inline image block so the figure-image lazy-load
  // path is exercised alongside the (eager) article-hero-img.
  const body: BodyBlock[] = [
    { type: "html", html: "<p>Opening paragraph of the story.</p>" },
    { type: "heading", level: 2, text: "Why it matters" },
    {
      type: "image",
      src: "/media/figure-1.jpg",
      alt: "An inline figure illustrating the point",
      caption: "Figure 1 — the figure caption.",
    },
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
      contentText:
        "Opening paragraph of the story. Why it matters The point of the story.",
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

describe("public-image-attrs", () => {
  it("T20.AC1: alt-width-height — every <img> in renderHome and renderArticle carries alt, width and height attributes", () => {
    const homeHtml = renderHome({ vm: makeHomeVm() });
    const articleHtml = renderArticle({ vm: makeArticleVm() });
    const homeImgs = extractImgs(homeHtml);
    const articleImgs = extractImgs(articleHtml);

    // Sanity: both surfaces actually emit <img> tags (so the per-img
    // assertions below are not vacuously satisfied by an empty list).
    expect(homeImgs.length).toBeGreaterThan(0);
    expect(articleImgs.length).toBeGreaterThan(0);

    for (const img of [...homeImgs, ...articleImgs]) {
      // alt MUST be present (empty string is allowed — decorative imgs
      // legitimately use alt="" — but the attribute itself must exist
      // so screen readers see an explicit empty alt rather than an
      // anonymous fallback).
      expect(img.alt, `img missing alt: ${img.raw}`).not.toBeNull();
      // width + height MUST be present and non-empty so the browser can
      // reserve the intrinsic box and avoid CLS.
      expect(img.width, `img missing width: ${img.raw}`).not.toBeNull();
      expect(img.height, `img missing height: ${img.raw}`).not.toBeNull();
      expect((img.width ?? "").length, `img empty width: ${img.raw}`).toBeGreaterThan(0);
      expect((img.height ?? "").length, `img empty height: ${img.raw}`).toBeGreaterThan(0);
    }
  });

  it("lazy-below-fold — below-fold <img> tags in renderHome and renderArticle carry loading=\"lazy\"", () => {
    const homeHtml = renderHome({ vm: makeHomeVm() });
    const articleHtml = renderArticle({ vm: makeArticleVm() });
    const homeImgs = extractImgs(homeHtml);
    const articleImgs = extractImgs(articleHtml);

    // 1. Every <img> emitted by either public surface MUST carry an
    // EXPLICIT loading attribute (eager OR lazy). No implicit
    // "browser default" — the rendered surface must declare its
    // hint explicitly so below-fold images cannot regress to the
    // default eager behaviour.
    for (const img of [...homeImgs, ...articleImgs]) {
      expect(img.loading, `img missing loading attr: ${img.raw}`).not.toBeNull();
      expect(["eager", "lazy"]).toContain(img.loading!);
    }

    // 2. Above-fold images (LCP candidates) are bounded — at most
    // two `loading="eager"` per surface (the site-header logo and
    // the hero / article-hero-img). Any third "eager" img is a
    // below-fold regression.
    const homeEager = homeImgs.filter(isAboveFold).length;
    const articleEager = articleImgs.filter(isAboveFold).length;
    expect(homeEager, `home has too many eager imgs (${homeEager})`).toBeLessThanOrEqual(2);
    expect(
      articleEager,
      `article has too many eager imgs (${articleEager})`,
    ).toBeLessThanOrEqual(2);

    // 3. Both surfaces MUST render at least one below-fold
    // `loading="lazy"` <img> — proves card/figure/floating-next
    // images actually get the lazy hint.
    expect(
      homeImgs.filter(isBelowFold).length,
      "home renders no lazy <img> tags",
    ).toBeGreaterThan(0);
    expect(
      articleImgs.filter(isBelowFold).length,
      "article renders no lazy <img> tags",
    ).toBeGreaterThan(0);

    // 4. Section-region check on Home: every <img> rendered in or
    // after the §3 chip-rail marker is below-fold and MUST be
    // lazy. §1 site-header (logo) and §2 hero are above-fold and
    // are excluded from this check.
    const homeRegions = sectionRegions(homeHtml, "home");
    expect(homeRegions.size).toBeGreaterThan(0);
    for (const [name, region] of homeRegions.entries()) {
      if (name === "site-header" || name === "hero") continue;
      for (const img of extractImgs(region)) {
        expect(
          img.loading,
          `home §${name} img not lazy: ${img.raw}`,
        ).toBe("lazy");
      }
    }

    // 5. Section-region check on Article: every <img> rendered in
    // or after §4 reading-progress is below-fold and MUST be lazy.
    // §1 site-header (logo) and §3 article-hero are above-fold and
    // are excluded from this check.
    const articleRegions = sectionRegions(articleHtml, "article");
    expect(articleRegions.size).toBeGreaterThan(0);
    for (const [name, region] of articleRegions.entries()) {
      if (name === "site-header" || name === "article-hero") continue;
      for (const img of extractImgs(region)) {
        expect(
          img.loading,
          `article §${name} img not lazy: ${img.raw}`,
        ).toBe("lazy");
      }
    }

    // 6. Defense-in-depth: the inline article-body figure image MUST
    // be lazy — guards against a regression that silently drops
    // loading="lazy" from the article body renderer for the
    // `image` BodyBlock.
    const figureImg = articleImgs.find((i) =>
      /\/media\/figure-1\.jpg/.test(i.raw),
    );
    expect(figureImg, "article figure image not rendered").toBeDefined();
    expect(figureImg!.loading).toBe("lazy");
  });
});

// T42 [F3] Performance re-assert. AC1 binds the deterministic evidence
// route for RC-125, so the it() title embeds the literal evidence
// command "cd api && npx vitest run test/public-image-attrs.test.ts".
describe("public-image-attrs T42 performance re-assert", () => {
  it("T42.AC1 hero eager+high; below-fold lazy [cd api && npx vitest run test/public-image-attrs.test.ts]", () => {
    const homeHtml = renderHome({ vm: makeHomeVm() });
    const articleHtml = renderArticle({ vm: makeArticleVm() });
    const homeImgs = extractImgs(homeHtml);
    const articleImgs = extractImgs(articleHtml);

    // RESCUE-4 design: the §2 home hero is a PURE CSS gradient `.hero-bg` (no
    // <img> — and no uploaded-logo <img> in §1 either, the brand mark is a
    // teal-square initial), so the home surface renders NO above-fold <img> at
    // all. The LCP is the CSS gradient, not an image. Assert the hero region
    // carries no <img> and the home has zero eager images.
    const homeRegions = sectionRegions(homeHtml, "home");
    const heroRegion = homeRegions.get("hero");
    expect(heroRegion, "home §hero region missing").toBeDefined();
    const heroImgs = extractImgs(heroRegion!);
    expect(heroImgs.length, "design home hero must render no <img> (CSS gradient)").toBe(0);
    expect(
      homeImgs.filter(isAboveFold).length,
      "design home surface must render no eager (above-fold) <img>",
    ).toBe(0);

    // Article hero — same contract on the article-hero-img.
    const articleHeroImg = articleImgs.find((i) =>
      i.classes.includes("article-hero-img"),
    );
    expect(articleHeroImg, "article-hero-img not rendered").toBeDefined();
    expect(articleHeroImg!.loading).toBe("eager");
    expect(articleHeroImg!.fetchpriority).toBe("high");

    // fetchpriority="high" is RESERVED for eager (above-fold) images:
    // a lazy img with fetchpriority would compete with the hero for
    // early-fetch bandwidth — that is a below-fold regression.
    for (const img of [...homeImgs, ...articleImgs]) {
      if (img.loading === "lazy") {
        expect(
          img.fetchpriority,
          `lazy img must not carry fetchpriority: ${img.raw}`,
        ).toBeNull();
      }
    }

    // Below-fold lazy re-assert: both surfaces render at least one
    // loading="lazy" <img>, and every img outside the above-fold
    // sections is lazy.
    expect(homeImgs.filter(isBelowFold).length).toBeGreaterThan(0);
    expect(articleImgs.filter(isBelowFold).length).toBeGreaterThan(0);
    for (const [name, region] of homeRegions.entries()) {
      if (name === "site-header" || name === "hero") continue;
      for (const img of extractImgs(region)) {
        expect(img.loading, `home §${name} img not lazy: ${img.raw}`).toBe("lazy");
      }
    }
    const articleRegions = sectionRegions(articleHtml, "article");
    for (const [name, region] of articleRegions.entries()) {
      if (name === "site-header" || name === "article-hero") continue;
      for (const img of extractImgs(region)) {
        expect(img.loading, `article §${name} img not lazy: ${img.raw}`).toBe("lazy");
      }
    }
  });

  it("T42.AC2 ad-slot dimension rules present in both css files", () => {
    // assets/public-css.ts — the Phase-5 generic stylesheet served at
    // /assets/public.css reserves ad-slot boxes per data-ad-type.
    expect(publicCss).toContain(".ad-slot");
    expect(publicCss).toContain('.ad-slot[data-ad-type="leaderboard"]');
    expect(publicCss).toMatch(
      /\.ad-slot\[data-ad-type="leaderboard"\][^}]*min-height:\s*90px/,
    );
    expect(publicCss).toMatch(
      /\.ad-slot\[data-ad-type="rect"\][^}]*min-height:\s*250px/,
    );

    // templates/public.css.ts — the inlined anti-CLS bundle reserves
    // the same boxes for the default + variant slots.
    expect(PUBLIC_CSS).toContain(".ad-slot");
    expect(PUBLIC_CSS).toContain("min-height");
    expect(PUBLIC_CSS).toMatch(/\.ad-slot\s*{[^}]*min-height/);
  });
});
