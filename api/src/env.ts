export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  MEDIA: R2Bucket;

  APP_ENV: string;
  ADMIN_BASE_URL: string;
  CACHE_API_ENABLED: string;
  OPENAI_TEXT_MODEL: string;
  OPENAI_IMAGE_MODEL: string;

  OPENAI_API_KEY?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  DEV_BYPASS_AUTH?: string;
  PREVIEW_SECRET?: string;
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
