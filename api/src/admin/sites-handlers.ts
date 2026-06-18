// Phase 3 / T13: admin sites endpoint handlers.
//
// The 4 handlers below back the four `adminApi.<verb>("/sites...")` route
// registrations in ./api.ts. They are split out so api.ts stays a thin
// route-table file (T10.AC1 file-size discipline) while still allowing
// the T13.AC1 grep — `admin(Api)?\.(get|post|patch)\("/sites` — to count
// exactly 4 hits in api.ts itself.
//
// Tenant-boundary + safety contract:
//   1. POST /sites refuses legacy-production-family hostnames via
//      assertNotProtectedDomain BEFORE any INSERT — the protected-domain
//      check is the same defense-in-depth gate used by site-provisioning
//      mutators (no real DNS / Worker-route / cache-purge call may ever
//      reach api.cloudflare.com against the legacy production infra).
//   2. Every D1 statement is `db.prepare(<static SQL>).bind(...)` — no
//      template-literal SQL, matching db/index.ts and tenant-guards.ts.
//   3. Idempotency_key (optional header `Idempotency-Key`) short-circuits
//      duplicate POSTs: if a site_creation_job already exists for the key
//      we return 200 with the existing site instead of inserting a second
//      row (matches the schema's UNIQUE(idempotency_key) constraint).
//   4. Newly-created sites land with status='draft' and a paired
//      site_creation_jobs row (status='pending', current_step_index=0)
//      that the T17 runner advances through all TOTAL_STEPS steps.

import type { Context } from "hono";
import type { Env } from "../env";
import {
  assertNotProtectedDomain,
  normalizeHostname,
} from "../safety/protected-domains";
import { runProvisioningToCompletion, TOTAL_STEPS } from "../site-provisioning";
import { runCloudflareSiteTeardown } from "../site-provisioning/cloudflare-interfaces";

interface SiteRow {
  id: string;
  name: string;
  domain: string;
  vertical_slug: string;
  activity: string;
  status: string;
  settings_version: number;
  last_provisioned_at: number | null;
  created_at: number;
  updated_at: number;
}

interface CreateSiteBody {
  domain?: unknown;
  vertical_slug?: unknown;
  activity?: unknown;
  name?: unknown;
}

interface UpdateSiteBody {
  name?: unknown;
  status?: unknown;
  activity?: unknown;
}

interface JobLookupRow {
  id: string;
  site_id: string;
}

// The five legal status VALUES (mirrors the sites.status CHECK constraint in
// 0002_phase3_multi_site_schema.sql). An input outside this set is a 400.
const VALID_SITE_STATUSES: ReadonlySet<string> = new Set([
  "draft",
  "provisioning",
  "active",
  "disabled",
  "failed",
]);

// T36 [BCL-070] — status semantics + transition legality.
//
// The prior ALLOWED_STATUS_TRANSITIONS was a flat set of valid VALUES, so it
// accepted ANY value-to-value change (e.g. draft -> active, jumping straight
// past provisioning). That enforced no from->to legality. This map is keyed by
// the CURRENT status and lists the statuses it may legally move to, encoding
// the provisioning lifecycle as a state machine:
//   draft        -> provisioning | disabled | failed
//   provisioning -> active | failed | disabled
//   active       -> disabled
//   disabled     -> active | draft        (re-enable; active re-checks below)
//   failed       -> provisioning | draft | disabled   (retry / reset)
// A same->same change is an idempotent no-op (handled in the caller). Anything
// not listed here is rejected (HTTP 409) so an illegal transition can never
// land in the sites table.
const ALLOWED_STATUS_TRANSITIONS: ReadonlyMap<string, ReadonlySet<string>> =
  new Map([
    ["draft", new Set(["provisioning", "disabled", "failed"])],
    ["provisioning", new Set(["active", "failed", "disabled"])],
    ["active", new Set(["disabled"])],
    ["disabled", new Set(["active", "draft"])],
    ["failed", new Set(["provisioning", "draft", "disabled"])],
  ]);

function isLegalStatusTransition(from: string, to: string): boolean {
  if (from === to) return true; // idempotent no-op
  const allowed = ALLOWED_STATUS_TRANSITIONS.get(from);
  return allowed !== undefined && allowed.has(to);
}

