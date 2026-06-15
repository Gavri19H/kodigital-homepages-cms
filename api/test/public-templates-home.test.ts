// Phase 5 / T10+T11 BEHAVIORAL guards for renderHome.
//
// T11.AC1 (section-order): the 13 home-section markers appear in the
// rendered output in the exact docs/design-contract.md §7 sequence —
// site-header, hero, chip-rail, featured, ad-leaderboard, editors-picks,
// trending, spotlight, ad-in-feed, latest, newsletter, site-footer,
// floating-next — each exactly once. Contract §7: there is NO standalone
// site-description ("About") panel on Home. The test name MUST match
// `^public-templates-home.*section[_-]?order` per the implementation
// digest binding.
//
// T10.AC3 (brand-from-site): every visible brand string flows from
// vm.site.name (and the per-card payload). Hard-coded vertical brand
// tokens (TheIWise / theiwise / cms.kodigital.app) MUST NOT appear in
// the rendered body. The test name MUST match
// `^public-templates-home.*brand[_-]?from[_-]?site` per the digest binding.
//
// T11.AC3 (floating-next): renderHome emits the floating "Read next"
// button exactly once, with a real /article/<slug> href (PART 8).
//
// PART 8 RED LINE: rendered output never contains href="#".

import { describe, it, expect } from "vitest";
import { renderHome } from "../src/public/templates/home";
import { renderLayout } from "../src/public/templates/layout";
import type {
  HomeViewModel,
  HomeArticleCard,
} from "../src/public/view-models/home";

