import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { STEPS } from "../src/site-provisioning/steps";
import type { StepContext } from "../src/site-provisioning/steps";
import {
  feedAtomKey,
  feedRssKey,
  htmlKey,
  sitemapKey,
} from "../src/cache/cache-keys";
import type { Env } from "../src/env";

// rescue-2 T37 (D4): real warm_homepage_cache step.
//
// T37.AC2 (behavioral) — with a fake KV bound as env.CACHE and
// SITE_PROVISIONING_DRY_RUN='false', the step fetches the homepage from
// the site's own origin and puts the body under the canonical
// htmlKey(site_id, "/", content_version) — the exact key the public
// router looks up. Dry-run (the env default) performs ZERO outbound
// fetches and ZERO KV puts (negative_fail_condition: no outbound HTTP
// to api.cloudflare.com — we forbid ALL outbound HTTP under dry-run).

interface KvPut {
  key: string;
  value: string;
  options?: { expirationTtl?: number; metadata?: { etag?: string } };
}

function makeFakeKv(): { kv: KVNamespace; puts: KvPut[] } {
  const puts: KvPut[] = [];
  const kv = {
    async put(key: string, value: string, options?: KvPut["options"]) {
      puts.push({ key, value, options });
    },
    async get() {
      return null;
    },
    async getWithMetadata() {
      return { value: null, metadata: null };
    },
    async delete() {},
    async list() {
      return { keys: [], list_complete: true, cursor: "" };
    },
  } as unknown as KVNamespace;
  return { kv, puts };
}

// Mini D1 fake: only the three SELECT shapes the warm step issues are
// modelled (loadSiteInfo, the content_version read, and
// resolveSiteHostname's domains lookup).
function makeFakeDb(site: {
  site_id: string;
  domain: string;
  content_version: number;
}): D1Database {
  return {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...binds: unknown[]) {
          captured = binds;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          void captured;
          if (
            sql.indexOf("SELECT content_version FROM sites WHERE id = ?") >= 0
          ) {
            return ({
              content_version: site.content_version,
            } as unknown) as T;
          }
          if (sql.indexOf("vertical_slug FROM sites WHERE id = ?") >= 0) {
            return ({
              id: site.site_id,
              name: "Warm Site",
              domain: site.domain,
              vertical_slug: "general",
            } as unknown) as T;
          }
          if (sql.indexOf("FROM domains WHERE site_id = ?") >= 0) {
            return ({ hostname: site.domain } as unknown) as T;
          }
          return null;
        },
        async run() {
          return { success: true, meta: {} };
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function buildEnv(
  db: D1Database,
  kv: KVNamespace,
  overrides: Partial<Env> = {},
): Env {
  return {
    DB: db,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "gpt-5.5",
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    DEV_BYPASS_AUTH: "true",
    ...overrides,
  };
}

function makeCtx(env: Env, db: D1Database, site_id: string): StepContext {
  return { env, db, job_id: "job_warm", site_id, step_order: 13 };
}

const HOME_BODY = "<html><body>warm home</body></html>";

describe("warm_homepage_cache step (T37)", () => {
  let fetchCalls: string[];
  let originalFetch: typeof globalThis.fetch;
  let homepageHttpStatus: number;

  beforeEach(() => {
    fetchCalls = [];
    homepageHttpStatus = 200;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      fetchCalls.push(url);
      if (url.indexOf("api.cloudflare.com") >= 0) {
        throw new Error(`outbound api.cloudflare.com fetch from warm step: ${url}`);
      }
      if (url.endsWith("/sitemap.xml")) {
        return new Response("<urlset/>", { status: 200 });
      }
      if (url.endsWith("/feed.xml")) {
        return new Response("<rss/>", { status: 200 });
      }
      if (url.endsWith("/atom.xml")) {
        return new Response("<feed/>", { status: 200 });
      }
      return new Response(HOME_BODY, { status: homepageHttpStatus });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // T37.AC2 — fake KV: htmlKey put with the correct key.
  it("live mode puts the homepage body under htmlKey(site_id, '/', content_version)", async () => {
    const { kv, puts } = makeFakeKv();
    const db = makeFakeDb({
      site_id: "st_warm",
      domain: "warm.example.test",
      content_version: 7,
    });
    const env = buildEnv(db, kv, { SITE_PROVISIONING_DRY_RUN: "false" });

    const result = await STEPS.warm_homepage_cache(makeCtx(env, db, "st_warm"));

    expect(result.status).toBe("completed");
    const expectedKey = htmlKey("st_warm", "/", 7);
    const homePut = puts.find((p) => p.key === expectedKey);
    expect(homePut).toBeDefined();
    expect(homePut?.value).toBe(HOME_BODY);
    // Homepage body is stored with a strong ETag + the env-derived TTL.
    expect(homePut?.options?.metadata?.etag).toMatch(/^".+"$/);
    expect(homePut?.options?.expirationTtl).toBe(60);

    // All four canonical targets were warmed under cache-keys.ts keys.
    expect(puts.map((p) => p.key).sort()).toEqual(
      [
        htmlKey("st_warm", "/", 7),
        sitemapKey("st_warm", 7),
        feedRssKey("st_warm", 7),
        feedAtomKey("st_warm", 7),
      ].sort(),
    );

    // Receipt output names the homepage key it warmed.
    const parsed = JSON.parse(result.output) as {
      step: string;
      dry_run: boolean;
      warmed: number;
      homepage_cache_key: string;
      homepage_status: string;
    };
    expect(parsed.step).toBe("warm_homepage_cache");
    expect(parsed.dry_run).toBe(false);
    expect(parsed.warmed).toBe(4);
    expect(parsed.homepage_cache_key).toBe(expectedKey);
    expect(parsed.homepage_status).toBe("warmed");

    // Only the site's own origin was fetched — never api.cloudflare.com.
    expect(fetchCalls.length).toBe(4);
    for (const url of fetchCalls) {
      expect(url.startsWith("https://warm.example.test/")).toBe(true);
    }
  });

  it("dry-run (env default) performs zero outbound fetches and zero KV puts", async () => {
    const { kv, puts } = makeFakeKv();
    const db = makeFakeDb({
      site_id: "st_warm_dry",
      domain: "warm-dry.example.test",
      content_version: 3,
    });
    const env = buildEnv(db, kv);

    const result = await STEPS.warm_homepage_cache(
      makeCtx(env, db, "st_warm_dry"),
    );

    expect(result.status).toBe("completed_dry_run");
    expect(puts).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
    const parsed = JSON.parse(result.output) as {
      dry_run: boolean;
      warmed: number;
      homepage_cache_key: string;
    };
    expect(parsed.dry_run).toBe(true);
    expect(parsed.warmed).toBe(0);
    // The receipt still names the key a live run would warm.
    expect(parsed.homepage_cache_key).toBe(htmlKey("st_warm_dry", "/", 3));
  });

  it("live mode fails the step when the homepage target cannot be warmed", async () => {
    homepageHttpStatus = 500;
    const { kv, puts } = makeFakeKv();
    const db = makeFakeDb({
      site_id: "st_warm_err",
      domain: "warm-err.example.test",
      content_version: 2,
    });
    const env = buildEnv(db, kv, { SITE_PROVISIONING_DRY_RUN: "false" });

    const result = await STEPS.warm_homepage_cache(
      makeCtx(env, db, "st_warm_err"),
    );

    expect(result.status).toBe("failed");
    expect(result.error).toContain("homepage warm");
    // The homepage body was NOT cached under its key.
    expect(
      puts.find((p) => p.key === htmlKey("st_warm_err", "/", 2)),
    ).toBeUndefined();
  });
});
