import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { STEPS } from "../src/site-provisioning/steps";
import type { StepContext } from "../src/site-provisioning/steps";
import { warmHomepageInProcess } from "../src/cache/warm";
import type { PublicSiteContext } from "../src/public/middleware";
import { htmlKey } from "../src/cache/cache-keys";
import type { Env } from "../src/env";

// rescue-3 T5 (T5-AC1): the warm_homepage_cache step renders the homepage
// IN-PROCESS and stores it via putCachedHtml — it does NOT self-fetch
// https://{host}/ (that subrequest 403s in production, which is exactly
// why step 13 failed and sites stalled in status='draft' while serving;
// user brief BCL-007). These tests pin the new contract:
//   - live mode  : the homepage body is rendered in-process (ZERO outbound
//                  fetch) and put under htmlKey(site_id, "/", content_version)
//                  with a strong ETag + the env-derived TTL; the step is
//                  `completed` and never escalates to FAILED;
//   - dry-run    : ZERO outbound fetch AND ZERO KV put; step is
//                  `completed_dry_run`, receipt still names the key.

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

// Mini D1 fake. Models the SELECT shapes the warm step + the in-process
// home view-model issue: loadSiteInfo, the content_version read,
// resolveSiteHostname's domains lookup, and buildHomeViewModel's three
// `.all()` listing reads (returned EMPTY so the homepage renders the design
// shell with no articles — enough to prove a real in-process render).
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
          // content_version read — checked BEFORE the vertical_slug shape
          // (both contain "FROM sites WHERE id = ?").
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
          // buildHomeViewModel's articles / categories / settings reads.
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

const STUB_HOME_BODY = "<!DOCTYPE html><html><body>stub home</body></html>";