function shortId(prefix: string): string {
  const uuid = crypto.randomUUID().replace(/-/g, "");
  return `${prefix}_${uuid.slice(0, 16)}`;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isHostnameShaped(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(host);
}

export async function listSitesHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const result = await c.env.DB.prepare(
    "SELECT id, name, domain, vertical_slug, activity, status, settings_version, last_provisioned_at, created_at, updated_at FROM sites ORDER BY created_at DESC, id DESC LIMIT 500",
  ).all<SiteRow>();
  return c.json({ resource: result.results ?? [] });
}

export async function getSiteHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const id = c.req.param("id");
  if (typeof id !== "string" || id.length === 0) {
    return c.json({ error: "Invalid site id" }, 400);
  }
  const row = await c.env.DB.prepare(
    "SELECT id, name, domain, vertical_slug, activity, status, settings_version, last_provisioned_at, created_at, updated_at FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<SiteRow>();
  if (row === null || row === undefined) {
    return c.json({ error: "Site not found" }, 404);
  }
  return c.json({ resource: row });
}

export async function createSiteHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  let body: CreateSiteBody;
  try {
    body = await c.req.json<CreateSiteBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const domain = normalizeHostname(stringField(body.domain));
  const verticalSlug = stringField(body.vertical_slug);
  const activityRaw = stringField(body.activity);
  const activity = activityRaw.length > 0 ? activityRaw : "main";
  const nameInput = stringField(body.name);

  if (domain.length === 0) {
    return c.json({ error: "domain is required" }, 400);
  }
  if (!isHostnameShaped(domain)) {
    return c.json({ error: "domain is not a valid hostname" }, 400);
  }
  try {
    assertNotProtectedDomain(domain);
  } catch (err) {
    const message = err instanceof Error ? err.message : "protected-domain rejection";
    return c.json({ error: message, reason: "protected-domain" }, 400);
  }
  if (verticalSlug.length === 0) {
    return c.json({ error: "vertical_slug is required" }, 400);
  }
  if (activity !== "main") {
    return c.json({ error: "activity must be 'main'" }, 400);
  }

  const verticalRow = await c.env.DB.prepare(
    "SELECT slug FROM verticals WHERE slug = ? LIMIT 1",
  )
    .bind(verticalSlug)
    .first<{ slug: string }>();
  if (verticalRow === null || verticalRow === undefined) {
    return c.json({ error: `unknown vertical_slug: ${verticalSlug}` }, 400);
  }

  const idempotencyKey = c.req.header("Idempotency-Key") ?? null;
  if (idempotencyKey !== null && idempotencyKey.length > 0) {
    const existing = await c.env.DB.prepare(
      "SELECT id, site_id FROM site_creation_jobs WHERE idempotency_key = ? LIMIT 1",
    )
      .bind(idempotencyKey)
      .first<JobLookupRow>();
    if (existing !== null && existing !== undefined) {
      const existingSite = await c.env.DB.prepare(
        "SELECT id, domain, status FROM sites WHERE id = ? LIMIT 1",
      )
        .bind(existing.site_id)
        .first<{ id: string; domain: string; status: string }>();
      if (existingSite !== null && existingSite !== undefined) {
        return c.json({ resource: existingSite, idempotent_replay: true }, 200);
      }
    }
  }

  const existingDomain = await c.env.DB.prepare(
    "SELECT site_id FROM domains WHERE hostname = ? LIMIT 1",
  )
    .bind(domain)
    .first<{ site_id: string }>();
  if (existingDomain !== null && existingDomain !== undefined) {
    return c.json(
      { error: `domain already attached to site ${existingDomain.site_id}` },
      409,
    );
  }

  const siteId = shortId("st");
  const jobId = shortId("job");
  const siteName = nameInput.length > 0 ? nameInput : domain;

  try {
    await c.env.DB.prepare(
      "INSERT INTO sites (id, name, domain, vertical_slug, activity, status) VALUES (?, ?, ?, ?, ?, 'draft')",
    )
      .bind(siteId, siteName, domain, verticalSlug, activity)
      .run();
    await c.env.DB.prepare(
      "INSERT INTO domains (site_id, hostname, kind, is_primary, status) VALUES (?, ?, 'canonical', 1, 'pending')",
    )
      .bind(siteId, domain)
      .run();
    // T34: total_steps is bound from the live registry length (16) so
    // the row can never drift from STEP_KEYS; migration 0002's
    // DEFAULT 15 only ever applies to legacy rows, which the runner's
    // stale-job guard re-syncs.
    await c.env.DB.prepare(
      "INSERT INTO site_creation_jobs (id, site_id, idempotency_key, status, current_step_index, total_steps) VALUES (?, ?, ?, 'pending', 0, ?)",
    )
      .bind(jobId, siteId, idempotencyKey, TOTAL_STEPS)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : "insert failed";
    return c.json({ error: `failed to create site: ${message}` }, 500);
  }

  // MQAFIX-1: drive the provisioning runner to completion inline so the
  // freshly-created site reaches the final step within the AC4 60-second
  // budget without relying on a manual UI driver. All steps are
  // deterministic + dry-run gated for Cloudflare mutations, so the loop
  // completes in milliseconds against D1. Errors are swallowed — the
  // site row is already committed and a halted job can be retried via
  // the /provision/next endpoint.
  try {
    await runProvisioningToCompletion(c.env, c.env.DB, siteId);
  } catch (err) {
    void err;
  }

  return c.json(
    { resource: { id: siteId, domain, status: "draft" } },
    201,
  );
}

