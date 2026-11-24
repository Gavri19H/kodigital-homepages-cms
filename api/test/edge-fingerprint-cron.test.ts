import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFingerprintCron } from "../src/edge/fingerprint-cron";
import { onPublicChange, runEdgePurgeCron } from "../src/edge/public-change";
import type { Env } from "../src/env";
import worker from "../src/index";
import { makeKvStub } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv, hasSqlite, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("../src/edge/public-change", { spy: true });

const fingerprintKey = "edge:fp:v1";
const versionKey = "edge:ver:v1";
const siteIds = ["Site-A", "Site-B", "Site-C"];
const allTags = ["site:site-a", "site:site-b", "site:site-c"];
const purge = vi.fn(async (_tags: string[]) => ({ success: true, errors: [] }));
const ctx = { exports: { PublicPage: { purgeTags: purge } }, waitUntil: vi.fn() } as unknown as ExecutionContext;

describe.skipIf(!hasSqlite)("public fingerprint minute job", () => {
  let db: SqliteDb;
  let env: Env;
  let seconds: number;
  let store: Map<string, string>;

  beforeEach(() => {
    db = createDb();
    for (const id of siteIds) addSite(db, id, id, "home");
    env = sqliteEnv(db);
    // SELECTs in a D1 batch return rows. Keep the helper's transaction around them.
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = <T>(statements: D1PreparedStatement[]) => {
      for (const statement of statements) statement.run = statement.all.bind(statement);
      return batch<T>(statements);
    };
    vi.spyOn(env.DB, "batch");
    const cache = makeKvStub();
    store = cache.store;
    env.CACHE = cache.kv;
    vi.spyOn(env.CACHE, "get");
    vi.spyOn(env.CACHE, "put");
    seconds = (db.prepare("SELECT unixepoch() AS now").get() as { now: number }).now;
    // D1 defaults and the Worker must observe the same clock at a tick boundary.
    if (typeof db.function === "function") db.function("unixepoch", () => seconds);
    vi.spyOn(Date, "now").mockImplementation(() => seconds * 1000);
    vi.spyOn(console, "error").mockImplementation(() => {});
    purge.mockClear();
    vi.mocked(onPublicChange).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    db.close();
  });

  function tick(elapsed = 60) {
    seconds += elapsed;
    return runFingerprintCron(env, ctx);
  }

  function record(site: string | null, action: string, tags: string[], created = seconds, status = "pending") {
    db.prepare(`INSERT INTO cache_purge_log (site_id, action, status, dry_run, payload, created_at)
                VALUES (?, ?, ?, 0, ?, ?)`).run(site, action, status, JSON.stringify({ tags }), created);
  }

  function addArticle(site: string, slug = "news", updated = seconds) {
    db.prepare(`INSERT INTO articles (site_id, slug, title, content_json, status, updated_at)
                VALUES (?, ?, 'News', '{}', 'published', ?)`).run(site, slug, updated);
  }

  function expectSweep(tags: string[], sites: string[]) {
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(env, ctx, { siteId: null, tags, reason: "fingerprint" });
    expect(purge).toHaveBeenCalledExactlyOnceWith(tags);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ t: "missed_write_path", sites }));
  }

  it("baselines without a purge, then spends one D1 batch and zero KV writes per quiet minute", async () => {
    db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)").run("Site-A", "site_title", "Title");
    await tick(0);
    expect(env.CACHE.put).toHaveBeenCalledExactlyOnceWith(fingerprintKey, expect.any(String));
    expect(Object.keys(JSON.parse(store.get(fingerprintKey)!).sites)).toEqual(siteIds);
    expect(store.get(fingerprintKey)).not.toContain("Title");
    vi.mocked(env.CACHE.put).mockClear();
    db.prepare("UPDATE sites SET write_bookmark = ?, settings_version = settings_version + 1 WHERE id = ?")
      .run("0002", "Site-A");
    db.prepare("INSERT INTO leadgen_persona_quota (site_id, period_ym, used) VALUES (?, ?, ?)").run("Site-B", "2026-11", 1);
    await tick();
    await tick();
    expect(env.DB.batch).toHaveBeenCalledTimes(3);
    expect(env.CACHE.get).not.toHaveBeenCalledWith(versionKey);
    expect(env.CACHE.put).not.toHaveBeenCalled();
    expect(onPublicChange).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("honors both pending and completed change records, including records in the baseline's last second", async () => {
    await tick(0);
    addArticle("Site-A");
    db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)").run("Site-B", "site_title", "News");
    record("Site-A", "purge_tags_second", ["slug:site-a:news"], seconds, "completed");
    record("Site-B", "purge_tags", ["site:site-b"]);
    await tick();
    expect(onPublicChange).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(env.CACHE.put).toHaveBeenCalledTimes(2);
    await tick();
    expect(env.CACHE.put).toHaveBeenCalledTimes(2);
  });

  it("merges only uncovered sites, including when a NULL-site writer records a tagged fan-out", async () => {
    record("Site-A", "purge_tags_second", ["site:site-a"]);
    await tick(0);
    for (const id of siteIds) addArticle(id);
    record(null, "purge_tags_second", ["site:site-c"]);
    record("Site-B", "warm_homepage", ["site:site-b"]);
    await tick();
    expectSweep(allTags.slice(0, 2), siteIds.slice(0, 2));
  });

  it("a change record observed on one tick cannot cover a later missed write, even if the next tick runs early", async () => {
    await tick(0);
    record("Site-A", "purge_tags_second", ["site:site-a"], seconds + 75);
    await tick(80);
    expect(onPublicChange).not.toHaveBeenCalled();
    addArticle("Site-A");
    await tick(40);
    expectSweep(["site:site-a"], ["Site-A"]);
  });

  it("honors a writer's change record after a delayed tick", async () => {
    await tick(0);
    addArticle("Site-A");
    record("Site-A", "purge_tags_second", ["slug:site-a:news"], seconds + 5);
    await tick(125);
    expect(onPublicChange).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(env.CACHE.put).toHaveBeenCalledTimes(2);
  });

  it("detects deletions independently of the latest timestamp", async () => {
    addArticle("Site-A", "older", 100);
    addArticle("Site-A", "newer", 200);
    await tick(0);
    db.prepare("DELETE FROM articles WHERE site_id = ? AND slug = ?").run("Site-A", "older");
    db.prepare("DELETE FROM sites WHERE id = ?").run("Site-C");
    await tick();
    expectSweep(["site:site-a", "site:site-c"], ["Site-A", "Site-C"]);
  });

  it("detects equal-length edits without a timestamp and attributes version edits to the parent listicle's site", async () => {
    db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)").run("Site-A", "site_title", "One");
    db.prepare("INSERT INTO redirects (site_id, source_path, destination_path) VALUES (?, ?, ?)").run("Site-B", "/old", "/one");
    const article = db.prepare(`INSERT INTO listicle_articles (site_id, public_id, slug, article_name, status)
                                VALUES (?, ?, ?, ?, 'published')`).run("Site-C", "lst", "guide", "Guide");
    db.prepare(`INSERT INTO listicle_article_versions (public_id, article_id, headline, intro_paragraph)
                VALUES (?, ?, ?, ?)`).run("ver", article.lastInsertRowid, "Guide", "Intro");
    await tick(0);
    db.prepare("UPDATE redirects SET hit_count = hit_count + 1").run();
    await tick();
    expect(onPublicChange).not.toHaveBeenCalled();
    expect(env.CACHE.put).toHaveBeenCalledTimes(1);
    db.prepare("UPDATE site_settings SET value = ? WHERE key = ?").run("Two", "site_title");
    db.prepare("UPDATE redirects SET destination_path = ? WHERE site_id = ?").run("/two", "Site-B");
    db.prepare("UPDATE listicle_article_versions SET content_version = content_version + 1 WHERE public_id = ?").run("ver");
    await tick();
    expectSweep(allTags, siteIds);
  });

  it("purges all sites for an in-place global rule edit, even in the minute following another safety-net purge", async () => {
    const quote = db.prepare(`INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json)
                              VALUES (?, ?, ?, ?)`).run("quote", "Quote", "main", "[]");
    db.prepare(`INSERT INTO leadgen_quote_routing_rules (public_id, quote_id, rule_name, conditions_json, conditions_hash, redirect_url)
                VALUES (?, ?, ?, ?, ?, ?)`).run("rule", quote.lastInsertRowid, "redirect", "{}", "hash", "/one");
    await tick(0);
    addArticle("Site-B");
    await tick();
    expectSweep(["site:site-b"], ["Site-B"]);
    vi.clearAllMocks();
    db.prepare("UPDATE leadgen_quote_routing_rules SET redirect_url = ? WHERE public_id = ?").run("/two", "rule");
    await tick();
    expectSweep(allTags, siteIds);
  });

  it("keeps the writer's narrower purge when a global configuration change has a change record", async () => {
    await tick(0);
    db.prepare("UPDATE leadgen_frame_templates SET updated_at = updated_at + 1").run();
    record("Site-A", "purge_tags_second", ["quote:one"]);
    await tick();
    expect(onPublicChange).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(env.CACHE.put).toHaveBeenCalledTimes(2);
  });

  it("keeps the site fingerprint stable on the tick after onPublicChange bumps its content version", async () => {
    await tick(0);
    const baseline = JSON.parse(store.get(fingerprintKey)!).sites;
    await onPublicChange(env, ctx, { siteId: "Site-A", tags: ["slug:site-a:news"], reason: "article.update" });
    expect(db.prepare("SELECT content_version FROM sites WHERE id = ?").get("Site-A")).toEqual({ content_version: 2 });
    expect(purge).toHaveBeenCalledExactlyOnceWith(["slug:site-a:news", "snap:site-a", "nf:site-a"]);
    vi.clearAllMocks();
    await tick();
    expect(JSON.parse(store.get(fingerprintKey)!).sites).toEqual(baseline);
    expect(onPublicChange).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("purges a new Worker version on its first tick and only once per version id", async () => {
    env.CF_VERSION_METADATA = { id: "v1" };
    purge.mockImplementationOnce(async () => {
      expect(store.has(versionKey)).toBe(false);
      return { success: true, errors: [] };
    });
    await tick(0);
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(env, ctx, { siteId: null, tags: allTags, reason: "version" });
    expect(purge).toHaveBeenCalledExactlyOnceWith(allTags);
    expect(store.get(versionKey)).toBe("v1");
    expect(db.prepare("SELECT id FROM sites WHERE content_version = 2 ORDER BY id").all())
      .toEqual(siteIds.map(id => ({ id })));
    vi.clearAllMocks();
    env.CF_VERSION_METADATA = { id: "v1", tag: "latest" };
    await tick();
    expect(purge).not.toHaveBeenCalled();
    expect(env.CACHE.put).not.toHaveBeenCalled();
    expect(onPublicChange).not.toHaveBeenCalled();
    env.CF_VERSION_METADATA = { id: "v2" };
    await tick();
    await tick();
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(env, ctx, { siteId: null, tags: allTags, reason: "version" });
    expect(purge).toHaveBeenCalledExactlyOnceWith(allTags);
    expect(store.get(versionKey)).toBe("v2");
    expect(console.error).not.toHaveBeenCalled();
  });

  it("coalesces a deployment and a missed site write into one purge and reports only the missed site", async () => {
    await tick(0);
    env.CF_VERSION_METADATA = { id: "release" };
    addArticle("Site-C");
    await tick();
    expectSweep(allTags, ["Site-C"]);
    expect(store.get(versionKey)).toBe("release");
  });

  it("hands every site to the durable purge queue when a version has over 100 sites and no execution context", async () => {
    for (let i = 0; i < 100; i++) addSite(db, "extra-" + i, "Extra", "home");
    const ids = db.prepare("SELECT id FROM sites ORDER BY id").all() as { id: string }[];
    const tags = ids.map(({ id }) => "site:" + id.toLowerCase());
    env.CF_VERSION_METADATA = { id: "release" };
    await runFingerprintCron(env, undefined);
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(env, undefined, { siteId: null, tags, reason: "version" });
    const queued = db.prepare("SELECT payload FROM cache_purge_log WHERE action = 'purge_tags' AND status = 'pending'").get() as { payload: string };
    expect(JSON.parse(queued.payload).tags).toEqual(tags);
    expect(store.get(versionKey)).toBe("release");
  });

  it("the scheduled handler still checks fingerprints after its pending-purge job throws", async () => {
    await tick(0);
    vi.mocked(runEdgePurgeCron).mockImplementationOnce(async () => {
      addArticle("Site-B");
      throw new Error("pending purge interrupted");
    });
    const controller = { cron: "* * * * *", scheduledTime: seconds * 1000, noRetry() {} } as ScheduledController;
    await worker.scheduled!(controller, env, ctx);
    expect(runEdgePurgeCron).toHaveBeenCalledWith(env, ctx);
    expectSweep(["site:site-b"], ["Site-B"]);
  });

  it.each(["{", "null", '{"sites":[],"global":1}'])("replaces a corrupt checkpoint %s without purging", async raw => {
    store.set(fingerprintKey, raw);
    await expect(tick(0)).resolves.toBeUndefined();
    expect(Object.keys(JSON.parse(store.get(fingerprintKey)!).sites)).toEqual(siteIds);
    await tick();
    expect(env.CACHE.put).toHaveBeenCalledTimes(1);
    expect(onPublicChange).not.toHaveBeenCalled();
  });

  it("retains both checkpoints on a D1 error and retries the missed change on the next successful tick", async () => {
    await tick(0);
    vi.clearAllMocks();
    addArticle("Site-A");
    env.CF_VERSION_METADATA = { id: "next" };
    vi.mocked(env.DB.batch).mockRejectedValueOnce(new Error("D1 unavailable"));
    await expect(tick()).resolves.toBeUndefined();
    expect(env.CACHE.put).not.toHaveBeenCalled();
    expect(onPublicChange).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ t: "fingerprint_cron_error", error: "D1 unavailable" }));
    vi.clearAllMocks();
    await tick();
    expectSweep(allTags, ["Site-A"]);
    expect(store.get(versionKey)).toBe("next");
  });
});
