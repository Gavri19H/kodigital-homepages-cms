import { describe, it, expect } from "vitest";
import { STEPS } from "../src/site-provisioning";
import type { Env } from "../src/env";

// MQAFIX-1 / RX1.AC3: allocate_vertical_categories step.
//
// GIVEN a site with vertical_slug='health' AND a category_verticals
// matrix that links 3 categories (Wellness, Healthy Meals, Personal
// Finance — though only the first two are wired to 'health' in the
// 0004 seed) to the 'health' vertical, WHEN the
// allocate_vertical_categories step runs for that site, THEN every
// matrix category for the site's vertical is inserted into
// site_categories under (site_id, category_id) with a stable
// display_order, AND the operation is idempotent under re-invocation
// (no duplicate rows because the underlying SQL is INSERT OR IGNORE
// against the (site_id, category_id) PRIMARY KEY).
//
// Pre-MQAFIX-1, this step was a deterministic stub that returned
// `completed` without writing to site_categories — production sites
// therefore had 0 rows in site_categories (RX1.AC3 / REQ-026
// unsatisfied at runtime).

interface SiteCategoryRow {
  site_id: string;
  category_id: number;
  display_order: number;
}

interface MatrixRow {
  category_id: number;
  display_order: number;
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

function makeFakeDb(
  site: { id: string; vertical_slug: string | null },
  matrix: ReadonlyArray<MatrixRow>,
): {
  db: D1Database;
  inserted: SiteCategoryRow[];
  counters: { selectVerticalSlugCalls: number };
} {
  const inserted: SiteCategoryRow[] = [];
  const counters = { selectVerticalSlugCalls: 0 };
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.indexOf("SELECT vertical_slug FROM sites WHERE id = ?") >= 0) {
            counters.selectVerticalSlugCalls += 1;
            const [id] = captured as [string];
            if (id !== site.id) return null;
            return ({ vertical_slug: site.vertical_slug } as unknown) as T;
          }
          return null;
        },
        async run() {
          if (sql.indexOf("INSERT OR IGNORE INTO site_categories") >= 0) {
            const [site_id, category_id, display_order] = captured as [
              string,
              number,
              number,
            ];
            const exists = inserted.find(
              (r) => r.site_id === site_id && r.category_id === category_id,
            );
            if (!exists) {
              inserted.push({ site_id, category_id, display_order });
            }
          }
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          if (
            sql.indexOf("FROM category_verticals") >= 0 &&
            sql.indexOf("JOIN verticals") >= 0
          ) {
            return {
              results: matrix as unknown as T[],
              success: true,
              meta: {},
            };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, inserted, counters };
}

