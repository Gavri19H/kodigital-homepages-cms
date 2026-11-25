import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSiteSnapshot, parseSiteSnapshot } from "../src/edge/snapshot";
import type { SiteSnapshot } from "../src/edge/types";
import type { Env } from "../src/env";
import { makeFakeDb } from "./helpers/admin-test-kit";
import { addSite, createDb, env as testEnv, type SqliteDb } from "./helpers/x06-a2-sqlite";

function readBatch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
  return Promise.all(statements.map(statement => statement.all<T>()));
}

describe("buildSiteSnapshot", () => {
  let sql: SqliteDb;
  let env: Env;

  beforeEach(() => {
    sql = createDb();
    env = testEnv(sql);
    env.DB.batch = readBatch;
    addSite(sql, "site-north", "North", "home");
    addSite(sql, "site-south", "South", "travel");
    const domain = sql.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')");
    domain.run("site-north", "north.example");
    domain.run("site-south", "south.example");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sql.close();
  });

  it("round-trips each registry host with its own site ID and routing entries", async () => {
    const article = sql.prepare(`INSERT INTO listicle_articles (site_id, public_id, slug, article_name, status)
      VALUES (?, ?, 'guide', 'Guide', 'published')`).run("site-north", "art_guide");
    sql.prepare(`INSERT INTO listicle_article_versions (article_id, public_id, headline, intro_paragraph, status)
      VALUES (?, ?, 'Guide', 'Intro', 'active')`).run(article.lastInsertRowid, "ver_guide");

    const quoteId = "lgq_00000000000000000000000001";
    const quote = sql.prepare(`INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status)
      VALUES (?, 'Life', 'quote_funnel', '["life"]', 'active')`).run(quoteId);
    sql.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled) VALUES (?, ?, 1)")
      .run("site-south", quote.lastInsertRowid);

    const [north, south] = await Promise.all([
      buildSiteSnapshot(env, "NORTH.Example.:443"),
      buildSiteSnapshot(env, "south.example"),
    ]);
    expect(north).toMatchObject({ siteId: "site-north", hostname: "north.example", verticalSlug: "home", status: "active",
      listicles: { guide: { listicleId: "art_guide", publishedVersion: { public_id: "ver_guide" } } } });
    expect(north?.leadgen).toEqual({});
    expect(south).toMatchObject({ siteId: "site-south", hostname: "south.example", verticalSlug: "travel", status: "active",
      leadgen: { "/lg": { quoteId } } });
    expect(south?.listicles).toEqual({});
    for (const snapshot of [north, south]) {
      expect(parseSiteSnapshot(JSON.stringify(snapshot))).toEqual(snapshot);
    }
  });

  it("reads the stored versions, bookmark and trimmed settings with per-site defaults", async () => {
    const now = Date.UTC(2026, 10, 24);
    vi.spyOn(Date, "now").mockReturnValue(now);
    sql.prepare("UPDATE sites SET content_version = ?, settings_version = ?, write_bookmark = ? WHERE id = ?")
      .run(17, 3, "stored-bookmark", "site-north");
    const setting = sql.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
    setting.run("site-north", "site_timezone", " Asia/Jerusalem ");
    setting.run("site-north", "site_language", " he-IL ");

    await expect(buildSiteSnapshot(env, "north.example")).resolves.toMatchObject({
      v: 1, contentVersion: 17, settingsVersion: 3, writeBookmark: "stored-bookmark",
      timeZone: "Asia/Jerusalem", language: "he-IL", builtAt: now,
    });
    await expect(buildSiteSnapshot(env, "south.example")).resolves.toMatchObject({
      v: 1, contentVersion: 1, settingsVersion: 1, writeBookmark: null,
      timeZone: "", language: "", builtAt: now,
    });
  });

  it("uses one first-primary session for all reads and one query each for versions and settings", async () => {
    const session = {
      prepare: vi.fn(env.DB.prepare.bind(env.DB)),
      batch: env.DB.batch.bind(env.DB),
      getBookmark: () => "read-session-bookmark",
    };
    env.DB.withSession = vi.fn(() => session);
    const directRead = vi.spyOn(env.DB, "prepare");
    const directBatch = vi.spyOn(env.DB, "batch");

    await expect(buildSiteSnapshot(env, "north.example")).resolves.toMatchObject({ siteId: "site-north", writeBookmark: null });
    expect(env.DB.withSession).toHaveBeenCalledExactlyOnceWith("first-primary");
    expect(directRead).not.toHaveBeenCalled();
    expect(directBatch).not.toHaveBeenCalled();
    const queries = session.prepare.mock.calls.map(([query]) => query);
    expect(queries.filter(query => /\bFROM sites\b/i.test(query))).toHaveLength(1);
    expect(queries.filter(query => /\bFROM site_settings\b/i.test(query))).toHaveLength(1);
  });

  it("returns null for unknown hosts, unregistered site domains and even a registered admin host", async () => {
    env.ADMIN_HOST = "cms.example";
    sql.prepare("INSERT INTO domains (site_id, hostname, kind, status) VALUES (?, ?, 'alias', 'active')")
      .run("site-north", env.ADMIN_HOST);
    for (const host of ["unknown.example", "site-north.example", "CMS.Example.:443"]) {
      await expect(buildSiteSnapshot(env, host)).resolves.toBeNull();
    }
  });

  it("leaves disabled sites and pending domains to the public middleware", async () => {
    sql.prepare("UPDATE sites SET status = 'disabled' WHERE id = ?").run("site-north");
    sql.prepare("UPDATE domains SET status = 'pending' WHERE hostname = ?").run("south.example");
    await expect(buildSiteSnapshot(env, "north.example")).resolves.toBeNull();
    await expect(buildSiteSnapshot(env, "south.example")).resolves.toBeNull();
  });

  it("rejects if the site disappears after host resolution", async () => {
    const { db } = makeFakeDb([{
      match: "FROM domains",
      row: { site_id: "site-north", hostname: "north.example", status: "active" },
    }]);
    db.batch = readBatch;
    await expect(buildSiteSnapshot({ ...env, DB: db }, "north.example"))
      .rejects.toThrow("Missing versions for resolved site");
  });

  it("propagates a listicle read failure", async () => {
    sql.prepare("ALTER TABLE listicle_article_versions RENAME TO unavailable_versions").run();
    await expect(buildSiteSnapshot(env, "north.example")).rejects.toThrow("no such table: listicle_article_versions");
  });

  it("propagates a leadgen read failure", async () => {
    sql.prepare("ALTER TABLE leadgen_quote_routing_rules RENAME TO unavailable_rules").run();
    await expect(buildSiteSnapshot(env, "south.example")).rejects.toThrow("no such table: leadgen_quote_routing_rules");
  });
});

