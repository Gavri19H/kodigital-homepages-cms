// Regression (home §10 Latest bucket): buildHomeViewModel must not starve the
// design's grid-3 "Latest" section when NO article is is_featured. The
// no-featured fallback previously used cards.slice(1, FEATURED_LIMIT=8), which
// promoted the ENTIRE pool into `featured` -> vm.latest came back empty -> the
// public homepage rendered "More stories on the way" despite having articles.
//
// The existing home-bucketing.test.ts feeds a HAND-BUILT vm.latest to
// renderHome, so it never exercised this computation (mock-hid-it). This test
// drives the REAL buildHomeViewModel through a fake D1 of unfeatured rows.
import { describe, it, expect } from "vitest";
import { buildHomeViewModel } from "../src/public/view-models/home";

function makeHomeDb(count: number): D1Database {
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
            const rows = Array.from({ length: count }).map((_, i) => ({
              id: i + 1,
              slug: `a${i + 1}`,
              title: `Title ${i + 1}`,
              content_html: "<p>enough body words here to compute a read time value</p>",
              category_id: 1,
              status: "published",
              published_at: 1_700_000_000 + i,
              featured_image_id: null,
              is_featured: 0,
              is_trending: 0,
              homepage_rank: null,
              site_id: String(captured[0] ?? ""),
              category_name: "Tech",
              category_slug: "tech",
              image_url: null,
              image_alt: null,
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
  };
  return db as unknown as D1Database;
}

describe("home §10 latest bucket (no-featured fallback must not starve latest)", () => {
  it("[api/test/home-latest-bucketing.test.ts] 7 unfeatured published articles -> vm.latest is non-empty and no article is dropped from a bucket", async () => {
    const db = makeHomeDb(7);
    const vm = await buildHomeViewModel(db, {
      siteId: "site-a",
      hostname: "site-a.example",
    });
    // Pre-fix: vm.latest === [] (whole pool swallowed into featured).
    expect(vm.latest.length).toBeGreaterThan(0);
    // Every article surfaces in some home bucket (hero/featured/latest) — none dropped.
    const surfaced = new Set<number>();
    if (vm.hero) surfaced.add(vm.hero.id);
    for (const c of vm.featured) surfaced.add(c.id);
    for (const c of vm.latest) surfaced.add(c.id);
    expect(surfaced.size).toBe(7);
  });
});