describe("site-provisioning allocate_vertical_categories (MQAFIX-1 / RX1.AC3)", () => {
  it("inserts one site_categories row per category_verticals matrix entry for the site's vertical", async () => {
    const matrix: MatrixRow[] = [
      { category_id: 4, display_order: 0 }, // wellness/health 0
      { category_id: 1, display_order: 1 }, // healthy-meals/health 1
    ];
    const { db, inserted, counters } = makeFakeDb(
      { id: "st_health", vertical_slug: "health" },
      matrix,
    );
    const env = buildEnv(db);
    const result = await STEPS.allocate_vertical_categories({
      env,
      db,
      job_id: "job_health",
      site_id: "st_health",
      step_order: 3,
    });

    expect(result.status).toBe("completed");
    const out = JSON.parse(result.output) as {
      step: string;
      allocated: number;
      vertical_slug: string;
      total_matrix_rows: number;
    };
    expect(out.step).toBe("allocate_vertical_categories");
    expect(out.vertical_slug).toBe("health");
    expect(out.allocated).toBe(2);
    expect(out.total_matrix_rows).toBe(2);
    expect(counters.selectVerticalSlugCalls).toBe(1);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toEqual({
      site_id: "st_health",
      category_id: 4,
      display_order: 0,
    });
    expect(inserted[1]).toEqual({
      site_id: "st_health",
      category_id: 1,
      display_order: 1,
    });
  });

  it("is idempotent under re-invocation (no duplicate rows on second run)", async () => {
    const matrix: MatrixRow[] = [
      { category_id: 4, display_order: 0 },
      { category_id: 1, display_order: 1 },
    ];
    const { db, inserted } = makeFakeDb(
      { id: "st_dup", vertical_slug: "health" },
      matrix,
    );
    const env = buildEnv(db);
    // First invocation seeds 2 rows.
    await STEPS.allocate_vertical_categories({
      env,
      db,
      job_id: "job_dup",
      site_id: "st_dup",
      step_order: 3,
    });
    expect(inserted).toHaveLength(2);
    // Second invocation — same (site_id, category_id) keys, the fake
    // mirrors the INSERT OR IGNORE behavior of the real D1 PRIMARY KEY
    // (site_id, category_id).
    const result2 = await STEPS.allocate_vertical_categories({
      env,
      db,
      job_id: "job_dup",
      site_id: "st_dup",
      step_order: 3,
    });
    expect(result2.status).toBe("completed");
    expect(inserted).toHaveLength(2);
  });

  it("returns completed with allocated=0 when the site has no vertical_slug (defensive path)", async () => {
    const { db, inserted } = makeFakeDb(
      { id: "st_orphan", vertical_slug: null },
      [],
    );
    const env = buildEnv(db);
    const result = await STEPS.allocate_vertical_categories({
      env,
      db,
      job_id: "job_orphan",
      site_id: "st_orphan",
      step_order: 3,
    });
    expect(result.status).toBe("completed");
    const out = JSON.parse(result.output) as {
      step: string;
      allocated: number;
      vertical_slug: string;
      reason?: string;
    };
    expect(out.allocated).toBe(0);
    expect(out.vertical_slug).toBe("");
    expect(out.reason).toBe("no_vertical_slug_on_site");
    expect(inserted).toHaveLength(0);
  });

  it("returns completed with allocated=0 when the matrix has no rows for the vertical (unknown vertical_slug)", async () => {
    const { db, inserted } = makeFakeDb(
      { id: "st_unknown", vertical_slug: "no-such-vertical" },
      [],
    );
    const env = buildEnv(db);
    const result = await STEPS.allocate_vertical_categories({
      env,
      db,
      job_id: "job_unknown",
      site_id: "st_unknown",
      step_order: 3,
    });
    expect(result.status).toBe("completed");
    const out = JSON.parse(result.output) as {
      step: string;
      allocated: number;
      vertical_slug: string;
      total_matrix_rows: number;
    };
    expect(out.allocated).toBe(0);
    expect(out.vertical_slug).toBe("no-such-vertical");
    expect(out.total_matrix_rows).toBe(0);
    expect(inserted).toHaveLength(0);
  });
});

// ===================================================================
// T9 (rescue-3) — correct vertical->category allocation + article link.
// ------------------------------------------------------------------
// brief W2.3-EXTENDED: the parenting site was allocated the
// vertical-MISMATCHED, EMPTY set family-travel / healthy-meals /
// wellness (article_count 0 each). The allocate_vertical_categories
// step now follows an AUTHORITATIVE per-vertical plan for `parenting`
// (steps.ts VERTICAL_CATEGORY_PLAN), ensuring the categories exist and
// allocating parenting-appropriate ones INDEPENDENT of the (mismatched)
// category_verticals matrix (T9-AC1). The starter articles then
// round-robin over that allocated set, so each allocated category's
// article_count — computed via a SELECT join — is > 0, meaning category
// pages and the chip rail are no longer empty (T9-AC2).
// ===================================================================

const PARENTING_PLAN_SLUGS = [
  "parenting-tips",
  "child-development",
  "family-activities",
  "newborn-baby-care",
] as const;

const MISMATCHED_SLUGS = ["family-travel", "healthy-meals", "wellness"] as const;

interface CategoryRow {
  id: number;
  slug: string;
  name: string;
  display_order: number;
}

interface StarterArticleRow {
  site_id: string;
  slug: string;
  category_id: number | null;
}

