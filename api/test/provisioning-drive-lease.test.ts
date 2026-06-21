import { describe, it, expect, afterEach, vi } from "vitest";
import worker from "../src/index";
import {
  STEP_KEYS,
  TOTAL_STEPS,
  driveInProgressProvisioning,
} from "../src/site-provisioning";
import type { Env } from "../src/env";

// PR #28 finding #3 — direct test for the cron provisioning DRIVER
// (driveInProgressProvisioning) + finding #2 overall-budget guard + the
// scheduled() isolation contract. The driver is the rescue-4 COMPLETION
// GUARANTEE: every minute it picks up still-in-progress site-creation jobs and
// advances them within a bounded wall-clock budget, using updated_at staleness
// as a lightweight lease so two overlapping ticks never double-drive a job.
//
// What we prove here:
//   (a) lease: a STALE job (old updated_at) is picked up and advanced to
//       completion; a FRESH job (recent updated_at — i.e. one another tick is
//       actively driving) is EXCLUDED, so it is not double-driven.
//   (b) the OVERALL invocation budget stops the batch between jobs once the
//       wall-clock budget is spent (the next tick resumes the remainder).
//   (c) the scheduled() handler runs processScheduledArticles and
//       driveInProgressProvisioning INDEPENDENTLY: a throw in one does NOT
//       prevent the other, and the handler never rejects.

interface JobState {
  id: string;
  site_id: string;
  status: string;
  current_step_index: number;
  total_steps: number;
  last_error: string | null;
  updated_at: number;
}

interface SiteState {
  id: string;
  name: string;
  domain: string;
  vertical_slug: string;
  status: string;
}

interface World {
  sites: Map<string, SiteState>;
  jobs: JobState[]; // ordered store; lease filter + ORDER BY applied in .all()
  domainsBySite: Map<string, string>;
  attachedDomains: Set<string>;
  stepRows: Array<{
    job_id: string;
    step_key: string;
    status: string;
    output: string | null;
  }>;
  articles: Array<{ site_id: string; slug: string; status: string; published_at: number | null }>;
  settings: Array<{ site_id: string; key: string }>;
  pages: Array<{ site_id: string; slug: string }>;
  siteCategories: Array<{ site_id: string; category_id: number; display_order: number }>;
  articleUnits: Array<{
    site_id: string;
    unit_index: number;
    slug: string;
    title: string | null;
    summary: string | null;
    text_status: string;
    image_status: string;
    article_id: string | null;
    attempt_count: number;
  }>;
  aiGenerations: Map<string, Record<string, unknown>>;
  nowSeconds: number; // controls unixepoch() so updated_at bumps are observable
}

function newWorld(): World {
  return {
    sites: new Map(),
    jobs: [],
    domainsBySite: new Map(),
    attachedDomains: new Set(),
    stepRows: [],
    articles: [],
    settings: [],
    pages: [],
    siteCategories: [],
    articleUnits: [],
    aiGenerations: new Map(),
    nowSeconds: 1_900_000_000,
  };
}

const LEGAL_TEMPLATES: Record<string, { title: string; content_html: string }> = {
  "privacy-policy": { title: "Privacy for {{site_name}}", content_html: "<p>{{site_name}}.</p>" },
  terms: { title: "Terms for {{site_name}}", content_html: "<p>{{site_name}}.</p>" },
  "do-not-sell": { title: "Do Not Sell — {{site_name}}", content_html: "<p>{{site_name}}.</p>" },
  contact: { title: "Contact {{site_name}}", content_html: "<p>{{contact_email}}.</p>" },
};

function findJob(world: World, jobId: string): JobState | undefined {
  return world.jobs.find((j) => j.id === jobId);
}

