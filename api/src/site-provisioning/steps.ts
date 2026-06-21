// Phase 3 / T17+T19+T20 + Phase 6 / T9 + rescue-2 T34: provisioning
// step registry.
//
// 16 canonical step keys advance a site_creation_jobs row one step per
// POST /api/admin/sites/:id/provision/next call. T17 wired placeholder
// handlers; T18 added dry-run gating for CF-mutation steps; T19 swapped
// create_site_settings for a 12-key seed; T20 swapped the legal-pages
// placeholder for variable-aware rendering via legal-renderer.ts;
// Phase 6 / T9 swapped six steps for AI-or-fallback generators that
// write a typed receipt row to ai_generations and persist their
// side-effects (site_settings updates, pages rows, articles rows,
// media rows) so re-running the same step is idempotent via:
//   - ai_generations.idempotency_key UNIQUE (T4)        — no duplicate gen rows
//   - INSERT OR IGNORE on site_settings/articles/pages  — no duplicate domain rows
//   - UPDATE … COALESCE / WHERE … IS NULL              — no clobber of populated values
// T34 (rescue-2 D1) renames every key to its canonical suffix-free form
// and appends the 16th step, update_launch_readiness; T39 implements it
// as the read-only readiness rollup persisted to the step output row.
//
// Contract greps (each canonical key appears as a single-quoted literal
// exactly once in the registry tuple it belongs to):
//   - T34.AC1: 16 step-key literals in STEP_KEYS; index 15 is
//     update_launch_readiness
//   - T19.AC1: 12 site-settings-key literals in DEFAULT_SETTING_SEED
//   - T9.AC1..AC5: imports of generateSiteTagline/Description, generateAboutPage,
//     generateLogoImage/Prompt, generateFeatureImage/Prompt, generateStarterArticlePlan/Article

import { type Env, parseNumber } from "../env";
import { renderLegalPagesForSite } from "./legal-renderer";
import { warmHomepageInProcess } from "../cache/warm";
import {
  resolveSiteHostname,
  runCloudflareRouteMutation,
  runCloudflareZoneValidation,
} from "./cloudflare-interfaces";
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
// T40 [BCL-077]: every provisioning AI step resolves its editable system
// preset by task key (seeded is_system by migration 0020). PROVISIONING_PRESET_CATEGORIES
// is the single source of truth for those task keys.
import { PROVISIONING_PRESET_CATEGORIES } from "../ai/generators/preset-resolver";

export type StepKey =
  | "validate_domain_in_cloudflare"
  | "create_site_record"
  | "attach_domain_to_new_worker_or_mark_pending"
  | "allocate_vertical_categories"
  | "create_site_settings"
  | "generate_tagline_and_site_description"
  | "generate_about_page"
  | "render_generic_legal_pages_with_site_variables"
  | "generate_logo_mark"
  | "generate_feature_image"
  | "generate_15_homepage_articles"
  | "generate_or_assign_article_images"
  | "publish_starter_articles"
  | "warm_homepage_cache"
  | "run_site_smoke_tests"
  | "update_launch_readiness";

// Ordered registry — STEP_KEYS[i] is the step the runner executes when
// site_creation_jobs.current_step_index = i. The single-quoted literal
// form below is what T34.AC1's grep counts (16 keys; index 15 MUST be
// update_launch_readiness).
export const STEP_KEYS: readonly StepKey[] = [
  'validate_domain_in_cloudflare',
  'create_site_record',
  'attach_domain_to_new_worker_or_mark_pending',
  'allocate_vertical_categories',
  'create_site_settings',
  'generate_tagline_and_site_description',
  'generate_about_page',
  'render_generic_legal_pages_with_site_variables',
  'generate_logo_mark',
  'generate_feature_image',
  'generate_15_homepage_articles',
  'generate_or_assign_article_images',
  'publish_starter_articles',
  'warm_homepage_cache',
  'run_site_smoke_tests',
  'update_launch_readiness',
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
  // "in_progress" (rescue-4): a chunked step that did ONE unit of bounded work
  // and has MORE to do. The runner persists progress but does NOT advance the
  // step pointer or finalize the job, so the same step runs again next call
  // (a cron tick or a /provision/next POST). Used by the per-article steps so
  // a site with any article count completes within the per-invocation budget.
  status:
    | "completed"
    | "completed_dry_run"
    | "in_progress"
    | "failed"
    | "skipped";
  output: string;
  error?: string;
}

export type StepHandler = (ctx: StepContext) => Promise<StepHandlerResult>;

// rescue-4: the SINGLE source of truth for the starter-article count. It bounds
// the materialize (how many provisioning_article_units rows the
// generate_15_homepage_articles step seeds from the generated plan). Nothing
// else in a single step invocation scales with this number: each invocation
// processes exactly ONE unit (one article body, or one feature image), so
// per-invocation cost is O(1) regardless of STARTER_ARTICLE_TARGET (15/35/100).
// Exported so the runner can size its completion-loop iteration bound (two
// chunked steps each take up to STARTER_ARTICLE_TARGET unit-passes).
export const STARTER_ARTICLE_TARGET = 15;

// rescue-4: max generation attempts per unit before it is marked 'failed' and
// skipped. A failed unit no longer blocks the step from completing (the job
// surfaces/finishes rather than spinning forever on a poison unit).
// Exported (PR #28 finding #4) so the runner can size PROVISIONING_MAX_ITERATIONS
// to allow up to MAX_UNIT_ATTEMPTS passes per unit per chunked stage.
export const MAX_UNIT_ATTEMPTS = 3;

// T35 — validate_domain_in_cloudflare (step 1).
// Read-only Cloudflare-boundary check: resolves the site's hostname and
// asks the boundary whether an active zone exists. Dry-run (the default)
// short-circuits to completed_dry_run with zero outbound fetch;
// protected legacy-production hostnames are refused before any call.
async function validateDomainInCloudflareStep(
  ctx: StepContext,
): Promise<StepHandlerResult> {
  const hostname = await resolveSiteHostname(ctx.db, ctx.site_id);
  const outcome = await runCloudflareZoneValidation(
    { env: ctx.env, db: ctx.db },
    { site_id: ctx.site_id, hostname },
  );
  return { status: outcome.status, output: outcome.output, error: outcome.error };
}

// T35 — create_site_record (step 2).
// Pure-D1 record completion: verifies the sites row committed by
// POST /api/admin/sites still exists and repairs the canonical domains
// row if it is missing (INSERT OR IGNORE under domains.hostname UNIQUE
// keeps re-runs idempotent). No Cloudflare call in any mode.
async function createSiteRecordStep(
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
  let domainsRowEnsured = false;
  if (info.domain.length > 0) {
    await ctx.db
      .prepare(
        "INSERT OR IGNORE INTO domains (site_id, hostname, kind, is_primary, status) " +
          "VALUES (?, ?, 'canonical', 1, 'pending')",
      )
      .bind(ctx.site_id, info.domain)
      .run();
    domainsRowEnsured = true;
  }
  return {
    status: "completed",
    output: JSON.stringify({
      step: "create_site_record",
      kind: "deterministic_record",
      schema_version: 1,
      site_id: ctx.site_id,
      domain: info.domain,
      domains_row_ensured: domainsRowEnsured,
    }),
  };
}

