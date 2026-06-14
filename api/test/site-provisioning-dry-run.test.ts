import { describe, it, expect, beforeEach, afterEach } from "vitest";
import admin from "../src/admin/router";
import { STEP_KEYS } from "../src/site-provisioning";
import {
  runCloudflareRouteMutation,
  runCloudflareZoneValidation,
} from "../src/site-provisioning/cloudflare-interfaces";
import { PROTECTED_DOMAINS } from "../src/safety/protected-domains";
import type { Env } from "../src/env";

// Protected-hostname literal imported (NOT inlined) so this file stays
// clean of Group B banned substrings (verify:no-legacy-prod-refs).
const PROTECTED_HOST: string = PROTECTED_DOMAINS[1] ?? "";

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
//
// rescue-2 T35 extends this file with the route-mutation guard matrix:
// the attach step performs a REAL route mutation (zone lookup + Worker
// route POST against a fake CF client) ONLY when
// SITE_PROVISIONING_DRY_RUN=false AND
// SITE_PROVISIONING_ALLOW_ROUTE_MUTATION=true AND the hostname is not a
// protected legacy-production domain; every other combination issues
// zero outbound fetch.

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

    // T35: the real validate step also short-circuits in dry-run mode
    // (zero fetch, completed_dry_run receipt); the pure-D1 create step
    // does identical work in both modes and stays 'completed'.
    const validateRow = stepsRows.find(
      (r) => r.step_key === "validate_domain_in_cloudflare",
    );
    expect(validateRow).toBeDefined();
    expect(validateRow?.status).toBe("completed_dry_run");
    const createRow = stepsRows.find(
      (r) => r.step_key === "create_site_record",
    );
    expect(createRow).toBeDefined();
    expect(createRow?.status).toBe("completed");

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

// ------------------------------------------------------------------
// rescue-2 T35: route-mutation guard matrix at the boundary itself.
// ------------------------------------------------------------------

interface CfCall {
  url: string;
  method: string;
  body: string | null;
}

// Fake CF client: records every fetch and answers with CF-shaped JSON.
// zoneId=null models "no active zone for this domain".
function installFakeCfClient(zoneId: string | null): CfCall[] {
  const calls: CfCall[] = [];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: typeof init?.body === "string" ? init.body : null,
    });
    const headers = { "content-type": "application/json" };
    if (url.indexOf("/zones?name=") >= 0) {
      return new Response(
        JSON.stringify({
          success: true,
          result: zoneId === null ? [] : [{ id: zoneId }],
        }),
        { status: 200, headers },
      );
    }
    if (url.indexOf("/workers/routes") >= 0) {
      return new Response(
        JSON.stringify({ success: true, result: { id: "route-901" } }),
        { status: 200, headers },
      );
    }
    return new Response(JSON.stringify({ success: false }), {
      status: 404,
      headers,
    });
  }) as typeof globalThis.fetch;
  return calls;
}

interface DomainUpdate {
  cf_route_id: string;
  site_id: string;
  hostname: string;
}