describe("warm_homepage_cache step — in-process render (rescue-3 T5)", () => {
  let fetchCalls: string[];
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    // Any outbound fetch from the warm path is a regression — the old self-
    // fetch is exactly the bug T5-AC1 removes. Record every call so the
    // tests can assert ZERO outbound HTTP.
    globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
      fetchCalls.push(typeof input === "string" ? input : input.toString());
      return new Response("unexpected", { status: 200 });
    }) as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // T5-AC1 (warm contract, injectable renderer): live mode renders the
  // homepage IN-PROCESS and stores the rendered body under htmlKey with a
  // strong ETag + the env TTL, making ZERO outbound fetch.
  it("warmHomepageInProcess (live) puts the in-process-rendered body under htmlKey with a strong ETag + TTL and makes ZERO outbound fetch", async () => {
    const { kv, puts } = makeFakeKv();
    const db = makeFakeDb({
      site_id: "st_warm",
      domain: "warm.example.test",
      content_version: 7,
    });
    const env = buildEnv(db, kv, { SITE_PROVISIONING_DRY_RUN: "false" });

    const received: { siteId: string; hostname: string; version: number } = {
      siteId: "",
      hostname: "",
      version: -1,
    };
    const outcome = await warmHomepageInProcess(env, db, {
      site_id: "st_warm",
      hostname: "warm.example.test",
      vertical_slug: "general",
      content_version: 7,
      expirationTtl: 60,
      renderHomepage: async (_db, ctx: PublicSiteContext) => {
        received.siteId = ctx.siteId;
        received.hostname = ctx.hostname;
        received.version = ctx.content_version;
        return STUB_HOME_BODY;
      },
    });

    expect(outcome.status).toBe("warmed");
    expect(outcome.dry_run).toBe(false);
    expect(outcome.warmed).toBe(1);

    // The renderer was invoked in-process with a tenant-scoped context.
    expect(received.siteId).toBe("st_warm");
    expect(received.hostname).toBe("warm.example.test");
    expect(received.version).toBe(7);

    // The rendered body — NOT a fetched body — is stored under the canonical
    // key with a strong ETag + the supplied TTL.
    const expectedKey = htmlKey("st_warm", "/", 7);
    expect(outcome.cacheKey).toBe(expectedKey);
    const homePut = puts.find((p) => p.key === expectedKey);
    expect(homePut).toBeDefined();
    expect(homePut?.value).toBe(STUB_HOME_BODY);
    expect(homePut?.options?.metadata?.etag).toMatch(/^".+"$/);
    expect(homePut?.options?.expirationTtl).toBe(60);

    // The defining contract: NO outbound self-fetch (the 403 bug is gone).
    expect(fetchCalls).toHaveLength(0);
  });

  // T5-AC1 (dry-run): the provisioning default renders nothing and writes
  // nothing — ZERO outbound fetch, ZERO KV put.
  it("warmHomepageInProcess (dry-run) renders nothing, writes nothing, and makes ZERO outbound fetch", async () => {
    const { kv, puts } = makeFakeKv();
    const db = makeFakeDb({
      site_id: "st_dry",
      domain: "dry.example.test",
      content_version: 3,
    });
    const env = buildEnv(db, kv); // SITE_PROVISIONING_DRY_RUN defaults to true

    let rendered = false;
    const outcome = await warmHomepageInProcess(env, db, {
      site_id: "st_dry",
      hostname: "dry.example.test",
      vertical_slug: "general",
      content_version: 3,
      expirationTtl: 60,
      renderHomepage: async () => {
        rendered = true;
        return STUB_HOME_BODY;
      },
    });

    expect(outcome.status).toBe("dry_run");
    expect(outcome.dry_run).toBe(true);
    expect(outcome.warmed).toBe(0);
    // Receipt still names the key a live run would warm.
    expect(outcome.cacheKey).toBe(htmlKey("st_dry", "/", 3));
    expect(rendered).toBe(false);
    expect(puts).toHaveLength(0);
    expect(fetchCalls).toHaveLength(0);
  });

  // T5-AC1 end-to-end through the real step + the REAL renderHomepageHtml:
  // live mode renders the homepage design shell in-process (the body carries
  // the renderLayout markup — /assets/public.css + a complete </html>
  // document) and stores it under htmlKey, with ZERO outbound fetch. This is
  // the namesake side-effect AC1 asserts. [api/test/site-provisioning-warm-homepage.test.ts]
  it("STEPS.warm_homepage_cache (live) renders the homepage design shell in-process and stores it under htmlKey with ZERO outbound fetch [api/test/site-provisioning-warm-homepage.test.ts]", async () => {
    const { kv, puts } = makeFakeKv();
    const db = makeFakeDb({
      site_id: "st_live",
      domain: "live.example.test",
      content_version: 5,
    });
    const env = buildEnv(db, kv, { SITE_PROVISIONING_DRY_RUN: "false" });

    const result = await STEPS.warm_homepage_cache(makeCtx(env, db, "st_live"));

    expect(result.status).toBe("completed");
    const expectedKey = htmlKey("st_live", "/", 5);
    const homePut = puts.find((p) => p.key === expectedKey);
    expect(homePut).toBeDefined();
    // The stored body is a real rendered design document, not a fetched body.
    expect(homePut?.value).toContain("<!DOCTYPE html>");
    expect(homePut?.value).toContain("/assets/public.css");
    expect(homePut?.value).toContain("</html>");
    expect(homePut?.options?.metadata?.etag).toMatch(/^".+"$/);
    expect(homePut?.options?.expirationTtl).toBe(60);

    const parsed = JSON.parse(result.output) as {
      step: string;
      kind: string;
      dry_run: boolean;
      warmed: number;
      homepage_cache_key: string;
      homepage_status: string;
    };
    expect(parsed.step).toBe("warm_homepage_cache");
    expect(parsed.kind).toBe("in_process_warm");
    expect(parsed.dry_run).toBe(false);
    expect(parsed.warmed).toBe(1);
    expect(parsed.homepage_cache_key).toBe(expectedKey);
    expect(parsed.homepage_status).toBe("warmed");

    // No self-fetch — the entire warm runs inside the Worker.
    expect(fetchCalls).toHaveLength(0);
  });

  // T5-AC1 (dry-run, real step): the env default short-circuits to
  // completed_dry_run with ZERO KV put and ZERO outbound fetch; the receipt
  // still names the homepage key a live run would warm.
  it("STEPS.warm_homepage_cache (dry-run env default) reports completed_dry_run with ZERO put and ZERO outbound fetch [api/test/site-provisioning-warm-homepage.test.ts]", async () => {
    const { kv, puts } = makeFakeKv();
    const db = makeFakeDb({
      site_id: "st_live_dry",
      domain: "live-dry.example.test",
      content_version: 2,
    });
    const env = buildEnv(db, kv);

    const result = await STEPS.warm_homepage_cache(
      makeCtx(env, db, "st_live_dry"),
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
    expect(parsed.homepage_cache_key).toBe(htmlKey("st_live_dry", "/", 2));
  });
});
