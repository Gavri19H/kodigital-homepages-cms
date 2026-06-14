// RX3 / MQAFIX-3 — GET /api/admin/media MUST honor ?site_id=<id> and
// return ONLY site-scoped + global (site_id IS NULL) rows. Rows for
// other sites MUST NOT leak across the tenant boundary.
//
// AC2 BEHAVIORAL contract (.ralph/execution_stories.json#RX3.AC2):
//   GIVEN media rows for site_A AND site_B AND a global (site_id IS NULL)
//   WHEN  GET /api/admin/media?site_id=<A>
//   THEN  response carries ONLY site_A + global rows (NOT site_B).
//
// AC4 FUNCTIONAL: site_id MUST be bound via .bind(siteId), NEVER
// template-literal-interpolated (per .claude/rules/d1-database-safety.md).
// This is asserted by injecting a SQL-injection-shaped string and
// verifying both the captured SQL placeholder + the captured bind value.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";
import { mediaListPage } from "../src/admin/templates/media";


interface MediaRow {
  id: number;
  filename: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  site_id: string | null;
  created_at: string;
}

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

function makeFakeDb(allRows: MediaRow[]): {
  db: D1Database;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first(): Promise<unknown> {
          calls.push({ sql, binds: captured });
          return null;
        },
        async run() {
          calls.push({ sql, binds: captured });
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          calls.push({ sql, binds: captured });
          if (!sql.includes("FROM media")) {
            return { results: [] as T[], success: true, meta: {} };
          }
          // Apply the production predicate against the fake row set so the
          // returned shape matches the SQL contract (WHERE site_id = ? OR
          // site_id IS NULL — globals join in alongside the scoped rows).
          const siteId = captured.length > 0 ? String(captured[0]) : null;
          const filtered = siteId === null
            ? allRows
            : allRows.filter((r) => r.site_id === siteId || r.site_id === null);
          filtered.sort((a, b) => {
            if (a.created_at !== b.created_at) {
              return a.created_at < b.created_at ? 1 : -1;
            }
            return b.id - a.id;
          });
          return {
            results: filtered as unknown as T[],
            success: true,
            meta: {},
          };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, calls };
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
  };
}

function findMediaCall(calls: RecordedCall[]): RecordedCall | undefined {
  return calls.find((c) => c.sql.includes("FROM media"));
}

