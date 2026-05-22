// Phase-7 cache warm helper (proposal.md §"Best-effort warm of homepage +
// sitemap + feed keys after publish"). After a publish bumps
// sites.content_version, invalidate helpers wipe stale KV entries and
// this helper re-issues homepage + sitemap + feed:rss + feed:atom
// requests against the public router so the very next crawler/user hit
// lands on a cached body. Per-target failures are swallowed and recorded
// so one transient origin error does NOT poison the broader pass.
//
// Wire contract: under dry-run (default), NO outbound fetch and NO
// KV.put — guards T5 negative_fail_condition (zero outbound HTTP to
// api.cloudflare.com — we forbid all outbound HTTP under dry-run). Under
// live mode, warmSiteCache calls the public router via warmFetch
// (defaulting to globalThis.fetch) and stores the body in env.CACHE
// under the canonical cache-keys.ts key. No api.cloudflare.com URL is
// ever constructed.

import type { Env } from "../env";
import {
  feedAtomKey,
  feedRssKey,
  htmlKey,
  sitemapKey,
} from "./cache-keys";
import { computeEtag, putCachedHtml } from "./edge-cache";

export type WarmKind = "homepage" | "sitemap" | "feed:rss" | "feed:atom";

export interface WarmTarget {
  kind: WarmKind;
  url: string;
  cacheKey: string;
  etagInputs?: { site_id: string; path: string; content_version: number };
}

export interface WarmSiteCacheInput {
  site_id: string;
  content_version: number;
  originBaseUrl: string;
  dryRun?: boolean;
  expirationTtl?: number;
  warmFetch?: typeof fetch;
}

export interface WarmTargetResult {
  kind: WarmKind;
  cacheKey: string;
  status: "warmed" | "dry_run" | "skipped" | "failed";
  http_status?: number;
  error?: string;
}

export interface WarmSiteCacheOutcome {
  site_id: string;
  content_version: number;
  dry_run: boolean;
  attempted: number;
  warmed: number;
  failed: number;
  results: WarmTargetResult[];
}

function resolveDryRunDefault(env: Env, callerDryRun: boolean | undefined): boolean {
  if (callerDryRun === true) return true;
  if (callerDryRun === false) return false;
  const envValue = (env.SITE_PROVISIONING_DRY_RUN ?? "").trim().toLowerCase();
  if (envValue === "false" || envValue === "0" || envValue === "no") return false;
  return true;
}

function joinUrl(base: string, path: string): string {
  const trimmedBase = base.endsWith("/") ? base.slice(0, -1) : base;
  const prefixedPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimmedBase}${prefixedPath}`;
}

// buildWarmTargets returns the canonical four warm targets in the order
// the publish workflow expects. Exposed so a unit test can pin the wire
// shape of every key/url pair without booting an Env.
export function buildWarmTargets(input: {
  site_id: string;
  content_version: number;
  originBaseUrl: string;
}): WarmTarget[] {
  const { site_id, content_version, originBaseUrl } = input;
  return [
    {
      kind: "homepage",
      url: joinUrl(originBaseUrl, "/"),
      cacheKey: htmlKey(site_id, "/", content_version),
      etagInputs: { site_id, path: "/", content_version },
    },
    {
      kind: "sitemap",
      url: joinUrl(originBaseUrl, "/sitemap.xml"),
      cacheKey: sitemapKey(site_id, content_version),
    },
    {
      kind: "feed:rss",
      url: joinUrl(originBaseUrl, "/feed.xml"),
      cacheKey: feedRssKey(site_id, content_version),
    },
    {
      kind: "feed:atom",
      url: joinUrl(originBaseUrl, "/atom.xml"),
      cacheKey: feedAtomKey(site_id, content_version),
    },
  ];
}

async function warmOne(
  env: Env,
  target: WarmTarget,
  input: WarmSiteCacheInput,
): Promise<WarmTargetResult> {
  const fetcher = input.warmFetch ?? globalThis.fetch;
  const resp = await fetcher(target.url, { method: "GET" });
  if (!resp.ok) {
    return {
      kind: target.kind,
      cacheKey: target.cacheKey,
      status: "skipped",
      http_status: resp.status,
    };
  }
  const body = await resp.text();

  if (target.kind === "homepage" && target.etagInputs) {
    const etag = await computeEtag(target.etagInputs);
    await putCachedHtml(env, target.cacheKey, body, {
      etag,
      expirationTtl: input.expirationTtl,
    });
  } else if (input.expirationTtl !== undefined) {
    await env.CACHE.put(target.cacheKey, body, {
      expirationTtl: input.expirationTtl,
    });
  } else {
    await env.CACHE.put(target.cacheKey, body);
  }

  return {
    kind: target.kind,
    cacheKey: target.cacheKey,
    status: "warmed",
    http_status: resp.status,
  };
}

// warmSiteCache pre-populates the four canonical cache keys for a site
// after a publish bumps content_version. Best-effort: per-target failures
// are recorded as `failed` but do NOT throw — the publish workflow MUST
// NOT rollback because a warm pass missed.
export async function warmSiteCache(
  env: Env,
  input: WarmSiteCacheInput,
): Promise<WarmSiteCacheOutcome> {
  const dryRun = resolveDryRunDefault(env, input.dryRun);
  const targets = buildWarmTargets({
    site_id: input.site_id,
    content_version: input.content_version,
    originBaseUrl: input.originBaseUrl,
  });

  const results: WarmTargetResult[] = [];
  let warmed = 0;
  let failed = 0;

  for (const target of targets) {
    if (dryRun) {
      results.push({ kind: target.kind, cacheKey: target.cacheKey, status: "dry_run" });
      continue;
    }
    try {
      const r = await warmOne(env, target, input);
      results.push(r);
      if (r.status === "warmed") warmed += 1;
    } catch (err) {
      results.push({
        kind: target.kind,
        cacheKey: target.cacheKey,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      });
      failed += 1;
    }
  }

  return {
    site_id: input.site_id,
    content_version: input.content_version,
    dry_run: dryRun,
    attempted: targets.length,
    warmed,
    failed,
    results,
  };
}