function makeDb(world: World): D1Database {
  return {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          // findActiveJobForSite — newest job for a site.
          if (sql.indexOf("FROM site_creation_jobs WHERE site_id = ?") >= 0) {
            const [site_id] = captured as [string];
            const job = world.jobs
              .filter((j) => j.site_id === site_id)
              .slice(-1)[0];
            return (job ? ({ ...job } as unknown as T) : null);
          }
          if (sql.indexOf("content_mode FROM sites WHERE id = ?") >= 0) {
            return ({ content_mode: "ai" } as unknown) as T;
          }
          if (sql.indexOf("SELECT id, name, domain, vertical_slug FROM sites") >= 0) {
            const [id] = captured as [string];
            const s = world.sites.get(id);
            return s
              ? (({ id: s.id, name: s.name, domain: s.domain, vertical_slug: s.vertical_slug } as unknown) as T)
              : null;
          }
          if (sql.indexOf("SELECT vertical_slug FROM sites WHERE id = ?") >= 0) {
            const [id] = captured as [string];
            return ({ vertical_slug: world.sites.get(id)?.vertical_slug ?? "general" } as unknown) as T;
          }
          if (sql.indexOf("SELECT name, domain FROM sites WHERE id = ?") >= 0) {
            const [id] = captured as [string];
            const s = world.sites.get(id);
            return ({ name: s?.name ?? id, domain: s?.domain ?? "" } as unknown) as T;
          }
          if (sql.indexOf("SELECT status FROM sites WHERE id = ?") >= 0) {
            const [id] = captured as [string];
            return ({ status: world.sites.get(id)?.status ?? null } as unknown) as T;
          }
          if (sql.indexOf("SELECT domain AS hostname FROM sites") >= 0) {
            const [id] = captured as [string];
            return ({ hostname: world.sites.get(id)?.domain ?? "" } as unknown) as T;
          }
          if (sql.indexOf("FROM sites WHERE id = ?") >= 0) {
            const [id] = captured as [string];
            const s = world.sites.get(id);
            return s ? (({ id: s.id } as unknown) as T) : null;
          }
          if (sql.indexOf("FROM domains WHERE site_id = ?") >= 0) {
            const [site_id] = captured as [string];
            const hostname = world.domainsBySite.get(site_id);
            return hostname ? (({ hostname } as unknown) as T) : null;
          }
          if (sql.indexOf("FROM ai_generations WHERE idempotency_key = ?") >= 0) {
            const [k] = captured as [string];
            return (world.aiGenerations.get(k) ?? null) as unknown as T | null;
          }
          if (sql.indexOf("FROM legal_templates") >= 0) {
            const [slug] = captured as [string];
            const tpl = LEGAL_TEMPLATES[slug];
            return tpl
              ? (({ title: tpl.title, content_html: tpl.content_html, content_md: "" } as unknown) as T)
              : null;
          }
          if (sql.indexOf("SELECT COUNT(*) AS published_count FROM articles") >= 0) {
            const [site_id] = captured as [string];
            const published_count = world.articles.filter(
              (a) => a.site_id === site_id && a.status === "published" && a.published_at !== null,
            ).length;
            return ({ published_count } as unknown) as T;
          }
          if (sql.indexOf("SELECT COUNT(*) AS settings_count FROM site_settings") >= 0) {
            const [site_id] = captured as [string];
            return ({ settings_count: world.settings.filter((s) => s.site_id === site_id).length } as unknown) as T;
          }
          if (sql.indexOf("SELECT COUNT(*) AS pages_count FROM pages") >= 0) {
            const [site_id] = captured as [string];
            return ({ pages_count: world.pages.filter((p) => p.site_id === site_id).length } as unknown) as T;
          }
          if (sql.indexOf("SELECT COUNT(*) AS attached_count FROM domains") >= 0) {
            const [site_id] = captured as [string];
            return ({ attached_count: world.attachedDomains.has(site_id) ? 1 : 0 } as unknown) as T;
          }
          if (sql.indexOf("SELECT COUNT(*) AS media_count FROM media") >= 0) {
            return ({ media_count: 0 } as unknown) as T;
          }
          if (sql.indexOf("COUNT(*) AS unit_count FROM provisioning_article_units") >= 0) {
            const [site_id] = captured as [string];
            return ({ unit_count: world.articleUnits.filter((u) => u.site_id === site_id).length } as unknown) as T;
          }
          if (sql.indexOf("FROM provisioning_article_units") >= 0 && sql.indexOf("text_status = 'pending'") >= 0) {
            const [site_id] = captured as [string];
            const u = world.articleUnits
              .filter((x) => x.site_id === site_id && x.text_status === "pending")
              .sort((a, b) => a.unit_index - b.unit_index)[0];
            return (u ? { ...u } : null) as unknown as T | null;
          }
          if (sql.indexOf("FROM provisioning_article_units") >= 0 && sql.indexOf("image_status = 'pending'") >= 0) {
            const [site_id] = captured as [string];
            const u = world.articleUnits
              .filter((x) => x.site_id === site_id && x.image_status === "pending" && x.article_id !== null)
              .sort((a, b) => a.unit_index - b.unit_index)[0];
            return (u ? { ...u } : null) as unknown as T | null;
          }
          if (sql.indexOf("SELECT id, slug, title FROM articles WHERE site_id = ? AND slug = ?") >= 0) {
            const [site_id, slug] = captured as [string, string];
            const a = world.articles.find((x) => x.site_id === site_id && x.slug === slug);
            const u = world.articleUnits.find((x) => x.site_id === site_id && x.article_id === slug);
            return (a ? { id: u?.unit_index ?? 0, slug: a.slug, title: a.slug } : null) as unknown as T | null;
          }
          return null;
        },
        async run() {
          if (sql.indexOf("INSERT INTO site_creation_job_steps") >= 0) {
            const [job_id, step_key] = captured as [string, string];
            const existing = world.stepRows.find((r) => r.job_id === job_id && r.step_key === step_key);
            if (existing) existing.status = "running";
            else world.stepRows.push({ job_id, step_key, status: "running", output: null });
          } else if (sql.indexOf("UPDATE site_creation_job_steps") >= 0) {
            const [status, output, , job_id, step_key] = captured as [string, string, string | null, string, string];
            const row = world.stepRows.find((r) => r.job_id === job_id && r.step_key === step_key);
            if (row) {
              row.status = status;
              row.output = output;
            }
          } else if (sql.indexOf("UPDATE site_creation_jobs SET current_step =") >= 0) {
            // advanceJobPointer / persistInProgress bump updated_at = unixepoch().
            const [, current_step_index, status, last_error, job_id] = captured as [
              string,
              number,
              string,
              string | null,
              string,
            ];
            const job = findJob(world, job_id);
            if (job) {
              job.current_step_index = current_step_index;
              job.status = status;
              job.last_error = last_error;
              job.updated_at = world.nowSeconds;
            }
          } else if (sql.indexOf("UPDATE site_creation_jobs SET status = 'completed'") >= 0) {
            // overrun finalize path in advanceNextStep.
            const job_id = captured[captured.length - 1] as string;
            const job = findJob(world, job_id);
            if (job) {
              job.status = "completed";
              job.current_step_index = TOTAL_STEPS;
              job.updated_at = world.nowSeconds;
            }
          } else if (sql.indexOf("UPDATE site_creation_jobs SET total_steps = ?") >= 0) {
            const [total_steps, job_id] = captured as [number, string];
            const job = findJob(world, job_id);
            if (job) job.total_steps = total_steps;
          } else if (sql.indexOf("INSERT INTO ai_generations") >= 0) {
            const [id, , , , , , idempotency_key] = captured as [string, string, string, string, string, string, string];
            if (!world.aiGenerations.has(idempotency_key)) {
              world.aiGenerations.set(idempotency_key, { id, idempotency_key, status: "pending" });
            }
          } else if (sql.indexOf("UPDATE ai_generations") >= 0) {
            const k = captured[captured.length - 1] as string;
            const r = world.aiGenerations.get(k);
            if (r) {
              if (sql.indexOf("status = 'success'") >= 0) (r as { status: string }).status = "success";
              else if (sql.indexOf("status = 'failed'") >= 0) (r as { status: string }).status = "failed";
              else if (sql.indexOf("status = 'fallback'") >= 0) (r as { status: string }).status = "fallback";
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO articles") >= 0) {
            const [site_id, slug] = captured as [string, string];
            if (!world.articles.some((a) => a.site_id === site_id && a.slug === slug)) {
              world.articles.push({ site_id, slug, status: "published", published_at: null });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO provisioning_article_units") >= 0) {
            const [site_id, unit_index, slug, title, summary] = captured as [string, number, string, string, string];
            if (!world.articleUnits.some((u) => u.site_id === site_id && u.unit_index === unit_index)) {
              world.articleUnits.push({
                site_id,
                unit_index,
                slug,
                title,
                summary,
                text_status: "pending",
                image_status: "pending",
                article_id: null,
                attempt_count: 0,
              });
            }
          } else if (sql.indexOf("UPDATE provisioning_article_units SET text_status = 'done'") >= 0) {
            const [article_id, site_id, unit_index] = captured as [string, string, number];
            const u = world.articleUnits.find((x) => x.site_id === site_id && x.unit_index === unit_index);
            if (u) {
              u.text_status = "done";
              u.article_id = article_id;
            }
          } else if (sql.indexOf("UPDATE provisioning_article_units SET image_status = 'done'") >= 0) {
            const [site_id, unit_index] = captured as [string, number];
            const u = world.articleUnits.find((x) => x.site_id === site_id && x.unit_index === unit_index);
            if (u) u.image_status = "done";
          } else if (sql.indexOf("UPDATE articles SET status = 'published'") >= 0) {
            // publish_starter_articles backfills published_at on the starter rows
            // so the smoke step's published_count (which requires published_at IS
            // NOT NULL) is non-zero.
            const [site_id] = captured as [string];
            for (const a of world.articles) {
              if (a.site_id === site_id && a.published_at === null) {
                a.status = "published";
                a.published_at = world.nowSeconds;
              }
            }
          } else if (sql.indexOf("UPDATE provisioning_article_units SET attempt_count = ?") >= 0) {
            const attempts = captured[0] as number;
            const unit_index = captured[captured.length - 1] as number;
            const site_id = captured[captured.length - 2] as string;
            const u = world.articleUnits.find((x) => x.site_id === site_id && x.unit_index === unit_index);
            if (u) {
              u.attempt_count = attempts;
              if (sql.indexOf("text_status = 'failed'") >= 0) u.text_status = "failed";
              if (sql.indexOf("image_status = 'failed'") >= 0) u.image_status = "failed";
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO site_settings") >= 0) {
            const [site_id, key] = captured as [string, string];
            if (!world.settings.some((s) => s.site_id === site_id && s.key === key)) {
              world.settings.push({ site_id, key });
            }
          } else if (sql.indexOf("INSERT INTO site_settings") >= 0 && sql.indexOf("ON CONFLICT(site_id, key)") >= 0) {
            const [site_id, key] = captured as [string, string];
            if (!world.settings.some((s) => s.site_id === site_id && s.key === key)) {
              world.settings.push({ site_id, key });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO pages") >= 0) {
            const [site_id] = captured as [string];
            if (!world.pages.some((p) => p.site_id === site_id && p.slug === "about")) {
              world.pages.push({ site_id, slug: "about" });
            }
          } else if (sql.indexOf("INSERT INTO pages") >= 0 && sql.indexOf("ON CONFLICT(site_id, slug)") >= 0) {
            const [site_id, slug] = captured as [string, string];
            if (!world.pages.some((p) => p.site_id === site_id && p.slug === slug)) {
              world.pages.push({ site_id, slug });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO site_categories") >= 0) {
            const [site_id, category_id, display_order] = captured as [string, number, number];
            if (!world.siteCategories.some((c) => c.site_id === site_id && c.category_id === category_id)) {
              world.siteCategories.push({ site_id, category_id, display_order });
            }
          } else if (sql.indexOf("UPDATE sites SET content_version") >= 0) {
            // publish_starter_articles bump — no-op for these assertions.
          } else if (sql.indexOf("UPDATE sites SET last_provisioned_at") >= 0) {
            // advanceJobPointer's completion side-effect — no-op here.
          } else if (sql.indexOf("UPDATE sites SET status = 'active'") >= 0) {
            const [id] = captured as [string];
            const s = world.sites.get(id);
            if (s) s.status = "active";
          } else if (sql.indexOf("UPDATE domains SET") >= 0 && sql.indexOf("status = 'active'") >= 0) {
            const site_id = captured[captured.length - 1] as string;
            world.attachedDomains.add(site_id);
          }
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          // BATCHED-UNIT-ALL (rescue-4 v2): model selectPendingUnitBatch's .all() query.
          if (sql.indexOf("FROM provisioning_article_units") >= 0 && sql.indexOf("text_status = 'pending'") >= 0) {
            const __sid = captured[0] as string;
            const __lim = Number(captured[captured.length - 1]) || 100;
            const __rows = world.articleUnits.filter((x) => x.site_id === __sid && x.text_status === "pending").sort((a, b) => a.unit_index - b.unit_index).slice(0, __lim);
            return { results: __rows as unknown as T[], success: true, meta: {} };
          }
          if (sql.indexOf("FROM provisioning_article_units") >= 0 && sql.indexOf("image_status = 'pending'") >= 0) {
            const __sid = captured[0] as string;
            const __lim = Number(captured[captured.length - 1]) || 100;
            const __rows = world.articleUnits.filter((x) => x.site_id === __sid && x.image_status === "pending" && x.article_id !== null).sort((a, b) => a.unit_index - b.unit_index).slice(0, __lim);
            return { results: __rows as unknown as T[], success: true, meta: {} };
          }

          // db_selectDrivableJobs — the lease query: non-terminal jobs whose
          // updated_at is older than staleBefore, oldest-first, capped to LIMIT.
          if (
            sql.indexOf("SELECT id, site_id FROM site_creation_jobs") >= 0 &&
            sql.indexOf("status IN ('running','pending')") >= 0
          ) {
            const [staleBefore, limit] = captured as [number, number];
            const rows = world.jobs
              .filter(
                (j) =>
                  (j.status === "running" || j.status === "pending") &&
                  j.updated_at <= staleBefore,
              )
              .sort((a, b) => a.updated_at - b.updated_at)
              .slice(0, limit)
              .map((j) => ({ id: j.id, site_id: j.site_id }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          if (sql.indexOf("FROM category_verticals") >= 0 && sql.indexOf("JOIN verticals") >= 0) {
            return {
              results: [
                { category_id: 4, display_order: 0 },
                { category_id: 1, display_order: 1 },
              ] as unknown as T[],
              success: true,
              meta: {},
            };
          }
          if (sql.indexOf("FROM site_categories WHERE site_id = ?") >= 0) {
            const [site_id] = captured as [string];
            const rows = world.siteCategories
              .filter((c) => c.site_id === site_id)
              .sort((a, b) => a.display_order - b.display_order || a.category_id - b.category_id)
              .map((c) => ({ category_id: c.category_id }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
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

function seedSiteWithJob(
  world: World,
  id: string,
  opts: { current_step_index: number; status: string; updated_at: number },
): void {
  world.sites.set(id, {
    id,
    name: `${id} Co`,
    domain: `${id}.example`,
    vertical_slug: "home",
    status: "draft",
  });
  world.domainsBySite.set(id, `${id}.example`);
  world.jobs.push({
    id: `job_${id}`,
    site_id: id,
    status: opts.status,
    current_step_index: opts.current_step_index,
    total_steps: TOTAL_STEPS,
    last_error: null,
    updated_at: opts.updated_at,
  });
}

describe("PR #28 finding #3 — driveInProgressProvisioning lease + budget", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) advances a STALE job and EXCLUDES a FRESH job (lease prevents double-drive) [api/test/provisioning-drive-lease.test.ts]", async () => {
    const world = newWorld();
    const env = buildEnv(makeDb(world));
    // The driver computes staleBefore from the REAL Date.now() (unmocked here),
    // so seed updated_at relative to the real wall clock.
    const now = Math.floor(Date.now() / 1000);
    world.nowSeconds = now;
    // staleBefore = now - 120. A stale job's updated_at must be <= now-120;
    // a fresh job (another tick is driving it) has updated_at = now > now-120.
    seedSiteWithJob(world, "stale", {
      current_step_index: 0,
      status: "pending",
      updated_at: now - 600, // well older than the 120s lease window
    });
    seedSiteWithJob(world, "fresh", {
      current_step_index: 0,
      status: "running",
      updated_at: now, // touched just now → excluded by the lease filter
    });

    const summary = await driveInProgressProvisioning(env);

    // Only the stale job was considered + driven.
    expect(summary.jobs_considered).toBe(1);
    expect(summary.jobs_driven).toBe(1);
    expect(summary.steps_run).toBeGreaterThan(0);

    // The stale job advanced to completion and flipped its site live.
    const staleJob = findJob(world, "job_stale");
    expect(staleJob?.status).toBe("completed");
    expect(staleJob?.current_step_index).toBe(TOTAL_STEPS);
    expect(world.sites.get("stale")?.status).toBe("active");
    // Every step ran for the stale site (proves it was truly advanced).
    const ranKeys = new Set(
      world.stepRows
        .filter((r) => r.status === "completed" || r.status === "completed_dry_run")
        .map((r) => r.step_key),
    );
    for (const key of STEP_KEYS) expect(ranKeys).toContain(key);

    // The fresh job was NOT touched — no double-drive.
    const freshJob = findJob(world, "job_fresh");
    expect(freshJob?.status).toBe("running");
    expect(freshJob?.current_step_index).toBe(0);
    expect(world.sites.get("fresh")?.status).toBe("draft");
    expect(world.stepRows.some((r) => r.job_id === "job_fresh")).toBe(false);
  });

  it("(b) the OVERALL invocation budget stops the batch between jobs (next tick resumes) [api/test/provisioning-drive-lease.test.ts]", async () => {
    const world = newWorld();
    const env = buildEnv(makeDb(world));
    // Three stale, already-overrun jobs (current_step_index === TOTAL_STEPS):
    // advanceNextStep finalizes each as 'completed' in exactly ONE call with no
    // step-handler side-effects, giving a deterministic Date.now() call order so
    // we can trip the OVERALL budget after the first job is driven.
    for (const id of ["b1", "b2", "b3"]) {
      seedSiteWithJob(world, id, {
        current_step_index: TOTAL_STEPS,
        status: "running",
        updated_at: 0, // ancient → well inside the 120s stale lease window
      });
    }

    // DRIVE_OVERALL_BUDGET_MS is 25_000. Date.now() call order in the driver
    // for overrun jobs (each settles in 1 inner iteration):
    //   #1 overallStart, #2 nowSeconds calc (→ staleBefore = floor(ms/1000)-120),
    //   per job1: #3 between-job check, #4 per-job start, #5 inner-loop check,
    //   per job2: #6 between-job check (we make THIS >= 25_000 → break).
    // BASE_MS is large enough that staleBefore (BASE/1000 - 120) exceeds the
    // jobs' updated_at=0 so the lease selects all three; the 6th call jumps
    // BASE+25_001 so the overall budget trips exactly between job1 and job2.
    const BASE_MS = 1_000_000;
    const sequence = [BASE_MS, BASE_MS, BASE_MS, BASE_MS, BASE_MS];
    let call = 0;
    vi.spyOn(Date, "now").mockImplementation(() => {
      const v = call < sequence.length ? sequence[call]! : BASE_MS + 25_001;
      call += 1;
      return v;
    });

    const summary = await driveInProgressProvisioning(env);

    expect(summary.jobs_considered).toBe(3); // lease selected all 3 stale jobs
    expect(summary.jobs_driven).toBe(1); // budget tripped before job 2
    expect(summary.budget_exhausted).toBe(true);

    // Job 1 settled; jobs 2 and 3 are untouched and resumable next tick.
    expect(findJob(world, "job_b1")?.status).toBe("completed");
    expect(findJob(world, "job_b2")?.status).toBe("running");
    expect(findJob(world, "job_b3")?.status).toBe("running");
  });
});

// --- finding #3(c): scheduled() isolation -----------------------------------
//
// A minimal fake that lets us independently fail EITHER the publish pass or the
// provisioning drive and observe that the other still runs and the handler
// never rejects. processScheduledArticles runs first (SELECT ... articles WHERE
// status='scheduled'); driveInProgressProvisioning runs second (the
// site_creation_jobs lease SELECT). We tag each so a test can force a throw on
// one and assert the other was still attempted.
interface IsoProbe {
  publishQueried: boolean;
  driveQueried: boolean;
}

function makeIsolationDb(
  probe: IsoProbe,
  opts: { throwOnPublish?: boolean; throwOnDrive?: boolean },
): D1Database {
  return {
    prepare(sql: string) {
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
        async all<T = unknown>() {
          if (sql.indexOf("FROM articles WHERE status = 'scheduled'") >= 0) {
            probe.publishQueried = true;
            if (opts.throwOnPublish) throw new Error("publish-pass boom");
            return { results: [] as T[], success: true, meta: {} };
          }
          if (
            sql.indexOf("SELECT id, site_id FROM site_creation_jobs") >= 0 &&
            sql.indexOf("status IN ('running','pending')") >= 0
          ) {
            probe.driveQueried = true;
            if (opts.throwOnDrive) throw new Error("provisioning-drive boom");
            return { results: [] as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function makeScheduledCtx(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext;
}

describe("PR #28 finding #3(c) — scheduled() runs publish + provisioning independently", () => {
  const controller = {} as unknown as ScheduledController;

  it("a thrown provisioning-drive error does NOT prevent processScheduledArticles, and the handler never rejects [api/test/provisioning-drive-lease.test.ts]", async () => {
    const probe: IsoProbe = { publishQueried: false, driveQueried: false };
    const env = buildEnv(makeIsolationDb(probe, { throwOnDrive: true }));
    // The handler must settle (no unhandled rejection) even though the drive throws.
    await expect(
      worker.scheduled!(controller, env, makeScheduledCtx()),
    ).resolves.toBeUndefined();
    // Both ran: the publish pass executed AND the (throwing) drive was attempted.
    expect(probe.publishQueried).toBe(true);
    expect(probe.driveQueried).toBe(true);
  });

  it("a thrown publish-pass error does NOT prevent the provisioning drive, and the handler never rejects [api/test/provisioning-drive-lease.test.ts]", async () => {
    const probe: IsoProbe = { publishQueried: false, driveQueried: false };
    const env = buildEnv(makeIsolationDb(probe, { throwOnPublish: true }));
    await expect(
      worker.scheduled!(controller, env, makeScheduledCtx()),
    ).resolves.toBeUndefined();
    // The publish pass threw but the provisioning drive STILL ran (isolation).
    expect(probe.publishQueried).toBe(true);
    expect(probe.driveQueried).toBe(true);
  });
});
