import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

// T12: KV cache wrapping for /sitemap.xml + /feed.xml + /atom.xml.
//
// Coverage:
//   1. Cold cache: first GET renders + writes the body to KV under the
//      sitemapKey / feedRssKey / feedAtomKey for the tenant's site_id +
//      content_version. Response carries feedCacheHeaders Cache-Control
//      (public, max-age=300, SWR=86400) + X-Content-Type-Options: nosniff.
//   2. Warm cache: second GET returns the KV-stored body without re-rendering
//      (proven by mutating the DB between calls — warm response still serves
//      the original body).
//   3. Cache key namespaces are wire-correct: sitemap:<site>:<cv>,
//      feed:rss:<site>:<cv>, feed:atom:<site>:<cv>.

interface ArticleSeed {
  id: number;
  slug: string;
  site_id: string;
  title: string;
  content_html: string;
  status: string;
  published_at: number;
  updated_at: number;
  created_at: number;
  author_name: string;
}

interface PageSeed {
  slug: string;
  site_id: string;
  status: string;
  updated_at: number;
}

interface DomainSeed {
  hostname: string;
  site_id: string;
  vertical_slug: string;
  content_version: number;
}

function makeDb(
  domains: DomainSeed[],
  articles: ArticleSeed[],
  pages: PageSeed[],
): D1Database {
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
            const d = domains.find((x) => x.hostname === host);
            if (!d) return null;
            return {
              site_id: d.site_id,
              hostname: d.hostname,
              vertical_slug: d.vertical_slug,
              status: "active",
              content_version: d.content_version,
              settings_version: 1,
            } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>() {
          if (sql.startsWith("SELECT * FROM articles WHERE status = ? AND site_id = ?")) {
            const status = captured[0] as string;
            const siteId = captured[1] as string;
            const results = articles.filter(
              (a) => a.status === status && a.site_id === siteId,
            );
            return { results: results as unknown as T[], success: true, meta: {} };
          }
          if (sql.startsWith("SELECT slug, updated_at FROM pages")) {
            const siteId = captured[0] as string;
            const results = pages.filter(
              (p) => p.status === "published" && p.site_id === siteId,
            );
            return { results: results as unknown as T[], success: true, meta: {} };
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

function makeKv(): {
  kv: KVNamespace;
  store: Map<string, { body: string; metadata: unknown }>;
} {
  const store = new Map<string, { body: string; metadata: unknown }>();
  const kv = {
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
  return { kv, store };
}

function makeEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv,
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

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  app.route("/", publicRouter);
  return app;
}

const FEED_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";

const domains: DomainSeed[] = [
  {
    hostname: "example.test",
    site_id: "site_E",
    vertical_slug: "home",
    content_version: 7,
  },
];

const baseArticles: ArticleSeed[] = [
  {
    id: 1,
    slug: "first-post",
    site_id: "site_E",
    title: "First Post",
    content_html: "<p>First body.</p>",
    status: "published",
    published_at: 1_700_000_000,
    updated_at: 1_700_000_500,
    created_at: 1_699_000_000,
    author_name: "Author A",
  },
];

const basePages: PageSeed[] = [
  {
    slug: "about",
    site_id: "site_E",
    status: "published",
    updated_at: 1_700_010_000,
  },
];

describe("router /sitemap.xml KV cache (T12)", () => {
  it("cold cache: 200 + feedCacheHeaders + writes sitemap:<site>:<cv> to KV", async () => {
    const db = makeDb(domains, baseArticles, basePages);
    const { kv, store } = makeKv();
    const app = makeApp();

    const res = await app.request(
      "https://example.test/sitemap.xml",
      {},
      makeEnv(db, kv),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(FEED_CACHE_CONTROL);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("<urlset");
    expect(body).toContain("/article/first-post");

    expect(store.has("sitemap:site_E:7")).toBe(true);
    const stored = store.get("sitemap:site_E:7");
    expect(stored?.body).toBe(body);
  });

  it("warm cache: second GET returns KV body without re-rendering (DB mutation hidden)", async () => {
    const db1 = makeDb(domains, baseArticles, basePages);
    const { kv } = makeKv();
    const app = makeApp();

    const first = await app.request(
      "https://example.test/sitemap.xml",
      {},
      makeEnv(db1, kv),
    );
    const firstBody = await first.text();

    // Mutate DB beneath the cache: add another article. A warm hit MUST NOT
    // see it (proves cache-only render path was taken).
    const mutated: ArticleSeed[] = [
      ...baseArticles,
      {
        id: 99,
        slug: "post-after-cache",
        site_id: "site_E",
        title: "After cache",
        content_html: "<p>After.</p>",
        status: "published",
        published_at: 1_700_002_000,
        updated_at: 1_700_002_500,
        created_at: 1_700_002_000,
        author_name: "Author B",
      },
    ];
    const db2 = makeDb(domains, mutated, basePages);

    const second = await app.request(
      "https://example.test/sitemap.xml",
      {},
      makeEnv(db2, kv),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.text();
    expect(secondBody).toBe(firstBody);
    expect(secondBody).not.toContain("post-after-cache");
  });
});

describe("router /feed.xml KV cache (T12)", () => {
  it("cold cache: 200 + feedCacheHeaders + writes feed:rss:<site>:<cv> to KV", async () => {
    const db = makeDb(domains, baseArticles, basePages);
    const { kv, store } = makeKv();
    const app = makeApp();

    const res = await app.request(
      "https://example.test/feed.xml",
      {},
      makeEnv(db, kv),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(FEED_CACHE_CONTROL);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toBe(
      "application/rss+xml; charset=utf-8",
    );
    const body = await res.text();
    expect(body).toContain("<rss");
    expect(body).toContain("<title>First Post</title>");

    expect(store.has("feed:rss:site_E:7")).toBe(true);
  });

  it("warm cache: second GET returns KV body (DB mutation hidden by cache)", async () => {
    const db1 = makeDb(domains, baseArticles, basePages);
    const { kv } = makeKv();
    const app = makeApp();

    const first = await app.request(
      "https://example.test/feed.xml",
      {},
      makeEnv(db1, kv),
    );
    const firstBody = await first.text();

    const mutated: ArticleSeed[] = [
      ...baseArticles,
      {
        id: 100,
        slug: "rss-cache-buster",
        site_id: "site_E",
        title: "RSS hidden",
        content_html: "<p>x</p>",
        status: "published",
        published_at: 1_700_003_000,
        updated_at: 1_700_003_500,
        created_at: 1_700_003_000,
        author_name: "Author C",
      },
    ];
    const db2 = makeDb(domains, mutated, basePages);

    const second = await app.request(
      "https://example.test/feed.xml",
      {},
      makeEnv(db2, kv),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.text();
    expect(secondBody).toBe(firstBody);
    expect(secondBody).not.toContain("rss-cache-buster");
  });
});

describe("router /atom.xml KV cache (T12)", () => {
  it("cold cache: 200 + feedCacheHeaders + writes feed:atom:<site>:<cv> to KV", async () => {
    const db = makeDb(domains, baseArticles, basePages);
    const { kv, store } = makeKv();
    const app = makeApp();

    const res = await app.request(
      "https://example.test/atom.xml",
      {},
      makeEnv(db, kv),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(FEED_CACHE_CONTROL);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toBe(
      "application/atom+xml; charset=utf-8",
    );
    const body = await res.text();
    expect(body).toContain("<feed xmlns=");
    expect(body).toContain("<title>First Post</title>");

    expect(store.has("feed:atom:site_E:7")).toBe(true);
  });

  it("content_version bump produces a new cache key (orphans prior entry)", async () => {
    const db1 = makeDb(domains, baseArticles, basePages);
    const { kv, store } = makeKv();
    const app = makeApp();

    const first = await app.request(
      "https://example.test/atom.xml",
      {},
      makeEnv(db1, kv),
    );
    expect(first.status).toBe(200);
    expect(store.has("feed:atom:site_E:7")).toBe(true);

    // Simulate a content_version bump (publish event). New key, new render.
    const bumped: DomainSeed[] = [
      { ...domains[0]!, content_version: 8 },
    ];
    const db2 = makeDb(bumped, baseArticles, basePages);

    const second = await app.request(
      "https://example.test/atom.xml",
      {},
      makeEnv(db2, kv),
    );
    expect(second.status).toBe(200);
    expect(store.has("feed:atom:site_E:8")).toBe(true);
    // Prior key still present (TTL-expiry, not explicit delete).
    expect(store.has("feed:atom:site_E:7")).toBe(true);
  });
});

// T44 (F5): sitemap/feeds URL audit — every article URL emitted by
// /sitemap.xml, /feed.xml and /atom.xml must use the canonical /article/
// prefix (F1 slug canonicalization); a bare https://<host>/<slug> form
// anywhere in these documents is a regression.
describe("sitemap/feeds URL audit (T44 / F5)", () => {
  const auditArticles: ArticleSeed[] = [
    ...baseArticles,
    {
      id: 2,
      slug: "second-post",
      site_id: "site_E",
      title: "Second Post",
      content_html: "<p>Second body.</p>",
      status: "published",
      published_at: 1_700_001_000,
      updated_at: 1_700_001_500,
      created_at: 1_699_500_000,
      author_name: "Author B",
    },
  ];

  it("cd api && npx vitest run test/router-sitemap-feed-cache.test.ts — every article <loc> contains /article/ (T44.AC1)", async () => {
    const db = makeDb(domains, auditArticles, basePages);
    const { kv } = makeKv();
    const app = makeApp();

    const res = await app.request(
      "https://example.test/sitemap.xml",
      {},
      makeEnv(db, kv),
    );
    expect(res.status).toBe(200);
    const body = await res.text();

    const locs = [...body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    // home + every article + every page — nothing missing, nothing extra.
    expect(locs).toHaveLength(1 + auditArticles.length + basePages.length);

    for (const a of auditArticles) {
      const articleLocs = locs.filter((l) => l.includes(a.slug));
      expect(articleLocs).toHaveLength(1);
      expect(articleLocs[0]).toContain("/article/");
      expect(articleLocs[0]).toBe(`https://example.test/article/${a.slug}`);
      // The bare /:slug compatibility form must never appear in the sitemap.
      expect(locs).not.toContain(`https://example.test/${a.slug}`);
    }
  });

  it("cd api && npx vitest run test/router-sitemap-feed-cache.test.ts — RSS + Atom feed links use /article/ (T44.AC2)", async () => {
    const db = makeDb(domains, auditArticles, basePages);
    const { kv } = makeKv();
    const app = makeApp();
    const env = makeEnv(db, kv);

    const rss = await app.request("https://example.test/feed.xml", {}, env);
    expect(rss.status).toBe(200);
    const rssBody = await rss.text();
    const itemLinks = [...rssBody.matchAll(/<link>([^<]+)<\/link>/g)]
      .map((m) => m[1]!)
      // channel-level <link> is the site home, not an article URL
      .filter((l) => l !== "https://example.test");
    const guids = [...rssBody.matchAll(/<guid[^>]*>([^<]+)<\/guid>/g)].map(
      (m) => m[1]!,
    );
    expect(itemLinks).toHaveLength(auditArticles.length);
    expect(guids).toHaveLength(auditArticles.length);
    for (const url of [...itemLinks, ...guids]) {
      expect(url).toContain("/article/");
    }

    const atom = await app.request("https://example.test/atom.xml", {}, env);
    expect(atom.status).toBe(200);
    const atomBody = await atom.text();
    const entryChunks = atomBody.split("<entry>").slice(1);
    expect(entryChunks).toHaveLength(auditArticles.length);
    for (const chunk of entryChunks) {
      const id = chunk.match(/<id>([^<]+)<\/id>/)?.[1];
      const href = chunk.match(/<link href="([^"]+)"\/>/)?.[1];
      expect(id).toContain("/article/");
      expect(href).toContain("/article/");
    }
  });
});
