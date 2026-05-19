// Phase 5 / T21 regression: every ad-slot rendered on the public Home
// and Article surfaces MUST carry a non-empty `data-ad-slot` slot id
// AND a `data-ad-type` whose value is one of {leaderboard, in-feed,
// rect} (T21.AC1). Home in particular MUST render BOTH a leaderboard
// and an in-feed ad-slot so the layout contract from PART 1 (§6
// ad-leaderboard, §9 ad-in-feed) is pinned (T21.AC2).
//
// Test bindings (from implementation_digest.md / T21):
//   T21.AC1 — `^public-ad-slots.*data[_-]?attrs`
//   T21.AC2 — `^public-ad-slots.*leaderboard[_-]?and[_-]?in[_-]?feed`
//
// The describe label is `public-ad-slots`; the two it() names start
// with `data-attrs` and `leaderboard-and-in-feed` so vitest renders
// them as `public-ad-slots > data-attrs — …` /
// `public-ad-slots > leaderboard-and-in-feed — …`, which matches the
// AC1/AC2 name-regex bindings.

import { describe, it, expect } from "vitest";
import { renderHome } from "../src/public/templates/home";
import { renderArticle } from "../src/public/templates/article";
import type {
  HomeArticleCard,
  HomeViewModel,
} from "../src/public/view-models/home";
import type {
  ArticleCard,
  ArticleViewModel,
  BodyBlock,
} from "../src/public/view-models/article";

// The three allowed values from `AdSlotArgs.type` in
// api/src/public/templates/components.ts. Any rendered `data-ad-type`
// outside this set is a regression.
const ALLOWED_AD_TYPES = new Set(["leaderboard", "in-feed", "rect"]);

interface AdSlotAttrs {
  raw: string;
  slot: string | null;
  type: string | null;
  surface: string | null;
  ariaLabel: string | null;
}

// Pull every <aside class="ad-slot …"> tag out of a rendered HTML
// string and return its parsed attributes. We match on the `ad-slot`
// class token rather than on the literal <aside …> shape so any
// future ad-slot wrapper that gains extra classes still surfaces in
// the result set. The regex is permissive about attribute order so a
// regression that reorders the attributes (e.g. moves
// `data-ad-surface` before `data-ad-slot`) does NOT silently drop
// out of the result set.
function extractAdSlots(html: string): ReadonlyArray<AdSlotAttrs> {
  const tagRe = /<aside\b([^>]*)>/gi;
  const out: AdSlotAttrs[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const attrs = match[1] ?? "";
    const classMatch = /\bclass\s*=\s*"([^"]*)"/i.exec(attrs);
    const classes =
      classMatch === null || classMatch[1] === undefined
        ? []
        : classMatch[1].split(/\s+/).filter((s) => s.length > 0);
    if (!classes.includes("ad-slot")) continue;
    const get = (name: string): string | null => {
      const re = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i");
      const m = re.exec(attrs);
      if (m === null) return null;
      const value = m[1];
      return value === undefined ? null : value;
    };
    out.push({
      raw: match[0],
      slot: get("data-ad-slot"),
      type: get("data-ad-type"),
      surface: get("data-ad-surface"),
      ariaLabel: get("aria-label"),
    });
  }
  return out;
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

