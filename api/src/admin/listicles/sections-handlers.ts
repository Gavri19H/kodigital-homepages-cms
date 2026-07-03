// Sections admin CRUD (contract §7.1 / §10 / §23 / §30.7).
//
// A Section is a GLOBAL reusable rich-content unit. Every save:
//   validate (§23 + the governed-link invariant — no free-text URL)
//   → verify every referenced Offer exists & is ACTIVE (§12)
//   → render content_json → content_html through the EXISTING editor
//     pipeline (blocksToHtml + tag-whitelist sanitizer)
//   → rebuild listicle_section_link_instances + the derived
//     listicle_section_offers in the SAME D1 batch (§5.4).
// DELETE soft-archives; it 409s while any listicle_page_section_candidates
// row references the section (§5.3).

import { listicleBlocksToHtml } from "../../editor/listicle-blocks";
import { mintPublicId } from "../../listicles/ids";
import {
  applyLinkInstances,
  buildLinkGraphStatements,
  extractLinkInstances,
  resolveLinkInstances,
  type ExistingLinkInstanceRow,
  type ExtractedLinkInstance,
  type ResolvedLinkInstance,
} from "../../listicles/link-instances";
import {
  parseSectionBlocks,
  validateSection,
  SECTION_STATUSES,
  type FieldErrors,
  type SectionBlock,
} from "../../listicles/validation";
import { renderSectionPreviewDocument } from "./section-preview";
import { buildWhereClause, type FilterCondition } from "../query-filters";
import {
  type AdminContext,
  buildPaging,
  chunk,
  escapeLike,
  idSelector,
  parseDateRange,
  parsePaging,
  placeholders,
  readEntityMetrics,
  readJsonBody,
} from "./shared";

export interface SectionRow {
  id: number;
  public_id: string;
  section_name: string;
  headline_text: string;
  headline_offer_id: number | null;
  image_json: string | null;
  content_json: string;
  content_html: string | null;
  ai_settings_json: string | null;
  content_version: number;
  status: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export async function resolveSectionRow(
  db: D1Database,
  idParam: string,
): Promise<SectionRow | null> {
  const selector = idSelector(idParam);
  if (selector === null) return null;
  const sql =
    selector.column === "id"
      ? "SELECT * FROM listicle_sections WHERE id = ? LIMIT 1"
      : "SELECT * FROM listicle_sections WHERE public_id = ? LIMIT 1";
  const row = await db.prepare(sql).bind(selector.value).first<SectionRow>();
  return row ?? null;
}

interface OfferRefRow {
  id: number;
  public_id: string;
  status: string;
}

// Verify every Offer reference in the extracted link graph (numeric ids +
// inline off_… public ids) exists and is ACTIVE (§12 "validate every
// data-offer + button.offer_id references an active Offer"). Returns the
// public-id → internal-id map the instance resolver needs (and its inverse,
// which the §30.5 enrichment uses to canonicalize stored refs), or errors.
async function verifyOfferReferences(
  db: D1Database,
  instances: ExtractedLinkInstance[],
): Promise<{
  errors: FieldErrors;
  offerIdByPublicId: Map<string, number>;
  offerPublicIdById: Map<number, string>;
}> {
  const errors: FieldErrors = {};
  const numericIds = new Set<number>();
  const publicIds = new Set<string>();
  for (const instance of instances) {
    if (instance.offer_id !== null) numericIds.add(instance.offer_id);
    if (instance.offer_public_id !== null) publicIds.add(instance.offer_public_id);
  }

  const byId = new Map<number, OfferRefRow>();
  for (const ids of chunk([...numericIds])) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT id, public_id, status FROM listicle_offers WHERE id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids)
      .all<OfferRefRow>();
    for (const row of rows.results ?? []) byId.set(row.id, row);
  }
  const offerIdByPublicId = new Map<string, number>();
  for (const ids of chunk([...publicIds])) {
    if (ids.length === 0) continue;
    const rows = await db
      .prepare(
        `SELECT id, public_id, status FROM listicle_offers WHERE public_id IN (${placeholders(ids.length)})`,
      )
      .bind(...ids)
      .all<OfferRefRow>();
    for (const row of rows.results ?? []) {
      offerIdByPublicId.set(row.public_id, row.id);
      byId.set(row.id, row);
    }
  }
  const offerPublicIdById = new Map<number, string>();
  for (const row of byId.values()) offerPublicIdById.set(row.id, row.public_id);

  for (const id of numericIds) {
    const row = byId.get(id);
    if (row === undefined) {
      errors[`offers.${id}`] = `unknown offer id ${id}`;
    } else if (row.status !== "active") {
      errors[`offers.${id}`] = `offer '${row.public_id}' is ${row.status} — links must reference an active Offer`;
    }
  }
  for (const publicId of publicIds) {
    const internal = offerIdByPublicId.get(publicId);
    if (internal === undefined) {
      errors[`offers.${publicId}`] = `unknown offer '${publicId}'`;
      continue;
    }
    const row = byId.get(internal);
    if (row !== undefined && row.status !== "active") {
      errors[`offers.${publicId}`] = `offer '${publicId}' is ${row.status} — links must reference an active Offer`;
    }
  }

  return { errors, offerIdByPublicId, offerPublicIdById };
}

