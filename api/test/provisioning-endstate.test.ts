// T41 — Provisioned end-state correctness + matches the design.
//
// Two behavioral claims, proven against the SHIPPED provisioning runner +
// the SHIPPED public home renderer (not a source grep). Every it() title
// embeds the literal [api/test/provisioning-endstate.test.ts] plus the L2
// disambiguation marker so the parse_test_output evidence parser routes each
// receipt to its claim:
//   RC-068 -> T41-AC1  (a freshly provisioned site reaches the complete,
//                        correct end-state: status=active, N PUBLISHED
//                        articles each with category/author/SEO/featured
//                        image, logo + hero + brand seeded — runtime e2e +
//                        D1 select-back).
//   RC-069 -> T41-AC2  (the provisioned site's LIVE home renders the
//                        populated 13-section design — every section marker
//                        present, real /article + /media content, and NONE
//                        of the bare/empty-state markers => html_negative).
//
// The whole walk runs under SITE_PROVISIONING_DRY_RUN=true and a fetch spy
// asserts ZERO outbound fetch (cf_dry_run: 0 to api.cloudflare.com, and 0 to
// anything else — the OpenAI client is replaced by a deterministic in-memory
// fake so image generation succeeds with NO network). That is the only way
// featured_image_id / logo / hero get SET (the real generator writes no media
// row without a working image client), so this test proves the PRODUCTION
// end-state (image subsystem available) deterministically, hermetically.

import { describe, it, expect, vi } from "vitest";

// Replace the OpenAI client module-wide BEFORE the provisioning code imports
// it. The fake reports a key (so the image path runs instead of the no-key
// skip) and returns deterministic image bytes with ZERO fetch; generateText
// returns the skipped sentinel so every TEXT generator takes its deterministic
// fallback builder (the exact path the no-key suite already proves) — only the
// IMAGES change, which is precisely what AC1's "featured image / logo / hero"
// clauses require. All other openai-client exports are preserved.
vi.mock("../src/ai/openai-client", async () => {
  const actual = await vi.importActual<
    typeof import("../src/ai/openai-client")
  >("../src/ai/openai-client");
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
  return {
    ...actual,
    createOpenAIClient: () => ({
      hasApiKey: () => true,
      async generateText() {
        return { skipped_no_api_key: true } as const;
      },
      async generateImage() {
        return {
          bytes: PNG,
          mime: "image/png",
          model: "gpt-image-2",
          retries: 0,
          status: 200,
        };
      },
    }),
  };
});

import {
  TOTAL_STEPS,
  runProvisioningToCompletion,
} from "../src/site-provisioning";
import { renderHomepageHtml } from "../src/public/render-pages";
import type { Env } from "../src/env";
import type { PublicSiteContext } from "../src/public/middleware";

// ---------------------------------------------------------------------------
// Stateful in-memory D1 fake — models every table the provisioning runner +
// the home renderer touch, answering reads from prior writes so the full walk
// is a genuine end-to-end run (not canned values). No node:sqlite dependency,
// so it runs identically on the CI Node-20 floor.
// ---------------------------------------------------------------------------
interface ArticleRow {
  id: number;
  site_id: string;
  slug: string;
  title: string;
  content_html: string | null;
  ai_generation_id: string | null;
  category_id: number | null;
  author_name: string | null;
  seo_title: string | null;
  seo_description: string | null;
  is_featured: number;
  is_trending: number;
  homepage_rank: number | null;
  status: string;
  homepage_section: string;
  published_at: number | null;
  featured_image_id: number | null;
}
interface MediaRow {
  id: number;
  storage_key: string;
  alt_text: string | null;
  site_id: string;
}
interface CategoryRow {
  id: number;
  slug: string;
  name: string;
  show_on_homepage: number;
}

