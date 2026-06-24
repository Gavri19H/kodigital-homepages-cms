// T17 — admin settings mutations bump sites.settings_version and
// invalidate the per-site settings-update cache surface.
//
// Verifies:
//   (a) UPDATE sites SET settings_version = settings_version + 1 fires
//       with the affected site_id as the only bind arg (T17-AC1).
//   (b) The wipe touches the settings / robots / ads namespaces scoped
//       to the site_id and leaves other tenants' keys untouched
//       (T17-AC2, per src/cache/invalidate.ts SETTINGS_UPDATE_PREFIXES).
//   (c) rescue-4 round-5: rendered-HTML namespaces (html / article / page /
//       category) ARE wiped on a settings update — the rendered layout embeds
//       settings (ads, brand tokens, logo, custom head/footer, social, SEO),
//       so leaving them cached served stale HTML until content_version bumped
//       / the TTL expired (the propagation lag). Pure DATA/XML namespaces
//       (homepage-data / sitemap / feed) are settings-independent and survive.
//       content_version is still NOT bumped (the wipe is the mechanism).
//   (d) An empty / whitespace site_id is rejected before any D1 write.
//
// SQL bindings use prepare(...).bind(...) only (no template-literal SQL).
// The fake D1 inspects sql + bindArgs so the test is brittle to drift.

import { describe, it, expect } from "vitest";
import { applySettingsMutationCacheInvalidation } from "../src/admin/settings";
import type { Env } from "../src/env";

interface RecordedCall {
  sql: string;
  bindArgs: unknown[];
}