// §30.5/§30.9 enrichment: stamp every governed element's resolved lnk_… id
// into the stored content_json (offer refs canonicalize to off_… public ids)
// and render content_html through the LISTICLE block renderers.
function enrichContent(
  value: { headline_text: string; headline_offer_id: number | null; blocks: SectionBlock[] },
  resolved: ResolvedLinkInstance[],
  offerPublicIdById: Map<number, string>,
): { blocks: SectionBlock[]; contentJson: string; contentHtml: string } {
  const blocks = applyLinkInstances(
    {
      headline_text: value.headline_text,
      headline_offer_id: value.headline_offer_id,
      blocks: value.blocks,
    },
    resolved,
    offerPublicIdById,
  );
  return {
    blocks,
    contentJson: JSON.stringify({ version: 1, blocks }),
    contentHtml: listicleBlocksToHtml({ blocks }),
  };
}

// GET /api/admin/listicles/sections — list + filters + pager
// (?search,status,page) with the management counts the Sections tab shows
// (#offers used, #articles using — §10).
export async function listSectionsHandler(c: AdminContext): Promise<Response> {
  const search = c.req.query("search")?.trim() ?? "";
  const status = c.req.query("status")?.trim() ?? "";
  if (status !== "" && !(SECTION_STATUSES as readonly string[]).includes(status)) {
    return c.json(
      { error: "Validation failed", fields: { status: "status must be active or archived" } },
      400,
    );
  }
  const like = `%${escapeLike(search)}%`;
  const filters: FilterCondition[] = [
    {
      when: search !== "",
      clause: "(section_name LIKE ? ESCAPE '\\' OR headline_text LIKE ? ESCAPE '\\')",
      params: [like, like],
    },
    { when: status !== "", clause: "status = ?", params: [status] },
  ];
  const { clause, params } = buildWhereClause(filters);
  const { page, pageSize, offset } = parsePaging(c);

  const rows = await c.env.DB.prepare(
    `SELECT s.id, s.public_id, s.section_name, s.headline_text, s.headline_offer_id,
            s.content_version, s.status, s.created_at, s.updated_at,
            (SELECT COUNT(DISTINCT so.offer_id) FROM listicle_section_offers so
              WHERE so.section_id = s.id) AS offers_count,
            (SELECT COUNT(DISTINCT ver.article_id)
               FROM listicle_page_section_candidates cand
               JOIN listicle_pages p ON p.id = cand.page_id
               JOIN listicle_article_versions ver ON ver.id = p.article_version_id
              WHERE cand.section_id = s.id) AS articles_using
     FROM listicle_sections s WHERE ${clause}
     ORDER BY s.updated_at DESC, s.id DESC LIMIT ? OFFSET ?`,
  )
    .bind(...params, pageSize, offset)
    .all<Partial<SectionRow> & { offers_count: number; articles_using: number }>();
  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM listicle_sections WHERE ${clause}`,
  )
    .bind(...params)
    .first<{ n: number }>();
  const total = Number(totalRow?.n ?? 0);

  return c.json({ sections: rows.results ?? [], paging: buildPaging(page, pageSize, total) });
}

// POST /api/admin/listicles/sections — create: validate → render → INSERT
// section + link instances + derived section_offers in ONE batch. The link
// rows attach via a subselect on the freshly-minted unique public_id, so a
// failure anywhere leaves no partial section.
export async function createSectionHandler(c: AdminContext): Promise<Response> {
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  const { errors, value } = validateSection(body);
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  const extracted = extractLinkInstances({
    headline_text: value.headline_text,
    headline_offer_id: value.headline_offer_id,
    blocks: value.blocks,
  });
  const refCheck = await verifyOfferReferences(c.env.DB, extracted);
  if (Object.keys(refCheck.errors).length > 0) {
    return c.json({ error: "Validation failed", fields: refCheck.errors }, 400);
  }
  const resolved = await resolveLinkInstances(extracted, refCheck.offerIdByPublicId, []);

  // §30.5 enrichment + LISTICLE renderers: stored content_json carries every
  // governed element's lnk_… id; content_html renders the governed grammar
  // (data-offer / data-link-instance / data-block-id / data-link-role + rel,
  // NO /lc URLs — the live renderer mints those at render time, §12).
  const enriched = enrichContent(value, resolved, refCheck.offerPublicIdById);

  const publicId = mintPublicId("section");
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `INSERT INTO listicle_sections
         (public_id, section_name, headline_text, headline_offer_id, image_json,
          content_json, content_html, ai_settings_json, content_version, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).bind(
      publicId,
      value.section_name,
      value.headline_text,
      value.headline_offer_id,
      value.image_json,
      enriched.contentJson,
      enriched.contentHtml,
      value.ai_settings_json,
      value.status,
    ),
    ...buildLinkGraphStatements(c.env.DB, { public_id: publicId }, resolved),
  ];
  await c.env.DB.batch(statements);

  const row = await c.env.DB.prepare(
    "SELECT * FROM listicle_sections WHERE public_id = ? LIMIT 1",
  )
    .bind(publicId)
    .first<SectionRow>();
  if (!row) return c.json({ error: "Insert failed" }, 500);
  return c.json({ section: row }, 201);
}

