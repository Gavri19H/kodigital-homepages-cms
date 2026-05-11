import { describe, it, expect } from "vitest";
import {
  getArticleBySlug,
  listArticles,
  getMediaById,
  listCategories,
  type ArticleRow,
  type MediaRow,
  type CategoryRow,
} from "../../src/db/index";

// ---- Fake D1Database ---------------------------------------------------
//
// Records every prepare(sql) and the subsequent bind(...args), so each test
// can assert that helpers route values through prepare(...).bind(...) — never
// through string interpolation. The `firstResult` / `allResults` fields let
// individual tests plant rows that flow back through .first() / .all().

interface RecordedCall {
  sql: string;
  bindArgs: unknown[];
}

function makeFakeDb(planted: {
  firstResult?: unknown;
  allResults?: unknown[];
}): { db: D1Database; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  const db = {
    prepare(sql: string) {
      const call: RecordedCall = { sql, bindArgs: [] };
      calls.push(call);
      const stmt = {
        bind(...args: unknown[]) {
          call.bindArgs = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return (planted.firstResult ?? null) as T | null;
        },
        async all<T = unknown>() {
          return {
            results: (planted.allResults ?? []) as T[],
            success: true,
            meta: {},
          };
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

// Per-row, site-aware fake D1: prepare(sql).bind(args).first() resolves the
// planted row whose (slug, site_id) matches the bind arguments. Lets us
// assert that getArticleBySlug truly scopes by site_id instead of returning
// the first slug match across tenants.
function makePerSiteFakeDb(rows: { slug: string; site_id: string; row: ArticleRow }[]): D1Database {
  return {
    prepare(sql: string) {
      let boundArgs: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          boundArgs = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.includes("AND site_id = ?")) {
            const [slug, siteId] = boundArgs as [string, string];
            const hit = rows.find((r) => r.slug === slug && r.site_id === siteId);
            return (hit?.row ?? null) as T | null;
          }
          const [slug] = boundArgs as [string];
          const hit = rows.find((r) => r.slug === slug);
          return (hit?.row ?? null) as T | null;
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

describe("test/db prepare bind helpers", () => {
  it("getArticleBySlug routes the slug through prepare(...).bind(...) — no template-literal interpolation", async () => {
    const planted: ArticleRow = {
      id: 42,
      slug: "test",
      title: "Planted",
      content_json: "{}",
      content_html: null,
      category_id: null,
      status: "published",
      published_at: 1,
      scheduled_at: null,
      author_name: null,
      featured_image_id: null,
      is_featured: 0,
      is_trending: 0,
      created_at: 1,
      updated_at: 1,
    };
    const { db, calls } = makeFakeDb({ firstResult: planted });

    const row = await getArticleBySlug(db, "test");

    expect(row).toEqual(planted);
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.sql).toContain("FROM articles");
    expect(call.sql).toContain("WHERE slug = ?");
    expect(call.sql).not.toContain("${");
    expect(call.sql).not.toContain("'test'");
    expect(call.bindArgs).toEqual(["test"]);
  });

  it("getArticleBySlug returns null when no row is planted", async () => {
    const { db } = makeFakeDb({});
    const row = await getArticleBySlug(db, "missing");
    expect(row).toBeNull();
  });

  it("listArticles binds status, limit, offset positionally via prepare(...).bind(...)", async () => {
    const { db, calls } = makeFakeDb({ allResults: [] });

    await listArticles(db, { status: "draft", limit: 5, offset: 10 });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.sql).toContain("FROM articles");
    expect(call.sql).toContain("LIMIT ? OFFSET ?");
    expect(call.sql).not.toContain("${");
    expect(call.bindArgs).toEqual(["draft", 5, 10]);
  });

  it("listArticles defaults to status='published', limit=20, offset=0", async () => {
    const { db, calls } = makeFakeDb({ allResults: [] });
    await listArticles(db);
    expect(calls[0]!.bindArgs).toEqual(["published", 20, 0]);
  });

  it("getMediaById routes the id through prepare(...).bind(...)", async () => {
    const planted: MediaRow = {
      id: 7,
      filename: "x.png",
      storage_key: "x.png",
      mime_type: "image/png",
      size_bytes: 0,
      width: null,
      height: null,
      alt_text: null,
      folder: null,
      created_at: 1,
    };
    const { db, calls } = makeFakeDb({ firstResult: planted });

    const row = await getMediaById(db, 7);

    expect(row).toEqual(planted);
    const call = calls[0]!;
    expect(call.sql).toContain("FROM media");
    expect(call.sql).toContain("WHERE id = ?");
    expect(call.sql).not.toContain("${");
    expect(call.bindArgs).toEqual([7]);
  });

  it("getArticleBySlug is site-scoped (no cross-site leak)", async () => {
    const baseRow = (id: number, site_id: string): ArticleRow => ({
      id,
      slug: "hello",
      title: `Article ${id}`,
      content_json: JSON.stringify({ site: site_id }),
      content_html: null,
      category_id: null,
      status: "published",
      published_at: 1,
      scheduled_at: null,
      author_name: null,
      featured_image_id: null,
      is_featured: 0,
      is_trending: 0,
      created_at: 1,
      updated_at: 1,
    });
    const rowA = baseRow(1, "A");
    const rowB = baseRow(2, "B");
    const db = makePerSiteFakeDb([
      { slug: "hello", site_id: "A", row: rowA },
      { slug: "hello", site_id: "B", row: rowB },
    ]);

    const aFromA = await getArticleBySlug(db, "hello", { siteId: "A" });
    expect(aFromA).toEqual(rowA);
    expect(aFromA?.id).toBe(1);

    const bFromB = await getArticleBySlug(db, "hello", { siteId: "B" });
    expect(bFromB).toEqual(rowB);
    expect(bFromB?.id).toBe(2);

    // siteId omitted: fake returns the first slug match (no site filter); the
    // helper itself does not invent a siteId, so cross-site leaks are
    // prevented at the caller boundary (public middleware T26/T27).
    const unscopedDb = makePerSiteFakeDb([
      { slug: "hello", site_id: "A", row: rowA },
      { slug: "hello", site_id: "B", row: rowB },
    ]);
    const unscoped = await getArticleBySlug(unscopedDb, "hello");
    expect(unscoped).toEqual(rowA);

    // siteId pointing at a site with no article for this slug must return null.
    const emptyForC = await getArticleBySlug(db, "hello", { siteId: "C" });
    expect(emptyForC).toBeNull();
  });

  it("listCategories binds limit and offset positionally via prepare(...).bind(...)", async () => {
    const planted: CategoryRow[] = [
      {
        id: 1,
        slug: "news",
        name: "News",
        parent_id: null,
        featured_image_id: null,
        display_order: 0,
        article_count: 0,
      },
    ];
    const { db, calls } = makeFakeDb({ allResults: planted });

    const rows = await listCategories(db, { limit: 50, offset: 0 });

    expect(rows).toEqual(planted);
    const call = calls[0]!;
    expect(call.sql).toContain("FROM categories");
    expect(call.sql).toContain("LIMIT ? OFFSET ?");
    expect(call.sql).not.toContain("${");
    expect(call.bindArgs).toEqual([50, 0]);
  });
});
