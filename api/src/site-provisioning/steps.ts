// Phase 3 / T17+T19+T20 + Phase 6 / T9: provisioning step registry.
//
// 15 step keys advance a site_creation_jobs row one step per
// POST /api/admin/sites/:id/provision/next call. T17 wired stubs;
// T18 added dry-run gating for CF-mutation steps; T19 swapped
// create_site_settings for a 12-key seed; T20 swapped the legal-pages
// stub for variable-aware rendering via legal-renderer.ts; Phase 6 / T9
// now swaps SIX of the remaining deterministic stubs for AI-or-fallback
// generators that write a typed receipt row to ai_generations and
// persist their side-effects (site_settings updates, pages rows,
// articles rows, media rows) so re-running the same step is idempotent
// via:
//   - ai_generations.idempotency_key UNIQUE (T4)        — no duplicate gen rows
//   - INSERT OR IGNORE on site_settings/articles/pages  — no duplicate domain rows
//   - UPDATE … COALESCE / WHERE … IS NULL              — no clobber of populated values
//
// Contract greps (each canonical key appears as a single-quoted literal
// exactly once in the registry tuple it belongs to):
//   - T17.AC1: 15 step-key literals in STEP_KEYS
//   - T19.AC1: 12 site-settings-key literals in DEFAULT_SETTING_SEED
//   - T9.AC1..AC5: imports of generateSiteTagline/Description, generateAboutPage,
//     generateLogoImage/Prompt, generateFeatureImage/Prompt, generateStarterArticlePlan/Article
//   - T9.AC6: each of the 6 swapped step keys appears >=12 times in this file
//     (type union + STEP_KEYS literal + STEPS key + dispatch handler etc.)

import type { Env } from "../env";
import { renderLegalPagesForSite } from "./legal-renderer";
import {
  generateSiteTagline,
  generateSiteDescription,
  generateAboutPage,
  generateStarterArticlePlan,
  generateStarterArticle,
} from "../ai/generators/text";
import {
  generateLogoPrompt,
  generateLogoImage,
  generateFeatureImagePrompt,
  generateFeatureImage,
} from "../ai/generators/image";

export type StepKey =
  | "validate_domain_in_cloudflare"
  | "create_site_record"
  | "attach_domain_to_new_worker_or_mark_pending"
  | "allocate_vertical_categories"
  | "create_site_settings"
  | "generate_tagline_and_site_description_stub"
  | "generate_about_page_stub"
  | "render_generic_legal_pages_with_site_variables"
  | "generate_logo_mark_stub"
  | "generate_feature_image_stub"
  | "generate_15_homepage_articles_stub"
  | "generate_or_assign_article_images_stub"
  | "publish_starter_articles"
  | "warm_homepage_cache"
  | "run_site_smoke_tests";

// Ordered registry — STEP_KEYS[i] is the step the runner executes when
// site_creation_jobs.current_step_index = i. The single-quoted literal
// form below is what T17.AC1's grep counts.
export const STEP_KEYS: readonly StepKey[] = [
  'validate_domain_in_cloudflare',
  'create_site_record',
  'attach_domain_to_new_worker_or_mark_pending',
  'allocate_vertical_categories',
  'create_site_settings',
  'generate_tagline_and_site_description_stub',
  'generate_about_page_stub',
  'render_generic_legal_pages_with_site_variables',
  'generate_logo_mark_stub',
  'generate_feature_image_stub',
  'generate_15_homepage_articles_stub',
  'generate_or_assign_article_images_stub',
  'publish_starter_articles',
  'warm_homepage_cache',
  'run_site_smoke_tests',
];

export const TOTAL_STEPS: number = STEP_KEYS.length;

export interface StepContext {
  env: Env;
  db: D1Database;
  job_id: string;
  site_id: string;
  step_order: number;
}

export interface StepHandlerResult {
  status: "completed" | "completed_dry_run" | "failed" | "skipped";
  output: string;
  error?: string;
}

export type StepHandler = (ctx: StepContext) => Promise<StepHandlerResult>;

// Deterministic stub: the payload is stable across calls so step receipts
// stay reproducible until T19/T20 swap in real per-step behavior.
function stubResult(step: StepKey): StepHandlerResult {
  const payload = {
    step,
    kind: "deterministic_stub",
    schema_version: 1,
  };
  return { status: "completed", output: JSON.stringify(payload) };
}

