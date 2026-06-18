// T43 [BCL-081] — CCPA right-to-delete endpoint: DELETE /api/privacy/data.
//
// Backs RC-071 (T43-AC1). Every backing it() title embeds BOTH the
// `[api/test/privacy-delete.test.ts]` file literal (the expected_test_name_regex
// the D13 parse_test_output runner matches against passing test names) AND the
// L2_AUTO_DISAMBIGUATION:T43-AC1:RC-071 observation pattern, so the
// finalize/evaluator RC<->test binding is unambiguous.
//
// AC1: DELETE /api/privacy/data deletes the caller's privacy row(s) (keyed by
// sha256(`<ip>|<ua>`)) and returns a confirmation. The recording fake-D1 drives
// the REAL privacy router and asserts (1) a DELETE FROM privacy_opt_outs bound
// to the caller's identifier hash is issued, (2) the stored row is gone, (3) the
// response confirms deletion with the rows-removed count, and (4) the
// ccpa_opt_out cookie is expired. The opt-out -> delete -> status round-trip
// proves the row truly no longer exists on a subsequent read.

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import privacy, { hashIdentifier } from "../src/privacy";
import type { Env } from "../src/env";

interface OptOutRow {
  identifier_hash: string;
  opted_out: number;
}

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

function makeFakeDb() {
  const rows: OptOutRow[] = [];
  const calls: RecordedCall[] = [];
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          calls.push({ sql, binds: bound });
          if (sql.startsWith("SELECT opted_out FROM privacy_opt_outs")) {
            const row = rows.find((r) => r.identifier_hash === bound[0]);
            return row ? ({ opted_out: row.opted_out } as unknown as T) : null;
          }
          return null;
        },
        async run() {
          calls.push({ sql, binds: bound });
          if (sql.startsWith("INSERT INTO privacy_opt_outs")) {
            const id = bound[0] as string;
            const optedOut = sql.includes("VALUES (?, 1)") ? 1 : 0;
            const existing = rows.find((r) => r.identifier_hash === id);
            if (existing) existing.opted_out = optedOut;
            else rows.push({ identifier_hash: id, opted_out: optedOut });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE FROM privacy_opt_outs")) {
            const id = bound[0] as string;
            const before = rows.length;
            for (let i = rows.length - 1; i >= 0; i--) {
              if (rows[i]!.identifier_hash === id) rows.splice(i, 1);
            }
            return { success: true, meta: { changes: before - rows.length } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, rows, calls };
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
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  };
}

function mountApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", privacy);
  return app;
}

describe("T43-AC1 CCPA right-to-delete: DELETE /api/privacy/data", () => {
  it("[api/test/privacy-delete.test.ts] L2_AUTO_DISAMBIGUATION:T43-AC1:RC-071 deletes the caller's row(s) keyed by sha256('1.2.3.4|ua/1'), returns a confirmation, and expires the cookie", async () => {
    const { db, rows, calls } = makeFakeDb();
    const expectedHash = await hashIdentifier("1.2.3.4", "ua/1");
    // Seed a stored opt-out row for this exact caller.
    rows.push({ identifier_hash: expectedHash, opted_out: 1 });
    expect(rows).toHaveLength(1);

    const res = await mountApp().request(
      "/api/privacy/data",
      {
        method: "DELETE",
        headers: { "cf-connecting-ip": "1.2.3.4", "user-agent": "ua/1" },
      },
      buildEnv(db),
    );

    // (3) Response confirms deletion with the rows-removed count.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean; rows_deleted: number };
    expect(body.deleted).toBe(true);
    expect(body.rows_deleted).toBe(1);

    // (1) A DELETE FROM privacy_opt_outs bound to the caller's hash was issued.
    const del = calls.find((cl) => cl.sql.startsWith("DELETE FROM privacy_opt_outs"));
    expect(del, "DELETE FROM privacy_opt_outs not issued").toBeDefined();
    expect(del!.binds[0]).toBe(expectedHash);

    // (2) The stored row is gone.
    expect(rows).toHaveLength(0);

    // (4) The ccpa_opt_out cookie is expired.
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ccpa_opt_out=;");
    expect(setCookie).toContain("Max-Age=0");
  });

  it("[api/test/privacy-delete.test.ts] L2_AUTO_DISAMBIGUATION:T43-AC1:RC-071 opt-out -> delete -> status round-trip: the row truly no longer exists on a subsequent read", async () => {
    const { db, rows } = makeFakeDb();
    const headers = { "cf-connecting-ip": "8.8.8.8", "user-agent": "ua/del" };
    const app = mountApp();
    const env = buildEnv(db);

    // Opt out first: a row exists.
    const out = await app.request("/api/privacy/opt-out", { method: "POST", headers }, env);
    expect(out.status).toBe(200);
    expect(rows).toHaveLength(1);

    // Right-to-delete removes it.
    const del = await app.request("/api/privacy/data", { method: "DELETE", headers }, env);
    expect(del.status).toBe(200);
    const delBody = (await del.json()) as { deleted: boolean; rows_deleted: number };
    expect(delBody.deleted).toBe(true);
    expect(delBody.rows_deleted).toBe(1);
    expect(rows).toHaveLength(0);

    // A subsequent DB-backed status read (no cookie) sees no stored opt-out.
    const status = await app.request(
      "/api/privacy/status",
      { method: "GET", headers },
      env,
    );
    expect(status.status).toBe(200);
    const statusBody = (await status.json()) as { opted_out: boolean; source: string };
    expect(statusBody.opted_out).toBe(false);
    expect(statusBody.source).toBe("db");
  });

  it("[api/test/privacy-delete.test.ts] L2_AUTO_DISAMBIGUATION:T43-AC1:RC-071 honors the request with rows_deleted=0 for a caller who never opted out (idempotent, still confirmed)", async () => {
    const { db, rows } = makeFakeDb();
    expect(rows).toHaveLength(0);

    const res = await mountApp().request(
      "/api/privacy/data",
      {
        method: "DELETE",
        headers: { "cf-connecting-ip": "9.9.9.9", "user-agent": "ua/none" },
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean; rows_deleted: number };
    expect(body.deleted).toBe(true);
    expect(body.rows_deleted).toBe(0);
  });
});
