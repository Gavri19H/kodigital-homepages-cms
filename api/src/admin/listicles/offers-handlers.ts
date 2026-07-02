// Offers admin CRUD (contract §7.1 / §9 / §23).
//
// Offers are GLOBAL (no site_id). Every content link in the Listicles domain
// references an Offer — so DELETE is 409-guarded by the derived
// listicle_section_offers usage index (§5.3) and archiving is the suggested
// alternative.

import { mintPublicId } from "../../listicles/ids";
import { validateOffer, OFFER_STATUSES } from "../../listicles/validation";
import { buildWhereClause, type FilterCondition } from "../query-filters";
import {
  type AdminContext,
  buildPaging,
  escapeLike,
  idSelector,
  parseDateRange,
  parsePaging,
  readEntityMetrics,
  readJsonBody,
} from "./shared";

export interface OfferRow {
  id: number;
  public_id: string;
  offer_name: string;
  provider: string;
  activity: string;
  vertical: string;
  tag: string | null;
  conversion_tracking_method: string;
  offer_url_template: string;
  payout_method: string;
  payout_currency: string | null;
  payout_value: number | null;
  cap_enabled: number;
  cap_amount: number | null;
  cap_timezone: string | null;
  cap_count_by: string | null;
  cap_fallback_offer_id: number | null;
  cap_fallback_url: string | null;
  status: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

interface SectionUsageRow {
  id: number;
  public_id: string;
  section_name: string;
  status: string;
}

export async function resolveOfferRow(
  db: D1Database,
  idParam: string,
): Promise<OfferRow | null> {
  const selector = idSelector(idParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM listicle_offers WHERE id = ? LIMIT 1"
      : "SELECT * FROM listicle_offers WHERE public_id = ? LIMIT 1";
  const row = await db.prepare(sql).bind(selector.value).first<OfferRow>();
  return row ?? null;
}

// Attribution to Sections (§5.4): DISTINCT because an offer can hold several
// link roles inside one section.
async function offerSectionUsage(db: D1Database, offerId: number): Promise<SectionUsageRow[]> {
  const result = await db
    .prepare(
      `SELECT DISTINCT s.id, s.public_id, s.section_name, s.status
       FROM listicle_section_offers so
       JOIN listicle_sections s ON s.id = so.section_id
       WHERE so.offer_id = ?
       ORDER BY s.section_name ASC, s.id ASC`,
    )
    .bind(offerId)
    .all<SectionUsageRow>();
  return result.results ?? [];
}

// GET /api/admin/listicles/offers — list + filters + pager
// (?search,provider,vertical,activity,status,page — §7.1).
export async function listOffersHandler(c: AdminContext): Promise<Response> {
  const search = c.req.query("search")?.trim() ?? "";
  const provider = c.req.query("provider")?.trim() ?? "";
  const vertical = c.req.query("vertical")?.trim() ?? "";
  const activity = c.req.query("activity")?.trim() ?? "";
  const status = c.req.query("status")?.trim() ?? "";
  if (status !== "" && !(OFFER_STATUSES as readonly string[]).includes(status)) {
    return c.json(
      { error: "Validation failed", fields: { status: "status must be one of active, paused, archived" } },
      400,
    );
  }

  const like = `%${escapeLike(search)}%`;
  const filters: FilterCondition[] = [
    {
      when: search !== "",
      clause:
        "(offer_name LIKE ? ESCAPE '\\' OR provider LIKE ? ESCAPE '\\' OR vertical LIKE ? ESCAPE '\\' OR activity LIKE ? ESCAPE '\\')",
      params: [like, like, like, like],
    },
    { when: provider !== "", clause: "provider = ?", params: [provider] },
    { when: vertical !== "", clause: "vertical = ?", params: [vertical] },
    { when: activity !== "", clause: "activity = ?", params: [activity] },
    { when: status !== "", clause: "status = ?", params: [status] },
  ];
  const { clause, params } = buildWhereClause(filters);
  const { page, pageSize, offset } = parsePaging(c);

  const rows = await c.env.DB.prepare(
    `SELECT * FROM listicle_offers WHERE ${clause} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, pageSize, offset)
    .all<OfferRow>();
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM listicle_offers WHERE ${clause}`,
  )
    .bind(...params)
    .first<{ n: number }>();
  const total = Number(totalRow?.n ?? 0);

  return c.json({ offers: rows.results ?? [], paging: buildPaging(page, pageSize, total) });
}

// POST /api/admin/listicles/offers — create (validation §23; mints public_id).
export async function createOfferHandler(c: AdminContext): Promise<Response> {
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const { errors, value } = validateOffer(body);
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  if (value.cap_fallback_offer_id !== null) {
    const fallback = await c.env.DB.prepare(
      "SELECT id FROM listicle_offers WHERE id = ? LIMIT 1",
    )
      .bind(value.cap_fallback_offer_id)
      .first<{ id: number }>();
    if (!fallback) {
      return c.json(
        { error: "Validation failed", fields: { cap_fallback_offer_id: "unknown fallback offer" } },
        400,
      );
    }
  }

  const publicId = mintPublicId("offer");
  const row = await c.env.DB.prepare(
    `INSERT INTO listicle_offers
       (public_id, offer_name, provider, activity, vertical, tag,
        conversion_tracking_method, offer_url_template, payout_method,
        payout_currency, payout_value, cap_enabled, cap_amount, cap_timezone,
        cap_count_by, cap_fallback_offer_id, cap_fallback_url, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING *`,
  )
    .bind(
      publicId,
      value.offer_name,
      value.provider,
      value.activity,
      value.vertical,
      value.tag,
      value.conversion_tracking_method,
      value.offer_url_template,
      value.payout_method,
      value.payout_currency,
      value.payout_value,
      value.cap_enabled,
      value.cap_amount,
      value.cap_timezone,
      value.cap_count_by,
      value.cap_fallback_offer_id,
      value.cap_fallback_url,
      value.status,
      null,
    )
    .first<OfferRow>();
  if (!row) return c.json({ error: "Insert failed" }, 500);
  return c.json({ offer: row }, 201);
}

// GET /api/admin/listicles/offers/search?q= — the Offer-selection modal feed
// (§13): ACTIVE only, ≤ 50 rows, matched over name/provider/vertical/activity.
export async function searchOffersHandler(c: AdminContext): Promise<Response> {
  const q = c.req.query("q")?.trim() ?? "";
  const like = `%${escapeLike(q)}%`;
  const rows = await c.env.DB.prepare(
    `SELECT id, public_id, offer_name, provider, vertical, activity,
            payout_method, payout_currency, payout_value
     FROM listicle_offers
     WHERE status = 'active'
       AND (offer_name LIKE ? ESCAPE '\\' OR provider LIKE ? ESCAPE '\\'
            OR vertical LIKE ? ESCAPE '\\' OR activity LIKE ? ESCAPE '\\')
     ORDER BY updated_at DESC, id DESC
     LIMIT 50`,
  )
    .bind(like, like, like, like)
    .all<Partial<OfferRow>>();
  return c.json({ offers: rows.results ?? [], q });
}

// GET /api/admin/listicles/offers/:id — detail + usage count.
export async function getOfferHandler(c: AdminContext): Promise<Response> {
  const offer = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (offer === null) return c.json({ error: "Not Found" }, 404);
  const usageRow = await c.env.DB.prepare(
    "SELECT COUNT(DISTINCT section_id) AS n FROM listicle_section_offers WHERE offer_id = ?",
  )
    .bind(offer.id)
    .first<{ n: number }>();
  return c.json({ offer, usage_count: Number(usageRow?.n ?? 0) });
}

// Allow-listed PATCH columns (§7.1 "update (allow-list of columns)").
const OFFER_PATCH_COLUMNS = [
  "offer_name",
  "provider",
  "activity",
  "vertical",
  "tag",
  "conversion_tracking_method",
  "offer_url_template",
  "payout_method",
  "payout_currency",
  "payout_value",
  "cap_enabled",
  "cap_amount",
  "cap_timezone",
  "cap_count_by",
  "cap_fallback_offer_id",
  "cap_fallback_url",
  "status",
] as const;

// PATCH /api/admin/listicles/offers/:id — merge-then-revalidate so a partial
// update can never break a §23 conditional set (e.g. switching to in_site
// without a payout_value).
export async function patchOfferHandler(c: AdminContext): Promise<Response> {
  const existing = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (existing === null) return c.json({ error: "Not Found" }, 404);

  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const providedKeys = OFFER_PATCH_COLUMNS.filter((column) => body[column] !== undefined);
  if (providedKeys.length === 0) {
    return c.json({ error: "No updatable fields provided" }, 400);
  }

  const merged: Record<string, unknown> = {
    offer_name: existing.offer_name,
    provider: existing.provider,
    activity: existing.activity,
    vertical: existing.vertical,
    tag: existing.tag,
    conversion_tracking_method: existing.conversion_tracking_method,
    offer_url_template: existing.offer_url_template,
    payout_method: existing.payout_method,
    payout_currency: existing.payout_currency,
    payout_value: existing.payout_value,
    cap_enabled: existing.cap_enabled,
    cap_amount: existing.cap_amount,
    cap_timezone: existing.cap_timezone,
    cap_count_by: existing.cap_count_by,
    cap_fallback_offer_id: existing.cap_fallback_offer_id,
    cap_fallback_url: existing.cap_fallback_url,
    status: existing.status,
  };
  for (const key of providedKeys) {
    merged[key] = body[key];
  }

  const { errors, value } = validateOffer(merged);
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  if (value.cap_fallback_offer_id !== null) {
    if (value.cap_fallback_offer_id === existing.id) {
      return c.json(
        { error: "Validation failed", fields: { cap_fallback_offer_id: "an offer cannot be its own cap fallback" } },
        400,
      );
    }
    const fallback = await c.env.DB.prepare(
      "SELECT id FROM listicle_offers WHERE id = ? LIMIT 1",
    )
      .bind(value.cap_fallback_offer_id)
      .first<{ id: number }>();
    if (!fallback) {
      return c.json(
        { error: "Validation failed", fields: { cap_fallback_offer_id: "unknown fallback offer" } },
        400,
      );
    }
  }

  const setClauses: string[] = [];
  const bindings: unknown[] = [];
  for (const key of providedKeys) {
    setClauses.push(`${key} = ?`);
    bindings.push((value as unknown as Record<string, unknown>)[key]);
  }
  setClauses.push("updated_at = unixepoch()");
  bindings.push(existing.id);

  await c.env.DB.prepare(
    `UPDATE listicle_offers SET ${setClauses.join(", ")} WHERE id = ?`,
  )
    .bind(...bindings)
    .run();

  const updated = await c.env.DB.prepare("SELECT * FROM listicle_offers WHERE id = ? LIMIT 1")
    .bind(existing.id)
    .first<OfferRow>();
  return c.json({ offer: updated });
}

// DELETE /api/admin/listicles/offers/:id — refuse hard delete while
// referenced (409 + usage; §5.3 "prefer status='archived'").
export async function deleteOfferHandler(c: AdminContext): Promise<Response> {
  const offer = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (offer === null) return c.json({ error: "Not Found" }, 404);

  const sections = await offerSectionUsage(c.env.DB, offer.id);
  const fallbackRefs = await c.env.DB.prepare(
    "SELECT id, public_id, offer_name FROM listicle_offers WHERE cap_fallback_offer_id = ?",
  )
    .bind(offer.id)
    .all<{ id: number; public_id: string; offer_name: string }>();
  const fallbackRows = fallbackRefs.results ?? [];

  if (sections.length > 0 || fallbackRows.length > 0) {
    const usage = [
      ...sections.map((s) => ({ kind: "section" as const, ...s })),
      ...fallbackRows.map((o) => ({ kind: "offer_cap_fallback" as const, ...o })),
    ];
    return c.json(
      {
        error: "Offer is in use and cannot be hard-deleted",
        usage,
        suggestion: "Archive the offer instead (PATCH status='archived')",
      },
      409,
    );
  }

  try {
    // Cap counters cascade via FK; anything else still referencing the row
    // (a race) fails the FK and lands in the catch below.
    await c.env.DB.prepare("DELETE FROM listicle_offers WHERE id = ?").bind(offer.id).run();
  } catch (err) {
    return c.json(
      {
        error: `Offer is referenced and cannot be deleted: ${(err as Error).message}`,
        usage: [],
        suggestion: "Archive the offer instead (PATCH status='archived')",
      },
      409,
    );
  }
  return c.json({ ok: true, id: offer.id, public_id: offer.public_id });
}

// GET /api/admin/listicles/offers/:id/usage — attribution to Sections (§5.4).
export async function offerUsageHandler(c: AdminContext): Promise<Response> {
  const offer = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (offer === null) return c.json({ error: "Not Found" }, 404);
  const usage = await offerSectionUsage(c.env.DB, offer.id);
  return c.json({ usage });
}

// GET /api/admin/listicles/offers/:id/analytics?from&to — §18 ranged sums
// with NULLIF read-time ratios. Empty mirror ⇒ zeros, never a 500.
export async function offerAnalyticsHandler(c: AdminContext): Promise<Response> {
  const offer = await resolveOfferRow(c.env.DB, c.req.param("id") ?? "");
  if (offer === null) return c.json({ error: "Not Found" }, 404);
  const range = parseDateRange(c);
  if ("error" in range) {
    return c.json({ error: "Validation failed", fields: { range: range.error } }, 400);
  }
  const metrics = await readEntityMetrics(
    c.env.DB,
    "listicle_analytics_offer",
    "offer_public_id",
    offer.public_id,
    range,
  );
  return c.json({ analytics: { from: range.from, to: range.to, ...metrics } });
}
