import { describe, expect, it } from "vitest";
import { renderSectionPreviewDocument } from "../src/admin/listicles/section-preview";
import { renderListicleDocument } from "../src/public/listicle/render";
import { renderCategoryHtml, renderTagHtml } from "../src/public/render-pages";
import { renderArticle } from "../src/public/templates/article";
import { renderHome } from "../src/public/templates/home";
import type { HomeArticleCard } from "../src/public/view-models/home";
import { makeFakeDb } from "./helpers/admin-test-kit";
import { parseHtml, type MiniNode } from "./helpers/mini-dom";

const site = {
  site_id: "daily", name: "Daily", hostname: "daily.example", tagline: "Local stories",
  description: "Daily news", logoUrl: "/media/site-logo.png", brandTokens: {},
};
const offsite = "https://photos.example/news.jpg?day=1&view=full";
const absolute = `https://${site.hostname}/media/absolute.jpg`;
const transform = "/cdn-cgi/image/";
const day = "2026-11-24";

function story(id: number, imageUrl: string | null = `/media/story-${id}.jpg`): HomeArticleCard {
  return {
    id, slug: `story-${id}`, title: `Story ${id}`, href: `/article/story-${id}`,
    excerpt: "Local news", publishedAt: day, categoryName: "News", categorySlug: "news",
    readMinutes: 3, imageUrl, imageAlt: `Photo ${id}`,
  };
}

function homepage(cssHero: boolean, missingFirstPick = false): string {
  const hero = story(1, cssHero ? "/media/lead.jpg" : null);
  return renderHome({ vm: {
    site, hero, featured: [story(2)],
    picks: [missingFirstPick ? hero : story(3), story(4, absolute)],
    trending: [story(5, offsite)], spotlight: [story(6)], latest: [story(7)],
    categories: [{ id: 1, slug: "news", href: "/category/news", name: "News", imageUrl: "/media/chip.png" }],
    newsletter: { heading: "Daily news", description: "Daily editions", provider: null },
    meta: { title: site.name, description: site.description, canonicalUrl: `https://${site.hostname}/` },
  } });
}

function article(): string {
  return renderArticle({ vm: {
    site, article: {
      ...story(1), dateline: day, publishedAtDisplay: day, updatedAt: day, readMinutes: 3,
      readMinutesDisplay: "3 min", author: { name: "A. Writer" }, categoryHref: "/category/news",
      body: [
        { type: "image", src: "/media/figure.png", alt: "Figure", caption: "Survey" },
        { type: "image", src: offsite, alt: "Photo 5", caption: null },
        { type: "affiliate", title: "Book", description: "Local history", url: "/books", cta: "Read" },
      ],
      contentText: "Local news",
    },
    breadcrumb: [], faqs: [], related: [story(2)],
    meta: {
      title: "Local news", description: "Daily news", canonicalUrl: `https://${site.hostname}/article/story-1`,
      ogImage: "/media/story-1.jpg", publishedAt: day, modifiedAt: day,
    },
  } });
}

