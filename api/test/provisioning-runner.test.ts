import { describe, it, expect } from "vitest";
import admin from "../src/admin/router";
import {
  STEP_KEYS,
  TOTAL_STEPS,
  advanceNextStep,
  type JobRow,
} from "../src/site-provisioning";
import type { Env } from "../src/env";

// T4 / Phase 3 perfect-recovery: end-to-end runner contract.
//
// AC1 / RC-010 (vitest -t "provisioning runner completes all 16 steps
// idempotently"): GIVEN a freshly-created sites + site_creation_jobs row,
// WHEN POST /api/admin/sites/:id/provision/next is called 16 times
// against the in-memory D1 fake below, THEN site_creation_job_steps has
// exactly 16 rows all with status in {completed, completed_dry_run},
// job.status='completed', AND one further call inserts NO new step row.
// AC3 (pages with page_type='about' COUNT(*)=1): the about-page step
// inserts via INSERT OR IGNORE under (site_id, slug) UNIQUE — the fake
// honours this so re-invocation produces exactly 1 row.

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
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  };
}

// In-memory mini-D1. Models only the SQL shapes the runner + step
// handlers issue (see runner.ts, steps.ts, legal-renderer.ts,
// cloudflare-interfaces.ts). Honours (job_id, step_key), (site_id, key),
// and (site_id, slug) UNIQUE so idempotency is observable.
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
  // rescue-2 T38: starter articles tracked so the run_site_smoke_tests
  // step's COUNT reads observe the rows generate_15_homepage_articles
  // actually inserted (and publish_starter_articles finalized).
  const articles: Array<{
    site_id: string;
    slug: string;
    status: string;
    published_at: number | null;
  }> = [];
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
  // Merge-resolution: mission's AI generators read back inserted ai_generations
  // rows via SELECT idempotency_key (see startGenerationLog in
  // api/src/ai/generation-log.ts). The original mock returned null for those
  // SELECTs, breaking the full-registry run when AI steps T9-T11 began calling
  // generation-log. Track ai_generations writes here so the fallback-key
  // path (no OPENAI_API_KEY -> 'fallback' status) can complete.
  const aiGenerations = new Map<string, Record<string, unknown>>();
  const legalTemplates: Record<string, { title: string; content_html: string }> = {
    "privacy-policy": { title: "Privacy Policy for {{site_name}}", content_html: "<p>Privacy for {{site_name}} at {{domain}}.</p>" },
    terms: { title: "Terms for {{site_name}}", content_html: "<p>Terms for {{site_name}} at {{domain}}.</p>" },
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
          // Merge-resolution: mission's loadSiteInfo selects id+name+domain+vertical_slug.
          if (sql.indexOf("vertical_slug FROM sites WHERE id = ?") >= 0 && sql.indexOf("SELECT id") >= 0) {
            return ({ id: initial.site_id, name: initial.site_name, domain: initial.domain, vertical_slug: "general" } as unknown as T);
          }
          if (sql.indexOf("SELECT domain AS hostname FROM sites") >= 0) {
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
          if (sql.indexOf("FROM ai_generations WHERE idempotency_key = ?") >= 0) {
            const [idempotency_key] = captured as [string];
            return (aiGenerations.get(idempotency_key) ?? null) as unknown as T | null;
          }
          // rescue-2 T38 smoke-step COUNT reads — answered from tracked state.
          if (sql.indexOf("SELECT COUNT(*) AS published_count FROM articles") >= 0) {
            const [site_id] = captured as [string];
            const published_count = articles.filter(
              (a) => a.site_id === site_id && a.status === "published" && a.published_at !== null,
            ).length;
            return ({ published_count } as unknown) as T;
          }
          if (sql.indexOf("SELECT COUNT(*) AS settings_count FROM site_settings") >= 0) {
            const [site_id] = captured as [string];
            const settings_count = settings.filter((r) => r.site_id === site_id).length;
            return ({ settings_count } as unknown) as T;
          }
          if (sql.indexOf("SELECT COUNT(*) AS pages_count FROM pages") >= 0) {
            const [site_id] = captured as [string];
            const pages_count = pages.filter((p) => p.site_id === site_id).length;
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
            // no-op (sites row updated_at not asserted by AC)
          } else if (sql.indexOf("INSERT OR IGNORE INTO site_settings") >= 0) {
            const [site_id, key, value] = captured as [string, string, string];
            if (!settings.find((r) => r.site_id === site_id && r.key === key)) {
              settings.push({ site_id, key, value });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO pages") >= 0) {
            // generate_about_page: VALUES (?, 'about', ?, ?, ?, 'published', 'default', 1, 'about')
            const [site_id] = captured as [string];
            const slug = "about";
            if (!pages.find((p) => p.site_id === site_id && p.slug === slug)) {
              pages.push({ site_id, slug, page_type: "about" });
            }
          } else if (sql.indexOf("INSERT INTO pages") >= 0 && sql.indexOf("ON CONFLICT(site_id, slug)") >= 0) {
            // legal-renderer upsert: (?, ?, ?, ?, ?, 'published', 'legal', 1, 'legal')
            const [site_id, slug] = captured as [string, string];
            if (!pages.find((p) => p.site_id === site_id && p.slug === slug)) {
              pages.push({ site_id, slug, page_type: "legal" });
            }
          } else if (sql.indexOf("INSERT INTO cache_purge_log") >= 0) {
            const [site_id, hostname, action, status, dry_run] = captured as [string, string, string, string, number];
            purgeLog.push({ site_id, hostname, action, status, dry_run });
          } else if (sql.indexOf("INSERT OR IGNORE INTO articles") >= 0) {
            // rescue-2 T38: starter rows land status='published' with
            // published_at omitted; publish_starter_articles backfills.
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

describe("site-provisioning runner end-to-end (T4)", () => {
  it("provisioning runner completes all 16 steps idempotently", async () => {
    const SITE_ID = "st_t4";
    const JOB_ID = "job_t4";
    const fake = makeFakeDb({
      site_id: SITE_ID,
      site_name: "Acme Times",
      domain: "acme.example",
      job_id: JOB_ID,
    });
    const env = buildEnv(fake.db);

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
    const ok = new Set(["completed", "completed_dry_run"]);
    const okOrInProgress = new Set(["completed", "completed_dry_run", "in_progress"]);

    // rescue-4: each /provision/next POST advances ONE step EXCEPT the two
    // chunked per-article steps, which return in_progress (same step, pointer
    // unchanged) once per unit before completing. So we POST until the job is
    // 'completed', asserting the pointer is monotonic non-decreasing and the
    // last step status is always a legal advance/in_progress value. The
    // distinct step keys that complete, in pointer order, MUST be the 16
    // registry steps. A generous cap (TOTAL_STEPS + 2*15 unit passes + slack)
    // guards against an infinite loop.
    const completedStepKeys: string[] = [];
    let lastIndex = 0;
    let guard = 0;
    const MAX_POSTS = TOTAL_STEPS + 2 * 15 + 5;
    for (;;) {
      if (guard++ > MAX_POSTS) throw new Error("provision/next did not converge");
      const res = await admin.request(
        `/api/admin/sites/${SITE_ID}/provision/next`,
        { method: "POST", headers: { "content-type": "application/json" } },
        env,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as AdvanceBody;
      expect(body.total_steps).toBe(TOTAL_STEPS);
      expect(okOrInProgress.has(body.last_step_status)).toBe(true);
      // Pointer never goes backwards.
      expect(body.current_step_index).toBeGreaterThanOrEqual(lastIndex);
      // A step that completed advanced the pointer past its index → record it.
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

    // The 16 registry steps each completed exactly once, in registry order.
    expect(completedStepKeys).toEqual([...STEP_KEYS]);

    // BEHAVIORAL #1: TOTAL_STEPS step rows (one per distinct step key — an
    // in_progress step re-runs the SAME step_key, never writing a new row),
    // all terminal-completed, in registry order.
    expect(fake.stepsRows).toHaveLength(TOTAL_STEPS);
    for (let i = 0; i < TOTAL_STEPS; i++) {
      const row = fake.stepsRows[i];
      if (!row) throw new Error(`missing step row at index ${i}`);
      expect(row.step_key).toBe(STEP_KEYS[i]);
      expect(row.step_order).toBe(i);
      expect(ok.has(row.status)).toBe(true);
      // rescue-4: chunked steps re-upsert their step row once per unit pass,
      // so attempt_count is >= 1 (single-pass steps stay at exactly 1).
      expect(row.attempt_count).toBeGreaterThanOrEqual(1);
    }
    expect(fake.job.status).toBe("completed");

    // BEHAVIORAL #2 (idempotency): an extra call after completion MUST NOT add
    // a new step row. The runner short-circuits when job.status='completed'.
    const stepsBefore = fake.stepsRows.length;
    const res16 = await admin.request(
      `/api/admin/sites/${SITE_ID}/provision/next`,
      { method: "POST", headers: { "content-type": "application/json" } },
      env,
    );
    expect(res16.status).toBe(200);
    const body16 = (await res16.json()) as AdvanceBody;
    expect(body16.status).toBe("completed");
    expect(body16.completed).toBe(true);
    expect(fake.stepsRows).toHaveLength(stepsBefore);

    // BEHAVIORAL #3 (REQ-020): exactly 1 pages row with page_type='about'
    // for site X, even after re-run (INSERT OR IGNORE under (site_id, slug)
    // UNIQUE collapses the second insert).
    const aboutRows = fake.pages.filter((p) => p.site_id === SITE_ID && p.page_type === "about");
    expect(aboutRows).toHaveLength(1);
    expect(aboutRows[0]?.slug).toBe("about");

    // BEHAVIORAL #4 (T18 dry-run safety): the CF-mutation step recorded a
    // cache_purge_log row with dry_run=1 and status='completed_dry_run',
    // proving no outbound api.cloudflare.com fetch escaped.
    const cf = fake.purgeLog.find(
      (r) => r.action === "attach_domain_to_new_worker_or_mark_pending",
    );
    expect(cf).toBeTruthy();
    expect(cf?.dry_run).toBe(1);
    expect(cf?.status).toBe("completed_dry_run");
  });

  // rescue-3 T5-AC3 / RC-018: total_steps == STEP_KEYS.length == 16 end-to-
  // end. This GUARDS the existing derive (TOTAL_STEPS = STEP_KEYS.length) and
  // the runner's stale-count re-sync (runner.ts re-syncs any stored
  // total_steps to TOTAL_STEPS); it does NOT claim a 15->16 fix. The 16th
  // (final) step key is update_launch_readiness — the go-live step.
  // L2_AUTO_DISAMBIGUATION:T5-AC3:RC-018 [api/test/provisioning-runner.test.ts]
  it("provisioning registry derives total_steps == STEP_KEYS.length == 16 with update_launch_readiness as the final step [api/test/provisioning-runner.test.ts] L2_AUTO_DISAMBIGUATION:T5-AC3:RC-018", () => {
    expect(STEP_KEYS.length).toBe(16);
    expect(TOTAL_STEPS).toBe(16);
    expect(TOTAL_STEPS).toBe(STEP_KEYS.length);
    expect(STEP_KEYS[STEP_KEYS.length - 1]).toBe("update_launch_readiness");
    expect(STEP_KEYS[15]).toBe("update_launch_readiness");
  });

  // rescue-3 T20-AC2 / RC-056: consistency guard — TOTAL_STEPS / total_steps
  // is 16. This GUARDS the existing derive (TOTAL_STEPS = STEP_KEYS.length)
  // and the runner reporting the LIVE total: a job whose stored total_steps
  // is stale (e.g. 15, from a pre-16 mint or migration 0002's DEFAULT) MUST
  // be reported as 16, never echoed back stale. It claims no 15->16 fix.
  // L2_AUTO_DISAMBIGUATION:T20-AC2:RC-056 [api/test/provisioning-runner.test.ts]
  it("provisioning runner reports total_steps == 16 and never echoes a stale stored count [api/test/provisioning-runner.test.ts] L2_AUTO_DISAMBIGUATION:T20-AC2:RC-056", async () => {
    // Registry derive: TOTAL_STEPS is the live STEP_KEYS length (16).
    expect(STEP_KEYS.length).toBe(16);
    expect(TOTAL_STEPS).toBe(16);
    expect(TOTAL_STEPS).toBe(STEP_KEYS.length);

    // A completed job short-circuits before any DB access, so a throwing
    // stub proves the reported total comes from the live registry, not from
    // the stored (stale) job.total_steps.
    const throwingDb = {
      prepare() {
        throw new Error(
          "advanceNextStep terminal branch must not touch the DB",
        );
      },
    } as unknown as D1Database;
    const staleCompletedJob: JobRow = {
      id: "job_stale",
      site_id: "site_stale",
      status: "completed",
      current_step_index: 16,
      total_steps: 15, // stale stored count from a pre-16 mint
    };
    const result = await advanceNextStep(
      buildEnv(throwingDb),
      throwingDb,
      staleCompletedJob,
    );
    expect(result.total_steps).toBe(16);
    expect(result.total_steps).toBe(TOTAL_STEPS);
    expect(result.total_steps).not.toBe(staleCompletedJob.total_steps);
    expect(result.completed).toBe(true);
  });
});