// GET /api/admin/listicles/sections/:id — detail + usage count + the §30.7
// link-instance rows (the Section editor's CTA/Link Inventory reconciles its
// client model against these — notably the "__headline__" row's lnk_… id).
export async function getSectionHandler(c: AdminContext): Promise<Response> {
  const section = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (section === null) return c.json({ error: "Not Found" }, 404);
  const usageRow = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM listicle_page_section_candidates WHERE section_id = ?",
  )
    .bind(section.id)
    .first<{ n: number }>();
  const instances = await c.env.DB.prepare(
    `SELECT li.public_id, li.block_id, li.link_role, li.position_index,
            li.anchor_text, li.button_style_id, li.button_group_id,
            li.analytics_label, o.public_id AS offer_public_id,
            o.offer_name AS offer_name
     FROM listicle_section_link_instances li
     JOIN listicle_offers o ON o.id = li.offer_id
     WHERE li.section_id = ?
     ORDER BY li.position_index ASC`,
  )
    .bind(section.id)
    .all();
  return c.json({
    section,
    usage_count: Number(usageRow?.n ?? 0),
    link_instances: instances.results ?? [],
  });
}

// POST /api/admin/listicles/sections/preview — §30.6 Section preview. Renders
// the (possibly mid-edit) section inside the token-derived default
// SectionWrapper. STRUCTURAL parse only: a missing Offer binding still
// previews (the CTA Inventory carries the missing/invalid state); malformed
// JSON is the only rejection.
export async function previewSectionHandler(c: AdminContext): Promise<Response> {
  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);

  let blocks: SectionBlock[] = [];
  if (body.content_json !== undefined && body.content_json !== null) {
    const parsed = parseSectionBlocks(body.content_json);
    if (typeof parsed === "string") {
      return c.json({ error: "Validation failed", fields: { content_json: parsed } }, 400);
    }
    blocks = parsed.blocks;
  }

  let imageUrl: string | null = null;
  const imageRaw = body.image_json ?? body.image;
  if (typeof imageRaw === "string" && imageRaw.trim() !== "") {
    try {
      const image = JSON.parse(imageRaw) as { url?: unknown };
      if (typeof image.url === "string" && image.url.trim() !== "") imageUrl = image.url.trim();
    } catch {
      imageUrl = null;
    }
  } else if (typeof imageRaw === "object" && imageRaw !== null) {
    const url = (imageRaw as { url?: unknown }).url;
    if (typeof url === "string" && url.trim() !== "") imageUrl = url.trim();
  }

  const html = renderSectionPreviewDocument({
    headline_text: typeof body.headline_text === "string" ? body.headline_text : "",
    headline_offer_id: body.headline_offer_id,
    image_url: imageUrl,
    blocks,
  });
  return c.json({ html });
}

