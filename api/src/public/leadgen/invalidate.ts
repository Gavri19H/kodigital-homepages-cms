// LeadGen §28 — per-site funnel cache invalidation (the src/listicles/invalidate.ts
// mirror for the public `/lg` funnel runtime).
//
// Two namespaces participate in the funnel runtime cache (cache-keys.ts):
//   lg-shell:{site_id}:{quote_slug}:{funnel_id}:{funnel_variant_id}:{content_version}:{template_version}
//   lg-config:{site_id}:{funnel_id}:{funnel_variant_id}:{content_version}:{ab_rev}
// site_id is the FIRST component after the namespace, so a per-site
// list({ prefix: "<ns>:<site_id>:" }) walk + delete touches ONLY that tenant —
// the exact discipline src/cache/invalidate.ts documents for the CMS surface.
//
// WHY these helpers exist beyond the content_version bump: a variant SAVE bumps
// content_version (→ a NEW lg-shell:/lg-config: key; the old one is orphaned, so
// this is the courtesy pass that just keeps KV tight, exactly like
// cache/invalidate.ts). But an ACTIVATION change (enable / disable / slug /
// settings_overrides — including the baked-in GA4 id) does NOT bump
// content_version, so the stale per-site entry MUST be evicted here or the funnel
// serves the wrong GA4 id / a disabled shell until the TTL expires.
//
// FAIL-OPEN: every KV op is contained (a list/delete hiccup never throws into the
// admin write). The ONLY throw is the RED-LINE empty-site_id refusal (the global-
// wipe / cross-tenant-leak guard); callers schedule these on waitUntil so even
// that guard can never break the write.
//
// WARM: deferred (§28 warm is the perf optimization; correct invalidation is the
// hard requirement). The first visitor after an activation cold-renders the shell
// and write-throughs it (serve.ts), lazily re-priming the cache — no warm cron.

import type { Env } from "../../env";

const NS_LG_SHELL = "lg-shell";
const NS_LG_CONFIG = "lg-config";

// The ':'-split index of the funnel_id segment in an lg-shell key
// (lg-shell : site_id : quote_slug : funnel_id : …). Used to narrow a
// site-prefixed shell wipe to a single funnel: the quote_slug segment sits
// between site_id and funnel_id, so a plain prefix cannot isolate the funnel.
const SHELL_FUNNEL_ID_SEGMENT = 3;

export interface LeadgenInvalidateResult {
  site_id: string;
  cache_keys_deleted: number;
}

// RED LINE: an empty/blank site_id would build "<ns>::" — a prefix that matches
// EVERY tenant's keys (a global wipe / cross-tenant leak). Refuse fast, exactly
// as cache-keys.ts / cache/invalidate.ts do.
function requireSiteId(siteId: string): string {
  if (siteId === null || siteId === undefined) {
    throw new Error("leadgen invalidate: site_id is required (got null/undefined)");
  }
  const trimmed = String(siteId).trim();
  if (trimmed.length === 0) {
    throw new Error("leadgen invalidate: site_id must be a non-empty tenant id");
  }
  return trimmed;
}

// Paginated (cursor / list_complete) list+delete of every key under `prefix`,
// optionally only those whose key satisfies `match`. FAIL-OPEN: a list or delete
// hiccup is contained (returns the count deleted so far) — never throws into the
// caller. Mirrors src/cache/invalidate.ts deleteByPrefix, plus the optional
// per-key predicate for funnel-narrowed shell wipes.
async function deleteByPrefix(
  env: Env,
  prefix: string,
  match?: (key: string) => boolean,
): Promise<number> {
  let cursor: string | undefined;
  let deleted = 0;
  try {
    while (true) {
      const result: KVNamespaceListResult<unknown, string> = await env.CACHE.list({
        prefix,
        cursor,
      });
      for (const entry of result.keys) {
        if (match !== undefined && !match(entry.name)) continue;
        try {
          await env.CACHE.delete(entry.name);
          deleted += 1;
        } catch {
          // per-key hiccup contained (fail-open)
        }
      }
      if (result.list_complete) break;
      cursor = result.cursor;
    }
  } catch {
    // list hiccup contained (fail-open) — the content_version / key discipline
    // still guarantees a fresh read misses the orphaned entry.
  }
  return deleted;
}

// §28 activation change (enable / disable / slug / settings_overrides — including
// the baked-in per-site GA4 id) → evict the ENTIRE per-site funnel surface (every
// quote on the site). None of those axes bump content_version, so the stale
// lg-shell: / lg-config: entries would otherwise serve until the TTL. Per-site_id
// scoped: never a global wipe, never another tenant's keys (an empty site_id is
// refused before any KV op).
export async function invalidateOnQuoteActivation(
  env: Env,
  siteId: string,
): Promise<LeadgenInvalidateResult> {
  const sid = requireSiteId(siteId);
  let deleted = 0;
  deleted += await deleteByPrefix(env, `${NS_LG_SHELL}:${sid}:`);
  deleted += await deleteByPrefix(env, `${NS_LG_CONFIG}:${sid}:`);
  return { site_id: sid, cache_keys_deleted: deleted };
}

// §28 variant publish — the content_version bump is the correctness mechanism (a
// new key); this courtesy pass evicts the orphaned entries, narrowed to the one
// affected funnel. lg-config keys prefix cleanly (lg-config:{site}:{funnel_id}:…);
// lg-shell keys carry the quote_slug between site_id and funnel_id, so they are
// listed per-site and filtered on the funnel_id segment. Per-site_id scoped (an
// empty site_id is refused). An empty funnel_id narrows to nothing (a safe no-op,
// never a wider wipe).
export async function invalidateOnVariantPublish(
  env: Env,
  siteId: string,
  funnelId: string,
): Promise<LeadgenInvalidateResult> {
  const sid = requireSiteId(siteId);
  let deleted = 0;
  // lg-shell: list the site, delete only THIS funnel's shells (any slug/variant).
  deleted += await deleteByPrefix(
    env,
    `${NS_LG_SHELL}:${sid}:`,
    (key) => key.split(":")[SHELL_FUNNEL_ID_SEGMENT] === funnelId,
  );
  // lg-config: funnel_id is the segment right after site_id → a clean prefix.
  deleted += await deleteByPrefix(env, `${NS_LG_CONFIG}:${sid}:${funnelId}:`);
  return { site_id: sid, cache_keys_deleted: deleted };
}
