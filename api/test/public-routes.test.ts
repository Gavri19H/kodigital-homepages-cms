// T14 — Missing public routes: tag, 404/500, redirects, /rss, pagination 301.
//
// Two behavioral claims, both proven against the SHIPPED public router (not a
// source grep): each request is dispatched through `app.route("/", publicRouter)`
// exactly as the worker mounts it, so the assertions observe the real served
// response. Every it() title embeds the literal [api/test/public-routes.test.ts]
// plus the L2 disambiguation marker so the parse_test_output evidence parser
// routes each receipt to its claim:
//   RC-027  ->  T14-AC1  (/tag/x styled; /category/x/page/1 301; page>=2
//                         noindex; /rss alias of /feed.xml)
//   RC-028  ->  T14-AC2  (bad URL -> styled HTML 404; server error -> styled
//                         HTML 500 — design shell, never bare JSON/text)

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

const TENANT_HOST = "tenant.example.com";
const ADMIN_HOST = "cms.kodigital.app";
const SITE_ID = "site_T14";

const PUBLIC_HTML_CACHE_CONTROL =
  "public, max-age=300, stale-while-revalidate=86400";

const CATEGORY_ROW = { id: 7, slug: "wellness", name: "Wellness" };
const TAG_ROW = { id: 11, slug: "mindfulness", name: "Mindfulness" };

function articleRow(id: number, slug: string, title: string) {
  return {
    id,
    slug,
    site_id: SITE_ID,
    title,
    content_json: "{}",
    content_html: `<p>The body of ${title} with enough words to read.</p>`,
    category_id: CATEGORY_ROW.id,
    status: "published",
    published_at: 1_700_000_000 + id,
    scheduled_at: null,
    author_name: "Editorial Desk",
    featured_image_id: null,
    is_featured: 0,
    is_trending: 0,
    created_at: 1_699_000_000,
    updated_at: 1_700_000_500,
  };
}

const TAG_ARTICLES = [
  articleRow(201, "calm-mind", "A Calmer Mind"),
  articleRow(202, "just-breathe", "Just Breathe"),
];
const CATEGORY_ARTICLES = [
  articleRow(301, "sleep-better", "Sleep Better Tonight"),
  articleRow(302, "morning-routine", "A Calmer Morning Routine"),
];
const FEED_ARTICLES = [articleRow(401, "feed-one", "Feed One")];

const SETTINGS = [
  { key: "site_name", value: "Acme Daily" },
  { key: "tagline", value: "Tomorrow's news today" },
  { key: "site_description", value: "Acme Daily covers wellness and more." },
  { key: "brand_tokens_json", value: JSON.stringify({ "tw-brand": "#1ba8c8" }) },
];

const SITE_CONTEXT_ROW = {
  site_id: SITE_ID,
  hostname: TENANT_HOST,
  vertical_slug: "news",
  status: "active",
  content_version: 7,
  settings_version: 1,
};

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

