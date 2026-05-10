import { describe, it, expect } from "vitest";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

interface PreparedCall {
  sql: string;
  bindings: unknown[];
}

function makeFakeDb(): { db: D1Database; calls: PreparedCall[] } {
  const calls: PreparedCall[] = [];
  const buildStmt = (sql: string, bindings: unknown[]) => ({
    bind(...args: unknown[]) {
      return buildStmt(sql, args);
    },
    async first<T = unknown>(): Promise<T | null> {
      calls.push({ sql, bindings });
      return null as T | null;
    },
    async run() {
      calls.push({ sql, bindings });
      return { success: true, meta: {} };
    },
    async all<T = unknown>() {
      calls.push({ sql, bindings });
      return { results: [] as T[], success: true, meta: {} };
    },
  });
  const db = {
    prepare(sql: string) {
      return buildStmt(sql, []);
    },
  } as unknown as D1Database;
  return { db, calls };
}

function buildEnv(overrides: Partial<Env> = {}): Env {
  const { db } = makeFakeDb();
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_BASE_URL: "http://localhost:8787",
    CACHE_API_ENABLED: "false",
    OPENAI_TEXT_MODEL: "gpt-test",
    OPENAI_IMAGE_MODEL: "img-test",
    ...overrides,
  };
}

function bypassEnv(overrides: Partial<Env> = {}): Env {
  return buildEnv({
    DEV_BYPASS_AUTH: "true",
    APP_ENV: "development",
    ...overrides,
  });
}

describe("admin router — auth gate (T10.AC4)", () => {
  it("GET /admin returns 401 without JWT and no bypass", async () => {
    const res = await admin.request("/admin", {}, buildEnv());
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/articles returns 401 without JWT and no bypass", async () => {
    const res = await admin.request("/api/admin/articles", {}, buildEnv());
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/articles returns 200 with empty list under DEV_BYPASS_AUTH", async () => {
    const res = await admin.request("/api/admin/articles", {}, bypassEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { articles: unknown[] };
    expect(body.articles).toEqual([]);
  });
});

describe("admin router — shell GETs (T10.AC1)", () => {
  const SHELL_PATHS = [
    "/admin",
    "/admin/articles",
    "/admin/pages",
    "/admin/categories",
    "/admin/tags",
    "/admin/media",
    "/admin/settings",
    "/admin/presets",
  ];
  for (const path of SHELL_PATHS) {
    it(`GET ${path} returns 200 HTML shell with bypass`, async () => {
      const res = await admin.request(path, {}, bypassEnv());
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);
      const text = await res.text();
      expect(text).toContain("kodigital-admin-shell");
    });
  }
});

describe("admin router — auth-status (T10.AC3)", () => {
  it("GET /api/admin/auth/status returns 200 JSON with dev_bypass=true under bypass", async () => {
    const res = await admin.request("/api/admin/auth/status", {}, bypassEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authenticated: boolean;
      dev_bypass: boolean;
    };
    expect(body.authenticated).toBe(true);
    expect(body.dev_bypass).toBe(true);
  });

  it("GET /api/admin/auth/status route is gated by accessAuth (401 without bypass)", async () => {
    const res = await admin.request("/api/admin/auth/status", {}, buildEnv());
    expect(res.status).toBe(401);
  });
});

describe("admin router — AI endpoints (T10.AC2)", () => {
  it("POST /api/admin/ai/generate-text returns 501 when OPENAI_API_KEY unset", async () => {
    const res = await admin.request(
      "/api/admin/ai/generate-text",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      },
      bypassEnv(),
    );
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/OPENAI_API_KEY/);
  });

  it("POST /api/admin/ai/generate-image returns 501 when OPENAI_API_KEY unset", async () => {
    const res = await admin.request(
      "/api/admin/ai/generate-image",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      },
      bypassEnv(),
    );
    expect(res.status).toBe(501);
  });

  it("POST /api/admin/ai/generate-text returns 200 placeholder when OPENAI_API_KEY set", async () => {
    const res = await admin.request(
      "/api/admin/ai/generate-text",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hi" }),
      },
      bypassEnv({ OPENAI_API_KEY: "sk-test" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; placeholder: boolean };
    expect(body.ok).toBe(true);
    expect(body.placeholder).toBe(true);
  });
});

describe("admin router — workflow API", () => {
  it("POST /api/admin/articles/:id/publish requires auth", async () => {
    const res = await admin.request(
      "/api/admin/articles/1/publish",
      { method: "POST" },
      buildEnv(),
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/admin/articles/:id/publish returns 404 when article missing", async () => {
    const res = await admin.request(
      "/api/admin/articles/999/publish",
      { method: "POST" },
      bypassEnv(),
    );
    expect(res.status).toBe(404);
  });
});
