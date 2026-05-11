import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import {
  publicSiteContextMiddleware,
  type PublicSiteVariables,
} from "../src/public/middleware";
import type { Env } from "../src/env";

// T26 BEHAVIORAL: GIVEN hostname='unknown-site.example' with no row in
// sites/domains, WHEN GET / is requested, THEN response is a safe 404
// (no admin info leak — body MUST NOT contain 'cms.kodigital.app');
// WHEN hostname='cms.kodigital.app' is requested via the public router,
// THEN it returns 404 (admin host MUST NOT resolve as public).

const ADMIN_HOST = "cms.kodigital.app";

function makeEmptyDb(): D1Database {
  return {
    prepare(_sql: string) {
      const stmt = {
        bind: () => stmt,
        async first<T = unknown>(): Promise<T | null> {
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
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: {} as KVNamespace,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST,
    ADMIN_BASE_URL: `https://${ADMIN_HOST}`,
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  };
}

describe("public-middleware (T26)", () => {
  it("unmapped hostname returns safe 404 (no cms.kodigital.app leak)", async () => {
    const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
    app.route("/", publicRouter);

    const env = makeEnv(makeEmptyDb());

    const unmapped = await app.request(
      "https://unknown-site.example/",
      {},
      env,
    );
    expect(unmapped.status).toBe(404);
    const unmappedBody = await unmapped.text();
    expect(unmappedBody).not.toContain(ADMIN_HOST);
    expect(unmappedBody).not.toContain("cms.kodigital.app");

    const adminOnPublic = await app.request(
      `https://${ADMIN_HOST}/`,
      {},
      env,
    );
    expect(adminOnPublic.status).toBe(404);
    const adminBody = await adminOnPublic.text();
    expect(adminBody).not.toContain(ADMIN_HOST);
  });

  it("publicSiteContextMiddleware is exported as a Hono MiddlewareHandler-compatible function", () => {
    expect(typeof publicSiteContextMiddleware).toBe("function");
    expect(publicSiteContextMiddleware.length).toBe(2);
  });
});
