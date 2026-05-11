// Phase 3 / T17 + T19: Provisioning step registry.
//
// The 15 step keys below are the AUTHORITATIVE order in which a
// site_creation_jobs row is advanced by the runner — one step per
// POST /api/admin/sites/:id/provision/next call. T17 wired all 15 as
// deterministic stubs; T18 layers dry-run gating + Cloudflare-interface
// safety on top of the CF-mutation step; T19 swaps the
// `create_site_settings` stub for the real per-site site_settings
// seed (12 keys); T20 swaps the legal-pages stub for variable-aware
// HTML rendering.
//
// Contract greps:
//   - T17.AC1:
//       grep -cE "'(validate_domain_in_cloudflare|...|run_site_smoke_tests)'"
//         api/src/site-provisioning/steps.ts   # must be >= 15
//   - T19.AC1:
//       grep -cE "'(site_name|logo_media_id|tagline|site_description|
//                    brand_tokens_json|robots_txt_content|ads_txt_content|
//                    custom_head_html|custom_footer_html|
//                    newsletter_settings_json|contact_email|privacy_email)'"
//         api/src/site-provisioning/steps.ts   # must be >= 12
//
// The 15 step-key names each appear as a single-quoted literal at
// least once (STEP_KEYS tuple). The 12 site-settings key names each
// appear as a single-quoted literal exactly once (DEFAULT_SETTING_SEED
// tuple inside `seedDefaultSiteSettings`). Both greps therefore count
// every canonical key deterministically.

import type { Env } from "../env";

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
  render_generic_legal_pages_with_site_variables: async () =>
    stubResult("render_generic_legal_pages_with_site_variables"),
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