// Content DB: resolves the tenant site, then serves tag / category / feed /
// settings reads. Mirrors the per-query SQL the public router issues so each
// dispatch is disambiguated by the statement's leading text.
function makeContentDb(): D1Database {
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
            return { ...SITE_CONTEXT_ROW } as unknown as T;
          }
          if (sql.startsWith("SELECT id, slug, name FROM categories")) {
            const slug = captured[0] as string;
            return (
              slug === CATEGORY_ROW.slug ? { ...CATEGORY_ROW } : null
            ) as unknown as T | null;
          }
          if (sql.startsWith("SELECT id, slug, name FROM tags")) {
            const slug = captured[0] as string;
            return (
              slug === TAG_ROW.slug ? { ...TAG_ROW } : null
            ) as unknown as T | null;
          }
          return null;
        },
        async all<T = unknown>() {
          if (sql.startsWith("SELECT a.* FROM articles a")) {
            // /tag listing (JOIN article_tags).
            return { results: TAG_ARTICLES as unknown as T[], success: true, meta: {} };
          }
          if (sql.startsWith("SELECT * FROM articles WHERE category_id")) {
            return { results: CATEGORY_ARTICLES as unknown as T[], success: true, meta: {} };
          }
          if (sql.startsWith("SELECT * FROM articles WHERE status")) {
            // listArticles (feed body).
            return { results: FEED_ARTICLES as unknown as T[], success: true, meta: {} };
          }
          if (sql.includes("FROM site_settings")) {
            return { results: SETTINGS as unknown as T[], success: true, meta: {} };
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
}

// Exploding DB: the site resolves (so the request enters a content handler),
// but every content read throws — the unhandled error must surface as the
// styled HTML 500, not a bare "Internal Server Error".
function makeExplodingDb(): D1Database {
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
            return { ...SITE_CONTEXT_ROW } as unknown as T;
          }
          throw new Error("DB exploded (first)");
        },
        async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: object }> {
          throw new Error("DB exploded (all)");
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

// ---------------------------------------------------------------------------
// T14-AC1 (RC-027)
// ---------------------------------------------------------------------------
describe("T14-AC1 tag page / pagination 301 / page>=2 noindex / rss alias", () => {
  it("[api/test/public-routes.test.ts] T14-AC1: GET /tag/:slug renders the styled design layout — /assets/public.css + site-header/footer + styled .card list, not a bare/missing route L2_AUTO_DISAMBIGUATION:T14-AC1:RC-027", async () => {
    const res = await makeApp().request(
      `https://${TENANT_HOST}/tag/mindfulness`,
      {},
      makeEnv(makeContentDb()),
    );

    expect(res.status).toBe(200);
    const body = await res.text();

    // Full design document, not a bare fragment / JSON 404.
    expect(body.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(body).toContain('href="/assets/public.css"');
    expect(body).toContain('<style data-source="brand_tokens">');
    expect(body).toContain("--tw-brand: #1ba8c8");
    // Header + footer regions (banner + contentinfo).
    expect(body).toContain('class="site-header"');
    expect(body).toContain('role="banner"');
    expect(body).toContain('class="site-footer"');
    expect(body).toContain('role="contentinfo"');
    // The tag name is the listing heading; the tagged articles render as cards.
    expect(body).toContain('class="tag-title"');
    expect(body).toContain("Mindfulness");
    expect(body).toContain('<ul class="home-grid home-grid--tag">');
    expect(body).toContain('<article class="card">');
    expect(body).toContain('href="/article/calm-mind"');
    expect(body).toContain('href="/article/just-breathe"');
    // CollectionPage + root-first BreadcrumbList JSON-LD ride the head once.
    expect(body).toContain('"@type": "CollectionPage"');
    expect(body).toContain('"@type": "BreadcrumbList"');

    // Full servePublicHtml pipeline: cache policy + strong ETag.
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_HTML_CACHE_CONTROL);
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{16}"$/);

    // Tenant-boundary RED LINE: admin host never appears on a content page.
    expect(body).not.toContain(ADMIN_HOST);
  });

  it("[api/test/public-routes.test.ts] T14-AC1: GET /tag/:slug for an unknown tag returns the styled 404 (not a 200 empty render) L2_AUTO_DISAMBIGUATION:T14-AC1:RC-027", async () => {
    const res = await makeApp().request(
      `https://${TENANT_HOST}/tag/no-such-tag`,
      {},
      makeEnv(makeContentDb()),
    );
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);
  });

  it("[api/test/public-routes.test.ts] T14-AC1: GET /category/:slug/page/1 301s to the bare canonical /category/:slug (page 1 is not a duplicate URL) L2_AUTO_DISAMBIGUATION:T14-AC1:RC-027", async () => {
    const res = await makeApp().request(
      `https://${TENANT_HOST}/category/wellness/page/1`,
      {},
      makeEnv(makeContentDb()),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/category/wellness");
  });

  it("[api/test/public-routes.test.ts] T14-AC1: a paginated category page (page >= 2) is noindex,follow while page 1 owns the index entry L2_AUTO_DISAMBIGUATION:T14-AC1:RC-027", async () => {
    const res = await makeApp().request(
      `https://${TENANT_HOST}/category/wellness/page/2`,
      {},
      makeEnv(makeContentDb()),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    // page >= 2 carries noindex so the page-1 canonical owns the index entry.
    expect(body).toContain('<meta name="robots" content="noindex, follow">');
    // The canonical still points at the bare /category/<slug> (page 1).
    expect(body).toContain(
      `<link rel="canonical" href="https://${TENANT_HOST}/category/wellness">`,
    );

    // Page 1 (the bare route) is index,follow — proving the noindex is
    // pagination-specific, not a blanket category-page noindex.
    const page1 = await makeApp().request(
      `https://${TENANT_HOST}/category/wellness`,
      {},
      makeEnv(makeContentDb()),
    );
    const page1Body = await page1.text();
    expect(page1Body).toContain('<meta name="robots" content="index, follow">');
  });

  it("[api/test/public-routes.test.ts] T14-AC1: /rss serves the RSS feed as a byte-identical alias of /feed.xml (same content + content-type) L2_AUTO_DISAMBIGUATION:T14-AC1:RC-027", async () => {
    const env = makeEnv(makeContentDb());

    const feed = await makeApp().request(`https://${TENANT_HOST}/feed.xml`, {}, env);
    const rss = await makeApp().request(`https://${TENANT_HOST}/rss`, {}, env);

    expect(feed.status).toBe(200);
    expect(rss.status).toBe(200);
    // /rss serves the feed directly (it is an alias, not a redirect hop).
    expect(rss.headers.get("Location")).toBeNull();

    const feedBody = await feed.text();
    const rssBody = await rss.text();
    // It is a real RSS document, not an HTML page.
    expect(rssBody).toContain("<rss");
    expect(rssBody).toContain("Feed One");
    expect(rss.headers.get("Content-Type")).toContain("application/rss+xml");
    // Byte-identical alias: same body + same content-type as /feed.xml.
    expect(rssBody).toBe(feedBody);
    expect(rss.headers.get("Content-Type")).toBe(
      feed.headers.get("Content-Type"),
    );
  });
});

// ---------------------------------------------------------------------------
// T14-AC2 (RC-028)
// ---------------------------------------------------------------------------
describe("T14-AC2 styled HTML 404 + styled HTML 500", () => {
  it("[api/test/public-routes.test.ts] T14-AC2: a bad URL returns a styled HTML 404 rendered through the design shell — NOT bare JSON L2_AUTO_DISAMBIGUATION:T14-AC2:RC-028", async () => {
    const res = await makeApp().request(
      `https://${TENANT_HOST}/no-such-page`,
      {},
      makeEnv(makeContentDb()),
    );

    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();

    // Rendered through the design shell (full document + public.css), not the
    // rescue-era bare `{"error":"Not Found"}` JSON body.
    expect(body.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(body).toContain('href="/assets/public.css"');
    expect(body).toContain('class="site-header"');
    expect(body).toContain('class="site-footer"');
    expect(body).toContain('data-error-status="404"');
    expect(body).toContain("Page not found");
    // The error page is noindex (a 404 body must never be indexed).
    expect(body).toContain('<meta name="robots" content="noindex, follow">');
    // NEGATIVE: not the bare JSON error envelope.
    expect(body).not.toContain('{"error"');
    expect(body).not.toBe('{"error":"Not Found"}');

    // Tenant-boundary RED LINE: admin host never appears on the error page.
    expect(body).not.toContain(ADMIN_HOST);
  });

  it("[api/test/public-routes.test.ts] T14-AC2: an unexpected server error returns a styled HTML 500 through the design shell — NOT hono's default text body L2_AUTO_DISAMBIGUATION:T14-AC2:RC-028", async () => {
    // The site resolves, then the homepage content read throws → the router's
    // onError renders the styled 500.
    const res = await makeApp().request(
      `https://${TENANT_HOST}/`,
      {},
      makeEnv(makeExplodingDb()),
    );

    expect(res.status).toBe(500);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const body = await res.text();

    expect(body.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(body).toContain('href="/assets/public.css"');
    expect(body).toContain('class="site-header"');
    expect(body).toContain('data-error-status="500"');
    expect(body).toContain("Something went wrong");
    expect(body).toContain('<meta name="robots" content="noindex, follow">');
    // NEGATIVE: not the bare default error bodies.
    expect(body).not.toBe("Internal Server Error");
    expect(body).not.toContain('{"error"');

    // Tenant-boundary RED LINE: admin host never appears on the error page.
    expect(body).not.toContain(ADMIN_HOST);
  });
});