const SECTION_PATCH_FIELDS = [
  "section_name",
  "headline_text",
  "headline_offer_id",
  "image_json",
  "image",
  "content_json",
  "ai_settings_json",
  "ai_settings",
  "status",
] as const;

// Content-bearing fields whose change bumps content_version (feeds the §22
// cache-identity chain in later phases).
const CONTENT_FIELDS: ReadonlyArray<keyof SectionRow> = [
  "headline_text",
  "headline_offer_id",
  "image_json",
  "content_json",
];

// PATCH /api/admin/listicles/sections/:id — merge-then-revalidate; ALWAYS
// re-renders content_html and rebuilds the link graph from the merged state
// (idempotent; the §5.4 derived index can never drift from content).
export async function patchSectionHandler(c: AdminContext): Promise<Response> {
  const existing = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (existing === null) return c.json({ error: "Not Found" }, 404);

  const body = await readJsonBody(c);
  if (body === null) return c.json({ error: "Invalid JSON body" }, 400);
  const provided = SECTION_PATCH_FIELDS.filter((field) => body[field] !== undefined);
  if (provided.length === 0) return c.json({ error: "No updatable fields provided" }, 400);

  const merged: Record<string, unknown> = {
    section_name: existing.section_name,
    headline_text: existing.headline_text,
    headline_offer_id: existing.headline_offer_id,
    image_json: existing.image_json,
    content_json: existing.content_json,
    ai_settings_json: existing.ai_settings_json,
    status: existing.status,
  };
  for (const field of provided) {
    merged[field] = body[field];
  }
  // Alias keys: a provided `image` / `ai_settings` must REPLACE the stored
  // *_json value (the validator prefers image_json, so leaving the stale
  // string in `merged` would shadow the update).
  if (body.image !== undefined) {
    merged.image_json = body.image;
    delete merged.image;
  }
  if (body.ai_settings !== undefined) {
    merged.ai_settings_json = body.ai_settings;
    delete merged.ai_settings;
  }
  // `null` clears the nullable references (headline_offer_id / image / ai).
  if (body.headline_offer_id === null) merged.headline_offer_id = null;
  if (body.image_json === null || body.image === null) merged.image_json = null;
  if (body.ai_settings_json === null || body.ai_settings === null) merged.ai_settings_json = null;

  const { errors, value } = validateSection(merged);
  if (value === null) return c.json({ error: "Validation failed", fields: errors }, 400);

  const extracted = extractLinkInstances({
    headline_text: value.headline_text,
    headline_offer_id: value.headline_offer_id,
    blocks: value.blocks,
  });
  const refCheck = await verifyOfferReferences(c.env.DB, extracted);
  if (Object.keys(refCheck.errors).length > 0) {
    return c.json({ error: "Validation failed", fields: refCheck.errors }, 400);
  }
  const existingInstances = await c.env.DB.prepare(
    `SELECT public_id, block_id, link_role, position_index, offer_id
     FROM listicle_section_link_instances WHERE section_id = ?`,
  )
    .bind(existing.id)
    .all<ExistingLinkInstanceRow>();
  const resolved = await resolveLinkInstances(
    extracted,
    refCheck.offerIdByPublicId,
    existingInstances.results ?? [],
  );

  // §30.5 enrichment (see createSectionHandler). The content-change compare
  // runs on the ENRICHED json: a round-tripped save (client re-posts the
  // enriched document it loaded) stays a content_version no-op.
  const enriched = enrichContent(value, resolved, refCheck.offerPublicIdById);

  const contentChanged = CONTENT_FIELDS.some((field) => {
    const before = existing[field] ?? null;
    const after =
      field === "content_json"
        ? enriched.contentJson
        : ((value as unknown as Record<string, unknown>)[field] ?? null);
    return before !== after;
  });
  const contentVersion = existing.content_version + (contentChanged ? 1 : 0);

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE listicle_sections
       SET section_name = ?, headline_text = ?, headline_offer_id = ?, image_json = ?,
           content_json = ?, content_html = ?, ai_settings_json = ?, status = ?,
           content_version = ?, updated_at = unixepoch()
       WHERE id = ?`,
    ).bind(
      value.section_name,
      value.headline_text,
      value.headline_offer_id,
      value.image_json,
      enriched.contentJson,
      enriched.contentHtml,
      value.ai_settings_json,
      value.status,
      contentVersion,
      existing.id,
    ),
    ...buildLinkGraphStatements(c.env.DB, { id: existing.id }, resolved),
  ];
  await c.env.DB.batch(statements);

  const row = await c.env.DB.prepare("SELECT * FROM listicle_sections WHERE id = ? LIMIT 1")
    .bind(existing.id)
    .first<SectionRow>();
  return c.json({ section: row });
}

interface SectionArticleUsageRow {
  id: number;
  public_id: string;
  article_name: string;
  site_id: string;
  status: string;
  version_public_id: string;
  page_index: number;
}

// §5.4 Section → Articles/Versions/Pages usage lookup.
async function sectionArticleUsage(
  db: D1Database,
  sectionId: number,
): Promise<SectionArticleUsageRow[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT a.id, a.public_id, a.article_name, a.site_id, a.status,
              ver.public_id AS version_public_id, p.page_index
       FROM listicle_page_section_candidates c
       JOIN listicle_pages p ON p.id = c.page_id
       JOIN listicle_article_versions ver ON ver.id = p.article_version_id
       JOIN listicle_articles a ON a.id = ver.article_id
       WHERE c.section_id = ?
       ORDER BY a.article_name ASC, ver.public_id ASC, p.page_index ASC`,
    )
    .bind(sectionId)
    .all<SectionArticleUsageRow>();
  return rows.results ?? [];
}

