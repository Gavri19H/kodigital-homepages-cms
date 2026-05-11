// Phase 3 / T14: admin verticals + domains endpoint handlers.
//
// Backs three `adminApi.<verb>("/<verticals|domains>...")` registrations
// in ./api.ts so the T14.AC1 grep —
// `admin(Api)?\.(get|patch)\("/(verticals|domains)` — counts exactly 3
// hits in api.ts:
//   1. adminApi.get("/verticals", ...)
//   2. adminApi.get("/domains", ...)
//   3. adminApi.patch("/domains/:id", ...)
//
// Tenant-boundary + safety contract:
//   - Read-only `verticals` is a global table seeded in migration 0004; the
//     handler returns all 8 slugs ordered by display_order so the New Site
//     modal renders them in the canonical Phase-3 order.
//   - `domains` is per-site (FK -> sites). The list endpoint is unfiltered
//     so the admin Domains tab can render an aggregate view across tenants;
//     PATCH only mutates a small safe subset of columns (status / is_primary
//     / kind) and never crosses tenant boundaries — domain rows already
//     carry site_id and we never re-parent them here.
//   - Every D1 statement is `db.prepare(<static SQL>).bind(...)` (no
//     template-literal SQL), matching sites-handlers.ts.

import type { Context } from "hono";
import type { Env } from "../env";

interface VerticalRow {
  id: number;
  slug: string;
  name: string;
  display_order: number;
}

interface DomainRow {
  id: number;
  site_id: string;
  hostname: string;
  kind: string;
  is_primary: number;
  status: string;
  ssl_status: string | null;
  cf_route_id: string | null;
  attached_at: number | null;
  created_at: number;
  updated_at: number;
}

interface UpdateDomainBody {
  status?: unknown;
  kind?: unknown;
  is_primary?: unknown;
}

const ALLOWED_DOMAIN_STATUS: ReadonlySet<string> = new Set([
  "pending",
  "active",
  "disabled",
  "failed",
]);

const ALLOWED_DOMAIN_KIND: ReadonlySet<string> = new Set([
  "canonical",
  "alias",
]);

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function listVerticalsHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const result = await c.env.DB.prepare(
    "SELECT id, slug, name, display_order FROM verticals ORDER BY display_order ASC, slug ASC LIMIT 200",
  ).all<VerticalRow>();
  return c.json({ resource: result.results ?? [] });
}

export async function listDomainsHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const siteIdFilter = stringField(c.req.query("site_id"));
  if (siteIdFilter.length > 0) {
    const filtered = await c.env.DB.prepare(
      "SELECT id, site_id, hostname, kind, is_primary, status, ssl_status, cf_route_id, attached_at, created_at, updated_at FROM domains WHERE site_id = ? ORDER BY created_at DESC, id DESC LIMIT 500",
    )
      .bind(siteIdFilter)
      .all<DomainRow>();
    return c.json({ resource: filtered.results ?? [] });
  }
  const result = await c.env.DB.prepare(
    "SELECT id, site_id, hostname, kind, is_primary, status, ssl_status, cf_route_id, attached_at, created_at, updated_at FROM domains ORDER BY created_at DESC, id DESC LIMIT 500",
  ).all<DomainRow>();
  return c.json({ resource: result.results ?? [] });
}

export async function updateDomainHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const idRaw = c.req.param("id");
  if (typeof idRaw !== "string" || idRaw.length === 0) {
    return c.json({ error: "Invalid domain id" }, 400);
  }
  const id = parseInt(idRaw, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return c.json({ error: "Invalid domain id" }, 400);
  }

  let body: UpdateDomainBody;
  try {
    body = await c.req.json<UpdateDomainBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const existing = await c.env.DB.prepare(
    "SELECT id, site_id, hostname, kind, is_primary, status FROM domains WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<{
      id: number;
      site_id: string;
      hostname: string;
      kind: string;
      is_primary: number;
      status: string;
    }>();
  if (existing === null || existing === undefined) {
    return c.json({ error: "Domain not found" }, 404);
  }

  const nextStatus = stringField(body.status);
  const nextKind = stringField(body.kind);
  if (nextStatus.length > 0 && !ALLOWED_DOMAIN_STATUS.has(nextStatus)) {
    return c.json({ error: `invalid status: ${nextStatus}` }, 400);
  }
  if (nextKind.length > 0 && !ALLOWED_DOMAIN_KIND.has(nextKind)) {
    return c.json({ error: `invalid kind: ${nextKind}` }, 400);
  }
  let nextIsPrimary = existing.is_primary;
  if (body.is_primary !== undefined) {
    if (typeof body.is_primary === "boolean") {
      nextIsPrimary = body.is_primary ? 1 : 0;
    } else if (typeof body.is_primary === "number") {
      nextIsPrimary = body.is_primary === 1 ? 1 : 0;
    } else {
      return c.json({ error: "is_primary must be boolean or 0/1" }, 400);
    }
  }

  const status = nextStatus.length > 0 ? nextStatus : existing.status;
  const kind = nextKind.length > 0 ? nextKind : existing.kind;

  await c.env.DB.prepare(
    "UPDATE domains SET status = ?, kind = ?, is_primary = ?, updated_at = unixepoch() WHERE id = ?",
  )
    .bind(status, kind, nextIsPrimary, id)
    .run();

  const row = await c.env.DB.prepare(
    "SELECT id, site_id, hostname, kind, is_primary, status, ssl_status, cf_route_id, attached_at, created_at, updated_at FROM domains WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<DomainRow>();
  return c.json({ resource: row });
}
