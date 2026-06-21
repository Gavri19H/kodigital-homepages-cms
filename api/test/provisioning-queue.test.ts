import { describe, it, expect, vi } from "vitest";
import type { Env } from "../src/env";

// rescue-4 v3 — Cloudflare Queues PARALLEL fan-out regression test.
//
// When env.PROVISION_QUEUE is bound, the heavy gen step must ENQUEUE one message
// per unit (no inline generation) and return in_progress; the queue() consumer
// (processProvisionMessage) then generates each unit in its OWN invocation —
// the parallelism a single Promise.all in one invocation could NOT achieve
// (#30 proved that contends). Deterministic slug (#29) keeps re-delivery
// idempotent (zero duplicates). The generators are mocked to RE-SLUG (vary per
// call) so a dup would surface immediately.

const hoist = vi.hoisted(() => ({ articleCall: 0 }));
vi.mock("../src/ai/generators/text", async (importActual) => {
  const actual = await importActual<typeof import("../src/ai/generators/text")>();
  return {
    ...actual,
    generateStarterArticlePlan: vi.fn(async (_e: unknown, input: { count: number }) => ({
      parsed: {
        items: Array.from({ length: input.count }, (_v, i) => ({
          slug: `planned-slug-${i}`,
          title: `Planned Title ${i}`,
          summary: `Summary ${i}`,
        })),
      },
      ai_generation_id: "plan-gen",
      meta: {},
    })),
    generateStarterArticle: vi.fn(async (_e: unknown, input: { slug: string; title: string }) => {
      hoist.articleCall += 1;
      return {
        parsed: {
          slug: `ai-reslug-${input.slug}-call${hoist.articleCall}`,
          title: `AI ${input.title}`,
          intro: "Intro paragraph.",
          sections: [
            { heading: { level: 2, text: "A" }, paragraphs: ["a"] },
            { heading: { level: 2, text: "B" }, paragraphs: ["b"] },
            { heading: { level: 2, text: "C" }, paragraphs: ["c"] },
          ],
          faqs: [
            { question: "Q1", answer: "A1" },
            { question: "Q2", answer: "A2" },
            { question: "Q3", answer: "A3" },
          ],
        },
        ai_generation_id: `art-gen-${hoist.articleCall}`,
        meta: {},
      };
    }),
  };
});

import {
  STEPS,
  processProvisionMessage,
  type ProvisionMessage,
} from "../src/site-provisioning/steps";

interface UnitRow {
  site_id: string;
  unit_index: number;
  slug: string;
  title: string | null;
  summary: string | null;
  text_status: string;
  image_status: string;
  article_id: string | null;
  attempt_count: number;
  updated_at: number;
}
interface ArticleRow { site_id: string; slug: string; title: string }

function makeEnv(db: D1Database, sent: ProvisionMessage[]): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    PROVISION_QUEUE: {
      send: async (msg: ProvisionMessage) => {
        sent.push(msg);
      },
    } as unknown as Queue<ProvisionMessage>,
  } as Env;
}