function listing(type: "category" | "tag"): Promise<string> {
  const { db } = makeFakeDb([], [{ match: "FROM site_settings", rows: [
    { key: "site_name", value: site.name }, { key: "logo_media_id", value: "site-logo.png" },
  ] }]);
  const context = {
    siteId: site.site_id, site_id: site.site_id, hostname: site.hostname, vertical_slug: "news",
    status: "active", content_version: 1, settings_version: 1,
  };
  const rows = [story(2), story(4, absolute)].map((s) => ({
    id: s.id, slug: s.slug, title: s.title, status: "published", content_html: null, content_json: "{}",
    category_id: 1, published_at: 1, scheduled_at: null, author_name: null, featured_image_id: s.id,
    is_featured: 0, is_trending: 0, created_at: 1, updated_at: 1, site_id: site.site_id,
    image_url: s.imageUrl?.replace(/^\/media\//, ""), image_alt: s.imageAlt,
  }));
  const render = type === "category" ? renderCategoryHtml : renderTagHtml;
  return render(db, context, { id: 1, slug: "news", name: "News" }, rows, 1, "news");
}

function listicle(logoUrl = site.logoUrl, avatarUrl = "/media/avatar.jpg"): string {
  return renderListicleDocument({
    hostname: site.hostname, brand: { siteName: site.name, logoUrl }, settings: {},
    article: { public_id: "art_1", slug: "local-offers" },
    version: {
      public_id: "ver_1", headline: "Local offers", intro_paragraph: "Today's offers.",
      hero_url: "/media/listicle-hero.jpg", layout_style_id: "default", content_version: 1,
      byline_json: JSON.stringify({ enabled: true, author_name: "Writer", author_avatar_url: avatarUrl }),
    },
    pages: [{
      public_id: "pg_1", page_index: 0, selection_mode: "single", ab_test_id: null, rule_set_id: null,
      candidates: [{ public_id: "cand_1", section_id: 1, is_fallback: 0, rule_public_id: null }],
    }],
    sections: new Map([[1, {
      id: 1, public_id: "sec_1", section_name: "Local", headline_text: "Offers", headline_offer_id: null,
      image_json: JSON.stringify({ url: "/media/section.jpg" }),
      content_json: JSON.stringify({ blocks: [
        { type: "image", data: { url: "/media/body photo.jpg", alt: "Body", width: 1600, height: 900, aboveTheFold: true } },
        { type: "linked_image", data: {
          image_url: "/media/linked.jpg", alt: "Linked", width: 640, height: 360,
          offer_id: "off_1", link_instance_id: "lnk_1",
        } },
        { type: "image", data: { src: offsite, alt: "Photo 5", width: 400, height: 300 } },
        { type: "linked_image", data: {
          url: absolute, alt: "Photo 4", width: 300, height: 200, offer_id: "off_1", link_instance_id: "lnk_2",
        } },
      ] }),
    }]]),
    offerPublicIdByRef: new Map([["off_1", "off_1"]]),
  }).html;
}

const externalByAlt = new Map([["Photo 5", offsite], ["Photo 4", absolute]]);
const alt = (img: MiniNode) => img.getAttribute("alt") ?? "";
const src = (img: MiniNode) => img.getAttribute("src") ?? "";
const dimension = /^[1-9]\d*$/;

function candidates(img: MiniNode) {
  const srcset = img.getAttribute("srcset");
  if (!srcset) return [];
  return srcset.split(/,\s+/).map((candidate) => {
    const match = /^(\S+) ([1-9]\d*)w$/.exec(candidate);
    return { url: match?.[1] ?? "", width: Number(match?.[2]) };
  });
}

const pages = [
  { name: "home with CSS hero", html: () => homepage(true), count: 10, main: null },
  { name: "home without CSS hero", html: () => homepage(false), count: 9, main: ".picks-hero img" },
  { name: "home with an imageless first Pick", html: () => homepage(false, true), count: 8, main: ".story-row img" },
  { name: "article", html: article, count: 8, main: ".article-hero-img img" },
  { name: "category", html: () => listing("category"), count: 4, main: ".card-img img" },
  { name: "tag", html: () => listing("tag"), count: 4, main: ".card-img img" },
  { name: "listicle", html: listicle, count: 9, main: ".lst-hero img" },
];

describe("public image markup", () => {
  it.each(pages)("$name serves sized images and gives the main image first priority", async (page) => {
    const doc = parseHtml(await page.html());
    const images = doc.querySelectorAll("img");
    expect(images).toHaveLength(page.count);
    const header = doc.querySelector("header img");
    expect(header).not.toBeNull();
    const main = page.main ? doc.querySelector(page.main) : null;
    if (page.main) expect(main, page.main).not.toBeNull();

    expect.soft(images.filter((img) => !dimension.test(img.getAttribute("width") ?? "") ||
      !dimension.test(img.getAttribute("height") ?? "")).map(alt), "missing dimensions").toEqual([]);

    const local = images.filter((img) => !externalByAlt.has(alt(img)));
    expect.soft(local.filter((img) => !src(img).startsWith(transform)).map(alt), "raw local src").toEqual([]);
    expect.soft(local.filter((img) => {
      const set = candidates(img);
      return set.length < 2 || set.some(({ url, width }) => !url.startsWith(transform) ||
        !url.includes(`/width=${width},`) || width > 2 * Number(img.getAttribute("width")));
    }).map(alt), "missing or invalid transformed srcset").toEqual([]);
    expect.soft(local.filter((img) => {
      const largest = candidates(img).sort((a, b) => b.width - a.width)[0];
      return src(img) !== largest?.url;
    }).map(alt), "fallback differs from largest candidate").toEqual([]);
    expect.soft(images.filter((img) => externalByAlt.has(alt(img)) &&
      (src(img) !== externalByAlt.get(alt(img)) || img.hasAttribute("srcset"))).map(alt), "absolute URLs").toEqual([]);

    const high = images.filter((img) => img.getAttribute("fetchpriority") === "high");
    expect.soft(high.map((img) => images.indexOf(img)), "high priority image").toEqual(main ? [images.indexOf(main)] : []);
    if (main) expect.soft(main.getAttribute("loading"), "main image loading").toBe("eager");
    expect.soft(header!.getAttribute("loading"), "header logo loading").toBe("eager");
    expect.soft(images.filter((img) => img !== header && img !== main &&
      img.getAttribute("loading") !== "lazy").map(alt), "below-fold loading").toEqual([]);
  });

  it("fits the measured listicle logo and avatar slots and preserves the saved block dimensions", () => {
    const doc = parseHtml(listicle());
    for (const selector of [".lst-logo img", ".lst-footer-logo img"]) {
      const logo = doc.querySelector(selector)!;
      expect.soft([logo.getAttribute("width"), logo.getAttribute("height")]).toEqual(["233", "40"]);
      expect.soft(logo.getAttribute("style") ?? "").toContain("width:233px");
      expect.soft(logo.getAttribute("style") ?? "").toContain("object-fit:contain");
    }
    const avatar = doc.querySelector(".lst-byline-avatar")!;
    expect.soft([avatar.getAttribute("width"), avatar.getAttribute("height")]).toEqual(["30", "30"]);
    for (const [name, width, height, path, max] of [
      ["Body", "1600", "900", "/media/body%20photo.jpg", 1936],
      ["Linked", "640", "360", "/media/linked.jpg", 1280],
    ] as const) {
      const img = doc.querySelector(`img[alt="${name}"]`)!;
      expect.soft([img.getAttribute("width"), img.getAttribute("height")], name).toEqual([width, height]);
      expect.soft(src(img)).toContain(`/width=${max},fit=scale-down,`);
      expect.soft(src(img).endsWith(path), name).toBe(true);
      for (const candidate of candidates(img)) expect.soft(candidate.url).toContain(",fit=scale-down,");
    }
    expect(doc.querySelector(".lst-linked-img")?.getAttribute("href")).toContain("/lc/");
  });

  it("preserves absolute listicle logo and avatar URLs in the same display slots", () => {
    const doc = parseHtml(listicle(absolute, offsite));
    for (const [selector, url, width, height, loading] of [
      [".lst-logo img", absolute, "233", "40", "eager"],
      [".lst-byline-avatar", offsite, "30", "30", "lazy"],
      [".lst-footer-logo img", absolute, "233", "40", "lazy"],
    ] as const) {
      const img = doc.querySelector(selector)!;
      expect.soft([src(img), img.getAttribute("srcset")]).toEqual([url, null]);
      expect.soft([img.getAttribute("width"), img.getAttribute("height")]).toEqual([width, height]);
      expect.soft(img.getAttribute("loading")).toBe(loading);
    }
  });

  it.each(["image", "linked_image"])("previews legacy %s blocks without inventing missing dimensions", (type) => {
    const html = renderSectionPreviewDocument({
      headline_text: "Local offers", headline_offer_id: null, image_url: null,
      blocks: [
        { type, data: { url: "/media/legacy.jpg", offer_id: "off_1" } },
        { type, data: { url: absolute, width: "300", height: 0, offer_id: "off_1" } },
      ],
    });
    const images = parseHtml(html).querySelectorAll("img");
    expect(images).toHaveLength(2);
    const [legacy, partial] = images as [MiniNode, MiniNode];
    expect.soft(src(legacy)).toMatch(/^\/cdn-cgi\/image\/width=1936,fit=scale-down,[^/]+\/media\/legacy\.jpg$/);
    expect.soft(candidates(legacy).length).toBeGreaterThan(1);
    expect.soft(legacy.getAttribute("width")).toBeNull();
    expect.soft(legacy.getAttribute("height")).toBeNull();
    expect.soft(partial.getAttribute("src")).toBe(absolute);
    expect.soft(partial.getAttribute("srcset")).toBeNull();
    expect.soft(partial.getAttribute("width")).toBe("300");
    expect.soft(partial.getAttribute("height")).toBeNull();
    for (const img of images) expect.soft(img.getAttribute("loading")).toBe("lazy");
  });
});
