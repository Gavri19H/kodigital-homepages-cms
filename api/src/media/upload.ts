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

import { Hono } from "hono";
import type { Env } from "../env";

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

function buildStorageKey(filename: string): string {
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

  const altText = asNullableString(form.get("alt") as unknown as string | File | null);
  const folder = asNullableString(form.get("folder") as unknown as string | File | null);
  const mimeType = file.type !== "" ? file.type : FALLBACK_CONTENT_TYPE;
  const storageKey = buildStorageKey(file.name);
  const buf = await file.arrayBuffer();

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