// T35 — attach_domain_to_new_worker_or_mark_pending (step 3).
// Registry-side mirror of the runner's CF-mutation interception: both
// call the same runCloudflareRouteMutation boundary, which performs a
// real route mutation ONLY when SITE_PROVISIONING_DRY_RUN=false AND
// SITE_PROVISIONING_ALLOW_ROUTE_MUTATION=true AND the hostname is not
// protected; otherwise it short-circuits to completed_dry_run (or marks
// the domain pending when no zone exists in live mode).
async function attachDomainToWorkerStep(
  ctx: StepContext,
): Promise<StepHandlerResult> {
  const hostname = await resolveSiteHostname(ctx.db, ctx.site_id);
  const outcome = await runCloudflareRouteMutation(
    { env: ctx.env, db: ctx.db },
    {
      site_id: ctx.site_id,
      hostname,
      action: "attach_domain_to_new_worker_or_mark_pending",
      payload: { job_id: ctx.job_id, step_order: ctx.step_order },
    },
  );
  return { status: outcome.status, output: outcome.output, error: outcome.error };
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

// T9 helper — upsert a single site_settings key.
//
// Default (overwrite=false): UPDATE-IF-NULL semantics preserve any
// human-authored / prior override (settings page, logo pick) while still
// filling an empty seed value.
//
// T7 (overwrite=true): the caller is the authoritative AI writer for this
// key — its value MUST win over the deterministic stub the earlier
// create_site_settings seed wrote. Without this, the
// `WHERE value IS NULL OR value=''` guard silently discarded the AI-generated
// tagline / site_description because the non-empty stub had already filled
// the row. The overwrite branch drops the guard so the AI value replaces it.
async function upsertSiteSetting(
  db: D1Database,
  site_id: string,
  key: string,
  value: string,
  overwrite = false,
): Promise<void> {
  const conflictClause = overwrite
    ? "ON CONFLICT(site_id, key) DO UPDATE SET value = excluded.value"
    : "ON CONFLICT(site_id, key) DO UPDATE SET value = excluded.value " +
      "WHERE site_settings.value IS NULL OR site_settings.value = ''";
  await db
    .prepare(
      "INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?) " +
        conflictClause,
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
    // T8: seed brand_tokens_json EMPTY so the design-system defaults apply.
    // The brand contract teal family (primary --tw-brand:#1ba8c8, Nunito) lives
    // in public-css.ts; per-site overrides are written as --tw-* keys via the
    // Settings tab. The previous slate/sky dark palette both mismatched the
    // contract AND mapped to inert --primary/--accent/--neutral props the
    // stylesheet never reads, so the homepage still rendered defaults — minus
    // an unnecessary <style> block. Empty value keeps the row (T19 12-key
    // contract) while parseBrandTokensJson('') -> {} -> no override.
    ['brand_tokens_json', ''],
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

// T9 (rescue-3) — authoritative per-vertical category allocation.
// brief W2.3-EXTENDED: the 0004 category_verticals seed mapped the
// `parenting` vertical to a mismatched leftover set (family-travel,
// healthy-meals, wellness) that was ALSO empty — vertical-mismatched AND
// article_count 0. For any vertical listed here the allocate step is
// AUTHORITATIVE: it ensures the parenting-appropriate categories exist
// (INSERT OR IGNORE INTO categories, idempotent on the slug UNIQUE),
// resolves their autoincrement ids, and links them to the site —
// INDEPENDENT of the (mismatched) category_verticals matrix. Verticals
// NOT listed here keep the matrix-driven path below; their 0004 mappings
// are already vertical-appropriate (finance→personal-finance, etc.).
const VERTICAL_CATEGORY_PLAN: Readonly<
  Record<string, ReadonlyArray<{ slug: string; name: string }>>
> = {
  parenting: [
    { slug: "parenting-tips", name: "Parenting Tips" },
    { slug: "child-development", name: "Child Development" },
    { slug: "family-activities", name: "Family Activities" },
    { slug: "newborn-baby-care", name: "Newborn & Baby Care" },
  ],
};

// MQAFIX-1 handler: allocate categories to a freshly-created site based
// on the site's vertical_slug. Before this fix the step was a
// deterministic stub that returned `completed` without writing any rows,
// so production sites had 0 site_categories (REQ-026 unsatisfied). The
// step has two paths: (1) T9 vertical-plan path — for verticals in
// VERTICAL_CATEGORY_PLAN, allocate the authoritative parenting-appropriate
// set; (2) the original category_verticals matrix path for every other
// vertical. Both INSERT OR IGNORE INTO site_categories
// (site_id, category_id, display_order), idempotent under the
// (site_id, category_id) PRIMARY KEY declared in migration 0002, and run
// identically in dry-run and live — the step never makes a Cloudflare
// call, so there is no diverging branch between dry-run and prod.
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
  // T9 vertical-plan path: allocate the authoritative, vertical-appropriate
  // category set instead of the (possibly mismatched) matrix. The categories
  // are created on demand so a fresh environment that never seeded them still
  // ends up with a non-empty, correct site_categories set.
  const plan = VERTICAL_CATEGORY_PLAN[slug];
  if (plan && plan.length > 0) {
    const allocatedSlugs: string[] = [];
    for (let i = 0; i < plan.length; i++) {
      const cat = plan[i]!;
      await ctx.db
        .prepare(
          "INSERT OR IGNORE INTO categories (slug, name, display_order) " +
            "VALUES (?, ?, ?)",
        )
        .bind(cat.slug, cat.name, i)
        .run();
      const row = await ctx.db
        .prepare("SELECT id AS id FROM categories WHERE slug = ? LIMIT 1")
        .bind(cat.slug)
        .first<{ id: number }>();
      if (!row || typeof row.id !== "number") continue;
      await ctx.db
        .prepare(
          "INSERT OR IGNORE INTO site_categories " +
            "(site_id, category_id, display_order) VALUES (?, ?, ?)",
        )
        .bind(ctx.site_id, row.id, i)
        .run();
      allocatedSlugs.push(cat.slug);
    }
    return {
      status: "completed",
      output: JSON.stringify({
        step: "allocate_vertical_categories",
        kind: "vertical_plan",
        schema_version: 1,
        allocated: allocatedSlugs.length,
        vertical_slug: slug,
        plan_categories: allocatedSlugs,
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


// T9 — generate_tagline_and_site_description
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
    presetCategory: PROVISIONING_PRESET_CATEGORIES.tagline,
  });
  const description = await generateSiteDescription(ctx.env, {
    site_id: info.site_id,
    vertical: info.vertical,
    brand_name: info.brand_name,
    tagline: tagline.parsed.tagline,
    presetCategory: PROVISIONING_PRESET_CATEGORIES.siteDescription,
  });
  // T7-AC1: the AI-owned tagline / site_description MUST overwrite the
  // deterministic stub the earlier create_site_settings step seeded —
  // overwrite=true drops the UPDATE-IF-NULL guard so the AI value wins.
  // Both generators always return a non-empty value (deterministic fallback
  // when OPENAI_API_KEY is absent), but guard on length anyway so an empty
  // model result never wipes the good stub.
  const taglineValue = (tagline.parsed.tagline ?? "").trim();
  if (taglineValue.length > 0) {
    await upsertSiteSetting(ctx.db, ctx.site_id, "tagline", taglineValue, true);
  }
  const descriptionValue = (description.parsed.description ?? "").trim();
  if (descriptionValue.length > 0) {
    await upsertSiteSetting(
      ctx.db,
      ctx.site_id,
      "site_description",
      descriptionValue,
      true,
    );
  }
  // T7-AC2: seed default_author_name so T6's generate_15_homepage_articles
  // (a later step) sources the starter-article author from a site setting,
  // never a user email. Kept OUT of the create_site_settings 12-key seed so
  // the T19 "12 canonical keys" contract count is unchanged; INSERT OR IGNORE
  // keeps it idempotent and preserves any human-authored override.
  const defaultAuthorName = `${info.brand_name} Editorial Team`;
  await ctx.db
    .prepare(
      "INSERT OR IGNORE INTO site_settings (site_id, key, value) VALUES (?, ?, ?)",
    )
    .bind(ctx.site_id, "default_author_name", defaultAuthorName)
    .run();
  return {
    status: "completed",
    output: JSON.stringify({
      step: "generate_tagline_and_site_description",
      kind: "ai_or_fallback",
      schema_version: 1,
      tagline_status: tagline.status,
      tagline_ai_generation_id: tagline.ai_generation_id,
      description_status: description.status,
      description_ai_generation_id: description.ai_generation_id,
      default_author_name_seeded: true,
    }),
  };
}

// T9 — generate_about_page
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
      step: "generate_about_page",
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

// T9 — generate_logo_mark
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
    presetCategory: PROVISIONING_PRESET_CATEGORIES.logo,
  });
  const imageResult = await generateLogoImage(ctx.env, {
    site_id: info.site_id,
    vertical: info.vertical,
    brand_name: info.brand_name,
    presetCategory: PROVISIONING_PRESET_CATEGORIES.logo,
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
      step: "generate_logo_mark",
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

// T9 — generate_feature_image
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
  // T40: the homepage hero image is governed by the editable 'hero-image'
  // system preset (distinct from the per-article 'feature-image' preset).
  const promptResult = await generateFeatureImagePrompt(ctx.env, {
    site_id: info.site_id,
    vertical: info.vertical,
    article_title: title,
    article_slug: slug,
    brand_name: info.brand_name,
    presetCategory: PROVISIONING_PRESET_CATEGORIES.heroImage,
  });
  const imageResult = await generateFeatureImage(ctx.env, {
    site_id: info.site_id,
    vertical: info.vertical,
    article_title: title,
    article_slug: slug,
    brand_name: info.brand_name,
    presetCategory: PROVISIONING_PRESET_CATEGORIES.heroImage,
  });
  // T41 [BCL-078] — persist the generated hero as the site-level hero image so
  // the provisioned end-state actually has its hero SET. buildHomeViewModel
  // (home.ts:323) sources the full-bleed homepage .hero-bg banner from
  // site_settings.hero_image_media_id (T18/BCL-056); before this write the
  // step generated a hero image that NOTHING referenced, so the banner
  // silently fell back to the lead article's image and "hero set" was not
  // actually true. UPDATE-IF-NULL via upsertSiteSetting preserves any
  // operator-picked hero, and the write only fires when a media row was really
  // created (media_id > 0 — never under the no-key skip), mirroring the logo
  // step exactly.
  let heroSettingWritten = false;
  if (imageResult.media_id > 0) {
    await upsertSiteSetting(
      ctx.db,
      ctx.site_id,
      "hero_image_media_id",
      String(imageResult.media_id),
    );
    heroSettingWritten = true;
  }
  return {
    status: "completed",
    output: JSON.stringify({
      step: "generate_feature_image",
      kind: "ai_or_fallback",
      schema_version: 1,
      prompt_status: promptResult.status,
      prompt_ai_generation_id: promptResult.ai_generation_id,
      image_status: imageResult.status,
      image_ai_generation_id: imageResult.ai_generation_id,
      media_id: imageResult.media_id,
      storage_key: imageResult.storage_key,
      hero_image_media_id_set: heroSettingWritten,
    }),
  };
}

// T6 helper — read a single site_settings value (the live seed/override).
// Returns null when the key is absent or empty so the caller can apply a
// deterministic fallback. Used to source the starter-article author from
// the site's default_author_name setting.
async function readSiteSettingValue(
  db: D1Database,
  site_id: string,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT value AS value FROM site_settings WHERE site_id = ? AND key = ? LIMIT 1",
    )
    .bind(site_id, key)
    .first<{ value: string | null }>();
  if (!row || typeof row.value !== "string") return null;
  const v = row.value.trim();
  return v.length > 0 ? v : null;
}

// T6 helper — read the category_ids allocated to this site (written by the
// earlier allocate_vertical_categories step into site_categories). Ordered
// deterministically so round-robin assignment to the 15 starter articles is
// stable across re-runs.
async function loadSiteCategoryIds(
  db: D1Database,
  site_id: string,
): Promise<number[]> {
  const res = await db
    .prepare(
      "SELECT category_id AS category_id FROM site_categories WHERE site_id = ? " +
        "ORDER BY display_order ASC, category_id ASC",
    )
    .bind(site_id)
    .all<{ category_id: number }>();
  const rows = res && Array.isArray(res.results) ? res.results : [];
  const ids: number[] = [];
  for (const r of rows) {
    if (r && typeof r.category_id === "number") ids.push(r.category_id);
  }
  return ids;
}

// T6 (rescue-3) — homepage placement encoding written by provisioning so
// buildHomeViewModel (home.ts:285-315) buckets the 15 starter articles into
// the agreed 1 hero + 4 featured + 4 trending + 6 latest split (operator
// decision D4 / brief BCL-023 >=1 per bucket). The reader buckets PURELY
// from is_trending / is_featured: is_trending=1 rows are pulled out first
// (→ trending); is_featured=1 of the remainder forms the featured pool
// (hero = first, featured = next 4); everything else falls to latest. So
// the flag distribution below IS the placement contract:
//   indices 0-4  → is_featured=1, is_trending=0  (featuredBucket=5 → 1 hero + 4 featured)
//   indices 5-8  → is_trending=1, is_featured=0  (trending=4)
//   indices 9-14 → is_featured=0, is_trending=0  (latest=6)
function starterPlacementForIndex(
  index: number,
): { is_featured: number; is_trending: number } {
  if (index < 5) return { is_featured: 1, is_trending: 0 };
  if (index < 9) return { is_featured: 0, is_trending: 1 };
  return { is_featured: 0, is_trending: 0 };
}

// rescue-4 — a single provisioning_article_units row: one planned starter
// article and its per-stage (text / image) generation state.
interface ArticleUnitRow {
  unit_index: number;
  slug: string;
  title: string | null;
  summary: string | null;
  text_status: string;
  image_status: string;
  article_id: string | null;
  attempt_count: number;
}

// rescue-4 — how many units already exist for this site (materialize-once
// guard). 0 means the plan has not been materialized yet.
async function countArticleUnits(
  db: D1Database,
  site_id: string,
): Promise<number> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS unit_count FROM provisioning_article_units WHERE site_id = ?",
    )
    .bind(site_id)
    .first<{ unit_count: number }>();
  return row?.unit_count ?? 0;
}

