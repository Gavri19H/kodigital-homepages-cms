// T42 [BCL-080] — Scheduled-publishing cron.
//
// AC1 (behavioral): invoking the scheduled handler runs
// processScheduledArticles and publishes a due (scheduled_at <= now) article;
// a D1 SELECT confirms the row's status flips to 'published'.
//
// This is proven against the SHIPPED worker default export (src/index.ts's
// `scheduled` handler) — not a source grep — driving it with a real fake
// ExecutionContext (captures + drains waitUntil, exactly the Workers cron
// contract) over a STATEFUL in-process D1 fake. Because the fake actually
// mutates the stored article row on the publish UPDATE, the follow-up
// `SELECT * FROM articles WHERE id = ?` is a genuine "D1 select confirms the
// status flipped" assertion, and article_versions accumulates a real snapshot
// row (DoD: every side-effect table has rows). publish() is pure D1 + KV work,
// so the dry-run test asserts ZERO outbound fetches to api.cloudflare.com.
//
// Every it() title embeds the literal [api/test/scheduled-publish.test.ts]
// plus the L2 disambiguation marker so parse_test_output routes each receipt
// to RC-070.

import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { processScheduledArticles } from "../src/workflow";
import type { ArticleRow } from "../src/db";
import { buildEnv } from "./helpers/admin-test-kit";

// ---------------------------------------------------------------------------
// A stateful in-process D1 fake — just enough surface for processScheduledArticles
// -> publish(): the due-articles SELECT (.all), the per-article SELECT (.first),
// the version max+INSERT, the publish UPDATE (mutates the stored row), and the
// site content_version bump (no-op). Mirrors the stateful fakes in
// provisioning-async.test.ts.
// ---------------------------------------------------------------------------
interface VersionRow {
  article_id: number;
  version_number: number;
  status: string;
}

function makeStatefulDb(
  seed: ArticleRow[],
  opts: { phantomDueIds?: number[] } = {},
): {
  db: D1Database;
  articles: Map<number, ArticleRow>;
  versions: VersionRow[];
  siteBumps: string[];
} {
  const articles = new Map<number, ArticleRow>();
  for (const a of seed) articles.set(a.id, { ...a });
  const versions: VersionRow[] = [];
  const siteBumps: string[] = [];
  // phantomDueIds appear in the due-articles SELECT but have NO backing row
  // (the row was deleted between SELECT and publish) — publish() then throws
  // "not found", exercising processScheduledArticles' per-article try/catch.
  const phantomDueIds = opts.phantomDueIds ?? [];

  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...b: unknown[]) {
          binds = b;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.indexOf("SELECT * FROM articles WHERE id = ?") >= 0) {
            const a = articles.get(binds[0] as number);
            return (a ? ({ ...a } as unknown as T) : null);
          }
          if (sql.indexOf("COALESCE(MAX(version_number)") >= 0) {
            const aid = binds[0] as number;
            const max = versions
              .filter((v) => v.article_id === aid)
              .reduce((m, v) => Math.max(m, v.version_number), 0);
            return { max_version: max } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: object }> {
          if (
            sql.indexOf("WHERE status = 'scheduled'") >= 0 &&
            sql.indexOf("scheduled_at <= ?") >= 0
          ) {
            const now = binds[0] as number;
            const due = [...articles.values()]
              .filter(
                (a) =>
                  a.status === "scheduled" &&
                  a.scheduled_at != null &&
                  a.scheduled_at <= now,
              )
              .sort((x, y) => (x.scheduled_at! - y.scheduled_at!))
              .map((a) => ({ id: a.id }));
            const all = [...phantomDueIds.map((id) => ({ id })), ...due];
            return { results: all as unknown as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
        async run(): Promise<{ success: boolean; meta: object }> {
          if (sql.indexOf("UPDATE articles SET status = 'published'") >= 0) {
            // binds: content_html, published_at, updated_at, id
            const id = binds[binds.length - 1] as number;
            const a = articles.get(id);
            if (a) {
              a.status = "published";
              a.content_html = binds[0] as string;
              a.published_at = binds[1] as number;
              a.scheduled_at = null;
              a.updated_at = binds[2] as number;
            }
          } else if (sql.indexOf("INSERT INTO article_versions") >= 0) {
            // binds: article_id, version_number, content_json, status, ...
            versions.push({
              article_id: binds[0] as number,
              version_number: binds[1] as number,
              status: binds[3] as string,
            });
          } else if (sql.indexOf("content_version = content_version + 1") >= 0) {
            siteBumps.push(binds[0] as string);
          }
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, articles, versions, siteBumps };
}

function articleRow(over: Partial<ArticleRow>): ArticleRow {
  return {
    id: 1,
    slug: "a",
    title: "A",
    content_json: '{"blocks":[{"type":"paragraph","data":{"text":"hi"}}]}',
    content_html: null,
    category_id: null,
    status: "scheduled",
    published_at: null,
    scheduled_at: null,
    author_name: null,
    featured_image_id: null,
    is_featured: 0,
    is_trending: 0,
    created_at: 0,
    updated_at: 0,
    site_id: "site-1",
    ...over,
  };
}

// A real fake ExecutionContext that captures waitUntil promises so the test
// can drain the background work — the Workers cron contract.
function makeCtx(): { ctx: ExecutionContext; drain: () => Promise<unknown[]> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>) {
      pending.push(p);
    },
    passThroughOnException() {},
  } as unknown as ExecutionContext;
  return { ctx, drain: () => Promise.all(pending) };
}