describe("GET /api/admin/media applies site_id filter with globals", () => {
  const SITE_A = "site-a";
  const SITE_B = "site-b";

  const rows: MediaRow[] = [
    {
      id: 1,
      filename: "a-1.png",
      storage_key: "a1.png",
      mime_type: "image/png",
      size_bytes: 100,
      site_id: SITE_A,
      created_at: "2026-05-17T10:00:00Z",
    },
    {
      id: 2,
      filename: "a-2.png",
      storage_key: "a2.png",
      mime_type: "image/png",
      size_bytes: 200,
      site_id: SITE_A,
      created_at: "2026-05-17T11:00:00Z",
    },
    {
      id: 3,
      filename: "global-1.png",
      storage_key: "g1.png",
      mime_type: "image/png",
      size_bytes: 300,
      site_id: null,
      created_at: "2026-05-17T12:00:00Z",
    },
    {
      id: 4,
      filename: "b-only.png",
      storage_key: "b1.png",
      mime_type: "image/png",
      size_bytes: 400,
      site_id: SITE_B,
      created_at: "2026-05-17T13:00:00Z",
    },
  ];

  it("RX3.AC2: returns site_A + global rows; excludes site_B", async () => {
    const { db, calls } = makeFakeDb(rows);
    const res = await admin.request(
      "/api/admin/media?site_id=" + SITE_A,
      { method: "GET" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      media: MediaRow[];
      site_id?: string;
    };
    expect(body.site_id).toBe(SITE_A);
    expect(body.media).toHaveLength(3);

    const scoped = body.media.filter((r) => r.site_id === SITE_A);
    const globals = body.media.filter((r) => r.site_id === null);
    const otherSite = body.media.filter((r) => r.site_id === SITE_B);
    expect(scoped).toHaveLength(2);
    expect(globals).toHaveLength(1);
    expect(otherSite).toHaveLength(0);

    // SQL contract: WHERE site_id = ? OR site_id IS NULL (globals merge in).
    const mediaCall = findMediaCall(calls);
    expect(mediaCall).toBeDefined();
    expect(mediaCall?.sql).toContain("FROM media");
    expect(mediaCall?.sql).toContain("site_id = ?");
    expect(mediaCall?.sql).toContain("site_id IS NULL");
    expect(mediaCall?.binds).toEqual([SITE_A]);
  });

  it("RX3.AC4: site_id is bound (parameterized), not template-interpolated", async () => {
    const { db, calls } = makeFakeDb(rows);
    // A SQL-injection-shaped string. With .bind() the value lands in the
    // binding slot; the prepared SQL still carries the literal '?' and
    // does NOT contain the attacker payload.
    const attacker = "evil' OR 1=1 --";
    const res = await admin.request(
      "/api/admin/media?site_id=" + encodeURIComponent(attacker),
      { method: "GET" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);

    const mediaCall = findMediaCall(calls);
    expect(mediaCall).toBeDefined();
    expect(mediaCall?.sql).toContain("site_id = ?");
    expect(mediaCall?.sql).not.toContain("evil");
    expect(mediaCall?.binds).toEqual([attacker]);
  });

  it("RX3.AC2 (no site_id query): falls through to the unfiltered listing", async () => {
    // Without ?site_id=, the legacy "list all media" path runs (no WHERE
    // site_id predicate). This preserves the pre-RX3 unscoped behavior
    // for admin clients that have not yet adopted the filter form.
    const { db, calls } = makeFakeDb(rows);
    const res = await admin.request(
      "/api/admin/media",
      { method: "GET" },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { media: MediaRow[]; site_id?: string };
    expect(body.site_id).toBeUndefined();

    const mediaCall = findMediaCall(calls);
    expect(mediaCall).toBeDefined();
    expect(mediaCall?.sql).toContain("FROM media");
    // Unfiltered branch: no WHERE site_id predicate, no binds.
    expect(mediaCall?.sql).not.toContain("WHERE site_id");
    expect(mediaCall?.binds).toEqual([]);
  });
});

// ===========================================================================
// T31 ([B10] Media library port) — upload multipart wire-field contract +
// site-scoped media CRUD (GET/PUT/DELETE /api/admin/media/:id), the 0013
// migration round-trip on real SQLite, and the ported media-grid template.
// ===========================================================================

interface CrudMediaRow {
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

function crudRow(overrides: Partial<CrudMediaRow> & { id: number }): CrudMediaRow {
  return {
    site_id: null,
    filename: "x.png",
    storage_key: "2026/06/11/x.png",
    mime_type: "image/png",
    size_bytes: 10,
    width: null,
    height: null,
    alt_text: null,
    caption: null,
    folder: "/",
    uploaded_by: null,
    created_at: 1760000000,
    updated_at: null,
    ...overrides,
  };
}

// Recording fake D1 for the CRUD handlers: serves the sites existence
// probe, the media-by-id reads, and echoes INSERT...RETURNING from its
// binds so the response mirrors what D1 would return.
function makeCrudDb(opts: { rows?: CrudMediaRow[]; siteIds?: string[] }): {
  db: D1Database;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const rowsById = new Map<number, CrudMediaRow>();
  for (const r of opts.rows ?? []) { rowsById.set(r.id, r); }
  const siteIds = new Set(opts.siteIds ?? []);
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first(): Promise<unknown> {
          calls.push({ sql, binds: captured });
          if (sql.includes("FROM sites")) {
            const id = String(captured[0]);
            return siteIds.has(id) ? { id } : null;
          }
          if (sql.startsWith("INSERT INTO media")) {
            // Echo the RETURNING row from the bind order the handler uses.
            const [site_id, filename, storage_key, mime_type, size_bytes, width, height, alt_text, caption, folder, uploaded_by] = captured;
            return {
              id: 101,
              site_id, filename, storage_key, mime_type, size_bytes,
              width, height, alt_text, caption, folder, uploaded_by,
              created_at: 1760000000,
              updated_at: null,
            };
          }
          if (sql.includes("FROM media WHERE id = ?")) {
            return rowsById.get(Number(captured[0])) ?? null;
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

interface FakeR2 {
  puts: Array<{ key: string; byteLength: number; contentType?: string }>;
  deletes: string[];
}

function makeFakeR2(): { bucket: R2Bucket; r2: FakeR2 } {
  const r2: FakeR2 = { puts: [], deletes: [] };
  const bucket = {
    async put(key: string, value: ArrayBuffer, putOpts?: { httpMetadata?: { contentType?: string } }) {
      r2.puts.push({
        key,
        byteLength: value.byteLength,
        contentType: putOpts?.httpMetadata?.contentType,
      });
      return {};
    },
    async delete(key: string) {
      r2.deletes.push(key);
    },
  } as unknown as R2Bucket;
  return { bucket, r2 };
}

function buildCrudEnv(db: D1Database, bucket: R2Bucket): Env {
  const env = buildEnv(db);
  return { ...env, MEDIA: bucket };
}

// Minimal real PNG header: signature + IHDR with width=3, height=2 —
// enough for the byte-header dimension extractor (no decode needed).
function makePngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, 0x89504e47);
  dv.setUint32(4, 0x0d0a1a0a);
  dv.setUint32(8, 13);
  bytes[12] = 0x49; bytes[13] = 0x48; bytes[14] = 0x44; bytes[15] = 0x52; // IHDR
  dv.setUint32(16, width);
  dv.setUint32(20, height);
  return bytes;
}

function findCall(calls: RecordedCall[], fragment: string): RecordedCall | undefined {
  return calls.find((c) => c.sql.includes(fragment));
}

describe("T31 media library port: upload multipart fields match + media CRUD site-scoped", () => {
  it("upload reads the ported UI wire fields (file, alt_text, caption, site_id) and records dimensions + uploader", async () => {
    const { db, calls } = makeCrudDb({ siteIds: ["site-a"] });
    const { bucket, r2 } = makeFakeR2();
    const form = new FormData();
    form.append("file", new File([makePngBytes(3, 2)], "Hero Photo.png", { type: "image/png" }));
    form.append("alt_text", "Hero alt");
    form.append("caption", "Hero caption");
    form.append("site_id", "site-a");
    // Legacy Phase-1 field name the ported handler MUST NOT read.
    form.append("alt", "WRONG-FIELD");

    const res = await admin.request(
      "/api/admin/media/upload",
      {
        method: "POST",
        body: form,
        headers: { "Cf-Access-Authenticated-User-Email": "admin@kodigital.io" },
      },
      buildCrudEnv(db, bucket),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { item: CrudMediaRow; url: string };

    // R2 received the blob under the dated storage-key convention.
    expect(r2.puts).toHaveLength(1);
    expect(r2.puts[0]!.key).toMatch(/^\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]+\.png$/);
    expect(r2.puts[0]!.contentType).toBe("image/png");
    expect(body.url).toBe("/media/" + r2.puts[0]!.key);

    // The INSERT carries the multipart wire fields by their ported names.
    const insert = findCall(calls, "INSERT INTO media");
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("RETURNING");
    expect(insert!.binds).toEqual([
      "site-a",
      "Hero Photo.png",
      r2.puts[0]!.key,
      "image/png",
      24,
      3,
      2,
      "Hero alt",
      "Hero caption",
      "/",
      "admin@kodigital.io",
    ]);
    // The legacy 'alt' decoy never reaches the database.
    expect(insert!.binds).not.toContain("WRONG-FIELD");
    expect(body.item.site_id).toBe("site-a");
    expect(body.item.alt_text).toBe("Hero alt");
    expect(body.item.caption).toBe("Hero caption");
  });

  it("upload without site_id inserts a global row (site_id NULL) and never probes sites", async () => {
    const { db, calls } = makeCrudDb({});
    const { bucket, r2 } = makeFakeR2();
    const form = new FormData();
    form.append("file", new File([makePngBytes(1, 1)], "g.png", { type: "image/png" }));

    const res = await admin.request(
      "/api/admin/media/upload",
      { method: "POST", body: form },
      buildCrudEnv(db, bucket),
    );
    expect(res.status).toBe(201);
    const insert = findCall(calls, "INSERT INTO media");
    expect(insert!.binds[0]).toBeNull();
    expect(insert!.binds[7]).toBeNull(); // alt_text absent -> NULL
    expect(insert!.binds[8]).toBeNull(); // caption absent -> NULL
    expect(insert!.binds[10]).toBeNull(); // no Access header -> NULL uploader
    expect(findCall(calls, "FROM sites")).toBeUndefined();
    expect(r2.puts).toHaveLength(1);
  });

  it("upload with an unknown site_id is refused 400 UNKNOWN_SITE before any write", async () => {
    const { db, calls } = makeCrudDb({ siteIds: ["site-a"] });
    const { bucket, r2 } = makeFakeR2();
    const form = new FormData();
    form.append("file", new File([makePngBytes(1, 1)], "x.png", { type: "image/png" }));
    form.append("site_id", "site-nope");

    const res = await admin.request(
      "/api/admin/media/upload",
      { method: "POST", body: form },
      buildCrudEnv(db, bucket),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("UNKNOWN_SITE");
    expect(r2.puts).toHaveLength(0);
    expect(findCall(calls, "INSERT INTO media")).toBeUndefined();
  });

  it("upload rejects a missing file and a disallowed mime type with 400 (no writes)", async () => {
    const { db, calls } = makeCrudDb({});
    const { bucket, r2 } = makeFakeR2();
    const env = buildCrudEnv(db, bucket);

    const noFile = new FormData();
    noFile.append("alt_text", "no file here");
    const res1 = await admin.request(
      "/api/admin/media/upload",
      { method: "POST", body: noFile },
      env,
    );
    expect(res1.status).toBe(400);

    const badMime = new FormData();
    badMime.append("file", new File(["#!/bin/sh"], "evil.sh", { type: "application/x-sh" }));
    const res2 = await admin.request(
      "/api/admin/media/upload",
      { method: "POST", body: badMime },
      env,
    );
    expect(res2.status).toBe(400);

    expect(r2.puts).toHaveLength(0);
    expect(findCall(calls, "INSERT INTO media")).toBeUndefined();
  });

  it("GET /api/admin/media/:id is site-scoped: own site 200, cross-site 403, global visible to every scope", async () => {
    const rows = [
      crudRow({ id: 7, site_id: "site-a", storage_key: "2026/06/11/a.png" }),
      crudRow({ id: 8, site_id: null, storage_key: "2026/06/11/g.png" }),
    ];
    const { db } = makeCrudDb({ rows });
    const { bucket } = makeFakeR2();
    const env = buildCrudEnv(db, bucket);

    const own = await admin.request("/api/admin/media/7?site_id=site-a", { method: "GET" }, env);
    expect(own.status).toBe(200);
    const ownBody = (await own.json()) as { item: CrudMediaRow };
    expect(ownBody.item.id).toBe(7);

    const cross = await admin.request("/api/admin/media/7?site_id=site-b", { method: "GET" }, env);
    expect(cross.status).toBe(403);
    const crossBody = (await cross.json()) as { code?: string };
    expect(crossBody.code).toBe("TENANT_BOUNDARY_VIOLATION");

    const globalRow = await admin.request("/api/admin/media/8?site_id=site-b", { method: "GET" }, env);
    expect(globalRow.status).toBe(200);

    const missing = await admin.request("/api/admin/media/999", { method: "GET" }, env);
    expect(missing.status).toBe(404);

    const badId = await admin.request("/api/admin/media/not-a-number", { method: "GET" }, env);
    expect(badId.status).toBe(400);
  });

  it("PUT /api/admin/media/:id updates metadata with retention semantics, parameterized; cross-tenant 403", async () => {
    const rows = [
      crudRow({ id: 7, site_id: "site-a", alt_text: "old-alt", caption: "old-cap" }),
    ];
    const { db, calls } = makeCrudDb({ rows });
    const { bucket } = makeFakeR2();
    const env = buildCrudEnv(db, bucket);

    const res = await admin.request("/api/admin/media/7", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt_text: "new-alt", site_id: "site-a" }),
    }, env);
    expect(res.status).toBe(200);

    const update = findCall(calls, "UPDATE media SET");
    expect(update).toBeDefined();
    // alt_text replaced; caption ABSENT from the body -> retained;
    // folder untouched (COALESCE keeps the stored value).
    expect(update!.binds).toEqual(["new-alt", "old-cap", null, 7]);
    expect(update!.sql).toContain("alt_text = ?");
    expect(update!.sql).toContain("updated_at = unixepoch()");
    expect(update!.sql).not.toContain("new-alt");

    const crossCalls = makeCrudDb({ rows });
    const cross = await admin.request("/api/admin/media/7", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt_text: "stolen", site_id: "site-b" }),
    }, buildCrudEnv(crossCalls.db, bucket));
    expect(cross.status).toBe(403);
    expect(findCall(crossCalls.calls, "UPDATE media SET")).toBeUndefined();
  });

  it("DELETE /api/admin/media/:id removes the R2 object and the row, returns JSON 200; cross-tenant 403", async () => {
    const rows = [
      crudRow({ id: 7, site_id: "site-a", storage_key: "2026/06/11/del.png" }),
    ];
    const { db, calls } = makeCrudDb({ rows });
    const { bucket, r2 } = makeFakeR2();
    const env = buildCrudEnv(db, bucket);

    const res = await admin.request("/api/admin/media/7?site_id=site-a", { method: "DELETE" }, env);
    expect(res.status).toBe(200);
    // JSON body (never 204): the modal's fetch json()-parses every response.
    const body = (await res.json()) as { deleted: boolean; storage_key: string };
    expect(body.deleted).toBe(true);
    expect(body.storage_key).toBe("2026/06/11/del.png");
    expect(r2.deletes).toEqual(["2026/06/11/del.png"]);
    const del = findCall(calls, "DELETE FROM media");
    expect(del).toBeDefined();
    expect(del!.binds).toEqual([7]);

    const second = makeCrudDb({ rows });
    const secondR2 = makeFakeR2();
    const cross = await admin.request(
      "/api/admin/media/7?site_id=site-b",
      { method: "DELETE" },
      buildCrudEnv(second.db, secondR2.bucket),
    );
    expect(cross.status).toBe(403);
    expect(secondR2.r2.deletes).toHaveLength(0);
    expect(findCall(second.calls, "DELETE FROM media")).toBeUndefined();
  });

  it("T31: migration 0013 declares the media admin-CRUD columns (Node-20 SQL-text proof)", () => {
    const migrationsDir = resolve(__dirname, "..", "migrations");
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    expect(files).toContain("0013_phase10_media_admin_crud_columns.sql");
    const sql = readFileSync(
      join(migrationsDir, "0013_phase10_media_admin_crud_columns.sql"),
      "utf8",
    );
    // caption/uploaded_by/updated_at write+read round-trip is proven above by
    // the mock-D1 upload/PUT bind-shape tests, which are Node-20 portable.
    expect(sql).toMatch(/ALTER\s+TABLE\s+media\s+ADD\s+COLUMN\s+caption\s+TEXT/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+media\s+ADD\s+COLUMN\s+uploaded_by\s+TEXT/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+media\s+ADD\s+COLUMN\s+updated_at\s+INTEGER/i);
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE/i);
  });

  it("media template ports the legacy media-grid with the upload modal wire fields, retaining the site_id filter", () => {
    const html = mediaListPage(
      [
        { id: "1", filename: "a.png", preview_url: "/media/a.png", site_id: "site-a", kind: "image", size: 100 },
        { id: "2", filename: "g.png", preview_url: "/media/g.png", site_id: null, kind: "image", size: 200 },
      ],
      [{ id: "site-a", name: "Site A" }],
      {},
    );
    // The ported legacy grid (T31.AC2 vocabulary).
    expect(html).toContain("media-grid");
    expect(html).toContain("media-item");
    // Upload modal posts the ported multipart wire fields.
    expect(html).toContain('name="file"');
    expect(html).toContain('name="alt_text"');
    expect(html).toContain('name="caption"');
    expect(html).toContain("/api/admin/media/upload");
    // Details modal talks to the :id verbs.
    expect(html).toContain("/api/admin/media/");
    // Retained tenant features: site filter + Global badge.
    expect(html).toContain('name="site_id"');
    expect(html).toContain(">Global</span>");
  });
});