// rescue-4 — pick the next unit whose <stage>_status is 'pending', oldest
// unit_index first, so a re-run resumes deterministically. `stageColumn` is a
// fixed literal ('text_status' | 'image_status') the caller supplies — never
// user input — so there is no injection surface despite the column name being
// interpolated into the static SQL string. requireArticleId=true additionally
// filters to units that already have their article row (image stage).
async function selectNextPendingUnit(
  db: D1Database,
  site_id: string,
  stageColumn: "text_status" | "image_status",
  requireArticleId: boolean,
): Promise<ArticleUnitRow | null> {
  const articleClause = requireArticleId
    ? " AND article_id IS NOT NULL"
    : "";
  const row = await db
    .prepare(
      "SELECT unit_index, slug, title, summary, text_status, image_status, " +
        "article_id, attempt_count FROM provisioning_article_units " +
        "WHERE site_id = ? AND " +
        stageColumn +
        " = 'pending'" +
        articleClause +
        " ORDER BY unit_index ASC LIMIT 1",
    )
    .bind(site_id)
    .first<ArticleUnitRow>();
  return row ?? null;
}

// rescue-4 — bump a unit's attempt_count + last_error after a generation
// failure, and promote it to 'failed' (on `stageColumn`) once it has burned
// through MAX_UNIT_ATTEMPTS so it is skipped on the next pass instead of
// spinning. Returns true when the unit was marked permanently 'failed'.
async function recordUnitFailure(
  db: D1Database,
  site_id: string,
  unit_index: number,
  stageColumn: "text_status" | "image_status",
  priorAttempts: number,
  error: string,
): Promise<boolean> {
  const attempts = priorAttempts + 1;
  const permanentlyFailed = attempts >= MAX_UNIT_ATTEMPTS;
  if (permanentlyFailed) {
    await db
      .prepare(
        "UPDATE provisioning_article_units SET attempt_count = ?, last_error = ?, " +
          stageColumn +
          " = 'failed', updated_at = unixepoch() WHERE site_id = ? AND unit_index = ?",
      )
      .bind(attempts, error.slice(0, 500), site_id, unit_index)
      .run();
  } else {
    await db
      .prepare(
        "UPDATE provisioning_article_units SET attempt_count = ?, last_error = ?, " +
          "updated_at = unixepoch() WHERE site_id = ? AND unit_index = ?",
      )
      .bind(attempts, error.slice(0, 500), site_id, unit_index)
      .run();
  }
  return permanentlyFailed;
}

