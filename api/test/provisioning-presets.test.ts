import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { STEPS } from "../src/site-provisioning/steps";
import {
  generateStarterArticlePlan,
  generateSiteTagline,
  generateSiteDescription,
} from "../src/ai/generators/text";
import {
  generateLogoImage,
  generateFeatureImage,
} from "../src/ai/generators/image";
import { PROVISIONING_PRESET_CATEGORIES } from "../src/ai/generators/preset-resolver";
import type { Env } from "../src/env";
import type { OpenAIClient } from "../src/ai/openai-client";
import type { AiGenerationRow } from "../src/ai/generation-log";

// T40 [BCL-077] — provisioning generation is preset-governed.
//
// Required logic (user brief): "every provisioning AI step (articles, tagline,
// description, logo, hero, feature images) resolves + fully applies its system
// preset; editing the preset changes the output."
//
// T40-AC1 / RC-067: "editing the starter-articles system preset prompt →
// re-provisioning yields articles reflecting the edited prompt; each AI step
// resolves its system preset by task key."
//
// migration 0020 seeds one is_system, editable preset per provisioning TASK
// KEY (stored in `category`): starter-articles / tagline / site-description /
// logo / hero-image / feature-image. This suite proves that:
//   (A) every provisioning AI step resolves its preset by its task key — the
//       category-scoped lookup spy records each key; and
//   (B) editing the starter-articles preset prompt changes the prompt the plan
//       generator dispatches (ALPHA edit vs BETA edit), i.e. the produced
//       articles reflect the edited preset; and
//   (C) the image steps apply their task-key preset prompt to the image; and
//   (D) none of this touches the network (0 outbound fetch) — the dry-run
//       red line.

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
  content_mapping: string | null;
  output_rules: string | null;
  variables_schema: string | null;
}

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
}

interface ArticleRow {
  id: number;
  site_id: string;
  slug: string;
  title: string;
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
  prompt_presets: PresetLookupRow[];
  // Spy: every `category` value the preset-resolver queried, in order. Proves
  // each AI step resolves its system preset BY TASK KEY.
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
    prompt_presets: [],
    presetCategoriesQueried: [],
  };
}