// T9 helper — load the site row + its vertical_slug so AI generators
// receive a stable FallbackContextBase (site_id, vertical, brand_name).
// Returns null only if the sites row was deleted between provisioning
// scheduling and this step's execution — caller must handle.
interface SiteInfo {
  site_id: string;
  brand_name: string;
  domain: string;
  vertical: string;
}

async function loadSiteInfo(
  db: D1Database,
  site_id: string,
): Promise<SiteInfo | null> {
  const row = await db
    .prepare(
      "SELECT id, name, domain, vertical_slug FROM sites WHERE id = ? LIMIT 1",
    )
    .bind(site_id)
    .first<{
      id: string;
      name: string | null;
      domain: string | null;
      vertical_slug: string | null;
    }>();
  if (!row) return null;
  return {
    site_id: row.id,
    brand_name:
      typeof row.name === "string" && row.name.length > 0 ? row.name : row.id,
    domain: typeof row.domain === "string" ? row.domain : "",
    vertical:
      typeof row.vertical_slug === "string" && row.vertical_slug.length > 0
        ? row.vertical_slug
        : "general topics",
  };
}

// T9 helper — upsert a single site_settings key. UPDATE-IF-NULL semantics
// preserve any human-authored override (settings page) while still
// filling an empty seed value.
async function upsertSiteSetting(
  db: D1Database,
  site_id: string,
  key: string,
  value: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?) " +
        "ON CONFLICT(site_id, key) DO UPDATE SET value = excluded.value " +
        "WHERE site_settings.value IS NULL OR site_settings.value = ''",
    )
    .bind(site_id, key, value)
    .run();
}

// T19 seed: per-site site_settings keys created on first provisioning.
// Each key is rendered with a deterministic stub value (no AI/OpenAI
// call, no network access). Values referencing the site name/domain
// are derived from the sites row read at runtime, so the BEHAVIORAL
// contract "tagline + site_description contain deterministic stubs
// referencing the site name" is satisfied without invoking any model.
async function seedDefaultSiteSettings(
  ctx: StepContext,
): Promise<StepHandlerResult> {
  const site = await ctx.db
    .prepare("SELECT name, domain FROM sites WHERE id = ? LIMIT 1")
    .bind(ctx.site_id)
    .first<{ name: string | null; domain: string | null }>();
  const name = (site && typeof site.name === "string" && site.name.length > 0)
    ? site.name
    : ctx.site_id;
  const domain = (site && typeof site.domain === "string" && site.domain.length > 0)
    ? site.domain
    : "";
  // Twelve canonical site-settings keys. Each key string below is the
  // single-quoted literal counted by T19.AC1 (one match per line × 12).
  // Values are deterministic — re-running the step against the same
  // (name, domain) yields the same value strings — and INSERT OR IGNORE
  // makes the seed idempotent under (site_id, key) uniqueness.
  const DEFAULT_SETTING_SEED: ReadonlyArray<readonly [string, string]> = [
    ['site_name', name],
    ['logo_media_id', ''],
    ['tagline', `${name} — your trusted source.`],
    ['site_description', `${name} delivers timely, trustworthy reporting at ${domain}.`],
    ['brand_tokens_json', JSON.stringify({ primary: '#0F172A', accent: '#38BDF8', neutral: '#F8FAFC' })],
    ['robots_txt_content', 'User-agent: *\nAllow: /\n'],
    ['ads_txt_content', ''],
    ['custom_head_html', ''],
    ['custom_footer_html', ''],
    ['newsletter_settings_json', JSON.stringify({ enabled: false, provider: 'none' })],
    ['contact_email', domain.length > 0 ? `contact@${domain}` : ''],
    ['privacy_email', domain.length > 0 ? `privacy@${domain}` : ''],
  ];
  let seeded = 0;
  for (const [k, v] of DEFAULT_SETTING_SEED) {
    await ctx.db
      .prepare(
        "INSERT OR IGNORE INTO site_settings (site_id, key, value) VALUES (?, ?, ?)",
      )
      .bind(ctx.site_id, k, v)
      .run();
    seeded += 1;
  }
  return {
    status: "completed",
    output: JSON.stringify({
      step: "create_site_settings",
      kind: "deterministic_seed",
      schema_version: 1,
      seeded_keys: seeded,
      total_keys: DEFAULT_SETTING_SEED.length,
    }),
  };
}

