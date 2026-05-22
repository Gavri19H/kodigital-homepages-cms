import { describe, it, expect } from "vitest";
import {
  computeEtag,
  getCachedHtml,
  putCachedHtml,
  matchesIfNoneMatch,
} from "../src/cache/edge-cache";
import { TEMPLATE_VERSION } from "../src/cache/cache-keys";
import type { Env } from "../src/env";

// In-memory KV mock that supports get / put / delete / getWithMetadata so
// the edge-cache module (which threads ETag through metadata) can roundtrip
// without a live KVNamespace.
function makeKvMock(): {
  kv: KVNamespace;
  store: Map<string, { body: string; metadata: unknown; ttl?: number }>;
} {
  const store = new Map<string, { body: string; metadata: unknown; ttl?: number }>();
  const kv = {
    async get(key: string) {
      return store.get(key)?.body ?? null;
    },
    async put(key: string, value: string, opts?: KVNamespacePutOptions) {
      store.set(key, { body: value, metadata: opts?.metadata, ttl: opts?.expirationTtl });
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

function buildEnv(overrides: Partial<Env> = {}): {
  env: Env;
  store: Map<string, { body: string; metadata: unknown; ttl?: number }>;
} {
  const { kv, store } = makeKvMock();
  const env: Env = {
    DB: {} as D1Database,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    // RED LINE: tests MUST keep CACHE_API_ENABLED=false so the gate prevents
    // caches.default access — caches.default is undefined in Node and would
    // throw ReferenceError if the gate were ever broken.
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    ...overrides,
  };
  return { env, store };
}

describe("edge-cache: computeEtag", () => {
  it("returns a quoted 16-hex string", async () => {
    const etag = await computeEtag({ site_id: "st_abc", path: "/article/foo", content_version: 5 });
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
  });

  it("is deterministic for identical inputs", async () => {
    const a = await computeEtag({ site_id: "st_abc", path: "/x", content_version: 5 });
    const b = await computeEtag({ site_id: "st_abc", path: "/x", content_version: 5 });
    expect(a).toBe(b);
  });

  it("changes when site_id, path, content_version, or template_version changes", async () => {
    const base = await computeEtag({ site_id: "st_a", path: "/x", content_version: 1 });
    const siteChanged = await computeEtag({ site_id: "st_b", path: "/x", content_version: 1 });
    const pathChanged = await computeEtag({ site_id: "st_a", path: "/y", content_version: 1 });
    const cvChanged = await computeEtag({ site_id: "st_a", path: "/x", content_version: 2 });
    const tvChanged = await computeEtag({
      site_id: "st_a",
      path: "/x",
      content_version: 1,
      template_version: 99,
    });
    expect(siteChanged).not.toBe(base);
    expect(pathChanged).not.toBe(base);
    expect(cvChanged).not.toBe(base);
    expect(tvChanged).not.toBe(base);
  });

  it("defaults template_version to TEMPLATE_VERSION constant", async () => {
    const implicit = await computeEtag({ site_id: "st_a", path: "/x", content_version: 1 });
    const explicit = await computeEtag({
      site_id: "st_a",
      path: "/x",
      content_version: 1,
      template_version: TEMPLATE_VERSION,
    });
    expect(implicit).toBe(explicit);
  });
});

describe("edge-cache: putCachedHtml / getCachedHtml roundtrip (KV path)", () => {
  it("getCachedHtml returns null on miss", async () => {
    const { env } = buildEnv();
    expect(await getCachedHtml(env, "html:st_a:/x:1:1")).toBeNull();
  });

  it("putCachedHtml then getCachedHtml returns body + ETag", async () => {
    const { env } = buildEnv();
    const etag = await computeEtag({ site_id: "st_a", path: "/x", content_version: 1 });
    await putCachedHtml(env, "html:st_a:/x:1:1", "<html>ok</html>", { etag });
    const hit = await getCachedHtml(env, "html:st_a:/x:1:1");
    expect(hit).not.toBeNull();
    expect(hit!.body).toBe("<html>ok</html>");
    expect(hit!.etag).toBe(etag);
  });

  it("putCachedHtml honours expirationTtl when provided", async () => {
    const { env, store } = buildEnv();
    await putCachedHtml(env, "html:st_a:/x:1:1", "<html/>", {
      expirationTtl: 300,
      etag: '"abc1234567890def"',
    });
    expect(store.get("html:st_a:/x:1:1")?.ttl).toBe(300);
  });

  it("putCachedHtml works without an explicit ETag", async () => {
    const { env } = buildEnv();
    await putCachedHtml(env, "html:st_a:/x:1:1", "<html/>");
    const hit = await getCachedHtml(env, "html:st_a:/x:1:1");
    expect(hit).not.toBeNull();
    expect(hit!.body).toBe("<html/>");
    expect(hit!.etag).toBe("");
  });

  it("CACHE_API_ENABLED=false keeps caches.default untouched (gate works)", async () => {
    // If the parseBoolean(env.CACHE_API_ENABLED) gate ever regresses, accessing
    // caches.default in a Node test runtime throws ReferenceError. Both calls
    // below MUST resolve without throwing.
    const { env } = buildEnv({ CACHE_API_ENABLED: "false" });
    await expect(
      putCachedHtml(env, "html:st_a:/x:1:1", "<html/>"),
    ).resolves.toBeUndefined();
    await expect(
      getCachedHtml(env, "html:st_a:/x:1:1"),
    ).resolves.not.toBeNull();
  });
});

describe("edge-cache: matchesIfNoneMatch (304 support)", () => {
  it("returns false when If-None-Match or ETag is empty", () => {
    expect(matchesIfNoneMatch(null, '"abc"')).toBe(false);
    expect(matchesIfNoneMatch(undefined, '"abc"')).toBe(false);
    expect(matchesIfNoneMatch('"abc"', "")).toBe(false);
  });

  it("matches exact strong ETag and '*' wildcard", () => {
    expect(matchesIfNoneMatch('"abc123"', '"abc123"')).toBe(true);
    expect(matchesIfNoneMatch("*", '"abc"')).toBe(true);
  });

  it("returns false on mismatched ETag", () => {
    expect(matchesIfNoneMatch('"abc"', '"xyz"')).toBe(false);
  });

  it("matches a comma-separated If-None-Match list", () => {
    expect(matchesIfNoneMatch('"abc", "def", "ghi"', '"def"')).toBe(true);
  });

  it("tolerates a weak-ETag prefix on the request side", () => {
    expect(matchesIfNoneMatch('W/"abc"', '"abc"')).toBe(true);
  });
});