interface Store {
  db: D1Database;
  site: {
    id: string;
    name: string;
    domain: string;
    primary_domain: string;
    vertical_slug: string;
    content_mode: string;
    content_version: number;
    status: string;
  };
  job: {
    id: string;
    site_id: string;
    status: string;
    current_step_index: number;
    total_steps: number;
  };
  steps: Array<{ job_id: string; step_key: string; status: string; output: string | null }>;
  settings: Array<{ site_id: string; key: string; value: string }>;
  domains: Array<{ site_id: string; hostname: string; status: string }>;
  categories: CategoryRow[];
  siteCategories: Array<{ site_id: string; category_id: number; display_order: number }>;
  articles: ArticleRow[];
  media: MediaRow[];
  pages: Array<{ site_id: string; slug: string }>;
  aiGenerations: Map<string, Record<string, unknown>>;
  // rescue-4: the per-article work-unit table the chunked generate_15_*
  // and generate_or_assign_* steps materialize-once + process-one against.
  articleUnits: ArticleUnitRow[];
}

interface ArticleUnitRow {
  site_id: string;
  unit_index: number;
  slug: string;
  title: string | null;
  summary: string | null;
  text_status: string;
  image_status: string;
  article_id: string | null;
  attempt_count: number;
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {
      async get() {
        return null;
      },
      async put() {},
      async delete() {},
      async list() {
        return { keys: [], list_complete: true, cacheStatus: null };
      },
    } as unknown as KVNamespace,
    MEDIA: {
      async put() {},
    } as unknown as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "admin.localhost",
    ADMIN_BASE_URL: "http://admin.localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    // A key is present so the (mocked) client's image path runs; the mock
    // intercepts every call so no real request is ever made.
    OPENAI_API_KEY: "test-key-not-used-mock-intercepts",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  } as unknown as Env;
}

