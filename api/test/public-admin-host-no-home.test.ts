// Phase 5 / T16 regression: the admin host (cms.kodigital.app) MUST NEVER
// render the public Home page, even when a request reaches the public
// router directly (defense-in-depth on top of the top-level hostname gate
// in api/src/index.ts that already redirects /  on the admin host).
//
// T16.AC1 (regex `public-admin-host-no-home`):
//   The test file/describe identifier "public-admin-host-no-home" must
//   exist so the contract grep can locate this regression.
//
// T16.AC2 (regex `^public-admin-host-no-home.*no[_-]?home`, BEHAVIORAL):
//   GIVEN a request with Host=cms.kodigital.app to GET /, WHEN the public
//   router handles the request, THEN the response status is 404 AND the
//   body does NOT contain any §1..§13 home-section marker AND the body
//   does NOT echo the admin hostname "cms.kodigital.app" (anti
//   information-leak invariant — matches public-middleware T26.AC2).

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

function makeDb(): D1Database {
  const db = {
    prepare(_sql: string) {
      const stmt = {
        bind(..._args: unknown[]) {
          return stmt;
        },
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

describe("public-admin-host-no-home", () => {
  it("no-home — Host=cms.kodigital.app GET / returns 404 with no Home markup and no admin-host leak", async () => {
    const app = new Hono<{
      Bindings: Env;
      Variables: PublicSiteVariables;
    }>();
    app.route("/", publicRouter);

    const res = await app.request(
      "https://cms.kodigital.app/",
      {},
      makeEnv(makeDb()),
    );

    expect(res.status).toBe(404);

    const body = await res.text();

    // No §1..§13 home-section marker may appear (defense-in-depth: even
    // if the public router were ever wired to serve / on the admin host,
    // the middleware short-circuit MUST 404 before renderHome runs).
    for (let i = 1; i <= 13; i += 1) {
      expect(body).not.toContain(`home-section:${i} `);
    }

    // Anti information-leak invariant: the safe 404 body MUST NOT echo
    // the admin hostname so a crafted /admin lookalike cannot harvest
    // it via the public surface (matches T26.AC2 in public-middleware).
    expect(body).not.toContain("cms.kodigital.app");
  });

  it("no-home — Host=cms.kodigital.app HEAD / does not render Home either", async () => {
    const app = new Hono<{
      Bindings: Env;
      Variables: PublicSiteVariables;
    }>();
    app.route("/", publicRouter);

    const res = await app.request(
      "https://cms.kodigital.app/",
      { method: "HEAD" },
      makeEnv(makeDb()),
    );

    // The middleware returns 404 before renderHome regardless of method.
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain("home-section:1 ");
    expect(body).not.toContain("cms.kodigital.app");
  });
});
