import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import {
  buildHomeViewModel,
  type HomeSiteContext,
} from "../src/public/view-models/home";

// T3 — Article CREATE persists all fields; remove homepage_section; category
// required for published/featured/trending.
//
// BEHAVIORAL contract covered here:
//   * T3-AC1 (RC-007): POST /api/admin/articles persists the full column set
//     (author_name, author_bio, featured_image_id, seo_title, seo_description,
//     homepage_rank, is_featured, is_trending, published_at, status). The
//     INSERT binds every supplied value and RETURNING * round-trips them back.
//   * T3-AC2 (RC-008): publishing / featuring / marking trending with no
//     category_id is rejected (422 CATEGORY_REQUIRED) AND homepage_section is
//     absent from the create write path, the patch write path, and the public
//     home reader.

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

interface PlantedRow {
  match: string;
  row: unknown | null;
}

function makeFakeDb(planted: PlantedRow[] = []): {
  db: D1Database;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          calls.push({ sql, binds: captured });
          for (const entry of planted) {
            if (sql.indexOf(entry.match) >= 0) {
              return (entry.row ?? null) as T | null;
            }
          }
          return null;
        },
        async run() {
          calls.push({ sql, binds: captured });
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          calls.push({ sql, binds: captured });
          for (const entry of planted) {
            if (sql.indexOf(entry.match) >= 0 && Array.isArray(entry.row)) {
              return { results: entry.row as T[], success: true, meta: {} };
            }
          }
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

function buildEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    ...overrides,
  };
}

function findCall(
  calls: RecordedCall[],
  substring: string,
): RecordedCall | undefined {
  return calls.find((c) => c.sql.indexOf(substring) >= 0);
}

// Site + valid-category plants reused by the happy-path create cases.
const SITE_OK: PlantedRow = {
  match: "FROM sites WHERE id = ?",
  row: { id: "st_exist" },
};
const CATEGORY_OK: PlantedRow = {
  match: "FROM category_verticals cv",
  row: { ok: 1 },
};

