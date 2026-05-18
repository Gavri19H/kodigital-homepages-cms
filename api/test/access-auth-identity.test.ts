import { describe, it, expect } from "vitest";
import app from "../src/index";
import type { Env } from "../src/env";

// Minimal D1 stub: every prepare(...) returns a chain emitting null /
// empty rows. Needed because admin UI route handlers (post-T2) call
// data.ts wrappers on c.env.DB; this file only asserts auth status
// codes, so a no-op stub is sufficient.
const noopD1 = {
  prepare() {
    const stmt = {
      bind() {
        return stmt;
      },
      async first<T = unknown>(): Promise<T | null> {
        return null;
      },
      async run() {
        return { success: true, meta: {} };
      },
      async all<T = unknown>() {
        return { results: [] as T[], success: true, meta: {} };
      },
    };
    return stmt;
  },
} as unknown as D1Database;

const baseEnv: Env = {
  DB: noopD1,
  CACHE: {} as KVNamespace,
  MEDIA: {} as R2Bucket,
  APP_ENV: "test",
  ADMIN_HOST: "cms.kodigital.app",
  ADMIN_BASE_URL: "https://cms.kodigital.app",
  ADMIN_BASE_PATH: "/admin",
  CACHE_API_ENABLED: "false",
  HTML_CACHE_TTL_SECONDS: "60",
  OPENAI_TEXT_MODEL: "",
  OPENAI_IMAGE_MODEL: "",
  SITE_PROVISIONING_DRY_RUN: "true",
  SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
};

describe("accessAuth identity-mode (T4 — email path)", () => {
  it("returns 401 when no JWT and no bypass", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/admin",
      {},
      { ...baseEnv },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Unauthorized/i);
    expect(body.error).not.toMatch(/PRIVATE_KEY|SECRET|TOKEN/i);
  });

  it("returns 401 with malformed JWT in cf-access-jwt-assertion header", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/admin",
      { headers: { "cf-access-jwt-assertion": "not.a.valid.jwt" } },
      { ...baseEnv },
    );
    expect(res.status).toBe(401);
  });

  it("returns 401 with malformed JWT in CF_Authorization cookie", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/admin",
      { headers: { cookie: "CF_Authorization=not-a-jwt" } },
      { ...baseEnv },
    );
    expect(res.status).toBe(401);
  });

  it("DEV_BYPASS_AUTH double-gate: APP_ENV=production AND DEV_BYPASS_AUTH=true with no JWT still returns 401", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/admin",
      {},
      { ...baseEnv, APP_ENV: "production", DEV_BYPASS_AUTH: "true" },
    );
    expect(res.status).toBe(401);
  });

  it("DEV_BYPASS_AUTH=true with APP_ENV=local allows /admin (200)", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/admin",
      {},
      { ...baseEnv, APP_ENV: "local", DEV_BYPASS_AUTH: "true" },
    );
    expect(res.status).toBe(200);
  });

  it("/api/admin/auth/status with DEV_BYPASS_AUTH (non-prod) returns authenticated:true, mode:'dev-bypass'", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/api/admin/auth/status",
      {},
      { ...baseEnv, APP_ENV: "local", DEV_BYPASS_AUTH: "true" },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authenticated: boolean;
      mode: string;
      email?: string;
    };
    expect(body.authenticated).toBe(true);
    expect(body.mode).toBe("dev-bypass");
  });

  it("/api/admin/auth/status with no JWT and no bypass returns 401 authenticated:false", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/api/admin/auth/status",
      {},
      { ...baseEnv },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { authenticated?: boolean };
    expect(body.authenticated === false || body.authenticated === undefined).toBe(true);
  });
});
