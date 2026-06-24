// T18 (RC-032 / T18-AC1): site-level hero-image mechanism + fallback.
//
// Behavioral proof that, with the `hero_image_media_id` site setting set, the
// rendered Home `.hero-bg` carries /media/<storage_key> behind `.hero-content`
// (which holds `.hero-title` + `.hero-search`); when the setting is unset the
// `.hero-bg` falls back to the lead article's featured image. Proven
// end-to-end by feeding settings through buildHomeViewModel (the same fake-D1
// harness as public-view-models-home.test.ts) and rendering renderHome — not a
// source grep.
//
// D13 parse_test_output route: every it() title embeds the literal
// [api/test/hero-image.test.ts] so the evidence runner's expected_test_name
// regex (api/test/hero\-image\.test\.ts) matches the observed test names.

import { describe, it, expect } from "vitest";
import { buildHomeViewModel, type HomeSiteContext } from "../src/public/view-models/home";
import { renderHome } from "../src/public/templates/home";

interface SeedSetting {
  key: string;
  value: string;
}

// Minimal fake D1 for buildHomeViewModel: one published lead article (so
// vm.hero is non-null) plus the per-site settings rows under test. Tracks the
// number of prepared statements so the no-4th-query invariant (T12.AC3) can be
// asserted alongside the hero resolution.
function makeDb(settings: ReadonlyArray<SeedSetting>): { db: D1Database; statements: number } {
  const state = { statements: 0 };
  const articleRow = {
    id: 1,
    slug: "lead-story",
    title: "Lead story",
    content_html: "<p>The lead article body.</p>",
    category_id: 1,
    status: "published",
    published_at: 1_700_000_000,
    featured_image_id: 9,
    is_featured: 1,
    is_trending: 0,
    homepage_rank: 1,
    site_id: "site_A",
    category_name: "Tech",
    category_slug: "tech",
    image_url: "lead-art.jpg", // bare media.storage_key
    image_alt: "Lead article art",
  };
  const db = {
    prepare(sql: string) {
      state.statements += 1;
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
            return { results: [articleRow] as unknown as T[], success: true, meta: {} };
          }
          if (sql.startsWith("SELECT key AS key, value AS value FROM site_settings")) {
            const siteId = String(captured[0] ?? "");
            const rows = siteId === "site_A" ? settings.map((s) => ({ key: s.key, value: s.value })) : [];
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          // categories (and any other read) → empty
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, statements: state.statements } as unknown as { db: D1Database; statements: number };
}

const ctx: HomeSiteContext = { siteId: "site_A", hostname: "site-a.example" };

// Extract the §2 hero section so background-image assertions are scoped to the
// hero — the lead article's image also appears in §13 (floating "Read next").
function heroSection(html: string): string {
  const start = html.indexOf("<!-- home-section:2 hero -->");
  const end = html.indexOf("<!-- home-section:3");
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe("hero-image", () => {
  it("[api/test/hero-image.test.ts] T18-AC1: the hero paints the lead article's CLEAN photo as a full-bleed bg under a dark overlay (site identity over the photo); the operator hero_image_media_id mockup is NOT used", async () => {
    const { db } = makeDb([
      { key: "site_name", value: "Site Alpha" },
      { key: "hero_image_media_id", value: "hero-banner.webp" },
    ]);
    const vm = await buildHomeViewModel(db, ctx);
    expect(vm.hero).not.toBeNull();

    const hero = heroSection(renderHome({ vm }));
    // .hero-bg paints the LEAD ARTICLE photo (/media/lead-art.jpg) UNDER a dark
    // gradient overlay (white-title legibility) — a real-photo magazine hero.
    expect(hero).toContain('class="hero-bg"');
    expect(hero).toContain("background-image:");
    expect(hero).toContain("/media/lead-art.jpg");
    // RESCUE-4 round-5 (issue 5): the full-bleed hero LCP is served resized via
    // Cloudflare Image Resizing (a ~1600px WebP/AVIF), not the ~2MB source PNG.
    expect(hero).toContain("/cdn-cgi/image/");
    expect(hero).toContain("format=auto");
    expect(hero).toContain("rgba(0,0,0,0.5)");
    // the operator hero_image_media_id (a text-laden AI mockup on real sites) is
    // intentionally NOT used as the hero bg.
    expect(hero).not.toContain("/media/hero-banner.webp");
    // the bg is a CSS background-image (no <img>); the site identity sits above it.
    expect(hero).not.toContain("<img");
    expect(hero).toContain('class="hero-content"');
    expect(hero).toContain('class="hero-title"');
    expect(hero).toContain('class="hero-search"');
    expect(hero.indexOf('class="hero-bg"')).toBeLessThan(hero.indexOf('class="hero-content"'));
  });

  it("[api/test/hero-image.test.ts] T18-AC1: resolving hero_image_media_id adds no 4th D1 statement (T12.AC3 invariant holds)", async () => {
    const calls: string[] = [];
    const db = {
      prepare(sql: string) {
        calls.push(sql);
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            return null;
          },
          async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: object }> {
            return { results: [] as T[], success: true, meta: {} };
          },
          async run() {
            return { success: true, meta: {} };
          },
        };
        return stmt as unknown as D1PreparedStatement;
      },
    } as unknown as D1Database;
    await buildHomeViewModel(db, ctx);
    expect(calls.length).toBeLessThanOrEqual(3);
  });
});
