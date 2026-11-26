import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyEdgeCacheHeaders } from "../src/cache/cache-control";
import { runFingerprintCron } from "../src/edge/fingerprint-cron";
import { onPublicChange, runEdgePurgeCron } from "../src/edge/public-change";
import { siteQuoteTag } from "../src/edge/tags";
import type { PublicPageProps } from "../src/edge/types";
import type { Env } from "../src/env";
import worker, { PublicPage } from "../src/index";
import { purgeArticleChange } from "../src/workflow/publish";
import { ctxCapture, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv, hasSqlite, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("../src/edge/public-change", { spy: true });
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const fingerprintKey = "edge:fp:v1";
const legacyVersionKey = "edge:ver:v1";
const seenVersionsKey = "edge:ver-seen:v2";
const siteIds = ["Site-A", "Site-B", "Site-C"];
const allTags = ["site:site-a", "site:site-b", "site:site-c"];
const purge = vi.fn(async (_tags: string[]) => ({ success: true, errors: [] }));
const ctx = { exports: { PublicPage: { purgeTags: purge } }, waitUntil: vi.fn() } as unknown as ExecutionContext;

// Version branch from c38f5840's runFingerprintCron, for this fixture's unchanged sites.
async function legacyVersionTick(env: Env, ctx: ExecutionContext | undefined) {
  const version = env.CF_VERSION_METADATA?.id;
  const [, oldVersion] = await Promise.all([
    env.CACHE.get(fingerprintKey), version ? env.CACHE.get(legacyVersionKey) : null,
  ]);
  const versionChanged = Boolean(version && version !== oldVersion);
  if (versionChanged) await onPublicChange(env, ctx, { siteId: null, tags: allTags, reason: "version" });
  if (versionChanged && version) await env.CACHE.put(legacyVersionKey, version);
}

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

  function editArticle() {
    expect(db.prepare("UPDATE articles SET title = ?, updated_at = updated_at + 1 WHERE site_id = ? AND slug = ?")
      .run("Edited title", "Site-A", "news").changes).toBe(1);
  }

  function addQuote() {
    return Number(db.prepare("INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json) VALUES (?, ?, ?, ?)")
      .run("quote", "Quote", "main", "[]").lastInsertRowid);
  }

  function activate(site: string, quote: number, enabled = 1) {
    db.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, slug, enabled) VALUES (?, ?, ?, ?)")
      .run(site, quote, "home-insurance", enabled);
  }

  function publishListicle(site: string, offer: string) {
    const article = db.prepare(`INSERT INTO listicle_articles (site_id, public_id, slug, article_name, status)
      VALUES (?, ?, 'guide', 'Guide', 'published')`).run(site, "lst-" + site).lastInsertRowid;
    const version = db.prepare(`INSERT INTO listicle_article_versions (article_id, public_id, headline, intro_paragraph)
      VALUES (?, ?, 'Guide', 'Intro')`).run(article, "ver-" + site).lastInsertRowid;
    const page = db.prepare("INSERT INTO listicle_pages (article_version_id, public_id, page_index) VALUES (?, ?, 0)")
      .run(version, "page-" + site).lastInsertRowid;
    const blocks = JSON.stringify({ blocks: [{ type: "button", id: "go", data: { text: "Go", offer_id: offer } }] });
    const section = db.prepare(`INSERT INTO listicle_sections (public_id, section_name, headline_text, content_json)
      VALUES (?, 'Offers', 'Offer', ?)`).run("section-" + site, blocks).lastInsertRowid;
    db.prepare(`INSERT INTO listicle_page_section_candidates (public_id, page_id, section_id)
      VALUES (?, ?, ?)`).run("cand-" + site, page, section);
    return section;
  }

  function expectNoSweep() {
    expect(onPublicChange).not.toHaveBeenCalled();
    expect(purge).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  }

  function expectSweep(tags: string[], missedSites: string[]) {
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(env, ctx, { siteId: null, tags, reason: "fingerprint" });
    expect(purge).toHaveBeenCalledExactlyOnceWith(tags);
    if (missedSites.length) {
      expect(console.error).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ t: "missed_write_path", sites: missedSites }));
    } else {
      expect(console.error).not.toHaveBeenCalled();
    }
  }

  it("baselines without a purge, then spends one D1 batch and zero KV writes per quiet minute", async () => {
    db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)").run("Site-A", "site_title", "Title");
    await tick(0);
    expect(env.CACHE.put).toHaveBeenCalledExactlyOnceWith(fingerprintKey, expect.any(String));
    expect(Object.keys(JSON.parse(store.get(fingerprintKey)!).sites)).toEqual(siteIds);
    expect(store.get(fingerprintKey)).not.toContain("Title");
    vi.mocked(env.CACHE.put).mockClear();
    const prepare = vi.spyOn(env.DB, "prepare");
    db.prepare("UPDATE sites SET write_bookmark = ?, settings_version = settings_version + 1 WHERE id = ?")
      .run("0002", "Site-A");
    db.prepare("INSERT INTO leadgen_persona_quota (site_id, period_ym, used) VALUES (?, ?, ?)").run("Site-B", "2026-11", 1);
    await tick();
    await tick();
    expect(env.DB.batch).toHaveBeenCalledTimes(3);
    expect(prepare.mock.calls.filter(([query]) => query.includes("cache_purge_log"))).toEqual([]);
    expect(env.CACHE.get).not.toHaveBeenCalledWith(legacyVersionKey);
    expect(env.CACHE.get).not.toHaveBeenCalledWith(seenVersionsKey);
    expect(env.CACHE.put).not.toHaveBeenCalled();
    expect(onPublicChange).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
  });

  it("keeps an unrelated cached quote after a recorded article edit and both targeted purge passes", async () => {
    addArticle("Site-A");
    activate("Site-A", addQuote());
    const quote = applyEdgeCacheHeaders(new Response("cached quote"), {
      siteId: "Site-A", path: "/lg/home-insurance", extraTags: [siteQuoteTag("Site-A", "quote")],
    });
    const quoteTags = quote.headers.get("Cache-Tag")!.split(",");
    expect(quoteTags).toEqual(["site:site-a", "quote:site-a:quote"]);
    await tick(0);
    editArticle();
    await purgeArticleChange(env, "Site-A", ["news"], "article.update", ctx);
    const targeted = ["slug:site-a:news", "listing:site-a", "snap:site-a", "nf:site-a"];
    expect(purge).toHaveBeenCalledExactlyOnceWith(targeted);
    await tick();
    expect(purge).toHaveBeenCalledExactlyOnceWith(targeted);
    expect(onPublicChange).toHaveBeenCalledTimes(1);
    await runEdgePurgeCron(env, ctx);
    expect(purge.mock.calls).toEqual([[targeted], [targeted]]);
    const purgedTags = new Set(purge.mock.calls.flatMap(([tags]) => tags));
    expect(quoteTags.filter(tag => purgedTags.has(tag))).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("purges the edited site and logs the missed article write on the next minute when D1 has no receipt", async () => {
    addArticle("Site-A");
    await tick(0);
    editArticle();
    await tick(60);
    expectSweep(["site:site-a"], ["Site-A"]);
  });

  it("records the primary bookmark before a missed-write purge and serves the edited quote from a new bundle", async () => {
    const site = "Site-A";
    const hostname = "site-a.example";
    const suffix = "0".repeat(25) + "1";
    const variant = "lgn_" + suffix;
    db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(site, hostname);
    db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, 'site_name', ?)").run(site, "Old quote title");
    db.prepare("UPDATE sites SET write_bookmark = ? WHERE id = ?").run("0001", site);
    const quote = db.prepare(`INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status)
      VALUES (?, 'Home', 'quote_funnel', '[]', 'active')`).run("lgq_" + suffix).lastInsertRowid;
    activate(site, Number(quote));
    const funnel = db.prepare(`INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status)
      VALUES (?, ?, 'Home', 'active')`).run("lgf_" + suffix, quote).lastInsertRowid;
    db.prepare("INSERT INTO leadgen_funnel_variants (public_id, funnel_id) VALUES (?, ?)").run(variant, funnel);
    env.DB.withSession = vi.fn(() => ({
      prepare: env.DB.prepare.bind(env.DB), batch: env.DB.batch.bind(env.DB), getBookmark: () => "0002",
    }));
    const page = ctxCapture();
    Object.assign(page.ctx, { exports: { PublicPage: ({ props }: { props: PublicPageProps }) =>
      new PublicPage({ ...page.ctx, props }, env) } });
    const bundleKeys = () => [...store.keys()].filter(key => key.startsWith(`lgbundle:${site}:${variant}:`));
    async function render() {
      // Every visit builds a fresh snapshot and shell through the real entrypoint.
      const request = new Request(`https://${hostname}/lg/home-insurance`, { headers: { Cookie: "ko_sid=returning" } });
      const response = await worker.fetch(request, env, page.ctx);
      expect(response.status).toBe(200);
      const html = await response.text();
      await Promise.all(page.promises);
      return html;
    }

    await tick(0);
    expect(await render()).toContain("<title>Old quote title</title>");
    const originalKeys = bundleKeys();
    expect(originalKeys).toHaveLength(1);

    seconds += 60;
    db.prepare("UPDATE site_settings SET value = ? WHERE site_id = ? AND key = 'site_name'").run("Edited quote title", site);
    vi.mocked(env.CACHE.get).mockClear();
    expect(await render()).toContain("<title>Old quote title</title>");
    expect(env.CACHE.get).toHaveBeenCalledWith(originalKeys[0]);
    expect(bundleKeys()).toEqual(originalKeys);

    let atPurge: unknown;
    purge.mockImplementationOnce(async () => {
      atPurge = db.prepare("SELECT id, content_version, write_bookmark FROM sites WHERE write_bookmark IS NOT NULL").all();
      return { success: true, errors: [] };
    });
    vi.mocked(env.DB.withSession).mockClear();
    // The rebuilt snapshot has the same builtAt as the stale one immediately above.
    await tick(0);
    expectSweep(["site:site-a"], [site]);
    expect(env.DB.withSession).toHaveBeenCalledExactlyOnceWith("first-primary");
    expect(atPurge).toEqual([{ id: site, content_version: 2, write_bookmark: "0002" }]);
    expect(await render()).toContain("<title>Edited quote title</title>");
    expect(bundleKeys()).toHaveLength(2);
    expect(bundleKeys()).toContain(originalKeys[0]);
    expect(env.DB.withSession).toHaveBeenCalledWith("0002");
  });

  it("detects an unrecorded settings change in the same minute as a recorded article edit on that site", async () => {
    addArticle("Site-A");
    db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)").run("Site-A", "site_title", "One");
    await tick(0);
    editArticle();
    await purgeArticleChange(env, "Site-A", ["news"], "article.update", ctx);
    expect(purge).toHaveBeenCalledExactlyOnceWith(["slug:site-a:news", "listing:site-a", "snap:site-a", "nf:site-a"]);
    vi.clearAllMocks();
    db.prepare("UPDATE site_settings SET value = ? WHERE site_id = ? AND key = ?").run("Two", "Site-A", "site_title");
    await tick(60);
    expectSweep(["site:site-a"], ["Site-A"]);
  });

  it("recognizes pending and completed source receipts in the baseline's last second", async () => {
    await tick(0);
    addArticle("Site-A");
    addArticle("Site-A", "missed");
    db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)").run("Site-B", "site_title", "News");
    record("Site-A", "purge_tags_second", ["slug:site-a:news"], seconds, "completed");
    record("Site-B", "purge_tags", ["site:site-b"]);
    await tick();
    expectNoSweep();
    expect(env.CACHE.put).toHaveBeenCalledTimes(2);
    await tick();
    expect(env.CACHE.put).toHaveBeenCalledTimes(2);
    expect(purge).not.toHaveBeenCalled();
  });

  it("merges only uncovered sites when a NULL-site writer records a tagged fan-out", async () => {
    record("Site-A", "purge_tags_second", ["site:site-a"]);
    await tick(0);
    for (const id of siteIds) addArticle(id);
    record(null, "purge_tags_second", ["site:site-c"]);
    record("Site-B", "warm_homepage", ["site:site-b"]);
    await tick();
    expectSweep(allTags.slice(0, 2), ["Site-A", "Site-B"]);
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

  it("honors an article writer's receipt even after a delayed tick", async () => {
    await tick(0);
    addArticle("Site-A");
    record("Site-A", "purge_tags_second", ["slug:site-a:news"], seconds + 5);
    await tick(125);
    expectNoSweep();
    expect(env.CACHE.put).toHaveBeenCalledTimes(2);
  });

  it("excludes a legacy retry copy created from an earlier interval", async () => {
    addArticle("Site-A");
    await tick(0);
    editArticle();
    record("Site-A", "purge_tags", ["slug:site-a:news"], seconds - 60);
    await tick();
    expectSweep(["site:site-a"], ["Site-A"]);
  });

  it("honors the host-only site creation and negative-cache media upload receipts for their own sources", async () => {
    await tick(0);
    addSite(db, "New", "New site", "home");
    await onPublicChange(env, ctx, { siteId: "New", tags: ["host:new.example"], reason: "site.create" });
    db.prepare("INSERT INTO media (site_id, filename, storage_key, mime_type) VALUES (?, ?, ?, ?)")
      .run("Site-A", "a.png", "unique/a.png", "image/png");
    await onPublicChange(env, ctx, { siteId: "Site-A", tags: [], reason: "media.upload" });
    vi.clearAllMocks();
    await tick();
    expectNoSweep();
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

  it("purges only sites with enabled quote activations for an unrecorded global rule edit after a safety-net purge", async () => {
    const quote = addQuote();
    activate("Site-A", quote);
    activate("Site-B", quote, 0);
    activate("Site-C", quote);
    db.prepare(`INSERT INTO leadgen_quote_routing_rules (public_id, quote_id, rule_name, conditions_json, conditions_hash, redirect_url)
                VALUES (?, ?, ?, ?, ?, ?)`).run("rule", quote, "redirect", "{}", "hash", "/one");
    await tick(0);
    addArticle("Site-B");
    await tick();
    expectSweep(["site:site-b"], ["Site-B"]);
    vi.clearAllMocks();
    db.prepare("UPDATE leadgen_quote_routing_rules SET redirect_url = ? WHERE public_id = ?").run("/two", "rule");
    await tick();
    expectSweep(["site:site-a", "site:site-c"], ["Site-A", "Site-C"]);
  });

  it.each([false, true])("a recorded shared quote change covers only its family (same-site article also changed: %s)", async siteChanged => {
    activate("Site-A", addQuote());
    await tick(0);
    db.prepare("UPDATE leadgen_frame_templates SET updated_at = updated_at + 1").run();
    if (siteChanged) addArticle("Site-A");
    record("Site-A", "purge_tags_second", ["quote:one"]);
    await tick();
    if (siteChanged) expectSweep(["site:site-a"], ["Site-A"]);
    else expectNoSweep();
    expect(env.CACHE.put).toHaveBeenCalledTimes(2);
  });

  it("checks activation receipts on each tenant, including the site that just disabled its last quote", async () => {
    const quote = addQuote();
    activate("Site-A", quote);
    activate("Site-B", quote);
    await tick(0);
    db.prepare("UPDATE leadgen_site_quotes SET enabled = 0 WHERE quote_id = ?").run(quote);
    record(null, "purge_tags_second", ["quote:site-a:quote"]);
    record("Site-B", "purge_tags", ["snap:site-b", "nf:site-b"]);
    await tick();
    expectSweep(["site:site-b"], ["Site-B"]);
  });

  it("checks global categories against their all-sites purge", async () => {
    await tick(0);
    db.prepare("INSERT INTO categories (slug, name) VALUES (?, ?)").run("housing", "Housing");
    record("Site-A", "purge_tags_second", ["slug:site-a:news"]);
    await tick();
    expectSweep(allTags, siteIds);
    db.prepare("UPDATE categories SET name = ? WHERE slug = ?").run("Homes", "housing");
    await onPublicChange(env, ctx, { siteId: null, tags: allTags, reason: "category.update" });
    vi.clearAllMocks();
    await tick();
    expectNoSweep();
  });

  it.each(["section", "link", "offer"] as const)("checks a shared listicle %s against the receipts of its live consumers", async source => {
    const offer = db.prepare(`INSERT INTO listicle_offers (public_id, offer_name, provider, activity, vertical,
      conversion_tracking_method, offer_url_template, payout_method)
      VALUES ('off-b', 'Offer', 'Provider', 'main', 'home', 'script', 'https://b.example', 'offsite')`).run().lastInsertRowid;
    publishListicle("Site-A", "unrelated");
    const section = publishListicle("Site-B", "off-b");
    db.prepare(`INSERT INTO listicle_section_link_instances (public_id, section_id, offer_id, block_id, link_role)
      VALUES ('link-b', ?, ?, 'go', 'button')`).run(section, offer);
    await tick(0);
    function editSharedResource() {
      if (source === "section") db.prepare("UPDATE listicle_sections SET content_version = content_version + 1 WHERE id = ?").run(section);
      if (source === "link") db.prepare("UPDATE listicle_section_link_instances SET updated_at = updated_at + 1 WHERE public_id = ?").run("link-b");
      if (source === "offer") db.prepare("UPDATE listicle_offers SET updated_at = updated_at + 1 WHERE id = ?").run(offer);
    }
    editSharedResource();
    record("Site-A", "purge_tags_second", ["listicle:lst-site-a"]);
    await tick();
    expectSweep(["site:site-b"], ["Site-B"]);
    vi.clearAllMocks();
    editSharedResource();
    record(null, "purge_tags_second", ["listicle:lst-site-b"]);
    await tick();
    expectNoSweep();
  });

  it("keeps the full writer receipt after a partial drain and ignores its later retry copies", async () => {
    await tick(0);
    addArticle("Site-A");
    // A large publisher row spans two RPCs and the next minute's budget.
    const tags = [
      "slug:site-a:news",
      ...Array.from({ length: 200 }, (_, i) => "slug:site-b:" + i),
    ];
    record(null, "purge_tags_second", tags);
    purge.mockResolvedValueOnce({ success: true, errors: [] }).mockResolvedValueOnce({ success: false, errors: [] });
    await runEdgePurgeCron(env, ctx);
    vi.clearAllMocks();
    await tick();
    expectNoSweep();
    await runEdgePurgeCron(env, ctx);
    // Splitting a previously observed row creates a new log ID while preserving its writer's window.
    const moreTags = Array.from({ length: 201 }, (_, i) => "slug:site-a:overflow-" + i);
    record("Site-A", "purge_tags_second", moreTags);
    await tick();
    editArticle();
    purge.mockResolvedValueOnce({ success: false, errors: [] });
    await runEdgePurgeCron(env, ctx);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM cache_purge_log WHERE site_id = ?
      AND json_extract(payload, '$.retry_of') IS NOT NULL`).get("Site-A")).toEqual({ n: 1 });
    vi.clearAllMocks();
    await tick();
    expectSweep(["site:site-a"], ["Site-A"]);
  });

  it("recognizes a failed whole-site receipt across a legacy checkpoint and still purges an unrecorded site", async () => {
    await tick(0);
    const { sites, global } = JSON.parse(store.get(fingerprintKey)!);
    store.set(fingerprintKey, JSON.stringify({ sites, global, cursor: 0, sampledAt: seconds, sweep: null }));
    addArticle("Site-A", "missed");
    addArticle("Site-B", "covered");
    record("Site-B", "purge_tags", ["site:site-b"], seconds, "failed");
    record("Site-B", "purge_tags_second", ["slug:site-b:other"]);
    await tick();
    expectSweep(["site:site-a"], ["Site-A"]);
  });

  it("honors a shared writer's quote receipt and alarms for a concurrent site edit without a receipt", async () => {
    activate("Site-A", addQuote());
    await tick(0);
    db.prepare("UPDATE leadgen_frame_templates SET updated_at = updated_at + 1").run();
    addArticle("Site-B");
    record("Site-A", "purge_tags_second", ["quote:site-a:one"]);
    await tick();
    expectSweep(["site:site-b"], ["Site-B"]);
  });

  it("keeps a writer receipt that arrives while the preceding fingerprint purge is in flight", async () => {
    await tick(0);
    addArticle("Site-A");
    purge.mockImplementationOnce(async () => {
      addArticle("Site-B");
      record("Site-B", "purge_tags_second", ["slug:site-b:news"]);
      return { success: true, errors: [] };
    });
    await tick();
    expectSweep(["site:site-a"], ["Site-A"]);
    vi.clearAllMocks();
    addArticle("Site-A", "later");
    await tick();
    expectSweep(["site:site-a"], ["Site-A"]);
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

  async function runSplit(runB: typeof runFingerprintCron) {
    const a = { ...env, CF_VERSION_METADATA: { id: "A" } };
    const b = { ...env, CF_VERSION_METADATA: { id: "B" } };
    store.set(legacyVersionKey, "A");
    await tick(0);
    for (let round = 0; round < 10; round++) {
      seconds += 60;
      await legacyVersionTick(a, ctx);
      seconds += 60;
      await runB(b, ctx);
      if (round === 0) {
        expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(b, ctx, { siteId: null, tags: allTags, reason: "version" });
      }
    }
    return { a, b };
  }

  it("reproduces 19 version purges in 20 alternating ticks with c38f5840 on both sides of the split", async () => {
    const { a, b } = await runSplit(legacyVersionTick);
    const sweeps = vi.mocked(onPublicChange).mock.calls;
    expect(sweeps.filter(([worker]) => worker === a)).toHaveLength(9);
    expect(sweeps.filter(([worker]) => worker === b)).toHaveLength(10);
    expect(purge).toHaveBeenCalledTimes(19);
  });

  it("purges only on B's first tick in ten split rounds with legacy A", async () => {
    const { b } = await runSplit(runFingerprintCron);
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(b, ctx, { siteId: null, tags: allTags, reason: "version" });
    expect(purge).toHaveBeenCalledExactlyOnceWith(allTags);
    const secondPasses = await env.DB.prepare("SELECT payload FROM cache_purge_log WHERE action = ?")
      .bind("purge_tags_second").all<{ payload: string }>();
    expect(secondPasses.results).toHaveLength(1);
    expect(JSON.parse(secondPasses.results[0]!.payload)).toMatchObject({ tags: allTags, reason: "version" });
    expect(env.CACHE.put).not.toHaveBeenCalledWith(legacyVersionKey, expect.anything());
    expect(store.get(legacyVersionKey)).toBe("A");
    expect(JSON.parse(store.get(seenVersionsKey)!)).toEqual(["B"]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("purges a new Worker version on its first tick and only once per version id", async () => {
    env.CF_VERSION_METADATA = { id: "B" };
    purge.mockImplementationOnce(async () => {
      expect(store.has(seenVersionsKey)).toBe(false);
      return { success: true, errors: [] };
    });
    await tick(0);
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(env, ctx, { siteId: null, tags: allTags, reason: "version" });
    expect(purge).toHaveBeenCalledExactlyOnceWith(allTags);
    expect(JSON.parse(store.get(seenVersionsKey)!)).toEqual(["B"]);
    expect(env.CACHE.get).not.toHaveBeenCalledWith(legacyVersionKey);
    expect(console.error).not.toHaveBeenCalled();
    expect(db.prepare("SELECT id FROM sites WHERE content_version = 2 ORDER BY id").all())
      .toEqual(siteIds.map(id => ({ id })));
    vi.clearAllMocks();
    env.CF_VERSION_METADATA = { id: "B", tag: "latest" };
    await tick();
    expect(purge).not.toHaveBeenCalled();
    expect(env.CACHE.put).not.toHaveBeenCalled();
    expect(onPublicChange).not.toHaveBeenCalled();
    env.CF_VERSION_METADATA = { id: "C" };
    await tick();
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(env, ctx, { siteId: null, tags: allTags, reason: "version" });
    expect(purge).toHaveBeenCalledExactlyOnceWith(allTags);
    expect(JSON.parse(store.get(seenVersionsKey)!)).toEqual(["C", "B"]);
    expect(console.error).not.toHaveBeenCalled();
    vi.clearAllMocks();
    await tick();
    env.CF_VERSION_METADATA = { id: "B" };
    await tick();
    expectNoSweep();
    expect(env.CACHE.put).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "["],
    ["a non-array value", '"B"'],
    ["a non-string ID", '["B",7]'],
    ["an empty ID", '["B",""]'],
    ["an oversized list", JSON.stringify(Array(21).fill("B"))],
  ])("purges once and rebuilds the seen-versions list for %s", async (_, raw) => {
    env.CF_VERSION_METADATA = { id: "B" };
    store.set(seenVersionsKey, raw);
    await tick(0);
    await tick();
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(env, ctx, { siteId: null, tags: allTags, reason: "version" });
    expect(purge).toHaveBeenCalledExactlyOnceWith(allTags);
    expect(JSON.parse(store.get(seenVersionsKey)!)).toEqual(["B"]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("evicts the oldest version when a 21st version purges", async () => {
    const versions = Array.from({ length: 20 }, (_, i) => "v" + (20 - i));
    store.set(seenVersionsKey, JSON.stringify(versions));
    env.CF_VERSION_METADATA = { id: "v21" };
    await tick(0);
    expect(purge).toHaveBeenCalledExactlyOnceWith(allTags);
    expect(JSON.parse(store.get(seenVersionsKey)!)).toEqual(["v21", ...versions.slice(0, 19)]);
  });

  it("coalesces a deployment and a missed site write into one purge and reports only the missed site", async () => {
    await tick(0);
    env.CF_VERSION_METADATA = { id: "release" };
    addArticle("Site-C");
    await tick();
    expectSweep(allTags, ["Site-C"]);
    expect(JSON.parse(store.get(seenVersionsKey)!)).toEqual(["release"]);
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
    expect(JSON.parse(store.get(seenVersionsKey)!)).toEqual(["release"]);
  });

  it("the scheduled handler still checks fingerprints after its pending-purge job throws", async () => {
    await tick(0);
    vi.mocked(runEdgePurgeCron).mockImplementationOnce(async () => {
      addArticle("Site-B");
      throw new Error("pending purge interrupted");
    });
    const controller: ScheduledController = { cron: "* * * * *", scheduledTime: Date.UTC(2026, 10, 25, 12, 1), noRetry() {} };
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
    expect(JSON.parse(store.get(seenVersionsKey)!)).toEqual(["next"]);
  });

  it("retries the same interval after a receipt read failure and preserves the writer's narrow purge", async () => {
    addArticle("Site-A");
    await tick(0);
    editArticle();
    await purgeArticleChange(env, "Site-A", ["news"], "article.update", ctx);
    vi.clearAllMocks();
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation(query => {
      if (query.includes("SELECT site_id, payload FROM cache_purge_log")) throw new Error("Receipts unavailable");
      return prepare(query);
    });
    await tick();
    expect(purge).not.toHaveBeenCalled();
    expect(env.CACHE.put).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
      t: "fingerprint_receipt_error", error: "Error: Receipts unavailable",
    }));
    vi.mocked(env.DB.prepare).mockRestore();
    vi.clearAllMocks();
    await tick();
    expectNoSweep();
    expect(env.CACHE.put).toHaveBeenCalledExactlyOnceWith(fingerprintKey, expect.any(String));
  });
});
