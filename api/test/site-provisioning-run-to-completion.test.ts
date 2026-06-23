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
// rescue-3 T6: the editorial columns generate_15_homepage_articles now
// writes (category_id, author_name, seo_title/description, placement flags
// + homepage_rank) are captured so T6-AC1/AC2 are observable.
interface ArticleRow {
  site_id: string;
  slug: string;
  title: string;
  status: string;
  homepage_section: string;
  published_at: number | null;
  category_id: number | null;
  author_name: string | null;
  seo_title: string | null;
  seo_description: string | null;
  // rescue-4 round-3 (issue 3 / migration 0027): the teaser subtitle column.
  subtitle: string | null;
  is_featured: number;
  is_trending: number;
  homepage_rank: number | null;
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
  site: { content_version: number; status: string };
  siteCategories: Array<{
    site_id: string;
    category_id: number;
    display_order: number;
  }>;
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
  // rescue-3 T5: sites.status starts 'draft' (migration 0002 DEFAULT) so the
  // update_launch_readiness go-live flip is observable as 'draft' -> 'active'.
  const site = { content_version: 0, status: "draft" };
  // T38: site_settings + pages writes tracked (deduped on the same
  // UNIQUE keys the real schema declares) so the smoke step's COUNT
  // reads observe what earlier steps actually inserted.
  const settings: Array<{ site_id: string; key: string }> = [];
  const pages: Array<{ site_id: string; slug: string }> = [];
  // rescue-3 T6: site_categories written by allocate_vertical_categories,
  // read back by generate_15_homepage_articles to assign each starter
  // article a category_id (round-robin over this site's allocated set).
  const siteCategories: Array<{
    site_id: string;
    category_id: number;
    display_order: number;
  }> = [];
  // rescue-4: per-article work units the chunked steps materialize-once +
  // process-one against. unit_index doubles as a stable article id for the
  // image step's single-article lookup.
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
          // rescue-4: single-article lookup by slug (image step). This fake
          // tracks articles by slug only; unit_index stands in for the id.
          if (sql.indexOf("SELECT id, slug, title FROM articles WHERE site_id = ? AND slug = ?") >= 0) {
            const [site_id, slug] = captured as [string, string];
            const u = articleUnits.find((x) => x.site_id === site_id && x.article_id === slug);
            const a = articles.find((x) => x.site_id === site_id && x.slug === slug);
            return (a ? { id: u?.unit_index ?? 0, slug: a.slug, title: a.title } : null) as unknown as T | null;
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
            // rescue-3 T6: capture the editorial columns at their bind
            // positions (6..13 after the shared head site_id/slug/title/
            // content_json/content_html/ai_generation_id) so AC1/AC2 see
            // category_id, author_name, seo_*, placement flags + rank.
            // rescue-4 round-3 (issue 3 / migration 0027): the production INSERT
            // (steps.ts generateOneTextUnit) now binds `subtitle` at position 10,
            // BETWEEN seo_description (9) and is_featured — so is_featured/
            // is_trending/homepage_rank shifted right by one (11/12/13). The
            // positional map MUST match that exact column order or the placement
            // flags read from the wrong bind slots (subtitle string read as a flag).
            const [site_id, slug, title] = captured as [string, string, string];
            const category_id = (captured[6] ?? null) as number | null;
            const author_name = (captured[7] ?? null) as string | null;
            const seo_title = (captured[8] ?? null) as string | null;
            const seo_description = (captured[9] ?? null) as string | null;
            const subtitle = (captured[10] ?? null) as string | null;
            const is_featured = (captured[11] ?? 0) as number;
            const is_trending = (captured[12] ?? 0) as number;
            const homepage_rank = (captured[13] ?? null) as number | null;
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
                category_id,
                author_name,
                seo_title,
                seo_description,
                subtitle,
                is_featured,
                is_trending,
                homepage_rank,
              });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO provisioning_article_units") >= 0) {
            const [site_id, unit_index, slug, title, summary] = captured as [
              string,
              number,
              string,
              string,
              string,
            ];
            if (!articleUnits.some((u) => u.site_id === site_id && u.unit_index === unit_index)) {
              articleUnits.push({
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
          } else if (sql.indexOf("UPDATE sites SET status = 'active'") >= 0) {
            // rescue-3 T5: update_launch_readiness go-live write.
            site.status = "active";
          } else if (sql.indexOf("INSERT OR IGNORE INTO site_categories") >= 0) {
            // rescue-3 T6: allocate_vertical_categories writes the site's
            // category set; dedupe on the real (site_id, category_id) PK.
            const [site_id, category_id, display_order] = captured as [
              string,
              number,
              number,
            ];
            if (
              !siteCategories.some(
                (c) => c.site_id === site_id && c.category_id === category_id,
              )
            ) {
              siteCategories.push({ site_id, category_id, display_order });
            }
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
          // rescue-3 T6: site_categories read by generate_15_homepage_articles
          // — returns the rows allocate_vertical_categories wrote, ordered
          // display_order ASC, category_id ASC (mirrors the real query).
          if (sql.indexOf("FROM site_categories WHERE site_id = ?") >= 0) {
            const [site_id] = captured as [string];
            const rows = siteCategories
              .filter((c) => c.site_id === site_id)
              .sort(
                (a, b) =>
                  a.display_order - b.display_order ||
                  a.category_id - b.category_id,
              )
              .map((c) => ({ category_id: c.category_id }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, stepsRows, articles, settings, pages, site, siteCategories };
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

    // rescue-4: the two chunked per-article steps each return in_progress once
    // per unit before completing, so a full drive makes MORE advanceNextStep
    // calls than there are steps. The invariant is reaching 'completed'; there
    // is still exactly ONE step row per distinct step key (in_progress re-runs
    // the SAME step_key — it does not write a new row), in registry order.
    expect(summary.steps_run).toBeGreaterThanOrEqual(TOTAL_STEPS);
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

    // First drive — completes all 16 steps (with per-unit in_progress passes).
    const first = await runProvisioningToCompletion(env, db, "st_idem");
    expect(first.steps_run).toBeGreaterThanOrEqual(TOTAL_STEPS);
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

  // rescue-3 T6-AC1 / RC-019: after the full provisioning walk, every one of
  // the 15 starter articles carries the editorial metadata the public site
  // needs — a non-null category_id drawn from the site's allocated
  // site_categories, a non-null author_name sourced from the default-author
  // setting (NEVER a user email), and non-null seo_title + seo_description.
  // L2_AUTO_DISAMBIGUATION:T6-AC1:RC-019 [api/test/site-provisioning-run-to-completion.test.ts]
  it("generate_15_homepage_articles gives every starter article a category, default author (not an email), and SEO fields [api/test/site-provisioning-run-to-completion.test.ts] L2_AUTO_DISAMBIGUATION:T6-AC1:RC-019", async () => {
    const { db, articles, siteCategories } = makeFakeDb({
      id: "job_t6_meta",
      site_id: "st_t6_meta",
    });
    const env = buildEnv(db);

    const summary = await runProvisioningToCompletion(env, db, "st_t6_meta");
    expect(summary.final_status).toBe("completed");
    expect(articles).toHaveLength(15);

    // allocate_vertical_categories populated the site's category set, so the
    // round-robin assignment below draws from a non-empty pool.
    expect(siteCategories.length).toBeGreaterThan(0);
    const allocatedIds = new Set(siteCategories.map((c) => c.category_id));

    for (const a of articles) {
      // category_id non-null AND drawn from the site's allocated categories.
      expect(a.category_id).not.toBeNull();
      expect(allocatedIds.has(a.category_id as number)).toBe(true);
      // author_name non-null, non-empty, and NOT a user email.
      expect(a.author_name).not.toBeNull();
      expect((a.author_name ?? "").length).toBeGreaterThan(0);
      expect(a.author_name ?? "").not.toContain("@");
      // SEO fields non-null and non-empty.
      expect(a.seo_title).not.toBeNull();
      expect((a.seo_title ?? "").length).toBeGreaterThan(0);
      expect(a.seo_description).not.toBeNull();
      expect((a.seo_description ?? "").length).toBeGreaterThan(0);
    }

    // The default author is the same for every starter article (one site
    // default), proving it came from a single per-site source, not per-row.
    const authors = new Set(articles.map((a) => a.author_name));
    expect(authors.size).toBe(1);
  });

  // rescue-3 T6-AC2 / RC-020: the placement FLAGS written across the 15
  // starter articles are exactly what buildHomeViewModel (home.ts:285-315)
  // consumes to produce the agreed 1 hero + 4 featured + 4 trending + 6
  // latest split — 4 rows is_trending=1, 5 OTHER rows is_featured=1 AND
  // is_trending=0, the remaining 6 is_featured=0 AND is_trending=0, and
  // homepage_rank populated on all 15. The test mirrors the reader's exact
  // bucketing to prove the split emerges from the flags alone.
  // L2_AUTO_DISAMBIGUATION:T6-AC2:RC-020 [api/test/site-provisioning-run-to-completion.test.ts]
  it("generate_15_homepage_articles writes the 1/4/4/6 placement flag distribution the home reader buckets on [api/test/site-provisioning-run-to-completion.test.ts] L2_AUTO_DISAMBIGUATION:T6-AC2:RC-020", async () => {
    const { db, articles } = makeFakeDb({
      id: "job_t6_place",
      site_id: "st_t6_place",
    });
    const env = buildEnv(db);

    const summary = await runProvisioningToCompletion(env, db, "st_t6_place");
    expect(summary.final_status).toBe("completed");
    expect(articles).toHaveLength(15);

    // Raw flag distribution: 4 trending, 5 featured (is_trending=0), 6 latest.
    const trending = articles.filter((a) => a.is_trending === 1);
    const featured = articles.filter(
      (a) => a.is_featured === 1 && a.is_trending === 0,
    );
    const latest = articles.filter(
      (a) => a.is_featured === 0 && a.is_trending === 0,
    );
    expect(trending).toHaveLength(4);
    expect(featured).toHaveLength(5);
    expect(latest).toHaveLength(6);

    // homepage_rank populated on all 15 — the unique 1..15 sequence.
    for (const a of articles) {
      expect(a.homepage_rank).not.toBeNull();
      expect(typeof a.homepage_rank).toBe("number");
    }
    const ranks = articles
      .map((a) => a.homepage_rank as number)
      .sort((x, y) => x - y);
    expect(ranks).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));

    // Mirror the home reader's bucketing (home.ts:285-315) to PROVE the
    // agreed 1 hero + 4 featured + 4 trending + 6 latest split emerges
    // purely from is_trending / is_featured.
    const READER_TRENDING_LIMIT = 5;
    const READER_FEATURED_LIMIT = 8;
    const trendingRows = articles
      .filter((a) => a.is_trending === 1)
      .slice(0, READER_TRENDING_LIMIT);
    const trendingSlugs = new Set(trendingRows.map((a) => a.slug));
    const pool = articles.filter((a) => !trendingSlugs.has(a.slug));
    const featuredBucket = pool
      .filter((a) => a.is_featured === 1)
      .slice(0, READER_FEATURED_LIMIT);
    const hero = featuredBucket[0] ?? pool[0] ?? null;
    const featuredCards = featuredBucket.slice(1);
    const featuredSlugs = new Set<string>();
    if (hero) featuredSlugs.add(hero.slug);
    for (const f of featuredCards) featuredSlugs.add(f.slug);
    const latestCards = pool.filter((a) => !featuredSlugs.has(a.slug));

    expect(trendingRows).toHaveLength(4); // vm.trending = 4
    expect(hero).not.toBeNull(); // vm.hero = 1
    expect(featuredCards).toHaveLength(4); // vm.featured = 4
    expect(latestCards).toHaveLength(6); // vm.latest = 6
  });

  // rescue-3 T5-AC2 / RC-017: a provisioning run driven to completion ends
  // with the site flipped live. The site starts in status='draft' (the
  // migration 0002 DEFAULT); after the final update_launch_readiness step
  // runs, a SELECT of sites.status returns 'active' (the schema CHECK-allowed
  // live value — 'launched' would be rejected by the CHECK constraint). The
  // warm step no longer self-fetches, so the build no longer fails at step 13
  // and actually reaches the go-live step.
  // L2_AUTO_DISAMBIGUATION:T5-AC2:RC-017 [api/test/site-provisioning-run-to-completion.test.ts]
  it("update_launch_readiness flips the finished site status 'draft' -> 'active' at the end of a full provisioning run [api/test/site-provisioning-run-to-completion.test.ts] L2_AUTO_DISAMBIGUATION:T5-AC2:RC-017", async () => {
    const { db, site } = makeFakeDb({
      id: "job_active",
      site_id: "st_active",
    });
    const env = buildEnv(db);

    // Precondition: the site is NOT live before provisioning completes.
    expect(site.status).toBe("draft");

    const summary = await runProvisioningToCompletion(env, db, "st_active");

    // The build completed end-to-end (the warm step no longer fails at
    // step 13) and the final step set the site live. rescue-4: steps_run is
    // >= TOTAL_STEPS because the chunked article steps add per-unit passes.
    expect(summary.final_status).toBe("completed");
    expect(summary.steps_run).toBeGreaterThanOrEqual(TOTAL_STEPS);
    expect(site.status).toBe("active");
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
