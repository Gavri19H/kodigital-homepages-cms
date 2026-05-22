import { describe, it, expect } from "vitest";
import app from "../src/index";
import {
  adminCacheHeaders,
  offAdminHostHeaders,
  CACHE_CONTROL_VALUES,
} from "../src/cache/cache-control";
import type { Env } from "../src/env";

// T25 — admin routes + off-admin-host /admin both no-store. Two surfaces:
//   (A) Runtime gate in src/index.ts — off-ADMIN_HOST /admin* returns
//       404 + Cache-Control: no-store + X-Robots-Tag: noindex, nofollow.
//   (B) Helper module src/cache/cache-control.ts — adminCacheHeaders()
//       and offAdminHostHeaders() are the canonical no-store source.

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

describe("T25 off-admin-host /admin* returns no-store + X-Robots-Tag (runtime gate)", () => {
  it("GET /admin on a public host returns 404 with Cache-Control: no-store", async () => {
    const res = await app.request(
      "https://public.example.com/admin",
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

  it("GET /admin/users on a public host returns 404 with no-store + noindex,nofollow", async () => {
    const res = await app.request(
      "https://public.example.com/admin/users",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("GET /api/admin/auth/status on a public host returns 404 with hardening headers", async () => {
    const res = await app.request(
      "https://public.example.com/api/admin/auth/status",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("GET /api/admin/sites on a public host returns 404 with hardening headers", async () => {
    const res = await app.request(
      "https://public.example.com/api/admin/sites",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("POST /admin/media on a public host returns 404 with hardening headers (mutating verb blocked too)", async () => {
    const res = await app.request(
      "https://public.example.com/admin/media",
      { method: "POST", body: "ignored" },
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("uppercased public host still triggers the off-admin gate (case-insensitive host match)", async () => {
    const res = await app.request(
      "https://PUBLIC.EXAMPLE.COM/admin",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("public host /health is NOT subject to the admin gate (still 200)", async () => {
    const res = await app.request(
      "https://public.example.com/health",
      {},
      { ...adminEnv },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("ADMIN_HOST /admin does NOT short-circuit at the off-host gate (no off-host 404 / no leak)", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/admin",
      {},
      { ...adminEnv },
    );
    // 401 (accessAuth) or 200 (DEV_BYPASS): either way the off-host
    // gate did NOT fire, so the off-host headers are absent and the
    // request was allowed to reach the auth + admin layers.
    expect(res.status).not.toBe(404);
    expect(res.headers.get("Cache-Control")).not.toBe("no-store");
  });
});

describe("T25 adminCacheHeaders() helper contract (canonical admin response shape)", () => {
  it("emits Cache-Control: private, no-store", () => {
    const h = adminCacheHeaders();
    expect(h.get("Cache-Control")).toBe("private, no-store");
  });

  it("emits X-Robots-Tag: noindex, nofollow", () => {
    const h = adminCacheHeaders();
    expect(h.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("emits X-Content-Type-Options: nosniff", () => {
    const h = adminCacheHeaders();
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("does NOT set Content-Type (admin responses set their own MIME)", () => {
    const h = adminCacheHeaders();
    expect(h.get("Content-Type")).toBeNull();
  });

  it("admin Cache-Control value matches the public CACHE_CONTROL_VALUES.admin constant", () => {
    const h = adminCacheHeaders();
    expect(h.get("Cache-Control")).toBe(CACHE_CONTROL_VALUES.admin);
  });
});

describe("T25 offAdminHostHeaders() helper contract (off-admin-host variant)", () => {
  it("emits Cache-Control: private, no-store (same no-store discipline as adminCacheHeaders)", () => {
    const h = offAdminHostHeaders();
    expect(h.get("Cache-Control")).toBe("private, no-store");
  });

  it("emits X-Robots-Tag: noindex (no nofollow — no outbound links on a 404 stub)", () => {
    const h = offAdminHostHeaders();
    expect(h.get("X-Robots-Tag")).toBe("noindex");
  });

  it("emits X-Content-Type-Options: nosniff", () => {
    const h = offAdminHostHeaders();
    expect(h.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("off-admin Cache-Control value matches CACHE_CONTROL_VALUES.offAdmin", () => {
    const h = offAdminHostHeaders();
    expect(h.get("Cache-Control")).toBe(CACHE_CONTROL_VALUES.offAdmin);
  });
});

describe("T25 admin vs off-admin Cache-Control parity (both no-store, never max-age)", () => {
  it("CACHE_CONTROL_VALUES.admin contains the no-store directive", () => {
    expect(CACHE_CONTROL_VALUES.admin).toMatch(/no-store/);
    expect(CACHE_CONTROL_VALUES.admin).not.toMatch(/max-age/);
    expect(CACHE_CONTROL_VALUES.admin).not.toMatch(/stale-while-revalidate/);
  });

  it("CACHE_CONTROL_VALUES.offAdmin contains the no-store directive", () => {
    expect(CACHE_CONTROL_VALUES.offAdmin).toMatch(/no-store/);
    expect(CACHE_CONTROL_VALUES.offAdmin).not.toMatch(/max-age/);
    expect(CACHE_CONTROL_VALUES.offAdmin).not.toMatch(/stale-while-revalidate/);
  });

  it("admin and offAdmin both share the private,no-store wire literal (single SoT)", () => {
    expect(CACHE_CONTROL_VALUES.admin).toBe(CACHE_CONTROL_VALUES.offAdmin);
  });
});
