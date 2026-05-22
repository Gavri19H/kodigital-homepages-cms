// Phase-7 T16: category-mutation cache-invalidation surface for the
// admin module.
//
// When a category is created or updated through the admin UI, the
// public content surface needs to (a) bump the owning site's
// content_version so cache keys (which suffix content_version — see
// cache-keys.ts) form a fresh namespace, and (b) explicitly wipe the
// per-site category / HTML / homepage / sitemap / feed namespaces (a
// KV-LRU courtesy — the version bump alone is the canonical correctness
// mechanism). Sitemap + feed are included because the public listing
// of categories drives those documents.
//
// The two-step pattern mirrors src/workflow/publish.ts (T14): bump
// sites.content_version with a parameterized UPDATE keyed on site_id,
// then delegate the prefix wipe to the canonical invalidation helper
// in src/cache/invalidate.ts (T15).
//
// Hard rule (mirrors db/index.ts + workflow/publish.ts): every D1 call
// uses `db.prepare(<static SQL>).bind(...)` — NO template-literal SQL.

import { invalidateForCategoryUpdate } from "../cache/invalidate";
import type { Env } from "../env";

function requireSiteId(siteId: string): string {
  if (siteId === null || siteId === undefined) {
    throw new Error(
      "admin/categories: site_id is required (got null/undefined)",
    );
  }
  const trimmed = String(siteId).trim();
  if (trimmed.length === 0) {
    throw new Error(
      "admin/categories: site_id must be a non-empty tenant id",
    );
  }
  return trimmed;
}

// Bumps sites.content_version for the owning tenant and wipes the per-site
// category / HTML / homepage / sitemap / feed cache namespaces. Called
// from the admin POST / PATCH category handlers after the underlying
// categories-row write succeeds.
export async function applyCategoryMutationCacheInvalidation(
  env: Env,
  siteId: string,
): Promise<void> {
  const sid = requireSiteId(siteId);

  await env.DB
    .prepare(
      "UPDATE sites SET content_version = content_version + 1 WHERE id = ?",
    )
    .bind(sid)
    .run();

  await invalidateForCategoryUpdate(env, sid);
}