function makeCard(overrides: Partial<HomeArticleCard> = {}): HomeArticleCard {
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

function makeVm(overrides: Partial<HomeViewModel> = {}): HomeViewModel {
  const hero = makeCard({ id: 100, slug: "hero", title: "Hero story", href: "/article/hero" });
  const featured = [
    makeCard({ id: 1, slug: "f1", title: "Featured one", href: "/article/f1" }),
    makeCard({ id: 2, slug: "f2", title: "Featured two", href: "/article/f2" }),
    makeCard({ id: 3, slug: "f3", title: "Featured three", href: "/article/f3" }),
  ];
  const latest = Array.from({ length: 8 }).map((_, i) =>
    makeCard({ id: 10 + i, slug: `l${i + 1}`, title: `Latest ${i + 1}`, href: `/article/l${i + 1}` }),
  );
  return {
    site: {
      site_id: "site-acme",
      name: "Acme Daily",
      hostname: "acme.example",
      tagline: "Tomorrow's news today",
      description: "Acme Daily covers technology, world, and culture.",
      logoUrl: null,
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

// T9 (C4) / BCL-047: the Home root wrapper legitimately carries
// `data-screen-label=theiwise-home` (decoded design-export screen name).
// Strip data-screen-label attributes BEFORE the whole-HTML /theiwise/i
// sweep. Only dot-free lowercase values are stripped, anchored at
// whitespace/`>`, so a banned `<brand>.com` hostname inside the attribute
// is left intact and still trips the ban.
function stripScreenLabelAttrs(html: string): string {
  return html
    .replace(/\sdata-screen-label="[a-z0-9-]+"/g, "")
    .replace(/\sdata-screen-label=[a-z0-9-]+(?=[\s>])/g, "");
}

// docs/design-contract.md §7 — the exact 13-section Home sequence.
const CONTRACT_SECTION_SEQUENCE = [
  "1 site-header",
  "2 hero",
  "3 chip-rail",
  "4 featured",
  "5 ad-leaderboard",
  "6 editors-picks",
  "7 trending",
  "8 spotlight",
  "9 ad-in-feed",
  "10 latest",
  "11 newsletter",
  "12 site-footer",
  "13 floating-next",
];

function extractMarkerSequence(html: string): string[] {
  const matches = html.matchAll(/home-section:(\d+ [a-z-]+)/g);
  return Array.from(matches, (m) => m[1] ?? "");
}

describe("public-templates-home", () => {
  it("T11.AC1: section-order — emits the exact 13-section marker sequence of contract §7", () => {
    const html = renderHome({ vm: makeVm() });
    const seq = extractMarkerSequence(html);
    expect(seq).toEqual(CONTRACT_SECTION_SEQUENCE);
    // each marker is unique (no double-rendered section)
    expect(new Set(seq).size).toBe(13);
    // contract §7: NO standalone site-description panel on Home
    expect(html).not.toMatch(/home-section:\d+ about/);
    expect(html).not.toContain("home-about");
  });

  it("section-order — section markers stay in order when buckets are empty", () => {
    const html = renderHome({
      vm: makeVm({ hero: null, featured: [], latest: [], categories: [] }),
    });
    const seq = extractMarkerSequence(html);
    expect(seq).toEqual(CONTRACT_SECTION_SEQUENCE);
    // with no stories the floating-next aside is omitted (no dead link),
    // but its marker above still keeps the section count at 13
    expect(html).not.toContain('class="floating-next"');
  });

  it("T11.AC3: floating-next — renders exactly once with a real article href", () => {
    const html = renderHome({ vm: makeVm() });
    const asides = html.match(/class="floating-next"/g) ?? [];
    expect(asides.length).toBe(1);
    // target is the lead story (vm.hero) — PART 8 real URL, never "#"
    expect(html).toMatch(/floating-next__link" href="\/article\/hero"/);
    expect(html).toContain("Hero story");
  });

  it("T10.AC3: brand-from-site — output contains site.name and never the banned vertical tokens", () => {
    const html = renderHome({ vm: makeVm() });

    // site.name flows through header + footer
    expect(html).toContain("Acme Daily");

    // PART 12 RED LINE — no hardcoded vertical brand. The /theiwise/i
    // pattern already covers the .com / staging. / app. variants.
    // (data-screen-label attributes stripped first per BCL-047.)
    expect(stripScreenLabelAttrs(html)).not.toMatch(/theiwise/i);
    expect(html).not.toContain("cms.kodigital.app");

    // PART 8 RED LINE — no placeholder anchors
    expect(html).not.toContain('href="#"');
  });

  it("brand-from-site — site.name surfaces in header + footer regions", () => {
    const html = renderHome({
      vm: makeVm({
        site: {
          site_id: "a",
          name: "Beta Tribune",
          hostname: "beta.example",
          tagline: "Tomorrow's wires",
          description: "Independent reporting for the working week.",
          logoUrl: null,
          brandTokens: {},
        },
        // Use a generic newsletter heading so the brand-name assertions only
        // count site-sourced surfaces, not the per-site newsletter copy.
        newsletter: {
          heading: "Newsletter",
          description: "",
          provider: null,
        },
      }),
    });
    // header brand wordmark
    expect(html).toMatch(/<header class="site-header"[\s\S]*Beta Tribune/);
    // footer copyright
    expect(html).toMatch(/site-footer__copyright[^<]*Beta Tribune/);
    // banned tokens still absent (screen-label attributes stripped first)
    expect(stripScreenLabelAttrs(html)).not.toMatch(/theiwise/i);
    expect(html).not.toContain("cms.kodigital.app");
  });

  it("renders category chips with real /category/<slug> hrefs", () => {
    const html = renderHome({ vm: makeVm() });
    expect(html).toContain('href="/category/tech"');
    expect(html).toContain('href="/category/world"');
    expect(html).toContain('href="/category/culture"');
  });

  it("renders ad slots in both leaderboard and in-feed surfaces", () => {
    const html = renderHome({ vm: makeVm() });
    expect(html).toContain('data-ad-type="leaderboard"');
    expect(html).toContain('data-ad-type="in-feed"');
    expect(html).toContain('data-ad-slot="home-leaderboard"');
    expect(html).toContain('data-ad-slot="home-in-feed"');
  });

  // T1 (rescue-3) AC5 / RC-003 — render-output: renderHome + renderLayout
  // together emit the 13 home-section markers AND the inline --tw-brand
  // brand-token override. This is the design-system render contract the
  // live homepage (renderHomepageHtml) composes; the bare rescue-2 fallback
  // emitted neither. The file-path literal in the title is the
  // deterministic binding for the required_evidence_plan parse_test_output
  // route (expected_test_name_regex = api/test/public-templates-home.test.ts).
  it("T1.AC5 render-output: renderHome+renderLayout emit the 13 home-section markers + inline --tw-brand [api/test/public-templates-home.test.ts]", () => {
    // brand_tokens_json from the site row drives renderLayout's inline
    // `--tw-*` override (T8 will seed #1ba8c8 from the brand contract).
    const vm = makeVm({
      site: {
        site_id: "site-acme",
        name: "Acme Daily",
        hostname: "acme.example",
        tagline: "Tomorrow's news today",
        description: "Acme Daily covers technology, world, and culture.",
        logoUrl: null,
        brandTokens: { "tw-brand": "#1ba8c8" },
      },
    });

    const body = renderHome({ vm });
    // renderHome owns the 13 ordered sections (contract §7).
    const bodySeq = extractMarkerSequence(body);
    expect(bodySeq).toEqual(CONTRACT_SECTION_SEQUENCE);
    expect(new Set(bodySeq).size).toBe(13);

    const doc = renderLayout({
      site: {
        name: vm.site.name,
        hostname: vm.site.hostname,
        tagline: vm.site.tagline,
        description: vm.site.description,
        brandTokens: vm.site.brandTokens,
        logoUrl: vm.site.logoUrl,
      },
      meta: {
        title: vm.meta.title,
        description: vm.meta.description,
        canonicalUrl: vm.meta.canonicalUrl,
      },
      body,
    });

    // The 13 markers survive into the full document (renderLayout wraps the
    // renderHome body verbatim inside <main>).
    expect(extractMarkerSequence(doc)).toEqual(CONTRACT_SECTION_SEQUENCE);
    // Inline --tw-brand override sourced from brand_tokens_json.
    expect(doc).toContain('<style data-source="brand_tokens">');
    expect(doc).toContain("--tw-brand: #1ba8c8;");
    // Design-system scaffold: Nunito font + the public stylesheet.
    expect(doc).toContain("Nunito");
    expect(doc).toContain('href="/assets/public.css"');
  });
});
