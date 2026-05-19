// Phase 5 / T13 BEHAVIORAL guards for the GET /article/:slug public-Article
// handler.
//
// Test bindings (from implementation_digest):
//   T13.AC3 — `^public-router-article.*renders[_-]?article`
//   T13.AC4 — `^public-router-article.*fallback[_-]?on[_-]?throw`
//
// T13 wires buildArticleViewModel + renderArticle (+ renderLayout) for the
// happy path, and falls back to serving the raw `content_html` when the
// template pipeline throws (so a single bad row never 500s the route).
// The renderArticle import is mocked via vi.mock so the fallback test can
// force a synchronous throw without seeding intentionally-broken vm state.
// The mock reuses the real renderArticle for the "renders" case via
// vi.importActual; only the fallback test flips the toggle to "throw".

import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";

let articleRenderMode: "real" | "throw" = "real";

vi.mock("../src/public/templates/article", async () => {
  const actual = await vi.importActual<
    typeof import("../src/public/templates/article")
  >("../src/public/templates/article");
  return {
    ...actual,
    renderArticle: (
      args: Parameters<typeof actual.renderArticle>[0],
    ): string => {
      if (articleRenderMode === "throw") {
        throw new Error("simulated-render-failure");
      }
      return actual.renderArticle(args);
    },
  };
});

import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

interface DomainSeed {
  hostname: string;
  site_id: string;
  vertical_slug: string;
}

interface ArticleSeed {
  id: number;
  slug: string;
  site_id: string;
  title: string;
  content_html: string;
}

interface SettingRow {
  key: string;
  value: string | null;
}

function articleRow(a: ArticleSeed) {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    content_json: null,
    content_html: a.content_html,
    category_id: null,
    status: "published",
    published_at: Math.floor(Date.parse("2026-05-18T10:00:00Z") / 1000),
    updated_at: Math.floor(Date.parse("2026-05-18T11:00:00Z") / 1000),
    author_name: "Jamie Reporter",
    featured_image_id: null,
    is_featured: 0,
    site_id: a.site_id,
    category_name: null,
    category_slug: null,
    image_url: null,
    image_alt: null,
    seo_title: null,
    seo_description: null,
  };
}

function makeDb(
  domains: DomainSeed[],
  articles: ArticleSeed[],
  settings: SettingRow[] = [],
): D1Database {
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
          if (
            sql.includes("a.content_json AS content_json") &&
            sql.includes("WHERE a.site_id = ? AND a.slug = ?")
          ) {
            const siteId = String(captured[0] ?? "");
            const slug = String(captured[1] ?? "");
            const a = articles.find(
              (x) => x.slug === slug && x.site_id === siteId,
            );
            return a === undefined ? null : (articleRow(a) as unknown as T);
          }
          if (
            sql.startsWith("SELECT * FROM articles WHERE slug = ? AND site_id = ?")
          ) {
            const slug = String(captured[0] ?? "");
            const siteId = String(captured[1] ?? "");
            const a = articles.find(
              (x) => x.slug === slug && x.site_id === siteId,
            );
            return (a === undefined ? null : articleRow(a)) as unknown as T | null;
          }
          return null;
        },
        async all<T = unknown>() {
          if (sql.includes("FROM site_settings WHERE site_id = ?")) {
            return {
              results: settings as unknown as T[],
              success: true,
              meta: {},
            };
          }
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

describe("public-router-article", () => {
  beforeEach(() => {
    articleRenderMode = "real";
  });

  it("renders-article — published article -> 200 with article-shell + hero + body", async () => {
    const articles: ArticleSeed[] = [
      {
        id: 1,
        slug: "the-feature",
        site_id: "site_A",
        title: "The Feature That Mattered",
        content_html: "<p>Hello from the Article body.</p>",
      },
    ];
    const settings: SettingRow[] = [
      { key: "site_name", value: "Tenant A News" },
    ];
    const db = makeDb([tenantDomain], articles, settings);
    const app = new Hono<{
      Bindings: Env;
      Variables: PublicSiteVariables;
    }>();
    app.route("/", publicRouter);

    const res = await app.request(
      "https://tenant-a.example/article/the-feature",
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    expect((res.headers.get("content-type") ?? "").toLowerCase()).toContain(
      "text/html",
    );

    const body = await res.text();
    expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(body).toContain("<!-- article-section:3 article-hero -->");
    expect(body).toContain("<!-- article-section:6 article-shell -->");
    expect(body).toContain('class="article-shell"');
    expect(body).toContain("Hello from the Article body.");
    expect(body).toContain("Tenant A News");
    expect(body.toLowerCase()).not.toContain("theiwise");
    expect(body).not.toContain("cms.kodigital.app");
  });

  it("fallback-on-throw — renderArticle throws -> 200 with content_html fallback", async () => {
    articleRenderMode = "throw";
    const articles: ArticleSeed[] = [
      {
        id: 2,
        slug: "broken-template",
        site_id: "site_A",
        title: "Broken Template Article",
        content_html: "<p>Raw fallback markup for this article.</p>",
      },
    ];
    const db = makeDb([tenantDomain], articles);
    const app = new Hono<{
      Bindings: Env;
      Variables: PublicSiteVariables;
    }>();
    app.route("/", publicRouter);

    const res = await app.request(
      "https://tenant-a.example/article/broken-template",
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    expect((res.headers.get("content-type") ?? "").toLowerCase()).toContain(
      "text/html",
    );
    const body = await res.text();
    expect(body).toContain("Raw fallback markup for this article.");
    // Fallback returns raw content_html, NOT the layout-wrapped article.
    expect(body).not.toContain("article-section:6");
    expect(body).not.toContain('class="article-shell"');
    expect(body.startsWith("<!DOCTYPE html>")).toBe(false);
  });
});
