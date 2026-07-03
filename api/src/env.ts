export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  MEDIA: R2Bucket;
  // rescue-4 v3 — parallel provisioning fan-out queue. Optional: when
  // unbound (tests / local dev) the gen steps fall back to the serial
  // inline path, so the suite runs without a queue binding.
  PROVISION_QUEUE?: Queue<{ site_id: string; unit_index: number; stage: "text" | "image" }>;

  APP_ENV: string;
  ADMIN_HOST: string;
  ADMIN_BASE_URL: string;
  ADMIN_BASE_PATH: string;
  CACHE_API_ENABLED: string;
  HTML_CACHE_TTL_SECONDS: string;
  OPENAI_TEXT_MODEL: string;
  OPENAI_IMAGE_MODEL: string;
  SITE_PROVISIONING_DRY_RUN: string;
  SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: string;

  OPENAI_API_KEY?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_BYPASS_AUTH?: string;
  PREVIEW_SECRET?: string;
  CLOUDFLARE_PROVISIONING_API_TOKEN?: string;
  CLOUDFLARE_CACHE_API_TOKEN?: string;
  ALLOWED_CF_SERVICE_TOKEN_IDS?: string;

  // User-interaction analytics pipeline (POST /api/track -> AWS Kinesis
  // Firehose `homepage-events` -> S3 -> Athena). All optional: when unset the
  // firehose path is a no-op (tests / local dev / pre-provisioned envs).
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  EVENTS_FIREHOSE_STREAM?: string;
  // Listicles tracking pipeline (§16): POST /api/lst/track + /lc ->
  // Firehose `listicle-events` -> S3 -> Athena `listicles.events`/`sessions`.
  // Same AWS creds as the homepage stream; optional so the listicle pipeline
  // no-ops exactly like the homepage one until the stream is provisioned.
  LISTICLE_EVENTS_FIREHOSE_STREAM?: string;
}

export function parseBoolean(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export function parseNumber(value: string | undefined | null, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  const trimmed = value.trim();
  if (trimmed === "") return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getAdminHost(env: Env): string {
  return env.ADMIN_HOST;
}

export function getAdminBaseUrl(env: Env): string {
  return env.ADMIN_BASE_URL;
}

export function isDryRunProvisioning(env: Env): boolean {
  return parseBoolean(env.SITE_PROVISIONING_DRY_RUN);
}

export function isRouteMutationAllowed(env: Env): boolean {
  return parseBoolean(env.SITE_PROVISIONING_ALLOW_ROUTE_MUTATION);
}
