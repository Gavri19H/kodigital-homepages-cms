// Phase 3 / T10: SiteContext resolution for the public Worker.
//
// Public requests arrive on a tenant hostname (e.g. mysite.com). This
// module derives the corresponding `SiteContext` (site_id + canonical
// metadata) from the (domains JOIN sites) registry and, critically,
// REFUSES to resolve the admin host as a public site so the admin
// surface can never leak into public rendering.
//
// Tenant-boundary contract:
//   1. ADMIN_HOST (cms.kodigital.app) MUST never resolve to a public
//      SiteContext. Even if a misconfiguration registered ADMIN_HOST in
//      the domains table, isAdminHost() short-circuits the lookup.
//   2. All comparisons are case-insensitive and tolerant of trailing
//      dots / ports / URL fragments via normalizeHostname().
//   3. Every site lookup is parameterized via .bind() — no template-
//      literal interpolation into SQL (matches db/index.ts pattern).

import type { Env } from "../env";
import { normalizeHostname } from "../safety/protected-domains";

export interface SiteContext {
  site_id: string;
  hostname: string;
  vertical_slug: string;
  status: string;
}

interface SiteContextRow {
  site_id: string;
  hostname: string;
  vertical_slug: string;
  status: string;
}

export function isAdminHost(hostname: string, env: Env): boolean {
  const admin = normalizeHostname(env.ADMIN_HOST);
  if (admin.length === 0) return false;
  const candidate = normalizeHostname(hostname);
  return candidate.length > 0 && candidate === admin;
}

export function assertPublicSiteHostNotAdminHost(
  hostname: string,
  env: Env,
): void {
  if (isAdminHost(hostname, env)) {
    throw new Error(
      `Tenant boundary violation: admin host (${normalizeHostname(env.ADMIN_HOST)}) ` +
        `MUST NOT be resolved as a public site.`,
    );
  }
}

export async function resolveSiteByHostname(
  db: D1Database,
  hostname: string,
  env?: Env,
): Promise<SiteContext | null> {
  const normalized = normalizeHostname(hostname);
  if (normalized.length === 0) return null;

  // Defense-in-depth: when an env is supplied, refuse the admin host
  // before touching the registry. Even without env, the admin host is
  // never inserted into the domains table, so the SELECT below would
  // return null anyway — this short-circuit just makes the boundary
  // explicit.
  if (env !== undefined && isAdminHost(normalized, env)) return null;

  const stmt = db
    .prepare(
      "SELECT s.id AS site_id, d.hostname AS hostname, s.vertical_slug AS vertical_slug, s.status AS status " +
        "FROM domains d INNER JOIN sites s ON s.id = d.site_id " +
        "WHERE d.hostname = ? AND d.status = 'active' LIMIT 1",
    )
    .bind(normalized);
  const row = await stmt.first<SiteContextRow>();
  if (row === null || row === undefined) return null;
  return {
    site_id: row.site_id,
    hostname: row.hostname,
    vertical_slug: row.vertical_slug,
    status: row.status,
  };
}

export async function resolveSiteContextFromRequest(
  request: Request,
  db: D1Database,
  env: Env,
): Promise<SiteContext | null> {
  let hostname = "";
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    return null;
  }
  if (isAdminHost(hostname, env)) return null;
  return resolveSiteByHostname(db, hostname, env);
}
