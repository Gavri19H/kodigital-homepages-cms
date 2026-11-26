import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFingerprintCron } from "../src/edge/fingerprint-cron";
import { gatewayFetch } from "../src/edge/gateway";
import type { Env } from "../src/env";
import { makeKvStub } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv, hasSqlite, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("../src/edge/fingerprint-cron", () => ({ runFingerprintCron: vi.fn(async () => {}) }));

describe.skipIf(!hasSqlite)("gateway fingerprint tick", () => {
  const key = "edge:tick:v1";
  const fallback = vi.fn(() => new Response("fallback"));
  const purgeTags = vi.fn(async (_tags: string[]) => ({ success: true, errors: [] }));
  let db: SqliteDb;
  let env: Env;
  let cache: ReturnType<typeof makeKvStub>;
  let now: number;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createDb();
    now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    if (typeof db.function === "function") db.function("unixepoch", (_precision: string) => now / 1000);
    cache = makeKvStub();
    vi.spyOn(cache.kv, "get");
    vi.spyOn(cache.kv, "put");
    env = { ...sqliteEnv(db), CACHE: cache.kv };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  function call(method: string, host: string, bindings = env) {
    const work: Promise<unknown>[] = [];
    const ctx: ExecutionContext = {
      props: {}, exports: { PublicPage: { purgeTags } }, passThroughOnException() {},
      waitUntil(promise: Promise<unknown>) { work.push(promise); },
      get tracing(): never { throw new Error("Unexpected tracing access"); },
    };
    const response = gatewayFetch(new Request(`https://${host}/__edge/tick`, { method }), bindings, ctx, fallback);
    return { response, work, ctx };
  }

  it("returns only 202 ok, runs in waitUntil, and skips repeat POSTs until 50 seconds", async () => {
    env.CF_VERSION_METADATA = { id: "tick-worker-version" };
    const first = call("POST", env.ADMIN_HOST);
    const response = await first.response;
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("x-worker-version")).toBe("tick-worker-version");
    expect(first.work).toHaveLength(1);
    await Promise.all(first.work);
    expect(cache.store.get(key)).toBe(String(now));
    expect(runFingerprintCron).toHaveBeenCalledTimes(1);
    const [bindings, context] = vi.mocked(runFingerprintCron).mock.calls[0]!;
    expect(bindings).toBe(env);
    expect(context).toBe(first.ctx);

    now += 49_999;
    const second = call("POST", "another-tenant.example");
    expect((await second.response).status).toBe(202);
    expect(second.work).toHaveLength(0);
    expect(cache.kv.get).toHaveBeenCalledExactlyOnceWith(key);
    expect(cache.kv.put).toHaveBeenCalledTimes(1);
    expect(runFingerprintCron).toHaveBeenCalledTimes(1);

    now++;
    const third = call("POST", "another-tenant.example");
    expect((await third.response).status).toBe(202);
    await Promise.all(third.work);
    expect(runFingerprintCron).toHaveBeenCalledTimes(2);
    expect(cache.store.get(key)).toBe(String(now));
    expect(db.prepare("SELECT COUNT(*) AS n FROM cache_purge_log WHERE action = ?").get(key)).toEqual({ n: 1 });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("admits just one of two cold isolates with a shared KV, including stale reads", async () => {
    // Separate handles have independent in-memory cooldowns and share the backing store.
    const other = { ...env, CACHE: { ...cache.kv } };
    const first = call("POST", "a.example");
    const second = call("POST", "b.example", other);
    for (const result of [first, second]) {
      const response = await result.response;
      expect(response.status).toBe(202);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.text()).toBe("ok");
    }
    await Promise.all([...first.work, ...second.work]);
    // A fresh handle can still see an empty KV replica after the first claim.
    now += 20_000;
    cache.store.delete(key);
    const stale = call("POST", "c.example", { ...env, CACHE: { ...cache.kv } });
    expect((await stale.response).status).toBe(202);
    await Promise.all(stale.work);
    expect(runFingerprintCron).toHaveBeenCalledTimes(1);
    expect(cache.kv.get).toHaveBeenCalledExactlyOnceWith(key);
    expect(cache.kv.put).toHaveBeenCalledExactlyOnceWith(key, String(now - 20_000));
    expect(fallback).not.toHaveBeenCalled();
  });

  it("drains due retry and second-pass rows before fingerprinting under the shared 50-second guard", async () => {
    const seed = (action: string, tag: string, due: number) => db.prepare(
      "INSERT INTO cache_purge_log (action, status, dry_run, payload) VALUES (?, 'pending', 0, ?)",
    ).run(action, JSON.stringify({ tags: [tag], due_after: due }));
    const statuses = () => db.prepare("SELECT status FROM cache_purge_log WHERE action IN (?, ?) ORDER BY id")
      .all("purge_tags", "purge_tags_second").map(row => (row as { status: string }).status);
    seed("purge_tags", "slug:a:news", now / 1000);
    seed("purge_tags_second", "listing:a", now / 1000);
    seed("purge_tags_second", "quote:b:life", now / 1000 + 30);
    let atFingerprint: string[] = [];
    vi.mocked(runFingerprintCron).mockImplementationOnce(async () => { atFingerprint = statuses(); });
    const first = call("POST", "a.example");
    expect((await first.response).status).toBe(202);
    await Promise.all(first.work);
    expect(atFingerprint).toEqual(["completed", "completed", "pending"]);
    expect(purgeTags).toHaveBeenCalledExactlyOnceWith(["slug:a:news", "listing:a"]);

    now += 49_999;
    const guarded = call("POST", "b.example", { ...env, CACHE: { ...cache.kv } });
    await guarded.response;
    await Promise.all(guarded.work);
    expect(statuses()).toEqual(atFingerprint);
    expect(purgeTags).toHaveBeenCalledTimes(1);
    now++;
    const next = call("POST", "a.example");
    await next.response;
    await Promise.all(next.work);
    expect(statuses()).toEqual(["completed", "completed", "completed"]);
    expect(purgeTags.mock.calls).toEqual([[["slug:a:news", "listing:a"]], [["quote:b:life"]]]);
    expect(runFingerprintCron).toHaveBeenCalledTimes(2);
  });

  it("rejects GET with a private 405 and schedules no work", async () => {
    const result = call("GET", "unknown.example");
    const response = await result.response;
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("x-worker-version")).toBe("unknown");
    expect(result.work).toHaveLength(0);
    expect(cache.kv.get).not.toHaveBeenCalled();
    expect(runFingerprintCron).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it("purges only the edited site on the next tick after an old-version write with no receipt", async () => {
    const real = await vi.importActual<typeof import("../src/edge/fingerprint-cron")>("../src/edge/fingerprint-cron");
    vi.mocked(runFingerprintCron).mockImplementationOnce(real.runFingerprintCron).mockImplementationOnce(real.runFingerprintCron);
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = <T>(statements: D1PreparedStatement[]) => {
      for (const statement of statements) statement.run = statement.all.bind(statement);
      return batch<T>(statements);
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    addSite(db, "site-a", "Site A", "home");
    addSite(db, "site-b", "Site B", "home");
    const baseline = call("POST", "site-a.example");
    await baseline.response;
    await Promise.all(baseline.work);
    expect(purgeTags).not.toHaveBeenCalled();

    db.prepare(`INSERT INTO articles (site_id, slug, title, content_json, status)
                VALUES (?, ?, ?, '{}', 'published')`).run("site-a", "news", "Old-version edit");
    now += 60_000;
    const next = call("POST", "site-b.example");
    expect((await next.response).status).toBe(202);
    await Promise.all(next.work);
    expect(purgeTags).toHaveBeenCalledExactlyOnceWith(["site:site-a"]);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ t: "missed_write_path", sites: ["site-a"] }));
  });
});
