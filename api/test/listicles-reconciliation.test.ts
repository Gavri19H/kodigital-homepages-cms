// §31.6 daily reconciliation skeleton — the KV accept counter accumulates
// per site/day, the report sums counters + D1 dead-letter rows for the day,
// athena/CH sides are HONEST NULLs (never fake zeros) pre-Phase-8, and the
// cron entry self-gates to 00:05 UTC.

import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import {
  bumpListicleDailyAcceptCounter,
  buildListicleReconciliationReport,
  listicleDailyReconciliation,
  listicleAcceptCounterKey,
} from "../src/analytics/listicle-reconciliation";

function makeKv(): { kv: KVNamespace; store: Map<string, string> } {
  const store = new Map<string, string>();
  const kv = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list(opts?: { prefix?: string }) {
      const prefix = opts?.prefix ?? "";
      return {
        keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
        cacheStatus: null,
      };
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

function makeDb(deadLetterCount: number): D1Database {
  return {
    prepare(sql: string) {
      const stmt = {
        bind() {
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          if (sql.includes("FROM listicle_event_dead_letter")) {
            return { n: deadLetterCount } as unknown as T;
          }
          return null;
        },
        async all() {
          return { results: [], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function makeEnv(kv: KVNamespace, db: D1Database): Env {
  return { DB: db, CACHE: kv } as unknown as Env;
}

describe("daily accept counter", () => {
  it("accumulates per (date, site) and tolerates missing/garbage values", async () => {
    const { kv, store } = makeKv();
    const env = makeEnv(kv, makeDb(0));
    const at = new Date("2026-07-02T10:00:00Z");
    await bumpListicleDailyAcceptCounter(env, "st_1", 2, at);
    await bumpListicleDailyAcceptCounter(env, "st_1", 3, at);
    await bumpListicleDailyAcceptCounter(env, "", 1, at); // unknown site bucket
    expect(store.get(listicleAcceptCounterKey("2026-07-02", "st_1"))).toBe("5");
    expect(store.get(listicleAcceptCounterKey("2026-07-02", "unknown"))).toBe("1");
    store.set(listicleAcceptCounterKey("2026-07-02", "st_1"), "garbage");
    await bumpListicleDailyAcceptCounter(env, "st_1", 4, at);
    expect(store.get(listicleAcceptCounterKey("2026-07-02", "st_1"))).toBe("4");
  });

  it("a throwing KV never breaks the caller (best-effort)", async () => {
    const env = makeEnv(
      {
        async get() {
          throw new Error("kv down");
        },
        async put() {
          throw new Error("kv down");
        },
      } as unknown as KVNamespace,
      makeDb(0),
    );
    await expect(
      bumpListicleDailyAcceptCounter(env, "st_1", 1, new Date()),
    ).resolves.toBeUndefined();
  });
});

describe("reconciliation report", () => {
  it("sums accepted per site + dead-letter rows; athena/CH are HONEST nulls with reasons", async () => {
    const { kv, store } = makeKv();
    store.set(listicleAcceptCounterKey("2026-07-01", "st_1"), "10");
    store.set(listicleAcceptCounterKey("2026-07-01", "st_2"), "4");
    store.set(listicleAcceptCounterKey("2026-07-02", "st_1"), "99"); // other day — excluded
    const env = makeEnv(kv, makeDb(3));
    const report = await buildListicleReconciliationReport(env, "2026-07-01");
    expect(report.accepted_by_site).toEqual({ st_1: 10, st_2: 4 });
    expect(report.accepted_total).toBe(14);
    expect(report.dead_letter_rows).toBe(3);
    expect(report.athena_landed).toBeNull();
    expect(report.ch_ingested).toBeNull();
    expect(report.null_reasons.athena_landed).toContain("Phase 8");
    expect(report.variance).toBe("UNMEASURABLE_PRE_PHASE8");
  });
});

describe("cron gating (00:05 UTC, once per day)", () => {
  it("off-window minutes return null without touching KV/D1", async () => {
    const env = makeEnv(makeKv().kv, makeDb(0));
    expect(await listicleDailyReconciliation(env, { now: new Date("2026-07-02T10:07:00Z") })).toBeNull();
    expect(await listicleDailyReconciliation(env, { now: new Date("2026-07-02T00:04:00Z") })).toBeNull();
  });

  it("at 00:05 UTC it reports on YESTERDAY", async () => {
    const { kv, store } = makeKv();
    store.set(listicleAcceptCounterKey("2026-07-01", "st_1"), "7");
    const env = makeEnv(kv, makeDb(1));
    const report = await listicleDailyReconciliation(env, { now: new Date("2026-07-02T00:05:30Z") });
    expect(report?.date).toBe("2026-07-01");
    expect(report?.accepted_total).toBe(7);
    expect(report?.dead_letter_rows).toBe(1);
  });

  it("fail-open: a throwing D1 yields null, never a throw (cron safety)", async () => {
    const env = makeEnv(makeKv().kv, {
      prepare() {
        throw new Error("d1 down");
      },
    } as unknown as D1Database);
    await expect(
      listicleDailyReconciliation(env, { now: new Date("2026-07-02T00:05:00Z") }),
    ).resolves.toBeNull();
  });
});
