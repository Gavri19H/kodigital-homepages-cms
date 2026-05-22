// T14 — publish() bumps sites.content_version and invalidates the per-site
// public-content cache surface.
//
// Verifies:
//   (a) UPDATE sites SET content_version = content_version + 1 fires with
//       the article's site_id as the only bind arg (T14-AC1).
//   (b) invalidatePublishCaches wipes html/article/category/page/
//       homepage-data/sitemap/feed:rss/feed:atom keys scoped to the
//       site_id and leaves other tenants' keys untouched (T14-AC2).
//   (c) Articles without a site_id (legacy Phase-1 rows) skip the sites
//       bump but still invalidate feeds — preserves backward compat.
//
// SQL bindings use prepare(...).bind(...) only (no template-literal SQL).
// The fake D1 inspects sql + bindArgs so the test is brittle to drift.

import { describe, it, expect } from "vitest";
import { publish } from "../src/workflow";
import type { ArticleRow } from "../src/db";
import type { Env } from "../src/env";

interface RecordedCall {
  sql: string;
  bindArgs: unknown[];
}

interface VersionSnapshot {
  article_id: number;
  version_number: number;
  content_json: string;
  status: string;
}

function makeFakeDb(seed: ArticleRow) {
  const calls: RecordedCall[] = [];
  const versions: VersionSnapshot[] = [];
  let article: ArticleRow = { ...seed };

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
          if (sql.includes("FROM articles WHERE id = ?")) {
            return article.id === call.bindArgs[0]
              ? (article as unknown as T)
              : null;
          }
          if (sql.includes("MAX(version_number)")) {
            const id = call.bindArgs[0] as number;
            const max = versions
              .filter((v) => v.article_id === id)
              .reduce((m, v) => Math.max(m, v.version_number), 0);
            return { max_version: max } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          if (sql.startsWith("INSERT INTO article_versions")) {
            const [article_id, version_number, content_json, status] =
              call.bindArgs as [number, number, string, string];
            versions.push({
              article_id,
              version_number,
              content_json,
              status,
            });
          } else if (
            sql.startsWith("UPDATE articles SET status = 'published'")
          ) {
            const [content_html, published_at, updated_at, id] =
              call.bindArgs as [string, number, number, number];
            if (article.id === id) {
              article = {
                ...article,
                status: "published",
                content_html,
                published_at,
                scheduled_at: null,
                updated_at,
              };
            }
          }
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;

  return { db, calls, versions };
}

function makeKv() {
  const store = new Map<string, string>();
  const deletes: string[] = [];
  const kv = {
    async get(k: string) {
      return store.has(k) ? store.get(k)! : null;
    },
    async put(k: string, v: string) {
      store.set(k, v);
    },
    async delete(k: string) {
      deletes.push(k);
      store.delete(k);
    },
    async list(o?: { prefix?: string; cursor?: string }) {
      const prefix = o?.prefix ?? "";
      const cursor = o?.cursor ?? "";
      const all = [...store.keys()]
        .filter((k) => k.startsWith(prefix) && k > cursor)
        .sort();
      return {
        keys: all.map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace;
  return { kv, store, deletes };
}

function makeArticle(overrides: Partial<ArticleRow> = {}): ArticleRow {
  return {
    id: 1,
    slug: "hello-world",
    title: "Hello World",
    content_json: JSON.stringify({
      blocks: [{ type: "paragraph", data: { text: "Body" } }],
    }),
    content_html: null,
    category_id: null,
    status: "draft",
    published_at: null,
    scheduled_at: null,
    author_name: null,
    featured_image_id: null,
    is_featured: 0,
    is_trending: 0,
    created_at: 0,
    updated_at: 0,
    ...overrides,
  };
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  };
}

describe("publish(): bumps sites.content_version on article publish (T14.AC1)", () => {
  it("issues UPDATE sites SET content_version = content_version + 1 keyed by the article's site_id", async () => {
    const article = makeArticle({ status: "draft", site_id: "st_abc" });
    const { db, calls } = makeFakeDb(article);
    const { kv } = makeKv();

    await publish(buildEnv(db, kv), article.id);

    const bump = calls.find((c) =>
      c.sql.startsWith(
        "UPDATE sites SET content_version = content_version + 1",
      ),
    );
    expect(bump, "publish() did not bump sites.content_version").toBeDefined();
    expect(bump!.sql).toBe(
      "UPDATE sites SET content_version = content_version + 1 WHERE id = ?",
    );
    expect(bump!.bindArgs).toEqual(["st_abc"]);
  });

  it("does NOT bump sites.content_version when the article has no site_id (legacy row)", async () => {
    const article = makeArticle({ status: "draft" }); // site_id omitted
    const { db, calls } = makeFakeDb(article);
    const { kv } = makeKv();

    await publish(buildEnv(db, kv), article.id);

    const bump = calls.find((c) =>
      c.sql.startsWith(
        "UPDATE sites SET content_version = content_version + 1",
      ),
    );
    expect(bump).toBeUndefined();
  });
});

describe("publish(): invalidates per-site public-content cache (T14.AC2)", () => {
  it("wipes html/article/category/page/homepage-data/sitemap/feed keys for the site", async () => {
    const article = makeArticle({ status: "draft", site_id: "st_abc" });
    const { db } = makeFakeDb(article);
    const { kv, store, deletes } = makeKv();

    // Pre-populate the per-site cache surface AND a key for a different
    // tenant so we can prove the wipe is site-scoped.
    store.set("html:st_abc:/article/hello:1:1", "<html/>");
    store.set("article:st_abc:hello:1:1", "<html/>");
    store.set("category:st_abc:news:1:1:1", "<html/>");
    store.set("page:st_abc:about:1:1", "<html/>");
    store.set("homepage-data:st_abc:1", "{}");
    store.set("sitemap:st_abc:1", "<urlset/>");
    store.set("feed:rss:st_abc:1", "<rss/>");
    store.set("feed:atom:st_abc:1", "<atom/>");

    // Other-tenant decoy — MUST survive.
    store.set("html:st_other:/article/hello:1:1", "<html/>");
    store.set("feed:rss:st_other:1", "<rss/>");

    await publish(buildEnv(db, kv), article.id);

    // Every per-site key was deleted.
    expect(deletes).toContain("html:st_abc:/article/hello:1:1");
    expect(deletes).toContain("article:st_abc:hello:1:1");
    expect(deletes).toContain("category:st_abc:news:1:1:1");
    expect(deletes).toContain("page:st_abc:about:1:1");
    expect(deletes).toContain("homepage-data:st_abc:1");
    expect(deletes).toContain("sitemap:st_abc:1");
    expect(deletes).toContain("feed:rss:st_abc:1");
    expect(deletes).toContain("feed:atom:st_abc:1");

    // Other tenant untouched.
    expect(store.has("html:st_other:/article/hello:1:1")).toBe(true);
    expect(store.has("feed:rss:st_other:1")).toBe(true);
    expect(deletes).not.toContain("html:st_other:/article/hello:1:1");
    expect(deletes).not.toContain("feed:rss:st_other:1");
  });

  it("does NOT touch per-site keys when the article has no site_id", async () => {
    const article = makeArticle({ status: "draft" });
    const { db } = makeFakeDb(article);
    const { kv, store, deletes } = makeKv();

    store.set("html:st_abc:/article/hello:1:1", "<html/>");

    await publish(buildEnv(db, kv), article.id);

    expect(store.has("html:st_abc:/article/hello:1:1")).toBe(true);
    expect(deletes).not.toContain("html:st_abc:/article/hello:1:1");
  });
});

describe("publish(): D1 parameterization for the content_version bump (T14)", () => {
  it("uses prepare(...).bind(...) with one positional ? for the sites UPDATE", async () => {
    const article = makeArticle({ status: "draft", site_id: "st_xyz" });
    const { db, calls } = makeFakeDb(article);
    const { kv } = makeKv();

    await publish(buildEnv(db, kv), article.id);

    const bump = calls.find((c) =>
      c.sql.startsWith(
        "UPDATE sites SET content_version = content_version + 1",
      ),
    );
    expect(bump).toBeDefined();
    expect(bump!.sql).not.toContain("${");
    expect(bump!.sql).not.toContain("' ||");
    expect(bump!.bindArgs).toHaveLength(1);
    expect(bump!.bindArgs[0]).toBe("st_xyz");
  });
});
