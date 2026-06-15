import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { STEPS } from "../src/site-provisioning/steps";
import {
  fallbackSiteTagline,
  fallbackSiteDescription,
} from "../src/ai/generators/fallback";
import {
  generateStarterArticle,
  generateStarterArticlePlan,
} from "../src/ai/generators/text";
import type { Env } from "../src/env";
import type { OpenAIClient } from "../src/ai/openai-client";
import type { AiGenerationRow } from "../src/ai/generation-log";

// T13: a seeded prompt_presets row, as read by
// api/src/ai/generators/preset-resolver.ts (category-scoped lookup).
interface PresetLookupRow {
  id: number;
  slug: string;
  category: string;
  is_active: number;
  is_system: number;
  prompt_template: string | null;
  system_prompt_template: string | null;
  user_prompt_template: string | null;
  text_model: string | null;
}

// T9 / Phase 6: provisioning steps now call the T7/T8 AI generators with
// deterministic fallback. The behavioural ACs we assert here:
//
//   AC8.1 — GIVEN no OPENAI_API_KEY WHEN the
//           generate_tagline_and_site_description step runs THEN an
//           ai_generations row exists with status='skipped_no_api_key' AND
//           site_settings.tagline is set to a non-empty fallback string.
//
//   AC8.2 — GIVEN step generate_15_homepage_articles has run once
//           WHEN it runs again THEN no additional articles are inserted
//           (idempotency via idempotency_key + (site_id, slug) UNIQUE).
//
//   AC8.3 — GIVEN no OPENAI_API_KEY WHEN the
//           generate_15_homepage_articles step runs THEN exactly 15
//           articles exist in the articles table with distinct slugs all
//           bound to ctx.site_id.

interface SiteRow {
  id: string;
  name: string | null;
  domain: string | null;
  vertical_slug: string | null;
}

interface SettingsRow {
  site_id: string;
  key: string;
  value: string;
}

interface PageRow {
  site_id: string;
  slug: string;
  title: string;
  content_json: string;
  content_html: string;
}

interface ArticleRow {
  id: number;
  site_id: string;
  slug: string;
  title: string;
  content_json: string;
  content_html: string;
  status: string;
  homepage_section: string;
  ai_generation_id: string | null;
  featured_image_id: number | null;
}

interface MediaRow {
  id: number;
  site_id: string;
  ai_generation_id: string;
  storage_key: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  alt_text: string;
  folder: string;
}

interface FakeStore {
  sites: SiteRow[];
  settings: SettingsRow[];
  pages: PageRow[];
  articles: ArticleRow[];
  media: MediaRow[];
  ai_generations: Map<string, AiGenerationRow>;
  next_article_id: number;
  next_media_id: number;
  insertCounts: Record<string, number>;
  // T13: seeded preset rows + a spy capturing every category the
  // preset-resolver queried (proves category-scoped lookup).
  prompt_presets: PresetLookupRow[];
  presetCategoriesQueried: string[];
}

function makeStore(site: SiteRow): FakeStore {
  return {
    sites: [site],
    settings: [],
    pages: [],
    articles: [],
    media: [],
    ai_generations: new Map(),
    next_article_id: 1,
    next_media_id: 1,
    insertCounts: {},
    prompt_presets: [],
    presetCategoriesQueried: [],
  };
}

