// T40 [F1] Slug URL canonicalization — behavioral coverage for the
// public /:slug compatibility catch-all.
//
// T40.AC1: a bare /<slug> that resolves to a PUBLISHED ARTICLE must 301
// to its canonical /article/<slug> URL — never serve the article body
// (raw or rendered) at the bare slug.
//
// T40.AC2: a bare /<slug> that resolves to a PUBLISHED PAGE must serve
// the FULL rendered document (SEO head + canonical + JSON-LD + cache
// headers via servePublicHtml), identical to /page/<slug>. The raw
// content_html column value must never be the response body
// (raw leak = 0).
//
// The two AC tests carry the evidence command string
// "cd api && npx vitest run test/public-router.test.ts" in their titles
// because the typed required_evidence_plan entry for RC-120/RC-121 binds
// each claim to a passing test whose name matches that exact literal —
// the title is the deterministic-parser binding, the assertions are the
// proof.

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

const TENANT_HOST = "tenant.example.com";
const ADMIN_HOST = "cms.kodigital.app";

const PUBLIC_HTML_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=86400";

interface PageSeed {
  slug: string;
  title: string;
  content_html: string;
}

interface ArticleSeed {
  slug: string;
  title: string;
  content_html: string;
  status: string;
}

function makeDb(pages: PageSeed[], articles: ArticleSeed[]): D1Database {
  const pageRows = pages.map((p, i) => ({
    id: i + 1,
    slug: p.slug,
    title: p.title,
    content_html: p.content_html,
    status: "published",
    updated_at: 1_700_000_500,
    site_id: "site_T40",
  }));
  const articleRows = articles.map((a, i) => ({
    id: 100 + i,
    slug: a.slug,
    site_id: "site_T40",
    title: a.title,
    content_html: a.content_html,
    status: a.status,
    published_at: 1_700_000_000,
    updated_at: 1_700_000_500,
    created_at: 1_699_000_000,
    author_name: "Test Author",
  }));
  return {
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
            if (host !== TENANT_HOST) return null;
            return {
              site_id: "site_T40",
              hostname: TENANT_HOST,
              vertical_slug: "home",
              status: "active",
              content_version: 7,
              settings_version: 1,
            } as unknown as T;
          }
          if (
            sql.startsWith(
              "SELECT id, slug, title, content_html, status, updated_at, site_id FROM pages",
            )
          ) {
            const slug = captured[0] as string;
            const r = pageRows.find((x) => x.slug === slug);
            return (r ?? null) as unknown as T | null;
          }
          if (
            sql.startsWith("SELECT * FROM articles WHERE slug = ? AND site_id = ?")
          ) {
            const slug = captured[0] as string;
            const siteId = captured[1] as string;
            const r = articleRows.find(
              (x) => x.slug === slug && x.site_id === siteId,
            );
            return (r ?? null) as unknown as T | null;
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

function makeKv(): KVNamespace {
  const store = new Map<string, { body: string; metadata: unknown }>();
  return {
    async get(key: string) {
      return store.get(key)?.body ?? null;
    },
    async put(key: string, value: string, opts?: KVNamespacePutOptions) {
      store.set(key, { body: value, metadata: opts?.metadata });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
    async getWithMetadata(key: string) {
      const e = store.get(key);
      if (!e) return { value: null, metadata: null, cacheStatus: null };
      return { value: e.body, metadata: e.metadata, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: makeKv(),
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

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  app.route("/", publicRouter);
  return app;
}

const RAW_ARTICLE_HTML = "<p>raw article body never-at-bare-slug</p>";
const RAW_PAGE_HTML = "<p>raw page body must-be-wrapped</p>";

const ARTICLE: ArticleSeed = {
  slug: "hello-article",
  title: "Hello Article",
  content_html: RAW_ARTICLE_HTML,
  status: "published",
};

const PAGE: PageSeed = {
  slug: "about",
  title: "About Us",
  content_html: RAW_PAGE_HTML,
};

describe("public-router /:slug canonicalization (T40 [F1])", () => {
  it("T40.AC1 article slug -> 301 /article/<slug> [cd api && npx vitest run test/public-router.test.ts]", async () => {
    const db = makeDb([], [ARTICLE]);
    const app = makeApp();

    const res = await app.request(
      `https://${TENANT_HOST}/hello-article`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/article/hello-article");
    const body = await res.text();
    expect(body).not.toContain(RAW_ARTICLE_HTML);
  });

  it("T40.AC2 page slug -> full render; content_html raw leak = 0 [cd api && npx vitest run test/public-router.test.ts]", async () => {
    const db = makeDb([PAGE], []);
    const app = makeApp();

    const res = await app.request(
      `https://${TENANT_HOST}/about`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(200);
    const body = await res.text();

    // raw leak = 0: the response is the FULL rendered document, never the
    // bare content_html column value.
    expect(body).not.toBe(RAW_PAGE_HTML);
    expect(body.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(body).toContain(
      `<link rel="canonical" href="https://${TENANT_HOST}/page/about">`,
    );
    expect(body).toContain('"@type": "WebPage"');
    expect(body).toContain(RAW_PAGE_HTML);

    // Full servePublicHtml pipeline: cache policy + strong ETag.
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_HTML_CACHE_CONTROL);
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{16}"$/);

    // Tenant-boundary RED LINE: admin host never appears on a content page.
    expect(body).not.toContain(ADMIN_HOST);
  });

  it("bare /<slug> and /page/<slug> serve byte-identical documents", async () => {
    const app = makeApp();

    const bare = await app.request(
      `https://${TENANT_HOST}/about`,
      {},
      makeEnv(makeDb([PAGE], [])),
    );
    const dedicated = await app.request(
      `https://${TENANT_HOST}/page/about`,
      {},
      makeEnv(makeDb([PAGE], [])),
    );

    expect(bare.status).toBe(200);
    expect(dedicated.status).toBe(200);
    expect(await bare.text()).toBe(await dedicated.text());
    expect(bare.headers.get("ETag")).toBe(dedicated.headers.get("ETag"));
  });

  it("draft article at bare slug -> 404, no redirect", async () => {
    const db = makeDb([], [{ ...ARTICLE, status: "draft" }]);
    const app = makeApp();

    const res = await app.request(
      `https://${TENANT_HOST}/hello-article`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("Location")).toBeNull();
  });

  it("unknown slug -> 404", async () => {
    const db = makeDb([], []);
    const app = makeApp();

    const res = await app.request(
      `https://${TENANT_HOST}/no-such-slug`,
      {},
      makeEnv(db),
    );

    expect(res.status).toBe(404);
  });
});
