// Phase-7 T16: page-mutation cache-invalidation surface for the admin
// module.
//
// When a page is created or updated through the admin UI, the public
// content surface needs to (a) bump the owning site's content_version
// so cache keys (which suffix content_version — see cache-keys.ts) form
// a fresh namespace, and (b) explicitly wipe the per-site page / HTML /
// homepage namespaces (a KV-LRU courtesy — the version bump alone is
// the canonical correctness mechanism).
//
// The two-step pattern mirrors src/workflow/publish.ts (T14): bump
// sites.content_version with a parameterized UPDATE keyed on site_id,
// then delegate the prefix wipe to the canonical invalidation helper
// in src/cache/invalidate.ts (T15).
//
// Hard rule (mirrors db/index.ts + workflow/publish.ts): every D1 call
// uses `db.prepare(<static SQL>).bind(...)` — NO template-literal SQL.

import { invalidateForPageUpdate } from "../cache/invalidate";
import { onPublicChange } from "../edge/public-change";
import { siteTag } from "../edge/tags";
import type { PublicChange } from "../edge/types";
import type { Env } from "../env";

function requireSiteId(siteId: string | null): string {
  if (siteId === null || siteId === undefined) {
    throw new Error("admin/pages: site_id is required (got null/undefined)");
  }
  const trimmed = String(siteId).trim();
  if (trimmed.length === 0) {
    throw new Error("admin/pages: site_id must be a non-empty tenant id");
  }
  return trimmed;
}

// Resolve global page/taxonomy scope before committing the write. The purge
// queue handles the RPC limit, so it needs every site, including inactive ones.
export async function siteTagsForPublicRow(db: D1Database, siteId: string | null): Promise<string[]> {
  if (siteId !== null) return [siteTag(siteId)];
  try {
    const sites = await db.prepare("SELECT id FROM sites ORDER BY id").bind().all<{ id: string }>();
    return sites.results.map(site => siteTag(site.id));
  } catch (error) {
    // A pre-tenant database has no site cache keys. Other read failures must
    // abort the write while the caller can still retry it.
    if (error instanceof Error && /no such table: (?:main\.)?sites\b/i.test(error.message)) return [];
    throw error;
  }
}

// A global template can be adopted by a site. Its new owner gets the legacy
// version bump, while the edge change also covers sites that lost the page.
export async function applyPageMutationCacheInvalidation(
  env: Env,
  siteId: string | null,
  edge?: { change: PublicChange; ctx?: ExecutionContext },
): Promise<void> {
  if (siteId === null && edge) {
    await onPublicChange(env, edge.ctx, edge.change);
    return;
  }
  const sid = requireSiteId(siteId);
  try {
    await env.DB.prepare("UPDATE sites SET content_version = content_version + 1 WHERE id = ?")
      .bind(sid).run();
    await invalidateForPageUpdate(env, sid);
  } finally {
    await onPublicChange(env, edge?.ctx, edge?.change ?? {
      siteId: sid, tags: [siteTag(sid)], reason: "page.update",
    });
  }
}