describe("parseSiteSnapshot", () => {
  const snapshot: SiteSnapshot = {
    v: 1, siteId: "site-north", hostname: "north.example", verticalSlug: "home", status: "active",
    contentVersion: 4, settingsVersion: 2, writeBookmark: null, builtAt: 1000,
    timeZone: null, language: null, listicles: {}, leadgen: {},
  };

  it("returns null for truncated JSON, garbage and non-object roots", () => {
    for (const text of ['{"v":', "garbage", "", "null", "[]", '"north.example"']) {
      expect(parseSiteSnapshot(text)).toBeNull();
    }
  });

  it.each([
    ["unsupported snapshot version", { v: 2 }],
    ["blank site ID", { siteId: " " }],
    ["blank vertical slug", { verticalSlug: " " }],
    ["non-string vertical slug", { verticalSlug: 3 }],
    ["empty hostname", { hostname: "" }],
    ["string content version", { contentVersion: "4" }],
    ["missing settings version", { settingsVersion: undefined }],
    ["listicle array", { listicles: [] }],
    ["null leadgen map", { leadgen: null }],
    ["numeric bookmark", { writeBookmark: 2 }],
    ["missing timestamp", { builtAt: undefined }],
  ] as const)("rejects a snapshot with %s", (_description, fields) => {
    expect(parseSiteSnapshot(JSON.stringify({ ...snapshot, ...fields }))).toBeNull();
  });

  it("rejects oversized text even when the entire payload is valid JSON", () => {
    const atLimit = JSON.stringify(snapshot).padEnd(1024 * 1024);
    expect(parseSiteSnapshot(atLimit)).toEqual(snapshot);
    expect(parseSiteSnapshot(atLimit + " ")).toBeNull();
  });
});
