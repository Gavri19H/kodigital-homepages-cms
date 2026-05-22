// T16 — admin page mutations bump sites.content_version and invalidate
// the per-site page-update cache surface.
//
// Verifies:
//   (a) UPDATE sites SET content_version = content_version + 1 fires
//       with the affected site_id as the only bind arg (T16-AC1).
//   (b) The wipe touches the html / page / homepage-data namespaces
//       scoped to the site_id and leaves other tenants' keys untouched
//       (T16-AC2, per src/cache/invalidate.ts PAGE_UPDATE_PREFIXES).
//   (c) An empty / whitespace site_id is rejected before any D1 write.
//
// SQL bindings use prepare(...).bind(...) only (no template-literal SQL).
// The fake D1 inspects sql + bindArgs so the test is brittle to drift.

import { describe, it, expect } from "vitest";
import { applyPageMutationCacheInvalidation } from "../src/admin/pages";
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

describe("applyPageMutationCacheInvalidation: bumps sites.content_version (T16-AC1)", () => {
  it("issues UPDATE sites SET content_version = content_version + 1 keyed by site_id", async () => {
    const { db, calls } = makeFakeDb();
    const { kv } = makeKv();

    await applyPageMutationCacheInvalidation(buildEnv(db, kv), "st_abc");

    const bump = calls.find((c) =>
      c.sql.startsWith(
        "UPDATE sites SET content_version = content_version + 1",
      ),
    );
    expect(
      bump,
      "applyPageMutationCacheInvalidation did not bump sites.content_version",
    ).toBeDefined();
    expect(bump!.sql).toBe(
      "UPDATE sites SET content_version = content_version + 1 WHERE id = ?",
    );
    expect(bump!.bindArgs).toEqual(["st_abc"]);
  });

  it("uses prepare(...).bind(...) with one positional ? for the sites UPDATE", async () => {
    const { db, calls } = makeFakeDb();
    const { kv } = makeKv();

    await applyPageMutationCacheInvalidation(buildEnv(db, kv), "st_xyz");

    const bump = calls.find((c) =>
      c.sql.startsWith(
        "UPDATE sites SET content_version = content_version + 1",
      ),
    );
    expect(bump).toBeDefined();
    expect(bump!.sql).not.toContain("${");
    expect(bump!.sql).not.toContain("' ||");
    expect(bump!.bindArgs).toHaveLength(1);
    expect(bump!.bindArgs[0]).toBe("st_xyz");
  });
});

describe("applyPageMutationCacheInvalidation: invalidates per-site page surface (T16-AC2)", () => {
  it("wipes html / page / homepage-data keys for the site and leaves other tenants alone", async () => {
    const { db } = makeFakeDb();
    const { kv, store, deletes } = makeKv();

    // Per-site page-update surface for st_abc.
    store.set("html:st_abc:/page/about:1:1", "<html/>");
    store.set("page:st_abc:about:1:1", "<html/>");
    store.set("homepage-data:st_abc:1", "{}");

    // Other-tenant decoy — MUST survive.
    store.set("html:st_other:/page/about:1:1", "<html/>");
    store.set("page:st_other:about:1:1", "<html/>");
    // Non-page-update namespace for the SAME tenant — MUST also survive
    // because PAGE_UPDATE_PREFIXES only lists html / page / homepage-data.
    store.set("article:st_abc:hello:1:1", "<html/>");

    await applyPageMutationCacheInvalidation(buildEnv(db, kv), "st_abc");

    expect(deletes).toContain("html:st_abc:/page/about:1:1");
    expect(deletes).toContain("page:st_abc:about:1:1");
    expect(deletes).toContain("homepage-data:st_abc:1");

    expect(store.has("html:st_other:/page/about:1:1")).toBe(true);
    expect(store.has("page:st_other:about:1:1")).toBe(true);
    expect(store.has("article:st_abc:hello:1:1")).toBe(true);
    expect(deletes).not.toContain("html:st_other:/page/about:1:1");
    expect(deletes).not.toContain("article:st_abc:hello:1:1");
  });
});

describe("applyPageMutationCacheInvalidation: site_id validation", () => {
  it("rejects empty / whitespace site_id before any D1 write", async () => {
    const { db, calls } = makeFakeDb();
    const { kv } = makeKv();

    await expect(
      applyPageMutationCacheInvalidation(buildEnv(db, kv), "   "),
    ).rejects.toThrow(/site_id/);
    expect(calls).toHaveLength(0);
  });
});
