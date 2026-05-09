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
