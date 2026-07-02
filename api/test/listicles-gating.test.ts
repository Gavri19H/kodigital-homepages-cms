// Listicles Phase 2 — §24 gating: /api/admin/listicles/* is ADMIN_HOST-only
// (flat 404 elsewhere, via the index.ts host wall) and Cloudflare-Access
// gated (accessAuth 401 without a valid JWT; DEV_BYPASS only outside
// production). Authorized responses carry `private, no-store`.

import { describe, expect, it } from "vitest";
import app from "../src/index";
import admin from "../src/admin/router";
import type { Env } from "../src/env";

// Minimal D1 stub — the gate rejections under test fire BEFORE any handler
// touches the DB; the one authorized request only needs empty result sets.
function makeStubDb(): D1Database {
  const db = {
    prepare(sql: string) {
      void sql;
      const stmt = {
        bind() {
          return stmt;
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
    async batch() {
      return [];
    },
  } as unknown as D1Database;
  return db;
}

function buildEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: makeStubDb(),
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
    ...overrides,
  };
}

describe("off-ADMIN_HOST — the listicles admin API is a flat 404 (§24)", () => {
  it("GET /api/admin/listicles/offers on a public host returns 404 + no-store", async () => {
    const res = await app.request(
      "https://public.example.com/api/admin/listicles/offers",
      {},
      buildEnv(),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("mutating verbs are blocked off-host too (POST /offers, PUT /versions/:id)", async () => {
    const post = await app.request(
      "https://public.example.com/api/admin/listicles/offers",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      buildEnv(),
    );
    expect(post.status).toBe(404);
    const put = await app.request(
      "https://public.example.com/api/admin/listicles/versions/1",
      { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" },
      buildEnv(),
    );
    expect(put.status).toBe(404);
  });
});

describe("Cloudflare Access gate — 401 without a valid JWT", () => {
  it("returns 401 on ADMIN_HOST with no auth material (no dev bypass)", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/api/admin/listicles/offers",
      {},
      buildEnv({ DEV_BYPASS_AUTH: "false" }),
    );
    expect(res.status).toBe(401);
  });

  it("DEV_BYPASS_AUTH is double-gated: APP_ENV=production still returns 401", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/api/admin/listicles/offers",
      {},
      buildEnv({ APP_ENV: "production", DEV_BYPASS_AUTH: "true" }),
    );
    expect(res.status).toBe(401);
  });

  it("an invalid cf-access-jwt-assertion is rejected", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/api/admin/listicles/offers",
      { headers: { "cf-access-jwt-assertion": "not-a-jwt" } },
      buildEnv({ DEV_BYPASS_AUTH: "false" }),
    );
    expect(res.status).toBe(401);
  });
});

describe("authorized path — mounted through src/admin/router.ts", () => {
  it("serves the offers list on ADMIN_HOST with the dev bypass (test env) and marks it private, no-store", async () => {
    const res = await app.request(
      "https://cms.kodigital.app/api/admin/listicles/offers",
      {},
      buildEnv({ DEV_BYPASS_AUTH: "true" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { offers: unknown[]; paging: { total: number } };
    expect(body.offers).toEqual([]);
    expect(body.paging.total).toBe(0);
    // §24: the listicles admin surface is never cacheable.
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("unknown listicles sub-paths 404 through the admin router (no accidental catch-all)", async () => {
    const res = await admin.request(
      "/api/admin/listicles/nonexistent",
      {},
      buildEnv({ DEV_BYPASS_AUTH: "true", ADMIN_HOST: "localhost" }),
    );
    expect(res.status).toBe(404);
  });
});
