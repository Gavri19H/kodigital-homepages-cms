// T31 ([B10] Media library port): admin media CRUD + upload handlers.
//
// Backs the four route registrations in ./api.ts:
//   POST   /api/admin/media/upload -> uploadMediaHandler (multipart)
//   GET    /api/admin/media/:id    -> getMediaHandler
//   PUT    /api/admin/media/:id    -> updateMediaHandler
//   DELETE /api/admin/media/:id    -> deleteMediaHandler
// (port of the legacy admin/api.ts media verbs, adapted to the Phase-3
// tenant model). Split out of api.ts per the sites-handlers.ts /
// pages-crud-handlers.ts / taxonomy-crud-handlers.ts file-size precedent.
//
// Wire contract (the multipart field names the ported media library UI
// sends — these are AUTHORITATIVE, legacy upload-modal parity):
//   file, alt_text, caption, folder (optional, default "/"),
//   site_id (KoDigital tenant extension; "" or absent -> global NULL).
//
// Tenant + safety contract:
//   1. media DOES carry site_id (0002), nullable for the global tier.
//      A request that names a site_id may not read/mutate/delete a row
//      owned by a DIFFERENT site -> 403 TENANT_BOUNDARY_VIOLATION.
//      Global rows (site_id IS NULL) stay visible to every site scope —
//      mirrors the list route's "site rows + globals" predicate.
//   2. Upload verifies a provided site_id resolves in `sites`
//      (400 UNKNOWN_SITE — T7/T30 precedent).
//   3. DELETE returns JSON 200 (never 204): window.api / the modal's
//      fetch json()-parse every response (T30 learning).
//   4. R2 blob delete failure is logged and metadata deletion proceeds
//      (legacy parity — an orphaned blob beats a dangling DB row).
//   5. Every D1 statement is `db.prepare(<static SQL>).bind(...)` — no
//      template-literal SQL (d1-database-safety).
//   6. Round-4 P5c / B-2 10F: an image/svg+xml upload runs through the
//      SHARED sanitizeSvgUpload gate (lib/svg-sanitizer.ts) BEFORE storage —
//      the SAME gate admin/leadgen/assets-handlers.ts's brand-logo endpoint
//      uses, so an SVG uploaded through EITHER route is sanitized. A rejected
//      SVG 400s with a plain-language reason; NOTHING is written to R2/D1.

import type { Context } from "hono";
import type { Env } from "../env";
import { buildStorageKey } from "../media/upload";
import { extractImageDimensions } from "../media/dimensions";
import { sanitizeSvgUpload } from "../lib/svg-sanitizer";

// Upload acceptance set — mirrors the legacy modal help text
// ("Supports: JPEG, PNG, GIF, WebP, AVIF, SVG (max 10MB)").
const SUPPORTED_UPLOAD_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
]);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Static column list shared by INSERT...RETURNING and the :id re-reads.
const MEDIA_COLUMNS =
  "id, site_id, filename, storage_key, mime_type, size_bytes, width, height, alt_text, caption, folder, uploaded_by, created_at, updated_at";

export interface MediaCrudRow {
  id: number;
  site_id: string | null;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  caption: string | null;
  folder: string | null;
  uploaded_by: string | null;
  created_at: number;
  updated_at: number | null;
}

interface MediaUpdateBody {
  site_id?: unknown;
  alt_text?: unknown;
  caption?: unknown;
  folder?: unknown;
}

// Legacy isValidId port: positive decimal integer route param.
function parseNumericId(raw: string | undefined): number | null {
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) return null;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Multipart values arrive typed `string | File | null` — narrow to a
// non-empty trimmed string or null.
function asFormString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

async function siteExists(db: D1Database, siteId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT id FROM sites WHERE id = ? LIMIT 1")
    .bind(siteId)
    .first<{ id: string }>();
  return row !== null && row !== undefined;
}

// The acting site scope may not touch a row owned by a different site.
// Global rows (site_id NULL) pass every scope.
function crossesTenantBoundary(rowSiteId: string | null, actingSiteId: string | null): boolean {
  return actingSiteId !== null && rowSiteId !== null && rowSiteId !== actingSiteId;
}

function tenantViolation(c: Context<{ Bindings: Env }>): Response {
  return c.json(
    {
      error: "Media belongs to a different site",
      code: "TENANT_BOUNDARY_VIOLATION",
    },
    403,
  );
}

