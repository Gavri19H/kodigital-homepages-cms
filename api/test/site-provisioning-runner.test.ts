import { describe, it, expect } from "vitest";
import admin from "../src/admin/router";
import { STEP_KEYS, TOTAL_STEPS } from "../src/site-provisioning";
import type { Env } from "../src/env";

// T17 / Phase 3: site-provisioning runner behavioral AC (T17.AC2).
//
// GIVEN a pending site_creation_jobs row (status='pending',
// current_step_index=0), WHEN POST /api/admin/sites/:id/provision/next is
// invoked 15 times in sequence, THEN each call advances exactly one
// step, persists per-step input/output/status to site_creation_job_steps
// with attempt_count incremented, returns 200 with the {current_step,
// status} envelope, and the 15th response returns status='completed'.

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

interface StepRow {
  job_id: string;
  step_key: string;
  step_order: number;
  status: string;
  attempt_count: number;
  input: string | null;
  output: string | null;
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

// In-memory D1 fake: tracks the single (job, step) pair we care about so
// the runner sees consistent state across the 15 sequential POSTs. Only
// the SQL shapes the runner actually issues are modelled.
function makeFakeDb(initialJob: {
  id: string;
  site_id: string;
}): { db: D1Database; calls: RecordedCall[]; stepsRows: StepRow[] } {
  const job = {
    id: initialJob.id,
    site_id: initialJob.site_id,
    status: "pending",
    current_step_index: 0,
    total_steps: TOTAL_STEPS,
  };
  const stepsRows: StepRow[] = [];
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
          if (sql.indexOf("FROM sites WHERE id = ?") >= 0) {
            return ({ id: job.site_id } as unknown) as T;
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
          calls.push({ sql, binds: captured });
          if (sql.indexOf("INSERT INTO site_creation_job_steps") >= 0) {
            const [job_id, step_key, step_order, inputJson] = captured as [
              string,
              string,
              number,
              string,
            ];
            const existing = stepsRows.find(
              (r) => r.job_id === job_id && r.step_key === step_key,
            );
            if (existing) {
              existing.status = "running";
              existing.attempt_count += 1;
              existing.input = inputJson;
            } else {
              stepsRows.push({
                job_id,
                step_key,
                step_order,
                status: "running",
                attempt_count: 1,
                input: inputJson,
                output: null,
              });
            }
          } else if (
            sql.indexOf("UPDATE site_creation_job_steps") >= 0
          ) {
            const [status, output, _error, job_id, step_key] = captured as [
              string,
              string,
              string | null,
              string,
              string,
            ];
            const row = stepsRows.find(
              (r) => r.job_id === job_id && r.step_key === step_key,
            );
            if (row) {
              row.status = status;
              row.output = output;
            }
          } else if (sql.indexOf("UPDATE site_creation_jobs SET") >= 0) {
            const [current_step, current_step_index, status] = captured as [
              string,
              number,
              string,
              string | null,
              string,
            ];
            job.current_step_index = current_step_index;
            job.status = status;
            // current_step used only for round-trip observation
            void current_step;
          }
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          calls.push({ sql, binds: captured });
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, calls, stepsRows };
}

describe("site-provisioning runner (T17)", () => {
  it("provisioning runner advances exactly one step per /provision/next call", async () => {
    const { db, stepsRows } = makeFakeDb({
      id: "job_t17",
      site_id: "st_t17",
    });
    const env = buildEnv(db);

    interface AdvanceBody {
      job_id: string;
      site_id: string;
      current_step: string;
      current_step_index: number;
      total_steps: number;
      status: string;
      last_step_status: string;
      completed: boolean;
    }

    // T18 layered dry-run safety on top of T17: in the default
    // SITE_PROVISIONING_DRY_RUN='true' env, the Cloudflare-mutation step
    // (attach_domain_to_new_worker_or_mark_pending, index 2) resolves to
    // status='completed_dry_run' instead of 'completed'. All other steps
    // remain deterministic-stub 'completed'. The 15-step single-advance
    // invariant this test was written for is unchanged.
    const okStatuses = new Set(["completed", "completed_dry_run"]);
    for (let i = 0; i < TOTAL_STEPS; i++) {
      const res = await admin.request(
        "/api/admin/sites/st_t17/provision/next",
        { method: "POST", headers: { "content-type": "application/json" } },
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as AdvanceBody;
      expect(body.current_step).toBe(STEP_KEYS[i]);
      expect(body.current_step_index).toBe(i + 1);
      expect(body.total_steps).toBe(TOTAL_STEPS);
      expect(okStatuses.has(body.last_step_status)).toBe(true);
      if (i < TOTAL_STEPS - 1) {
        expect(body.status).toBe("running");
        expect(body.completed).toBe(false);
      } else {
        expect(body.status).toBe("completed");
        expect(body.completed).toBe(true);
      }
    }

    expect(stepsRows).toHaveLength(TOTAL_STEPS);
    for (let i = 0; i < TOTAL_STEPS; i++) {
      const row = stepsRows[i];
      if (!row) throw new Error(`missing step row at index ${i}`);
      expect(row.step_key).toBe(STEP_KEYS[i]);
      expect(row.step_order).toBe(i);
      expect(okStatuses.has(row.status)).toBe(true);
      expect(row.attempt_count).toBe(1);
      expect(row.input).not.toBeNull();
      expect(row.output).not.toBeNull();
    }
  });

});