export async function updateSiteHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const id = c.req.param("id");
  if (typeof id !== "string" || id.length === 0) {
    return c.json({ error: "Invalid site id" }, 400);
  }
  let body: UpdateSiteBody;
  try {
    body = await c.req.json<UpdateSiteBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT id, name, status, activity FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<{ id: string; name: string; status: string; activity: string }>();
  if (existing === null || existing === undefined) {
    return c.json({ error: "Site not found" }, 404);
  }

  const nextName = stringField(body.name);
  const nextStatus = stringField(body.status);
  const nextActivity = stringField(body.activity);
  if (nextStatus.length > 0) {
    // (1) value validity — an unknown status string is a 400.
    if (!VALID_SITE_STATUSES.has(nextStatus)) {
      return c.json({ error: `invalid status: ${nextStatus}` }, 400);
    }
    // (2) from->to legality — an illegal transition (e.g. draft -> active,
    // skipping provisioning) is rejected with 409 Conflict; the sites row is
    // left untouched.
    if (!isLegalStatusTransition(existing.status, nextStatus)) {
      return c.json(
        {
          error: `illegal status transition: ${existing.status} -> ${nextStatus}`,
        },
        409,
      );
    }
    // (3) active implies a servable (reconciled) domain. Dry-run provisioning
    // leaves the domain row at status='pending', so a site whose domain never
    // reconciled cannot be served — refuse to mark it active. A domain is
    // reconciled once the route-attach step promotes it to status='active'
    // (site-provisioning/cloudflare-interfaces.ts markDomainAttached).
    if (nextStatus === "active" && existing.status !== "active") {
      const reconciled = await c.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM domains WHERE site_id = ? AND status = 'active'",
      )
        .bind(id)
        .first<{ n: number }>();
      const reconciledCount =
        reconciled !== null &&
        reconciled !== undefined &&
        typeof reconciled.n === "number"
          ? reconciled.n
          : 0;
      if (reconciledCount < 1) {
        return c.json(
          {
            error:
              "cannot activate: site has no reconciled (servable) domain",
          },
          409,
        );
      }
    }
  }
  if (nextActivity.length > 0 && nextActivity !== "main") {
    return c.json({ error: "activity must be 'main'" }, 400);
  }

  const name = nextName.length > 0 ? nextName : existing.name;
  const status = nextStatus.length > 0 ? nextStatus : existing.status;
  const activity = nextActivity.length > 0 ? nextActivity : existing.activity;

  await c.env.DB.prepare(
    "UPDATE sites SET name = ?, status = ?, activity = ?, updated_at = unixepoch() WHERE id = ?",
  )
    .bind(name, status, activity, id)
    .run();

  const row = await c.env.DB.prepare(
    "SELECT id, name, domain, vertical_slug, activity, status, settings_version, last_provisioned_at, created_at, updated_at FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<SiteRow>();
  return c.json({ resource: row });
}

