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
  // rescue-2 T38: finalizeStepRow's output JSON captured so the smoke
  // step's in_process_smoke payload (checks_run/checks_passed) is
  // observable.
  output: string | null;
}

// rescue-2 T36: articles rows tracked by the fake so the
// publish_starter_articles step's publish-state finalization
// (status + published_at + sites.content_version bump) is observable.
interface ArticleRow {
  site_id: string;
  slug: string;
  title: string;
  status: string;
  homepage_section: string;
  published_at: number | null;
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
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    ...overrides,
  };
}

function makeFakeDb(
  initialJob: { id: string; site_id: string },
  // rescue-2 T38 negative path: drop the starter-article INSERTs so the
  // smoke step observes an empty side-effect table and must FAIL.
  opts: { suppressArticleInserts?: boolean } = {},
): {
  db: D1Database;
  stepsRows: StepRow[];
  articles: ArticleRow[];
  settings: Array<{ site_id: string; key: string }>;
  pages: Array<{ site_id: string; slug: string }>;
  site: { content_version: number };
} {
  const job = {
    id: initialJob.id,
    site_id: initialJob.site_id,
    status: "pending",
    current_step_index: 0,
    total_steps: TOTAL_STEPS,
  };
  const stepsRows: StepRow[] = [];
  // Merge-resolution: mission's AI generators read back ai_generations rows
  // by idempotency_key (startGenerationLog -> getGenerationByIdempotencyKey).
  // Track inserts/updates here so the 15-step run can clear AI steps T9-T11.
  const aiGenerations = new Map<string, Record<string, unknown>>();
  // T36: starter articles inserted by generate_15_homepage_articles and
  // finalized by publish_starter_articles; content_version starts at 0
  // (migration 0009 DEFAULT) so the publish bump is observable as 0 -> 1.
  const articles: ArticleRow[] = [];
  const site = { content_version: 0 };
  // T38: site_settings + pages writes tracked (deduped on the same
  // UNIQUE keys the real schema declares) so the smoke step's COUNT
  // reads observe what earlier steps actually inserted.
  const settings: Array<{ site_id: string; key: string }> = [];
  const pages: Array<{ site_id: string; slug: string }> = [];

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
          if (sql.indexOf("FROM ai_generations WHERE idempotency_key = ?") >= 0) {
            const [idempotency_key] = captured as [string];
            return (aiGenerations.get(idempotency_key) ?? null) as unknown as T | null;
          }
          if (sql.indexOf("SELECT COUNT(*) AS published_count FROM articles") >= 0) {
            const [site_id] = captured as [string];
            const published_count = articles.filter(
              (a) =>
                a.site_id === site_id &&
                a.homepage_section === "starter" &&
                a.status === "published" &&
                a.published_at !== null,
            ).length;
            return ({ published_count } as unknown) as T;
          }
          // T38 smoke-step COUNT reads — answered from the tracked
          // settings/pages state so the smoke checks observe real
          // earlier-step side-effects, not canned values.
          if (sql.indexOf("SELECT COUNT(*) AS settings_count FROM site_settings") >= 0) {
            const [site_id] = captured as [string];
            const settings_count = settings.filter(
              (s) => s.site_id === site_id,
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
                output: null,
              });
            }
          } else if (
            sql.indexOf("UPDATE site_creation_job_steps") >= 0
          ) {
            const [status, output, , jobId, step_key] = captured as [
              string,
              string,
              string | null,
              string,
              string,
            ];
            const row = stepsRows.find(
              (r) => r.job_id === jobId && r.step_key === step_key,
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
          } else if (sql.indexOf("INSERT INTO ai_generations") >= 0) {
            const [id, site_id, task, provider, model, prompt_version, idempotency_key, request_json, target_type, target_id] = captured as [string, string | null, string, string, string, string, string, string | null, string | null, string | null];
            if (!aiGenerations.has(idempotency_key)) {
              aiGenerations.set(idempotency_key, { id, site_id, task, provider, model, prompt_version, idempotency_key, request_json, response_json: null, parsed_json: null, status: "pending", target_type, target_id, error_message: null, created_at: 0, updated_at: 0 });
            }
          } else if (sql.indexOf("UPDATE ai_generations") >= 0) {
            const idempotency_key = captured[captured.length - 1] as string;
            const r = aiGenerations.get(idempotency_key);
            if (r) {
              if (sql.indexOf("status = 'success'") >= 0) (r as { status: string }).status = "success";
              else if (sql.indexOf("status = 'failed'") >= 0) (r as { status: string }).status = "failed";
              else if (sql.indexOf("status = 'fallback'") >= 0) (r as { status: string }).status = "fallback";
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO articles") >= 0) {
            // generate_15_homepage_articles: rows land with
            // status='published' but NO published_at (the INSERT omits
            // it) — exactly the gap publish_starter_articles closes.
            // T38 negative path: suppressed inserts leave the table
            // empty so the smoke step must observe 0 rows and fail.
            const [site_id, slug, title] = captured as [string, string, string];
            if (
              !opts.suppressArticleInserts &&
              !articles.some((a) => a.site_id === site_id && a.slug === slug)
            ) {
              articles.push({
                site_id,
                slug,
                title,
                status: "published",
                homepage_section: "starter",
                published_at: null,
              });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO site_settings") >= 0) {
            // create_site_settings 12-key seed (T19) — dedupe on the
            // real (site_id, key) UNIQUE.
            const [site_id, key] = captured as [string, string];
            if (!settings.some((s) => s.site_id === site_id && s.key === key)) {
              settings.push({ site_id, key });
            }
          } else if (
            sql.indexOf("INSERT INTO site_settings") >= 0 &&
            sql.indexOf("ON CONFLICT(site_id, key)") >= 0
          ) {
            // upsertSiteSetting (tagline/description) — same dedupe.
            const [site_id, key] = captured as [string, string];
            if (!settings.some((s) => s.site_id === site_id && s.key === key)) {
              settings.push({ site_id, key });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO pages") >= 0) {
            // generate_about_page: VALUES (?, 'about', ...) — slug is a
            // SQL literal, binds[0] is site_id.
            const [site_id] = captured as [string];
            if (!pages.some((p) => p.site_id === site_id && p.slug === "about")) {
              pages.push({ site_id, slug: "about" });
            }
          } else if (
            sql.indexOf("INSERT INTO pages") >= 0 &&
            sql.indexOf("ON CONFLICT(site_id, slug)") >= 0
          ) {
            // legal-renderer upsert: binds [site_id, slug, ...].
            const [site_id, slug] = captured as [string, string];
            if (!pages.some((p) => p.site_id === site_id && p.slug === slug)) {
              pages.push({ site_id, slug });
            }
          } else if (sql.indexOf("UPDATE articles SET status = 'published'") >= 0) {
            // publish_starter_articles: COALESCE(published_at, unixepoch())
            // — backfill only when NULL, mirroring the real SQL.
            const [site_id] = captured as [string];
            for (const a of articles) {
              if (a.site_id === site_id && a.homepage_section === "starter") {
                a.status = "published";
                if (a.published_at === null) a.published_at = 1_700_000_000;
              }
            }
          } else if (sql.indexOf("UPDATE sites SET content_version") >= 0) {
            site.content_version += 1;
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

  return { db, stepsRows, articles, settings, pages, site };
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

  // rescue-2 T36.AC2: after the full provisioning walk, every starter
  // article row is status='published' WITH published_at populated, and
  // the owning site's content_version was bumped (publish_starter_articles
  // is the only provisioning step that touches sites.content_version).
  it("publish_starter_articles finalizes starter rows: status='published' + published_at set + sites.content_version bumped", async () => {
    const { db, articles, site } = makeFakeDb({
      id: "job_publish",
      site_id: "st_publish",
    });
    const env = buildEnv(db);

    const summary = await runProvisioningToCompletion(env, db, "st_publish");
    expect(summary.final_status).toBe("completed");

    // generate_15_homepage_articles inserted the 15-row starter set
    // (status='published', published_at=NULL — see the INSERT branch).
    expect(articles).toHaveLength(15);

    // publish_starter_articles backfilled the publish state on every row.
    for (const a of articles) {
      expect(a.status).toBe("published");
      expect(a.published_at).not.toBeNull();
      expect(typeof a.published_at).toBe("number");
    }

    // Exactly one monotonic content_version bump (0 -> 1) so public
    // cache keys — which suffix content_version — roll over.
    expect(site.content_version).toBe(1);
  });

  // rescue-2 T38.AC2: the run_site_smoke_tests step performs >= 3
  // in-process (D1-only) checks and the whole dry-run walk — smoke step
  // included — emits ZERO outbound fetches. The spy records every
  // fetch() call; in-process checks are observable in the step row's
  // in_process_smoke output payload.
  it("run_site_smoke_tests performs >= 3 in-process checks with zero outbound fetch", async () => {
    const fetchCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
    ): Promise<Response> => {
      fetchCalls.push(typeof input === "string" ? input : input.toString());
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;
    try {
      const { db, stepsRows } = makeFakeDb({
        id: "job_smoke",
        site_id: "st_smoke",
      });
      const env = buildEnv(db);

      const summary = await runProvisioningToCompletion(env, db, "st_smoke");
      expect(summary.final_status).toBe("completed");

      const smokeRow = stepsRows.find(
        (r) => r.step_key === "run_site_smoke_tests",
      );
      expect(smokeRow?.status).toBe("completed");
      const payload = JSON.parse(smokeRow?.output ?? "{}") as {
        kind: string;
        checks_run: number;
        checks_passed: number;
        checks: Array<{ check: string; pass: boolean; observed: number }>;
      };
      expect(payload.kind).toBe("in_process_smoke");
      expect(payload.checks_run).toBeGreaterThanOrEqual(3);
      expect(payload.checks_passed).toBe(payload.checks_run);
      for (const check of payload.checks) {
        expect(check.pass).toBe(true);
      }
      // The named checks cover three distinct side-effect tables.
      const names = payload.checks.map((c) => c.check);
      expect(names).toContain("starter_articles_published");
      expect(names).toContain("site_settings_seeded");
      expect(names).toContain("pages_present");

      // Zero network across the entire dry-run walk.
      expect(fetchCalls).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // rescue-2 T38 negative path: a smoke step that reported success while
  // an expected side-effect table is empty would be a fake — with the
  // starter-article INSERTs suppressed the step MUST fail (and fail the
  // job) naming the empty-table check.
  it("run_site_smoke_tests fails the job when the starter-articles side-effect table is empty", async () => {
    const { db, stepsRows, articles } = makeFakeDb(
      { id: "job_smoke_neg", site_id: "st_smoke_neg" },
      { suppressArticleInserts: true },
    );
    const env = buildEnv(db);

    const summary = await runProvisioningToCompletion(env, db, "st_smoke_neg");
    expect(articles).toHaveLength(0);
    expect(summary.final_status).toBe("failed");
    expect(summary.last_step_status).toBe("failed");

    const smokeRow = stepsRows.find(
      (r) => r.step_key === "run_site_smoke_tests",
    );
    expect(smokeRow?.status).toBe("failed");
    const payload = JSON.parse(smokeRow?.output ?? "{}") as {
      checks: Array<{ check: string; pass: boolean; observed: number }>;
    };
    const articleCheck = payload.checks.find(
      (c) => c.check === "starter_articles_published",
    );
    expect(articleCheck?.pass).toBe(false);
    expect(articleCheck?.observed).toBe(0);
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