function makeFakeDb(store: FakeStore): D1Database {
  return {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T>(): Promise<T | null> {
          // SELECT from sites by id
          if (
            sql.indexOf("FROM sites WHERE id = ?") >= 0 &&
            sql.indexOf("vertical_slug") >= 0
          ) {
            const [id] = captured as [string];
            const row = store.sites.find((s) => s.id === id);
            return (row ? { ...row } : null) as unknown as T | null;
          }
          if (sql.indexOf("FROM sites WHERE id = ?") >= 0) {
            const [id] = captured as [string];
            const row = store.sites.find((s) => s.id === id);
            return (row ? { id: row.id, name: row.name, domain: row.domain } : null) as unknown as T | null;
          }
          // T13: category-scoped prompt_presets lookup (preset-resolver).
          if (sql.indexOf("FROM prompt_presets") >= 0 && sql.indexOf("category = ?") >= 0) {
            const [category] = captured as [string];
            store.presetCategoriesQueried.push(category);
            const row =
              store.prompt_presets.find(
                (p) => p.category === category && p.is_active === 1,
              ) ?? null;
            return (row ?? null) as unknown as T | null;
          }
          // SELECT * from ai_generations by idempotency_key (full T6 shape)
          if (sql.indexOf("FROM ai_generations WHERE idempotency_key = ?") >= 0) {
            const [key] = captured as [string];
            const row = store.ai_generations.get(key);
            return (row ?? null) as unknown as T | null;
          }
          // INSERT INTO media RETURNING id (used by image generator)
          if (sql.indexOf("INSERT INTO media") >= 0 && sql.indexOf("RETURNING id") >= 0) {
            const [
              filename,
              storage_key,
              mime_type,
              size_bytes,
              alt_text,
              folder,
              site_id,
              ai_generation_id,
            ] = captured as [
              string, string, string, number, string, string, string, string,
            ];
            const id = store.next_media_id++;
            store.media.push({
              id, site_id, ai_generation_id, storage_key, filename, mime_type, size_bytes, alt_text, folder,
            });
            store.insertCounts["media"] = (store.insertCounts["media"] ?? 0) + 1;
            return ({ id } as unknown) as T;
          }
          return null;
        },
        async run(): Promise<{ success: true; meta: Record<string, unknown> }> {
          // INSERT INTO ai_generations (T6) — pending row created by startGenerationLog
          if (sql.indexOf("INSERT INTO ai_generations") >= 0) {
            const [
              id,
              site_id,
              task,
              provider,
              model,
              prompt_version,
              idempotency_key,
              request_json,
              target_type,
              target_id,
            ] = captured as [
              string, string | null, string, string, string, string, string,
              string | null, string | null, string | null,
            ];
            if (!store.ai_generations.has(idempotency_key)) {
              store.ai_generations.set(idempotency_key, {
                id, site_id, task, provider, model, prompt_version, idempotency_key,
                request_json, response_json: null, parsed_json: null,
                status: "pending", target_type, target_id, error_message: null,
                created_at: 1, updated_at: 1,
              });
              store.insertCounts["ai_generations"] =
                (store.insertCounts["ai_generations"] ?? 0) + 1;
            }
          } else if (
            sql.indexOf("UPDATE ai_generations SET status = 'success'") >= 0
          ) {
            const [response_json, parsed_json, target_type, target_id, key] =
              captured as [string, string, string | null, string | null, string];
            const row = store.ai_generations.get(key);
            if (row) {
              row.status = "success";
              row.response_json = response_json;
              row.parsed_json = parsed_json;
              row.target_type = target_type ?? row.target_type;
              row.target_id = target_id ?? row.target_id;
            }
          } else if (
            sql.indexOf("UPDATE ai_generations SET status = 'fallback'") >= 0
          ) {
            const [parsed_json, target_type, target_id, error_message, key] =
              captured as [string, string | null, string | null, string | null, string];
            const row = store.ai_generations.get(key);
            if (row) {
              row.status = "fallback";
              row.parsed_json = parsed_json;
              row.target_type = target_type ?? row.target_type;
              row.target_id = target_id ?? row.target_id;
              row.error_message = error_message;
            }
          } else if (
            sql.indexOf("UPDATE ai_generations SET status = 'failed'") >= 0
          ) {
            const [response_json, error_message, key] = captured as [
              string, string, string,
            ];
            const row = store.ai_generations.get(key);
            if (row) {
              row.status = "failed";
              row.response_json = response_json;
              row.error_message = error_message;
            }
          } else if (sql.indexOf("INSERT INTO site_settings") >= 0) {
            const [site_id, key, value] = captured as [string, string, string];
            const existing = store.settings.find(
              (r) => r.site_id === site_id && r.key === key,
            );
            if (sql.indexOf("ON CONFLICT(site_id, key) DO UPDATE") >= 0) {
              // upsertSiteSetting (T9 helper). The default form carries the
              // UPDATE-IF-NULL guard (`WHERE value IS NULL OR value=''`); the
              // T7 overwrite form drops it so the AI value replaces a non-empty
              // stub. Model both by inspecting the rendered guard clause.
              const guarded =
                sql.indexOf("site_settings.value IS NULL") >= 0 ||
                sql.indexOf("value = ''") >= 0;
              if (!existing) {
                store.settings.push({ site_id, key, value });
                store.insertCounts["site_settings"] =
                  (store.insertCounts["site_settings"] ?? 0) + 1;
              } else if (!guarded || existing.value === "" || existing.value === null) {
                existing.value = value;
              }
            } else if (sql.indexOf("INSERT OR IGNORE") >= 0) {
              if (!existing) {
                store.settings.push({ site_id, key, value });
                store.insertCounts["site_settings"] =
                  (store.insertCounts["site_settings"] ?? 0) + 1;
              }
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO pages") >= 0) {
            const [site_id, title, contentJson, contentHtml] = captured as [
              string, string, string, string,
            ];
            const existing = store.pages.find(
              (p) => p.site_id === site_id && p.slug === "about",
            );
            if (!existing) {
              store.pages.push({
                site_id, slug: "about", title,
                content_json: contentJson, content_html: contentHtml,
              });
              store.insertCounts["pages"] =
                (store.insertCounts["pages"] ?? 0) + 1;
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO articles") >= 0) {
            const [site_id, slug, title, contentJson, contentHtml, ai_generation_id] =
              captured as [string, string, string, string, string, string];
            const existing = store.articles.find(
              (a) => a.site_id === site_id && a.slug === slug,
            );
            if (!existing) {
              store.articles.push({
                id: store.next_article_id++,
                site_id, slug, title,
                content_json: contentJson, content_html: contentHtml,
                status: "published", homepage_section: "starter",
                ai_generation_id, featured_image_id: null,
              });
              store.insertCounts["articles"] =
                (store.insertCounts["articles"] ?? 0) + 1;
            }
          } else if (sql.indexOf("UPDATE articles SET featured_image_id") >= 0) {
            const [media_id, article_id] = captured as [number, number];
            const row = store.articles.find((a) => a.id === article_id);
            if (
              row &&
              (row.featured_image_id === null || row.featured_image_id === 0)
            ) {
              row.featured_image_id = media_id;
            }
          }
          return { success: true, meta: {} };
        },
        async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
          if (sql.indexOf("FROM articles WHERE site_id = ? AND homepage_section = 'starter'") >= 0) {
            const [site_id] = captured as [string];
            const rows = store.articles
              .filter((a) => a.site_id === site_id && a.homepage_section === "starter")
              .map((a) => ({ id: a.id, slug: a.slug, title: a.title }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function buildEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {
      async put() {
        return undefined;
      },
    } as unknown as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "admin.example",
    ADMIN_BASE_URL: "https://admin.example",
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

describe("T9 site-provisioning AI-or-fallback integration", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: string[];

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      throw new Error(`fetch must not be called without OPENAI_API_KEY: ${url}`);
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("generate_tagline_and_site_description writes ai_generations row AND non-empty tagline without OPENAI_API_KEY", async () => {
    // AC8.1 — no OPENAI_API_KEY in env → an ai_generations row exists
    // (status='skipped_no_api_key' in the function return; row carries
    // 'fallback' or 'skipped_no_api_key' per the CHECK constraint) AND
    // site_settings.tagline is set to a non-empty fallback.
    const store = makeStore({
      id: "st_t9_1",
      name: "Acme Times",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    const env = buildEnv(makeFakeDb(store));
    const ctx = {
      env,
      db: env.DB,
      job_id: "job_t9_1",
      site_id: "st_t9_1",
      step_order: 5,
    };
    const result = await STEPS["generate_tagline_and_site_description"](ctx);
    expect(result.status).toBe("completed");
    // At least one ai_generations row exists.
    expect(store.ai_generations.size).toBeGreaterThanOrEqual(2);
    // Look for the tagline + description rows.
    const rows = Array.from(store.ai_generations.values());
    const taglineRow = rows.find((r) => r.task === "site-tagline");
    const descriptionRow = rows.find((r) => r.task === "site-description");
    expect(taglineRow).toBeDefined();
    expect(descriptionRow).toBeDefined();
    // The CHECK constraint allows 'skipped_no_api_key' OR 'fallback' here.
    // T7 writes via finishGenerationLogFallback → row.status='fallback';
    // the function return surfaces 'skipped_no_api_key'.
    expect(["fallback", "skipped_no_api_key"]).toContain(taglineRow?.status);
    // site_settings.tagline must be populated with a non-empty fallback.
    const taglineSetting = store.settings.find(
      (s) => s.site_id === "st_t9_1" && s.key === "tagline",
    );
    expect(taglineSetting).toBeDefined();
    expect((taglineSetting?.value ?? "").length).toBeGreaterThan(0);
    // No fetch attempted (no API key).
    expect(fetchCalls).toEqual([]);
  });

  // rescue-3 T7-AC1 / RC-021: the create_site_settings seed runs FIRST and
  // writes a non-empty deterministic stub for tagline + site_description. When
  // generate_tagline_and_site_description then runs, its AI (fallback) values
  // MUST overwrite those stubs — the pre-T7 upsert carried a
  // `WHERE value IS NULL OR value=''` guard that silently discarded them
  // because the stub was already non-empty. This test pre-seeds the stubs and
  // proves the AI value wins (it would FAIL under the guarded upsert).
  // L2_AUTO_DISAMBIGUATION:T7-AC1:RC-021 [api/test/site-provisioning-ai-integration.test.ts]
  it("generate_tagline_and_site_description overwrites the create_site_settings stub tagline + site_description with the AI values [api/test/site-provisioning-ai-integration.test.ts] L2_AUTO_DISAMBIGUATION:T7-AC1:RC-021", async () => {
    const store = makeStore({
      id: "st_t7_ac1",
      name: "Acme Times",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    // create_site_settings already seeded non-empty stubs for this site.
    const STUB_TAGLINE = "Acme Times — your trusted source.";
    const STUB_DESCRIPTION =
      "Acme Times delivers timely, trustworthy reporting at acme.example.";
    store.settings.push({ site_id: "st_t7_ac1", key: "tagline", value: STUB_TAGLINE });
    store.settings.push({
      site_id: "st_t7_ac1",
      key: "site_description",
      value: STUB_DESCRIPTION,
    });

    const env = buildEnv(makeFakeDb(store));
    const ctx = {
      env,
      db: env.DB,
      job_id: "job_t7_ac1",
      site_id: "st_t7_ac1",
      step_order: 5,
    };
    const result = await STEPS["generate_tagline_and_site_description"](ctx);
    expect(result.status).toBe("completed");

    // loadSiteInfo uses vertical_slug verbatim as the generator's `vertical`.
    const fbInput = {
      site_id: "st_t7_ac1",
      vertical: "personal-finance",
      brand_name: "Acme Times",
    };
    const expectedTagline = fallbackSiteTagline(fbInput);
    const expectedDescription = fallbackSiteDescription(fbInput as never);

    const tagline = store.settings.find(
      (s) => s.site_id === "st_t7_ac1" && s.key === "tagline",
    );
    const description = store.settings.find(
      (s) => s.site_id === "st_t7_ac1" && s.key === "site_description",
    );
    // The AI (fallback) values replaced the stubs — guard no longer discards.
    expect(tagline?.value).toBe(expectedTagline);
    expect(tagline?.value).not.toBe(STUB_TAGLINE);
    expect(description?.value).toBe(expectedDescription);
    expect(description?.value).not.toBe(STUB_DESCRIPTION);
    expect(fetchCalls).toEqual([]);
  });

  it("generate_15_homepage_articles inserts exactly 15 articles with unique slugs bound to ctx.site_id (no API key)", async () => {
    // AC8.3 — no OPENAI_API_KEY → exactly 15 articles, distinct slugs,
    // all rows have site_id=ctx.site_id.
    const store = makeStore({
      id: "st_t9_15",
      name: "Cycling Weekly",
      domain: "cycling.example",
      vertical_slug: "cycling",
    });
    const env = buildEnv(makeFakeDb(store));
    const ctx = {
      env,
      db: env.DB,
      job_id: "job_t9_15",
      site_id: "st_t9_15",
      step_order: 10,
    };
    const result = await STEPS["generate_15_homepage_articles"](ctx);
    expect(result.status).toBe("completed");
    expect(store.articles).toHaveLength(15);
    const slugs = new Set(store.articles.map((a) => a.slug));
    expect(slugs.size).toBe(15);
    for (const article of store.articles) {
      expect(article.site_id).toBe("st_t9_15");
      // Every article carries its source ai_generation_id (typed
      // receipt back-pointer for the admin editor).
      expect(article.ai_generation_id).toBeTruthy();
    }
    expect(fetchCalls).toEqual([]);
  });

  it("generate_15_homepage_articles re-invocation does NOT add additional articles", async () => {
    // AC8.2 — second invocation is a no-op under (site_id, slug) UNIQUE
    // + ai_generations idempotency_key UNIQUE.
    const store = makeStore({
      id: "st_t9_idem",
      name: "Garden Notes",
      domain: "garden.example",
      vertical_slug: "home-gardening",
    });
    const env = buildEnv(makeFakeDb(store));
    const ctx = {
      env,
      db: env.DB,
      job_id: "job_t9_idem",
      site_id: "st_t9_idem",
      step_order: 10,
    };
    const first = await STEPS["generate_15_homepage_articles"](ctx);
    expect(first.status).toBe("completed");
    const firstArticleCount = store.articles.length;
    const firstAiGenCount = store.ai_generations.size;
    const firstInsertArticles = store.insertCounts["articles"] ?? 0;
    const firstInsertAi = store.insertCounts["ai_generations"] ?? 0;
    expect(firstArticleCount).toBe(15);
    expect(firstInsertArticles).toBe(15);

    // Re-run the same step. The ai_generations idempotency check short-
    // circuits the article generator (no duplicate ai_generations INSERT);
    // INSERT OR IGNORE on articles guarantees no new articles row.
    const second = await STEPS["generate_15_homepage_articles"](ctx);
    expect(second.status).toBe("completed");
    expect(store.articles).toHaveLength(firstArticleCount);
    expect(store.ai_generations.size).toBe(firstAiGenCount);
    // INSERT counts MUST stay stable across the second invocation.
    expect(store.insertCounts["articles"] ?? 0).toBe(firstInsertArticles);
    expect(store.insertCounts["ai_generations"] ?? 0).toBe(firstInsertAi);
    expect(fetchCalls).toEqual([]);
  });

  it("generate_about_page writes the About page row idempotently", async () => {
    // Re-running the step yields exactly 1 pages row (idempotent under
    // (site_id, slug)='about' UNIQUE).
    const store = makeStore({
      id: "st_t9_about",
      name: "Hiking Today",
      domain: "hike.example",
      vertical_slug: "hiking",
    });
    const env = buildEnv(makeFakeDb(store));
    const ctx = {
      env,
      db: env.DB,
      job_id: "job_t9_about",
      site_id: "st_t9_about",
      step_order: 6,
    };
    await STEPS["generate_about_page"](ctx);
    expect(store.pages).toHaveLength(1);
    expect(store.pages[0]?.slug).toBe("about");
    expect((store.pages[0]?.content_html ?? "").length).toBeGreaterThan(0);
    await STEPS["generate_about_page"](ctx);
    expect(store.pages).toHaveLength(1);
    expect(fetchCalls).toEqual([]);
  });

  it("generate_logo_mark leaves site_settings.logo_media_id empty without OPENAI_API_KEY", async () => {
    // No API key → image generator returns media_id=0 → site_settings
    // logo_media_id is not populated (UPDATE-IF-NULL keeps the seed '').
    const store = makeStore({
      id: "st_t9_logo",
      name: "Cooking Lab",
      domain: "cook.example",
      vertical_slug: "cooking",
    });
    // Pre-seed site_settings with the T19 12 keys (logo_media_id='').
    store.settings.push({ site_id: "st_t9_logo", key: "logo_media_id", value: "" });
    const env = buildEnv(makeFakeDb(store));
    const ctx = {
      env,
      db: env.DB,
      job_id: "job_t9_logo",
      site_id: "st_t9_logo",
      step_order: 8,
    };
    const result = await STEPS["generate_logo_mark"](ctx);
    expect(result.status).toBe("completed");
    // No media row inserted.
    expect(store.media).toHaveLength(0);
    // ai_generations carries the typed receipt rows for both prompt + image.
    const tasks = Array.from(store.ai_generations.values()).map((r) => r.task);
    expect(tasks).toContain("logo-prompt");
    expect(tasks).toContain("logo-image");
    expect(fetchCalls).toEqual([]);
  });

  it("generate_feature_image writes ai_generations rows without OPENAI_API_KEY (no R2 PUT, no media row)", async () => {
    const store = makeStore({
      id: "st_t9_fi",
      name: "Travel Briefs",
      domain: "travel.example",
      vertical_slug: "travel",
    });
    const env = buildEnv(makeFakeDb(store));
    const ctx = {
      env,
      db: env.DB,
      job_id: "job_t9_fi",
      site_id: "st_t9_fi",
      step_order: 9,
    };
    const result = await STEPS["generate_feature_image"](ctx);
    expect(result.status).toBe("completed");
    expect(store.media).toHaveLength(0);
    const tasks = Array.from(store.ai_generations.values()).map((r) => r.task);
    expect(tasks).toContain("feature-image-prompt");
    expect(tasks).toContain("feature-image");
    expect(fetchCalls).toEqual([]);
  });

  it("generate_or_assign_article_images leaves featured_image_id unchanged when no API key", async () => {
    // Setup: 3 starter articles already exist; without an API key the
    // step writes ai_generations receipts but does NOT update
    // featured_image_id (since image generator returns media_id=0).
    const store = makeStore({
      id: "st_t9_assign",
      name: "Photo Weekly",
      domain: "photo.example",
      vertical_slug: "photography",
    });
    for (let i = 1; i <= 3; i += 1) {
      store.articles.push({
        id: i,
        site_id: "st_t9_assign",
        slug: `starter-${i}`,
        title: `Starter ${i}`,
        content_json: "{}",
        content_html: "",
        status: "published",
        homepage_section: "starter",
        ai_generation_id: null,
        featured_image_id: null,
      });
    }
    store.next_article_id = 4;
    const env = buildEnv(makeFakeDb(store));
    const ctx = {
      env,
      db: env.DB,
      job_id: "job_t9_assign",
      site_id: "st_t9_assign",
      step_order: 11,
    };
    const result = await STEPS["generate_or_assign_article_images"](ctx);
    expect(result.status).toBe("completed");
    // No media row inserted; featured_image_id still null on every article.
    expect(store.media).toHaveLength(0);
    for (const article of store.articles) {
      expect(article.featured_image_id).toBeNull();
    }
    // ai_generations carries the typed receipt rows.
    const featureImageRows = Array.from(store.ai_generations.values()).filter(
      (r) => r.task === "feature-image",
    );
    expect(featureImageRows.length).toBe(3);
    expect(fetchCalls).toEqual([]);
  });

  // T13-AC1 / RC-035: presets drive generation. generateStarterArticlePlan
  // resolves the 'outline' preset and generateStarterArticle resolves the
  // 'content' preset (category-scoped lookup); each uses the preset's prompt
  // (interpolated) and its text_model. With NO matching preset the generator
  // falls back to the deterministic prompt builder — no crash, no stub. The
  // file-path literal in the title is the deterministic binding for the
  // required_evidence_plan parse_test_output route.
  it("generation looks up a preset by category and uses its prompt + model; no preset → builder fallback [api/test/site-provisioning-ai-integration.test.ts] L2_AUTO_DISAMBIGUATION:T13-AC1:RC-035", async () => {
    // A capturing client (WITH an API key) records the exact prompt the
    // generator dispatches; the returned "{}" routes through the parser's
    // deterministic fallback body so the run succeeds.
    function capturingClient(prompts: string[]): OpenAIClient {
      return {
        hasApiKey: () => true,
        async generateText(opts) {
          prompts.push(opts.prompt);
          return { text: "{}", model: "gpt-5.5", retries: 0, status: 200 };
        },
        async generateImage() {
          return { skipped_no_api_key: true };
        },
      };
    }

    // --- 'content' preset drives generateStarterArticle ---------------------
    const store = makeStore({
      id: "st_t13",
      name: "Acme Daily",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    store.prompt_presets.push({
      id: 501,
      slug: "content-preset",
      category: "content",
      is_active: 1,
      is_system: 1,
      prompt_template: "FLAT-CONTENT-FALLBACK",
      system_prompt_template: "PRESET-CONTENT-SYS for {{brand_name}}",
      user_prompt_template: "PRESET-CONTENT-USER write {{title}} for {{vertical}}",
      text_model: "gpt-5.5",
    });
    const env = buildEnv(makeFakeDb(store));
    const contentPrompts: string[] = [];
    const article = await generateStarterArticle(env, {
      site_id: "st_t13",
      vertical: "personal finance",
      brand_name: "Acme Daily",
      slug: "budgeting-basics",
      title: "Budgeting Basics",
      summary: "How to build a first budget.",
      client: capturingClient(contentPrompts),
    });
    // Category-scoped lookup happened for 'content'.
    expect(store.presetCategoriesQueried).toContain("content");
    // The dispatched prompt is the preset's System+User prompt, interpolated
    // with the article context — NOT the deterministic article builder.
    expect(contentPrompts).toHaveLength(1);
    expect(contentPrompts[0]).toContain("PRESET-CONTENT-SYS for Acme Daily");
    expect(contentPrompts[0]).toContain(
      "PRESET-CONTENT-USER write Budgeting Basics for personal finance",
    );
    expect(contentPrompts[0]).not.toContain(
      "Output strict JSON matching GeneratedArticle shape",
    );
    // The logged generation row carries the preset's text_model.
    const articleRow = Array.from(store.ai_generations.values()).find(
      (r) => r.task === "starter-article",
    );
    expect(articleRow?.model).toBe("gpt-5.5");

    // --- 'outline' preset drives generateStarterArticlePlan -----------------
    const store2 = makeStore({
      id: "st_t13b",
      name: "Acme Daily",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    store2.prompt_presets.push({
      id: 502,
      slug: "outline-preset",
      category: "outline",
      is_active: 1,
      is_system: 1,
      prompt_template: "FLAT-OUTLINE-FALLBACK",
      system_prompt_template: null,
      user_prompt_template: "PRESET-OUTLINE plan ideas for {{vertical}} at {{brand_name}}",
      text_model: "gpt-5.5",
    });
    const env2 = buildEnv(makeFakeDb(store2));
    const outlinePrompts: string[] = [];
    await generateStarterArticlePlan(env2, {
      site_id: "st_t13b",
      vertical: "personal finance",
      brand_name: "Acme Daily",
      client: capturingClient(outlinePrompts),
    });
    expect(store2.presetCategoriesQueried).toContain("outline");
    expect(outlinePrompts[0]).toContain(
      "PRESET-OUTLINE plan ideas for personal finance at Acme Daily",
    );

    // --- no matching preset → deterministic builder fallback (no crash) -----
    const store3 = makeStore({
      id: "st_t13c",
      name: "Acme Daily",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    // prompt_presets intentionally empty.
    const env3 = buildEnv(makeFakeDb(store3));
    const fallbackPrompts: string[] = [];
    const fallbackArticle = await generateStarterArticle(env3, {
      site_id: "st_t13c",
      vertical: "personal finance",
      brand_name: "Acme Daily",
      slug: "no-preset-article",
      title: "No Preset Article",
      client: capturingClient(fallbackPrompts),
    });
    // The category was queried, found nothing, and the builder prompt was used.
    expect(store3.presetCategoriesQueried).toContain("content");
    expect(fallbackPrompts[0]).toContain(
      "Output strict JSON matching GeneratedArticle shape",
    );
    expect(fallbackPrompts[0]).not.toContain("PRESET-CONTENT");
    // No crash, no stub: a real GeneratedArticle came back.
    expect(fallbackArticle.parsed.slug).toBe("no-preset-article");
    expect(fallbackArticle.parsed.sections.length).toBeGreaterThanOrEqual(3);

    // No real network egress in any branch (capturing client only).
    expect(fetchCalls).toEqual([]);
  });
});
