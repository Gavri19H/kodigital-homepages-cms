// Phase-7 T17: settings-mutation cache-invalidation surface for the
// admin module.
//
// When site settings are updated through the admin UI, the settings-
// versioned cache surface needs to (a) bump the owning site's
// settings_version so settings/robots/ads cache keys (which suffix
// settings_version — see cache-keys.ts) form a fresh namespace, and
// (b) explicitly wipe the per-site settings / robots / ads namespaces
// (a KV-LRU courtesy — the version bump alone is the canonical
// correctness mechanism).
//
// The two-step pattern mirrors src/admin/pages.ts + src/admin/categories.ts
// (T16) and src/workflow/publish.ts (T14): a parameterized UPDATE keyed
// on site_id, then delegate the prefix wipe to the canonical invalidation
// helper in src/cache/invalidate.ts (T15). The version axis is different
// here — settings_version, NOT content_version — so the settings cache
// surface evolves independently of article / page / category writes.
//
// Hard rule (mirrors db/index.ts + workflow/publish.ts): every D1 call
// uses `db.prepare(<static SQL>).bind(...)` — NO template-literal SQL.

import { invalidateForSettingsUpdate } from "../cache/invalidate";
import type { Env } from "../env";

function requireSiteId(siteId: string): string {
  if (siteId === null || siteId === undefined) {
    throw new Error(
      "admin/settings: site_id is required (got null/undefined)",
    );
  }
  const trimmed = String(siteId).trim();
  if (trimmed.length === 0) {
    throw new Error(
      "admin/settings: site_id must be a non-empty tenant id",
    );
  }
  return trimmed;
}

// Bumps sites.settings_version for the owning tenant and wipes the per-site
// settings / robots / ads cache namespaces. Called from the admin
// settings-mutation handlers after the underlying site_settings row write
// succeeds.
export async function applySettingsMutationCacheInvalidation(
  env: Env,
  siteId: string,
): Promise<void> {
  const sid = requireSiteId(siteId);

  await env.DB
    .prepare(
      "UPDATE sites SET settings_version = settings_version + 1 WHERE id = ?",
    )
    .bind(sid)
    .run();

  await invalidateForSettingsUpdate(env, sid);
}