describe("public-ad-slots", () => {
  it("data-attrs — every ad-slot in renderHome and renderArticle carries data-ad-slot + data-ad-type in {leaderboard,in-feed,rect}", () => {
    const homeHtml = renderHome({ vm: makeHomeVm() });
    const articleHtml = renderArticle({ vm: makeArticleVm() });
    const homeSlots = extractAdSlots(homeHtml);
    const articleSlots = extractAdSlots(articleHtml);

    // Sanity: both surfaces actually emit ad-slot tags so the per-slot
    // assertions below are not vacuously satisfied by an empty list.
    expect(homeSlots.length, "home renders no ad-slot tags").toBeGreaterThan(0);
    expect(articleSlots.length, "article renders no ad-slot tags").toBeGreaterThan(0);

    for (const slot of [...homeSlots, ...articleSlots]) {
      // data-ad-slot MUST be present and non-empty — the slot id is
      // how downstream ad SDKs target the placement, and an empty id
      // collides every slot on the page to the same target.
      expect(slot.slot, `ad-slot missing data-ad-slot: ${slot.raw}`).not.toBeNull();
      expect(
        (slot.slot ?? "").length,
        `ad-slot empty data-ad-slot: ${slot.raw}`,
      ).toBeGreaterThan(0);

      // data-ad-type MUST be present and one of {leaderboard, in-feed,
      // rect}. The set is closed because the AdSlotArgs.type union in
      // api/src/public/templates/components.ts pins exactly these
      // three values; a regression that emits any other type string
      // surfaces here.
      expect(slot.type, `ad-slot missing data-ad-type: ${slot.raw}`).not.toBeNull();
      expect(
        ALLOWED_AD_TYPES.has(slot.type ?? ""),
        `ad-slot has disallowed data-ad-type=${slot.type}: ${slot.raw}`,
      ).toBe(true);

      // a11y guardrail: every ad-slot MUST expose an aria-label so
      // screen readers can announce the placement. The default
      // contract in renderAdSlot is `aria-label="Advertisement"`.
      expect(slot.ariaLabel, `ad-slot missing aria-label: ${slot.raw}`).not.toBeNull();
      expect(
        (slot.ariaLabel ?? "").length,
        `ad-slot empty aria-label: ${slot.raw}`,
      ).toBeGreaterThan(0);
    }

    // Slot ids MUST be unique within each surface — a duplicate slot
    // id collides ad-server targeting and is a regression on its own.
    const homeIds = homeSlots.map((s) => s.slot ?? "");
    const articleIds = articleSlots.map((s) => s.slot ?? "");
    expect(new Set(homeIds).size, `home slot ids not unique: ${homeIds.join(",")}`).toBe(homeIds.length);
    expect(
      new Set(articleIds).size,
      `article slot ids not unique: ${articleIds.join(",")}`,
    ).toBe(articleIds.length);
  });

  it("leaderboard-and-in-feed — renderHome emits both a leaderboard ad-slot and an in-feed ad-slot", () => {
    const homeHtml = renderHome({ vm: makeHomeVm() });
    const homeSlots = extractAdSlots(homeHtml);

    const homeTypes = homeSlots
      .map((s) => s.type)
      .filter((t): t is string => t !== null);

    // PART 1 §6 ad-leaderboard MUST be present on Home.
    expect(
      homeTypes,
      `home leaderboard ad-slot missing; types=${homeTypes.join(",")}`,
    ).toContain("leaderboard");

    // PART 1 §9 ad-in-feed MUST be present on Home.
    expect(
      homeTypes,
      `home in-feed ad-slot missing; types=${homeTypes.join(",")}`,
    ).toContain("in-feed");

    // Defense-in-depth: the section markers for §6 ad-leaderboard and
    // §9 ad-in-feed MUST appear in the rendered HTML so a regression
    // that drops the marker (but happens to leak a leaderboard
    // ad-slot from elsewhere) still surfaces.
    expect(homeHtml).toContain("<!-- home-section:6 ad-leaderboard -->");
    expect(homeHtml).toContain("<!-- home-section:9 ad-in-feed -->");

    // Defense-in-depth: the specific slot ids wired by
    // api/src/public/templates/home.ts MUST appear with the matching
    // data-ad-type — guards against a regression that swaps the
    // leaderboard/in-feed types between §6 and §9.
    const leaderboard = homeSlots.find((s) => s.slot === "home-leaderboard");
    expect(leaderboard, "home-leaderboard slot id not rendered").toBeDefined();
    expect(leaderboard!.type).toBe("leaderboard");

    const inFeed = homeSlots.find((s) => s.slot === "home-in-feed");
    expect(inFeed, "home-in-feed slot id not rendered").toBeDefined();
    expect(inFeed!.type).toBe("in-feed");
  });
});