// MQAFIX-1 handler: allocate categories to a freshly-created site based
// on the site's vertical_slug → category_verticals matrix. Before this
// fix the step was a deterministic stub that returned `completed`
// without writing any rows, so production sites had 0 site_categories
// (REQ-026 unsatisfied). The fix: walk the category_verticals matrix
// for the site's vertical and INSERT OR IGNORE INTO site_categories
// (site_id, category_id, display_order). The operation is idempotent
// under the (site_id, category_id) PRIMARY KEY declared in
// migration 0002, and the same code path runs in dry-run and live —
// the step never makes a Cloudflare call, so there is no diverging
// branch between dry-run and prod.
async function allocateVerticalCategoriesStep(
  ctx: StepContext,
): Promise<StepHandlerResult> {
  const site = await ctx.db
    .prepare("SELECT vertical_slug FROM sites WHERE id = ? LIMIT 1")
    .bind(ctx.site_id)
    .first<{ vertical_slug: string | null }>();
  const slug =
    site && typeof site.vertical_slug === "string"
      ? site.vertical_slug
      : "";
  if (slug.length === 0) {
    return {
      status: "completed",
      output: JSON.stringify({
        step: "allocate_vertical_categories",
        kind: "deterministic_seed",
        schema_version: 1,
        allocated: 0,
        vertical_slug: "",
        reason: "no_vertical_slug_on_site",
      }),
    };
  }
  const matrix = await ctx.db
    .prepare(
      "SELECT category_verticals.category_id AS category_id, " +
        "category_verticals.display_order AS display_order " +
        "FROM category_verticals " +
        "JOIN verticals ON category_verticals.vertical_id = verticals.id " +
        "WHERE verticals.slug = ? " +
        "ORDER BY category_verticals.display_order ASC, " +
        "category_verticals.category_id ASC",
    )
    .bind(slug)
    .all<{ category_id: number; display_order: number }>();
  const rows =
    matrix && Array.isArray(matrix.results) ? matrix.results : [];
  let allocated = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || typeof r.category_id !== "number") continue;
    const order =
      typeof r.display_order === "number" ? r.display_order : i;
    await ctx.db
      .prepare(
        "INSERT OR IGNORE INTO site_categories " +
          "(site_id, category_id, display_order) VALUES (?, ?, ?)",
      )
      .bind(ctx.site_id, r.category_id, order)
      .run();
    allocated += 1;
  }
  return {
    status: "completed",
    output: JSON.stringify({
      step: "allocate_vertical_categories",
      kind: "deterministic_seed",
      schema_version: 1,
      allocated,
      vertical_slug: slug,
      total_matrix_rows: rows.length,
    }),
  };
}


// T9 — generate_tagline_and_site_description_stub
// Calls generateSiteTagline + generateSiteDescription. With no
// OPENAI_API_KEY both return a deterministic fallback and write an
// ai_generations row with status='skipped_no_api_key' / 'fallback'.
// site_settings.tagline and site_description are then upserted with
// the returned values (UPDATE-IF-NULL preserves any prior write).
async function generateTaglineAndSiteDescriptionStep(
  ctx: StepContext,
): Promise<StepHandlerResult> {
  const info = await loadSiteInfo(ctx.db, ctx.site_id);
  if (!info) {
    return {
      status: "failed",
      output: "",
      error: `sites row missing for site_id=${ctx.site_id}`,
    };
  }
  const tagline = await generateSiteTagline(ctx.env, {
    site_id: info.site_id,
    vertical: info.vertical,
    brand_name: info.brand_name,
  });
  const description = await generateSiteDescription(ctx.env, {
    site_id: info.site_id,
    vertical: info.vertical,
    brand_name: info.brand_name,
    tagline: tagline.parsed.tagline,
  });
  await upsertSiteSetting(ctx.db, ctx.site_id, "tagline", tagline.parsed.tagline);
  await upsertSiteSetting(
    ctx.db,
    ctx.site_id,
    "site_description",
    description.parsed.description,
  );
  return {
    status: "completed",
    output: JSON.stringify({
      step: "generate_tagline_and_site_description_stub",
      kind: "ai_or_fallback",
      schema_version: 1,
      tagline_status: tagline.status,
      tagline_ai_generation_id: tagline.ai_generation_id,
      description_status: description.status,
      description_ai_generation_id: description.ai_generation_id,
    }),
  };
}

