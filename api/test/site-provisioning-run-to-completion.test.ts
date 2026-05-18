import { describe, it, expect } from "vitest";
import {
  STEP_KEYS,
  TOTAL_STEPS,
  runProvisioningToCompletion,
} from "../src/site-provisioning";
import type { Env } from "../src/env";

// MQAFIX-1 / RX1.AC1 + AC4: runProvisioningToCompletion drives the
// runner from current_step_index=0 to status='completed' across all
// TOTAL_STEPS steps in a single call. The 16th invocation
// short-circuits via the runner's `if (job.status === 'completed')`
// guard and writes NO additional step row — proving the
// "16th call is idempotent (no new step row)" clause of AC4.
//
// Pre-MQAFIX-1 the runner advanced ONE step per HTTP /provision/next
// POST; production sites halted at ~8/15 steps because no automated
// driver loops the runner. This helper closes the loop on the worker
// side so any caller (POST /api/admin/sites included) can synchronously
// reach step 15 without depending on a client-side polling driver.

interface StepRow {
  job_id: string;
  step_key: string;
  step_order: number;
  status: string;
  attempt_count: number;
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

function makeFakeDb(initialJob: { id: string; site_id: string }): {
  db: D1Database;
  stepsRows: StepRow[];
} {
  const job = {
    id: initialJob.id,
    site_id: initialJob.site_id,
    status: "pending",
    current_step_index: 0,
    total_steps: TOTAL_STEPS,
  };
  const stepsRows: StepRow[] = [];

  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.indexOf("FROM sites WHERE id = ?") >= 0) {
            return ({
              id: job.site_id,
              name: "Health Site",
              domain: "health.example",
              vertical_slug: "health",
            } as unknown) as T;
          }
          if (
            sql.indexOf("FROM site_creation_jobs WHERE site_id = ?") >= 0
          ) {
            return ({
              id: job.id,
              site_id: job.site_id,
              status: job.status,
              current_step_index: job.current_step_index,
              total_steps: job.total_steps,
            } as unknown) as T;
          }
          return null;
        },
        async run() {
          if (sql.indexOf("INSERT INTO site_creation_job_steps") >= 0) {
            const [job_id, step_key, step_order] = captured as [
              string,
              string,
              number,
            ];
            const existing = stepsRows.find(
              (r) => r.job_id === job_id && r.step_key === step_key,
            );
            if (existing) {
              existing.status = "running";
              existing.attempt_count += 1;
            } else {
              stepsRows.push({
                job_id,
                step_key,
                step_order,
                status: "running",
                attempt_count: 1,
              });
            }
          } else if (
            sql.indexOf("UPDATE site_creation_job_steps") >= 0
          ) {
            const [status, , , jobId, step_key] = captured as [
              string,
              string,
              string | null,
              string,
              string,
            ];
            const row = stepsRows.find(
              (r) => r.job_id === jobId && r.step_key === step_key,
            );
            if (row) row.status = status;
          } else if (sql.indexOf("UPDATE site_creation_jobs SET") >= 0) {
            const [, current_step_index, status] = captured as [
              string,
              number,
              string,
              string | null,
              string,
            ];
            job.current_step_index = current_step_index;
            job.status = status;
          }
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          // category_verticals matrix for the 'health' vertical.
          if (
            sql.indexOf("FROM category_verticals") >= 0 &&
            sql.indexOf("JOIN verticals") >= 0
          ) {
            return {
              results: [
                { category_id: 4, display_order: 0 },
                { category_id: 1, display_order: 1 },
              ] as unknown as T[],
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

  return { db, stepsRows };
}

describe("runProvisioningToCompletion (MQAFIX-1 / RX1.AC1 + AC4)", () => {
  it("drives the runner from current_step_index=0 through all 15 steps in a single call", async () => {
    const { db, stepsRows } = makeFakeDb({
      id: "job_complete",
      site_id: "st_complete",
    });
    const env = buildEnv(db);

    const summary = await runProvisioningToCompletion(
      env,
      db,
      "st_complete",
    );

    expect(summary.steps_run).toBe(TOTAL_STEPS);
    expect(summary.final_status).toBe("completed");
    expect(stepsRows).toHaveLength(TOTAL_STEPS);
    for (let i = 0; i < TOTAL_STEPS; i++) {
      expect(stepsRows[i]?.step_key).toBe(STEP_KEYS[i]);
      expect(stepsRows[i]?.step_order).toBe(i);
    }
  });

  it("16th invocation against an already-completed job is idempotent (no new step row, no extra advances)", async () => {
    const { db, stepsRows } = makeFakeDb({
      id: "job_idem",
      site_id: "st_idem",
    });
    const env = buildEnv(db);

    // First drive — completes all 15 steps.
    const first = await runProvisioningToCompletion(env, db, "st_idem");
    expect(first.steps_run).toBe(TOTAL_STEPS);
    expect(first.final_status).toBe("completed");
    expect(stepsRows).toHaveLength(TOTAL_STEPS);

    // Second drive (the "16th call" surface in AC4) — the runner sees
    // job.status='completed' and returns immediately without advancing
    // a step or writing a step row.
    const second = await runProvisioningToCompletion(env, db, "st_idem");
    expect(second.steps_run).toBe(0);
    expect(second.final_status).toBe("completed");
    expect(stepsRows).toHaveLength(TOTAL_STEPS);
  });

  it("returns final_status='no_job' when no site_creation_jobs row exists for the site", async () => {
    const db = {
      prepare() {
        const stmt = {
          bind() {
            return stmt;
          },
          async first() {
            return null;
          },
          async run() {
            return { success: true, meta: {} };
          },
          async all() {
            return { results: [], success: true, meta: {} };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
    const env = buildEnv(db);
    const summary = await runProvisioningToCompletion(env, db, "st_missing");
    expect(summary.steps_run).toBe(0);
    expect(summary.final_status).toBe("no_job");
  });
});
