// Phase 3 / WARN-FIX-2: POST /api/admin/sites/:id/purge-cache.
//
// Records the existing provisioning audit entry (including its dry-run
// status), then requests a site-wide public page purge. The response keeps
// the audit row's purge_id and status. Missing sites receive a neutral 404.
//
// Tenant-boundary contract: the handler looks up the site by URL :id
// and resolves the primary domain hostname for that site (falls back
// to sites.domain when no `domains` row is present yet). All D1 calls
// use static SQL + .bind() (mirrors db/index.ts).

import type { Context } from "hono";
import { onPublicChange } from "../edge/public-change";
import { siteTag } from "../edge/tags";
import type { Env } from "../env";
import { cacheExecutionCtx } from "../public/html-pipeline";
import {
  isDryRunProvisioning,
  isRouteMutationAllowed,
} from "../site-provisioning/cloudflare-interfaces";

interface SiteLookupRow {
  id: string;
  domain: string;
}

interface DomainLookupRow {
  hostname: string;
}

interface InsertedLogRow {
  id: number;
}

export async function purgeCacheHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const siteId = c.req.param("id");
  if (typeof siteId !== "string" || siteId.length === 0) {
    return c.json({ error: "Site not found" }, 404);
  }
  const site = await c.env.DB.prepare(
    "SELECT id, domain FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(siteId)
    .first<SiteLookupRow>();
  if (site === null || site === undefined) {
    return c.json({ error: "Site not found" }, 404);
  }

  const primaryDomain = await c.env.DB.prepare(
    "SELECT hostname FROM domains WHERE site_id = ? AND is_primary = 1 ORDER BY id ASC LIMIT 1",
  )
    .bind(siteId)
    .first<DomainLookupRow>();
  const hostname =
    primaryDomain !== null && primaryDomain !== undefined
      ? primaryDomain.hostname
      : site.domain;

  const dryRun = isDryRunProvisioning(c.env);
  const allowRouteMutation = isRouteMutationAllowed(c.env);
  const willDryRun = dryRun || !allowRouteMutation;
  const status = willDryRun ? "completed_dry_run" : "completed";
  const payload = JSON.stringify({
    action: "purge_cache",
    site_id: siteId,
    hostname,
  });
  const responsePayload = JSON.stringify({
    mode: willDryRun ? "dry_run" : "live",
    dry_run: dryRun,
    allow_route_mutation: allowRouteMutation,
  });

  const inserted = await c.env.DB.prepare(
    "INSERT INTO cache_purge_log " +
      "(site_id, hostname, action, status, dry_run, allow_route_mutation, payload, response) " +
      "VALUES (?, ?, 'purge_cache', ?, ?, ?, ?, ?) " +
      "RETURNING id",
  )
    .bind(
      siteId,
      hostname,
      status,
      dryRun ? 1 : 0,
      allowRouteMutation ? 1 : 0,
      payload,
      responsePayload,
    )
    .first<InsertedLogRow>();

  await onPublicChange(c.env, cacheExecutionCtx(c) as ExecutionContext | undefined, {
    siteId, tags: [siteTag(siteId)], reason: "admin_clear_site",
  });

  const purgeId =
    inserted !== null && inserted !== undefined
      ? String(inserted.id)
      : `${siteId}-${Date.now()}`;

  return c.json({
    resource: {
      purge_id: purgeId,
      status,
    },
  });
}