function makeFakeDb() {
  const calls: RecordedCall[] = [];
  const db = {
    prepare(sql: string) {
      const call: RecordedCall = { sql, bindArgs: [] };
      calls.push(call);
      const stmt = {
        bind(...args: unknown[]) {
          call.bindArgs = args;
          return stmt;
        },
        async run() {
          return { success: true, meta: {} };
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, calls };
}

function makeKv() {
  const store = new Map<string, string>();
  const deletes: string[] = [];
  const kv = {
    async get(k: string) {
      return store.has(k) ? store.get(k)! : null;
    },
    async put(k: string, v: string) {
      store.set(k, v);
    },
    async delete(k: string) {
      deletes.push(k);
      store.delete(k);
    },
    async list(o?: { prefix?: string; cursor?: string }) {
      const prefix = o?.prefix ?? "";
      const cursor = o?.cursor ?? "";
      const all = [...store.keys()]
        .filter((k) => k.startsWith(prefix) && k > cursor)
        .sort();
      return {
        keys: all.map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
    async getWithMetadata() {
      return { value: null, metadata: null, cacheStatus: null };
    },
  } as unknown as KVNamespace;
  return { kv, store, deletes };
}

function buildEnv(db: D1Database, kv: KVNamespace): Env {
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
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  };
}

describe("applySettingsMutationCacheInvalidation: bumps sites.settings_version (T17-AC1)", () => {
  it("issues UPDATE sites SET settings_version = settings_version + 1 keyed by site_id", async () => {
    const { db, calls } = makeFakeDb();
    const { kv } = makeKv();

    await applySettingsMutationCacheInvalidation(buildEnv(db, kv), "st_abc");

    const bump = calls.find((c) =>
      c.sql.startsWith(
        "UPDATE sites SET settings_version = settings_version + 1",
      ),
    );
    expect(
      bump,
      "applySettingsMutationCacheInvalidation did not bump sites.settings_version",
    ).toBeDefined();
    expect(bump!.sql).toBe(
      "UPDATE sites SET settings_version = settings_version + 1 WHERE id = ?",
    );
    expect(bump!.bindArgs).toEqual(["st_abc"]);
  });

  it("uses prepare(...).bind(...) with one positional ? for the sites UPDATE", async () => {
    const { db, calls } = makeFakeDb();
    const { kv } = makeKv();

    await applySettingsMutationCacheInvalidation(buildEnv(db, kv), "st_xyz");

    const bump = calls.find((c) =>
      c.sql.startsWith(
        "UPDATE sites SET settings_version = settings_version + 1",
      ),
    );
    expect(bump).toBeDefined();
    expect(bump!.sql).not.toContain("${");
    expect(bump!.sql).not.toContain("' ||");
    expect(bump!.bindArgs).toHaveLength(1);
    expect(bump!.bindArgs[0]).toBe("st_xyz");
  });

  it("does NOT bump content_version (settings live on a separate version axis)", async () => {
    const { db, calls } = makeFakeDb();
    const { kv } = makeKv();

    await applySettingsMutationCacheInvalidation(buildEnv(db, kv), "st_abc");

    const contentBump = calls.find((c) =>
      c.sql.includes(
        "UPDATE sites SET content_version = content_version + 1",
      ),
    );
    expect(
      contentBump,
      "settings update MUST NOT touch sites.content_version",
    ).toBeUndefined();
  });
});

describe("applySettingsMutationCacheInvalidation: invalidates per-site settings surface (T17-AC2)", () => {
  it("wipes settings / robots / ads keys for the site and leaves other tenants alone", async () => {
    const { db } = makeFakeDb();
    const { kv, store, deletes } = makeKv();

    // Per-site settings-update surface for st_abc.
    store.set("settings:st_abc:7", "{}");
    store.set("robots:st_abc:7", "User-agent: *\nAllow: /");
    store.set("ads:st_abc:7", "google.com, pub-xxx, DIRECT, f08c47fec0942fa0");

    // Other-tenant decoys — MUST survive.
    store.set("settings:st_other:7", "{}");
    store.set("robots:st_other:7", "User-agent: *\nAllow: /");
    store.set("ads:st_other:7", "google.com, pub-yyy, DIRECT, f08c47fec0942fa0");

    await applySettingsMutationCacheInvalidation(buildEnv(db, kv), "st_abc");

    expect(deletes).toContain("settings:st_abc:7");
    expect(deletes).toContain("robots:st_abc:7");
    expect(deletes).toContain("ads:st_abc:7");

    expect(store.has("settings:st_other:7")).toBe(true);
    expect(store.has("robots:st_other:7")).toBe(true);
    expect(store.has("ads:st_other:7")).toBe(true);
    expect(deletes).not.toContain("settings:st_other:7");
    expect(deletes).not.toContain("robots:st_other:7");
    expect(deletes).not.toContain("ads:st_other:7");
  });

  it("wipes rendered-HTML namespaces (html / article / page / category — they embed settings) and leaves DATA/XML (homepage-data / sitemap / feed) intact for the SAME tenant", async () => {
    const { db } = makeFakeDb();
    const { kv, store, deletes } = makeKv();

    // Settings surface for st_abc — should all be deleted.
    store.set("settings:st_abc:7", "{}");
    store.set("robots:st_abc:7", "User-agent: *");
    store.set("ads:st_abc:7", "google.com, pub-xxx, DIRECT");

    // Rendered-HTML surface (embeds settings) — MUST be wiped on a settings
    // change. Pure DATA/XML is settings-independent and MUST survive.
    store.set("html:st_abc:/article/hello:5:1", "<html/>");
    store.set("article:st_abc:hello:5:1", "<html/>");
    store.set("page:st_abc:about:5:1", "<html/>");
    store.set("category:st_abc:news:1:5:1", "<html/>");
    store.set("homepage-data:st_abc:5", "{}");
    store.set("sitemap:st_abc:5", "<urlset/>");
    store.set("feed:rss:st_abc:5", "<rss/>");
    store.set("feed:atom:st_abc:5", "<feed/>");

    await applySettingsMutationCacheInvalidation(buildEnv(db, kv), "st_abc");

    // Settings keys gone.
    expect(deletes).toContain("settings:st_abc:7");
    expect(deletes).toContain("robots:st_abc:7");
    expect(deletes).toContain("ads:st_abc:7");

    // rescue-4 round-5: rendered-HTML keys are now WIPED too (the layout embeds
    // settings — ads, brand tokens, logo, custom head/footer, social, SEO).
    expect(deletes).toContain("html:st_abc:/article/hello:5:1");
    expect(deletes).toContain("article:st_abc:hello:5:1");
    expect(deletes).toContain("page:st_abc:about:5:1");
    expect(deletes).toContain("category:st_abc:news:1:5:1");
    expect(store.has("html:st_abc:/article/hello:5:1")).toBe(false);
    expect(store.has("category:st_abc:news:1:5:1")).toBe(false);

    // Pure DATA/XML caches are settings-independent and MUST survive.
    expect(store.has("homepage-data:st_abc:5")).toBe(true);
    expect(store.has("sitemap:st_abc:5")).toBe(true);
    expect(store.has("feed:rss:st_abc:5")).toBe(true);
    expect(store.has("feed:atom:st_abc:5")).toBe(true);
    expect(deletes).not.toContain("homepage-data:st_abc:5");
    expect(deletes).not.toContain("sitemap:st_abc:5");
    expect(deletes).not.toContain("feed:rss:st_abc:5");
    expect(deletes).not.toContain("feed:atom:st_abc:5");
  });
});

describe("applySettingsMutationCacheInvalidation: site_id validation", () => {
  it("rejects empty / whitespace site_id before any D1 write", async () => {
    const { db, calls } = makeFakeDb();
    const { kv } = makeKv();

    await expect(
      applySettingsMutationCacheInvalidation(buildEnv(db, kv), "   "),
    ).rejects.toThrow(/site_id/);
    expect(calls).toHaveLength(0);
  });

  it("rejects null/undefined site_id before any D1 write", async () => {
    const { db, calls } = makeFakeDb();
    const { kv } = makeKv();

    await expect(
      applySettingsMutationCacheInvalidation(
        buildEnv(db, kv),
        null as unknown as string,
      ),
    ).rejects.toThrow(/site_id/);
    expect(calls).toHaveLength(0);
  });
});
