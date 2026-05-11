import { describe, it, expect } from "vitest";
import app from "../src/index";
import type { Env } from "../src/env";

// T28 / Phase 3: off-ADMIN_HOST /admin requests must 404 with the
// cache-and-robots hardening headers so intermediaries don't cache the
// 404 and crawlers don't index a stray admin URL leaked onto a public
// content domain.
//
// Behavioral AC (T28.AC2): GIVEN hostname='example.com' (not ADMIN_HOST),
// WHEN curl -i https://example.com/admin is requested, THEN status is
// 404, response headers include 'Cache-Control: no-store' AND
// 'X-Robots-Tag: noindex, nofollow', the response body does NOT contain
// the admin hostname, AND no Location redirect header is set.

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

describe("T28 off-ADMIN_HOST /admin 404 hardening headers", () => {
  it("off-ADMIN_HOST GET /admin returns 404 with Cache-Control: no-store and X-Robots-Tag: noindex, nofollow", async () => {
    const res = await app.request(
      "https://example.com/admin",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("Location")).toBeNull();
    const body = await res.text();
    expect(body).not.toContain("cms.kodigital.app");
  });

  it("off-ADMIN_HOST GET /admin/users returns 404 with hardening headers", async () => {
    const res = await app.request(
      "https://example.com/admin/users",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("Location")).toBeNull();
    const body = await res.text();
    expect(body).not.toContain("cms.kodigital.app");
  });

  it("off-ADMIN_HOST GET /api/admin/auth/status returns 404 with hardening headers", async () => {
    const res = await app.request(
      "https://example.com/api/admin/auth/status",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("Location")).toBeNull();
    const body = await res.text();
    expect(body).not.toContain("cms.kodigital.app");
  });

  it("crafted off-ADMIN_HOST /admin path embedding admin hostname does not echo cms.kodigital.app in body", async () => {
    const res = await app.request(
      "https://example.com/admin/cms.kodigital.app",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    const body = await res.text();
    expect(body).not.toContain("cms.kodigital.app");
  });

});
