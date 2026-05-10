import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import privacy, { hashIdentifier } from "../src/privacy";
import type { Env } from "../src/env";

interface OptOutRow {
  identifier_hash: string;
  opted_out: number;
}

function makeFakeDb() {
  const rows: OptOutRow[] = [];
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.startsWith("SELECT opted_out FROM privacy_opt_outs")) {
            const row = rows.find((r) => r.identifier_hash === bound[0]);
            return row ? ({ opted_out: row.opted_out } as unknown as T) : null;
          }
          return null;
        },
        async run() {
          if (sql.startsWith("INSERT INTO privacy_opt_outs")) {
            const id = bound[0] as string;
            const optedOut = sql.includes("VALUES (?, 1)") ? 1 : 0;
            const existing = rows.find((r) => r.identifier_hash === id);
            if (existing) existing.opted_out = optedOut;
            else rows.push({ identifier_hash: id, opted_out: optedOut });
          }
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, rows };
}

function buildEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_BASE_URL: "http://localhost:8787",
    CACHE_API_ENABLED: "false",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
  };
}

function mountApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/", privacy);
  return app;
}

describe("privacy module: SHA-256(IP+UA) hash + 3 unauthenticated routes", () => {
  it("hashIdentifier returns lowercase hex SHA-256 of `<ip>|<ua>`", async () => {
    const id = await hashIdentifier("1.2.3.4", "ua/1");
    const expectedBuf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode("1.2.3.4|ua/1"),
    );
    const expectedHex = Array.from(new Uint8Array(expectedBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    expect(id).toBe(expectedHex);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("POST /api/privacy/opt-out (BEHAVIORAL T7.AC2): 200 + Set-Cookie ccpa_opt_out=1 + DB row keyed by sha256('1.2.3.4|ua/1')", async () => {
    const { db, rows } = makeFakeDb();
    const res = await mountApp().request(
      "/api/privacy/opt-out",
      {
        method: "POST",
        headers: { "cf-connecting-ip": "1.2.3.4", "user-agent": "ua/1" },
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ccpa_opt_out=1");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");

    const expectedHash = await hashIdentifier("1.2.3.4", "ua/1");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identifier_hash).toBe(expectedHash);
    expect(rows[0]!.opted_out).toBe(1);
  });

  it("GET /api/privacy/status returns opted_out=true when ccpa_opt_out=1 cookie is set", async () => {
    const { db } = makeFakeDb();
    const res = await mountApp().request(
      "/api/privacy/status",
      {
        method: "GET",
        headers: {
          cookie: "ccpa_opt_out=1",
          "cf-connecting-ip": "9.9.9.9",
          "user-agent": "anything",
        },
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { opted_out: boolean; source: string };
    expect(body.opted_out).toBe(true);
    expect(body.source).toBe("cookie");
  });

  it("GET /api/privacy/status falls back to DB when no cookie is present", async () => {
    const { db, rows } = makeFakeDb();
    const id = await hashIdentifier("5.6.7.8", "ua/2");
    rows.push({ identifier_hash: id, opted_out: 1 });

    const res = await mountApp().request(
      "/api/privacy/status",
      {
        method: "GET",
        headers: { "cf-connecting-ip": "5.6.7.8", "user-agent": "ua/2" },
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { opted_out: boolean; source: string };
    expect(body.opted_out).toBe(true);
    expect(body.source).toBe("db");
  });

  it("GET /api/privacy/status returns opted_out=false when no cookie + no row", async () => {
    const { db } = makeFakeDb();
    const res = await mountApp().request(
      "/api/privacy/status",
      {
        method: "GET",
        headers: { "cf-connecting-ip": "1.1.1.1", "user-agent": "ua/x" },
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { opted_out: boolean; source: string };
    expect(body.opted_out).toBe(false);
    expect(body.source).toBe("db");
  });

  it("POST /api/privacy/opt-in expires the cookie and writes opted_out=0 row", async () => {
    const { db, rows } = makeFakeDb();
    const res = await mountApp().request(
      "/api/privacy/opt-in",
      {
        method: "POST",
        headers: { "cf-connecting-ip": "3.4.5.6", "user-agent": "ua/3" },
      },
      buildEnv(db),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("ccpa_opt_out=;");
    expect(setCookie).toContain("Max-Age=0");

    const expectedHash = await hashIdentifier("3.4.5.6", "ua/3");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.identifier_hash).toBe(expectedHash);
    expect(rows[0]!.opted_out).toBe(0);
  });

  it("opt-out then opt-in toggles a single row (UNIQUE on identifier_hash)", async () => {
    const { db, rows } = makeFakeDb();
    const headers = { "cf-connecting-ip": "7.7.7.7", "user-agent": "ua/toggle" };
    const app = mountApp();
    const env = buildEnv(db);

    const out = await app.request("/api/privacy/opt-out", { method: "POST", headers }, env);
    expect(out.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.opted_out).toBe(1);

    const back = await app.request("/api/privacy/opt-in", { method: "POST", headers }, env);
    expect(back.status).toBe(200);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.opted_out).toBe(0);
  });
});