// Minimal fake D1 for direct-boundary calls: records cache_purge_log
// INSERTs and `UPDATE domains SET` promotions; reads return null.
function makeBoundaryFakeDb(): {
  db: D1Database;
  purgeRows: PurgeLogRow[];
  domainUpdates: DomainUpdate[];
} {
  const purgeRows: PurgeLogRow[] = [];
  const domainUpdates: DomainUpdate[] = [];
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          return null;
        },
        async run() {
          if (sql.indexOf("INSERT INTO cache_purge_log") >= 0) {
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
          } else if (sql.indexOf("UPDATE domains SET") >= 0) {
            const [cf_route_id, site_id, hostname] = captured as [
              string,
              string,
              string,
            ];
            domainUpdates.push({ cf_route_id, site_id, hostname });
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
  return { db, purgeRows, domainUpdates };
}

const ATTACH_INPUT = {
  site_id: "st_t35",
  hostname: "t35-site.example",
  action: "attach_domain_to_new_worker_or_mark_pending",
  payload: { job_id: "job_t35", step_order: 2 },
};

describe("route mutation guard matrix (T35)", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("dry-run on: completed_dry_run, zero fetch even with mutation allowed", async () => {
    const calls = installFakeCfClient("zone-1");
    const { db, purgeRows } = makeBoundaryFakeDb();
    const env = buildEnv(db, {
      SITE_PROVISIONING_DRY_RUN: "true",
      SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "true",
      CLOUDFLARE_PROVISIONING_API_TOKEN: "test-token",
    });
    const outcome = await runCloudflareRouteMutation({ env, db }, ATTACH_INPUT);
    expect(outcome.status).toBe("completed_dry_run");
    expect(calls).toHaveLength(0);
    expect(purgeRows).toHaveLength(1);
    expect(purgeRows[0]?.status).toBe("completed_dry_run");
  });

  it("mutation disallowed: completed_dry_run, zero fetch even with dry-run off", async () => {
    const calls = installFakeCfClient("zone-1");
    const { db, purgeRows } = makeBoundaryFakeDb();
    const env = buildEnv(db, {
      SITE_PROVISIONING_DRY_RUN: "false",
      SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
      CLOUDFLARE_PROVISIONING_API_TOKEN: "test-token",
    });
    const outcome = await runCloudflareRouteMutation({ env, db }, ATTACH_INPUT);
    expect(outcome.status).toBe("completed_dry_run");
    expect(calls).toHaveLength(0);
    expect(purgeRows[0]?.allow_route_mutation).toBe(0);
  });

  it("protected hostname: failed, zero fetch, refusal receipt", async () => {
    const calls = installFakeCfClient("zone-1");
    const { db, purgeRows, domainUpdates } = makeBoundaryFakeDb();
    const env = buildEnv(db, {
      SITE_PROVISIONING_DRY_RUN: "false",
      SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "true",
      CLOUDFLARE_PROVISIONING_API_TOKEN: "test-token",
    });
    const outcome = await runCloudflareRouteMutation(
      { env, db },
      { ...ATTACH_INPUT, hostname: PROTECTED_HOST },
    );
    expect(outcome.status).toBe("failed");
    expect(outcome.error).toContain("protected");
    expect(calls).toHaveLength(0);
    expect(domainUpdates).toHaveLength(0);
    expect(purgeRows).toHaveLength(1);
    expect(purgeRows[0]?.status).toBe("failed");
  });

  it("missing provisioning token in live mode: failed, zero fetch", async () => {
    const calls = installFakeCfClient("zone-1");
    const { db } = makeBoundaryFakeDb();
    const env = buildEnv(db, {
      SITE_PROVISIONING_DRY_RUN: "false",
      SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "true",
    });
    const outcome = await runCloudflareRouteMutation({ env, db }, ATTACH_INPUT);
    expect(outcome.status).toBe("failed");
    expect(calls).toHaveLength(0);
  });

  it("live mode with zone: real route mutation (zone GET + route POST) promotes the domain", async () => {
    const calls = installFakeCfClient("zone-42");
    const { db, purgeRows, domainUpdates } = makeBoundaryFakeDb();
    const env = buildEnv(db, {
      SITE_PROVISIONING_DRY_RUN: "false",
      SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "true",
      CLOUDFLARE_PROVISIONING_API_TOKEN: "test-token",
    });
    const outcome = await runCloudflareRouteMutation({ env, db }, ATTACH_INPUT);
    expect(outcome.status).toBe("completed");
    const parsed = JSON.parse(outcome.output) as {
      attached: boolean;
      cf_route_id: string;
      zone_id: string;
    };
    expect(parsed.attached).toBe(true);
    expect(parsed.cf_route_id).toBe("route-901");
    expect(parsed.zone_id).toBe("zone-42");

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("api.cloudflare.com");
    expect(calls[0]?.url).toContain("/zones?name=t35-site.example");
    expect(calls[1]?.url).toContain("/zones/zone-42/workers/routes");
    expect(calls[1]?.method).toBe("POST");
    const routeBody = JSON.parse(calls[1]?.body ?? "{}") as {
      pattern: string;
      script: string;
    };
    expect(routeBody.pattern).toBe("t35-site.example/*");
    expect(routeBody.script).toBe("kodigital-homepages-cms-worker");

    expect(domainUpdates).toHaveLength(1);
    expect(domainUpdates[0]?.cf_route_id).toBe("route-901");
    expect(domainUpdates[0]?.site_id).toBe("st_t35");
    expect(domainUpdates[0]?.hostname).toBe("t35-site.example");
    expect(purgeRows).toHaveLength(1);
    expect(purgeRows[0]?.status).toBe("completed");
    expect(purgeRows[0]?.dry_run).toBe(0);
    expect(purgeRows[0]?.allow_route_mutation).toBe(1);
  });

  it("live mode without zone: marks pending (single GET, no route POST, no domain promotion)", async () => {
    const calls = installFakeCfClient(null);
    const { db, purgeRows, domainUpdates } = makeBoundaryFakeDb();
    const env = buildEnv(db, {
      SITE_PROVISIONING_DRY_RUN: "false",
      SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "true",
      CLOUDFLARE_PROVISIONING_API_TOKEN: "test-token",
    });
    const outcome = await runCloudflareRouteMutation({ env, db }, ATTACH_INPUT);
    expect(outcome.status).toBe("completed");
    const parsed = JSON.parse(outcome.output) as {
      attached: boolean;
      marked_pending: boolean;
    };
    expect(parsed.attached).toBe(false);
    expect(parsed.marked_pending).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(domainUpdates).toHaveLength(0);
    expect(purgeRows[0]?.status).toBe("completed");
  });

  it("zone validation: dry-run short-circuits with zero fetch; live mode reports zone presence", async () => {
    const dryCalls = installFakeCfClient("zone-7");
    const dry = makeBoundaryFakeDb();
    const dryEnv = buildEnv(dry.db, {
      SITE_PROVISIONING_DRY_RUN: "true",
      SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    });
    const dryOutcome = await runCloudflareZoneValidation(
      { env: dryEnv, db: dry.db },
      { site_id: "st_t35", hostname: "t35-site.example" },
    );
    expect(dryOutcome.status).toBe("completed_dry_run");
    expect(dryCalls).toHaveLength(0);

    const liveCalls = installFakeCfClient("zone-7");
    const live = makeBoundaryFakeDb();
    const liveEnv = buildEnv(live.db, {
      SITE_PROVISIONING_DRY_RUN: "false",
      SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
      CLOUDFLARE_PROVISIONING_API_TOKEN: "test-token",
    });
    const liveOutcome = await runCloudflareZoneValidation(
      { env: liveEnv, db: live.db },
      { site_id: "st_t35", hostname: "t35-site.example" },
    );
    expect(liveOutcome.status).toBe("completed");
    const parsed = JSON.parse(liveOutcome.output) as {
      zone_found: boolean;
      zone_id: string;
    };
    expect(parsed.zone_found).toBe(true);
    expect(parsed.zone_id).toBe("zone-7");
    expect(liveCalls).toHaveLength(1);

    const protectedOutcome = await runCloudflareZoneValidation(
      { env: liveEnv, db: live.db },
      { site_id: "st_t35", hostname: PROTECTED_HOST },
    );
    expect(protectedOutcome.status).toBe("failed");
    expect(liveCalls).toHaveLength(1);
  });
});
