import { describe, it, expect } from "vitest";
import admin from "../src/admin/router";
import { STEP_KEYS, TOTAL_STEPS } from "../src/site-provisioning";
import type { Env } from "../src/env";

// T17 / Phase 3: site-provisioning runner behavioral AC (T17.AC2),
// extended by rescue-2 T34 (D1).
//
// GIVEN a pending site_creation_jobs row (status='pending',
// current_step_index=0), WHEN POST /api/admin/sites/:id/provision/next is
// invoked TOTAL_STEPS times in sequence, THEN each call advances exactly
// one step, persists per-step input/output/status to
// site_creation_job_steps with attempt_count incremented, returns 200
// with the {current_step, status} envelope, and the final response
// returns status='completed'.
//
// T34 additions:
//   - T34.AC1: STEP_KEYS.length === 16 and STEP_KEYS[15] ===
//     'update_launch_readiness' (canonical suffix-free names).
//   - T34.AC3: POST /api/admin/sites INSERTs site_creation_jobs with
//     total_steps bound to TOTAL_STEPS (16), and the runner defensively
//     re-syncs stale rows (total_steps=15 from the pre-T34 era /
//     migration 0002 DEFAULT) + completes overrun pointers instead of
//     throwing no_step_at_index.

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
    // T9: AI generators validate the configured model against the
    // supported set in api/src/ai/models.ts. Pre-T9 stubs ignored the
    // env, so a placeholder "gpt-test" worked; now we must use the
    // canonical model slugs from T1.
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    ...overrides,
  };
}

// In-memory D1 fake: tracks the single (job, step) pair we care about so
// the runner sees consistent state across the sequential POSTs. Only
// the SQL shapes the runner actually issues are modelled. T34 also
// models the POST /api/admin/sites create flow (verticals lookup,
// domains-uniqueness check, the three INSERTs) so the create-site job
// INSERT's total_steps bind is observable, and exposes `job` so tests
// can seed stale pre-T34 rows.
interface FakeJob {
  id: string;
  site_id: string;
  status: string;
  current_step_index: number;
  total_steps: number;
}

