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
import { renderHomepageHtml } from "../public/render-pages";
import type { PublicSiteContext } from "../public/middleware";

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

// rescue-3 T5 (T5-AC1): in-process homepage warm.
//
// The rescue-2 warm_homepage_cache step self-fetched https://{hostname}/ to
// obtain the body before caching it. That subrequest 403s in production (the
// origin rejects the Worker's own self-request), so the 14th provisioning
// step (STEP_KEYS index 13) FAILED and the site stalled in status='draft'
// while already serving publicly (user brief BCL-007: "job failed at step
// 13"). warmHomepageInProcess removes the self-request entirely: it renders
// the homepage IN-PROCESS via the exact renderHomepageHtml the public GET /
// handler uses (zero outbound fetch — nothing to 403) and stores the body
// under the canonical htmlKey(site_id, "/", content_version) with the same
// strong ETag the public router computes, so the very next crawler/user hit
// is a cache HIT. Dry-run (the provisioning default) renders nothing and
// writes nothing — preserving the negative_fail_condition that a dry-run run
// emits ZERO outbound HTTP and ZERO KV puts.
export interface WarmHomepageInProcessInput {
  site_id: string;
  hostname: string;
  vertical_slug: string;
  content_version: number;
  dryRun?: boolean;
  expirationTtl?: number;
  // Injectable renderer (defaults to the canonical renderHomepageHtml). The
  // provisioning step uses the default; unit tests pass a deterministic stub
  // so the warm CONTRACT (in-process render -> putCachedHtml under htmlKey,
  // ZERO outbound fetch) is assertable without standing up the full home
  // view-model D1 surface.
  renderHomepage?: (
    db: D1Database,
    siteContext: PublicSiteContext,
  ) => string | Promise<string>;
}

export interface WarmHomepageInProcessResult {
  dry_run: boolean;
  warmed: number;
  cacheKey: string;
  status: "warmed" | "dry_run" | "failed";
  error?: string;
}

export async function warmHomepageInProcess(
  env: Env,
  db: D1Database,
  input: WarmHomepageInProcessInput,
): Promise<WarmHomepageInProcessResult> {
  const cacheKey = htmlKey(input.site_id, "/", input.content_version);
  const dryRun = resolveDryRunDefault(env, input.dryRun);
  if (dryRun) {
    return { dry_run: true, warmed: 0, cacheKey, status: "dry_run" };
  }
  const render = input.renderHomepage ?? renderHomepageHtml;
  try {
    const siteContext: PublicSiteContext = {
      site_id: input.site_id,
      siteId: input.site_id,
      hostname: input.hostname,
      vertical_slug: input.vertical_slug,
      status: "active",
      content_version: input.content_version,
      settings_version: 0,
    };
    const body = await render(db, siteContext);
    const etag = await computeEtag({
      site_id: input.site_id,
      path: "/",
      content_version: input.content_version,
    });
    await putCachedHtml(env, cacheKey, body, {
      etag,
      expirationTtl: input.expirationTtl,
    });
    return { dry_run: false, warmed: 1, cacheKey, status: "warmed" };
  } catch (err) {
    return {
      dry_run: false,
      warmed: 0,
      cacheKey,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
