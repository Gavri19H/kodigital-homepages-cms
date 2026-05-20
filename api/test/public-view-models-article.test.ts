// Phase 5 / T9 BEHAVIORAL guards for buildArticleViewModel + adaptBodyBlocks.
// T9.AC4 — `^public-view-models-article.*content[_-]?html[_-]?fallback`:
//   when content_json is null the view-model body falls back to a single
//   html block sourced from content_html.
// T9.AC5 — `^public-view-models-article.*faq[_-]?blocks`:
//   2 faq blocks in content_json yield vm.faqs.length === 2.

import { describe, it, expect } from "vitest";
import {
  buildArticleViewModel,
  adaptBodyBlocks,
  type ArticleSiteContext,
} from "../src/public/view-models/article";

interface SeedArticle {
  id: number;
  slug: string;
  title: string;
  site_id: string;
  status: string;
  is_featured: number;
  published_at: number | null;
  updated_at: number | null;
  content_json: string | null;
  content_html: string | null;
  category_id: number | null;
  author_name: string | null;
  featured_image_id: number | null;
  category_name: string | null;
  category_slug: string | null;
  image_url: string | null;
  image_alt: string | null;
  seo_title: string | null;
  seo_description: string | null;
}

interface SeedSettings {
  site_id: string;
  key: string;
  value: string;
}

