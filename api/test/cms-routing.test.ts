import { describe, it, expect } from "vitest";
import app from "../src/index";
import type { Env } from "../src/env";

const adminEnv: Env = {
  DB: {} as D1Database,
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

describe("cms.kodigital.app hostname routing (T3)", () => {
  it("ADMIN_HOST root path returns 302 redirect to ADMIN_BASE_PATH", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/admin");
  });

  it("non-ADMIN_HOST /admin returns 404 (no admin host leak)", async () => {
    const res = await app.request(
      "https://www.kodigital.io/admin",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Not Found/i);
  });

  it("non-ADMIN_HOST /api/admin/auth/status returns 404", async () => {
    const res = await app.request(
      "https://www.kodigital.io/api/admin/auth/status",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
  });

  it("ADMIN_HOST /admin in DEV_BYPASS_AUTH mode is not 404 and not a redirect to cloudflareaccess.com", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/admin",
      {},
      { ...adminEnv, DEV_BYPASS_AUTH: "true" },
    );
    expect(res.status).not.toBe(404);
    expect(res.headers.get("location") ?? "").not.toContain(
      "cloudflareaccess.com",
    );
  });

  it("ADMIN_HOST unknown path (not /admin*, not /api/admin*, not /, not /health) returns 404", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/does-not-exist",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
  });

  it("ADMIN_HOST /health returns 200 (liveness probe served on any host)", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/health",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(200);
  });

  it("non-ADMIN_HOST /health still returns 200 (public liveness)", async () => {
    const res = await app.request(
      "https://www.kodigital.io/health",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(200);
  });

  it("non-ADMIN_HOST root falls through to 404 (no admin redirect)", async () => {
    const res = await app.request(
      "https://www.kodigital.io/",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
  });
});