// T37 [BCL-021] — DELETE /api/admin/sites/:id. The real Delete-site
// operation. It (1) tears down the Cloudflare Worker route + purges the
// site's cache through the dry-run-gated boundary (zero outbound fetch in
// dry-run mode) and (2) cascade-removes every child row the site owns so
// the domain frees for reuse (a subsequent POST /sites for the same
// hostname no longer 409s).
//
// The cascade is issued as EXPLICIT, ordered DELETE statements rather than
// relying on FK ON DELETE CASCADE — D1/SQLite only enforces FK cascades
// when `PRAGMA foreign_keys=ON`, so explicit deletes are the deterministic,
// testable contract. Child rows are removed before the parent sites row.
// ai_generations is detached (site_id := NULL) to mirror its declared
// `ON DELETE SET NULL` semantics (the generation history is preserved).
// Every statement is `prepare(<static SQL>).bind(...)` — no template SQL.
//
// CF teardown is resolved BEFORE the domains row is deleted (it needs the
// primary hostname + cf_route_id). Teardown errors do not abort the DB
// cascade — the row removal is what frees the domain, and a halted CF call
// is logged to cache_purge_log for a later reconcile.
export async function deleteSiteHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const id = c.req.param("id");
  if (typeof id !== "string" || id.length === 0) {
    return c.json({ error: "Invalid site id" }, 400);
  }

  const site = await c.env.DB.prepare(
    "SELECT id, domain FROM sites WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<{ id: string; domain: string | null }>();
  if (site === null || site === undefined) {
    return c.json({ error: "Site not found" }, 404);
  }

  // Resolve the primary domain + its attached CF route BEFORE the domains
  // row is deleted. Fall back to sites.domain when no domains row exists.
  const primaryDomain = await c.env.DB.prepare(
    "SELECT hostname, cf_route_id FROM domains WHERE site_id = ? ORDER BY is_primary DESC, id ASC LIMIT 1",
  )
    .bind(id)
    .first<{ hostname: string; cf_route_id: string | null }>();
  const hostname =
    primaryDomain !== null && primaryDomain !== undefined
      ? primaryDomain.hostname
      : (site.domain ?? "");
  const cfRouteId =
    primaryDomain !== null && primaryDomain !== undefined
      ? primaryDomain.cf_route_id
      : null;

  // (1) Cloudflare route/DNS teardown + cache purge (dry-run gated).
  let teardownStatus = "skipped";
  let teardownOutbound = 0;
  if (hostname.length > 0) {
    const teardown = await runCloudflareSiteTeardown(
      { env: c.env, db: c.env.DB },
      { site_id: id, hostname, cf_route_id: cfRouteId },
    );
    teardownStatus = teardown.status;
    teardownOutbound = teardown.outbound_calls;
  }

  // (2) Cascade-delete every child row, then the site itself. Child-first so
  // no orphan rows survive even with FK enforcement off. Job steps are keyed
  // by job_id, so they are removed via the active jobs of this site first.
  try {
    await c.env.DB.prepare(
      "DELETE FROM site_creation_job_steps WHERE job_id IN (SELECT id FROM site_creation_jobs WHERE site_id = ?)",
    )
      .bind(id)
      .run();
    await c.env.DB.prepare(
      "DELETE FROM site_creation_jobs WHERE site_id = ?",
    )
      .bind(id)
      .run();
    await c.env.DB.prepare("DELETE FROM domains WHERE site_id = ?")
      .bind(id)
      .run();
    await c.env.DB.prepare("DELETE FROM site_categories WHERE site_id = ?")
      .bind(id)
      .run();
    await c.env.DB.prepare("DELETE FROM site_settings WHERE site_id = ?")
      .bind(id)
      .run();
    await c.env.DB.prepare("DELETE FROM articles WHERE site_id = ?")
      .bind(id)
      .run();
    await c.env.DB.prepare("DELETE FROM pages WHERE site_id = ?")
      .bind(id)
      .run();
    await c.env.DB.prepare("DELETE FROM media WHERE site_id = ?")
      .bind(id)
      .run();
    await c.env.DB.prepare("DELETE FROM tags WHERE site_id = ?")
      .bind(id)
      .run();
    await c.env.DB.prepare("DELETE FROM redirects WHERE site_id = ?")
      .bind(id)
      .run();
    // Detach (not delete) the AI generation log — mirrors the schema's
    // declared ON DELETE SET NULL for ai_generations.
    await c.env.DB.prepare(
      "UPDATE ai_generations SET site_id = NULL WHERE site_id = ?",
    )
      .bind(id)
      .run();
    await c.env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(id).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : "delete failed";
    return c.json({ error: `failed to delete site: ${message}` }, 500);
  }

  return c.json({
    resource: {
      id,
      deleted: true,
      hostname,
      teardown: {
        status: teardownStatus,
        outbound_calls: teardownOutbound,
      },
    },
  });
}