// Fake-D1 for a parenting-vertical site. Pre-seeds the three MISMATCHED
// categories (so the — deliberately ignored — category_verticals matrix
// below can reference real ids) and tracks categories / site_categories /
// articles so both the allocate and generate_15 steps run end-to-end.
function makeParentingFakeDb(
  site_id: string,
): {
  db: D1Database;
  categories: CategoryRow[];
  siteCategories: SiteCategoryRow[];
  articles: StarterArticleRow[];
} {
  const categories: CategoryRow[] = [
    { id: 1, slug: "healthy-meals", name: "Healthy Meals", display_order: 1 },
    { id: 2, slug: "family-travel", name: "Family Travel", display_order: 2 },
    { id: 3, slug: "wellness", name: "Wellness", display_order: 7 },
  ];
  const siteCategories: SiteCategoryRow[] = [];
  const articles: StarterArticleRow[] = [];
  const aiGenerations = new Map<string, Record<string, unknown>>();

  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (
            sql.indexOf("FROM ai_generations WHERE idempotency_key = ?") >= 0
          ) {
            const [idempotency_key] = captured as [string];
            return (aiGenerations.get(idempotency_key) ??
              null) as unknown as T | null;
          }
          if (sql.indexOf("FROM categories WHERE slug = ?") >= 0) {
            const [slug] = captured as [string];
            const c = categories.find((r) => r.slug === slug);
            return c ? (({ id: c.id } as unknown) as T) : null;
          }
          if (
            sql.indexOf("FROM site_settings WHERE site_id = ? AND key = ?") >= 0
          ) {
            // No default_author_name seeded — generate_15 falls back to a
            // deterministic brand-derived editorial name.
            return null;
          }
          if (sql.indexOf("FROM sites WHERE id = ?") >= 0) {
            const [id] = captured as [string];
            if (id !== site_id) return null;
            return ({
              id: site_id,
              name: "Playtrail",
              domain: "playtrail.net",
              vertical_slug: "parenting",
            } as unknown) as T;
          }
          return null;
        },
        async run() {
          if (sql.indexOf("INSERT OR IGNORE INTO categories") >= 0) {
            const [slug, name, display_order] = captured as [
              string,
              string,
              number,
            ];
            if (!categories.some((c) => c.slug === slug)) {
              const nextId =
                categories.reduce((m, c) => Math.max(m, c.id), 0) + 1;
              categories.push({ id: nextId, slug, name, display_order });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO site_categories") >= 0) {
            const [s_id, category_id, display_order] = captured as [
              string,
              number,
              number,
            ];
            if (
              !siteCategories.some(
                (c) => c.site_id === s_id && c.category_id === category_id,
              )
            ) {
              siteCategories.push({ site_id: s_id, category_id, display_order });
            }
          } else if (sql.indexOf("INSERT INTO ai_generations") >= 0) {
            const idempotency_key = captured[6] as string;
            if (!aiGenerations.has(idempotency_key)) {
              aiGenerations.set(idempotency_key, {
                idempotency_key,
                status: "pending",
                response_json: null,
                parsed_json: null,
              });
            }
          } else if (sql.indexOf("UPDATE ai_generations") >= 0) {
            const idempotency_key = captured[captured.length - 1] as string;
            const r = aiGenerations.get(idempotency_key);
            if (r) {
              if (sql.indexOf("status = 'success'") >= 0)
                (r as { status: string }).status = "success";
              else if (sql.indexOf("status = 'failed'") >= 0)
                (r as { status: string }).status = "failed";
              else if (sql.indexOf("status = 'fallback'") >= 0)
                (r as { status: string }).status = "fallback";
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO articles") >= 0) {
            const [s_id, slug] = captured as [string, string];
            const category_id = (captured[6] ?? null) as number | null;
            if (!articles.some((a) => a.site_id === s_id && a.slug === slug)) {
              articles.push({ site_id: s_id, slug, category_id });
            }
          }
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          if (
            sql.indexOf("FROM category_verticals") >= 0 &&
            sql.indexOf("JOIN verticals") >= 0
          ) {
            // The MISMATCHED parenting mapping from the 0004 seed — returned
            // here to prove the vertical-plan path IGNORES it.
            return {
              results: ([
                { category_id: 2, display_order: 1 }, // family-travel
                { category_id: 1, display_order: 2 }, // healthy-meals
                { category_id: 3, display_order: 2 }, // wellness
              ] as unknown) as T[],
              success: true,
              meta: {},
            };
          }
          if (sql.indexOf("FROM site_categories WHERE site_id = ?") >= 0) {
            const [s_id] = captured as [string];
            const rows = siteCategories
              .filter((c) => c.site_id === s_id)
              .sort(
                (a, b) =>
                  a.display_order - b.display_order ||
                  a.category_id - b.category_id,
              )
              .map((c) => ({ category_id: c.category_id }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, categories, siteCategories, articles };
}

describe("site-provisioning T9 — parenting vertical->category allocation + article link", () => {
  // L2_AUTO_DISAMBIGUATION:T9-AC1:RC-024 [api/test/site-provisioning-allocate-categories.test.ts]
  it("allocates parenting-appropriate categories to a parenting-vertical site, not the mismatched family-travel/healthy-meals/wellness set [api/test/site-provisioning-allocate-categories.test.ts] L2_AUTO_DISAMBIGUATION:T9-AC1:RC-024", async () => {
    const { db, categories, siteCategories } = makeParentingFakeDb(
      "st_parenting",
    );
    const env = buildEnv(db);
    const result = await STEPS.allocate_vertical_categories({
      env,
      db,
      job_id: "job_parenting",
      site_id: "st_parenting",
      step_order: 3,
    });

    expect(result.status).toBe("completed");
    const out = JSON.parse(result.output) as {
      step: string;
      kind: string;
      allocated: number;
      vertical_slug: string;
      plan_categories: string[];
    };
    expect(out.step).toBe("allocate_vertical_categories");
    expect(out.kind).toBe("vertical_plan");
    expect(out.vertical_slug).toBe("parenting");
    expect(out.allocated).toBe(PARENTING_PLAN_SLUGS.length);
    expect(out.plan_categories).toEqual([...PARENTING_PLAN_SLUGS]);

    // SELECT site_categories, resolve each to its category slug.
    const byId = new Map(categories.map((c) => [c.id, c.slug]));
    const allocatedSlugs = siteCategories.map((c) => byId.get(c.category_id));
    expect(allocatedSlugs).toEqual([...PARENTING_PLAN_SLUGS]);
    // NONE of the mismatched, empty categories the brief flagged.
    for (const bad of MISMATCHED_SLUGS) {
      expect(allocatedSlugs).not.toContain(bad);
    }
  });

  // L2_AUTO_DISAMBIGUATION:T9-AC2:RC-025 [api/test/site-provisioning-allocate-categories.test.ts]
  it("links every starter article to an allocated parenting category so each category's article_count (SELECT join) is > 0 [api/test/site-provisioning-allocate-categories.test.ts] L2_AUTO_DISAMBIGUATION:T9-AC2:RC-025", async () => {
    const { db, siteCategories, articles } = makeParentingFakeDb(
      "st_parenting2",
    );
    // Supported model ids so the generators run their no-API-key fallback
    // path (no OPENAI_API_KEY ⇒ deterministic content, zero outbound).
    const env = buildEnv(db, {
      OPENAI_TEXT_MODEL: "gpt-5.5",
      OPENAI_IMAGE_MODEL: "gpt-image-2",
    });

    // Allocate the parenting category set, then generate the starter
    // articles that round-robin over the allocated categories.
    await STEPS.allocate_vertical_categories({
      env,
      db,
      job_id: "job_p2",
      site_id: "st_parenting2",
      step_order: 3,
    });
    const gen = await STEPS.generate_15_homepage_articles({
      env,
      db,
      job_id: "job_p2",
      site_id: "st_parenting2",
      step_order: 10,
    });
    expect(gen.status).toBe("completed");

    // Starter articles were written and the allocated set is the plan set.
    expect(articles.length).toBeGreaterThan(0);
    const allocatedIds = new Set(siteCategories.map((c) => c.category_id));
    expect(allocatedIds.size).toBe(PARENTING_PLAN_SLUGS.length);

    // Every article links to an allocated category (no null, no stray id).
    for (const a of articles) {
      expect(a.category_id).not.toBeNull();
      expect(allocatedIds.has(a.category_id as number)).toBe(true);
    }

    // article_count per allocated category via a SELECT-join-style group-by:
    // every allocated category has > 0 articles, so category pages and the
    // chip rail are no longer empty.
    for (const cid of allocatedIds) {
      const article_count = articles.filter(
        (a) => a.category_id === cid,
      ).length;
      expect(article_count).toBeGreaterThan(0);
    }
  });
});
