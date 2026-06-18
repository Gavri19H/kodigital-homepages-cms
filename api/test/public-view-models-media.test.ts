// T2 BEHAVIORAL guards: every public image URL emitted by the view models is
// served through the /media/<storage_key> route, never a bare storage key,
// and a null storage_key yields null (no "/media/null").
//
// Bindings (the [api/test/...] literal lets the D13 parse_test_output runner's
// expected_test_name_regex match the vitest-reported test name):
//   T2-AC1 / RC-005 — buildHomeViewModel: hero + every card image url.
//   T2-AC2 / RC-006 — buildArticleViewModel: article-hero + og:image +
//                      body-image url; null storage_key -> null.

import { describe, it, expect } from "vitest";
import { buildHomeViewModel } from "../src/public/view-models/home";
import {
  buildArticleViewModel,
  type BodyBlock,
} from "../src/public/view-models/article";
import { mediaUrl } from "../src/public/view-models/media-url";

// ---- Home mock DB (mirrors public-view-models-home.test.ts) -------------
interface HomeArticleSeed {
  id: number;
  slug: string;
  site_id: string;
  is_featured: number;
  is_trending: number;
  image_url: string | null;
}

function makeHomeDb(articles: ReadonlyArray<HomeArticleSeed>): D1Database {
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          captured = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return null;
        },
        async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: object }> {
          if (sql.startsWith("SELECT a.id AS id, a.slug AS slug")) {
            const siteId = String(captured[0] ?? "");
            const rows = articles
              .filter((a) => a.site_id === siteId)
              .map((a) => ({
                id: a.id,
                slug: a.slug,
                title: `Title ${a.id}`,
                content_html: "<p>body words here for the excerpt and read time</p>",
                category_id: 1,
                status: "published",
                published_at: 1_700_000_000,
                featured_image_id: a.image_url === null ? null : a.id,
                is_featured: a.is_featured,
                is_trending: a.is_trending,
                homepage_section: null,
                homepage_rank: null,
                site_id: a.site_id,
                category_name: "Tech",
                category_slug: "tech",
                image_url: a.image_url,
                image_alt: a.image_url === null ? null : "alt",
              }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return db;
}

// ---- Article mock DB (mirrors public-view-models-article.test.ts) -------
interface ArticleSeed {
  id: number;
  slug: string;
  site_id: string;
  image_url: string | null;
  content_json: string | null;
}

function makeArticleDb(rows: ReadonlyArray<ArticleSeed>): D1Database {
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          captured = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.startsWith("SELECT a.id AS id, a.slug AS slug, a.title AS title, a.content_json")) {
            const siteId = String(captured[0] ?? "");
            const slug = String(captured[1] ?? "");
            const row = rows.find((a) => a.site_id === siteId && a.slug === slug);
            if (row === undefined) return null;
            return {
              id: row.id,
              slug: row.slug,
              title: `Title ${row.id}`,
              content_json: row.content_json,
              content_html: "<p>fallback body</p>",
              category_id: 1,
              status: "published",
              published_at: 1_700_000_000,
              updated_at: 1_700_000_000,
              author_name: null,
              featured_image_id: row.image_url === null ? null : row.id,
              is_featured: 0,
              site_id: row.site_id,
              category_name: "Tech",
              category_slug: "tech",
              image_url: row.image_url,
              image_alt: row.image_url === null ? null : "alt",
              seo_title: null,
              seo_description: null,
            } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: object }> {
          // No related articles / no settings needed for these assertions.
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return db;
}

describe("public-view-models-media", () => {
  it("buildHomeViewModel: hero + every card image url begins with /media/, never a bare storage_key, and a null storage_key stays null [api/test/public-view-models-media.test.ts] L2_AUTO_DISAMBIGUATION:T2-AC1:RC-005", async () => {
    const db = makeHomeDb([
      { id: 1, slug: "hero", site_id: "site_A", is_featured: 1, is_trending: 0, image_url: "hero-key.jpg" },
      { id: 2, slug: "feat-2", site_id: "site_A", is_featured: 1, is_trending: 0, image_url: "feat-2.jpg" },
      { id: 3, slug: "trend-3", site_id: "site_A", is_featured: 0, is_trending: 1, image_url: "trend-3.jpg" },
      { id: 4, slug: "latest-4", site_id: "site_A", is_featured: 0, is_trending: 0, image_url: "latest-4.jpg" },
      { id: 5, slug: "no-image", site_id: "site_A", is_featured: 0, is_trending: 0, image_url: null },
    ]);

    const vm = await buildHomeViewModel(db, { siteId: "site_A", hostname: "site-a.example" });

    // The hero is a card too: its image must be a /media/ web address.
    expect(vm.hero).not.toBeNull();
    expect(vm.hero!.imageUrl).toBe("/media/hero-key.jpg");

    // Every card across every bucket: image url is either null or a
    // /media/-prefixed web address — never a bare storage key, never
    // "/media/null".
    const allCards = [
      ...(vm.hero !== null ? [vm.hero] : []),
      ...vm.featured,
      ...vm.picks,
      ...vm.trending,
      ...vm.latest,
    ];
    expect(allCards.length).toBeGreaterThan(0);
    for (const card of allCards) {
      if (card.imageUrl === null) continue;
      expect(card.imageUrl.startsWith("/media/")).toBe(true);
      expect(card.imageUrl).not.toBe("/media/null");
      // A bare storage key (e.g. "hero-key.jpg") must never survive.
      expect(card.imageUrl.includes("/media/")).toBe(true);
    }

    // The article with no featured image yields a null url (no broken <img>).
    const noImage = vm.latest.find((c) => c.slug === "no-image");
    expect(noImage).toBeDefined();
    expect(noImage!.imageUrl).toBeNull();
  });

  it("buildArticleViewModel: article-hero + og:image + body-image urls begin with /media/, an already-rooted src is not double-prefixed, and a null storage_key yields null (no /media/null) [api/test/public-view-models-media.test.ts] L2_AUTO_DISAMBIGUATION:T2-AC2:RC-006", async () => {
    const contentJson = JSON.stringify({
      blocks: [
        { type: "html", html: "<p>intro</p>" },
        { type: "image", src: "body-pic.jpg", alt: "a body picture" },
        { type: "image", src: "/media/already.jpg", alt: "already rooted" },
      ],
    });
    const db = makeArticleDb([
      { id: 7, slug: "with-image", site_id: "site_A", image_url: "article-hero.jpg", content_json: contentJson },
      { id: 8, slug: "no-image", site_id: "site_A", image_url: null, content_json: null },
    ]);

    const vm = await buildArticleViewModel(db, {
      slug: "with-image",
      siteContext: { siteId: "site_A", hostname: "site-a.example" },
    });
    expect(vm).not.toBeNull();

    // article-hero
    expect(vm!.article.imageUrl).toBe("/media/article-hero.jpg");
    // og:image is derived from the hero — fixed in lockstep.
    expect(vm!.meta.ogImage).toBe("/media/article-hero.jpg");

    // body-image urls all begin with /media/.
    const imageBlocks = vm!.article.body.filter(
      (b): b is Extract<BodyBlock, { type: "image" }> => b.type === "image",
    );
    expect(imageBlocks.length).toBe(2);
    for (const block of imageBlocks) {
      expect(block.src.startsWith("/media/")).toBe(true);
    }
    // A bare key is prefixed; an already-rooted /media/ src is left intact
    // (not double-prefixed into /media//media/...).
    const srcs = imageBlocks.map((b) => b.src);
    expect(srcs).toContain("/media/body-pic.jpg");
    expect(srcs).toContain("/media/already.jpg");
    for (const src of srcs) {
      expect(src.includes("/media//media/")).toBe(false);
    }

    // null storage_key -> null hero + null og:image, never "/media/null".
    const vmNull = await buildArticleViewModel(db, {
      slug: "no-image",
      siteContext: { siteId: "site_A", hostname: "site-a.example" },
    });
    expect(vmNull).not.toBeNull();
    expect(vmNull!.article.imageUrl).toBeNull();
    expect(vmNull!.meta.ogImage).toBeNull();

    // Pure-helper boundary checks for the null/empty contract.
    expect(mediaUrl(null)).toBeNull();
    expect(mediaUrl("")).toBeNull();
    expect(mediaUrl("   ")).toBeNull();
    expect(mediaUrl("key.jpg")).toBe("/media/key.jpg");
    expect(mediaUrl("/media/key.jpg")).toBe("/media/key.jpg");
    expect(mediaUrl("https://cdn.example/x.jpg")).toBe("https://cdn.example/x.jpg");
  });
});