function makeFakeDb(initialJob: {
  id: string;
  site_id: string;
}): {
  db: D1Database;
  calls: RecordedCall[];
  stepsRows: StepRow[];
  job: FakeJob;
} {
  const job: FakeJob = {
    id: initialJob.id,
    site_id: initialJob.site_id,
    status: "pending",
    current_step_index: 0,
    total_steps: TOTAL_STEPS,
  };
  const stepsRows: StepRow[] = [];
  const calls: RecordedCall[] = [];
  // T9: site-provisioning AI generators (called from the 6 swapped
  // steps starting at index 5) touch ai_generations + site_settings +
  // pages + articles + media. The runner test only needs them to
  // succeed (so the runner advances); per-step assertions live in the
  // T9 integration test (site-provisioning-ai-integration.test.ts).
  const aiGenerations = new Map<string, { id: string; status: string; parsed_json: string | null }>();
  let nextAiId = 1;
  let nextMediaId = 1;
  // rescue-2 T38: run_site_smoke_tests COUNT-reads articles,
  // site_settings, and pages — track the content-table writes (deduped
  // on the real UNIQUE keys) so those reads observe genuine step
  // side-effects instead of nulls.
  const articles: Array<{
    site_id: string;
    slug: string;
    status: string;
    published_at: number | null;
  }> = [];
  const settings: Array<{ site_id: string; key: string }> = [];
  const pages: Array<{ site_id: string; slug: string }> = [];
  // rescue-4: per-article work units the chunked steps process one-at-a-time.
  const articleUnits: Array<{
    site_id: string;
    unit_index: number;
    slug: string;
    title: string | null;
    summary: string | null;
    text_status: string;
    image_status: string;
    article_id: string | null;
    attempt_count: number;
  }> = [];

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
          if (sql.indexOf("FROM verticals WHERE slug = ?") >= 0) {
            // T34 create-site flow: the requested vertical exists.
            return ({ slug: captured[0] } as unknown) as T;
          }
          if (sql.indexOf("FROM domains WHERE hostname = ?") >= 0) {
            // T34 create-site flow: hostname not yet attached anywhere.
            return null;
          }
          if (
            sql.indexOf("FROM sites WHERE id = ?") >= 0 &&
            sql.indexOf("vertical_slug") >= 0
          ) {
            return ({
              id: job.site_id,
              name: job.site_id,
              domain: `${job.site_id}.example`,
              vertical_slug: "general",
            } as unknown) as T;
          }
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
          if (sql.indexOf("FROM ai_generations WHERE idempotency_key = ?") >= 0) {
            const [key] = captured as [string];
            const row = aiGenerations.get(key);
            return (row as unknown) as T | null;
          }
          if (
            sql.indexOf("INSERT INTO media") >= 0 &&
            sql.indexOf("RETURNING id") >= 0
          ) {
            // T9 image generator inserts and returns the new media id.
            // With no OPENAI_API_KEY (this test runs without one) the
            // image generator short-circuits before this branch, so
            // returning a synthetic id is safe.
            return ({ id: nextMediaId++ } as unknown) as T;
          }
          // rescue-2 T38 smoke-step COUNT reads — answered from tracked state.
          if (sql.indexOf("SELECT COUNT(*) AS published_count FROM articles") >= 0) {
            const [site_id] = captured as [string];
            const published_count = articles.filter(
              (a) =>
                a.site_id === site_id &&
                a.status === "published" &&
                a.published_at !== null,
            ).length;
            return ({ published_count } as unknown) as T;
          }
          if (sql.indexOf("SELECT COUNT(*) AS settings_count FROM site_settings") >= 0) {
            const [site_id] = captured as [string];
            const settings_count = settings.filter(
              (r) => r.site_id === site_id,
            ).length;
            return ({ settings_count } as unknown) as T;
          }
          if (sql.indexOf("SELECT COUNT(*) AS pages_count FROM pages") >= 0) {
            const [site_id] = captured as [string];
            const pages_count = pages.filter(
              (p) => p.site_id === site_id,
            ).length;
            return ({ pages_count } as unknown) as T;
          }
          // rescue-4: provisioning_article_units reads
          if (sql.indexOf("COUNT(*) AS unit_count FROM provisioning_article_units") >= 0) {
            const [site_id] = captured as [string];
            const unit_count = articleUnits.filter((u) => u.site_id === site_id).length;
            return ({ unit_count } as unknown) as T;
          }
          if (sql.indexOf("FROM provisioning_article_units") >= 0 && sql.indexOf("text_status = 'pending'") >= 0) {
            const [site_id] = captured as [string];
            const u = articleUnits
              .filter((x) => x.site_id === site_id && x.text_status === "pending")
              .sort((a, b) => a.unit_index - b.unit_index)[0];
            return (u ? { ...u } : null) as unknown as T | null;
          }
          if (sql.indexOf("FROM provisioning_article_units") >= 0 && sql.indexOf("image_status = 'pending'") >= 0) {
            const [site_id] = captured as [string];
            const u = articleUnits
              .filter(
                (x) =>
                  x.site_id === site_id &&
                  x.image_status === "pending" &&
                  x.article_id !== null,
              )
              .sort((a, b) => a.unit_index - b.unit_index)[0];
            return (u ? { ...u } : null) as unknown as T | null;
          }
          if (sql.indexOf("SELECT id, slug, title FROM articles WHERE site_id = ? AND slug = ?") >= 0) {
            const [site_id, slug] = captured as [string, string];
            const a = articles.find((x) => x.site_id === site_id && x.slug === slug);
            const u = articleUnits.find((x) => x.site_id === site_id && x.article_id === slug);
            return (a ? { id: u?.unit_index ?? 0, slug: a.slug, title: a.slug } : null) as unknown as T | null;
          }
          return null;
        },
        async run() {
          calls.push({ sql, binds: captured });
          if (sql.indexOf("INSERT INTO site_creation_jobs") >= 0) {
            // T34 create-site flow: adopt the inserted row as THE job so
            // the inline run-to-completion loop sees it.
            const [id, site_id, , total_steps] = captured as [
              string,
              string,
              string | null,
              number,
            ];
            job.id = id;
            job.site_id = site_id;
            job.status = "pending";
            job.current_step_index = 0;
            job.total_steps = total_steps;
          } else if (sql.indexOf("INSERT INTO site_creation_job_steps") >= 0) {
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
            const [status, output, errorMsg, job_id, step_key] = captured as [
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
              void errorMsg;
            }
          } else if (
            sql.indexOf("UPDATE site_creation_jobs SET total_steps = ?") >= 0
          ) {
            // T34 stale-job guard: re-sync of a pre-16-step row.
            const [total_steps] = captured as [number, string];
            job.total_steps = total_steps;
          } else if (
            sql.indexOf(
              "UPDATE site_creation_jobs SET status = 'completed', current_step_index = ?",
            ) >= 0
          ) {
            // T34 stale-job guard: defensive completion of an overrun pointer.
            const [current_step_index] = captured as [number, string];
            job.current_step_index = current_step_index;
            job.status = "completed";
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
          } else if (sql.indexOf("INSERT INTO ai_generations") >= 0) {
            const [id, , , , , , idempotency_key] = captured as [
              string, string | null, string, string, string, string, string,
            ];
            if (!aiGenerations.has(idempotency_key)) {
              aiGenerations.set(idempotency_key, {
                id, status: "pending", parsed_json: null,
              });
              nextAiId += 1;
            }
          } else if (
            sql.indexOf("UPDATE ai_generations SET status = 'fallback'") >= 0
          ) {
            const [parsed_json, , , , key] = captured as [
              string, string | null, string | null, string | null, string,
            ];
            const row = aiGenerations.get(key);
            if (row) {
              row.status = "fallback";
              row.parsed_json = parsed_json;
            }
          } else if (
            sql.indexOf("UPDATE ai_generations SET status = 'success'") >= 0
          ) {
            const [, parsed_json, , , key] = captured as [
              string, string, string | null, string | null, string,
            ];
            const row = aiGenerations.get(key);
            if (row) {
              row.status = "success";
              row.parsed_json = parsed_json;
            }
          } else if (
            sql.indexOf("UPDATE ai_generations SET status = 'failed'") >= 0
          ) {
            const [, error_message, key] = captured as [string, string, string];
            const row = aiGenerations.get(key);
            if (row) {
              row.status = "failed";
              void error_message;
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO site_settings") >= 0) {
            // rescue-2 T38: create_site_settings 12-key seed tracked so
            // the smoke step's settings COUNT observes it.
            const [site_id, key] = captured as [string, string];
            if (!settings.some((s) => s.site_id === site_id && s.key === key)) {
              settings.push({ site_id, key });
            }
          } else if (
            sql.indexOf("INSERT INTO site_settings") >= 0 &&
            sql.indexOf("ON CONFLICT(site_id, key)") >= 0
          ) {
            const [site_id, key] = captured as [string, string];
            if (!settings.some((s) => s.site_id === site_id && s.key === key)) {
              settings.push({ site_id, key });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO pages") >= 0) {
            // generate_about_page — slug 'about' is a SQL literal.
            const [site_id] = captured as [string];
            if (!pages.some((p) => p.site_id === site_id && p.slug === "about")) {
              pages.push({ site_id, slug: "about" });
            }
          } else if (
            sql.indexOf("INSERT INTO pages") >= 0 &&
            sql.indexOf("ON CONFLICT(site_id, slug)") >= 0
          ) {
            const [site_id, slug] = captured as [string, string];
            if (!pages.some((p) => p.site_id === site_id && p.slug === slug)) {
              pages.push({ site_id, slug });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO articles") >= 0) {
            // starter rows: status='published', published_at omitted —
            // publish_starter_articles backfills it below.
            const [site_id, slug] = captured as [string, string];
            if (!articles.some((a) => a.site_id === site_id && a.slug === slug)) {
              articles.push({ site_id, slug, status: "published", published_at: null });
            }
          } else if (sql.indexOf("UPDATE articles SET status = 'published'") >= 0) {
            const [site_id] = captured as [string];
            for (const a of articles) {
              if (a.site_id === site_id && a.published_at === null) {
                a.published_at = 1_700_000_000;
              }
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO provisioning_article_units") >= 0) {
            const [site_id, unit_index, slug, title, summary] = captured as [
              string, number, string, string, string,
            ];
            if (!articleUnits.some((u) => u.site_id === site_id && u.unit_index === unit_index)) {
              articleUnits.push({
                site_id, unit_index, slug, title, summary,
                text_status: "pending", image_status: "pending",
                article_id: null, attempt_count: 0,
              });
            }
          } else if (sql.indexOf("UPDATE provisioning_article_units SET text_status = 'done'") >= 0) {
            const [article_id, site_id, unit_index] = captured as [string, string, number];
            const u = articleUnits.find((x) => x.site_id === site_id && x.unit_index === unit_index);
            if (u) {
              u.text_status = "done";
              u.article_id = article_id;
            }
          } else if (sql.indexOf("UPDATE provisioning_article_units SET image_status = 'done'") >= 0) {
            const [site_id, unit_index] = captured as [string, number];
            const u = articleUnits.find((x) => x.site_id === site_id && x.unit_index === unit_index);
            if (u) u.image_status = "done";
          } else if (sql.indexOf("UPDATE provisioning_article_units SET attempt_count = ?") >= 0) {
            const attempts = captured[0] as number;
            const unit_index = captured[captured.length - 1] as number;
            const site_id = captured[captured.length - 2] as string;
            const u = articleUnits.find((x) => x.site_id === site_id && x.unit_index === unit_index);
            if (u) {
              u.attempt_count = attempts;
              if (sql.indexOf("text_status = 'failed'") >= 0) u.text_status = "failed";
              if (sql.indexOf("image_status = 'failed'") >= 0) u.image_status = "failed";
            }
          }
          // Remaining UPDATE site_settings / articles shapes stay no-op
          // for the runner test (which only cares that each step's
          // handler returns 'completed').
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          // BATCHED-UNIT-ALL (rescue-4 v2): model selectPendingUnitBatch's .all() query.
          if (sql.indexOf("FROM provisioning_article_units") >= 0 && sql.indexOf("text_status = 'pending'") >= 0) {
            const __sid = captured[0] as string;
            const __lim = Number(captured[captured.length - 1]) || 100;
            const __rows = articleUnits
              .filter((x) => x.site_id === __sid && x.text_status === "pending")
              .sort((a, b) => a.unit_index - b.unit_index)
              .slice(0, __lim);
            return { results: __rows as unknown as T[], success: true, meta: {} };
          }
          if (sql.indexOf("FROM provisioning_article_units") >= 0 && sql.indexOf("image_status = 'pending'") >= 0) {
            const __sid = captured[0] as string;
            const __lim = Number(captured[captured.length - 1]) || 100;
            const __rows = articleUnits
              .filter((x) => x.site_id === __sid && x.image_status === "pending" && x.article_id !== null)
              .sort((a, b) => a.unit_index - b.unit_index)
              .slice(0, __lim);
            return { results: __rows as unknown as T[], success: true, meta: {} };
          }

          calls.push({ sql, binds: captured });
          // T9: generate_or_assign_article_images queries this
          // table; returning an empty list is fine (the step then
          // returns 'completed' with article_count=0).
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, calls, stepsRows, job };
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
    // resolve 'completed'. The one-step-per-call invariant this test was
    // written for is unchanged by the T34 16-key registry.
    const okStatuses = new Set(["completed", "completed_dry_run"]);
    const okOrInProgress = new Set(["completed", "completed_dry_run", "in_progress"]);
    // rescue-4: one step completes per POST EXCEPT the two chunked per-article
    // steps, which return in_progress (same step, pointer unchanged) once per
    // unit. POST until the job is 'completed'; the distinct step keys that
    // complete, in pointer order, MUST be the 16 registry steps.
    const completedStepKeys: string[] = [];
    let lastIndex = 0;
    let guard = 0;
    const MAX_POSTS = TOTAL_STEPS + 2 * 15 + 5;
    for (;;) {
      if (guard++ > MAX_POSTS) throw new Error("provision/next did not converge");
      const res = await admin.request(
        "/api/admin/sites/st_t17/provision/next",
        { method: "POST", headers: { "content-type": "application/json" } },
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as AdvanceBody;
      expect(body.total_steps).toBe(TOTAL_STEPS);
      expect(okOrInProgress.has(body.last_step_status)).toBe(true);
      expect(body.current_step_index).toBeGreaterThanOrEqual(lastIndex);
      if (body.last_step_status !== "in_progress") {
        completedStepKeys.push(body.current_step);
        lastIndex = body.current_step_index;
      }
      if (body.status === "completed") {
        expect(body.completed).toBe(true);
        break;
      }
      expect(body.status).toBe("running");
      expect(body.completed).toBe(false);
    }
    expect(completedStepKeys).toEqual([...STEP_KEYS]);

    // One step row per distinct step key (in_progress re-runs the SAME key,
    // never writing a new row), in registry order, all terminal-completed.
    expect(stepsRows).toHaveLength(TOTAL_STEPS);
    for (let i = 0; i < TOTAL_STEPS; i++) {
      const row = stepsRows[i];
      if (!row) throw new Error(`missing step row at index ${i}`);
      expect(row.step_key).toBe(STEP_KEYS[i]);
      expect(row.step_order).toBe(i);
      expect(okStatuses.has(row.status)).toBe(true);
      // rescue-4: chunked steps re-upsert their row once per unit → >= 1.
      expect(row.attempt_count).toBeGreaterThanOrEqual(1);
      expect(row.input).not.toBeNull();
      expect(row.output).not.toBeNull();
    }
  });

});

describe("site-provisioning 16-step registry + stale-job guard (T34)", () => {
  // T34.AC1 — the registry exposes exactly 16 canonical (suffix-free)
  // step keys, ending with update_launch_readiness at index 15.
  it("STEP_KEYS has 16 canonical names with update_launch_readiness at index 15", () => {
    expect(STEP_KEYS.length).toBe(16);
    expect(TOTAL_STEPS).toBe(16);
    expect(STEP_KEYS[15]).toBe("update_launch_readiness");
    for (const key of STEP_KEYS) {
      expect(key.endsWith("_stub")).toBe(false);
    }
    // No duplicate keys.
    expect(new Set(STEP_KEYS).size).toBe(16);
  });

  // T34.AC3 (INSERT leg) — POST /api/admin/sites binds total_steps from
  // the live registry constant, so the site_creation_jobs row is minted
  // with 16, and the inline run-to-completion walks all 16 steps.
  it("POST /api/admin/sites INSERTs site_creation_jobs with total_steps=TOTAL_STEPS (16)", async () => {
    const { db, calls, stepsRows, job } = makeFakeDb({
      id: "job_seed_unused",
      site_id: "st_seed_unused",
    });
    const env = buildEnv(db);
    const res = await admin.request(
      "/api/admin/sites",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          domain: "t34-canonical.example",
          vertical_slug: "general",
          activity: "main",
          name: "T34 Canonical",
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const jobInsert = calls.find(
      (c) => c.sql.indexOf("INSERT INTO site_creation_jobs") >= 0,
    );
    expect(jobInsert).toBeDefined();
    expect(jobInsert?.binds[3]).toBe(TOTAL_STEPS);
    expect(jobInsert?.binds[3]).toBe(16);
    // The inline run-to-completion drove the freshly-minted job through
    // every registered step, finishing on update_launch_readiness.
    expect(job.status).toBe("completed");
    expect(stepsRows).toHaveLength(TOTAL_STEPS);
    expect(stepsRows[TOTAL_STEPS - 1]?.step_key).toBe(
      "update_launch_readiness",
    );
  });

  // T34.AC3 (guard leg, re-sync) — a stale pre-T34 row (total_steps=15)
  // is re-synced to the live registry length on the next advance.
  it("re-syncs a stale total_steps=15 job row to 16 on advance", async () => {
    const { db, calls, job } = makeFakeDb({
      id: "job_stale",
      site_id: "st_stale",
    });
    job.status = "running";
    job.current_step_index = 3;
    job.total_steps = 15;
    const env = buildEnv(db);
    const res = await admin.request(
      "/api/admin/sites/st_stale/provision/next",
      { method: "POST", headers: { "content-type": "application/json" } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      total_steps: number;
      current_step: string;
      status: string;
    };
    expect(body.total_steps).toBe(16);
    expect(body.current_step).toBe(STEP_KEYS[3]);
    expect(body.status).toBe("running");
    const resync = calls.find(
      (c) =>
        c.sql.indexOf("UPDATE site_creation_jobs SET total_steps = ?") >= 0,
    );
    expect(resync).toBeDefined();
    expect(resync?.binds[0]).toBe(16);
    expect(job.total_steps).toBe(16);
  });

  // T34.AC3 (guard leg, overrun) — a non-terminal job whose pointer ran
  // past the registry end is defensively completed instead of the
  // runner throwing no_step_at_index (HTTP 500).
  it("completes a running job with an overrun step pointer instead of erroring", async () => {
    const { db, job, stepsRows } = makeFakeDb({
      id: "job_overrun",
      site_id: "st_overrun",
    });
    job.status = "running";
    job.current_step_index = TOTAL_STEPS;
    const env = buildEnv(db);
    const res = await admin.request(
      "/api/admin/sites/st_overrun/provision/next",
      { method: "POST", headers: { "content-type": "application/json" } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      completed: boolean;
      current_step_index: number;
      last_step_status: string | null;
    };
    expect(body.status).toBe("completed");
    expect(body.completed).toBe(true);
    expect(body.current_step_index).toBe(TOTAL_STEPS);
    expect(body.last_step_status).toBeNull();
    // Defensive completion writes NO new step receipt.
    expect(stepsRows).toHaveLength(0);
    expect(job.status).toBe("completed");
  });
});
