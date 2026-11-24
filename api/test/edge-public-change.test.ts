import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onPublicChange, runEdgePurgeCron } from "../src/edge/public-change";
import type { Env } from "../src/env";
import { addSite, createDb, env as testEnv, hasSqlite, type SqliteDb } from "./helpers/x06-a2-sqlite";

const now = 1_800_000_000;
const success = { success: true, errors: [] };
const limited = { success: false, errors: [{ code: 429 }] };
const change = { siteId: "Site-A", tags: ["SLUG:Site-A:one", "slug:site-a:one"], reason: "publish" };
const siteTags = ["slug:site-a:one", "snap:site-a", "nf:site-a"];

type PurgeRpc = (tags: string[]) => Promise<{ success: boolean; errors: unknown[] }>;
const purge = vi.fn<PurgeRpc>();
const ctx = { exports: { PublicPage: { purgeTags: purge } } } as unknown as ExecutionContext;

describe.skipIf(!hasSqlite)("public change invalidation", () => {
  let sql: SqliteDb;
  let env: Env;

  beforeEach(() => {
    sql = createDb("0073");
    addSite(sql, "Site-A", "A", "finance");
    addSite(sql, "Site-B", "B", "finance");
    env = testEnv(sql);
    vi.spyOn(Date, "now").mockReturnValue(now * 1000);
    if (typeof sql.function === "function") sql.function("unixepoch", () => Math.floor(Date.now() / 1000));
    vi.spyOn(console, "error").mockImplementation(() => {});
    purge.mockReset().mockResolvedValue(success);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sql.close();
  });

  function logRows() {
    const rows = sql.prepare("SELECT site_id, action, status, dry_run, payload FROM cache_purge_log ORDER BY id")
      .all() as { site_id: string | null; action: string; status: string; dry_run: number; payload: string }[];
    return rows.map(row => ({ ...row, payload: JSON.parse(row.payload) }));
  }

  function seed(action: string, payload: unknown, createdAt = now, status = "pending") {
    sql.prepare("INSERT INTO cache_purge_log (action, status, dry_run, payload, created_at) VALUES (?, ?, 0, ?, ?)")
      .run(action, status, JSON.stringify(payload), createdAt);
  }

  function siteVersions() {
    return sql.prepare("SELECT id, content_version, write_bookmark FROM sites WHERE id IN (?, ?) ORDER BY id")
      .all("Site-A", "Site-B");
  }

  it("bumps the site on the primary and records the resulting bookmark before the one merged RPC", async () => {
    let atBookmark: unknown;
    const session = {
      prepare: vi.fn(env.DB.prepare.bind(env.DB)),
      batch: env.DB.batch.bind(env.DB),
      getBookmark: vi.fn(() => {
        atBookmark = siteVersions();
        return "0002";
      }),
    };
    env.DB.withSession = vi.fn(() => session);
    let atPurge: unknown;
    purge.mockImplementationOnce(async () => {
      atPurge = siteVersions();
      return success;
    });

    await onPublicChange(env, ctx, change);

    expect(env.DB.withSession).toHaveBeenCalledExactlyOnceWith("first-primary");
    expect(session.prepare).toHaveBeenCalledTimes(2);
    expect(session.getBookmark).toHaveBeenCalledTimes(1);
    const otherSite = { id: "Site-B", content_version: 1, write_bookmark: null };
    expect(atBookmark).toEqual([{ id: "Site-A", content_version: 2, write_bookmark: null }, otherSite]);
    expect(atPurge).toEqual([{ id: "Site-A", content_version: 2, write_bookmark: "0002" }, otherSite]);
    expect(purge).toHaveBeenCalledExactlyOnceWith(siteTags);
    expect(logRows()).toEqual([{
      site_id: "Site-A", action: "purge_tags_second", status: "pending", dry_run: 0,
      payload: { tags: siteTags, reason: "publish", due_after: now + 30 },
    }]);
  });

  it("preserves the newer bookmark if publications finish out of order", async () => {
    sql.prepare("UPDATE sites SET write_bookmark = ? WHERE id = ?").run("0003", "Site-A");
    env.DB.withSession = () => ({
      prepare: env.DB.prepare.bind(env.DB),
      batch: env.DB.batch.bind(env.DB),
      getBookmark: () => "0002",
    });
    await onPublicChange(env, ctx, change);
    expect(siteVersions()[0]).toEqual({ id: "Site-A", content_version: 2, write_bookmark: "0003" });
    expect(purge).toHaveBeenCalledExactlyOnceWith(siteTags);
  });

  it("records both a retry and a delayed second purge when the edge rate-limits", async () => {
    purge.mockResolvedValueOnce(limited);
    await onPublicChange(env, ctx, change);
    expect(purge).toHaveBeenCalledExactlyOnceWith(siteTags);
    expect(logRows()).toEqual([
      { site_id: "Site-A", action: "purge_tags", status: "pending", dry_run: 0,
        payload: { tags: siteTags, reason: "publish", tries: 0 } },
      { site_id: "Site-A", action: "purge_tags_second", status: "pending", dry_run: 0,
        payload: { tags: siteTags, reason: "publish", due_after: now + 30 } },
    ]);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(console.error).mock.calls[0]![0])).toBeTypeOf("object");
  });

  it.each([
    ["no context", undefined],
    ["a missing RPC method", { exports: { PublicPage: {} } } as unknown as ExecutionContext],
    ["a rejected RPC", ctx],
  ] as const)("queues both passes with %s", async (_label, context) => {
    purge.mockRejectedValueOnce(new Error("RPC disconnected"));
    await expect(onPublicChange(env, context, change)).resolves.toBeUndefined();
    expect(logRows().map(row => [row.action, row.status, row.payload.tags])).toEqual([
      ["purge_tags", "pending", siteTags], ["purge_tags_second", "pending", siteTags],
    ]);
    expect(purge).toHaveBeenCalledTimes(context === ctx ? 1 : 0);
  });

  it("purges only the supplied host tag for a change without a site", async () => {
    env.DB.withSession = vi.fn();
    await onPublicChange(env, ctx, { siteId: null, tags: ["HOST:New.Example"], reason: "hostname added" });
    expect(env.DB.withSession).toHaveBeenCalledTimes(0);
    expect(purge).toHaveBeenCalledExactlyOnceWith(["host:new.example"]);
    expect(logRows()[0]).toMatchObject({ site_id: null, payload: { tags: ["host:new.example"] } });
  });

  it("queues the deleted site's tags after its foreign key disappears", async () => {
    sql.prepare("DELETE FROM sites WHERE id = ?").run("Site-A");
    await onPublicChange(env, undefined, change);
    expect(logRows().map(r => [r.site_id, r.action, r.payload.tags])).toEqual([
      [null, "purge_tags", siteTags], [null, "purge_tags_second", siteTags],
    ]);
  });

  it("still schedules the second pass when the bookmark and retry insert fail", async () => {
    env.DB.withSession = () => { throw new Error("primary session unavailable"); };
    sql.prepare(`CREATE TRIGGER reject_retry BEFORE INSERT ON cache_purge_log WHEN NEW.action = 'purge_tags'
                 BEGIN SELECT RAISE(ABORT, 'retry insert failed'); END`).run();
    purge.mockResolvedValueOnce(limited);
    await expect(onPublicChange(env, ctx, change)).resolves.toBeUndefined();
    expect(logRows().map(row => row.action)).toEqual(["purge_tags_second"]);
    expect(vi.mocked(console.error).mock.calls.map(([line]) => JSON.parse(line))).toHaveLength(3);
  });

  it("waits at least 30 seconds for the second purge", async () => {
    const publishedAt = now * 1000 + 350;
    vi.mocked(Date.now).mockReturnValue(publishedAt);
    await onPublicChange(env, ctx, change);
    purge.mockClear();
    vi.mocked(Date.now).mockReturnValue(publishedAt + 29_999);
    await runEdgePurgeCron(env, ctx);
    expect(purge).toHaveBeenCalledTimes(0);
    expect(logRows()[0]?.status).toBe("pending");
    vi.mocked(Date.now).mockReturnValue(publishedAt + 30_000);
    await runEdgePurgeCron(env, ctx);
    expect(purge).toHaveBeenCalledExactlyOnceWith(siteTags);
    expect(logRows()[0]?.status).toBe("completed");
  });

  it("retains overflow from a single publication in both purge passes", async () => {
    const changed = Array.from({ length: 248 }, (_, i) => `slug:site-a:${i}`);
    await onPublicChange(env, ctx, { ...change, tags: changed });
    expect(purge).toHaveBeenCalledTimes(1);
    const immediate = purge.mock.calls[0]![0];
    expect(immediate).toHaveLength(100);
    expect(immediate).toEqual(expect.arrayContaining(["snap:site-a", "nf:site-a"]));
    const [retry, second] = logRows();
    expect(retry?.payload.tags).toEqual(changed.filter(tag => !immediate.includes(tag)));
    expect(new Set(second?.payload.tags)).toEqual(new Set([...changed, "snap:site-a", "nf:site-a"]));
  });

  it("merges 250 distinct tags from due rows oldest first, with 200 then 50 across two runs", async () => {
    const tags = Array.from({ length: 250 }, (_, i) => `slug:a:${i}`);
    for (const [i, tag] of [...tags.entries()].reverse()) {
      seed(i % 2 ? "purge_tags_second" : "purge_tags", { tags: [tag, tag.toUpperCase()], due_after: now }, now - 250 + i);
    }
    seed("purge_for_hostname", { tags: ["other-action"] });
    seed("purge_tags", { tags: ["already-completed"] }, now, "completed");
    await runEdgePurgeCron(env, ctx);
    expect(purge.mock.calls).toEqual([[tags.slice(0, 100)], [tags.slice(100, 200)]]);
    const byStatus = (status: string) => logRows().filter(r => r.status === status && r.payload.tags[0].startsWith("slug:"));
    expect(byStatus("completed")).toHaveLength(200);
    expect(byStatus("pending")).toHaveLength(50);
    purge.mockClear();
    await runEdgePurgeCron(env, ctx);
    expect(purge).toHaveBeenCalledExactlyOnceWith(tags.slice(200));
    expect(byStatus("completed")).toHaveLength(250);
    expect(logRows().find(r => r.action === "purge_for_hostname")?.status).toBe("pending");
  });

  it("applies the 500-row cap after excluding future rows and deduplicates across due rows", async () => {
    for (let i = 0; i < 500; i++) seed("purge_tags_second", { tags: ["future"], due_after: now + 30 }, now - 60);
    for (let i = 0; i < 500; i++) seed("purge_tags", { tags: ["later"], tries: 3, next_try_at: now + 3600 }, now - 60, "failed");
    for (let i = 0; i < 501; i++) seed("purge_tags", { tags: ["due"] });
    await runEdgePurgeCron(env, ctx);
    expect(purge).toHaveBeenCalledExactlyOnceWith(["due"]);
    expect(logRows().filter(r => r.status === "completed")).toHaveLength(500);
    expect(logRows().filter(r => r.status === "pending")).toHaveLength(501);
    expect(logRows().filter(r => r.status === "failed")).toHaveLength(500);
  });

  it("uses the migration 0073 index for the cron's pending lookup and retention cutoff", async () => {
    const prepare = vi.spyOn(env.DB, "prepare");
    await runEdgePurgeCron(env, ctx);
    const queries = prepare.mock.calls.map(([query]) => query);
    function explain(query: string | undefined) {
      expect(query).toBeDefined();
      const plan = sql.prepare("EXPLAIN QUERY PLAN " + query).all() as { detail: string }[];
      return plan.map(row => row.detail).join("\n");
    }
    const lookup = explain(queries.find(query => query.includes("FROM cache_purge_log") && !query.includes("DELETE")));
    expect(lookup).not.toMatch(/SCAN cache_purge_log|USE TEMP B-TREE/);
    expect(lookup).toMatch(/SEARCH cache_purge_log USING INDEX idx_cache_purge_log_status_action_created_at \(status=\? AND action=\?\)/);
    const prune = explain(queries.find(query => query.includes("DELETE FROM cache_purge_log")));
    expect(prune).toContain("idx_cache_purge_log_status_action_created_at (status=? AND action=? AND created_at<?)");
    const migration = readFileSync(new URL("../migrations/0073_cache_purge_log_index.sql", import.meta.url), "utf8");
    expect(() => sql.prepare(migration).run()).not.toThrow();
    expect(sql.prepare("SELECT name FROM pragma_index_info(?) ORDER BY seqno").all("idx_cache_purge_log_status_action_created_at"))
      .toEqual([{ name: "status" }, { name: "action" }, { name: "created_at" }]);
  });

  it("prunes at most 500 completed rows strictly older than seven days per tick", async () => {
    const cutoff = now - 7 * 24 * 60 * 60;
    for (let i = 0; i < 502; i++) {
      seed(i % 2 ? "purge_tags" : "purge_tags_second", { tags: ["old"] }, cutoff - 1, "completed");
    }
    seed("edge:tick:v1", { tags: ["old"] }, cutoff - 1, "completed");
    seed("purge_cache", { tags: ["admin"] }, cutoff - 1, "completed");
    seed("purge_tags_second", { tags: ["boundary"] }, cutoff, "completed");
    seed("purge_tags", { tags: ["newer"] }, cutoff + 1, "completed");
    seed("purge_tags", { tags: ["queued"], due_after: now + 1 }, cutoff - 1);
    seed("purge_tags", { tags: ["retry"], tries: 3, next_try_at: now + 1 }, cutoff - 1, "failed");
    seed("purge_cache", { tags: ["audit"] }, cutoff - 1, "completed_dry_run");
    await runEdgePurgeCron(env, ctx);
    expect(logRows().filter(row => row.payload.tags[0] === "old")).toHaveLength(3);
    await runEdgePurgeCron(env, ctx);
    expect(logRows().map(row => [row.status, row.payload.tags[0]])).toEqual([
      ["completed", "admin"], ["completed", "boundary"], ["completed", "newer"], ["pending", "queued"], ["failed", "retry"], ["completed_dry_run", "audit"],
    ]);
    expect(purge).not.toHaveBeenCalled();
  });

  it("retains the completed provisioning audit receipt after seven days", async () => {
    const expired = now - 7 * 24 * 60 * 60 - 1;
    const action = "attach_domain_to_new_worker_or_mark_pending";
    const payload = { hostname: "site-a.example", attached: true };
    seed(action, payload, expired, "completed");
    seed("purge_tags", { tags: ["site:site-a"] }, expired, "completed");
    await runEdgePurgeCron(env, ctx);
    expect(sql.prepare("SELECT action, status, payload, created_at FROM cache_purge_log").all())
      .toEqual([{ action, status: "completed", payload: JSON.stringify(payload), created_at: expired }]);
  });

  it("keeps only unpurged tags when one chunk of a row succeeds and the other fails", async () => {
    const tags = Array.from({ length: 103 }, (_, i) => `slug:a:${i}`);
    seed("purge_tags", { tags: tags.slice(0, 99) });
    seed("purge_tags_second", { tags: tags.slice(98), due_after: now });
    purge.mockResolvedValueOnce(success).mockResolvedValueOnce(limited);
    await runEdgePurgeCron(env, ctx);
    expect(purge.mock.calls).toEqual([[tags.slice(0, 100)], [tags.slice(100)]]);
    expect(logRows()[0]?.status).toBe("completed");
    expect(logRows()[1]).toMatchObject({ status: "pending", payload: { tags: tags.slice(100), tries: 1, due_after: now } });
    purge.mockClear();
    await runEdgePurgeCron(env, ctx);
    expect(purge).toHaveBeenCalledExactlyOnceWith(tags.slice(100));
    expect(logRows().map(r => r.status)).toEqual(["completed", "completed"]);
  });

  it("alarms on the third failure and each hourly failure until the purge succeeds", async () => {
    seed("purge_tags", { tags: ["slug:a:one"], tries: 0, reason: "publish" });
    purge.mockResolvedValue(limited);
    const alarms = () => vi.mocked(console.error).mock.calls.map(([line]) => JSON.parse(line)).filter(event => event.t === "purge_failed");
    for (const tries of [1, 2, 3]) {
      await runEdgePurgeCron(env, ctx);
      expect(logRows()[0]).toMatchObject({
        status: tries === 3 ? "failed" : "pending", payload: { tries, tags: ["slug:a:one"], reason: "publish" },
      });
      expect(alarms()).toEqual(tries === 3 ? [{ t: "purge_failed", tags: ["slug:a:one"], tries: 3 }] : []);
    }
    expect(logRows()[0]?.payload.next_try_at).toBe(now + 3600);
    vi.mocked(Date.now).mockReturnValue((now + 3600) * 1000 - 1);
    await runEdgePurgeCron(env, ctx);
    expect(purge).toHaveBeenCalledTimes(3);
    vi.mocked(Date.now).mockReturnValue((now + 3600) * 1000);
    await runEdgePurgeCron(env, ctx);
    expect(purge).toHaveBeenCalledTimes(4);
    expect(logRows()[0]).toMatchObject({ status: "failed", payload: { tries: 4, next_try_at: now + 7200 } });
    expect(alarms()).toEqual([3, 4].map(tries => ({ t: "purge_failed", tags: ["slug:a:one"], tries })));
    vi.mocked(Date.now).mockReturnValue((now + 7200) * 1000 - 1);
    await runEdgePurgeCron(env, ctx);
    expect(purge).toHaveBeenCalledTimes(4);
    vi.mocked(Date.now).mockReturnValue((now + 7200) * 1000);
    purge.mockResolvedValue(success);
    await runEdgePurgeCron(env, ctx);
    await runEdgePurgeCron(env, ctx);
    expect(purge).toHaveBeenCalledTimes(5);
    expect(purge).toHaveBeenLastCalledWith(["slug:a:one"]);
    expect(logRows()[0]?.status).toBe("completed");
    expect(alarms()).toHaveLength(2);
  });

  it("recovers legacy failed rows once across overlapping hourly retries", async () => {
    seed("purge_tags_second", { tags: ["snap:a"], tries: 3, due_after: now - 30 }, now - 60, "failed");
    purge.mockImplementationOnce(async () => {
      await runEdgePurgeCron(env, ctx);
      return limited;
    });
    await runEdgePurgeCron(env, ctx);
    expect(purge).toHaveBeenCalledExactlyOnceWith(["snap:a"]);
    expect(logRows()[0]).toMatchObject({ status: "failed", payload: { tries: 4, next_try_at: now + 3600 } });
    expect(console.error).toHaveBeenCalledWith(JSON.stringify({ t: "purge_failed", tags: ["snap:a"], tries: 4 }));
    seed("purge_tags", { tags: ["fresh"] });
    await runEdgePurgeCron(env, ctx);
    expect(purge.mock.calls).toEqual([[["snap:a"]], [["fresh"]]]);
    expect(logRows().map(row => row.status)).toEqual(["failed", "completed"]);
  });

  it("retains the hourly deadline if D1 cannot settle a successful retry", async () => {
    seed("purge_tags", { tags: ["site:a"], tries: 3, next_try_at: now }, now - 3600, "failed");
    purge.mockImplementationOnce(async () => {
      vi.spyOn(env.DB, "batch").mockRejectedValueOnce(new Error("D1 write unavailable"));
      return success;
    });
    await runEdgePurgeCron(env, ctx);
    expect(logRows()[0]).toMatchObject({ status: "failed", payload: { next_try_at: now + 3600 } });
    await runEdgePurgeCron(env, ctx);
    expect(purge).toHaveBeenCalledExactlyOnceWith(["site:a"]);
    vi.mocked(Date.now).mockReturnValue((now + 3600) * 1000);
    await runEdgePurgeCron(env, ctx);
    expect(purge.mock.calls).toEqual([[["site:a"]], [["site:a"]]]);
    expect(logRows()[0]?.status).toBe("completed");
  });

  it("keeps tags outside the call budget pending when attempted tags reach their third failure", async () => {
    const tags = Array.from({ length: 250 }, (_, i) => `slug:a:${i}`);
    seed("purge_tags_second", { tags, due_after: now, tries: 2 });
    purge.mockResolvedValueOnce(limited).mockResolvedValueOnce(success);
    await runEdgePurgeCron(env, ctx);
    expect(logRows().find(r => r.status === "failed")?.payload.tags).toEqual(tags.slice(0, 100));
    expect(logRows().find(r => r.status === "failed")?.payload.next_try_at).toBe(now + 3600);
    expect(logRows().find(r => r.status === "pending")?.payload.tags).toEqual(tags.slice(200));
    purge.mockClear();
    await runEdgePurgeCron(env, ctx);
    expect(purge).toHaveBeenCalledExactlyOnceWith(tags.slice(200));
  });

  it("processes valid rows alongside malformed payloads without letting JSON errors escape", async () => {
    sql.prepare("INSERT INTO cache_purge_log (action, status, dry_run, payload) VALUES ('purge_tags', 'pending', 0, ?)").run("{");
    seed("purge_tags_second", { tags: ["snap:a"], due_after: now });
    for (let i = 0; i < 3; i++) await expect(runEdgePurgeCron(env, ctx)).resolves.toBeUndefined();
    expect(purge).toHaveBeenCalledExactlyOnceWith(["snap:a"]);
    expect(logRows().map(r => r.status)).toEqual(["failed", "completed"]);
    expect(console.error).toHaveBeenCalledWith(JSON.stringify({ t: "purge_failed", tags: [], tries: 3 }));
  });

  it("keeps a newer cron outcome when an overlapping attempt reports an older failure", async () => {
    seed("purge_tags", { tags: ["snap:a"], tries: 2 });
    purge.mockImplementationOnce(async () => {
      await runEdgePurgeCron(env, ctx);
      return limited;
    });
    await runEdgePurgeCron(env, ctx);
    expect(logRows()[0]?.status).toBe("completed");
    expect(vi.mocked(console.error).mock.calls.map(([line]) => JSON.parse(line).t)).not.toContain("purge_failed");
  });

  it("records a confirmed purge when an overlapping run exhausted the same row's retries", async () => {
    seed("purge_tags", { tags: ["snap:a"], tries: 2 });
    purge.mockImplementationOnce(async () => {
      await runEdgePurgeCron(env, ctx);
      return success;
    }).mockResolvedValueOnce(limited);
    await runEdgePurgeCron(env, ctx);
    expect(logRows()[0]?.status).toBe("completed");
  });

  it("replays the pending row if D1 cannot save a successful purge", async () => {
    seed("purge_tags", { tags: ["snap:a"], tries: 0 });
    vi.spyOn(env.DB, "batch").mockRejectedValueOnce(new Error("D1 write unavailable"));
    await expect(runEdgePurgeCron(env, ctx)).resolves.toBeUndefined();
    expect(logRows()[0]).toMatchObject({ status: "pending", payload: { tries: 0 } });
    await runEdgePurgeCron(env, ctx);
    expect(purge.mock.calls).toEqual([[["snap:a"]], [["snap:a"]]]);
    expect(logRows()[0]?.status).toBe("completed");
  });
});
