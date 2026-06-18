import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";

// T13: KV cache wrapping for /robots.txt + /ads.txt keyed by settings_version.
//
// Coverage:
//   1. Cold cache: first GET reads the per-site override (or default), writes
//      the body to KV under robotsKey / adsKey keyed by site_id +
//      settings_version. Response carries robotsAdsCacheHeaders
//      (public, max-age=3600) + X-Content-Type-Options: nosniff.
//   2. Warm cache: second GET returns the KV-stored body without re-reading
//      the DB (proven by mutating the underlying override between calls —
//      warm response still serves the original body).
//   3. Off-admin-host hardening: requests on the ADMIN_HOST get a 404 from
//      the publicSiteContextMiddleware (refusal upstream) — robots/ads
//      handlers MUST NOT run for the admin host.
//   4. settings_version bump produces a new cache key (orphans prior entry
//      via TTL expiry without explicit delete).

interface DomainSeed {
  hostname: string;
  site_id: string;
  vertical_slug: string;
  content_version: number;
  settings_version: number;
}

interface SettingSeed {
  site_id: string;
  key: string;
  value: string | null;
}

function makeDb(domains: DomainSeed[], settings: SettingSeed[]): D1Database {
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
              settings_version: d.settings_version,
            } as unknown as T;
          }
          if (sql.startsWith("SELECT value FROM site_settings")) {
            const siteId = String(captured[0] ?? "");
            const key = String(captured[1] ?? "");
            const row = settings.find(
              (s) => s.site_id === siteId && s.key === key,
            );
            if (!row) return null;
            return { value: row.value } as unknown as T;
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

const ROBOTS_ADS_CACHE_CONTROL = "public, max-age=3600";

const domains: DomainSeed[] = [
  {
    hostname: "example.test",
    site_id: "site_R",
    vertical_slug: "home",
    content_version: 3,
    settings_version: 5,
  },
];

describe("router /robots.txt KV cache (T13)", () => {
  it("cold cache: 200 + robotsAdsCacheHeaders + writes robots:<site>:<sv> to KV", async () => {
    const db = makeDb(domains, []);
    const { kv, store } = makeKv();
    const app = makeApp();

    const res = await app.request(
      "https://example.test/robots.txt",
      {},
      makeEnv(db, kv),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(ROBOTS_ADS_CACHE_CONTROL);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /admin/");
    expect(body).toContain("Sitemap: https://example.test/sitemap.xml");

    expect(store.has("robots:site_R:5")).toBe(true);
    expect(store.get("robots:site_R:5")?.body).toBe(body);
  });

  it("warm cache: second GET returns KV body (override mutation hidden by cache)", async () => {
    const db1 = makeDb(domains, []);
    const { kv } = makeKv();
    const app = makeApp();

    const first = await app.request(
      "https://example.test/robots.txt",
      {},
      makeEnv(db1, kv),
    );
    const firstBody = await first.text();

    // Mutate underlying override beneath the cache: warm hit MUST NOT see it.
    const db2 = makeDb(domains, [
      {
        site_id: "site_R",
        key: "robots_txt_content",
        value: "User-agent: *\nDisallow: /\n",
      },
    ]);

    const second = await app.request(
      "https://example.test/robots.txt",
      {},
      makeEnv(db2, kv),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.text();
    expect(secondBody).toBe(firstBody);
    expect(secondBody).not.toBe("User-agent: *\nDisallow: /\n");
  });

  it("settings_version bump produces a new cache key (orphans prior entry)", async () => {
    const db1 = makeDb(domains, []);
    const { kv, store } = makeKv();
    const app = makeApp();

    const first = await app.request(
      "https://example.test/robots.txt",
      {},
      makeEnv(db1, kv),
    );
    expect(first.status).toBe(200);
    expect(store.has("robots:site_R:5")).toBe(true);

    const bumped: DomainSeed[] = [
      { ...(domains[0] as DomainSeed), settings_version: 6 },
    ];
    const db2 = makeDb(bumped, []);

    const second = await app.request(
      "https://example.test/robots.txt",
      {},
      makeEnv(db2, kv),
    );
    expect(second.status).toBe(200);
    expect(store.has("robots:site_R:6")).toBe(true);
    // Prior key still present (TTL expiry, not explicit delete).
    expect(store.has("robots:site_R:5")).toBe(true);
  });

  it("per-site override is served from cache after first miss", async () => {
    const customRobots = "User-agent: Googlebot\nDisallow: /private/\n";
    const db = makeDb(domains, [
      { site_id: "site_R", key: "robots_txt_content", value: customRobots },
    ]);
    const { kv, store } = makeKv();
    const app = makeApp();

    const res = await app.request(
      "https://example.test/robots.txt",
      {},
      makeEnv(db, kv),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(customRobots);
    expect(store.get("robots:site_R:5")?.body).toBe(customRobots);
  });
});

describe("router /ads.txt KV cache (T13)", () => {
  it("cold cache: 200 + robotsAdsCacheHeaders + writes ads:<site>:<sv> to KV (default placeholder)", async () => {
    const db = makeDb(domains, []);
    const { kv, store } = makeKv();
    const app = makeApp();

    const res = await app.request(
      "https://example.test/ads.txt",
      {},
      makeEnv(db, kv),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(ROBOTS_ADS_CACHE_CONTROL);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    const body = await res.text();
    expect(body).toContain("placeholder ads.txt");

    expect(store.has("ads:site_R:5")).toBe(true);
    expect(store.get("ads:site_R:5")?.body).toBe(body);
  });

  it("warm cache: second GET returns KV body (override mutation hidden by cache)", async () => {
    const db1 = makeDb(domains, []);
    const { kv } = makeKv();
    const app = makeApp();

    const first = await app.request(
      "https://example.test/ads.txt",
      {},
      makeEnv(db1, kv),
    );
    const firstBody = await first.text();

    const db2 = makeDb(domains, [
      {
        site_id: "site_R",
        key: "ads_txt_content",
        value: "google.com, pub-1234567890, DIRECT, abcd1234\n",
      },
    ]);

    const second = await app.request(
      "https://example.test/ads.txt",
      {},
      makeEnv(db2, kv),
    );
    expect(second.status).toBe(200);
    const secondBody = await second.text();
    expect(secondBody).toBe(firstBody);
    expect(secondBody).not.toContain("pub-1234567890");
  });

  it("per-site override is served + cached after miss", async () => {
    const adsBody = "google.com, pub-0000, DIRECT, deadbeef\n";
    const db = makeDb(domains, [
      { site_id: "site_R", key: "ads_txt_content", value: adsBody },
    ]);
    const { kv, store } = makeKv();
    const app = makeApp();

    const res = await app.request(
      "https://example.test/ads.txt",
      {},
      makeEnv(db, kv),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(adsBody);
    expect(store.get("ads:site_R:5")?.body).toBe(adsBody);
  });
});

describe("router /robots.txt + /ads.txt off-admin-host hardening (T13)", () => {
  it("admin host requests get 404 from middleware before robots/ads handler runs", async () => {
    const db = makeDb(domains, []);
    const { kv, store } = makeKv();
    const app = makeApp();

    const resRobots = await app.request(
      "https://cms.kodigital.app/robots.txt",
      {},
      makeEnv(db, kv),
    );
    expect(resRobots.status).toBe(404);
    // No admin-host leak in the body.
    const robotsBody = await resRobots.text();
    expect(robotsBody).not.toContain("cms.kodigital.app");
    // Handler did NOT execute → nothing written to KV for admin host.
    expect(store.size).toBe(0);

    const resAds = await app.request(
      "https://cms.kodigital.app/ads.txt",
      {},
      makeEnv(db, kv),
    );
    expect(resAds.status).toBe(404);
    const adsBody = await resAds.text();
    expect(adsBody).not.toContain("cms.kodigital.app");
    expect(store.size).toBe(0);
  });

  it("unmapped tenant host gets 404 (no cache write)", async () => {
    const db = makeDb(domains, []);
    const { kv, store } = makeKv();
    const app = makeApp();

    const res = await app.request(
      "https://stranger.test/robots.txt",
      {},
      makeEnv(db, kv),
    );
    expect(res.status).toBe(404);
    expect(store.size).toBe(0);
  });
});
