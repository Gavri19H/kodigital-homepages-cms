// Phase 3 / T17: Provisioning step registry.
//
// The 15 step keys below are the AUTHORITATIVE order in which a
// site_creation_jobs row is advanced by the runner — one step per
// POST /api/admin/sites/:id/provision/next call. Each handler is a
// deterministic stub: no fetch() to api.cloudflare.com, no OpenAI
// call, no R2 write. T18 layers dry-run gating + Cloudflare-interface
// safety on top of these stubs; T19/T20 swap a few stubs for real
// site-settings + legal-template behavior.
//
// Contract grep (T17.AC1):
//   grep -cE "'(validate_domain_in_cloudflare|...|run_site_smoke_tests)'"
//     api/src/site-provisioning/steps.ts   # must be >= 15
//
// Each of the 15 names appears as a single-quoted literal at least
// once in this file (the STEP_KEYS tuple), so the grep counts every
// canonical key exactly once even if the STEPS map below grows.

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

export const STEPS: Record<StepKey, StepHandler> = {
  validate_domain_in_cloudflare: async () =>
    stubResult("validate_domain_in_cloudflare"),
  create_site_record: async () => stubResult("create_site_record"),
  attach_domain_to_new_worker_or_mark_pending: async () =>
    stubResult("attach_domain_to_new_worker_or_mark_pending"),
  allocate_vertical_categories: async () =>
    stubResult("allocate_vertical_categories"),
  create_site_settings: async () => stubResult("create_site_settings"),
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
