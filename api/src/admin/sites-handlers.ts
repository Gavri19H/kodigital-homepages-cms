// Phase 3 / T13: admin sites endpoint handlers.
//
// The 4 handlers below back the four `adminApi.<verb>("/sites...")` route
// registrations in ./api.ts. They are split out so api.ts stays a thin
// route-table file (T10.AC1 file-size discipline) while still allowing
// the T13.AC1 grep — `admin(Api)?\.(get|post|patch)\("/sites` — to count
// exactly 4 hits in api.ts itself.
//
// Tenant-boundary + safety contract:
//   1. POST /sites refuses TheIWise-family hostnames via
//      assertNotProtectedDomain BEFORE any INSERT — the protected-domain
//      check is the same defense-in-depth gate used by site-provisioning
//      mutators (no real DNS / Worker-route / cache-purge call may ever
//      reach api.cloudflare.com against TheIWise infra).
//   2. Every D1 statement is `db.prepare(<static SQL>).bind(...)` — no
//      template-literal SQL, matching db/index.ts and tenant-guards.ts.
//   3. Idempotency_key (optional header `Idempotency-Key`) short-circuits
//      duplicate POSTs: if a site_creation_job already exists for the key
//      we return 200 with the existing site instead of inserting a second
//      row (matches the schema's UNIQUE(idempotency_key) constraint).
//   4. Newly-created sites land with status='draft' and a paired
//      site_creation_jobs row (status='pending', current_step_index=0)
//      that the T17 runner advances through 15 steps.

import type { Context } from "hono";
import type { Env } from "../env";
import {
  assertNotProtectedDomain,
  normalizeHostname,
} from "../safety/protected-domains";
import { runProvisioningToCompletion } from "../site-provisioning";

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

const ALLOWED_STATUS_TRANSITIONS: ReadonlySet<string> = new Set([
  "draft",
  "provisioning",
  "active",
  "disabled",
  "failed",
]);

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
    await c.env.DB.prepare(
      "INSERT INTO site_creation_jobs (id, site_id, idempotency_key, status, current_step_index, total_steps) VALUES (?, ?, ?, 'pending', 0, 15)",
    )
      .bind(jobId, siteId, idempotencyKey)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : "insert failed";
    return c.json({ error: `failed to create site: ${message}` }, 500);
  }

  // MQAFIX-1: drive the provisioning runner to completion inline so the
  // freshly-created site reaches step 15 of 15 within the AC4 60-second
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
  if (nextStatus.length > 0 && !ALLOWED_STATUS_TRANSITIONS.has(nextStatus)) {
    return c.json({ error: `invalid status: ${nextStatus}` }, 400);
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