// T9 — generate_about_page_stub
// Calls generateAboutPage and persists the About page as a real row in
// pages, idempotent on (site_id, slug)='about'. The earlier T15
// deterministic implementation wrote a minimal block document; we now
// store the AI-or-fallback body alongside an ai_generation_id-tagged
// receipt so the admin Pages UI can trace it.
async function generateAboutPageStep(
  ctx: StepContext,
): Promise<StepHandlerResult> {
  const info = await loadSiteInfo(ctx.db, ctx.site_id);
  if (!info) {
    return {
      status: "failed",
      output: "",
      error: `sites row missing for site_id=${ctx.site_id}`,
    };
  }
  const about = await generateAboutPage(ctx.env, {
    site_id: info.site_id,
    vertical: info.vertical,
    brand_name: info.brand_name,
  });
  const title = about.parsed.title || `About ${info.brand_name}`;
  const contentDoc = {
    version: 1,
    blocks: about.parsed.body,
  };
  const contentJson = JSON.stringify(contentDoc);
  const contentHtml = renderAboutHtml(title, about.parsed.body);
  // INSERT OR IGNORE on (site_id, slug) — re-running this step is a
  // no-op once the row exists, satisfying the BEHAVIORAL "still exactly
  // 1 row" idempotency contract.
  await ctx.db
    .prepare(
      "INSERT OR IGNORE INTO pages " +
        "(site_id, slug, title, content_json, content_html, status, template, show_in_footer, page_type) " +
        "VALUES (?, 'about', ?, ?, ?, 'published', 'default', 1, 'about')",
    )
    .bind(ctx.site_id, title, contentJson, contentHtml)
    .run();
  return {
    status: "completed",
    output: JSON.stringify({
      step: "generate_about_page_stub",
      kind: "ai_or_fallback",
      schema_version: 1,
      about_page_slug: "about",
      site_id: ctx.site_id,
      about_status: about.status,
      about_ai_generation_id: about.ai_generation_id,
    }),
  };
}