describe("T3 article CREATE persists all fields + category guard + homepage_section removal", () => {
  // L2_AUTO_DISAMBIGUATION:T3-AC1:RC-007 [api/test/admin-article-create.test.ts]
  it("AC1: POST create persists the full author/SEO/placement column set and round-trips every field [api/test/admin-article-create.test.ts] L2_AUTO_DISAMBIGUATION:T3-AC1:RC-007", async () => {
    const inputs = {
      site_id: "st_exist",
      slug: "full-article",
      title: "Full Article",
      content_json: '{"blocks":[]}',
      category_id: 5,
      status: "published",
      author_name: "Jane Doe",
      author_bio: "Staff writer",
      featured_image_id: 12,
      seo_title: "SEO Title",
      seo_description: "SEO Description",
      homepage_rank: 3,
      is_featured: 1,
      is_trending: 0,
      published_at: 1_700_001_234,
    };
    // RETURNING * round-trips the persisted row back to the caller.
    const returnedRow = { id: 77, ...inputs, homepage_section: "none" };
    const { db, calls } = makeFakeDb([
      SITE_OK,
      CATEGORY_OK,
      { match: "INSERT INTO articles", row: returnedRow },
    ]);

    const res = await admin.request(
      "/api/admin/articles",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(inputs),
      },
      buildEnv(db),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { article: Record<string, unknown> };

    const insert = findCall(calls, "INSERT INTO articles");
    expect(insert).toBeDefined();

    // Every column in the create write path is named in the INSERT SQL.
    // (round-3 / migration 0027: `subtitle` joined the column list, positioned
    // after seo_description.)
    for (const col of [
      "site_id",
      "slug",
      "title",
      "content_json",
      "category_id",
      "status",
      "author_name",
      "author_bio",
      "featured_image_id",
      "seo_title",
      "seo_description",
      "subtitle",
      "homepage_rank",
      "is_featured",
      "is_trending",
      "published_at",
    ]) {
      expect(insert?.sql).toContain(col);
    }

    // Every supplied value is bound in the documented positional order — the
    // create form no longer silently drops fields. round-3: `subtitle` binds
    // between seo_description and homepage_rank; this input omits it, so it
    // round-trips as null (the create body is the contract — a missing optional
    // field is null, not dropped).
    expect(insert?.binds).toEqual([
      "st_exist",
      "full-article",
      "Full Article",
      '{"blocks":[]}',
      5,
      "published",
      "Jane Doe",
      "Staff writer",
      12,
      "SEO Title",
      "SEO Description",
      null,
      3,
      1,
      0,
      1_700_001_234,
    ]);

    // create-then-read: the persisted row is returned verbatim.
    expect(body.article.author_name).toBe("Jane Doe");
    expect(body.article.author_bio).toBe("Staff writer");
    expect(body.article.featured_image_id).toBe(12);
    expect(body.article.seo_title).toBe("SEO Title");
    expect(body.article.seo_description).toBe("SEO Description");
    expect(body.article.homepage_rank).toBe(3);
    expect(body.article.is_featured).toBe(1);
    expect(body.article.published_at).toBe(1_700_001_234);
    expect(body.article.status).toBe("published");
  });

  // L2_AUTO_DISAMBIGUATION:T3-AC2:RC-008 [api/test/admin-article-create.test.ts]
  it("AC2: publishing/featuring/trending without a category is rejected, and homepage_section is absent from create/patch write paths and the public reader [api/test/admin-article-create.test.ts] L2_AUTO_DISAMBIGUATION:T3-AC2:RC-008", async () => {
    // (a) publishing with no category_id -> 422 CATEGORY_REQUIRED, no INSERT.
    {
      const { db, calls } = makeFakeDb([SITE_OK]);
      const res = await admin.request(
        "/api/admin/articles",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            site_id: "st_exist",
            slug: "p1",
            title: "P1",
            status: "published",
          }),
        },
        buildEnv(db),
      );
      expect(res.status).toBe(422);
      const body = (await res.json()) as { code?: string };
      expect(body.code).toBe("CATEGORY_REQUIRED");
      expect(findCall(calls, "INSERT INTO articles")).toBeUndefined();
    }

    // (b) featuring with no category_id -> 422, no INSERT.
    {
      const { db, calls } = makeFakeDb([SITE_OK]);
      const res = await admin.request(
        "/api/admin/articles",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            site_id: "st_exist",
            slug: "f1",
            title: "F1",
            is_featured: 1,
          }),
        },
        buildEnv(db),
      );
      expect(res.status).toBe(422);
      expect(((await res.json()) as { code?: string }).code).toBe(
        "CATEGORY_REQUIRED",
      );
      expect(findCall(calls, "INSERT INTO articles")).toBeUndefined();
    }

    // (c) marking trending with no category_id -> 422, no INSERT.
    {
      const { db, calls } = makeFakeDb([SITE_OK]);
      const res = await admin.request(
        "/api/admin/articles",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            site_id: "st_exist",
            slug: "t1",
            title: "T1",
            is_trending: 1,
          }),
        },
        buildEnv(db),
      );
      expect(res.status).toBe(422);
      expect(((await res.json()) as { code?: string }).code).toBe(
        "CATEGORY_REQUIRED",
      );
      expect(findCall(calls, "INSERT INTO articles")).toBeUndefined();
    }

    // (d) create write path ignores homepage_section even when supplied.
    {
      const { db, calls } = makeFakeDb([
        SITE_OK,
        CATEGORY_OK,
        { match: "INSERT INTO articles", row: { id: 1, status: "published" } },
      ]);
      const res = await admin.request(
        "/api/admin/articles",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            site_id: "st_exist",
            slug: "hp",
            title: "HP",
            status: "published",
            category_id: 5,
            homepage_section: "hero",
          }),
        },
        buildEnv(db),
      );
      expect(res.status).toBe(201);
      const insert = findCall(calls, "INSERT INTO articles");
      expect(insert).toBeDefined();
      expect(insert?.sql).not.toContain("homepage_section");
      expect(insert?.binds).not.toContain("hero");
    }

    // (e) patch write path ignores homepage_section even when supplied.
    {
      const { db, calls } = makeFakeDb([
        {
          match: "SELECT id, site_id, slug FROM articles WHERE id = ?",
          row: { id: 20, site_id: "st_exist", slug: "s20" },
        },
        {
          match: "SELECT * FROM articles WHERE id = ?",
          row: { id: 20, site_id: "st_exist", slug: "s20", title: "new" },
        },
      ]);
      const res = await admin.request(
        "/api/admin/articles/20",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "new", homepage_section: "hero" }),
        },
        buildEnv(db),
      );
      expect(res.status).toBe(200);
      const update = findCall(calls, "UPDATE articles");
      expect(update).toBeDefined();
      expect(update?.sql).toContain("title = ?");
      expect(update?.sql).not.toContain("homepage_section");
      expect(update?.binds).not.toContain("hero");
    }

    // (f) public home reader issues no SQL referencing homepage_section.
    {
      const { db, calls } = makeFakeDb();
      const ctx: HomeSiteContext = {
        siteId: "st_exist",
        hostname: "example.com",
      };
      await buildHomeViewModel(db, ctx);
      const leaked = calls.filter((c) => c.sql.indexOf("homepage_section") >= 0);
      expect(leaked).toEqual([]);
    }
  });
});