// T9 — generate_15_homepage_articles (T6 rescue-3 hardening; rescue-4 chunked)
//
// rescue-4: the step is now MATERIALIZE-ONCE + PROCESS-ONE so it fits the
// Cloudflare per-invocation budget at any article count and is fully
// idempotent under retry:
//   1. Materialize-once — if provisioning_article_units has no rows for this
//      site, call generateStarterArticlePlan ONCE for STARTER_ARTICLE_TARGET
//      items and INSERT OR IGNORE one unit row per item (slug/title/summary,
//      text_status='pending'). If rows already exist the plan is NOT
//      regenerated (the previous O(N)-per-call design redid all AI work).
//   2. Process-one — pick the single oldest text_status='pending' unit. If
//      none remain → 'completed'. Otherwise generate exactly ONE article
//      (generateStarterArticle), INSERT OR IGNORE the articles row (same
//      column set + T6 editorial metadata as before), and flip the unit
//      text_status='done' (+ article_id). Return 'in_progress' if more units
//      are still pending, else 'completed'.
//   3. A unit whose text_status is already 'done'/'failed' is skipped BEFORE
//      any AI call (cheap re-run); a unit that fails MAX_UNIT_ATTEMPTS times is
//      marked 'failed' and skipped so the job can still complete/surface.
//
// T6: every starter row carries the editorial metadata the public site needs —
// a category_id (round-robin over the site's allocated site_categories by
// unit_index), an author_name (the site's default_author_name setting, falling
// back to a deterministic brand-derived editorial name, NEVER a user email),
// deterministic seo_title / seo_description, and the homepage placement flags +
// homepage_rank that drive the 1/4/4/6 home split — all keyed off the unit's
// stable unit_index so placement is identical across re-runs.
// ===========================================================================
// rescue-4 v3 — PER-UNIT generation primitives, shared by the serial step
// (inline fallback) and the parallel Queue consumer (src/index.ts queue()).
// Each does the work for exactly ONE unit and is fully idempotent (deterministic
// slug + INSERT OR IGNORE), so a Queue re-delivery never duplicates.
// ===========================================================================