// POST /api/admin/media/upload — multipart upload (file, alt_text,
// caption, folder?, site_id?). R2 put first, then the media row; 201
// { item, url } on success (legacy response shape).
export async function uploadMediaHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Invalid form data" }, 400);
  }

  const fileEntry = form.get("file") as unknown as File | string | null;
  if (fileEntry === null || typeof fileEntry === "string") {
    return c.json({ error: "No file provided" }, 400);
  }
  const file = fileEntry;

  const mimeType = file.type;
  if (!SUPPORTED_UPLOAD_TYPES.has(mimeType)) {
    return c.json(
      { error: "Invalid file type. Please select an image file." },
      400,
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: "File too large. Maximum size is 10MB." }, 400);
  }
  if (!file.name || file.name.trim() === "") {
    return c.json({ error: "Invalid filename" }, 400);
  }

  // SECURITY CORE (B-2 10F): sanitize BEFORE an SVG can reach R2 / the
  // public serve path — the SAME shared gate the brand-logo endpoint calls
  // (admin/leadgen/assets-handlers.ts). A non-SVG upload is unaffected
  // (isSvg: false) and falls through to the existing raster path unchanged.
  const svgOutcome = await sanitizeSvgUpload(mimeType, file.name, () => file.text());
  if (svgOutcome.isSvg && !svgOutcome.ok) {
    return c.json(
      { error: `This SVG can't be used: ${svgOutcome.reason}.`, code: "svg_rejected" },
      400,
    );
  }

  // The ported UI's wire field names: alt_text + caption (NOT the
  // Phase-1 'alt'); folder defaults to the legacy root folder "/".
  const altText = asFormString(form.get("alt_text"));
  const caption = asFormString(form.get("caption"));
  const folder = asFormString(form.get("folder")) ?? "/";
  const siteId = asFormString(form.get("site_id"));

  if (siteId !== null && !(await siteExists(c.env.DB, siteId))) {
    return c.json({ error: "Unknown site", code: "UNKNOWN_SITE" }, 400);
  }

  const uploadedBy =
    c.req.header("Cf-Access-Authenticated-User-Email")?.trim() || null;

  const storageKey = buildStorageKey(file.name);
  // A sanitized SVG stores its RE-SERIALIZED bytes (never the caller's
  // original bytes) — size_bytes reflects the sanitized length, not
  // file.size, so the library's displayed size matches what is actually
  // served.
  const buf = svgOutcome.isSvg ? svgOutcome.bytes : await file.arrayBuffer();
  const sizeBytes = svgOutcome.isSvg ? svgOutcome.bytes.byteLength : file.size;
  const dimensions = extractImageDimensions(mimeType, buf);

  try {
    await c.env.MEDIA.put(storageKey, buf, {
      httpMetadata: {
        contentType: mimeType,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("R2 upload failed:", err);
    return c.json({ error: "Failed to upload file to storage" }, 500);
  }

  const row = await c.env.DB.prepare(
    "INSERT INTO media (site_id, filename, storage_key, mime_type, size_bytes, width, height, alt_text, caption, folder, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING " +
      MEDIA_COLUMNS,
  )
    .bind(
      siteId,
      file.name,
      storageKey,
      mimeType,
      sizeBytes,
      dimensions?.width ?? null,
      dimensions?.height ?? null,
      altText,
      caption,
      folder,
      uploadedBy,
    )
    .first<MediaCrudRow>();

  if (row === null || row === undefined) {
    return c.json({ error: "Failed to record media row" }, 500);
  }

  return c.json({ item: row, url: "/media/" + storageKey }, 201);
}

// GET /api/admin/media/:id — single item; optional ?site_id= scope is
// tenant-guarded. 400 invalid id; 403 cross-tenant; 404 unknown.
export async function getMediaHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const id = parseNumericId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid media ID" }, 400);

  const row = await c.env.DB.prepare(
    "SELECT " + MEDIA_COLUMNS + " FROM media WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<MediaCrudRow>();
  if (row === null || row === undefined) {
    return c.json({ error: "Media not found" }, 404);
  }

  const siteId = asFormString(c.req.query("site_id"));
  if (crossesTenantBoundary(row.site_id, siteId)) return tenantViolation(c);

  return c.json({ item: row });
}

// PUT /api/admin/media/:id — metadata update (alt_text, caption,
// folder). Legacy partial semantics: fields absent from the body are
// RETAINED; folder only moves when a non-empty value is sent. The
// acting site scope rides body.site_id (T30 categories precedent).
export async function updateMediaHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const id = parseNumericId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid media ID" }, 400);

  const existing = await c.env.DB.prepare(
    "SELECT " + MEDIA_COLUMNS + " FROM media WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<MediaCrudRow>();
  if (existing === null || existing === undefined) {
    return c.json({ error: "Media not found" }, 404);
  }

  let body: MediaUpdateBody;
  try {
    body = await c.req.json<MediaUpdateBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const siteId = asFormString(body.site_id);
  if (crossesTenantBoundary(existing.site_id, siteId)) {
    return tenantViolation(c);
  }

  const nextAltText =
    body.alt_text !== undefined ? asFormString(body.alt_text) : existing.alt_text;
  const nextCaption =
    body.caption !== undefined ? asFormString(body.caption) : existing.caption;
  const nextFolder = asFormString(body.folder);

  try {
    await c.env.DB.prepare(
      "UPDATE media SET alt_text = ?, caption = ?, folder = COALESCE(?, folder), updated_at = unixepoch() WHERE id = ?",
    )
      .bind(nextAltText, nextCaption, nextFolder, id)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    return c.json({ error: "Failed to update media: " + message }, 500);
  }

  const row = await c.env.DB.prepare(
    "SELECT " + MEDIA_COLUMNS + " FROM media WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<MediaCrudRow>();
  return c.json({ item: row ?? existing });
}

// DELETE /api/admin/media/:id — R2 blob first (failure logged, not
// fatal), then the metadata row. Optional ?site_id= scope is
// tenant-guarded. Responds 200 JSON (never 204 — json()-parsed client).
export async function deleteMediaHandler(
  c: Context<{ Bindings: Env }>,
): Promise<Response> {
  const id = parseNumericId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid media ID" }, 400);

  const existing = await c.env.DB.prepare(
    "SELECT " + MEDIA_COLUMNS + " FROM media WHERE id = ? LIMIT 1",
  )
    .bind(id)
    .first<MediaCrudRow>();
  if (existing === null || existing === undefined) {
    return c.json({ error: "Media not found" }, 404);
  }

  const siteId = asFormString(c.req.query("site_id"));
  if (crossesTenantBoundary(existing.site_id, siteId)) {
    return tenantViolation(c);
  }

  try {
    await c.env.MEDIA.delete(existing.storage_key);
  } catch (err) {
    console.error("Failed to delete from R2:", err);
  }

  try {
    await c.env.DB.prepare("DELETE FROM media WHERE id = ?").bind(id).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : "delete failed";
    return c.json({ error: "Failed to delete media: " + message }, 500);
  }

  return c.json({ deleted: true, id, storage_key: existing.storage_key });
}