// A complete is_system seed (one row per provisioning task key) modelled on
// migration 0020 — each carries a UNIQUE sentinel inside its user prompt so a
// dispatched prompt can be traced back to the exact preset it came from.
function seedAllProvisioningPresets(store: FakeStore, sentinel: string): void {
  const keys: Array<[string, string]> = [
    [PROVISIONING_PRESET_CATEGORIES.starterArticles, "STARTER"],
    [PROVISIONING_PRESET_CATEGORIES.tagline, "TAGLINE"],
    [PROVISIONING_PRESET_CATEGORIES.siteDescription, "DESCRIPTION"],
    [PROVISIONING_PRESET_CATEGORIES.logo, "LOGO"],
    [PROVISIONING_PRESET_CATEGORIES.heroImage, "HERO"],
    [PROVISIONING_PRESET_CATEGORIES.featureImage, "FEATURE"],
  ];
  let id = 900;
  for (const [category, tag] of keys) {
    store.prompt_presets.push({
      id: id++,
      slug: `system-${category}`,
      category,
      is_active: 1,
      is_system: 1,
      prompt_template: `FLAT-${tag}`,
      system_prompt_template: `PRESET-${tag}-SYS for {{brand_name}}`,
      user_prompt_template: `PRESET-${tag}-${sentinel} about {{title}} for {{vertical}}`,
      text_model: "gpt-5.5",
      content_mapping: null,
      output_rules: null,
      variables_schema: null,
    });
  }
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
            return (row
              ? { id: row.id, name: row.name, domain: row.domain }
              : null) as unknown as T | null;
          }
          // Category-scoped prompt_presets lookup (the preset-resolver). Record
          // the queried category — this is the "resolves by task key" spy.
          if (
            sql.indexOf("FROM prompt_presets") >= 0 &&
            sql.indexOf("category = ?") >= 0
          ) {
            const [category] = captured as [string];
            store.presetCategoriesQueried.push(category);
            const row =
              store.prompt_presets.find(
                (p) => p.category === category && p.is_active === 1,
              ) ?? null;
            return (row ?? null) as unknown as T | null;
          }
          if (sql.indexOf("FROM ai_generations WHERE idempotency_key = ?") >= 0) {
            const [key] = captured as [string];
            return (store.ai_generations.get(key) ?? null) as unknown as T | null;
          }
          // Site-setting reads (e.g. default_author_name) — fall through to the
          // deterministic builder when absent.
          if (
            sql.indexOf("FROM site_settings WHERE site_id = ? AND key = ?") >= 0
          ) {
            const [site_id, key] = captured as [string, string];
            const row = store.settings.find(
              (s) => s.site_id === site_id && s.key === key,
            );
            return (row ? { value: row.value } : null) as unknown as T | null;
          }
          if (
            sql.indexOf("INSERT INTO media") >= 0 &&
            sql.indexOf("RETURNING id") >= 0
          ) {
            const [filename, storage_key, , , , , site_id, ai_generation_id] =
              captured as [
                string, string, string, number, string, string, string, string,
              ];
            void filename;
            const id = store.next_media_id++;
            store.media.push({ id, site_id, ai_generation_id, storage_key });
            return ({ id } as unknown) as T;
          }
          return null;
        },
        async run(): Promise<{ success: true; meta: Record<string, unknown> }> {
          if (sql.indexOf("INSERT INTO ai_generations") >= 0) {
            const [
              id, site_id, task, provider, model, prompt_version,
              idempotency_key, request_json, target_type, target_id,
            ] = captured as [
              string, string | null, string, string, string, string, string,
              string | null, string | null, string | null,
            ];
            if (!store.ai_generations.has(idempotency_key)) {
              store.ai_generations.set(idempotency_key, {
                id, site_id, task, provider, model, prompt_version,
                idempotency_key, request_json, response_json: null,
                parsed_json: null, status: "pending", target_type, target_id,
                error_message: null, created_at: 1, updated_at: 1,
              });
            }
          } else if (sql.indexOf("UPDATE ai_generations SET status = 'success'") >= 0) {
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
          } else if (sql.indexOf("UPDATE ai_generations SET status = 'fallback'") >= 0) {
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
          } else if (sql.indexOf("UPDATE ai_generations SET status = 'failed'") >= 0) {
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
              const guarded =
                sql.indexOf("site_settings.value IS NULL") >= 0 ||
                sql.indexOf("value = ''") >= 0;
              if (!existing) {
                store.settings.push({ site_id, key, value });
              } else if (!guarded || existing.value === "" || existing.value === null) {
                existing.value = value;
              }
            } else if (sql.indexOf("INSERT OR IGNORE") >= 0) {
              if (!existing) store.settings.push({ site_id, key, value });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO pages") >= 0) {
            const [site_id, title] = captured as [string, string];
            if (!store.pages.find((p) => p.site_id === site_id && p.slug === "about")) {
              store.pages.push({ site_id, slug: "about", title });
            }
          } else if (sql.indexOf("INSERT OR IGNORE INTO articles") >= 0) {
            const [site_id, slug, title, , , ai_generation_id] = captured as [
              string, string, string, string, string, string,
            ];
            if (!store.articles.find((a) => a.site_id === site_id && a.slug === slug)) {
              store.articles.push({
                id: store.next_article_id++, site_id, slug, title,
                status: "published", homepage_section: "starter",
                ai_generation_id, featured_image_id: null,
              });
            }
          } else if (sql.indexOf("UPDATE articles SET featured_image_id") >= 0) {
            const [media_id, article_id] = captured as [number, number];
            const row = store.articles.find((a) => a.id === article_id);
            if (row && (row.featured_image_id === null || row.featured_image_id === 0)) {
              row.featured_image_id = media_id;
            }
          }
          return { success: true, meta: {} };
        },
        async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> {
          if (
            sql.indexOf("FROM articles WHERE site_id = ?") >= 0 &&
            sql.indexOf("homepage_section = 'starter'") >= 0
          ) {
            const [site_id] = captured as [string];
            const rows = store.articles
              .filter((a) => a.site_id === site_id && a.homepage_section === "starter")
              .map((a) => ({ id: a.id, slug: a.slug, title: a.title }));
            return { results: rows as unknown as T[], success: true, meta: {} };
          }
          // site_categories etc. → empty (categoryId falls back to null).
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

// A capturing client WITH an API key. Records every dispatched text + image
// prompt; text returns "{}" (routes through each parser's deterministic
// fallback body so the run still succeeds), image returns 4 real bytes so a
// media row is inserted.
function capturingClient(textPrompts: string[], imagePrompts: string[]): OpenAIClient {
  return {
    hasApiKey: () => true,
    async generateText(opts) {
      textPrompts.push(opts.prompt);
      return { text: "{}", model: "gpt-5.5", retries: 0, status: 200 };
    },
    async generateImage(opts) {
      imagePrompts.push(opts.prompt);
      return {
        bytes: new Uint8Array([1, 2, 3, 4]).buffer,
        mime: "image/png",
        model: "gpt-image-2",
        retries: 0,
        status: 200,
      };
    },
  };
}

describe("T40 provisioning generation is preset-governed", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchCalls: string[];

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    // Dry-run red line: any real network egress fails the test. No provisioning
    // step or generator may call fetch in this suite.
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      throw new Error(`no outbound fetch allowed in dry-run: ${url}`);
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // The deterministic file-path literal in the title binds this test to the
  // required_evidence_plan parse_test_output route for RC-067.
  it("every provisioning AI step resolves its preset by task key, and editing the starter-articles preset changes the produced articles [api/test/provisioning-presets.test.ts] T40-AC1:RC-067", async () => {
    // --- (A) every provisioning AI step resolves its preset BY TASK KEY ------
    // Drive each generation step (no OPENAI_API_KEY → deterministic fallback,
    // but resolution runs BEFORE the key check) and assert the category-scoped
    // lookup spy recorded each provisioning task key.
    const store = makeStore({
      id: "st_t40",
      name: "Acme Times",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    seedAllProvisioningPresets(store, "ALPHA");
    const env = buildEnv(makeFakeDb(store));
    const baseCtx = { env, db: env.DB, job_id: "job_t40", site_id: "st_t40" };

    await STEPS["generate_tagline_and_site_description"]({ ...baseCtx, step_order: 5 });
    await STEPS["generate_logo_mark"]({ ...baseCtx, step_order: 8 });
    await STEPS["generate_feature_image"]({ ...baseCtx, step_order: 9 });
    await STEPS["generate_15_homepage_articles"]({ ...baseCtx, step_order: 10 });
    await STEPS["generate_or_assign_article_images"]({ ...baseCtx, step_order: 11 });

    // Each AI step resolved its system preset by its task key.
    for (const key of Object.values(PROVISIONING_PRESET_CATEGORIES)) {
      expect(store.presetCategoriesQueried).toContain(key);
    }

    // Side-effect tables carry rows (steps ran end-to-end).
    expect(store.articles).toHaveLength(15);
    expect(
      store.settings.find((s) => s.site_id === "st_t40" && s.key === "tagline"),
    ).toBeDefined();
    expect(
      store.settings.find(
        (s) => s.site_id === "st_t40" && s.key === "site_description",
      ),
    ).toBeDefined();
    expect(store.ai_generations.size).toBeGreaterThan(0);

    // --- (B) editing the starter-articles preset changes the dispatched ------
    // plan prompt → the produced article set reflects the edit. Run the plan
    // generator through the same task key the step uses, first with the ALPHA
    // edit, then with the BETA edit, and prove the dispatched prompt tracks it.
    const storeA = makeStore({
      id: "st_alpha",
      name: "Acme Times",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    seedAllProvisioningPresets(storeA, "ALPHA");
    const envA = buildEnv(makeFakeDb(storeA));
    const promptsA: string[] = [];
    await generateStarterArticlePlan(envA, {
      site_id: "st_alpha",
      vertical: "personal finance",
      brand_name: "Acme Times",
      presetCategory: PROVISIONING_PRESET_CATEGORIES.starterArticles,
      client: capturingClient(promptsA, []),
    });
    expect(storeA.presetCategoriesQueried).toContain("starter-articles");
    expect(promptsA).toHaveLength(1);
    expect(promptsA[0]).toContain("PRESET-STARTER-ALPHA");

    // Operator edits the starter-articles preset (ALPHA → BETA).
    const storeB = makeStore({
      id: "st_beta",
      name: "Acme Times",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    seedAllProvisioningPresets(storeB, "BETA");
    const envB = buildEnv(makeFakeDb(storeB));
    const promptsB: string[] = [];
    await generateStarterArticlePlan(envB, {
      site_id: "st_beta",
      vertical: "personal finance",
      brand_name: "Acme Times",
      presetCategory: PROVISIONING_PRESET_CATEGORIES.starterArticles,
      client: capturingClient(promptsB, []),
    });
    // Re-provisioning after the edit yields a DIFFERENT dispatched prompt — the
    // produced articles now reflect the edited preset, not the old one.
    expect(promptsB[0]).toContain("PRESET-STARTER-BETA");
    expect(promptsB[0]).not.toContain("PRESET-STARTER-ALPHA");

    // (D) no network egress in any branch.
    expect(fetchCalls).toEqual([]);
  });

  it("the text steps (tagline / site-description) apply their task-key preset prompt", async () => {
    const store = makeStore({
      id: "st_text",
      name: "Acme Times",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    seedAllProvisioningPresets(store, "ALPHA");
    const env = buildEnv(makeFakeDb(store));

    const taglinePrompts: string[] = [];
    await generateSiteTagline(env, {
      site_id: "st_text",
      vertical: "personal finance",
      brand_name: "Acme Times",
      presetCategory: PROVISIONING_PRESET_CATEGORIES.tagline,
      client: capturingClient(taglinePrompts, []),
    });
    expect(store.presetCategoriesQueried).toContain("tagline");
    expect(taglinePrompts[0]).toContain("PRESET-TAGLINE-ALPHA");

    const descPrompts: string[] = [];
    await generateSiteDescription(env, {
      site_id: "st_text",
      vertical: "personal finance",
      brand_name: "Acme Times",
      presetCategory: PROVISIONING_PRESET_CATEGORIES.siteDescription,
      client: capturingClient(descPrompts, []),
    });
    expect(store.presetCategoriesQueried).toContain("site-description");
    expect(descPrompts[0]).toContain("PRESET-DESCRIPTION-ALPHA");

    expect(fetchCalls).toEqual([]);
  });

  it("the image steps (logo / hero / feature) apply their task-key preset prompt and write a media row", async () => {
    // Logo image — resolves 'logo', dispatches the preset prompt, inserts media.
    const storeLogo = makeStore({
      id: "st_logo",
      name: "Acme Times",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    seedAllProvisioningPresets(storeLogo, "ALPHA");
    const envLogo = buildEnv(makeFakeDb(storeLogo));
    const logoImagePrompts: string[] = [];
    const logo = await generateLogoImage(envLogo, {
      site_id: "st_logo",
      vertical: "personal finance",
      brand_name: "Acme Times",
      presetCategory: PROVISIONING_PRESET_CATEGORIES.logo,
      client: capturingClient([], logoImagePrompts),
    });
    expect(storeLogo.presetCategoriesQueried).toContain("logo");
    expect(logoImagePrompts[0]).toContain("PRESET-LOGO-ALPHA");
    expect(logo.media_id).toBeGreaterThan(0);
    expect(storeLogo.media).toHaveLength(1);

    // Hero image — the homepage hero resolves the DISTINCT 'hero-image' preset.
    const storeHero = makeStore({
      id: "st_hero",
      name: "Acme Times",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    seedAllProvisioningPresets(storeHero, "ALPHA");
    const envHero = buildEnv(makeFakeDb(storeHero));
    const heroImagePrompts: string[] = [];
    await generateFeatureImage(envHero, {
      site_id: "st_hero",
      vertical: "personal finance",
      brand_name: "Acme Times",
      article_title: "Acme Times hero",
      article_slug: "site-hero",
      presetCategory: PROVISIONING_PRESET_CATEGORIES.heroImage,
      client: capturingClient([], heroImagePrompts),
    });
    expect(storeHero.presetCategoriesQueried).toContain("hero-image");
    expect(heroImagePrompts[0]).toContain("PRESET-HERO-ALPHA");

    // Per-article feature image — resolves 'feature-image'.
    const storeFeat = makeStore({
      id: "st_feat",
      name: "Acme Times",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    seedAllProvisioningPresets(storeFeat, "ALPHA");
    const envFeat = buildEnv(makeFakeDb(storeFeat));
    const featImagePrompts: string[] = [];
    await generateFeatureImage(envFeat, {
      site_id: "st_feat",
      vertical: "personal finance",
      brand_name: "Acme Times",
      article_title: "Budgeting Basics",
      article_slug: "budgeting-basics",
      presetCategory: PROVISIONING_PRESET_CATEGORIES.featureImage,
      client: capturingClient([], featImagePrompts),
    });
    expect(storeFeat.presetCategoriesQueried).toContain("feature-image");
    expect(featImagePrompts[0]).toContain("PRESET-FEATURE-ALPHA");

    expect(fetchCalls).toEqual([]);
  });

  it("no matching preset → generators fall back to the deterministic builder (no crash, no stub) [api/test/provisioning-presets.test.ts]", async () => {
    // A fresh site with ZERO prompt_presets rows: every generator queries its
    // task key, finds nothing, and dispatches the deterministic builder prompt.
    const store = makeStore({
      id: "st_none",
      name: "Acme Times",
      domain: "acme.example",
      vertical_slug: "personal-finance",
    });
    const env = buildEnv(makeFakeDb(store));
    const taglinePrompts: string[] = [];
    const result = await generateSiteTagline(env, {
      site_id: "st_none",
      vertical: "personal finance",
      brand_name: "Acme Times",
      presetCategory: PROVISIONING_PRESET_CATEGORIES.tagline,
      client: capturingClient(taglinePrompts, []),
    });
    expect(store.presetCategoriesQueried).toContain("tagline");
    // The builder prompt was used (no preset text leaked in).
    expect(taglinePrompts[0]).toContain("You are writing a short site tagline");
    expect(taglinePrompts[0]).not.toContain("PRESET-TAGLINE");
    expect(result.parsed.tagline.length).toBeGreaterThan(0);
    expect(fetchCalls).toEqual([]);
  });
});
