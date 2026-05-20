// Phase 5 / T15 BEHAVIORAL guards for the GET /category/:slug and
// GET /page/:slug public handlers, which T15 rewires to the
// `renderLayout` site-aware wrapper.
//
// Test bindings (from implementation_digest):
//   T15.AC2 — `^public-router-category-page.*category`
//   T15.AC3 — `^public-router-category-page.*page[_-]?slug`
//
// Each test asserts:
//   - 200 status
//   - content-type contains text/html
//   - body is layout-wrapped (`<!DOCTYPE html>` + `<header class="site-header"`)
//   - body contains the visible brand string from site_settings.site_name
//   - body contains the route-specific content (category name | page content_html)
//   - body does NOT leak hardcoded `theiwise` / `cms.kodigital.app` strings
//     (PART 12 RED LINE).

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

interface CategorySeed {
  id: number;
  slug: string;
  name: string;
}

interface CategoryArticleSeed {
  id: number;
  slug: string;
  title: string;
  category_id: number;
  site_id: string;
}

interface PageSeed {
  id: number;
  slug: string;
  title: string;
  content_html: string;
  site_id: string;
}

interface SettingRow {
  key: string;
  value: string | null;
}

function categoryArticleRow(a: CategoryArticleSeed) {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    content_html: "<p>body</p>",
    content_json: null,
    category_id: a.category_id,
    status: "published",
    published_at: Math.floor(Date.parse("2026-05-18T10:00:00Z") / 1000),
    updated_at: Math.floor(Date.parse("2026-05-18T11:00:00Z") / 1000),
    author_name: null,
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
  categories: CategorySeed[],
  categoryArticles: CategoryArticleSeed[],
  pages: PageSeed[],
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
          if (sql.startsWith("SELECT id, slug, name FROM categories")) {
            const slug = String(captured[0] ?? "");
            const cat = categories.find((c) => c.slug === slug);
            return cat === undefined ? null : (cat as unknown as T);
          }
          if (sql.startsWith("SELECT id, slug, title, content_html")) {
            const slug = String(captured[0] ?? "");
            const siteId = String(captured[1] ?? "");
            const p = pages.find(
              (x) => x.slug === slug && (x.site_id === siteId || x.site_id === ""),
            );
            if (p === undefined) return null;
            return {
              id: p.id,
              slug: p.slug,
              title: p.title,
              content_html: p.content_html,
              status: "published",
              updated_at: Math.floor(Date.parse("2026-05-18T11:00:00Z") / 1000),
              site_id: p.site_id,
            } as unknown as T;
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
          if (sql.startsWith("SELECT * FROM articles WHERE category_id = ?")) {
            const catId = Number(captured[0] ?? 0);
            const siteId = String(captured[1] ?? "");
            const rows = categoryArticles
              .filter((a) => a.category_id === catId && a.site_id === siteId)
              .map(categoryArticleRow);
            return {
              results: rows as unknown as T[],
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

describe("public-router-category-page", () => {
  it("T15.AC2: category — GET /category/:slug -> 200 text/html with site-header + category name", async () => {
    const categories: CategorySeed[] = [
      { id: 7, slug: "long-form", name: "Long Form" },
    ];
    const articles: CategoryArticleSeed[] = [
      {
        id: 1,
        slug: "deep-dive",
        title: "A Deep Dive",
        category_id: 7,
        site_id: "site_A",
      },
    ];
    const settings: SettingRow[] = [
      { key: "site_name", value: "Tenant A News" },
      { key: "tagline", value: "Stories that matter" },
      { key: "site_description", value: "All the news from Tenant A." },
    ];
    const db = makeDb([tenantDomain], categories, articles, [], settings);
    const app = new Hono<{
      Bindings: Env;
      Variables: PublicSiteVariables;
    }>();
    app.route("/", publicRouter);

    const res = await app.request(
      "https://tenant-a.example/category/long-form",
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    expect((res.headers.get("content-type") ?? "").toLowerCase()).toContain(
      "text/html",
    );

    const body = await res.text();
    expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(body).toContain('<header class="site-header"');
    expect(body).toContain("Tenant A News");
    expect(body).toContain("Long Form");
    expect(body).toContain('href="/article/deep-dive"');
    expect(body).toContain("A Deep Dive");
    expect(body.toLowerCase()).not.toContain("theiwise");
    expect(body).not.toContain("cms.kodigital.app");
  });

  it("T15.AC2: page-slug — GET /page/:slug -> 200 text/html with site-header + page content_html", async () => {
    const pages: PageSeed[] = [
      {
        id: 11,
        slug: "about",
        title: "About Us",
        content_html: "<p>We publish stories curated for Tenant A.</p>",
        site_id: "site_A",
      },
    ];
    const settings: SettingRow[] = [
      { key: "site_name", value: "Tenant A News" },
      { key: "site_description", value: "All the news from Tenant A." },
    ];
    const db = makeDb([tenantDomain], [], [], pages, settings);
    const app = new Hono<{
      Bindings: Env;
      Variables: PublicSiteVariables;
    }>();
    app.route("/", publicRouter);

    const res = await app.request(
      "https://tenant-a.example/page/about",
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    expect((res.headers.get("content-type") ?? "").toLowerCase()).toContain(
      "text/html",
    );

    const body = await res.text();
    expect(body.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(body).toContain('<header class="site-header"');
    expect(body).toContain("Tenant A News");
    expect(body).toContain("About Us");
    expect(body).toContain("<p>We publish stories curated for Tenant A.</p>");
    expect(body.toLowerCase()).not.toContain("theiwise");
    expect(body).not.toContain("cms.kodigital.app");
  });
});
