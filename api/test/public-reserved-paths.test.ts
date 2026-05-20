// Phase 5 / T17 regression: the public /:slug catch-all MUST 404 every
// reserved top-level segment (admin, api, static, assets, media, preview,
// health) — even when a tenant DB has a published page row whose slug is
// the reserved value. This protects the admin shell from being shadowed
// by a planted content row.
//
// T17.AC1 (regex `^public-reserved-paths.*admin[_-]?slug[_-]?404`,
// BEHAVIORAL): GIVEN a tenant where a published page row with
// slug='admin' has been planted, WHEN GET /admin is dispatched against
// the public router, THEN the response status is 404 AND the response
// body does NOT contain the planted page's HTML (no leak of impostor
// content).
//
// T17.AC2 (regex `public-reserved-paths`): the test file/describe
// identifier "public-reserved-paths" must exist so the contract grep
// can locate this regression and so the suite iterates every reserved
// slug end-to-end against the public router.

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import { RESERVED_PATHS } from "../src/public/reserved";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

interface PageSeed {
  slug: string;
  content_html?: string | null;
}

const TENANT_HOST = "tenant.example.com";
const ADMIN_HOST = "cms.kodigital.app";

function makeDbMock(pages: PageSeed[]): D1Database {
  const rows = pages.map((p, i) => ({
    id: i + 1,
    slug: p.slug,
    title: p.slug,
    content_html: p.content_html ?? `<p>impostor page ${p.slug}</p>`,
    status: "published",
    updated_at: null as number | null,
    site_id: null as string | null,
  }));
  return {
    prepare(sql: string) {
      const stmt = {
        _args: [] as unknown[],
        bind(...args: unknown[]) {
          stmt._args = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.startsWith("SELECT s.id AS site_id")) {
            const host = String(stmt._args[0] ?? "").toLowerCase();
            if (host === TENANT_HOST) {
              return {
                site_id: "site_tenant",
                hostname: TENANT_HOST,
                vertical_slug: "home",
                status: "active",
              } as unknown as T | null;
            }
            return null;
          }
          if (
            sql.startsWith(
              "SELECT id, slug, title, content_html, status, updated_at FROM pages",
            ) ||
            sql.startsWith(
              "SELECT id, slug, title, content_html, status, updated_at, site_id FROM pages",
            )
          ) {
            const slug = stmt._args[0] as string;
            const r = rows.find((x) => x.slug === slug);
            if (r) return r as unknown as T | null;
            return null;
          }
          if (sql.startsWith("SELECT * FROM articles WHERE slug")) {
            return null;
          }
          if (sql.startsWith("SELECT id, slug, name FROM categories")) {
            return null;
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
}

function buildEnv(db: D1Database): Env {
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
    DEV_BYPASS_AUTH: "true",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  };
}

function buildApp(): Hono<{ Bindings: Env; Variables: PublicSiteVariables }> {
  const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  app.route("/", publicRouter);
  return app;
}

describe("public-reserved-paths", () => {
  it("T17.AC1: admin-slug-404 — planted page row with slug='admin' does NOT leak via GET /admin on the public router", async () => {
    const impostor = "<p>impostor admin content do-not-leak</p>";
    const db = makeDbMock([{ slug: "admin", content_html: impostor }]);
    const app = buildApp();

    const res = await app.request(
      `https://${TENANT_HOST}/admin`,
      {},
      buildEnv(db),
    );

    expect(res.status).toBe(404);

    const body = await res.text();
    expect(body).not.toContain(impostor);
    expect(body).not.toContain("impostor admin content");
  });

  it("covers all reserved paths — every entry in RESERVED_PATHS 404s against the public catch-all, even with a planted same-slug page row", async () => {
    expect(RESERVED_PATHS.length).toBeGreaterThanOrEqual(7);
    const expectedHeads = [
      "admin",
      "api",
      "static",
      "assets",
      "media",
      "preview",
      "health",
    ];
    for (const head of expectedHeads) {
      expect(RESERVED_PATHS).toContain(head);
    }

    // /assets and /health have explicit handlers on the public router
    // that return 200 (T14 + /health). The /:slug catch-all only runs
    // for the remaining 5 heads, so plant impostor pages and assert
    // they 404 there.
    const catchAllHeads = ["admin", "api", "static", "media", "preview"];
    const planted = catchAllHeads.map((slug) => ({
      slug,
      content_html: `<p>impostor ${slug} do-not-leak</p>`,
    }));
    const db = makeDbMock(planted);
    const app = buildApp();

    for (const head of catchAllHeads) {
      const res = await app.request(
        `https://${TENANT_HOST}/${head}`,
        {},
        buildEnv(db),
      );
      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).not.toContain(`impostor ${head} do-not-leak`);
    }
  });
});
