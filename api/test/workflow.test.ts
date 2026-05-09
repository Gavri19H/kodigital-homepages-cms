import { describe, it, expect } from "vitest";
import {
  VALID_TRANSITIONS,
  isValidTransition,
  publish,
  type ArticleStatus,
} from "../src/workflow";
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
            return article.id === call.bindArgs[0] ? (article as unknown as T) : null;
          }
          if (sql.includes("MAX(version_number)")) {
            const id = call.bindArgs[0] as number;
            const max = versions.filter((v) => v.article_id === id)
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
            versions.push({ article_id, version_number, content_json, status });
          } else if (sql.startsWith("UPDATE articles SET status = 'published'")) {
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
    async get(k: string) { return store.has(k) ? store.get(k)! : null; },
    async put(k: string, v: string) { store.set(k, v); },
    async delete(k: string) { deletes.push(k); store.delete(k); },
    async list(o?: { prefix?: string; cursor?: string }) {
      const prefix = o?.prefix ?? "";
      const cursor = o?.cursor ?? "";
      const all = [...store.keys()].filter((k) => k.startsWith(prefix) && k > cursor).sort();
      return { keys: all.map((name) => ({ name })), list_complete: true, cacheStatus: null };
    },
    async getWithMetadata() { return { value: null, metadata: null, cacheStatus: null }; },
  } as unknown as KVNamespace;
  return { kv, store, deletes };
}

function makeArticle(overrides: Partial<ArticleRow> = {}): ArticleRow {
  return {
    id: 1, slug: "hello-world", title: "Hello World",
    content_json: JSON.stringify({ blocks: [{ type: "paragraph", data: { text: "Body" } }] }),
    content_html: null, category_id: null, status: "draft",
    published_at: null, scheduled_at: null, author_name: null,
    featured_image_id: null, is_featured: 0, is_trending: 0,
    created_at: 0, updated_at: 0, ...overrides,
  };
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db, CACHE: kv, MEDIA: {} as R2Bucket,
    APP_ENV: "test", ADMIN_BASE_URL: "http://localhost:8787",
    CACHE_API_ENABLED: "false", OPENAI_TEXT_MODEL: "", OPENAI_IMAGE_MODEL: "",
  };
}

describe("workflow: state machine (T6.AC1)", () => {
  it("VALID_TRANSITIONS contains exactly the 6 PRD-listed pairs", () => {
    const expected: Array<[ArticleStatus, ArticleStatus]> = [
      ["draft", "published"], ["draft", "scheduled"],
      ["scheduled", "published"], ["scheduled", "draft"],
      ["published", "archived"], ["published", "draft"],
    ];
    expect(VALID_TRANSITIONS).toHaveLength(expected.length);
    for (const [from, to] of expected) {
      expect(VALID_TRANSITIONS.some((t) => t.from === from && t.to === to)).toBe(true);
    }
  });

  it("isValidTransition accepts each PRD pair and rejects illegal ones", () => {
    expect(isValidTransition("draft", "published")).toBe(true);
    expect(isValidTransition("scheduled", "draft")).toBe(true);
    expect(isValidTransition("published", "draft")).toBe(true);
    expect(isValidTransition("published", "scheduled")).toBe(false);
    expect(isValidTransition("archived", "published")).toBe(false);
    expect(isValidTransition("archived", "draft")).toBe(false);
  });
});

describe("workflow: publish() BEHAVIORAL (T6.AC2)", () => {
  it("snapshots content_json, sets content_html+status+published_at, invalidates feeds", async () => {
    const initial = makeArticle({ status: "draft" });
    const harness = makeFakeDb(initial);
    const { kv, store, deletes } = makeKv();
    store.set("feed:rss", "<rss/>");
    store.set("feed:atom", "<atom/>");
    store.set("page:home", "<html/>");

    const updated = await publish(buildEnv(harness.db, kv), initial.id);

    // (a) version snapshot
    expect(harness.versions).toHaveLength(1);
    expect(harness.versions[0]!.article_id).toBe(initial.id);
    expect(harness.versions[0]!.version_number).toBe(1);
    expect(harness.versions[0]!.content_json).toBe(initial.content_json);
    expect(harness.versions[0]!.status).toBe("draft");
    // (b) content_html rendered from content_json
    expect(updated.content_html).toBe("<p>Body</p>");
    // (c) status=published, published_at set (unix seconds)
    expect(updated.status).toBe("published");
    expect(typeof updated.published_at).toBe("number");
    expect(updated.published_at).toBeGreaterThan(0);
    expect(updated.scheduled_at).toBeNull();
    // (d) feed cache invalidated, non-feed keys untouched
    expect(deletes).toContain("feed:rss");
    expect(deletes).toContain("feed:atom");
    expect(deletes).not.toContain("page:home");
    expect(store.has("page:home")).toBe(true);
  });

  it("rejects publish() from 'archived' (illegal transition) and missing article", async () => {
    const archived = makeFakeDb(makeArticle({ status: "archived" }));
    const { kv } = makeKv();
    await expect(publish(buildEnv(archived.db, kv), 1)).rejects.toThrow(/Illegal transition/);

    const draft = makeFakeDb(makeArticle({ id: 1 }));
    await expect(publish(buildEnv(draft.db, kv), 999)).rejects.toThrow(/not found/);
  });

  it("uses prepare(...).bind(...) for every D1 call (no template-literal SQL)", async () => {
    const harness = makeFakeDb(makeArticle({ status: "draft" }));
    const { kv } = makeKv();
    await publish(buildEnv(harness.db, kv), 1);

    expect(harness.calls.length).toBeGreaterThanOrEqual(4);
    for (const call of harness.calls) {
      expect(call.sql).not.toContain("${");
      if (call.sql.startsWith("SELECT * FROM articles")) expect(call.bindArgs).toHaveLength(1);
      if (call.sql.includes("MAX(version_number)")) expect(call.bindArgs).toHaveLength(1);
      if (call.sql.startsWith("INSERT INTO article_versions")) expect(call.bindArgs).toHaveLength(7);
      if (call.sql.startsWith("UPDATE articles SET status = 'published'")) expect(call.bindArgs).toHaveLength(4);
    }
  });
});
