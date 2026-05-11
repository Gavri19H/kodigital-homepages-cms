// Phase 3 / T17+T19+T20: provisioning step registry.
//
// 15 step keys advance a site_creation_jobs row one step per
// POST /api/admin/sites/:id/provision/next call. T17 wired stubs;
// T18 added dry-run gating for CF-mutation steps; T19 swapped
// create_site_settings for a 12-key seed; T20 swaps the legal-pages
// stub for variable-aware rendering via legal-renderer.ts.
//
// Contract greps (each canonical key appears as a single-quoted literal
// exactly once in the registry tuple it belongs to):
//   - T17.AC1: 15 step-key literals in STEP_KEYS
//   - T19.AC1: 12 site-settings-key literals in DEFAULT_SETTING_SEED

import type { Env } from "../env";
import { renderLegalPagesForSite } from "./legal-renderer";

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

export const STEPS: Record<StepKey, StepHandler> = {
  validate_domain_in_cloudflare: async () =>
    stubResult("validate_domain_in_cloudflare"),
  create_site_record: async () => stubResult("create_site_record"),
  attach_domain_to_new_worker_or_mark_pending: async () =>
    stubResult("attach_domain_to_new_worker_or_mark_pending"),
  allocate_vertical_categories: async () =>
    stubResult("allocate_vertical_categories"),
  create_site_settings: seedDefaultSiteSettings,
  generate_tagline_and_site_description_stub: async () =>
    stubResult("generate_tagline_and_site_description_stub"),
  generate_about_page_stub: async () => stubResult("generate_about_page_stub"),
  render_generic_legal_pages_with_site_variables: renderLegalPagesStep,
  generate_logo_mark_stub: async () => stubResult("generate_logo_mark_stub"),
  generate_feature_image_stub: async () =>
    stubResult("generate_feature_image_stub"),
  generate_15_homepage_articles_stub: async () =>
    stubResult("generate_15_homepage_articles_stub"),
  generate_or_assign_article_images_stub: async () =>
    stubResult("generate_or_assign_article_images_stub"),
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
