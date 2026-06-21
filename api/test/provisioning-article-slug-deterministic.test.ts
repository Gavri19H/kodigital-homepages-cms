import { describe, it, expect, vi } from "vitest";
import type { Env } from "../src/env";

// rescue-4 v2 — DETERMINISTIC ARTICLE SLUG regression test.
//
// Live forensic (prod site st_acaca65f0e024337): the chunked
// generate_15_homepage_articles step bound `article.parsed.slug` — the slug the
// MODEL re-derives, which VARIES per call — as the article's (site_id, slug)
// identity. So every time a unit was re-generated (cron overlap / re-pick before
// its done-flip landed) a NEW article row was created: 21 rows for 14 distinct
// titles = 7 duplicate articles. The existing AI-integration tests never caught
// this because with no OPENAI_API_KEY the generator takes the FALLBACK path
// where parsed.slug === input.slug, masking the divergence.
//
// The fix binds the PLANNED unit slug, so a re-gen targets the SAME (site_id,
// slug) row and INSERT OR IGNORE is a no-op. This test forces
// parsed.slug !== input.slug (and varies it per call) to prove the invariant +
// idempotency-under-re-pick.

const hoist = vi.hoisted(() => ({ articleCall: 0 }));

vi.mock("../src/ai/generators/text", async (importActual) => {
  const actual = await importActual<typeof import("../src/ai/generators/text")>();
  return {
    ...actual,
    generateStarterArticlePlan: vi.fn(async (_env: unknown, input: { count: number }) => ({
      parsed: {
        items: Array.from({ length: input.count }, (_v, i) => ({
          slug: `planned-slug-${i}`,
          title: `Planned Title ${i}`,
          summary: `Planned summary ${i}`,
        })),
      },
      ai_generation_id: "plan-gen",
      meta: {},
    })),
    generateStarterArticle: vi.fn(async (_env: unknown, input: { slug: string; title: string }) => {
      hoist.articleCall += 1;
      // The model RE-DERIVES a different slug, and it VARIES per call — exactly
      // the non-determinism that produced duplicates in prod.
      return {
        parsed: {
          slug: `ai-reslug-${input.slug}-call${hoist.articleCall}`,
          title: `AI ${input.title}`,
          intro: "Intro paragraph for the article body.",
          sections: [
            { heading: { level: 2, text: "Section A" }, paragraphs: ["a"] },
            { heading: { level: 2, text: "Section B" }, paragraphs: ["b"] },
            { heading: { level: 2, text: "Section C" }, paragraphs: ["c"] },
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

// Import AFTER vi.mock so the step picks up the mocked generators.
import { STEPS } from "../src/site-provisioning/steps";

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
}
interface ArticleRow {
  site_id: string;
  slug: string;
  title: string;
}

function makeEnv(db: D1Database): Env {
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
            return {
              id: siteId,
              name: "Play Site",
              domain: "play.example",
              vertical_slug: "parenting",
            } as unknown as T;
          }
          if (sql.indexOf("FROM site_settings WHERE site_id = ? AND key = ?") >= 0) {
            return null; // no default_author_name -> brand-derived fallback
          }
          if (sql.indexOf("COUNT(*) AS unit_count FROM provisioning_article_units") >= 0) {
            return { unit_count: units.length } as unknown as T;
          }
          if (
            sql.indexOf("FROM provisioning_article_units") >= 0 &&
            sql.indexOf("text_status = 'pending'") >= 0
          ) {
            const u = units
              .filter((x) => x.text_status === "pending")
              .sort((a, b) => a.unit_index - b.unit_index)[0];
            return (u ? { ...u } : null) as unknown as T | null;
          }
          return null;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (sql.indexOf("FROM site_categories") >= 0) {
            return { results: [{ category_id: 10 }, { category_id: 11 }] as unknown as T[] };
          }
          return { results: [] as T[] };
        },
        async run(): Promise<{ success: true; meta: Record<string, unknown> }> {
          if (sql.indexOf("INSERT OR IGNORE INTO provisioning_article_units") >= 0) {
            const [, unit_index, slug, title, summary] = cap as [
              string,
              number,
              string,
              string,
              string,
            ];
            if (!units.some((u) => u.unit_index === unit_index)) {
              units.push({
                site_id: siteId,
                unit_index,
                slug,
                title,
                summary,
                text_status: "pending",
                image_status: "pending",
                article_id: null,
                attempt_count: 0,
              });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO articles") >= 0) {
            const slug = cap[1] as string;
            const title = cap[2] as string;
            if (!articles.some((a) => a.slug === slug)) {
              articles.push({ site_id: siteId, slug, title });
            }
          } else if (
            sql.indexOf("UPDATE provisioning_article_units SET text_status = 'done'") >= 0
          ) {
            const [article_id, , unit_index] = cap as [string, string, number];
            const u = units.find((x) => x.unit_index === unit_index);
            if (u) {
              u.text_status = "done";
              u.article_id = article_id;
            }
          }
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

async function runTextStep(env: Env, db: D1Database, siteId: string) {
  const ctx = { env, db, job_id: "job_x", site_id: siteId, step_order: 10 };
  let r = await STEPS["generate_15_homepage_articles"](ctx);
  let guard = 0;
  while (r.status === "in_progress" && guard < 300) {
    r = await STEPS["generate_15_homepage_articles"](ctx);
    guard += 1;
  }
  return r;
}

describe("provisioning article slug is deterministic (rescue-4 v2 dedup)", () => {
  it("stores the PLANNED unit slug (not the model re-slug) and never duplicates on re-pick", async () => {
    hoist.articleCall = 0;
    const siteId = "st_play";
    const units: UnitRow[] = [];
    const articles: ArticleRow[] = [];
    const db = makeDb(units, articles, siteId);
    const env = makeEnv(db);

    const r1 = await runTextStep(env, db, siteId);
    expect(r1.status).toBe("completed");

    // exactly 15 articles, each under its PLANNED slug — NOT the AI reslug.
    expect(articles).toHaveLength(15);
    for (const a of articles) {
      expect(a.slug).toMatch(/^planned-slug-\d+$/);
      expect(a.slug.startsWith("ai-reslug-")).toBe(false);
    }
    for (const u of units) expect(u.article_id).toBe(u.slug);

    // SIMULATE cron overlap / re-pick: reset two done units to pending, re-run.
    const u3 = units.find((u) => u.unit_index === 3)!;
    const u7 = units.find((u) => u.unit_index === 7)!;
    u3.text_status = "pending";
    u3.article_id = null;
    u7.text_status = "pending";
    u7.article_id = null;

    const r2 = await runTextStep(env, db, siteId);
    expect(r2.status).toBe("completed");

    // STILL exactly 15 — the re-gen returned brand-new ai-reslug values, but the
    // INSERT used the deterministic planned slug, so INSERT OR IGNORE no-ops.
    expect(articles).toHaveLength(15);
    expect(new Set(articles.map((a) => a.slug)).size).toBe(15);
  });

  it("materializes exactly STARTER_ARTICLE_TARGET units, all reaching text_status=done", async () => {
    hoist.articleCall = 0;
    const siteId = "st_play2";
    const units: UnitRow[] = [];
    const articles: ArticleRow[] = [];
    const db = makeDb(units, articles, siteId);
    await runTextStep(makeEnv(db), db, siteId);
    expect(units).toHaveLength(15);
    expect(units.every((u) => u.text_status === "done")).toBe(true);
  });
});
