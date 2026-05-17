import { describe, it, expect, beforeEach, afterEach } from "vitest";
import admin from "../src/admin/router";
import { STEP_KEYS, TOTAL_STEPS } from "../src/site-provisioning";
import type { Env } from "../src/env";

// T12 / Phase 3 perfect-recovery: fetch-interceptor proof that the
// 15-step provisioning runner makes ZERO outbound calls to
// api.cloudflare.com when SITE_PROVISIONING_DRY_RUN='true', AND that at
// least one cache_purge_log row is persisted with dry_run=1 as the
// receipt of the dry-run side-channel.
//
// T12.AC1 (test_name_regex) — top-level describe + it titles must
// substring-match `provisioning runner does not call api.cloudflare.com
// when SITE_PROVISIONING_DRY_RUN=true`. The fetch spy throws on ANY
// call, so a regression that adds a fetch() to the runner surfaces as
// a thrown Error (not a silent missed assertion).
//
// T12.AC2 — cache_purge_log COUNT(*) WHERE dry_run=1 >= 1. The fake D1
// below records every INSERT INTO cache_purge_log call so the test can
// count dry_run=1 rows directly without a real D1.

interface StepRow {
  job_id: string;
  step_key: string;
  step_order: number;
  status: string;
  attempt_count: number;
  input: string | null;
  output: string | null;
}
interface PageRow { site_id: string; slug: string; page_type: string }
interface SettingRow { site_id: string; key: string; value: string }
interface PurgeLogRow {
  site_id: string;
  hostname: string;
  action: string;
  status: string;
  dry_run: number;
  allow_route_mutation: number;
}

function buildEnv(db: D1Database): Env {
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
  };
}

