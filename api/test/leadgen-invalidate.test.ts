// LeadGen §28 — per-site funnel cache invalidation unit tests (the
// cache-invalidate.test.ts mock-KV pattern). Proves:
//   * invalidateOnQuoteActivation deletes ONLY the target site's lg-shell:/
//     lg-config: keys — a sibling tenant survives (NO cross-tenant bleed);
//   * invalidateOnVariantPublish narrows to ONE funnel within ONE site — the
//     other funnel on the same site AND the same funnel on another site survive;
//   * an empty/blank site_id is REFUSED (the global-wipe / cross-tenant guard);
//   * a KV list/delete hiccup is CONTAINED (fail-open — never throws);
//   * the cursor/list_complete pagination loop drains every page.

import { describe, expect, it } from "vitest";
import {
  invalidateOnQuoteActivation,
  invalidateOnVariantPublish,
} from "../src/public/leadgen/invalidate";
import type { Env } from "../src/env";

type Slot = { body: string };

interface KvBehavior {
  listThrows?: boolean;
  deleteThrows?: boolean;
  pageSize?: number; // when set, list() paginates via a numeric cursor
}

interface BuiltEnv {
  env: Env;
  store: Map<string, Slot>;
  deletes: string[];
}

function buildEnv(behavior: KvBehavior = {}): BuiltEnv {
  const store = new Map<string, Slot>();
  const deletes: string[] = [];
  const kv = {
    async get(k: string): Promise<string | null> {
      return store.get(k)?.body ?? null;
    },
    async put(k: string, v: string): Promise<void> {
      store.set(k, { body: v });
    },
    async delete(k: string): Promise<void> {
      if (behavior.deleteThrows === true) throw new Error("kv delete boom");
      deletes.push(k);
      store.delete(k);
    },
    async list(opts?: { prefix?: string; cursor?: string }): Promise<unknown> {
      if (behavior.listThrows === true) throw new Error("kv list boom");
      const prefix = opts?.prefix ?? "";
      const matched = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .sort();
      if (behavior.pageSize !== undefined && behavior.pageSize > 0) {
        // Name-based cursor (faithful to real KV: deleting an already-returned
        // earlier key never shifts a later page). `cursor` = the last key name
        // returned so far; each page takes the next keys AFTER it.
        const after = opts?.cursor;
        const remaining = matched.filter((k) => after === undefined || k > after);
        const slice = remaining.slice(0, behavior.pageSize);
        const complete = slice.length >= remaining.length;
        const last = slice.length > 0 ? slice[slice.length - 1] : undefined;
        return {
          keys: slice.map((name) => ({ name })),
          list_complete: complete,
          cursor: complete ? undefined : last,
          cacheStatus: null,
        };
      }
      return { keys: matched.map((name) => ({ name })), list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;

  const env = { CACHE: kv } as unknown as Env;
  return { env, store, deletes };
}

// Realistic keys (cache-keys.ts wire format — the trailing :1 is the §28
// activation_version = leadgen_site_quotes.updated_at):
//   lg-shell:{site}:{slug}:{funnel}:{variant}:{content_version}:{template_version}:{activation_version}
//   lg-config:{site}:{funnel}:{variant}:{content_version}:{ab_rev}:{activation_version}
// The activation_version suffix does not move the per-site prefix or the
// funnel-narrowing segment (index 3), so invalidation is unaffected — asserted here.
function shellKey(site: string, slug: string, funnel: string, variant: string): string {
  return `lg-shell:${site}:${slug}:${funnel}:${variant}:1:1:1`;
}
function configKey(site: string, funnel: string, variant: string): string {
  return `lg-config:${site}:${funnel}:${variant}:1:0:1`;
}

describe("invalidateOnQuoteActivation", () => {
  it("deletes ONLY the target site's lg-shell + lg-config keys (no cross-tenant bleed)", async () => {
    const { env, store } = buildEnv();
    // site_A: one funnel, a named slug + a root (empty-slug) activation.
    store.set(shellKey("site_A", "auto", "lgf_aaa", "lgn_a1"), { body: "x" });
    store.set(shellKey("site_A", "", "lgf_aaa", "lgn_a1"), { body: "x" });
    store.set(configKey("site_A", "lgf_aaa", "lgn_a1"), { body: "x" });
    // site_B (sibling tenant) — MUST survive.
    store.set(shellKey("site_B", "auto", "lgf_bbb", "lgn_b1"), { body: "x" });
    store.set(configKey("site_B", "lgf_bbb", "lgn_b1"), { body: "x" });
    // an unrelated CMS namespace on site_A — MUST survive (not a funnel key).
    store.set("html:site_A:/blog:1:1", { body: "x" });

    const result = await invalidateOnQuoteActivation(env, "site_A");

    expect(result).toEqual({ site_id: "site_A", cache_keys_deleted: 3 });
    // site_A funnel keys gone.
    expect(store.has(shellKey("site_A", "auto", "lgf_aaa", "lgn_a1"))).toBe(false);
    expect(store.has(shellKey("site_A", "", "lgf_aaa", "lgn_a1"))).toBe(false);
    expect(store.has(configKey("site_A", "lgf_aaa", "lgn_a1"))).toBe(false);
    // sibling tenant + non-funnel namespace survive.
    expect(store.has(shellKey("site_B", "auto", "lgf_bbb", "lgn_b1"))).toBe(true);
    expect(store.has(configKey("site_B", "lgf_bbb", "lgn_b1"))).toBe(true);
    expect(store.has("html:site_A:/blog:1:1")).toBe(true);
  });

  it("does NOT wipe a site whose id is a prefix of another (site_1 vs site_10)", async () => {
    const { env, store } = buildEnv();
    store.set(shellKey("site_1", "auto", "lgf_aaa", "lgn_a1"), { body: "x" });
    store.set(shellKey("site_10", "auto", "lgf_zzz", "lgn_z1"), { body: "x" });

    const result = await invalidateOnQuoteActivation(env, "site_1");

    // the ':' delimiter after site_id means "lg-shell:site_1:" never matches
    // "lg-shell:site_10:".
    expect(result.cache_keys_deleted).toBe(1);
    expect(store.has(shellKey("site_1", "auto", "lgf_aaa", "lgn_a1"))).toBe(false);
    expect(store.has(shellKey("site_10", "auto", "lgf_zzz", "lgn_z1"))).toBe(true);
  });

  it("returns 0 when the site has no funnel keys", async () => {
    const { env } = buildEnv();
    const result = await invalidateOnQuoteActivation(env, "site_empty");
    expect(result.cache_keys_deleted).toBe(0);
  });

  it("REFUSES an empty/blank site_id (global-wipe guard)", async () => {
    const { env } = buildEnv();
    await expect(invalidateOnQuoteActivation(env, "")).rejects.toThrow(/site_id/);
    await expect(invalidateOnQuoteActivation(env, "   ")).rejects.toThrow(/site_id/);
  });

  it("is CONTAINED (fail-open) when KV list() throws", async () => {
    const { env } = buildEnv({ listThrows: true });
    await expect(invalidateOnQuoteActivation(env, "site_A")).resolves.toEqual({
      site_id: "site_A",
      cache_keys_deleted: 0,
    });
  });

  it("is CONTAINED (fail-open) when KV delete() throws — keys survive, no throw", async () => {
    const { env, store } = buildEnv({ deleteThrows: true });
    store.set(shellKey("site_A", "auto", "lgf_aaa", "lgn_a1"), { body: "x" });
    await expect(invalidateOnQuoteActivation(env, "site_A")).resolves.toEqual({
      site_id: "site_A",
      cache_keys_deleted: 0,
    });
    expect(store.has(shellKey("site_A", "auto", "lgf_aaa", "lgn_a1"))).toBe(true);
  });

  it("drains every page of a paginated list (cursor / list_complete loop)", async () => {
    const { env, store, deletes } = buildEnv({ pageSize: 1 });
    store.set(shellKey("site_A", "auto", "lgf_aaa", "lgn_a1"), { body: "x" });
    store.set(shellKey("site_A", "auto", "lgf_aaa", "lgn_a2"), { body: "x" });
    store.set(configKey("site_A", "lgf_aaa", "lgn_a1"), { body: "x" });

    const result = await invalidateOnQuoteActivation(env, "site_A");

    expect(result.cache_keys_deleted).toBe(3);
    expect(deletes.length).toBe(3);
    expect(store.size).toBe(0);
  });
});

describe("invalidateOnVariantPublish", () => {
  it("narrows to ONE funnel within ONE site — other funnel + other site survive", async () => {
    const { env, store } = buildEnv();
    // target: site_A / lgf_aaa (a named slug + a root activation + its config).
    store.set(shellKey("site_A", "auto", "lgf_aaa", "lgn_a1"), { body: "x" });
    store.set(shellKey("site_A", "", "lgf_aaa", "lgn_a2"), { body: "x" });
    store.set(configKey("site_A", "lgf_aaa", "lgn_a1"), { body: "x" });
    // same site, DIFFERENT funnel — MUST survive.
    store.set(shellKey("site_A", "home", "lgf_bbb", "lgn_b1"), { body: "x" });
    store.set(configKey("site_A", "lgf_bbb", "lgn_b1"), { body: "x" });
    // DIFFERENT site, same funnel id — MUST survive (site-scoped).
    store.set(shellKey("site_B", "auto", "lgf_aaa", "lgn_a1"), { body: "x" });
    store.set(configKey("site_B", "lgf_aaa", "lgn_a1"), { body: "x" });

    const result = await invalidateOnVariantPublish(env, "site_A", "lgf_aaa");

    expect(result).toEqual({ site_id: "site_A", cache_keys_deleted: 3 });
    expect(store.has(shellKey("site_A", "auto", "lgf_aaa", "lgn_a1"))).toBe(false);
    expect(store.has(shellKey("site_A", "", "lgf_aaa", "lgn_a2"))).toBe(false);
    expect(store.has(configKey("site_A", "lgf_aaa", "lgn_a1"))).toBe(false);
    // other funnel (same site) + same funnel (other site) all survive.
    expect(store.has(shellKey("site_A", "home", "lgf_bbb", "lgn_b1"))).toBe(true);
    expect(store.has(configKey("site_A", "lgf_bbb", "lgn_b1"))).toBe(true);
    expect(store.has(shellKey("site_B", "auto", "lgf_aaa", "lgn_a1"))).toBe(true);
    expect(store.has(configKey("site_B", "lgf_aaa", "lgn_a1"))).toBe(true);
  });

  it("REFUSES an empty/blank site_id (global-wipe guard)", async () => {
    const { env } = buildEnv();
    await expect(invalidateOnVariantPublish(env, "", "lgf_aaa")).rejects.toThrow(/site_id/);
    await expect(invalidateOnVariantPublish(env, "  ", "lgf_aaa")).rejects.toThrow(/site_id/);
  });

  it("an empty funnel_id narrows to NOTHING (safe no-op, never a wider wipe)", async () => {
    const { env, store } = buildEnv();
    store.set(shellKey("site_A", "auto", "lgf_aaa", "lgn_a1"), { body: "x" });
    store.set(configKey("site_A", "lgf_aaa", "lgn_a1"), { body: "x" });

    const result = await invalidateOnVariantPublish(env, "site_A", "");

    expect(result.cache_keys_deleted).toBe(0);
    expect(store.size).toBe(2);
  });

  it("is CONTAINED (fail-open) when KV throws", async () => {
    const { env } = buildEnv({ listThrows: true });
    await expect(invalidateOnVariantPublish(env, "site_A", "lgf_aaa")).resolves.toEqual({
      site_id: "site_A",
      cache_keys_deleted: 0,
    });
  });
});
