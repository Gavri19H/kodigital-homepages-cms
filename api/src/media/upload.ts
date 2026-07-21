// Media upload handler: POST /admin/media (multipart/form-data).
//
// The upload pipeline is intentionally minimal for Phase 1:
//   - Read the `file` field from the multipart body.
//   - Pick a content-addressed storage key (yyyy/mm/dd/<uuid><ext>) so the
//     1-year immutable Cache-Control on the serve path is always safe.
//   - Stream the bytes into R2 with httpMetadata.contentType set so the
//     serve path can echo it back as Content-Type.
//   - Insert a media row keyed by storage_key (UNIQUE) using parameterized
//     SQL only — no template-literal interpolation.
//
// Auth: this route is mounted under /admin so the access middleware wired
// in T12 (`app.use('/admin/*', accessAuth)`) will gate it. The handler
// itself does not re-implement auth.
//
// Round-4 P5c / B-2 10F: this was the THIRD (and last) route that could
// store a raw, unsanitized image/svg+xml upload. It now runs through the
// SAME shared sanitizeSvgUpload gate as admin/leadgen/assets-handlers.ts's
// brand-logo endpoint and admin/media-crud-handlers.ts's generic upload — an
// SVG-shaped upload is sanitized-or-rejected identically on all three routes.
// Every other mime type is untouched (this route still has no allowlist
// beyond the SVG gate — that stays out of scope here).

import { Hono } from "hono";
import type { Env } from "../env";
import { sanitizeSvgUpload } from "../lib/svg-sanitizer";

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

// Exported so the admin media-library upload endpoint (T31,
// admin/media-crud-handlers.ts) shares the exact same key convention.
export function buildStorageKey(filename: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const match = filename.match(/\.[A-Za-z0-9]+$/);
  const ext = match ? match[0]!.toLowerCase() : "";
  return `${yyyy}/${mm}/${dd}/${crypto.randomUUID()}${ext}`;
}

function asNullableString(value: string | File | null): string | null {
  if (value === null) return null;
  if (typeof value !== "string") return null;
  return value === "" ? null : value;
}

const upload = new Hono<{ Bindings: Env }>();

// Route: POST /admin/media — accepts multipart/form-data with `file` field.
upload.post("/admin/media", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Expected multipart/form-data body" }, 400);
  }

  // FormData.get is typed as `string | null` in @cloudflare/workers-types
  // even though the runtime returns File objects for multipart file fields.
  // Cast through `unknown` so we can narrow with instanceof.
  const fileEntry = form.get("file") as unknown as File | string | null;
  if (fileEntry === null || typeof fileEntry === "string") {
    return c.json({ error: "Missing 'file' field" }, 400);
  }
  const file = fileEntry;

  // SECURITY CORE (B-2 10F): sanitize BEFORE an SVG can reach R2 / the
  // public serve path. `file.type` (possibly "") is passed raw — NOT the
  // FALLBACK_CONTENT_TYPE-defaulted value — so the gate's own filename
  // fallback (an empty/generic mime + a `.svg` name) still triggers.
  const svgOutcome = await sanitizeSvgUpload(file.type, file.name, () => file.text());
  if (svgOutcome.isSvg && !svgOutcome.ok) {
    return c.json(
      { error: `This SVG can't be used: ${svgOutcome.reason}.`, code: "svg_rejected" },
      400,
    );
  }

  const altText = asNullableString(form.get("alt") as unknown as string | File | null);
  const folder = asNullableString(form.get("folder") as unknown as string | File | null);
  const mimeType = svgOutcome.isSvg
    ? svgOutcome.mime
    : file.type !== ""
      ? file.type
      : FALLBACK_CONTENT_TYPE;
  const storageKey = buildStorageKey(file.name);
  // A sanitized SVG stores its RE-SERIALIZED bytes (never the raw upload);
  // size_bytes below reflects that sanitized length, not the original.
  const buf = svgOutcome.isSvg ? svgOutcome.bytes : await file.arrayBuffer();

  await c.env.MEDIA.put(storageKey, buf, {
    httpMetadata: { contentType: mimeType },
  });

  const row = await c.env.DB
    .prepare(
      "INSERT INTO media (filename, storage_key, mime_type, size_bytes, alt_text, folder) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(file.name, storageKey, mimeType, buf.byteLength, altText, folder)
    .first<{ id: number }>();

  if (!row) {
    return c.json({ error: "Failed to record media row" }, 500);
  }

  return c.json({
    id: row.id,
    filename: file.name,
    storage_key: storageKey,
    mime_type: mimeType,
    size_bytes: buf.byteLength,
    alt_text: altText,
    folder,
  });
});

export default upload;