// Mini D1 fake modelled on provisioning-runner.test.ts. Honours
// (job_id, step_key) and (site_id, slug) UNIQUE so the runner walks all
// 15 steps cleanly; records every cache_purge_log INSERT for assertion.
function makeFakeDb(initial: {
  site_id: string;
  site_name: string;
  domain: string;
  job_id: string;
}) {
  const job = {
    id: initial.job_id,
    site_id: initial.site_id,
    status: "pending" as string,
    current_step_index: 0,
    total_steps: TOTAL_STEPS,
  };
  const stepsRows: StepRow[] = [];
  const pages: PageRow[] = [];
  const settings: SettingRow[] = [];
  const purgeLog: PurgeLogRow[] = [];
  const legalTemplates: Record<string, { title: string; content_html: string }> = {
    "privacy-policy": { title: "Privacy for {{site_name}}", content_html: "<p>Privacy for {{site_name}}.</p>" },
    terms: { title: "Terms for {{site_name}}", content_html: "<p>Terms for {{site_name}}.</p>" },
    "do-not-sell": { title: "Do Not Sell — {{site_name}}", content_html: "<p>Do not sell {{site_name}}.</p>" },
    contact: { title: "Contact {{site_name}}", content_html: "<p>Contact {{contact_email}}.</p>" },
  };

  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.indexOf("FROM sites WHERE id = ?") >= 0 && sql.indexOf("SELECT id ") >= 0) {
            const [id] = captured as [string];
            return id === initial.site_id ? ({ id } as unknown as T) : null;
          }
          if (sql.indexOf("SELECT name, domain FROM sites WHERE id = ?") >= 0) {
            return ({ name: initial.site_name, domain: initial.domain } as unknown as T);
          }
          if (sql.indexOf("SELECT primary_domain AS hostname FROM sites") >= 0) {
            return ({ hostname: initial.domain } as unknown as T);
          }
          if (sql.indexOf("FROM site_creation_jobs WHERE site_id = ?") >= 0) {
            return ({
              id: job.id,
              site_id: job.site_id,
              status: job.status,
              current_step_index: job.current_step_index,
              total_steps: job.total_steps,
            } as unknown as T);
          }
          if (sql.indexOf("FROM domains WHERE site_id = ?") >= 0) {
            return ({ hostname: initial.domain } as unknown as T);
          }
          if (sql.indexOf("FROM legal_templates") >= 0) {
            const [slug] = captured as [string];
            const tpl = legalTemplates[slug];
            return tpl ? ({ title: tpl.title, content_html: tpl.content_html, content_md: "" } as unknown as T) : null;
          }
          return null;
        },
        async run() {
          if (sql.indexOf("INSERT INTO site_creation_job_steps") >= 0) {
            const [job_id, step_key, step_order, inputJson] = captured as [string, string, number, string];
            const existing = stepsRows.find((r) => r.job_id === job_id && r.step_key === step_key);
            if (existing) {
              existing.status = "running";
              existing.attempt_count += 1;
              existing.input = inputJson;
            } else {
              stepsRows.push({ job_id, step_key, step_order, status: "running", attempt_count: 1, input: inputJson, output: null });
            }
          } else if (sql.indexOf("UPDATE site_creation_job_steps") >= 0) {
            const [status, output, _error, job_id, step_key] = captured as [string, string, string | null, string, string];
            const row = stepsRows.find((r) => r.job_id === job_id && r.step_key === step_key);
            if (row) { row.status = status; row.output = output; }
          } else if (sql.indexOf("UPDATE site_creation_jobs SET") >= 0) {
            const [_current_step, current_step_index, status] = captured as [string, number, string, string | null, string];
            job.current_step_index = current_step_index;
            job.status = status;
          } else if (sql.indexOf("UPDATE sites SET last_provisioned_at") >= 0) {
            // no-op
          } else if (sql.indexOf("INSERT OR IGNORE INTO site_settings") >= 0) {
            const [site_id, key, value] = captured as [string, string, string];
            if (!settings.find((r) => r.site_id === site_id && r.key === key)) {
              settings.push({ site_id, key, value });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO pages") >= 0) {
            const [site_id] = captured as [string];
            if (!pages.find((p) => p.site_id === site_id && p.slug === "about")) {
              pages.push({ site_id, slug: "about", page_type: "about" });
            }
          } else if (sql.indexOf("INSERT INTO pages") >= 0 && sql.indexOf("ON CONFLICT(site_id, slug)") >= 0) {
            const [site_id, slug] = captured as [string, string];
            if (!pages.find((p) => p.site_id === site_id && p.slug === slug)) {
              pages.push({ site_id, slug, page_type: "legal" });
            }
          } else if (sql.indexOf("INSERT INTO cache_purge_log") >= 0) {
            const [
              site_id,
              hostname,
              action,
              status,
              dry_run,
              allow_route_mutation,
            ] = captured as [string, string, string, string, number, number];
            purgeLog.push({ site_id, hostname, action, status, dry_run, allow_route_mutation });
          }
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          if (sql.indexOf("FROM site_settings WHERE site_id = ?") >= 0) {
            const [site_id] = captured as [string];
            const rows = settings.filter(
              (r) => r.site_id === site_id && (r.key === "contact_email" || r.key === "privacy_email"),
            );
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, job, stepsRows, pages, settings, purgeLog };
}

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

describe("provisioning runner does not call api.cloudflare.com when SITE_PROVISIONING_DRY_RUN=true", () => {
  let fetchCalls: Array<string>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    // T12.AC1 fetch spy: any fetch call recorded; api.cloudflare.com
    // targets throw to fail the test loud (rather than silently passing
    // a count assertion). Non-CF URLs are recorded but allowed to no-op
    // — current step handlers never call fetch in dry-run mode.
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      if (url.indexOf("api.cloudflare.com") >= 0) {
        throw new Error(`outbound api.cloudflare.com fetch in dry-run: ${url}`);
      }
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("provisioning runner does not call api.cloudflare.com when SITE_PROVISIONING_DRY_RUN=true (15-step run, cache_purge_log dry_run=1 row)", async () => {
    const SITE_ID = "st_t12";
    const JOB_ID = "job_t12";
    const fake = makeFakeDb({
      site_id: SITE_ID,
      site_name: "T12 Newsroom",
      domain: "t12.example.test",
      job_id: JOB_ID,
    });
    const env = buildEnv(fake.db);

    // Walk the full 15 steps. The Cloudflare-mutation step
    // (attach_domain_to_new_worker_or_mark_pending) sits at a fixed
    // index in STEP_KEYS; the runner routes it through
    // runCloudflareRouteMutation() which short-circuits to
    // completed_dry_run + writes a cache_purge_log row when dry-run is on.
    const ok = new Set(["completed", "completed_dry_run"]);
    for (let i = 0; i < TOTAL_STEPS; i++) {
      const res = await admin.request(
        `/api/admin/sites/${SITE_ID}/provision/next`,
        { method: "POST", headers: { "content-type": "application/json" } },
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as AdvanceBody;
      expect(body.current_step).toBe(STEP_KEYS[i]);
      expect(ok.has(body.last_step_status)).toBe(true);
    }
    expect(fake.job.status).toBe("completed");

    // T12.AC1 — zero fetches targeted api.cloudflare.com across the
    // entire 15-step run. The fetch spy would have thrown if a single
    // call escaped, but we also assert the count for explicitness.
    const cfFetchCalls = fetchCalls.filter((u) => u.indexOf("api.cloudflare.com") >= 0);
    expect(cfFetchCalls).toHaveLength(0);
    // Defensive: in dry-run no fetch of any kind should escape the
    // runner. If a future step starts calling fetch() to a non-CF
    // service this assertion is the canary.
    expect(fetchCalls).toHaveLength(0);

    // T12.AC2 — cache_purge_log COUNT(*) WHERE dry_run=1 >= 1. The
    // attach step writes exactly one such row in dry-run mode; assert
    // the >=1 contract verbatim plus the specific shape (status =
    // completed_dry_run, allow_route_mutation = 0).
    const dryRunRows = fake.purgeLog.filter((r) => r.dry_run === 1);
    expect(dryRunRows.length).toBeGreaterThanOrEqual(1);
    const attachRow = dryRunRows.find(
      (r) => r.action === "attach_domain_to_new_worker_or_mark_pending",
    );
    expect(attachRow).toBeDefined();
    expect(attachRow?.site_id).toBe(SITE_ID);
    expect(attachRow?.hostname).toBe("t12.example.test");
    expect(attachRow?.status).toBe("completed_dry_run");
    expect(attachRow?.allow_route_mutation).toBe(0);
  });

  it("provisioning runner does not call api.cloudflare.com when SITE_PROVISIONING_DRY_RUN=true under re-invocation (idempotent dry-run)", async () => {
    // A second pass over an already-completed job MUST NOT issue any
    // outbound fetch either — short-circuits at the runner before any
    // step handler runs. This guards against a regression where
    // re-entry would call the CF mutation again instead of no-op.
    const SITE_ID = "st_t12_re";
    const JOB_ID = "job_t12_re";
    const fake = makeFakeDb({
      site_id: SITE_ID,
      site_name: "T12 Repeat",
      domain: "t12-repeat.example.test",
      job_id: JOB_ID,
    });
    const env = buildEnv(fake.db);

    for (let i = 0; i < TOTAL_STEPS; i++) {
      const res = await admin.request(
        `/api/admin/sites/${SITE_ID}/provision/next`,
        { method: "POST", headers: { "content-type": "application/json" } },
        env,
      );
      expect(res.status).toBe(200);
    }
    const fetchCallsAfterFirstRun = fetchCalls.length;

    // 16th call: idempotent no-op (job.status='completed').
    const res16 = await admin.request(
      `/api/admin/sites/${SITE_ID}/provision/next`,
      { method: "POST", headers: { "content-type": "application/json" } },
      env,
    );
    expect(res16.status).toBe(200);

    // No new fetch escaped on the re-run; CF-targeting count is still 0.
    expect(fetchCalls).toHaveLength(fetchCallsAfterFirstRun);
    expect(fetchCalls.filter((u) => u.indexOf("api.cloudflare.com") >= 0)).toHaveLength(0);

    // cache_purge_log row count for dry_run=1 is unchanged across the
    // 16th call (no duplicate logging).
    const dryRunRows = fake.purgeLog.filter((r) => r.dry_run === 1);
    expect(dryRunRows.length).toBeGreaterThanOrEqual(1);
    const attachDryRunRows = dryRunRows.filter(
      (r) => r.action === "attach_domain_to_new_worker_or_mark_pending",
    );
    expect(attachDryRunRows).toHaveLength(1);
  });
});
