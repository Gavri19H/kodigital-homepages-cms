import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

// T27 BEHAVIORAL: GIVEN sites A and B each with one article slug='hello',
// WHEN GET /article/hello on hostname-A returns the homepage feed, THEN
// only A's article is listed; WHEN GET /article/hello on hostname-B is
// requested, THEN only B's article is rendered (and A's is not visible).
//
// The mock DB below records every (sql, binds) pair, then answers article
// SELECTs by filtering an in-memory rows array by slug + site_id. The test
// proves the public router scopes by `siteContext.siteId` (a) by examining
// the bound site_id in the query AND (b) by observing that B's hostname
// returns B's content not A's.

interface ArticleSeed {
  id: number;
  slug: string;
  site_id: string;
  content_html: string;
  status: string;
}

interface DomainSeed {
  hostname: string;
  site_id: string;
  vertical_slug: string;
}

function makeDb(domains: DomainSeed[], articles: ArticleSeed[]) {
  const calls: Array<{ sql: string; binds: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          captured = args;
          calls.push({ sql, binds: args });
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.startsWith("SELECT s.id AS site_id")) {
            const host = String(captured[0] ?? "").toLowerCase();
            const d = domains.find((x) => x.hostname === host);
            if (!d) return null;
            return {
              site_id: d.site_id,
              hostname: d.hostname,
              vertical_slug: d.vertical_slug,
              status: "active",
            } as unknown as T;
          }
          if (sql.startsWith("SELECT * FROM articles WHERE slug = ? AND site_id = ?")) {
            const slug = captured[0] as string;
            const siteId = captured[1] as string;
            const a = articles.find(
              (x) => x.slug === slug && x.site_id === siteId,
            );
            return (a ?? null) as unknown as T | null;
          }
          if (sql.startsWith("SELECT * FROM articles WHERE slug = ? LIMIT 1")) {
            // Unscoped query path — T27 forbids hitting this from public routes
            const slug = captured[0] as string;
            const a = articles.find((x) => x.slug === slug);
            return (a ?? null) as unknown as T | null;
          }
          if (sql.startsWith("SELECT id, slug, title, content_html, status, updated_at, site_id FROM pages")) {
            return null;
          }
          if (sql.startsWith("SELECT value FROM site_settings")) {
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
  return { db, calls };
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

describe("public-site-scoping (T27)", () => {
  it("public article query is site-scoped", async () => {
    const domains: DomainSeed[] = [
      { hostname: "site-a.example", site_id: "site_A", vertical_slug: "home" },
      { hostname: "site-b.example", site_id: "site_B", vertical_slug: "home" },
    ];
    const articles: ArticleSeed[] = [
      {
        id: 1,
        slug: "hello",
        site_id: "site_A",
        content_html: "<p>hello from A</p>",
        status: "published",
      },
      {
        id: 2,
        slug: "hello",
        site_id: "site_B",
        content_html: "<p>hello from B</p>",
        status: "published",
      },
    ];
    const { db, calls } = makeDb(domains, articles);
    const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
    app.route("/", publicRouter);

    const resA = await app.request(
      "https://site-a.example/article/hello",
      {},
      makeEnv(db),
    );
    expect(resA.status).toBe(200);
    const bodyA = await resA.text();
    expect(bodyA).toContain("hello from A");
    expect(bodyA).not.toContain("hello from B");

    const resB = await app.request(
      "https://site-b.example/article/hello",
      {},
      makeEnv(db),
    );
    expect(resB.status).toBe(200);
    const bodyB = await resB.text();
    expect(bodyB).toContain("hello from B");
    expect(bodyB).not.toContain("hello from A");

    // Every article SELECT MUST be the site-scoped form. The unscoped
    // form (`WHERE slug = ? LIMIT 1`) must never be issued from public
    // routes after T27.
    const articleSelects = calls.filter((c) =>
      c.sql.startsWith("SELECT * FROM articles WHERE slug"),
    );
    expect(articleSelects.length).toBe(2);
    expect(
      articleSelects.every((c) =>
        c.sql.startsWith("SELECT * FROM articles WHERE slug = ? AND site_id = ?"),
      ),
    ).toBe(true);
    // Bound site_ids match the request hostname's tenant.
    expect(articleSelects[0]?.binds).toEqual(["hello", "site_A"]);
    expect(articleSelects[1]?.binds).toEqual(["hello", "site_B"]);
  });

  it("unknown hostname returns 404 before any article query is issued", async () => {
    const { db, calls } = makeDb([], []);
    const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
    app.route("/", publicRouter);

    const res = await app.request(
      "https://no-such-site.example/article/hello",
      {},
      makeEnv(db),
    );
    expect(res.status).toBe(404);
    const articleSelects = calls.filter((c) =>
      c.sql.startsWith("SELECT * FROM articles WHERE slug"),
    );
    expect(articleSelects.length).toBe(0);
  });
});
