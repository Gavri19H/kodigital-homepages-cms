// Phase 5 / T8 BEHAVIORAL guard for buildHomeViewModel.
// T8.AC4: site A and B isolation — vm.featured contains only site A's
// articles even when the DB layer is seeded with rows for both sites.
// The test name MUST match `^public-view-models-home.*site[_-]?isolation`
// per the implementation digest's RC-024 binding.

import { describe, it, expect } from "vitest";
import {
  buildHomeViewModel,
  type HomeSiteContext,
} from "../src/public/view-models/home";

interface SeedArticle {
  id: number;
  slug: string;
  title: string;
  site_id: string;
  status: string;
  is_featured: number;
  homepage_section: string | null;
  homepage_rank: number | null;
  published_at: number;
  content_html: string;
  category_id: number | null;
  featured_image_id: number | null;
  category_name: string | null;
  category_slug: string | null;
  image_url: string | null;
  image_alt: string | null;
}

interface SeedCategory {
  id: number;
  slug: string;
  name: string;
  site_id: string;
  display_order: number;
}

interface SeedSettings {
  site_id: string;
  key: string;
  value: string;
}

function makeDb(
  articles: ReadonlyArray<SeedArticle>,
  categories: ReadonlyArray<SeedCategory>,
  settings: ReadonlyArray<SeedSettings>,
): { db: D1Database; calls: Array<{ sql: string; binds: unknown[] }> } {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          captured = args;
          calls.push({ sql, binds: args });
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return null;
        },
        async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: object }> {
          if (sql.startsWith("SELECT a.id AS id, a.slug AS slug")) {
            const siteId = String(captured[0] ?? "");
            const limit = Number(captured[1] ?? 0);
            const rows = articles
              .filter((a) => a.site_id === siteId && a.status === "published")
              .sort((x, y) => {
                if (x.is_featured !== y.is_featured) return y.is_featured - x.is_featured;
                const rx = x.homepage_rank ?? Number.MAX_SAFE_INTEGER;
                const ry = y.homepage_rank ?? Number.MAX_SAFE_INTEGER;
                if (rx !== ry) return rx - ry;
                if (x.published_at !== y.published_at) return y.published_at - x.published_at;
                return y.id - x.id;
              })
              .slice(0, limit)
              .map((a) => ({
                id: a.id,
                slug: a.slug,
                title: a.title,
                content_html: a.content_html,
                category_id: a.category_id,
                status: a.status,
                published_at: a.published_at,
                featured_image_id: a.featured_image_id,
                is_featured: a.is_featured,
                homepage_section: a.homepage_section,
                homepage_rank: a.homepage_rank,
                site_id: a.site_id,
                category_name: a.category_name,
                category_slug: a.category_slug,
                image_url: a.image_url,
                image_alt: a.image_alt,
              }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          if (sql.startsWith("SELECT c.id AS id, c.slug AS slug, c.name AS name")) {
            const siteId = String(captured[0] ?? "");
            const limit = Number(captured[1] ?? 0);
            const rows = categories
              .filter((c) => c.site_id === siteId)
              .sort((a, b) => a.display_order - b.display_order)
              .slice(0, limit)
              .map((c) => ({ id: c.id, slug: c.slug, name: c.name }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          if (sql.startsWith("SELECT key AS key, value AS value FROM site_settings")) {
            const siteId = String(captured[0] ?? "");
            const rows = settings
              .filter((s) => s.site_id === siteId)
              .map((s) => ({ key: s.key, value: s.value }));
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
  return { db, calls };
}

function seedArticle(overrides: Partial<SeedArticle> & Pick<SeedArticle, "id" | "slug" | "site_id">): SeedArticle {
  return {
    id: overrides.id,
    slug: overrides.slug,
    site_id: overrides.site_id,
    title: overrides.title ?? `Title ${overrides.id}`,
    status: overrides.status ?? "published",
    is_featured: overrides.is_featured ?? 0,
    homepage_section: overrides.homepage_section ?? "none",
    homepage_rank: overrides.homepage_rank ?? null,
    published_at: overrides.published_at ?? 1_700_000_000,
    content_html: overrides.content_html ?? "<p>body</p>",
    category_id: overrides.category_id ?? 1,
    featured_image_id: overrides.featured_image_id ?? null,
    category_name: overrides.category_name ?? "Tech",
    category_slug: overrides.category_slug ?? "tech",
    image_url: overrides.image_url ?? null,
    image_alt: overrides.image_alt ?? null,
  };
}

describe("public-view-models-home", () => {
  it("site_isolation — vm.featured contains only site A's articles when DB holds rows for A and B", async () => {
    const articles: SeedArticle[] = [
      seedArticle({ id: 1, slug: "a-hero", site_id: "site_A", is_featured: 1, homepage_rank: 1, title: "A hero" }),
      seedArticle({ id: 2, slug: "a-featured-2", site_id: "site_A", is_featured: 1, homepage_rank: 2, title: "A featured 2" }),
      seedArticle({ id: 3, slug: "a-latest", site_id: "site_A", is_featured: 0, title: "A latest" }),
      seedArticle({ id: 11, slug: "b-hero", site_id: "site_B", is_featured: 1, homepage_rank: 1, title: "B hero" }),
      seedArticle({ id: 12, slug: "b-featured-2", site_id: "site_B", is_featured: 1, homepage_rank: 2, title: "B featured 2" }),
      seedArticle({ id: 13, slug: "b-latest", site_id: "site_B", is_featured: 0, title: "B latest" }),
    ];
    const categories: SeedCategory[] = [
      { id: 100, slug: "tech", name: "Tech", site_id: "site_A", display_order: 1 },
      { id: 101, slug: "health", name: "Health", site_id: "site_B", display_order: 1 },
    ];
    const settings: SeedSettings[] = [
      { site_id: "site_A", key: "site_name", value: "Site Alpha" },
      { site_id: "site_A", key: "tagline", value: "Stories for A" },
      { site_id: "site_B", key: "site_name", value: "Site Bravo" },
    ];
    const { db, calls } = makeDb(articles, categories, settings);

    const ctxA: HomeSiteContext = { siteId: "site_A", hostname: "site-a.example" };
    const vmA = await buildHomeViewModel(db, ctxA);

    // Every featured/hero/latest card must be a site_A article slug.
    const aSlugs = new Set(articles.filter((x) => x.site_id === "site_A").map((x) => x.slug));
    const bSlugs = new Set(articles.filter((x) => x.site_id === "site_B").map((x) => x.slug));

    expect(vmA.hero).not.toBeNull();
    expect(aSlugs.has(vmA.hero!.slug)).toBe(true);
    expect(bSlugs.has(vmA.hero!.slug)).toBe(false);

    expect(vmA.featured.length).toBeGreaterThan(0);
    for (const card of vmA.featured) {
      expect(aSlugs.has(card.slug)).toBe(true);
      expect(bSlugs.has(card.slug)).toBe(false);
    }
    for (const card of vmA.latest) {
      expect(aSlugs.has(card.slug)).toBe(true);
      expect(bSlugs.has(card.slug)).toBe(false);
    }

    // Every prepared statement received `site_A` as its first bound value.
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) {
      expect(call.binds[0]).toBe("site_A");
    }

    // Site brand strings come from site_settings, not from the hostname.
    expect(vmA.site.name).toBe("Site Alpha");
    expect(vmA.site.tagline).toBe("Stories for A");

    // Symmetric check on site B — proves the helper is parameterised.
    const ctxB: HomeSiteContext = { siteId: "site_B", hostname: "site-b.example" };
    const vmB = await buildHomeViewModel(db, ctxB);
    for (const card of [...(vmB.hero !== null ? [vmB.hero] : []), ...vmB.featured, ...vmB.latest]) {
      expect(bSlugs.has(card.slug)).toBe(true);
      expect(aSlugs.has(card.slug)).toBe(false);
    }
    expect(vmB.site.name).toBe("Site Bravo");
  });

  it("site_isolation — categories are filtered by site_categories so A never sees B's chips", async () => {
    const articles: SeedArticle[] = [
      seedArticle({ id: 1, slug: "a-1", site_id: "site_A", is_featured: 1 }),
    ];
    const categories: SeedCategory[] = [
      { id: 100, slug: "tech", name: "Tech", site_id: "site_A", display_order: 1 },
      { id: 101, slug: "health", name: "Health", site_id: "site_B", display_order: 1 },
      { id: 102, slug: "finance", name: "Finance", site_id: "site_A", display_order: 2 },
    ];
    const { db } = makeDb(articles, categories, []);

    const vmA = await buildHomeViewModel(db, { siteId: "site_A", hostname: "site-a.example" });
    const slugs = vmA.categories.map((c) => c.slug);
    expect(slugs).toContain("tech");
    expect(slugs).toContain("finance");
    expect(slugs).not.toContain("health");
    for (const chip of vmA.categories) {
      expect(chip.href).toBe(`/category/${chip.slug}`);
    }
  });

  it("falls back to hostname for site.name when site_settings has no site_name", async () => {
    const { db } = makeDb([], [], []);
    const vm = await buildHomeViewModel(db, { siteId: "site_X", hostname: "x.example" });
    expect(vm.site.name).toBe("x.example");
    expect(vm.hero).toBeNull();
    expect(vm.featured).toEqual([]);
    expect(vm.latest).toEqual([]);
  });
});