function makeStore(): Store {
  const store = {
    site: {
      id: "st_end",
      name: "Health Daily",
      domain: "health-daily.example",
      primary_domain: "health-daily.example",
      vertical_slug: "health",
      content_mode: "ai",
      content_version: 0,
      status: "draft",
    },
    job: {
      id: "job_end",
      site_id: "st_end",
      status: "pending",
      current_step_index: 0,
      total_steps: TOTAL_STEPS,
    },
    steps: [],
    settings: [],
    domains: [],
    // Two global categories the 'health' vertical maps to (pre-seeded by
    // migrations in production); show_on_homepage defaults to 0 (opt-in), so a
    // fresh provision leaves the chip-rail empty — faithful, and AC2 asserts
    // article population, not chips.
    categories: [
      { id: 1, slug: "nutrition", name: "Nutrition", show_on_homepage: 0 },
      { id: 4, slug: "fitness", name: "Fitness", show_on_homepage: 0 },
    ],
    siteCategories: [],
    articles: [],
    media: [],
    pages: [],
    aiGenerations: new Map<string, Record<string, unknown>>(),
    articleUnits: [],
  } as Omit<Store, "db">;

  let mediaSeq = 0;
  let articleSeq = 0;

  function findSetting(key: string): { site_id: string; key: string; value: string } | undefined {
    return store.settings.find((s) => s.site_id === store.site.id && s.key === key);
  }

  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...b: unknown[]) {
          binds = b;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          // --- sites reads (most-specific column list first) ---------------
          if (sql.indexOf("id, name, domain, vertical_slug FROM sites") >= 0) {
            return {
              id: store.site.id,
              name: store.site.name,
              domain: store.site.domain,
              vertical_slug: store.site.vertical_slug,
            } as unknown as T;
          }
          if (sql.indexOf("name, domain FROM sites") >= 0) {
            return { name: store.site.name, domain: store.site.domain } as unknown as T;
          }
          if (sql.indexOf("vertical_slug FROM sites") >= 0) {
            return { vertical_slug: store.site.vertical_slug } as unknown as T;
          }
          if (sql.indexOf("content_mode FROM sites") >= 0) {
            return { content_mode: store.site.content_mode } as unknown as T;
          }
          if (sql.indexOf("content_version FROM sites") >= 0) {
            return { content_version: store.site.content_version } as unknown as T;
          }
          if (sql.indexOf("domain AS hostname FROM sites") >= 0) {
            return { hostname: store.site.primary_domain } as unknown as T;
          }
          if (sql.indexOf("status FROM sites WHERE id = ?") >= 0) {
            return { status: store.site.status } as unknown as T;
          }
          // --- jobs ---------------------------------------------------------
          if (sql.indexOf("FROM site_creation_jobs WHERE site_id = ?") >= 0) {
            return {
              id: store.job.id,
              site_id: store.job.site_id,
              status: store.job.status,
              current_step_index: store.job.current_step_index,
              total_steps: store.job.total_steps,
            } as unknown as T;
          }
          if (sql.indexOf("status FROM site_creation_job_steps") >= 0) {
            const [job_id, step_key] = binds as [string, string];
            const row = store.steps.find((s) => s.job_id === job_id && s.step_key === step_key);
            return (row ? { status: row.status } : null) as unknown as T | null;
          }
          // --- ai_generations idempotent read ------------------------------
          if (sql.indexOf("FROM ai_generations WHERE idempotency_key = ?") >= 0) {
            const [key] = binds as [string];
            return (store.aiGenerations.get(key) ?? null) as unknown as T | null;
          }
          // --- prompt_presets: none -> deterministic builder fallback -------
          if (sql.indexOf("FROM prompt_presets WHERE category = ?") >= 0) {
            return null;
          }
          // --- categories by slug (parenting-plan path; unused for health) --
          if (sql.indexOf("id AS id FROM categories WHERE slug = ?") >= 0) {
            const [slug] = binds as [string];
            const c = store.categories.find((x) => x.slug === slug);
            return (c ? { id: c.id } : null) as unknown as T | null;
          }
          // --- legal template per slug -------------------------------------
          if (sql.indexOf("FROM legal_templates WHERE slug = ?") >= 0) {
            const [slug] = binds as [string];
            return {
              title: `Legal: ${slug}`,
              content_html: `<p>${slug} for {{site_name}}.</p>`,
              content_md: `${slug} for {{site_name}}.`,
            } as unknown as T;
          }
          // --- single site_settings value by key ---------------------------
          if (sql.indexOf("FROM site_settings WHERE site_id = ? AND key = ?") >= 0) {
            const [, key] = binds as [string, string];
            const row = findSetting(key);
            return (row ? { value: row.value } : null) as unknown as T | null;
          }
          // --- domains hostname --------------------------------------------
          if (sql.indexOf("hostname FROM domains WHERE site_id = ?") >= 0) {
            const d = store.domains.find((x) => x.site_id === store.site.id);
            return (d ? { hostname: d.hostname } : null) as unknown as T | null;
          }
          // --- media INSERT ... RETURNING id -------------------------------
          if (sql.indexOf("INSERT INTO media") >= 0 && sql.indexOf("RETURNING id") >= 0) {
            const id = ++mediaSeq;
            store.media.push({
              id,
              storage_key: binds[1] as string,
              alt_text: (binds[4] ?? null) as string | null,
              site_id: binds[6] as string,
            });
            return { id } as unknown as T;
          }
          // --- COUNT reads (starter-scoped before site-wide) ---------------
          if (
            sql.indexOf("COUNT(*) AS published_count FROM articles") >= 0 &&
            sql.indexOf("homepage_section = 'starter'") >= 0
          ) {
            const n = store.articles.filter(
              (a) =>
                a.site_id === store.site.id &&
                a.homepage_section === "starter" &&
                a.status === "published" &&
                a.published_at !== null,
            ).length;
            return { published_count: n } as unknown as T;
          }
          if (sql.indexOf("COUNT(*) AS published_count FROM articles") >= 0) {
            const n = store.articles.filter(
              (a) => a.site_id === store.site.id && a.status === "published" && a.published_at !== null,
            ).length;
            return { published_count: n } as unknown as T;
          }
          if (sql.indexOf("COUNT(*) AS settings_count FROM site_settings") >= 0) {
            const n = store.settings.filter((s) => s.site_id === store.site.id).length;
            return { settings_count: n } as unknown as T;
          }
          if (sql.indexOf("COUNT(*) AS pages_count FROM pages") >= 0) {
            const n = store.pages.filter((p) => p.site_id === store.site.id).length;
            return { pages_count: n } as unknown as T;
          }
          if (sql.indexOf("COUNT(*) AS attached_count FROM domains") >= 0) {
            const n = store.domains.filter(
              (d) => d.site_id === store.site.id && d.status === "active",
            ).length;
            return { attached_count: n } as unknown as T;
          }
          if (sql.indexOf("COUNT(*) AS media_count FROM media") >= 0) {
            const n = store.media.filter((m) => m.site_id === store.site.id).length;
            return { media_count: n } as unknown as T;
          }
          // --- rescue-4: provisioning_article_units reads ------------------
          if (sql.indexOf("COUNT(*) AS unit_count FROM provisioning_article_units") >= 0) {
            const [site_id] = binds as [string];
            const n = store.articleUnits.filter((u) => u.site_id === site_id).length;
            return { unit_count: n } as unknown as T;
          }
          if (sql.indexOf("FROM provisioning_article_units") >= 0 && sql.indexOf("text_status = 'pending'") >= 0) {
            const [site_id] = binds as [string];
            const u = store.articleUnits
              .filter((x) => x.site_id === site_id && x.text_status === "pending")
              .sort((a, b) => a.unit_index - b.unit_index)[0];
            return (u ? { ...u } : null) as unknown as T | null;
          }
          if (sql.indexOf("FROM provisioning_article_units") >= 0 && sql.indexOf("image_status = 'pending'") >= 0) {
            const [site_id] = binds as [string];
            const u = store.articleUnits
              .filter(
                (x) =>
                  x.site_id === site_id &&
                  x.image_status === "pending" &&
                  x.article_id !== null,
              )
              .sort((a, b) => a.unit_index - b.unit_index)[0];
            return (u ? { ...u } : null) as unknown as T | null;
          }
          // --- rescue-4: single-article lookup by slug (image step) --------
          if (
            sql.indexOf("SELECT id, slug, title FROM articles WHERE site_id = ? AND slug = ?") >= 0
          ) {
            const [site_id, slug] = binds as [string, string];
            const a = store.articles.find((x) => x.site_id === site_id && x.slug === slug);
            return (a ? { id: a.id, slug: a.slug, title: a.title } : null) as unknown as T | null;
          }
          return null;
        },
        async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: object }> {
          const ok = (rows: unknown[]): { results: T[]; success: boolean; meta: object } => ({
            results: rows as T[],
            success: true,
            meta: {},
          });
          // category_verticals matrix for 'health'
          if (sql.indexOf("FROM category_verticals") >= 0 && sql.indexOf("JOIN verticals") >= 0) {
            return ok([
              { category_id: 4, display_order: 0 },
              { category_id: 1, display_order: 1 },
            ]);
          }
          // site_categories ids for this site
          if (sql.indexOf("category_id AS category_id FROM site_categories WHERE site_id = ?") >= 0) {
            const rows = store.siteCategories
              .filter((c) => c.site_id === store.site.id)
              .sort((a, b) => a.display_order - b.display_order || a.category_id - b.category_id)
              .map((c) => ({ category_id: c.category_id }));
            return ok(rows);
          }
          // legal-renderer scoped settings read
          if (
            sql.indexOf("FROM site_settings WHERE site_id = ?") >= 0 &&
            sql.indexOf("key IN ('contact_email','privacy_email')") >= 0
          ) {
            const rows = store.settings
              .filter(
                (s) =>
                  s.site_id === store.site.id &&
                  (s.key === "contact_email" || s.key === "privacy_email"),
              )
              .map((s) => ({ key: s.key, value: s.value }));
            return ok(rows);
          }
          // generate_or_assign_article_images — starter rows to image
          if (
            sql.indexOf("id, slug, title FROM articles WHERE site_id = ?") >= 0 &&
            sql.indexOf("homepage_section = 'starter'") >= 0
          ) {
            const rows = store.articles
              .filter((a) => a.site_id === store.site.id && a.homepage_section === "starter")
              .slice()
              .sort((a, b) => a.id - b.id)
              .map((a) => ({ id: a.id, slug: a.slug, title: a.title }));
            return ok(rows);
          }
          // buildHomeViewModel — articles join (published only, ordered)
          if (sql.indexOf("FROM articles a") >= 0 && sql.indexOf("LEFT JOIN media m") >= 0) {
            const limit = (binds[binds.length - 1] as number) ?? 31;
            const rows = store.articles
              .filter((a) => a.site_id === store.site.id && a.status === "published")
              .slice()
              .sort(
                (a, b) =>
                  b.is_featured - a.is_featured ||
                  b.is_trending - a.is_trending ||
                  (a.homepage_rank ?? 0) - (b.homepage_rank ?? 0) ||
                  (b.published_at ?? 0) - (a.published_at ?? 0) ||
                  b.id - a.id,
              )
              .slice(0, limit)
              .map((a) => {
                const cat = store.categories.find((c) => c.id === a.category_id) ?? null;
                const med = store.media.find((m) => m.id === a.featured_image_id) ?? null;
                return {
                  id: a.id,
                  slug: a.slug,
                  title: a.title,
                  content_html: a.content_html,
                  category_id: a.category_id,
                  status: a.status,
                  published_at: a.published_at,
                  featured_image_id: a.featured_image_id,
                  is_featured: a.is_featured,
                  is_trending: a.is_trending,
                  homepage_rank: a.homepage_rank,
                  site_id: a.site_id,
                  category_name: cat?.name ?? null,
                  category_slug: cat?.slug ?? null,
                  image_url: med?.storage_key ?? null,
                  image_alt: med?.alt_text ?? null,
                };
              });
            return ok(rows);
          }
          // buildHomeViewModel — chip-rail categories (show_on_homepage = 1)
          if (sql.indexOf("FROM categories c") >= 0 && sql.indexOf("INNER JOIN site_categories sc") >= 0) {
            const rows = store.siteCategories
              .filter((sc) => sc.site_id === store.site.id)
              .map((sc) => store.categories.find((c) => c.id === sc.category_id))
              .filter((c): c is CategoryRow => !!c && c.show_on_homepage === 1)
              .map((c) => ({ id: c.id, slug: c.slug, name: c.name }));
            return ok(rows);
          }
          // buildHomeViewModel / ads / custom-html — all site_settings
          if (sql.indexOf("key AS key, value AS value FROM site_settings WHERE site_id = ?") >= 0) {
            const rows = store.settings
              .filter((s) => s.site_id === store.site.id)
              .map((s) => ({ key: s.key, value: s.value }));
            return ok(rows);
          }
          return ok([]);
        },
        async run(): Promise<{ success: boolean; meta: object }> {
          const ok = { success: true, meta: {} };
          // job step receipts
          if (sql.indexOf("INSERT INTO site_creation_job_steps") >= 0) {
            const [job_id, step_key] = binds as [string, string];
            const existing = store.steps.find((s) => s.job_id === job_id && s.step_key === step_key);
            if (existing) existing.status = "running";
            else store.steps.push({ job_id, step_key, status: "running", output: null });
            return ok;
          }
          if (sql.indexOf("UPDATE site_creation_job_steps") >= 0) {
            const [status, output, , job_id, step_key] = binds as [
              string,
              string,
              string | null,
              string,
              string,
            ];
            const row = store.steps.find((s) => s.job_id === job_id && s.step_key === step_key);
            if (row) {
              row.status = status;
              row.output = output;
            }
            return ok;
          }
          if (sql.indexOf("UPDATE site_creation_jobs SET") >= 0) {
            // advanceJobPointer: (current_step, next_index, status, last_error, id)
            if (sql.indexOf("current_step = ?") >= 0) {
              store.job.current_step_index = binds[1] as number;
              store.job.status = binds[2] as string;
            } else if (sql.indexOf("status = 'completed'") >= 0) {
              store.job.status = "completed";
            }
            return ok;
          }
          // sites writes
          if (sql.indexOf("UPDATE sites SET status = 'active'") >= 0) {
            store.site.status = "active";
            return ok;
          }
          if (sql.indexOf("UPDATE sites SET content_version = content_version + 1") >= 0) {
            store.site.content_version += 1;
            return ok;
          }
          if (sql.indexOf("UPDATE sites SET last_provisioned_at") >= 0) {
            return ok;
          }
          // domains
          if (sql.indexOf("INSERT OR IGNORE INTO domains") >= 0) {
            const [site_id, hostname] = binds as [string, string];
            if (!store.domains.some((d) => d.site_id === site_id && d.hostname === hostname)) {
              store.domains.push({ site_id, hostname, status: "pending" });
            }
            return ok;
          }
          // site_settings — seed / default-author (INSERT OR IGNORE)
          if (sql.indexOf("INSERT OR IGNORE INTO site_settings") >= 0) {
            const [site_id, key, value] = binds as [string, string, string];
            if (!store.settings.some((s) => s.site_id === site_id && s.key === key)) {
              store.settings.push({ site_id, key, value });
            }
            return ok;
          }
          // site_settings — upsertSiteSetting (conditional vs overwrite)
          if (sql.indexOf("INSERT INTO site_settings") >= 0 && sql.indexOf("ON CONFLICT(site_id, key)") >= 0) {
            const [site_id, key, value] = binds as [string, string, string];
            const existing = store.settings.find((s) => s.site_id === site_id && s.key === key);
            const conditional = sql.indexOf("site_settings.value IS NULL OR site_settings.value = ''") >= 0;
            if (!existing) store.settings.push({ site_id, key, value });
            else if (!conditional || existing.value === null || existing.value === "") existing.value = value;
            return ok;
          }
          // categories (parenting-plan path; unused for health but supported)
          if (sql.indexOf("INSERT OR IGNORE INTO categories") >= 0) {
            const [slug, name] = binds as [string, string];
            if (!store.categories.some((c) => c.slug === slug)) {
              store.categories.push({ id: store.categories.length + 100, slug, name, show_on_homepage: 0 });
            }
            return ok;
          }
          if (sql.indexOf("INSERT OR IGNORE INTO site_categories") >= 0) {
            const [site_id, category_id, display_order] = binds as [string, number, number];
            if (!store.siteCategories.some((c) => c.site_id === site_id && c.category_id === category_id)) {
              store.siteCategories.push({ site_id, category_id, display_order });
            }
            return ok;
          }
          // ai_generations
          if (sql.indexOf("INSERT INTO ai_generations") >= 0) {
            const key = binds[6] as string;
            if (!store.aiGenerations.has(key)) {
              store.aiGenerations.set(key, {
                id: binds[0],
                idempotency_key: key,
                status: "pending",
                parsed_json: null,
                model: binds[4],
              });
            }
            return ok;
          }
          if (sql.indexOf("UPDATE ai_generations") >= 0) {
            const key = binds[binds.length - 1] as string;
            const row = store.aiGenerations.get(key);
            if (row) {
              if (sql.indexOf("status = 'success'") >= 0) {
                row.status = "success";
                row.parsed_json = binds[1];
              } else if (sql.indexOf("status = 'failed'") >= 0) row.status = "failed";
              else if (sql.indexOf("status = 'fallback'") >= 0) {
                row.status = "fallback";
                row.parsed_json = binds[0];
              }
            }
            return ok;
          }
          // articles INSERT OR IGNORE (assign autoincrement id)
          if (sql.indexOf("INSERT OR IGNORE INTO articles") >= 0) {
            const [site_id, slug] = binds as [string, string];
            if (!store.articles.some((a) => a.site_id === site_id && a.slug === slug)) {
              store.articles.push({
                id: ++articleSeq,
                site_id,
                slug,
                title: binds[2] as string,
                content_html: (binds[4] ?? null) as string | null,
                ai_generation_id: (binds[5] ?? null) as string | null,
                category_id: (binds[6] ?? null) as number | null,
                author_name: (binds[7] ?? null) as string | null,
                seo_title: (binds[8] ?? null) as string | null,
                seo_description: (binds[9] ?? null) as string | null,
                is_featured: (binds[10] ?? 0) as number,
                is_trending: (binds[11] ?? 0) as number,
                homepage_rank: (binds[12] ?? null) as number | null,
                status: "published",
                homepage_section: "starter",
                published_at: null,
                featured_image_id: null,
              });
            }
            return ok;
          }
          // articles featured_image_id assignment (UPDATE-IF-NULL)
          if (sql.indexOf("UPDATE articles SET featured_image_id = ?") >= 0) {
            const [media_id, article_id] = binds as [number, number];
            const a = store.articles.find((x) => x.id === article_id);
            if (a && (a.featured_image_id === null || a.featured_image_id === 0)) {
              a.featured_image_id = media_id;
            }
            return ok;
          }
          // rescue-4: provisioning_article_units materialize + per-stage marks
          if (sql.indexOf("INSERT OR IGNORE INTO provisioning_article_units") >= 0) {
            const [site_id, unit_index, slug, title, summary] = binds as [
              string,
              number,
              string,
              string,
              string,
            ];
            if (!store.articleUnits.some((u) => u.site_id === site_id && u.unit_index === unit_index)) {
              store.articleUnits.push({
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
            return ok;
          }
          if (sql.indexOf("UPDATE provisioning_article_units SET text_status = 'done'") >= 0) {
            const [article_id, site_id, unit_index] = binds as [string, string, number];
            const u = store.articleUnits.find((x) => x.site_id === site_id && x.unit_index === unit_index);
            if (u) {
              u.text_status = "done";
              u.article_id = article_id;
            }
            return ok;
          }
          if (sql.indexOf("UPDATE provisioning_article_units SET image_status = 'done'") >= 0) {
            const [site_id, unit_index] = binds as [string, number];
            const u = store.articleUnits.find((x) => x.site_id === site_id && x.unit_index === unit_index);
            if (u) u.image_status = "done";
            return ok;
          }
          // rescue-4: per-unit failure bookkeeping (attempt bump / permanent fail)
          if (sql.indexOf("UPDATE provisioning_article_units SET attempt_count = ?") >= 0) {
            const attempts = binds[0] as number;
            const unit_index = binds[binds.length - 1] as number;
            const site_id = binds[binds.length - 2] as string;
            const u = store.articleUnits.find((x) => x.site_id === site_id && x.unit_index === unit_index);
            if (u) {
              u.attempt_count = attempts;
              if (sql.indexOf("text_status = 'failed'") >= 0) u.text_status = "failed";
              if (sql.indexOf("image_status = 'failed'") >= 0) u.image_status = "failed";
            }
            return ok;
          }
          // publish_starter_articles backfill
          if (sql.indexOf("UPDATE articles SET status = 'published'") >= 0) {
            for (const a of store.articles) {
              if (a.site_id === store.site.id && a.homepage_section === "starter") {
                a.status = "published";
                if (a.published_at === null) a.published_at = 1_700_000_000;
              }
            }
            return ok;
          }
          // pages — about (INSERT OR IGNORE) + legal (ON CONFLICT)
          if (sql.indexOf("INSERT OR IGNORE INTO pages") >= 0) {
            if (!store.pages.some((p) => p.site_id === store.site.id && p.slug === "about")) {
              store.pages.push({ site_id: store.site.id, slug: "about" });
            }
            return ok;
          }
          if (sql.indexOf("INSERT INTO pages") >= 0 && sql.indexOf("ON CONFLICT(site_id, slug)") >= 0) {
            const [site_id, slug] = binds as [string, string];
            if (!store.pages.some((p) => p.site_id === site_id && p.slug === slug)) {
              store.pages.push({ site_id, slug });
            }
            return ok;
          }
          // cache_purge_log (CF-boundary dry-run receipt)
          if (sql.indexOf("INSERT INTO cache_purge_log") >= 0) {
            return ok;
          }
          return ok;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { ...store, db } as Store;
}

// One shared, fully-provisioned world for both claims (provision once; assert
// the end-state, then render the live home from that exact state).
async function provisionWorld(): Promise<{
  store: Store;
  summary: Awaited<ReturnType<typeof runProvisioningToCompletion>>;
  fetchCalls: string[];
}> {
  const fetchCalls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    fetchCalls.push(typeof input === "string" ? input : input.toString());
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  try {
    const store = makeStore();
    const env = buildEnv(store.db);
    const summary = await runProvisioningToCompletion(env, store.db, store.site.id);
    return { store, summary, fetchCalls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

const EMPTY_STATE_MARKERS = [
  "No featured stories yet.",
  "Editor's picks coming soon.",
  "Spotlight stories coming soon.",
  "More stories on the way.",
];

describe("T41 provisioned end-state correctness + matches the design", () => {
  it("[api/test/provisioning-endstate.test.ts] T41-AC1: a fresh provision ends active with N published, categorized, authored, SEO'd, image-bearing articles + logo + hero + brand seeded; zero outbound fetch L2_AUTO_DISAMBIGUATION:T41-AC1:RC-068", async () => {
    const { store, summary, fetchCalls } = await provisionWorld();

    // The build completed end-to-end. rescue-4: the two chunked per-article
    // steps each return in_progress once per unit (one article body / one
    // image per advanceNextStep), so a full drive runs MORE advanceNextStep
    // iterations than there are steps — the contract is that it reaches
    // 'completed' (status), not a fixed step count.
    expect(summary.final_status).toBe("completed");
    expect(summary.steps_run).toBeGreaterThanOrEqual(TOTAL_STEPS);

    // cf_dry_run: ZERO outbound fetch — and specifically none to Cloudflare.
    expect(fetchCalls).toHaveLength(0);
    expect(fetchCalls.some((u) => u.indexOf("api.cloudflare.com") >= 0)).toBe(false);

    // status=active (D1 select-back through the runner's own status read).
    const siteStatus = await store.db
      .prepare("SELECT status FROM sites WHERE id = ? LIMIT 1")
      .bind(store.site.id)
      .first<{ status: string }>();
    expect(siteStatus?.status).toBe("active");

    // N PUBLISHED articles (status + published_at) — D1 COUNT select-back.
    const publishedRow = await store.db
      .prepare(
        "SELECT COUNT(*) AS published_count FROM articles WHERE site_id = ? " +
          "AND status = 'published' AND published_at IS NOT NULL",
      )
      .bind(store.site.id)
      .first<{ published_count: number }>();
    expect(publishedRow?.published_count).toBe(15);

    // Every starter article carries the full editorial + image end-state.
    expect(store.articles).toHaveLength(15);
    for (const a of store.articles) {
      expect(a.status).toBe("published");
      expect(a.published_at).not.toBeNull();
      // category REQUIRED (D10) and drawn from the site's allocated set.
      expect(a.category_id).not.toBeNull();
      expect(store.siteCategories.some((c) => c.category_id === a.category_id)).toBe(true);
      // author present and NOT a user email.
      expect((a.author_name ?? "").length).toBeGreaterThan(0);
      expect(a.author_name ?? "").not.toContain("@");
      // SEO present.
      expect((a.seo_title ?? "").length).toBeGreaterThan(0);
      expect((a.seo_description ?? "").length).toBeGreaterThan(0);
      // featured image assigned (media row created by the image step).
      expect(a.featured_image_id).not.toBeNull();
      expect(store.media.some((m) => m.id === a.featured_image_id)).toBe(true);
    }

    // logo + hero + brand SET — D1 select-back of the site_settings keys.
    const settingsRows = await store.db
      .prepare("SELECT key AS key, value AS value FROM site_settings WHERE site_id = ?")
      .bind(store.site.id)
      .all<{ key: string; value: string }>();
    const settings = new Map(settingsRows.results.map((r) => [r.key, r.value]));
    expect((settings.get("logo_media_id") ?? "").length).toBeGreaterThan(0);
    expect((settings.get("hero_image_media_id") ?? "").length).toBeGreaterThan(0);
    // brand tokens seeded (key present so the design-system brand applies).
    expect(settings.has("brand_tokens_json")).toBe(true);
  });

  it("[api/test/provisioning-endstate.test.ts] T41-AC2: the provisioned site's live home renders the populated 13-section design — every section marker present, real article + media content, and NONE of the bare/empty-state markers L2_AUTO_DISAMBIGUATION:T41-AC2:RC-069", async () => {
    const { store } = await provisionWorld();

    const siteContext: PublicSiteContext = {
      site_id: store.site.id,
      siteId: store.site.id,
      hostname: store.site.primary_domain,
      vertical_slug: store.site.vertical_slug,
      status: "active",
      content_version: store.site.content_version,
      settings_version: 0,
    };

    // The SHIPPED live home renderer, fed the provisioned D1 state.
    const html = await renderHomepageHtml(store.db, siteContext);

    // All 13 ordered section markers render (the full theiwise design).
    for (let n = 1; n <= 13; n++) {
      expect(html).toContain(`<!-- home-section:${n} `);
    }
    expect(html).toContain("data-screen-label=theiwise-home");

    // Populated — real article links + media-served images flow into the
    // design (not a bare shell). At least several /article/ + /media/ refs.
    const articleRefs = html.split('href="/article/').length - 1;
    expect(articleRefs).toBeGreaterThanOrEqual(5);
    expect(html.indexOf("/media/")).toBeGreaterThanOrEqual(0);
    // The site's own brand string is present (no leaked hardcoded brand).
    expect(html).toContain(store.site.name);

    // html_negative: NONE of the empty/bare-state markers appear — the
    // buckets the home template falls back to when a tenant has no content.
    for (const marker of EMPTY_STATE_MARKERS) {
      expect(html).not.toContain(marker);
    }
  });
});
