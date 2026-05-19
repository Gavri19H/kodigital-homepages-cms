// Phase 5 / T14 BEHAVIORAL guards for the cacheable public-asset routes
// GET /assets/public.css + GET /assets/public.js.
//
// Test bindings (from implementation_digest):
//   T14.AC3 — `^public-router-assets.*public[_-]?css`
//   T14.AC4 — `^public-router-assets.*public[_-]?js`
//   T14.AC5 — `^public-router-assets.*reserved[_-]?path[_-]?safety`
//
// T14 adds two literal /assets/* routes to the public router, returning
// the publicCss / publicJs string modules with PART 6.5 caching headers
// (max-age=31536000, immutable). Both routes are registered BEFORE the
// /:slug catch-all so they always win, even if a future planted page
// row somehow shared the `assets` head segment — the catch-all also
// short-circuits reserved heads via isReservedPath, so reserved-path
// safety is preserved.

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

interface DomainSeed {
  hostname: string;
  site_id: string;
  vertical_slug: string;
}

function makeDb(domains: DomainSeed[]): D1Database {
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          captured = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.startsWith("SELECT s.id AS site_id")) {
            const host = String(captured[0] ?? "").toLowerCase();
            const d = domains.find((x) => x.hostname === host);
            if (d === undefined) return null;
            return {
              site_id: d.site_id,
              hostname: d.hostname,
              vertical_slug: d.vertical_slug,
              status: "active",
            } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return db;
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
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
}

const tenantDomain: DomainSeed = {
  hostname: "tenant-a.example",
  site_id: "site_A",
  vertical_slug: "home",
};

describe("public-router-assets", () => {
  it("public-css — GET /assets/public.css -> 200 text/css with --tw-brand + immutable cache", async () => {
    const db = makeDb([tenantDomain]);
    const app = new Hono<{
      Bindings: Env;
      Variables: PublicSiteVariables;
    }>();
    app.route("/", publicRouter);

    const res = await app.request(
      "https://tenant-a.example/assets/public.css",
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    expect((res.headers.get("content-type") ?? "").toLowerCase()).toContain(
      "text/css",
    );
    expect(res.headers.get("cache-control") ?? "").toContain(
      "max-age=31536000",
    );
    expect(res.headers.get("cache-control") ?? "").toContain("immutable");
    const body = await res.text();
    expect(body).toContain("--tw-brand");
  });

  it("public-js — GET /assets/public.js -> 200 application/javascript with reading-progress-bar + immutable cache", async () => {
    const db = makeDb([tenantDomain]);
    const app = new Hono<{
      Bindings: Env;
      Variables: PublicSiteVariables;
    }>();
    app.route("/", publicRouter);

    const res = await app.request(
      "https://tenant-a.example/assets/public.js",
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    expect((res.headers.get("content-type") ?? "").toLowerCase()).toContain(
      "application/javascript",
    );
    expect(res.headers.get("cache-control") ?? "").toContain(
      "max-age=31536000",
    );
    expect(res.headers.get("cache-control") ?? "").toContain("immutable");
    const body = await res.text();
    expect(body).toContain("reading-progress-bar");
  });

  it("reserved-path-safety — explicit /assets/* routes win over /:slug catch-all and bare /assets is 404", async () => {
    const db = makeDb([tenantDomain]);
    const app = new Hono<{
      Bindings: Env;
      Variables: PublicSiteVariables;
    }>();
    app.route("/", publicRouter);

    // Explicit CSS route still wins (not intercepted by /:slug, which is
    // single-segment, and not intercepted by any planted page).
    const css = await app.request(
      "https://tenant-a.example/assets/public.css",
      {},
      makeEnv(db),
    );
    expect(css.status).toBe(200);
    const cssBody = await css.text();
    expect(cssBody).toContain("--tw-brand");
    expect(cssBody.toLowerCase()).not.toContain("theiwise");

    // The catch-all /:slug refuses the reserved head "assets" even when
    // someone hits /assets directly with no asset suffix — defense in
    // depth: a planted page row named "assets" can never shadow the
    // dedicated asset routes.
    const bare = await app.request(
      "https://tenant-a.example/assets",
      {},
      makeEnv(db),
    );
    expect(bare.status).toBe(404);
    const bareBody = await bare.text();
    expect(bareBody.toLowerCase()).not.toContain("theiwise");
    expect(bareBody).not.toContain("cms.kodigital.app");
  });
});