function makeDb(units: UnitRow[], articles: ArticleRow[], siteId: string): D1Database {
  return {
    prepare(sql: string) {
      let cap: unknown[] = [];
      const stmt = {
        bind(...b: unknown[]) {
          cap = b;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          if (sql.indexOf("FROM sites WHERE id = ?") >= 0) {
            return { id: siteId, name: "Play", domain: "play.example", vertical_slug: "parenting" } as unknown as T;
          }
          if (sql.indexOf("FROM site_settings WHERE site_id = ? AND key = ?") >= 0) return null;
          if (sql.indexOf("COUNT(*) AS unit_count FROM provisioning_article_units") >= 0) {
            return { unit_count: units.length } as unknown as T;
          }
          // remaining check
          if (sql.indexOf("SELECT 1 AS x FROM provisioning_article_units") >= 0) {
            const col = sql.indexOf("text_status IN") >= 0 ? "text_status" : "image_status";
            const rem = units.some((u) =>
              (col === "text_status" ? u.text_status : u.image_status) === "pending" ||
              (col === "text_status" ? u.text_status : u.image_status) === "queued",
            );
            return (rem ? ({ x: 1 } as unknown as T) : null);
          }
          // processProvisionMessage unit load
          if (sql.indexOf("FROM provisioning_article_units") >= 0 && sql.indexOf("unit_index = ? LIMIT 1") >= 0) {
            const [, unit_index] = cap as [string, number];
            const u = units.find((x) => x.unit_index === unit_index);
            return (u ? ({ ...u } as unknown as T) : null);
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.indexOf("FROM site_categories") >= 0) {
            return { results: [{ category_id: 10 }, { category_id: 11 }] as unknown as T[] };
          }
          // enqueue pending unit_index list
          if (sql.indexOf("SELECT unit_index FROM provisioning_article_units") >= 0) {
            const col = sql.indexOf("text_status = 'pending'") >= 0 ? "text_status" : "image_status";
            const gateDone = sql.indexOf("text_status = 'done'") >= 0;
            const rows = units
              .filter((u) => (col === "text_status" ? u.text_status : u.image_status) === "pending" && (!gateDone || u.text_status === "done"))
              .sort((a, b) => a.unit_index - b.unit_index)
              .map((u) => ({ unit_index: u.unit_index }));
            return { results: rows as unknown as T[] };
          }
          return { results: [] as T[] };
        },
        async run(): Promise<{ success: true; meta: Record<string, unknown> }> {
          if (sql.indexOf("INSERT OR IGNORE INTO provisioning_article_units") >= 0) {
            const [, unit_index, slug, title, summary] = cap as [string, number, string, string, string];
            if (!units.some((u) => u.unit_index === unit_index)) {
              units.push({ site_id: siteId, unit_index, slug, title, summary, text_status: "pending", image_status: "pending", article_id: null, attempt_count: 0, updated_at: 1 });
            }
          } else if (sql.indexOf("SET text_status = 'queued'") >= 0) {
            const [, unit_index] = cap as [string, number];
            const u = units.find((x) => x.unit_index === unit_index && x.text_status === "pending");
            if (u) u.text_status = "queued";
          } else if (sql.indexOf("SET text_status = 'pending'") >= 0) {
            // reclaim — no-op in test (units freshly queued, not stale)
          } else if (sql.indexOf("INSERT OR IGNORE INTO articles") >= 0) {
            const slug = cap[1] as string;
            const title = cap[2] as string;
            if (!articles.some((a) => a.slug === slug)) articles.push({ site_id: siteId, slug, title });
          } else if (sql.indexOf("SET text_status = 'done'") >= 0) {
            const [article_id, , unit_index] = cap as [string, string, number];
            const u = units.find((x) => x.unit_index === unit_index);
            if (u) { u.text_status = "done"; u.article_id = article_id; }
          }
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

describe("provisioning Queue parallel fan-out (rescue-4 v3)", () => {
  it("enqueues every unit (no inline gen), the consumer generates each, zero dups, idempotent", async () => {
    hoist.articleCall = 0;
    const siteId = "st_q";
    const units: UnitRow[] = [];
    const articles: ArticleRow[] = [];
    const sent: ProvisionMessage[] = [];
    const db = makeDb(units, articles, siteId);
    const env = makeEnv(db, sent);
    const ctx = { env, db, job_id: "", site_id: siteId, step_order: 10 };

    // 1. step with the queue bound → materialize + enqueue ALL + in_progress.
    const r1 = await STEPS["generate_15_homepage_articles"](ctx);
    expect(r1.status).toBe("in_progress");
    expect(units).toHaveLength(15);
    expect(units.every((u) => u.text_status === "queued")).toBe(true);
    expect(sent).toHaveLength(15);
    // The STEP did NO generation — that's the consumer's job (parallel).
    expect(articles).toHaveLength(0);

    // 2. process each message (simulating the parallel consumer fleet).
    for (const msg of sent) {
      const out = await processProvisionMessage(env, msg);
      expect(out).toBe("done");
    }
    expect(articles).toHaveLength(15);
    // deterministic PLANNED slug, never the AI re-slug → zero duplicates.
    expect(new Set(articles.map((a) => a.slug)).size).toBe(15);
    expect(articles.every((a) => /^planned-slug-\d+$/.test(a.slug))).toBe(true);
    expect(units.every((u) => u.text_status === "done")).toBe(true);

    // 3. re-run the step → all done → completed, nothing re-enqueued.
    sent.length = 0;
    const r2 = await STEPS["generate_15_homepage_articles"](ctx);
    expect(r2.status).toBe("completed");
    expect(sent).toHaveLength(0);

    // 4. idempotency: a re-delivered message for a done unit is a no-op skip.
    const before = articles.length;
    const out = await processProvisionMessage(env, { site_id: siteId, unit_index: 3, stage: "text" });
    expect(out).toBe("skip");
    expect(articles).toHaveLength(before);
  });
});