function makeDb(
  articles: ReadonlyArray<SeedArticle>,
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
          if (sql.startsWith("SELECT a.id AS id, a.slug AS slug, a.title AS title, a.content_json")) {
            const siteId = String(captured[0] ?? "");
            const slug = String(captured[1] ?? "");
            const row = articles.find(
              (a) => a.site_id === siteId && a.slug === slug && a.status === "published",
            );
            if (row === undefined) return null;
            return {
              id: row.id,
              slug: row.slug,
              title: row.title,
              content_json: row.content_json,
              content_html: row.content_html,
              category_id: row.category_id,
              status: row.status,
              published_at: row.published_at,
              updated_at: row.updated_at,
              author_name: row.author_name,
              featured_image_id: row.featured_image_id,
              is_featured: row.is_featured,
              site_id: row.site_id,
              category_name: row.category_name,
              category_slug: row.category_slug,
              image_url: row.image_url,
              image_alt: row.image_alt,
              seo_title: row.seo_title,
              seo_description: row.seo_description,
            } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: object }> {
          if (sql.includes("FROM site_settings WHERE site_id = ?")) {
            const siteId = String(captured[0] ?? "");
            const rows = settings
              .filter((s) => s.site_id === siteId)
              .map((s) => ({ key: s.key, value: s.value }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          // Related articles (with or without category clause).
          if (sql.startsWith("SELECT a.id AS id, a.slug AS slug, a.title AS title, a.content_html")) {
            const siteId = String(captured[0] ?? "");
            const hasCategory = sql.includes("a.category_id = ?");
            const categoryId = hasCategory ? Number(captured[1]) : null;
            const excludeId = hasCategory ? Number(captured[2]) : Number(captured[1]);
            const limit = hasCategory ? Number(captured[3]) : Number(captured[2]);
            const rows = articles
              .filter((a) => a.site_id === siteId && a.status === "published" && a.id !== excludeId)
              .filter((a) => (hasCategory ? a.category_id === categoryId : true))
              .sort((x, y) => (y.published_at ?? 0) - (x.published_at ?? 0))
              .slice(0, limit)
              .map((a) => ({
                id: a.id,
                slug: a.slug,
                title: a.title,
                content_html: a.content_html,
                category_id: a.category_id,
                published_at: a.published_at,
                featured_image_id: a.featured_image_id,
                is_featured: a.is_featured,
                category_name: a.category_name,
                category_slug: a.category_slug,
                image_url: a.image_url,
                image_alt: a.image_alt,
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
    published_at: overrides.published_at ?? 1_700_000_000,
    updated_at: overrides.updated_at ?? 1_700_000_000,
    content_json: overrides.content_json ?? null,
    content_html: overrides.content_html ?? "<p>fallback body</p>",
    category_id: overrides.category_id ?? 1,
    author_name: overrides.author_name ?? null,
    featured_image_id: overrides.featured_image_id ?? null,
    category_name: overrides.category_name ?? "Tech",
    category_slug: overrides.category_slug ?? "tech",
    image_url: overrides.image_url ?? null,
    image_alt: overrides.image_alt ?? null,
    seo_title: overrides.seo_title ?? null,
    seo_description: overrides.seo_description ?? null,
  };
}

describe("public-view-models-article", () => {
  it("T9.AC4: content_html_fallback — content_json=null yields a single html body block from content_html", async () => {
    const row = seedArticle({
      id: 42,
      slug: "fallback-story",
      site_id: "site_A",
      title: "Fallback Story",
      content_json: null,
      content_html: "<p>raw legacy html body</p>",
    });
    const { db } = makeDb([row], [
      { site_id: "site_A", key: "site_name", value: "Site Alpha" },
    ]);

    const ctx: ArticleSiteContext = { siteId: "site_A", hostname: "site-a.example" };
    const vm = await buildArticleViewModel(db, { slug: "fallback-story", siteContext: ctx });

    expect(vm).not.toBeNull();
    expect(vm!.article.body.length).toBe(1);
    const onlyBlock = vm!.article.body[0];
    expect(onlyBlock).toBeDefined();
    expect(onlyBlock!.type).toBe("html");
    if (onlyBlock !== undefined && onlyBlock.type === "html") {
      expect(onlyBlock.html).toBe("<p>raw legacy html body</p>");
    }
    expect(vm!.faqs.length).toBe(0);
    expect(vm!.site.name).toBe("Site Alpha");
    // Tenant boundary: the article was scoped by site_A.
    expect(vm!.article.slug).toBe("fallback-story");
  });

  it("content_html_fallback — pure helper: adaptBodyBlocks(null, html) returns one html block", () => {
    const result = adaptBodyBlocks(null, "<p>direct</p>");
    expect(result.blocks.length).toBe(1);
    const block = result.blocks[0];
    expect(block).toBeDefined();
    expect(block!.type).toBe("html");
    if (block !== undefined && block.type === "html") {
      expect(block.html).toBe("<p>direct</p>");
    }
    expect(result.faqs.length).toBe(0);
  });

  it("content_html_fallback — invalid JSON in content_json falls back to content_html single block", () => {
    const result = adaptBodyBlocks("{not valid json", "<p>still rendered</p>");
    expect(result.blocks.length).toBe(1);
    const block = result.blocks[0];
    expect(block).toBeDefined();
    expect(block!.type).toBe("html");
    if (block !== undefined && block.type === "html") {
      expect(block.html).toBe("<p>still rendered</p>");
    }
  });

  it("faq_blocks — adaptBodyBlocks pulls out 2 faq blocks into vm.faqs", () => {
    const payload = JSON.stringify({
      blocks: [
        { type: "html", html: "<p>intro</p>" },
        { type: "faq", question: "What is it?", answer: "It is a thing." },
        { type: "heading", level: 2, text: "More" },
        { type: "faq", question: "Why?", answer: "Because." },
      ],
    });
    const result = adaptBodyBlocks(payload, null);
    expect(result.faqs.length).toBe(2);
    expect(result.faqs[0]!.question).toBe("What is it?");
    expect(result.faqs[1]!.answer).toBe("Because.");
    const faqBlocks = result.blocks.filter((b) => b.type === "faq");
    expect(faqBlocks.length).toBe(2);
  });

  it("T9.AC5: faq_blocks — buildArticleViewModel with 2 faq blocks in content_json yields vm.faqs.length === 2", async () => {
    const contentJson = JSON.stringify({
      blocks: [
        { type: "html", html: "<p>setup</p>" },
        { type: "faq", question: "Q1?", answer: "A1." },
        { type: "faq", question: "Q2?", answer: "A2." },
      ],
    });
    const row = seedArticle({
      id: 7,
      slug: "faqs-article",
      site_id: "site_A",
      title: "FAQs Article",
      content_json: contentJson,
      content_html: "<p>ignored fallback</p>",
    });
    const { db } = makeDb([row], [
      { site_id: "site_A", key: "site_name", value: "Alpha" },
    ]);

    const vm = await buildArticleViewModel(db, {
      slug: "faqs-article",
      siteContext: { siteId: "site_A", hostname: "site-a.example" },
    });

    expect(vm).not.toBeNull();
    expect(vm!.faqs.length).toBe(2);
    expect(vm!.faqs[0]!.question).toBe("Q1?");
    expect(vm!.faqs[1]!.question).toBe("Q2?");
  });

  it("site_isolation — article in site_B is invisible to a site_A query", async () => {
    const articles: SeedArticle[] = [
      seedArticle({ id: 1, slug: "shared-slug", site_id: "site_A", title: "A version" }),
      seedArticle({ id: 2, slug: "shared-slug", site_id: "site_B", title: "B version" }),
    ];
    const { db, calls } = makeDb(articles, []);

    const vmA = await buildArticleViewModel(db, {
      slug: "shared-slug",
      siteContext: { siteId: "site_A", hostname: "site-a.example" },
    });
    expect(vmA).not.toBeNull();
    expect(vmA!.article.title).toBe("A version");

    // Every prepared statement received site_A as its first bound value.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call.binds[0]).toBe("site_A");
    }

    const vmB = await buildArticleViewModel(db, {
      slug: "shared-slug",
      siteContext: { siteId: "site_B", hostname: "site-b.example" },
    });
    expect(vmB).not.toBeNull();
    expect(vmB!.article.title).toBe("B version");
  });

  it("returns null when the article does not exist for the requested site", async () => {
    const { db } = makeDb([], []);
    const vm = await buildArticleViewModel(db, {
      slug: "missing",
      siteContext: { siteId: "site_A", hostname: "site-a.example" },
    });
    expect(vm).toBeNull();
  });
});
