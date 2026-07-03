// Listicles Phase 7 — /lc click resolver (§7.3 pseudo-code fidelity, §9.3
// caps + fallback + loop guard, §9.4 macro resolution, §16 offer_click,
// §24 fail-safety/no-open-redirect, §31.8 quality gating, §31.9 pv).
//
// Integration over REAL sqlite (node:sqlite) with the REAL 0032/0034
// migrations (cap counters + dead-letter live there), driven through the
// REAL public router (GET /lc/:oid registered pre-middleware) AND through
// resolveDestination directly for the §7.3 branch cases.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";
import {
  resolveDestination,
  safeFallbackUrl,
  isCapReached,
  type LcContext,
} from "../src/public/listicle/resolver";
import type { ListicleEvent } from "../src/analytics/listicle-events";

// --- node:sqlite harness (repo pattern) --------------------------------------

type SqliteStatement = {
  run(...params: unknown[]): unknown;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};
type SqliteDb = {
  prepare(sql: string): SqliteStatement;
  close(): void;
  [method: string]: unknown;
};
type DatabaseSyncCtor = new (path: string) => SqliteDb;

function loadDatabaseSync(): DatabaseSyncCtor | null {
  try {
    const getBuiltin = (process as unknown as {
      getBuiltinModule?: (name: string) => unknown;
    }).getBuiltinModule;
    if (typeof getBuiltin === "function") {
      const mod = getBuiltin("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
      return mod.DatabaseSync;
    }
  } catch {
    /* fall through */
  }
  return null;
}

function runSql(sdb: SqliteDb, sql: string): void {
  (sdb["exec"] as (s: string) => void)(sql);
}

function d1FromSqlite(sdb: SqliteDb): D1Database {
  const db = {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          binds = a;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          const r = sdb.prepare(sql).get(...binds);
          return (r ?? null) as T | null;
        },
        async all<T = unknown>() {
          const rows = sdb.prepare(sql).all(...binds);
          return { results: rows as T[], success: true, meta: {} };
        },
        async run() {
          sdb.prepare(sql).run(...binds);
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return db;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function createDb(DatabaseSync: DatabaseSyncCtor): SqliteDb {
  const sdb = new DatabaseSync(":memory:");
  runSql(
    sdb,
    "CREATE TABLE sites (id TEXT PRIMARY KEY, name TEXT);" +
      "CREATE TABLE media (id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT);",
  );
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0032_listicles_core.sql"), "utf8"));
  runSql(sdb, readFileSync(join(TEST_DIR, "../migrations/0034_listicles_revenue_infra.sql"), "utf8"));
  return sdb;
}

const DatabaseSync = loadDatabaseSync();
const describeDb = DatabaseSync === null ? describe.skip : describe;

// --- fixtures -----------------------------------------------------------------

interface OfferSeed {
  public_id: string;
  offer_name?: string;
  url?: string;
  status?: string;
  cap?: {
    amount: number;
    timezone?: string;
    count_by?: "clicks" | "conversions";
    fallback_offer_id?: number | null;
    fallback_url?: string | null;
  };
}

function seedOffer(sdb: SqliteDb, seed: OfferSeed): number {
  sdb
    .prepare(
      `INSERT INTO listicle_offers
       (public_id, offer_name, provider, activity, vertical, conversion_tracking_method,
        offer_url_template, payout_method, cap_enabled, cap_amount, cap_timezone,
        cap_count_by, cap_fallback_offer_id, cap_fallback_url, status)
       VALUES (?, ?, 'prov', 'lead', 'finance', 's2s_postback', ?, 'offsite', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      seed.public_id,
      seed.offer_name ?? `Offer ${seed.public_id}`,
      seed.url ?? "https://track.provider.example/c?cid={click_id}&geo={country}",
      seed.cap ? 1 : 0,
      seed.cap?.amount ?? null,
      seed.cap?.timezone ?? (seed.cap ? "UTC" : null),
      seed.cap?.count_by ?? (seed.cap ? "clicks" : null),
      seed.cap?.fallback_offer_id ?? null,
      seed.cap?.fallback_url ?? null,
      seed.status ?? "active",
    );
  const row = sdb
    .prepare("SELECT id FROM listicle_offers WHERE public_id = ?")
    .get(seed.public_id) as { id: number };
  return row.id;
}

function capCount(sdb: SqliteDb, offerId: number): { clicks: number; rows: number } {
  const rows = sdb
    .prepare("SELECT click_count FROM listicle_offer_cap_counters WHERE offer_id = ?")
    .all(offerId) as Array<{ click_count: number }>;
  return { clicks: rows.reduce((s, r) => s + r.click_count, 0), rows: rows.length };
}

function makeEnv(db: D1Database): Env {
  const kv = {
    async get() {
      return null;
    },
    async put() {},
    async delete() {},
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
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
  } as Env;
}

interface CapturedCtx {
  ctx: ExecutionContext;
  promises: Promise<unknown>[];
}

function captureCtx(): CapturedCtx {
  const promises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil(p: Promise<unknown>): void {
      promises.push(p);
    },
    passThroughOnException(): void {},
  } as unknown as ExecutionContext;
  return { ctx, promises };
}

// Structural LcContext for direct resolveDestination calls.
function makeLc(
  env: Env,
  opts: {
    oid?: string;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    cf?: Record<string, unknown>;
    url?: string;
  } = {},
): { c: LcContext; captured: CapturedCtx } {
  const captured = captureCtx();
  const headers = new Headers(opts.headers ?? {});
  const url =
    opts.url ??
    `https://tenant.example.com/lc/${opts.oid ?? "off_x"}?${new URLSearchParams(opts.query ?? {}).toString()}`;
  const raw = new Request(url, { headers });
  if (opts.cf !== undefined) {
    Object.defineProperty(raw, "cf", { value: opts.cf });
  }
  const c: LcContext = {
    env,
    executionCtx: captured.ctx,
    req: {
      param: (name: string) => (name === "oid" ? opts.oid : undefined),
      query: () => opts.query ?? {},
      header: (name: string) => headers.get(name) ?? undefined,
      url,
      raw,
    },
  };
  return { c, captured };
}

async function settle(captured: CapturedCtx): Promise<void> {
  // Two passes: the resolver's outer waitUntil task registers the firehose
  // dispatch as a NESTED waitUntil while it runs — the second pass awaits
  // promises pushed during the first.
  await Promise.all(captured.promises.map((p) => p.catch(() => undefined)));
  await Promise.all(captured.promises.map((p) => p.catch(() => undefined)));
}

// --- §24 fallback URL gate (pure) ---------------------------------------------

describe("safeFallbackUrl — the §24 scheme gate", () => {
  it("accepts absolute http(s) (returns the NORMALIZED href) and local paths", () => {
    expect(safeFallbackUrl("https://alt.example.com/x")).toBe("https://alt.example.com/x");
    // MINOR-1: the normalized href is returned (Header-safe), so a bare
    // authority gains its canonical trailing slash.
    expect(safeFallbackUrl("http://alt.example.com")).toBe("http://alt.example.com/");
    expect(safeFallbackUrl("/local-page")).toBe("/local-page");
  });

  it("strips a control char out of an otherwise-valid absolute fallback URL (MINOR-1)", () => {
    // WHATWG drops the \n; the returned href is Header-safe.
    const out = safeFallbackUrl("https://alt.example.com/of\nfer");
    expect(out).toBe("https://alt.example.com/offer");
    // a control char in a LOCAL path is rejected (no normalization pass).
    expect(safeFallbackUrl("/of\nfer")).toBeNull();
  });

  it("rejects javascript:, data:, protocol-relative, junk, empty", () => {
    expect(safeFallbackUrl("javascript:alert(1)")).toBeNull();
    expect(safeFallbackUrl("data:text/html,x")).toBeNull();
    expect(safeFallbackUrl("//evil.example.com")).toBeNull();
    expect(safeFallbackUrl("ftp://x")).toBeNull();
    expect(safeFallbackUrl("   ")).toBeNull();
    expect(safeFallbackUrl(null)).toBeNull();
  });
});

// --- §7.3 branch cases over real sqlite -----------------------------------------

describeDb("resolveDestination — §7.3 fidelity", () => {
  function harness(): { sdb: SqliteDb; env: Env } {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    return { sdb, env: makeEnv(d1FromSqlite(sdb)) };
  }

  it("unknown offer → '/' (fail-safe)", async () => {
    const { env } = harness();
    const { c } = makeLc(env, { oid: "off_ghost" });
    expect((await resolveDestination(c, "off_ghost", 0)).url).toBe("/");
  });

  it("paused / archived offers do not resolve (active-only lookup)", async () => {
    const { sdb, env } = harness();
    seedOffer(sdb, { public_id: "off_paused", status: "paused" });
    seedOffer(sdb, { public_id: "off_archived", status: "archived" });
    const { c } = makeLc(env, {});
    expect((await resolveDestination(c, "off_paused", 0)).url).toBe("/");
    expect((await resolveDestination(c, "off_archived", 0)).url).toBe("/");
  });

  it("active offer resolves to the provider URL with {click_id} substituted (UUID) + no-store handled by route", async () => {
    const { sdb, env } = harness();
    seedOffer(sdb, { public_id: "off_live" });
    const { c, captured } = makeLc(env, { oid: "off_live", cf: { country: "US" } });
    const { url } = await resolveDestination(c, "off_live", 0);
    expect(url).toMatch(
      /^https:\/\/track\.provider\.example\/c\?cid=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}&geo=US$/,
    );
    await settle(captured);
  });

  it("cap reached → fallback OFFER re-resolved ONCE (one hop, its own URL)", async () => {
    const { sdb, env } = harness();
    const fallbackId = seedOffer(sdb, {
      public_id: "off_fb",
      url: "https://fallback.example/land?c={click_id}",
    });
    const primaryId = seedOffer(sdb, {
      public_id: "off_primary",
      cap: { amount: 2, count_by: "clicks", fallback_offer_id: fallbackId },
    });
    // Counter already at the cap for today (UTC).
    const today = new Date().toISOString().slice(0, 10);
    sdb
      .prepare(
        "INSERT INTO listicle_offer_cap_counters (offer_id, cap_date, timezone, click_count) VALUES (?, ?, 'UTC', 2)",
      )
      .run(primaryId, today);
    const { c, captured } = makeLc(env, { oid: "off_primary" });
    const { url } = await resolveDestination(c, "off_primary", 0);
    expect(url).toMatch(/^https:\/\/fallback\.example\/land\?c=/);
    await settle(captured);
  });

  it("depth guard: a capped fallback CHAIN stops after ONE hop → '/'", async () => {
    const { sdb, env } = harness();
    // A → B → C where A and B are both capped: resolving A must stop at
    // depth 2 (B's own fallback hop) and return '/'.
    const cId = seedOffer(sdb, { public_id: "off_c" });
    const bId = seedOffer(sdb, {
      public_id: "off_b",
      cap: { amount: 1, count_by: "clicks", fallback_offer_id: cId },
    });
    const aId = seedOffer(sdb, {
      public_id: "off_a",
      cap: { amount: 1, count_by: "clicks", fallback_offer_id: bId },
    });
    const today = new Date().toISOString().slice(0, 10);
    for (const id of [aId, bId]) {
      sdb
        .prepare(
          "INSERT INTO listicle_offer_cap_counters (offer_id, cap_date, timezone, click_count) VALUES (?, ?, 'UTC', 5)",
        )
        .run(id, today);
    }
    const { c } = makeLc(env, {});
    expect((await resolveDestination(c, "off_a", 0)).url).toBe("/");
  });

  it("capped with NO fallback offer: safe fallback URL → else '/'; hostile fallback URL is refused", async () => {
    const { sdb, env } = harness();
    const safeId = seedOffer(sdb, {
      public_id: "off_cap_url",
      cap: { amount: 1, count_by: "clicks", fallback_url: "https://alt.example.com/offer" },
    });
    const hostileId = seedOffer(sdb, {
      public_id: "off_cap_evil",
      cap: { amount: 1, count_by: "clicks", fallback_url: "javascript:alert(1)" },
    });
    const bareId = seedOffer(sdb, { public_id: "off_cap_bare", cap: { amount: 1, count_by: "clicks" } });
    const today = new Date().toISOString().slice(0, 10);
    for (const id of [safeId, hostileId, bareId]) {
      sdb
        .prepare(
          "INSERT INTO listicle_offer_cap_counters (offer_id, cap_date, timezone, click_count) VALUES (?, ?, 'UTC', 9)",
        )
        .run(id, today);
    }
    const { c } = makeLc(env, {});
    expect((await resolveDestination(c, "off_cap_url", 0)).url).toBe("https://alt.example.com/offer");
    expect((await resolveDestination(c, "off_cap_evil", 0)).url).toBe("/");
    expect((await resolveDestination(c, "off_cap_bare", 0)).url).toBe("/");
  });

  it("clicks-counted cap increments atomically BEFORE redirect (clean traffic)", async () => {
    const { sdb, env } = harness();
    const offerId = seedOffer(sdb, { public_id: "off_count", cap: { amount: 100, count_by: "clicks" } });
    const { c, captured } = makeLc(env, {});
    await resolveDestination(c, "off_count", 0);
    await resolveDestination(c, "off_count", 0);
    expect(capCount(sdb, offerId)).toEqual({ clicks: 2, rows: 1 }); // one upserted row, +1 each
    await settle(captured);
  });

  it("§31.8: NON-clean traffic (declared-bot UA) still redirects + emits, but never increments the cap counter", async () => {
    const { sdb, env } = harness();
    const offerId = seedOffer(sdb, { public_id: "off_bot", cap: { amount: 100, count_by: "clicks" } });
    const { c, captured } = makeLc(env, {
      headers: { "user-agent": "curl/8.0" },
    });
    const { url } = await resolveDestination(c, "off_bot", 0);
    expect(url).toContain("https://track.provider.example/");
    expect(capCount(sdb, offerId).clicks).toBe(0);
    await settle(captured);
  });

  it("cap check reads the offer's cap_timezone date bucket", async () => {
    const { sdb, env } = harness();
    seedOffer(sdb, {
      public_id: "off_tz",
      cap: { amount: 1, count_by: "clicks", timezone: "America/Los_Angeles", fallback_url: "/alt" },
    });
    const offerRow = {
      id: (sdb.prepare("SELECT id FROM listicle_offers WHERE public_id='off_tz'").get() as { id: number }).id,
      public_id: "off_tz",
      offer_name: "x",
      offer_url_template: "https://t.example/{click_id}",
      cap_enabled: 1,
      cap_amount: 1,
      cap_timezone: "America/Los_Angeles",
      cap_count_by: "clicks",
      cap_fallback_url: "/alt",
      cap_fallback_public_id: null,
    };
    // Seed the counter under the LA-local date for a fixed instant.
    const at = new Date("2026-07-02T05:30:00Z"); // 2026-07-01 in LA
    sdb
      .prepare(
        "INSERT INTO listicle_offer_cap_counters (offer_id, cap_date, timezone, click_count) VALUES (?, '2026-07-01', 'America/Los_Angeles', 1)",
      )
      .run(offerRow.id);
    const db = d1FromSqlite(sdb);
    expect(await isCapReached(db, offerRow, at)).toBe(true);
    // Same instant next day in LA → different bucket → not capped.
    expect(await isCapReached(db, offerRow, new Date("2026-07-02T08:30:00Z"))).toBe(false);
  });

  it("§16 offer_click: full column set + pv passthrough + ko_ctx macros + link dims + quality flags", async () => {
    const { sdb, env } = harness();
    seedOffer(sdb, {
      public_id: "off_evt",
      url: "https://t.example/c?cid={clickid}&src={utm_source}&pl={placement}&s={sub2}&lv={lander_v}",
    });
    // capture emitted records by intercepting waitUntil promises + the env
    // stream config being absent → emit is a structured no-op; instead we
    // capture through the event object the resolver builds by inspecting
    // the KV counter bump… simpler: spy via a wrapped emit is not possible
    // without touching the module — so assert through the RESOLVED URL
    // (macro values) and the enrichment side effects on the event are
    // covered by the route-level test below via the Location header.
    const koCtx = encodeURIComponent(
      JSON.stringify({
        utm_source: "newsbreak",
        placement: "feed",
        sub2: "s2v",
        lander_v: "ver_ctx",
        fbclid: "fbX",
        fbc: "fb.1.1.fbX",
      }),
    );
    const { c, captured } = makeLc(env, {
      oid: "off_evt",
      query: { a: "art_1", lv: "ver_9", p: "2", s: "sec_1", c: "cand_1", m: "ab_test", r: "", lnk: "lnk_9", blk: "blk_1", role: "choice_button", pv: "pv-123" },
      headers: { Cookie: `ko_sid=sid-1; ko_ctx=${koCtx}`, "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" },
      cf: { country: "US", regionCode: "CA", city: "Fresno" },
    });
    const { url } = await resolveDestination(c, "off_evt", 0);
    // {clickid} alias accepted at runtime; landing dims from ko_ctx; lv from
    // the query wins over ko_ctx.lander_v.
    expect(url).toMatch(/cid=[0-9a-f-]{36}&src=newsbreak&pl=feed&s=s2v&lv=ver_9$/);
    await settle(captured);
  });

  it("unresolved macros substitute as EMPTY STRING (documented policy)", async () => {
    const { sdb, env } = harness();
    seedOffer(sdb, {
      public_id: "off_empty",
      url: "https://t.example/c?cid={click_id}&src={utm_source}&geo={country}&x={sub5}",
    });
    const { c, captured } = makeLc(env, {}); // no ko_ctx cookie, no cf
    const { url } = await resolveDestination(c, "off_empty", 0);
    expect(url).toMatch(/cid=[0-9a-f-]{36}&src=&geo=&x=$/);
    await settle(captured);
  });

  // MINOR-1: a stored template carrying a C0 control char (validation is
  // bypassed by a legacy/hand-edited row — seedOffer INSERTs raw) slips past
  // new URL()'s protocol guard (WHATWG strips it), but the raw string would
  // throw at the 302 Location header. resolveDestination must return the
  // NORMALIZED (control-char-stripped) href, never the raw string.
  it("a stored template with \\n / \\r returns a NORMALIZED (sanitized) url, never a throw", async () => {
    const { sdb, env } = harness();
    seedOffer(sdb, { public_id: "off_nl", url: "https://track.example/c\n?cid={click_id}" });
    seedOffer(sdb, { public_id: "off_cr", url: "https://track.example/c\r?cid={click_id}&geo={country}" });
    for (const oid of ["off_nl", "off_cr"]) {
      const { c, captured } = makeLc(env, { oid });
      const { url } = await resolveDestination(c, oid, 0);
      // control chars stripped by WHATWG normalization; the value is
      // Header-safe (no raw \n / \r survives).
      expect(url, oid).not.toMatch(/[\u0000-\u001f\u007f]/);
      expect(url, oid).toMatch(/^https:\/\/track\.example\/c\?cid=/);
      await settle(captured);
    }
  });
});

// --- route-level (real public router) -------------------------------------------

describeDb("GET /lc/:oid through the public router", () => {
  function app(): Hono<{ Bindings: Env; Variables: PublicSiteVariables }> {
    const a = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
    a.route("/", publicRouter);
    return a;
  }

  function harness(): { sdb: SqliteDb; env: Env } {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    return { sdb, env: makeEnv(d1FromSqlite(sdb)) };
  }

  function ctxStub(): { ctx: ExecutionContext; promises: Promise<unknown>[] } {
    const promises: Promise<unknown>[] = [];
    return {
      promises,
      ctx: {
        waitUntil(p: Promise<unknown>) {
          promises.push(p);
        },
        passThroughOnException() {},
      } as unknown as ExecutionContext,
    };
  }

  it("302 + Location=provider URL + Cache-Control: private, no-store (§7.2)", async () => {
    const { sdb, env } = harness();
    seedOffer(sdb, { public_id: "off_route" });
    const { ctx, promises } = ctxStub();
    const res = await app().request(
      "https://any-host.example.com/lc/off_route?a=art_1&lv=ver_1&p=0&pv=pv-9",
      {},
      env,
      ctx,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Location")).toMatch(/^https:\/\/track\.provider\.example\/c\?cid=/);
    await Promise.all(promises.map((p) => p.catch(() => undefined)));
  });

  it("unknown offer → 302 '/' (never a 404/500 — §7.3 fail-safe)", async () => {
    const { env } = harness();
    const { ctx } = ctxStub();
    const res = await app().request("https://h.example.com/lc/off_missing", {}, env, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  // MINOR-1 end-to-end: a stored template with a control char must yield a
  // 302 (sanitized Location or '/'), NEVER a 500 from the Response/Headers
  // constructor throwing on a control char in Location.
  it("a stored template with \\n / \\r → 302 (sanitized), never a 500", async () => {
    const { sdb, env } = harness();
    seedOffer(sdb, { public_id: "off_ctl_nl", url: "https://track.example/c\n?cid={click_id}" });
    seedOffer(sdb, { public_id: "off_ctl_cr", url: "https://track.example/land\r/x?cid={click_id}" });
    for (const oid of ["off_ctl_nl", "off_ctl_cr"]) {
      const { ctx, promises } = ctxStub();
      const res = await app().request(`https://h.example.com/lc/${oid}`, {}, env, ctx);
      expect(res.status, oid).toBe(302);
      const loc = res.headers.get("Location") ?? "";
      // header is well-formed (constructing it did not throw) and carries no
      // raw control char.
      expect(loc, oid).not.toMatch(/[\u0000-\u001f\u007f]/);
      expect(loc.startsWith("https://track.example/") || loc === "/", `${oid} loc=${loc}`).toBe(true);
      await Promise.all(promises.map((p) => p.catch(() => undefined)));
    }
  });

  it("a THROWING db still yields 302 '/' (never 500 a click)", async () => {
    const db = {
      prepare() {
        throw new Error("d1 exploded");
      },
    } as unknown as D1Database;
    const { ctx } = ctxStub();
    const res = await app().request("https://h.example.com/lc/off_x", {}, makeEnv(db), ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("two clicks mint two DIFFERENT click_ids (Location cid differs)", async () => {
    const { sdb, env } = harness();
    seedOffer(sdb, { public_id: "off_two" });
    const { ctx, promises } = ctxStub();
    const first = await app().request("https://h.example.com/lc/off_two", {}, env, ctx);
    const second = await app().request("https://h.example.com/lc/off_two", {}, env, ctx);
    const cid = (res: Response): string =>
      new URL(res.headers.get("Location") ?? "").searchParams.get("cid") ?? "";
    expect(cid(first)).not.toBe("");
    expect(cid(first)).not.toBe(cid(second));
    await Promise.all(promises.map((p) => p.catch(() => undefined)));
  });

  it("emits offer_click with §16 dims via waitUntil (enrichment joins the version/article graph)", async () => {
    const { sdb, env } = harness();
    seedOffer(sdb, { public_id: "off_enrich" });
    // article + version graph for enrichment.
    sdb.prepare("INSERT INTO sites (id, name) VALUES ('st_1', 'S')").run();
    sdb
      .prepare(
        "INSERT INTO listicle_articles (public_id, site_id, slug, article_name, status) VALUES ('art_e', 'st_1', 'sl', 'Enriched Article', 'published')",
      )
      .run();
    const articleId = (sdb.prepare("SELECT id FROM listicle_articles WHERE public_id='art_e'").get() as { id: number }).id;
    sdb
      .prepare(
        "INSERT INTO listicle_article_versions (public_id, article_id, variant_label, headline, intro_paragraph, content_version) VALUES ('ver_e', ?, 'B', 'h', 'i', 4)",
      )
      .run(articleId);
    // The emit path is a structured NO-OP (no stream configured) — so we
    // prove the enrichment by intercepting the waitUntil task result via a
    // capturing KV (the daily counter bump keys on the ENRICHED site_id).
    const counters: string[] = [];
    (env as { CACHE: KVNamespace }).CACHE = {
      async get() {
        return null;
      },
      async put(key: string) {
        counters.push(key);
      },
      async delete() {},
      async list() {
        return { keys: [], list_complete: true, cacheStatus: null };
      },
    } as unknown as KVNamespace;
    const { ctx, promises } = ctxStub();
    const res = await app().request(
      "https://h.example.com/lc/off_enrich?a=art_e&lv=ver_e&p=1&m=single&pv=pv-77",
      {},
      env,
      ctx,
    );
    expect(res.status).toBe(302);
    await Promise.all(promises.map((p) => p.catch(() => undefined)));
    // counter bumped under the ENRICHED site id → the event carried st_1.
    expect(counters.some((k) => k.includes(":st_1"))).toBe(true);
  });
});

// --- offer_click event shape (unit, direct) --------------------------------------

describeDb("offer_click §16 record (captured via a stream-configured env)", () => {
  it("carries identity + placement + link dims + pv + quality flags with every column present", async () => {
    const sdb = createDb(DatabaseSync as DatabaseSyncCtor);
    seedOffer(sdb, { public_id: "off_full", offer_name: "Full Offer" });
    const env = makeEnv(d1FromSqlite(sdb));
    // Configure the stream so emitListicleRecords hands the batch to
    // sendToFirehose — whose fetch we intercept globally.
    (env as unknown as Record<string, unknown>).AWS_ACCESS_KEY_ID = "test-key";
    (env as unknown as Record<string, unknown>).AWS_SECRET_ACCESS_KEY = "test-secret";
    (env as unknown as Record<string, unknown>).LISTICLE_EVENTS_FIREHOSE_STREAM = "listicle-events";
    const sent: unknown[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      // aws4fetch passes a signed Request OBJECT — read url+body from it.
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("firehose")) {
        const bodyText =
          input instanceof Request ? await input.clone().text() : String(init?.body ?? "{}");
        const body = JSON.parse(bodyText) as { Records: Array<{ Data: string }> };
        for (const record of body.Records) {
          sent.push(JSON.parse(Buffer.from(record.Data, "base64").toString("utf8")));
        }
        return new Response(JSON.stringify({ FailedPutCount: 0, RequestResponses: [] }), {
          status: 200,
        });
      }
      return realFetch(input as RequestInfo, init);
    }) as typeof fetch;
    try {
      const { c, captured } = makeLc(env, {
        oid: "off_full",
        query: {
          a: "art_z",
          lv: "ver_z",
          p: "3",
          s: "sec_z",
          c: "cand_z",
          m: "rule_based",
          r: "rule_z",
          lnk: "lnk_z",
          blk: "blk_z",
          role: "button",
          pv: "pv-full",
        },
        headers: { Cookie: "ko_sid=sid-full" },
        cf: { country: "GB", regionCode: "ENG", city: "London" },
      });
      await resolveDestination(c, "off_full", 0);
      await settle(captured);
      expect(sent.length).toBe(1);
      const event = sent[0] as ListicleEvent;
      expect(event.record_kind).toBe("event");
      expect(event.event_type).toBe("offer_click");
      expect(event.session_id).toBe("sid-full");
      expect(event.offer_id).toBe("off_full");
      expect(event.offer_name).toBe("Full Offer");
      expect(event.click_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(event.page_view_id).toBe("pv-full"); // §31.9 pv passthrough
      expect(event.article_id).toBe("art_z");
      expect(event.lander_v).toBe("ver_z");
      expect(event.page).toBe("3");
      expect(event.page_index).toBe(3);
      expect(event.page_selection_mode).toBe("rule_based");
      expect(event.selection_reason).toBe("rule_match"); // r= names a rule
      expect(event.section_id).toBe("sec_z");
      expect(event.page_candidate_id).toBe("cand_z");
      expect(event.page_rule_id).toBe("rule_z");
      expect(event.link_instance_id).toBe("lnk_z");
      expect(event.section_block_id).toBe("blk_z");
      expect(event.link_role).toBe("button");
      expect(event.country).toBe("GB");
      expect(event.state).toBe("ENG");
      expect(event.city).toBe("London");
      expect(event.traffic_quality_flag).toBe("clean");
      expect(event.is_bot).toBe(false);
      // every §16 column present on the record (stable Athena schema).
      for (const column of [
        "session_id",
        "event_id",
        "event_type",
        "timestamp",
        "received_at",
        "site_id",
        "article_id",
        "article_name",
        "article_url",
        "lander_v",
        "article_version_id",
        "article_version_revision",
        "article_experiment_id",
        "article_variant_id",
        "article_variant_label",
        "article_split_percentage",
        "page",
        "page_index",
        "page_selection_mode",
        "section_id",
        "section_name",
        "page_candidate_id",
        "ab_test_id",
        "ab_split_percentage",
        "page_rule_set_id",
        "page_rule_id",
        "page_rule_priority",
        "selection_reason",
        "matched_rule_json_hash",
        "offer_id",
        "offer_name",
        "click_id",
        "link_instance_id",
        "section_block_id",
        "link_role",
        "link_position_index",
        "button_style_id",
        "button_group_id",
        "anchor_text_hash",
        "analytics_label",
        "utm_source",
        "utm_medium",
        "utm_content",
        "traffic_source",
        "placement",
        "cpc",
        "fbc",
        "fbclid",
        "sub1",
        "sub2",
        "sub3",
        "sub4",
        "sub5",
        "device",
        "os",
        "os_version",
        "browser",
        "browser_version",
        "country",
        "state",
        "city",
        "ip",
        "ua",
        "url",
        "referer",
        "language",
        "page_view_id",
        "is_bot",
        "is_internal",
        "is_preview",
        "traffic_quality_flag",
      ]) {
        expect(event, `column ${column}`).toHaveProperty(column);
      }
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
