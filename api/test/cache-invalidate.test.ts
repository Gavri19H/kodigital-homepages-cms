import { describe, expect, it } from "vitest";
import {
  invalidateForArticlePublish,
  invalidateForCategoryUpdate,
  invalidateForPageUpdate,
  invalidateForSettingsUpdate,
} from "../src/cache/invalidate";
import type { Env } from "../src/env";

type Slot = { body: string; metadata?: unknown };

interface BuiltEnv {
  env: Env;
  store: Map<string, Slot>;
}

function buildEnv(): BuiltEnv {
  const store = new Map<string, Slot>();
  const kv = {
    async get(k: string) {
      return store.get(k)?.body ?? null;
    },
    async put(k: string, v: string, opts?: KVNamespacePutOptions) {
      store.set(k, { body: v, metadata: opts?.metadata });
    },
    async delete(k: string) {
      store.delete(k);
    },
    async list(opts?: { prefix?: string; cursor?: string }) {
      const prefix = opts?.prefix ?? "";
      const allKeys = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .sort();
      return {
        keys: allKeys.map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
    async getWithMetadata(k: string) {
      const e = store.get(k);
      return e
        ? { value: e.body, metadata: e.metadata, cacheStatus: null }
        : { value: null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace;

  const env: Env = {
    DB: {} as D1Database,
    CACHE: kv,
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST: "localhost",
    ADMIN_BASE_URL: "http://localhost:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  };
  return { env, store };
}

function seedSite(
  store: Map<string, Slot>,
  siteId: string,
  namespaces: string[],
): string[] {
  const seeded: string[] = [];
  for (const ns of namespaces) {
    const k = `${ns}${siteId}:demo:1:1`;
    store.set(k, { body: "x" });
    seeded.push(k);
  }
  return seeded;
}

describe("invalidateForArticlePublish", () => {
  it("deletes only the publishing site's html/article/homepage/category/page/sitemap/feed keys", async () => {
    const { env, store } = buildEnv();
    seedSite(store, "site_A", [
      "html:",
      "article:",
      "homepage-data:",
      "category:",
      "page:",
      "sitemap:",
      "feed:rss:",
      "feed:atom:",
    ]);
    const otherSiteKey = "html:site_B:demo:1:1";
    store.set(otherSiteKey, { body: "x" });
    const settingsKey = "settings:site_A:1";
    store.set(settingsKey, { body: "x" });

    const deleted = await invalidateForArticlePublish(env, "site_A");

    expect(deleted).toBe(8);
    expect(Array.from(store.keys()).filter((k) => k.includes("site_A:")).length).toBe(1);
    expect(store.has(settingsKey)).toBe(true);
    expect(store.has(otherSiteKey)).toBe(true);
  });

  it("returns 0 when no keys exist for the site", async () => {
    const { env } = buildEnv();
    const deleted = await invalidateForArticlePublish(env, "site_empty");
    expect(deleted).toBe(0);
  });

  it("rejects empty site_id with a RED-LINE error", async () => {
    const { env } = buildEnv();
    await expect(invalidateForArticlePublish(env, "")).rejects.toThrow(
      /site_id/,
    );
    await expect(invalidateForArticlePublish(env, "   ")).rejects.toThrow(
      /site_id/,
    );
  });
});

describe("invalidateForPageUpdate", () => {
  it("deletes html + page + homepage-data only; leaves article/category/sitemap/feed/settings alone", async () => {
    const { env, store } = buildEnv();
    seedSite(store, "site_A", [
      "html:",
      "page:",
      "homepage-data:",
      "article:",
      "category:",
      "sitemap:",
      "feed:rss:",
      "feed:atom:",
      "settings:",
      "robots:",
      "ads:",
    ]);

    const deleted = await invalidateForPageUpdate(env, "site_A");

    expect(deleted).toBe(3);
    expect(store.has("article:site_A:demo:1:1")).toBe(true);
    expect(store.has("category:site_A:demo:1:1")).toBe(true);
    expect(store.has("sitemap:site_A:demo:1:1")).toBe(true);
    expect(store.has("feed:rss:site_A:demo:1:1")).toBe(true);
    expect(store.has("feed:atom:site_A:demo:1:1")).toBe(true);
    expect(store.has("settings:site_A:demo:1:1")).toBe(true);
    expect(store.has("robots:site_A:demo:1:1")).toBe(true);
    expect(store.has("ads:site_A:demo:1:1")).toBe(true);
    expect(store.has("html:site_A:demo:1:1")).toBe(false);
    expect(store.has("page:site_A:demo:1:1")).toBe(false);
    expect(store.has("homepage-data:site_A:demo:1:1")).toBe(false);
  });
});

describe("invalidateForCategoryUpdate", () => {
  it("deletes html + category + homepage-data + sitemap + feeds only; leaves page/settings alone", async () => {
    const { env, store } = buildEnv();
    seedSite(store, "site_A", [
      "html:",
      "category:",
      "homepage-data:",
      "sitemap:",
      "feed:rss:",
      "feed:atom:",
      "page:",
      "settings:",
    ]);

    const deleted = await invalidateForCategoryUpdate(env, "site_A");

    expect(deleted).toBe(6);
    expect(store.has("page:site_A:demo:1:1")).toBe(true);
    expect(store.has("settings:site_A:demo:1:1")).toBe(true);
    expect(store.has("html:site_A:demo:1:1")).toBe(false);
    expect(store.has("category:site_A:demo:1:1")).toBe(false);
    expect(store.has("sitemap:site_A:demo:1:1")).toBe(false);
    expect(store.has("feed:rss:site_A:demo:1:1")).toBe(false);
    expect(store.has("feed:atom:site_A:demo:1:1")).toBe(false);
  });
});

describe("invalidateForSettingsUpdate", () => {
  it("deletes settings + robots + ads + rendered-HTML (html/article/page/category); leaves DATA/XML intact", async () => {
    const { env, store } = buildEnv();
    seedSite(store, "site_A", [
      "settings:",
      "robots:",
      "ads:",
      "html:",
      "article:",
      "category:",
      "page:",
      "homepage-data:",
      "sitemap:",
      "feed:rss:",
      "feed:atom:",
    ]);

    const deleted = await invalidateForSettingsUpdate(env, "site_A");

    // rescue-4 round-5: settings updates also wipe the rendered-HTML surface
    // (the layout embeds settings — ads, brand tokens, logo, custom head/footer,
    // social, SEO), so settings/robots/ads + html/article/page/category = 7.
    expect(deleted).toBe(7);
    expect(store.has("settings:site_A:demo:1:1")).toBe(false);
    expect(store.has("robots:site_A:demo:1:1")).toBe(false);
    expect(store.has("ads:site_A:demo:1:1")).toBe(false);
    expect(store.has("html:site_A:demo:1:1")).toBe(false);
    expect(store.has("article:site_A:demo:1:1")).toBe(false);
    expect(store.has("category:site_A:demo:1:1")).toBe(false);
    expect(store.has("page:site_A:demo:1:1")).toBe(false);
    // Pure DATA/XML caches are settings-independent and survive.
    expect(store.has("homepage-data:site_A:demo:1:1")).toBe(true);
    expect(store.has("sitemap:site_A:demo:1:1")).toBe(true);
    expect(store.has("feed:rss:site_A:demo:1:1")).toBe(true);
    expect(store.has("feed:atom:site_A:demo:1:1")).toBe(true);
  });

  it("scopes by site_id so a sibling site's settings stay alive", async () => {
    const { env, store } = buildEnv();
    seedSite(store, "site_A", ["settings:", "robots:", "ads:"]);
    seedSite(store, "site_B", ["settings:", "robots:", "ads:"]);

    const deleted = await invalidateForSettingsUpdate(env, "site_A");

    expect(deleted).toBe(3);
    expect(store.has("settings:site_B:demo:1:1")).toBe(true);
    expect(store.has("robots:site_B:demo:1:1")).toBe(true);
    expect(store.has("ads:site_B:demo:1:1")).toBe(true);
  });
});