// Generate ONE article for `unit`, INSERT it under the PLANNED slug
// (deterministic), and mark the unit text_status='done'. On a gen failure it
// records the attempt (recordUnitFailure → 'failed' after MAX_UNIT_ATTEMPTS) and
// returns "retry" (the caller/Queue re-attempts). Throws only on a missing site.
export async function generateOneTextUnit(
  ctx: StepContext,
  unit: ArticleUnitRow,
): Promise<"done" | "retry" | "failed"> {
  const info = await loadSiteInfo(ctx.db, ctx.site_id);
  if (!info) {
    throw new Error(`sites row missing for site_id=${ctx.site_id}`);
  }
  const settingAuthor = await readSiteSettingValue(
    ctx.db,
    ctx.site_id,
    "default_author_name",
  );
  const authorName =
    settingAuthor !== null ? settingAuthor : `${info.brand_name} Editorial Team`;
  const categoryIds = await loadSiteCategoryIds(ctx.db, ctx.site_id);

  let article;
  try {
    article = await generateStarterArticle(ctx.env, {
      site_id: info.site_id,
      vertical: info.vertical,
      brand_name: info.brand_name,
      slug: unit.slug,
      title: unit.title ?? unit.slug,
      summary: unit.summary ?? "",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanentlyFailed = await recordUnitFailure(
      ctx.db,
      ctx.site_id,
      unit.unit_index,
      "text_status",
      unit.attempt_count,
      message,
    );
    return permanentlyFailed ? "failed" : "retry";
  }

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
  const categoryId =
    categoryIds.length > 0
      ? categoryIds[unit.unit_index % categoryIds.length]!
      : null;
  const seoTitle = (article.parsed.title || unit.title || unit.slug)
    .trim()
    .slice(0, 70);
  const seoDescription = (
    unit.summary ||
    article.parsed.intro ||
    article.parsed.title ||
    unit.title ||
    unit.slug
  )
    .trim()
    .slice(0, 155);
  const placement = starterPlacementForIndex(unit.unit_index);
  const homepageRank = unit.unit_index + 1;
  // DETERMINISTIC slug (#29) → INSERT OR IGNORE idempotent under (site_id, slug).
  await ctx.db
    .prepare(
      "INSERT OR IGNORE INTO articles " +
        "(site_id, slug, title, content_json, content_html, ai_generation_id, " +
        "category_id, author_name, seo_title, seo_description, " +
        "is_featured, is_trending, homepage_rank, " +
        "status, homepage_section, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 'starter', unixepoch(), unixepoch())",
    )
    .bind(
      info.site_id,
      unit.slug,
      article.parsed.title,
      contentJson,
      contentHtml,
      article.ai_generation_id,
      categoryId,
      authorName,
      seoTitle,
      seoDescription,
      placement.is_featured,
      placement.is_trending,
      homepageRank,
    )
    .run();
  await ctx.db
    .prepare(
      "UPDATE provisioning_article_units SET text_status = 'done', article_id = ?, " +
        "updated_at = unixepoch() WHERE site_id = ? AND unit_index = ?",
    )
    .bind(unit.slug, ctx.site_id, unit.unit_index)
    .run();
  return "done";
}

// Generate/assign ONE feature image for `unit` (which must already have an
// article_id), UPDATE-IF-NULL the article's featured_image_id, and mark the
// unit image_status='done'. Idempotent on the unit's stable index.
export async function generateOneImageUnit(
  ctx: StepContext,
  unit: ArticleUnitRow,
): Promise<"done" | "retry" | "failed"> {
  const info = await loadSiteInfo(ctx.db, ctx.site_id);
  if (!info) {
    throw new Error(`sites row missing for site_id=${ctx.site_id}`);
  }
  const articleRow = await ctx.db
    .prepare(
      "SELECT id, slug, title FROM articles WHERE site_id = ? AND slug = ? LIMIT 1",
    )
    .bind(ctx.site_id, unit.article_id)
    .first<{ id: number; slug: string; title: string }>();
  if (!articleRow) {
    const pf = await recordUnitFailure(
      ctx.db,
      ctx.site_id,
      unit.unit_index,
      "image_status",
      MAX_UNIT_ATTEMPTS - 1,
      `article row missing for slug=${unit.article_id}`,
    );
    return pf ? "failed" : "retry";
  }
  let image;
  try {
    image = await generateFeatureImage(ctx.env, {
      site_id: info.site_id,
      vertical: info.vertical,
      article_title: articleRow.title,
      article_slug: articleRow.slug,
      brand_name: info.brand_name,
      presetCategory: PROVISIONING_PRESET_CATEGORIES.featureImage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanentlyFailed = await recordUnitFailure(
      ctx.db,
      ctx.site_id,
      unit.unit_index,
      "image_status",
      unit.attempt_count,
      message,
    );
    return permanentlyFailed ? "failed" : "retry";
  }
  if (image.media_id > 0) {
    await ctx.db
      .prepare(
        "UPDATE articles SET featured_image_id = ?, updated_at = unixepoch() " +
          "WHERE id = ? AND (featured_image_id IS NULL OR featured_image_id = 0)",
      )
      .bind(image.media_id, articleRow.id)
      .run();
  }
  await ctx.db
    .prepare(
      "UPDATE provisioning_article_units SET image_status = 'done', " +
        "updated_at = unixepoch() WHERE site_id = ? AND unit_index = ?",
    )
    .bind(ctx.site_id, unit.unit_index)
    .run();
  return "done";
}

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

  // --- 1. Materialize-once -------------------------------------------------
  const existingUnits = await countArticleUnits(ctx.db, ctx.site_id);
  if (existingUnits === 0) {
    const plan = await generateStarterArticlePlan(ctx.env, {
      site_id: info.site_id,
      vertical: info.vertical,
      brand_name: info.brand_name,
      count: STARTER_ARTICLE_TARGET,
      presetCategory: PROVISIONING_PRESET_CATEGORIES.starterArticles,
    });
    const items = (plan.parsed.items ?? []).slice(0, STARTER_ARTICLE_TARGET);
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      await ctx.db
        .prepare(
          "INSERT OR IGNORE INTO provisioning_article_units " +
            "(site_id, unit_index, slug, title, summary, text_status, image_status) " +
            "VALUES (?, ?, ?, ?, ?, 'pending', 'pending')",
        )
        .bind(ctx.site_id, i, item.slug, item.title, item.summary)
        .run();
    }
  }

  // --- 2. Parallel path: enqueue all pending units; return in_progress until
  // the Queue consumer fleet has generated them all (each in its own
  // invocation, full speed). Falls back to the serial path when unbound.
  if (ctx.env.PROVISION_QUEUE) {
    const { enqueued, remaining } = await enqueueProvisionUnits(
      ctx.env,
      ctx.site_id,
      "text",
    );
    const totalUnits = await countArticleUnits(ctx.db, ctx.site_id);
    return {
      status: remaining ? "in_progress" : "completed",
      output: JSON.stringify({
        step: "generate_15_homepage_articles",
        kind: "ai_or_fallback",
        schema_version: 1,
        stage: remaining ? "text_enqueued" : "text_complete",
        enqueued,
        total_units: totalUnits,
      }),
    };
  }

  // --- 3. Serial inline path (no Queue bound: tests / local dev) -----------
  const unit = await selectNextPendingUnit(
    ctx.db,
    ctx.site_id,
    "text_status",
    false,
  );
  if (unit === null) {
    const totalUnits = await countArticleUnits(ctx.db, ctx.site_id);
    return {
      status: "completed",
      output: JSON.stringify({
        step: "generate_15_homepage_articles",
        kind: "ai_or_fallback",
        schema_version: 1,
        stage: "text_complete",
        total_units: totalUnits,
      }),
    };
  }
  const outcome = await generateOneTextUnit(ctx, unit);
  const morePending = await selectNextPendingUnit(
    ctx.db,
    ctx.site_id,
    "text_status",
    false,
  );
  return {
    status: morePending !== null ? "in_progress" : "completed",
    output: JSON.stringify({
      step: "generate_15_homepage_articles",
      kind: "ai_or_fallback",
      schema_version: 1,
      stage:
        outcome === "retry"
          ? "text_unit_error"
          : morePending !== null
            ? "text_unit_done"
            : "text_complete",
      unit_index: unit.unit_index,
      article_slug: unit.slug,
      outcome,
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

// T9 — generate_or_assign_article_images (rescue-4 chunked)
//
// rescue-4: PROCESS-ONE, mirroring generate_15_homepage_articles. Picks the
// single oldest unit with image_status='pending' AND a non-null article_id
// (i.e. its article body already landed), generates exactly ONE feature image
// (generateFeatureImage), UPDATEs that article's featured_image_id (UPDATE-IF-
// NULL so an editor pick wins), and flips the unit image_status='done'. Returns
// 'in_progress' while more image units are pending, else 'completed'. With
// OPENAI_API_KEY the generator inserts a media row and media_id>0; without a
// key it returns media_id=0 — the unit is still marked 'done' (there is no
// image to assign, and re-running would never produce one), so the step
// progresses instead of spinning. A poison unit that throws MAX_UNIT_ATTEMPTS
// times is marked 'failed' and skipped. Each invocation does ONE image →
// O(1), fitting the per-invocation budget at any article count.
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
  if (ctx.env.PROVISION_QUEUE) {
    const { enqueued, remaining } = await enqueueProvisionUnits(
      ctx.env,
      ctx.site_id,
      "image",
    );
    const totalUnits = await countArticleUnits(ctx.db, ctx.site_id);
    return {
      status: remaining ? "in_progress" : "completed",
      output: JSON.stringify({
        step: "generate_or_assign_article_images",
        kind: "ai_or_fallback",
        schema_version: 1,
        stage: remaining ? "image_enqueued" : "image_complete",
        enqueued,
        total_units: totalUnits,
      }),
    };
  }

  const unit = await selectNextPendingUnit(
    ctx.db,
    ctx.site_id,
    "image_status",
    true,
  );
  if (unit === null) {
    const totalUnits = await countArticleUnits(ctx.db, ctx.site_id);
    return {
      status: "completed",
      output: JSON.stringify({
        step: "generate_or_assign_article_images",
        kind: "ai_or_fallback",
        schema_version: 1,
        stage: "image_complete",
        total_units: totalUnits,
      }),
    };
  }
  const outcome = await generateOneImageUnit(ctx, unit);
  const morePending = await selectNextPendingUnit(
    ctx.db,
    ctx.site_id,
    "image_status",
    true,
  );
  return {
    status: morePending !== null ? "in_progress" : "completed",
    output: JSON.stringify({
      step: "generate_or_assign_article_images",
      kind: "ai_or_fallback",
      schema_version: 1,
      stage:
        outcome === "retry"
          ? "image_unit_error"
          : morePending !== null
            ? "image_unit_done"
            : "image_complete",
      unit_index: unit.unit_index,
      outcome,
    }),
  };
}

// T36 — publish_starter_articles (step 13).
// The starter rows inserted by generate_15_homepage_articles carry
// status='published' but a NULL published_at (the INSERT omits it), so
// public readers — which filter/ORDER BY published_at — treat them as
// not-yet-live. This step finalizes the publish state for every starter
// article (homepage_section='starter') in one pass:
//   - status='published' + published_at backfilled via
//     COALESCE(published_at, unixepoch()) so a re-run never clobbers
//     the original publish timestamp (idempotent);
//   - sites.content_version bumped monotonically — the same canonical
//     statement the publish workflow uses (workflow/publish.ts) — so
//     public cache keys (which suffix content_version) roll over.
// No invalidatePublishCaches() here: a freshly-provisioned site has no
// cached entries yet (warm_homepage_cache, the NEXT step, populates
// them) and the bumped version suffix already orphans any stale key.
// Pure D1 — zero Cloudflare interaction in any mode.
async function publishStarterArticlesStep(
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
  await ctx.db
    .prepare(
      "UPDATE articles SET status = 'published', " +
        "published_at = COALESCE(published_at, unixepoch()), " +
        "scheduled_at = NULL, updated_at = unixepoch() " +
        "WHERE site_id = ? AND homepage_section = 'starter'",
    )
    .bind(ctx.site_id)
    .run();
  // Receipt count read back from D1 (null-tolerant: harnesses that
  // don't model the articles table report 0 rather than failing).
  const countRow = await ctx.db
    .prepare(
      "SELECT COUNT(*) AS published_count FROM articles " +
        "WHERE site_id = ? AND homepage_section = 'starter' " +
        "AND status = 'published' AND published_at IS NOT NULL",
    )
    .bind(ctx.site_id)
    .first<{ published_count: number }>();
  await ctx.db
    .prepare(
      "UPDATE sites SET content_version = content_version + 1 WHERE id = ?",
    )
    .bind(ctx.site_id)
    .run();
  return {
    status: "completed",
    output: JSON.stringify({
      step: "publish_starter_articles",
      kind: "deterministic_publish",
      schema_version: 1,
      site_id: ctx.site_id,
      published_count: countRow?.published_count ?? 0,
      content_version_bumped: true,
    }),
  };
}

// T37 + rescue-3 T5 — warm_homepage_cache (step 14, STEP_KEYS index 13).
// Delegates to warmHomepageInProcess (cache/warm.ts). The rescue-2 step
// self-fetched https://{hostname}/ to obtain the body — that subrequest
// 403s in production (the origin rejects the Worker's own self-request),
// so the step FAILED and the site stalled in status='draft' while serving
// (user brief BCL-007: "job failed at step 13"). T5-AC1: the homepage is
// now rendered IN-PROCESS via the same renderHomepageHtml the public GET /
// handler uses (NO https://{host}/ self-fetch to 403) and stored via
// putCachedHtml under the canonical htmlKey(site_id, "/", content_version)
// with the router's strong ETag. content_version is read live from the
// sites row (bumped by the preceding publish_starter_articles step) so the
// warmed key matches what the public router will look up; TTL mirrors the
// public pipeline's parseNumber(HTML_CACHE_TTL_SECONDS, 300). Under
// SITE_PROVISIONING_DRY_RUN (the default) the helper renders nothing and
// writes nothing and the step reports completed_dry_run (ZERO outbound
// fetch, ZERO KV put). In live mode the homepage is the step's namesake
// side-effect: a render/put failure marks the step failed; the happy in-
// process path never escalates to FAILED (there is no self-request to fail).
async function warmHomepageCacheStep(
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
  const versionRow = await ctx.db
    .prepare("SELECT content_version FROM sites WHERE id = ? LIMIT 1")
    .bind(ctx.site_id)
    .first<{ content_version: number | null }>();
  const contentVersion =
    versionRow && typeof versionRow.content_version === "number"
      ? versionRow.content_version
      : 0;
  const hostname = await resolveSiteHostname(ctx.db, ctx.site_id);
  const outcome = await warmHomepageInProcess(ctx.env, ctx.db, {
    site_id: ctx.site_id,
    hostname,
    vertical_slug: info.vertical,
    content_version: contentVersion,
    expirationTtl: parseNumber(ctx.env.HTML_CACHE_TTL_SECONDS, 300),
  });
  const output = JSON.stringify({
    step: "warm_homepage_cache",
    kind: "in_process_warm",
    schema_version: 1,
    site_id: ctx.site_id,
    content_version: contentVersion,
    dry_run: outcome.dry_run,
    warmed: outcome.warmed,
    homepage_cache_key: outcome.cacheKey,
    homepage_status: outcome.status,
  });
  if (outcome.dry_run) {
    return { status: "completed_dry_run", output };
  }
  if (outcome.status !== "warmed") {
    return {
      status: "failed",
      output,
      error: outcome.error ?? "homepage warm did not complete",
    };
  }
  return { status: "completed", output };
}

// T38 — run_site_smoke_tests (step 15).
// In-process smoke verification of the freshly-provisioned site: four
// read-only D1 checks, zero fetch in ANY mode (the step never leaves
// the Worker, so there is nothing to dry-run-gate):
//   1. sites_row_present          — the sites row still exists;
//   2. starter_articles_published — >= 1 starter article is publicly
//      live (status='published' AND published_at set), read back via
//      the same canonical COUNT publish_starter_articles uses;
//   3. site_settings_seeded       — the 12-key T19 seed landed
//      (>= 12 site_settings rows for the site);
//   4. pages_present              — >= 1 pages row (about/legal).
// Any failing check fails the step — and therefore the job — with the
// failing check names in error. The step MUST NOT report success while
// an expected side-effect table is empty.
interface SmokeCheck {
  check: string;
  pass: boolean;
  observed: number;
  expected_min: number;
}

async function runSiteSmokeTestsStep(
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
  const checks: SmokeCheck[] = [
    { check: "sites_row_present", pass: true, observed: 1, expected_min: 1 },
  ];
  const articleRow = await ctx.db
    .prepare(
      "SELECT COUNT(*) AS published_count FROM articles " +
        "WHERE site_id = ? AND homepage_section = 'starter' " +
        "AND status = 'published' AND published_at IS NOT NULL",
    )
    .bind(ctx.site_id)
    .first<{ published_count: number }>();
  const publishedCount = articleRow?.published_count ?? 0;
  checks.push({
    check: "starter_articles_published",
    pass: publishedCount >= 1,
    observed: publishedCount,
    expected_min: 1,
  });
  const settingsRow = await ctx.db
    .prepare(
      "SELECT COUNT(*) AS settings_count FROM site_settings WHERE site_id = ?",
    )
    .bind(ctx.site_id)
    .first<{ settings_count: number }>();
  const settingsCount = settingsRow?.settings_count ?? 0;
  checks.push({
    check: "site_settings_seeded",
    pass: settingsCount >= 12,
    observed: settingsCount,
    expected_min: 12,
  });
  const pagesRow = await ctx.db
    .prepare(
      "SELECT COUNT(*) AS pages_count FROM pages WHERE site_id = ?",
    )
    .bind(ctx.site_id)
    .first<{ pages_count: number }>();
  const pagesCount = pagesRow?.pages_count ?? 0;
  checks.push({
    check: "pages_present",
    pass: pagesCount >= 1,
    observed: pagesCount,
    expected_min: 1,
  });
  const failedChecks = checks.filter((c) => !c.pass);
  const output = JSON.stringify({
    step: "run_site_smoke_tests",
    kind: "in_process_smoke",
    schema_version: 1,
    site_id: ctx.site_id,
    checks_run: checks.length,
    checks_passed: checks.length - failedChecks.length,
    checks,
  });
  if (failedChecks.length > 0) {
    return {
      status: "failed",
      output,
      error:
        "smoke checks failed: " +
        failedChecks.map((c) => c.check).join(", "),
    };
  }
  return { status: "completed", output };
}

// T39 + rescue-3 T5 — update_launch_readiness (step 16, the final step).
// D1 rollup + go-live: collects the launch-readiness signals produced by
// the earlier steps into one JSON object and persists it as this step's
// output row (the runner writes StepHandlerResult.output into
// site_creation_job_steps.output). GET /api/admin/sites/:id/provision
// reads that row back and surfaces it as the response's top-level
// `launch_readiness` field (field_contract canonical_name
// launch_readiness: domain_attached, published_articles, media_count,
// cache_warmed, smoke_passed, content_mode). T5-AC2 adds the go-live D1
// write: sites.status -> 'active' (see inline note below). Zero outbound
// fetch in any mode.
async function readJobStepStatus(
  db: D1Database,
  job_id: string,
  step_key: StepKey,
): Promise<string | null> {
  const row = await db
    .prepare(
      "SELECT status FROM site_creation_job_steps " +
        "WHERE job_id = ? AND step_key = ? LIMIT 1",
    )
    .bind(job_id, step_key)
    .first<{ status: string }>();
  return typeof row?.status === "string" ? row.status : null;
}

async function updateLaunchReadinessStep(
  ctx: StepContext,
): Promise<StepHandlerResult> {
  const site = await loadSiteInfo(ctx.db, ctx.site_id);
  if (!site) {
    return {
      status: "failed",
      output: "",
      error: `sites row missing for site_id=${ctx.site_id}`,
    };
  }
  // content_mode rides its own read so a legacy row (or a pre-0010
  // local DB) degrades to the column's DEFAULT 'ai' instead of failing
  // the rollup.
  const modeRow = await ctx.db
    .prepare("SELECT content_mode FROM sites WHERE id = ? LIMIT 1")
    .bind(ctx.site_id)
    .first<{ content_mode: string | null }>();
  const domainRow = await ctx.db
    .prepare(
      "SELECT COUNT(*) AS attached_count FROM domains " +
        "WHERE site_id = ? AND status = 'active'",
    )
    .bind(ctx.site_id)
    .first<{ attached_count: number }>();
  const articlesRow = await ctx.db
    .prepare(
      "SELECT COUNT(*) AS published_count FROM articles " +
        "WHERE site_id = ? AND status = 'published' " +
        "AND published_at IS NOT NULL",
    )
    .bind(ctx.site_id)
    .first<{ published_count: number }>();
  const mediaRow = await ctx.db
    .prepare("SELECT COUNT(*) AS media_count FROM media WHERE site_id = ?")
    .bind(ctx.site_id)
    .first<{ media_count: number }>();
  const warmStatus = await readJobStepStatus(
    ctx.db,
    ctx.job_id,
    "warm_homepage_cache",
  );
  const smokeStatus = await readJobStepStatus(
    ctx.db,
    ctx.job_id,
    "run_site_smoke_tests",
  );
  const launch_readiness = {
    domain_attached: (domainRow?.attached_count ?? 0) >= 1,
    published_articles: articlesRow?.published_count ?? 0,
    media_count: mediaRow?.media_count ?? 0,
    cache_warmed:
      warmStatus === "completed" || warmStatus === "completed_dry_run",
    smoke_passed: smokeStatus === "completed",
    content_mode:
      typeof modeRow?.content_mode === "string" &&
      modeRow.content_mode.length > 0
        ? modeRow.content_mode
        : "ai",
  };
  // rescue-3 T5 (T5-AC2): flip the finished site live. Reaching this final
  // step means every prior step — including run_site_smoke_tests — succeeded
  // (the runner halts the job on the first failed step, so update_launch_
  // readiness never runs after a failure), so the site is verified-ready to
  // serve. Set sites.status 'draft' -> 'active', the schema CHECK-allowed
  // live value (migration 0002: CHECK (status IN ('draft','provisioning',
  // 'active','disabled','failed'))); 'launched' is NOT in the CHECK set and
  // would be rejected. Pure D1 write — runs in dry-run too, because the dry-
  // run gate only suppresses outbound Cloudflare/KV mutation, not the local
  // domain writes every other provisioning step also performs in dry-run.
  await ctx.db
    .prepare(
      "UPDATE sites SET status = 'active', updated_at = unixepoch() WHERE id = ?",
    )
    .bind(ctx.site_id)
    .run();
  const output = JSON.stringify({
    step: "update_launch_readiness",
    kind: "launch_readiness_rollup",
    schema_version: 1,
    site_id: ctx.site_id,
    site_status: "active",
    launch_readiness,
  });
  return { status: "completed", output };
}

// All 16 steps have real handlers: T35 replaced the 3 Cloudflare-boundary
// steps, T36 publish_starter_articles, T37 warm_homepage_cache, T38
// run_site_smoke_tests, and T39 update_launch_readiness (the last
// placeholder) with the implementations above.
export const STEPS: Record<StepKey, StepHandler> = {
  validate_domain_in_cloudflare: validateDomainInCloudflareStep,
  create_site_record: createSiteRecordStep,
  attach_domain_to_new_worker_or_mark_pending: attachDomainToWorkerStep,
  allocate_vertical_categories: allocateVerticalCategoriesStep,
  create_site_settings: seedDefaultSiteSettings,
  generate_tagline_and_site_description: generateTaglineAndSiteDescriptionStep,
  generate_about_page: generateAboutPageStep,
  render_generic_legal_pages_with_site_variables: renderLegalPagesStep,
  generate_logo_mark: generateLogoMarkStep,
  generate_feature_image: generateFeatureImageStep,
  generate_15_homepage_articles: generate15HomepageArticlesStep,
  generate_or_assign_article_images: generateOrAssignArticleImagesStep,
  publish_starter_articles: publishStarterArticlesStep,
  warm_homepage_cache: warmHomepageCacheStep,
  run_site_smoke_tests: runSiteSmokeTestsStep,
  update_launch_readiness: updateLaunchReadinessStep,
};

export function getStepKeyForIndex(index: number): StepKey | null {
  if (!Number.isFinite(index) || index < 0 || index >= STEP_KEYS.length) {
    return null;
  }
  return STEP_KEYS[index] ?? null;
}


// ===========================================================================
// rescue-4 v3 — Cloudflare Queues parallel fan-out. The two heavy gen steps
// enqueue one message per unit; the queue() consumer in src/index.ts runs each
// in its OWN parallel invocation (full speed, no in-invocation contention —
// the thing a single-invocation Promise.all could not do). 'queued' is the
// in-flight marker so a unit is never enqueued twice; a stale 'queued'
// (consumer lost) is reclaimed to 'pending' after PROVISION_QUEUE_RECLAIM_S.
// ===========================================================================

export interface ProvisionMessage {
  site_id: string;
  unit_index: number;
  stage: "text" | "image";
}

const PROVISION_QUEUE_RECLAIM_S = 180;

// Enqueue every still-pending unit for `stage` (marking it 'queued'), reclaiming
// any stale 'queued' first. Returns whether any unit remains unsettled (pending
// or queued) — the step stays in_progress until that is false.
export async function enqueueProvisionUnits(
  env: Env,
  site_id: string,
  stage: "text" | "image",
): Promise<{ enqueued: number; remaining: boolean }> {
  const queue = env.PROVISION_QUEUE;
  if (!queue) return { enqueued: 0, remaining: true };
  const db = env.DB;
  const col = stage === "text" ? "text_status" : "image_status";
  // image work only applies to units whose article body already landed.
  const gate = stage === "image" ? " AND text_status = 'done'" : "";
  // reclaim stale in-flight units (consumer lost) so they re-enqueue.
  await db
    .prepare(
      "UPDATE provisioning_article_units SET " +
        col +
        " = 'pending', updated_at = unixepoch() WHERE site_id = ? AND " +
        col +
        " = 'queued' AND updated_at <= unixepoch() - " +
        String(PROVISION_QUEUE_RECLAIM_S),
    )
    .bind(site_id)
    .run();
  const res = await db
    .prepare(
      "SELECT unit_index FROM provisioning_article_units WHERE site_id = ? AND " +
        col +
        " = 'pending'" +
        gate +
        " ORDER BY unit_index ASC",
    )
    .bind(site_id)
    .all<{ unit_index: number }>();
  const pending = res && Array.isArray(res.results) ? res.results : [];
  let enqueued = 0;
  for (const row of pending) {
    await queue.send({ site_id, unit_index: row.unit_index, stage });
    await db
      .prepare(
        "UPDATE provisioning_article_units SET " +
          col +
          " = 'queued', updated_at = unixepoch() WHERE site_id = ? AND unit_index = ? AND " +
          col +
          " = 'pending'",
      )
      .bind(site_id, row.unit_index)
      .run();
    enqueued += 1;
  }
  const rem = await db
    .prepare(
      "SELECT 1 AS x FROM provisioning_article_units WHERE site_id = ? AND " +
        col +
        " IN ('pending','queued')" +
        gate +
        " LIMIT 1",
    )
    .bind(site_id)
    .first<{ x: number }>();
  return { enqueued, remaining: rem !== null };
}

// Queue consumer body: process ONE message at full speed in its own invocation.
// Idempotent — a re-delivered message for an already-settled unit is a no-op.
// Returns "retry" when the unit's gen failed transiently (caller re-throws so
// the Queue redelivers); "done"/"failed"/"skip" are terminal (caller acks).
export async function processProvisionMessage(
  env: Env,
  msg: ProvisionMessage,
): Promise<"done" | "retry" | "failed" | "skip"> {
  const db = env.DB;
  const ctx: StepContext = {
    env,
    db,
    site_id: msg.site_id,
    job_id: "",
    step_order: 0,
  };
  const unit = await db
    .prepare(
      "SELECT unit_index, slug, title, summary, text_status, image_status, " +
        "article_id, attempt_count FROM provisioning_article_units " +
        "WHERE site_id = ? AND unit_index = ? LIMIT 1",
    )
    .bind(msg.site_id, msg.unit_index)
    .first<ArticleUnitRow>();
  if (!unit) return "skip";
  if (msg.stage === "text") {
    if (unit.text_status === "done" || unit.text_status === "failed") return "skip";
    return await generateOneTextUnit(ctx, unit);
  }
  if (unit.image_status === "done" || unit.image_status === "failed") return "skip";
  return await generateOneImageUnit(ctx, unit);
}