// DELETE /api/admin/listicles/sections/:id — 409 while referenced by any
// page candidate; otherwise SOFT-archive (status='archived') — §5.3.
export async function deleteSectionHandler(c: AdminContext): Promise<Response> {
  const section = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (section === null) return c.json({ error: "Not Found" }, 404);

  const usage = await sectionArticleUsage(c.env.DB, section.id);
  if (usage.length > 0) {
    return c.json(
      {
        error: "Section is in use by article pages and cannot be archived via delete",
        usage,
      },
      409,
    );
  }

  await c.env.DB.prepare(
    "UPDATE listicle_sections SET status = 'archived', updated_at = unixepoch() WHERE id = ?",
  )
    .bind(section.id)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM listicle_sections WHERE id = ? LIMIT 1")
    .bind(section.id)
    .first<SectionRow>();
  return c.json({ ok: true, archived: true, section: row });
}

// GET /api/admin/listicles/sections/:id/usage — articles/versions/pages (§5.4).
export async function sectionUsageHandler(c: AdminContext): Promise<Response> {
  const section = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (section === null) return c.json({ error: "Not Found" }, 404);
  const usage = await sectionArticleUsage(c.env.DB, section.id);
  return c.json({ usage });
}

// GET /api/admin/listicles/sections/:id/offers — Section → Offers (§5.4),
// one row per (offer, link_role) with occurrences.
export async function sectionOffersHandler(c: AdminContext): Promise<Response> {
  const section = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (section === null) return c.json({ error: "Not Found" }, 404);
  const rows = await c.env.DB.prepare(
    `SELECT o.id, o.public_id, o.offer_name, o.provider, o.vertical, o.activity,
            o.status, so.link_role, so.occurrences
     FROM listicle_section_offers so
     JOIN listicle_offers o ON o.id = so.offer_id
     WHERE so.section_id = ?
     ORDER BY o.offer_name ASC, so.link_role ASC`,
  )
    .bind(section.id)
    .all();
  return c.json({ offers: rows.results ?? [] });
}

// GET /api/admin/listicles/sections/:id/analytics?from&to — §18 mirror read.
export async function sectionAnalyticsHandler(c: AdminContext): Promise<Response> {
  const section = await resolveSectionRow(c.env.DB, c.req.param("id") ?? "");
  if (section === null) return c.json({ error: "Not Found" }, 404);
  const range = parseDateRange(c);
  if ("error" in range) {
    return c.json({ error: "Validation failed", fields: { range: range.error } }, 400);
  }
  const metrics = await readEntityMetrics(
    c.env.DB,
    "listicle_analytics_section",
    "section_public_id",
    section.public_id,
    range,
  );
  return c.json({ analytics: { from: range.from, to: range.to, ...metrics } });
}
