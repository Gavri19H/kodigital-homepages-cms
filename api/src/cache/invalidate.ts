// Per-site cache invalidation helpers (Phase-7 T15).
//
// Each helper wipes one workflow's slice of the public-content cache
// surface for a single tenant (site_id). The cache-key wire format from
// src/cache/cache-keys.ts puts site_id as the FIRST component after the
// namespace prefix, so a list({prefix: "<ns>:<siteId>:"}) walk + delete
// touches only that tenant.
//
// Versions are SUFFIXES on the cache keys (see cache-keys.ts), so the
// canonical correctness mechanism is a sites.content_version /
// sites.settings_version bump in the writer (T14/T16/T17): once the
// version flips, subsequent reads form a new key and miss into the
// origin. The list+delete here is the COURTESY pass — it keeps the KV
// LRU + list() output tight after a publish/update, but never substitutes
// for the version bump.
//
// Public surface (the four exported helpers below) is the canonical
// home for invalidation; wire points (publish workflow, page admin,
// category admin, settings admin) call these instead of duplicating the
// prefix list inline.

import type { Env } from "../env";

// Article publish wipes the per-site content surface — every namespace
// that participates in article-driven HTML rendering. The article's own
// detail key plus the homepage, category listings, sitemap and feeds
// (which list newly-published articles) all need refresh after publish.
const ARTICLE_PUBLISH_PREFIXES = [
  "html:",
  "article:",
  "homepage-data:",
  "category:",
  "page:",
  "sitemap:",
  "feed:rss:",
  "feed:atom:",
] as const;

// Page update wipes the page detail surface + any HTML key that may have
// rendered the page. Homepage may surface page links so it goes too.
const PAGE_UPDATE_PREFIXES = [
  "html:",
  "page:",
  "homepage-data:",
] as const;

// Category update wipes the category detail surface + the HTML keys that
// may have rendered the category listing, plus the sitemap + feeds (a
// category change affects the category-grouped listings).
const CATEGORY_UPDATE_PREFIXES = [
  "html:",
  "category:",
  "homepage-data:",
  "sitemap:",
  "feed:rss:",
  "feed:atom:",
] as const;

// Settings update wipes the settings-versioned surface only — robots and
// ads are also keyed by settings_version (see cache-keys.ts).
const SETTINGS_UPDATE_PREFIXES = [
  "settings:",
  "robots:",
  "ads:",
] as const;

function requireSiteId(siteId: string): string {
  if (siteId === null || siteId === undefined) {
    throw new Error("invalidate: site_id is required (got null/undefined)");
  }
  const trimmed = String(siteId).trim();
  if (trimmed.length === 0) {
    throw new Error("invalidate: site_id must be a non-empty tenant id");
  }
  return trimmed;
}

async function deleteByPrefix(env: Env, prefix: string): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;
  while (true) {
    const result: KVNamespaceListResult<unknown, string> = await env.CACHE.list(
      { prefix, cursor },
    );
    for (const entry of result.keys) {
      await env.CACHE.delete(entry.name);
      deleted += 1;
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }
  return deleted;
}

async function invalidatePrefixesForSite(
  env: Env,
  siteId: string,
  prefixes: ReadonlyArray<string>,
): Promise<number> {
  const sid = requireSiteId(siteId);
  let total = 0;
  for (const ns of prefixes) {
    total += await deleteByPrefix(env, `${ns}${sid}:`);
  }
  return total;
}

export async function invalidateForArticlePublish(
  env: Env,
  siteId: string,
): Promise<number> {
  return invalidatePrefixesForSite(env, siteId, ARTICLE_PUBLISH_PREFIXES);
}

export async function invalidateForPageUpdate(
  env: Env,
  siteId: string,
): Promise<number> {
  return invalidatePrefixesForSite(env, siteId, PAGE_UPDATE_PREFIXES);
}

export async function invalidateForCategoryUpdate(
  env: Env,
  siteId: string,
): Promise<number> {
  return invalidatePrefixesForSite(env, siteId, CATEGORY_UPDATE_PREFIXES);
}

export async function invalidateForSettingsUpdate(
  env: Env,
  siteId: string,
): Promise<number> {
  return invalidatePrefixesForSite(env, siteId, SETTINGS_UPDATE_PREFIXES);
}