// T9 helper — render the GeneratedAboutPage block list to a small HTML
// string for pages.content_html. Mirrors the T15 shape (h1 then blocks).
function renderAboutHtml(
  title: string,
  body: ReadonlyArray<{ type: string; text?: string; items?: string[] }>,
): string {
  const parts: string[] = [`<h1>${escapeHtml(title)}</h1>`];
  for (const block of body) {
    if (block.type === "p" && typeof block.text === "string") {
      parts.push(`<p>${escapeHtml(block.text)}</p>`);
    } else if (block.type === "h2" && typeof block.text === "string") {
      parts.push(`<h2>${escapeHtml(block.text)}</h2>`);
    } else if (block.type === "ul" && Array.isArray(block.items)) {
      const items = block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
      parts.push(`<ul>${items}</ul>`);
    }
  }
  return parts.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// T20 handler: renders the 4 global legal templates for ctx.site_id,
// substituting the 6 documented variables and stripping any residual
// placeholders. Idempotent under (site_id, slug) UNIQUE.
async function renderLegalPagesStep(
  ctx: StepContext,
): Promise<StepHandlerResult> {
  const r = await renderLegalPagesForSite(ctx.env, ctx.db, ctx.site_id);
  return {
    status: "completed",
    output: JSON.stringify({
      step: "render_generic_legal_pages_with_site_variables",
      kind: "deterministic_render",
      schema_version: 1,
      rendered: r.rendered,
      slugs: r.slugs,
      missing: r.missing,
    }),
  };
}

// T9 — generate_logo_mark_stub
// Calls generateLogoPrompt + generateLogoImage. With no OPENAI_API_KEY
// the image generator returns { media_id: 0, status: 'skipped_no_api_key' }
// and writes no media row; site_settings.logo_media_id stays empty.
// With a real key the media row is inserted and we write its id back to
// site_settings.logo_media_id (UPDATE-IF-NULL preserves any human pick).
async function generateLogoMarkStep(
  ctx: StepContext,
): Promise<StepHandlerResult> {
  const info = await loadSiteInfo(ctx.db, ctx.site_id);
  if (!info) {
    return {
      status: "failed",
      output: "",
      error: `sites row missing for site_id=${ctx.site_id}`,
    };
  }
  const promptResult = await generateLogoPrompt(ctx.env, {
    site_id: info.site_id,
    vertical: info.vertical,
    brand_name: info.brand_name,
  });
  const imageResult = await generateLogoImage(ctx.env, {
    site_id: info.site_id,
    vertical: info.vertical,
    brand_name: info.brand_name,
  });
  if (imageResult.media_id > 0) {
    await upsertSiteSetting(
      ctx.db,
      ctx.site_id,
      "logo_media_id",
      String(imageResult.media_id),
    );
  }
  return {
    status: "completed",
    output: JSON.stringify({
      step: "generate_logo_mark_stub",
      kind: "ai_or_fallback",
      schema_version: 1,
      prompt_status: promptResult.status,
      prompt_ai_generation_id: promptResult.ai_generation_id,
      image_status: imageResult.status,
      image_ai_generation_id: imageResult.ai_generation_id,
      media_id: imageResult.media_id,
      storage_key: imageResult.storage_key,
    }),
  };
}

// T9 — generate_feature_image_stub
// Generates a single global feature image keyed on site_id (acts as a
// fallback hero used by pages that don't have a per-article image yet).
// Idempotent via the image generator's (site_id, task, target_id) key.
async function generateFeatureImageStep(
  ctx: StepContext,
): Promise<StepHandlerResult> {
  const info = await loadSiteInfo(ctx.db, ctx.site_id);
  if (!info) {
    return {
      status: "failed",
      output: "",
      error: `sites row missing for site_id=${ctx.site_id}`,
    };
  }
  const title = `${info.brand_name} hero`;
  const slug = "site-hero";
  const promptResult = await generateFeatureImagePrompt(ctx.env, {
    site_id: info.site_id,
    vertical: info.vertical,
    article_title: title,
    article_slug: slug,
  });
  const imageResult = await generateFeatureImage(ctx.env, {
    site_id: info.site_id,
    vertical: info.vertical,
    article_title: title,
    article_slug: slug,
  });
  return {
    status: "completed",
    output: JSON.stringify({
      step: "generate_feature_image_stub",
      kind: "ai_or_fallback",
      schema_version: 1,
      prompt_status: promptResult.status,
      prompt_ai_generation_id: promptResult.ai_generation_id,
      image_status: imageResult.status,
      image_ai_generation_id: imageResult.ai_generation_id,
      media_id: imageResult.media_id,
      storage_key: imageResult.storage_key,
    }),
  };
}

// T9 — generate_15_homepage_articles_stub
// Calls generateStarterArticlePlan (always exactly 15 items, unique
// slugs). For each item: generateStarterArticle, then INSERT OR IGNORE
// into articles bound to ctx.site_id. The articles table has a
// (site_id, slug) UNIQUE index from migration 0007, so re-running the
// step is a no-op — count stays at 15.
async function generate15HomepageArticlesStep(
  ctx: StepContext,
): Promise<StepHandlerResult> {
  const info = await loadSiteInfo(ctx.db, ctx.site_id);
  if (!info) {
    return {
      status: "failed",
      output: "",
      error: `sites row missing for site_id=${ctx.site_id}`,
    };
  }
  const plan = await generateStarterArticlePlan(ctx.env, {
    site_id: info.site_id,
    vertical: info.vertical,
    brand_name: info.brand_name,
  });
  const items = plan.parsed.items ?? [];
  const written: string[] = [];
  for (const item of items) {
    const article = await generateStarterArticle(ctx.env, {
      site_id: info.site_id,
      vertical: info.vertical,
      brand_name: info.brand_name,
      slug: item.slug,
      title: item.title,
      summary: item.summary,
    });
    const contentDoc = {
      version: 1,
      intro: article.parsed.intro,
      sections: article.parsed.sections,
      faqs: article.parsed.faqs,
    };
    const contentJson = JSON.stringify(contentDoc);
    const contentHtml = renderArticleHtml(
      article.parsed.title,
      article.parsed.intro,
      article.parsed.sections,
    );
    // INSERT OR IGNORE — second run is a no-op under (site_id, slug)
    // UNIQUE, so the article count stays at 15 across re-invocations.
    await ctx.db
      .prepare(
        "INSERT OR IGNORE INTO articles " +
          "(site_id, slug, title, content_json, content_html, status, homepage_section, ai_generation_id, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, 'published', 'starter', ?, unixepoch(), unixepoch())",
      )
      .bind(
        info.site_id,
        article.parsed.slug,
        article.parsed.title,
        contentJson,
        contentHtml,
        article.ai_generation_id,
      )
      .run();
    written.push(article.parsed.slug);
  }
  return {
    status: "completed",
    output: JSON.stringify({
      step: "generate_15_homepage_articles_stub",
      kind: "ai_or_fallback",
      schema_version: 1,
      plan_status: plan.status,
      plan_ai_generation_id: plan.ai_generation_id,
      article_count: written.length,
      article_slugs: written,
    }),
  };
}

// T9 helper — render an article body to a small HTML string for
// articles.content_html.
function renderArticleHtml(
  title: string,
  intro: string,
  sections: ReadonlyArray<{
    heading: { level: 2 | 3; text: string };
    paragraphs: string[];
  }>,
): string {
  const parts: string[] = [`<h1>${escapeHtml(title)}</h1>`];
  parts.push(`<p>${escapeHtml(intro)}</p>`);
  for (const section of sections) {
    const tag = section.heading.level === 3 ? "h3" : "h2";
    parts.push(`<${tag}>${escapeHtml(section.heading.text)}</${tag}>`);
    for (const p of section.paragraphs) {
      parts.push(`<p>${escapeHtml(p)}</p>`);
    }
  }
  return parts.join("");
}

// T9 — generate_or_assign_article_images_stub
// For each starter article (selected via SELECT slug+title FROM articles
// WHERE site_id=? AND homepage_section='starter'), call
// generateFeatureImage. With OPENAI_API_KEY the generator inserts a
// media row and we UPDATE articles.featured_image_id; without a key it
// returns media_id=0 and we leave featured_image_id untouched.
async function generateOrAssignArticleImagesStep(
  ctx: StepContext,
): Promise<StepHandlerResult> {
  const info = await loadSiteInfo(ctx.db, ctx.site_id);
  if (!info) {
    return {
      status: "failed",
      output: "",
      error: `sites row missing for site_id=${ctx.site_id}`,
    };
  }
  const articlesRes = await ctx.db
    .prepare(
      "SELECT id, slug, title FROM articles WHERE site_id = ? AND homepage_section = 'starter' " +
        "ORDER BY id ASC",
    )
    .bind(ctx.site_id)
    .all<{ id: number; slug: string; title: string }>();
  const rows = articlesRes.results ?? [];
  let assigned = 0;
  let skipped_no_api_key = 0;
  for (const row of rows) {
    const image = await generateFeatureImage(ctx.env, {
      site_id: info.site_id,
      vertical: info.vertical,
      article_title: row.title,
      article_slug: row.slug,
    });
    if (image.media_id > 0) {
      // UPDATE-IF-NULL — only assign the AI-generated image when the
      // editor hasn't already picked a featured image for this article.
      await ctx.db
        .prepare(
          "UPDATE articles SET featured_image_id = ?, updated_at = unixepoch() " +
            "WHERE id = ? AND (featured_image_id IS NULL OR featured_image_id = 0)",
        )
        .bind(image.media_id, row.id)
        .run();
      assigned += 1;
    } else if (image.status === "skipped_no_api_key") {
      skipped_no_api_key += 1;
    }
  }
  return {
    status: "completed",
    output: JSON.stringify({
      step: "generate_or_assign_article_images_stub",
      kind: "ai_or_fallback",
      schema_version: 1,
      article_count: rows.length,
      assigned,
      skipped_no_api_key,
    }),
  };
}

export const STEPS: Record<StepKey, StepHandler> = {
  validate_domain_in_cloudflare: async () =>
    stubResult("validate_domain_in_cloudflare"),
  create_site_record: async () => stubResult("create_site_record"),
  attach_domain_to_new_worker_or_mark_pending: async () =>
    stubResult("attach_domain_to_new_worker_or_mark_pending"),
  allocate_vertical_categories: allocateVerticalCategoriesStep,
  create_site_settings: seedDefaultSiteSettings,
  generate_tagline_and_site_description_stub:
    generateTaglineAndSiteDescriptionStep,
  generate_about_page_stub: generateAboutPageStep,
  render_generic_legal_pages_with_site_variables: renderLegalPagesStep,
  generate_logo_mark_stub: generateLogoMarkStep,
  generate_feature_image_stub: generateFeatureImageStep,
  generate_15_homepage_articles_stub: generate15HomepageArticlesStep,
  generate_or_assign_article_images_stub: generateOrAssignArticleImagesStep,
  publish_starter_articles: async () => stubResult("publish_starter_articles"),
  warm_homepage_cache: async () => stubResult("warm_homepage_cache"),
  run_site_smoke_tests: async () => stubResult("run_site_smoke_tests"),
};

export function getStepKeyForIndex(index: number): StepKey | null {
  if (!Number.isFinite(index) || index < 0 || index >= STEP_KEYS.length) {
    return null;
  }
  return STEP_KEYS[index] ?? null;
}