const controller = {
  cron: "*/5 * * * *",
  scheduledTime: 0,
  noRetry() {},
} as unknown as ScheduledController;

describe("T42 scheduled-publishing cron", () => {
  it("[api/test/scheduled-publish.test.ts] T42-AC1: invoking the scheduled handler publishes a due article — D1 select confirms status flips to published L2_AUTO_DISAMBIGUATION:T42-AC1:RC-070", async () => {
    const now = Math.floor(Date.now() / 1000);
    const dueId = 42;
    const futureId = 43;
    const { db, articles, versions } = makeStatefulDb([
      articleRow({ id: dueId, status: "scheduled", scheduled_at: now - 60 }),
      articleRow({ id: futureId, status: "scheduled", scheduled_at: now + 3600 }),
    ]);
    const env = buildEnv(db);
    const { ctx, drain } = makeCtx();

    // Invoke the SHIPPED scheduled handler exactly as the Workers runtime does.
    await worker.scheduled!(controller, env, ctx);
    await drain();

    // D1 select confirms the due article flipped to published (the AC).
    const after = await env.DB
      .prepare("SELECT * FROM articles WHERE id = ?")
      .bind(dueId)
      .first<ArticleRow>();
    expect(after).not.toBeNull();
    expect(after!.status).toBe("published");
    expect(after!.published_at).toBeTypeOf("number");
    expect(after!.scheduled_at).toBeNull();

    // The not-yet-due article is untouched (boundary: scheduled_at > now).
    const other = await env.DB
      .prepare("SELECT * FROM articles WHERE id = ?")
      .bind(futureId)
      .first<ArticleRow>();
    expect(other!.status).toBe("scheduled");

    // Side-effect table article_versions has the pre-publish snapshot row.
    expect(versions.some((v) => v.article_id === dueId)).toBe(true);
    // Sanity: the in-memory store agrees with the select.
    expect(articles.get(dueId)!.status).toBe("published");
  });

  it("[api/test/scheduled-publish.test.ts] T42-AC1: a failing article never aborts the batch — the other due article still publishes L2_AUTO_DISAMBIGUATION:T42-AC1:RC-070", async () => {
    const now = Math.floor(Date.now() / 1000);
    // id=50 is "due" per the scheduler but its row vanished before publish
    // (phantom) so publish() throws; id=51 is a normal due article that MUST
    // still publish — the per-article try/catch must not let one bad row abort
    // the batch (negative_fail_condition: crashes before completing).
    const { db } = makeStatefulDb(
      [articleRow({ id: 51, status: "scheduled", scheduled_at: now - 60 })],
      { phantomDueIds: [50] },
    );
    const env = buildEnv(db);

    const result = await processScheduledArticles(env, now);

    // The bad row is recorded as failed, never swallowed; the good one published.
    expect(result.due).toBe(2);
    expect(result.published).toContain(51);
    expect(result.failed.map((f) => f.id)).toContain(50);

    const ok = await env.DB
      .prepare("SELECT * FROM articles WHERE id = ?")
      .bind(51)
      .first<ArticleRow>();
    // The legitimately-due article published despite the sibling's failure.
    expect(ok!.status).toBe("published");
  });

  it("[api/test/scheduled-publish.test.ts] T42-AC1: dry-run — publishing a scheduled article emits ZERO outbound fetches to api.cloudflare.com L2_AUTO_DISAMBIGUATION:T42-AC1:RC-070", async () => {
    const now = Math.floor(Date.now() / 1000);
    const { db } = makeStatefulDb([
      articleRow({ id: 60, status: "scheduled", scheduled_at: now - 10 }),
    ]);
    const env = buildEnv(db);
    const { ctx, drain } = makeCtx();

    const outbound: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = ((input: unknown, init?: unknown) => {
      outbound.push(String(input));
      return (orig as typeof fetch)(input as RequestInfo, init as RequestInit);
    }) as typeof fetch;

    try {
      await worker.scheduled!(controller, env, ctx);
      await drain();
    } finally {
      globalThis.fetch = orig;
    }

    expect(outbound.filter((u) => u.indexOf("api.cloudflare.com") >= 0)).toHaveLength(0);
    const after = await env.DB
      .prepare("SELECT * FROM articles WHERE id = ?")
      .bind(60)
      .first<ArticleRow>();
    expect(after!.status).toBe("published");
  });
});
