import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import media, { MEDIA_CACHE_CONTROL } from "../src/media";
import type { Env } from "../src/env";

interface R2Entry {
  body: Uint8Array;
  httpEtag: string;
  httpMetadata?: { contentType?: string };
}

function toStream(buf: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(buf); c.close(); },
  });
}

function toBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value && typeof (value as ArrayBuffer).byteLength === "number" && !("getReader" in (value as object))) {
    return new Uint8Array(value as ArrayBuffer);
  }
  return new Uint8Array(0);
}

function makeR2Mock(initial: Record<string, R2Entry> = {}) {
  const store = new Map<string, R2Entry>(Object.entries(initial));
  const bucket = {
    async get(key: string, opts?: { onlyIf?: { etagDoesNotMatch?: string } }): Promise<unknown> {
      const e = store.get(key);
      if (!e) return null;
      const meta = { httpEtag: e.httpEtag, size: e.body.byteLength, httpMetadata: e.httpMetadata ?? {} };
      if (opts?.onlyIf?.etagDoesNotMatch === e.httpEtag) return meta;
      return { ...meta, body: toStream(e.body) };
    },
    async put(key: string, value: unknown, opts?: { httpMetadata?: { contentType?: string } }) {
      const buf = toBytes(value);
      const httpEtag = `etag-${key}`;
      store.set(key, { body: buf, httpEtag, httpMetadata: opts?.httpMetadata });
      return { httpEtag, size: buf.byteLength, key };
    },
    async delete(key: string) { store.delete(key); },
  };
  return { store, bucket: bucket as unknown as R2Bucket };
}

interface MediaRow {
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  alt_text: string | null;
  folder: string | null;
}

function makeFakeDb() {
  const inserted: MediaRow[] = [];
  let nextId = 1;
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.startsWith("INSERT INTO media") && sql.includes("RETURNING id")) {
            inserted.push({
              filename: bound[0] as string, storage_key: bound[1] as string,
              mime_type: bound[2] as string, size_bytes: bound[3] as number,
              alt_text: (bound[4] as string | null) ?? null, folder: (bound[5] as string | null) ?? null,
            });
            return { id: nextId++ } as unknown as T;
          }
          return null;
        },
        async run() { return { success: true, meta: {} }; },
        async all<T = unknown>() { return { results: [] as T[], success: true, meta: {} }; },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, inserted };
}

function makeApp(initial: Record<string, R2Entry> = {}) {
  const r2 = makeR2Mock(initial);
  const { db, inserted } = makeFakeDb();
  const env: Env = {
    DB: db, CACHE: {} as KVNamespace, MEDIA: r2.bucket, APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "", OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  };
  const app = new Hono<{ Bindings: Env }>().route("/", media);
  return { r2, inserted, env, app };
}

describe("media module: serve sets ETag + 1y immutable Cache-Control + Content-Type from R2 metadata", () => {
  it("BEHAVIORAL T8.AC2: GET /media/foo.png → 200, ETag='abc123', Cache-Control: public, max-age=31536000, immutable, Content-Type matches R2 metadata", async () => {
    const { app, env } = makeApp({
      "foo.png": { body: new TextEncoder().encode("PNGDATA"), httpEtag: "abc123", httpMetadata: { contentType: "image/png" } },
    });
    const res = await app.request("/media/foo.png", { method: "GET" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe("abc123");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("cache-control")).toBe(MEDIA_CACHE_CONTROL);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(await res.text()).toBe("PNGDATA");
  });

  it("GET /media/missing.png → 404 when key not present in R2", async () => {
    const { app, env } = makeApp();
    const res = await app.request("/media/missing.png", { method: "GET" }, env);
    expect(res.status).toBe(404);
  });

  it("GET /media/<key> falls back to application/octet-stream when R2 metadata has no contentType", async () => {
    const { app, env } = makeApp({
      "blob.bin": { body: new Uint8Array(8), httpEtag: "def456" },
    });
    const res = await app.request("/media/blob.bin", { method: "GET" }, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe("def456");
  });

  it("GET /media/<key> with matching If-None-Match → 304 with ETag + Cache-Control headers, no body", async () => {
    const { app, env } = makeApp({
      "cached.png": { body: new TextEncoder().encode("X"), httpEtag: "v1", httpMetadata: { contentType: "image/png" } },
    });
    const res = await app.request("/media/cached.png", { method: "GET", headers: { "if-none-match": '"v1"' } }, env);
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe("v1");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe("");
  });

  it("POST /admin/media uploads file → R2 put + media row inserted via parameterized SQL", async () => {
    const { app, env, r2, inserted } = makeApp();
    const form = new FormData();
    form.append("file", new File([new TextEncoder().encode("hello")], "hello.txt", { type: "text/plain" }));
    form.append("alt", "Hello");
    form.append("folder", "uploads");
    const res = await app.request("/admin/media", { method: "POST", body: form }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: number; storage_key: string; filename: string; mime_type: string;
      size_bytes: number; alt_text: string | null; folder: string | null;
    };
    expect(body.id).toBe(1);
    expect(body.filename).toBe("hello.txt");
    expect(body.mime_type).toBe("text/plain");
    expect(body.size_bytes).toBe(5);
    expect(body.storage_key).toMatch(/\.txt$/);
    expect(body.alt_text).toBe("Hello");
    expect(body.folder).toBe("uploads");
    expect(r2.store.has(body.storage_key)).toBe(true);
    expect(r2.store.get(body.storage_key)!.httpMetadata?.contentType).toBe("text/plain");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.filename).toBe("hello.txt");
    expect(inserted[0]!.mime_type).toBe("text/plain");
    expect(inserted[0]!.alt_text).toBe("Hello");
  });

  it("POST /admin/media → 400 when no `file` field is provided", async () => {
    const { app, env, inserted } = makeApp();
    const form = new FormData();
    form.append("alt", "no file");
    const res = await app.request("/admin/media", { method: "POST", body: form }, env);
    expect(res.status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it("uploaded file is retrievable via GET /media/<storage_key> with matching Content-Type", async () => {
    const { app, env } = makeApp();
    const form = new FormData();
    form.append(
      "file",
      new File([new TextEncoder().encode("svg-data")], "logo.svg", { type: "image/svg+xml" }),
    );
    const upRes = await app.request("/admin/media", { method: "POST", body: form }, env);
    const { storage_key } = (await upRes.json()) as { storage_key: string };
    const getRes = await app.request(`/media/${storage_key}`, { method: "GET" }, env);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get("content-type")).toBe("image/svg+xml");
    expect(getRes.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await getRes.text()).toBe("svg-data");
  });
});
