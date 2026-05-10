// Media serve handler: GET /media/<key> -> R2 object body.
//
// Hot path for image/asset delivery. Three guarantees the AC pins down:
//   1. ETag header == R2.httpEtag for the object (so CDN/browser revalidation
//      lines up with R2's strong validator).
//   2. Cache-Control: public, max-age=31536000, immutable — uploads are
//      content-addressed (storage_key is unique), so every key is safe to
//      cache for one year.
//   3. Content-Type matches whatever the upload pipeline stored in
//      httpMetadata.contentType (with a safe octet-stream fallback).
//
// Conditional GET: if If-None-Match matches the stored httpEtag, R2's
// `onlyIf.etagDoesNotMatch` returns an R2Object without a body, which we
// translate to a 304 Not Modified.

import { Hono } from "hono";
import type { Env } from "../env";

export const MEDIA_CACHE_CONTROL = "public, max-age=31536000, immutable";

const FALLBACK_CONTENT_TYPE = "application/octet-stream";

function stripQuotes(etag: string): string {
  return etag.replace(/^W\//, "").replace(/^"|"$/g, "");
}

function hasBody(
  obj: R2Object | R2ObjectBody | null,
): obj is R2ObjectBody {
  return obj !== null && "body" in obj && (obj as R2ObjectBody).body !== undefined;
}

const serve = new Hono<{ Bindings: Env }>();

// Route: GET /media/* — public asset delivery.
serve.get("/media/*", async (c) => {
  const key = c.req.path.replace(/^\/media\//, "");
  if (key === "") return c.json({ error: "Missing media key" }, 400);

  const ifNoneMatch = c.req.header("if-none-match");
  const obj = ifNoneMatch
    ? await c.env.MEDIA.get(key, {
        onlyIf: { etagDoesNotMatch: stripQuotes(ifNoneMatch) },
      })
    : await c.env.MEDIA.get(key);

  if (obj === null) return c.json({ error: "Not Found", path: c.req.path }, 404);

  const headers = new Headers();
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", MEDIA_CACHE_CONTROL);

  if (!hasBody(obj)) {
    // Conditional GET hit: precondition matched, body suppressed by R2.
    return new Response(null, { status: 304, headers });
  }

  headers.set(
    "Content-Type",
    obj.httpMetadata?.contentType ?? FALLBACK_CONTENT_TYPE,
  );
  if (typeof obj.size === "number") {
    headers.set("Content-Length", String(obj.size));
  }
  return new Response(obj.body, { status: 200, headers });
});

export default serve;
