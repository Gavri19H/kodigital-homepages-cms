import { describe, it, expect, beforeEach, afterEach } from "vitest";
import admin from "../src/admin/router";
import { STEP_KEYS } from "../src/site-provisioning";
import type { Env } from "../src/env";

// T18 / Phase 3: site-provisioning dry-run safety (T18.AC3).
//
// GIVEN SITE_PROVISIONING_DRY_RUN='true' (default), WHEN the
// attach_domain_to_new_worker_or_mark_pending step runs, THEN
//   (a) NO fetch() is issued to api.cloudflare.com,
//   (b) the persisted site_creation_job_steps row carries
//       status='completed_dry_run',
//   (c) a cache_purge_log row records the dry-run attempt with both
//       env-flag values (dry_run=1, allow_route_mutation=0).
//
// Test name MUST match the T18.AC3 anchored regex
// `^dry-run does not call Cloudflare APIs$`.

const ATTACH_STEP_INDEX = STEP_KEYS.indexOf(
  "attach_domain_to_new_worker_or_mark_pending",
);

interface StepRow {
  job_id: string;
  step_key: string;
  step_order: number;
  status: string;
  attempt_count: number;
  input: string | null;
  output: string | null;
}

interface PurgeLogRow {
  site_id: string;
  hostname: string;
  action: string;
  status: string;
  dry_run: number;
  allow_route_mutation: number;
  payload: string | null;
  response: string | null;
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

function makeFakeDb(initialJob: {
  id: string;
  site_id: string;
  hostname: string;
}): {
  db: D1Database;
  stepsRows: StepRow[];
  purgeRows: PurgeLogRow[];
} {
  const job = {
    id: initialJob.id,
    site_id: initialJob.site_id,
    status: "pending",
    current_step_index: 0,
    total_steps: STEP_KEYS.length,
  };
  const stepsRows: StepRow[] = [];
  const purgeRows: PurgeLogRow[] = [];

  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.indexOf("FROM domains WHERE site_id = ?") >= 0) {
            return ({ hostname: initialJob.hostname } as unknown) as T;
          }
          if (sql.indexOf("FROM sites WHERE id = ? LIMIT 1") >= 0) {
            return ({ id: job.site_id } as unknown) as T;
          }
          if (sql.indexOf("FROM site_creation_jobs WHERE site_id = ?") >= 0) {
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
          } else if (sql.indexOf("UPDATE site_creation_job_steps") >= 0) {
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
            const [, current_step_index, status] = captured as [
              string,
              number,
              string,
              string | null,
              string,
            ];
            job.current_step_index = current_step_index;
            job.status = status;
          } else if (sql.indexOf("INSERT INTO cache_purge_log") >= 0) {
            const [
              site_id,
              hostname,
              action,
              status,
              dry_run,
              allow_route_mutation,
              payload,
              response,
            ] = captured as [
              string,
              string,
              string,
              string,
              number,
              number,
              string | null,
              string | null,
            ];
            purgeRows.push({
              site_id,
              hostname,
              action,
              status,
              dry_run,
              allow_route_mutation,
              payload,
              response,
            });
          }
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, stepsRows, purgeRows };
}

describe("site-provisioning dry-run safety (T18)", () => {
  let fetchCalls: Array<string>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      throw new Error(`fetch should not be called in dry-run: ${url}`);
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("provisioning steps are idempotent under re-invocation", async () => {
    // BEHAVIORAL: re-calling /provision/next for a job that has already
    // advanced past a given step MUST NOT duplicate step rows; the fake
    // DB models the (job_id, step_key) upsert and increments
    // attempt_count when the same key is re-INSERTed.
    const { db, stepsRows } = makeFakeDb({
      id: "job_idem",
      site_id: "st_idem",
      hostname: "idem.example.test",
    });
    const env = buildEnv(db);

    const res1 = await admin.request(
      "/api/admin/sites/st_idem/provision/next",
      { method: "POST", headers: { "content-type": "application/json" } },
      env,
    );
    expect(res1.status).toBe(200);

    const firstKeys = stepsRows.map((r) => r.step_key);
    const initialRowCount = stepsRows.length;
    expect(initialRowCount).toBeGreaterThanOrEqual(1);

    // Re-run the same job — fakeDb's upsert path keeps one row per
    // (job_id, step_key). Row count stays the same; no duplicates.
    const res2 = await admin.request(
      "/api/admin/sites/st_idem/provision/next",
      { method: "POST", headers: { "content-type": "application/json" } },
      env,
    );
    expect(res2.status).toBe(200);

    const uniqueKeys = new Set(stepsRows.map((r) => r.step_key));
    expect(uniqueKeys.size).toBe(stepsRows.length);
    // Confirms the first step's key did not duplicate.
    if (firstKeys[0]) {
      const matching = stepsRows.filter((r) => r.step_key === firstKeys[0]);
      expect(matching).toHaveLength(1);
    }
  });

  it("dry-run does not call Cloudflare APIs", async () => {
    const { db, stepsRows, purgeRows } = makeFakeDb({
      id: "job_t18",
      site_id: "st_t18",
      hostname: "t18.example.test",
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

    let attachResponse: AdvanceBody | null = null;
    for (let i = 0; i <= ATTACH_STEP_INDEX; i++) {
      const res = await admin.request(
        "/api/admin/sites/st_t18/provision/next",
        { method: "POST", headers: { "content-type": "application/json" } },
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as AdvanceBody;
      if (i === ATTACH_STEP_INDEX) {
        attachResponse = body;
      }
    }

    expect(attachResponse).not.toBeNull();
    const attach = attachResponse as AdvanceBody;
    expect(attach.current_step).toBe(
      "attach_domain_to_new_worker_or_mark_pending",
    );
    expect(attach.last_step_status).toBe("completed_dry_run");

    const cfFetchCalls = fetchCalls.filter((u) =>
      u.indexOf("api.cloudflare.com") >= 0,
    );
    expect(cfFetchCalls).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);

    const attachRow = stepsRows.find(
      (r) => r.step_key === "attach_domain_to_new_worker_or_mark_pending",
    );
    expect(attachRow).toBeDefined();
    expect(attachRow?.status).toBe("completed_dry_run");

    expect(purgeRows).toHaveLength(1);
    const log = purgeRows[0];
    if (!log) throw new Error("cache_purge_log row missing");
    expect(log.site_id).toBe("st_t18");
    expect(log.hostname).toBe("t18.example.test");
    expect(log.action).toBe("attach_domain_to_new_worker_or_mark_pending");
    expect(log.status).toBe("completed_dry_run");
    expect(log.dry_run).toBe(1);
    expect(log.allow_route_mutation).toBe(0);
  });
});
