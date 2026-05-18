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
