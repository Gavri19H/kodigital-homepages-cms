import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import publicRouter from "../src/public/router";
import { buildLeadgenEnv, d1FromSqlite, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, type SqliteDb } from "./helpers/x06-a2-sqlite";

const site = "guides";
const url = "https://guides.example/guide?utm_source=paper";
// Stage 4 baseline at 66416747 under TZ=UTC. The Stage 2 byte-identity proof is on perf/p2-fast-builds.
// P5-D adds the shared vitals beacon and page type to those bodies, also measured under TZ=UTC.
// At 7dfb84fc the listicle reads alone took 11 rounds for the inner shell and 13 for the visitor.
const innerDigest = "985dee99b6503c009f6de17bd1b85f334aa67543625386fb3880d9a9dd5e6f5e";
const visitorDigest = "35ab5778702188c176da65cbcdd25e627000e3c89c70ecfe133e660ff7980dea";
const hostRead = expect.stringContaining("FROM domains");
const redirectRead = expect.stringContaining("FROM redirects");
const versionRead = expect.stringContaining("FROM listicle_articles a");
const shellReads = ["FROM listicle_pages", "FROM listicle_sections", "FROM listicle_offers", "FROM site_settings"]
  .map((table) => expect.stringContaining(table));
const innerRounds = [expect.arrayContaining([
  redirectRead, versionRead, ...shellReads,
  expect.stringContaining("FROM listicle_page_section_candidates c"),
  expect.stringContaining("JOIN media m"),
])];

function seed(db: SqliteDb): void {
  addSite(db, site, "Guides", "home");
  db.prepare("INSERT INTO domains (hostname, site_id, status) VALUES ('guides.example', ?, 'active')").run(site);
  const setting = db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
  setting.run(site, "site_name", "Guide Desk");
  setting.run(site, "site_language", " fr ");
  setting.run(site, "site_timezone", " America/Los_Angeles ");
  db.prepare("INSERT INTO media (id, site_id, filename, storage_key, mime_type) VALUES (5, ?, 'hero.jpg', 'guides/hero.jpg', 'image/jpeg')").run(site);
  db.prepare(`INSERT INTO listicle_articles (id, public_id, site_id, slug, article_name, status, active_experiment_id)
    VALUES (1, 'art_guide', ?, 'guide', 'The guide', 'published', 2)`).run(site);
  db.prepare(`INSERT INTO listicle_article_experiments (id, public_id, article_id, name, status)
    VALUES (2, 'exp_guide', 1, 'Guide split', 'running')`).run();
  db.prepare(`INSERT INTO listicle_article_versions
    (id, public_id, article_id, experiment_id, variant_label, is_control, traffic_allocation, headline, intro_paragraph, hero_media_id, hero_media_url)
    VALUES (10, 'ver_A', 1, 2, 'A', 1, 40, 'Control guide', 'Control intro', 5, ''),
           (20, 'ver_B', 1, 2, 'B', 0, 60, 'Challenger guide', 'Challenger intro', 5, NULL)`).run();
  const offer = db.prepare(`INSERT INTO listicle_offers
    (id, public_id, offer_name, provider, activity, vertical, conversion_tracking_method, offer_url_template,
     payout_method, cap_enabled, cap_amount, cap_count_by, status)
    VALUES (?, ?, 'Guide offer', 'Guide provider', 'listicle', 'home', 's2s_postback', 'https://offers.example/go',
            'offsite', 1, 5, 'clicks', ?)`);
  offer.run(41, "off_head", "active");
  offer.run(42, "off_button", "paused");
  offer.run(43, "off_inline", "active");
  const section = db.prepare(`INSERT INTO listicle_sections
    (id, public_id, section_name, headline_text, headline_offer_id, content_json) VALUES (?, ?, ?, ?, ?, ?)`);
  section.run(1, "sec_button", "Steps", "First choice", 41, JSON.stringify({ blocks: [
    { id: "go", type: "button", data: { text: "See offer", offer_id: 42, link_instance_id: "lnk_button" } },
  ] }));
  section.run(2, "sec_inline", "Notes", "Another choice", null, JSON.stringify({ blocks: [
    { id: "note", type: "paragraph", data: { html: '<a data-offer="off_&#105;nline" data-link-instance="lnk_inline">Café</a>' } },
  ] }));
  db.prepare(`INSERT INTO listicle_section_link_instances (public_id, section_id, offer_id, block_id, link_role) VALUES
    ('lnk_head', 1, 41, '__headline__', 'headline'), ('lnk_button', 1, 42, 'go', 'button'),
    ('lnk_inline', 2, 43, 'note', 'inline')`).run();
  db.prepare(`INSERT INTO listicle_section_offers (section_id, offer_id, link_role)
    SELECT section_id, offer_id, link_role FROM listicle_section_link_instances`).run();

  for (const versionId of [10, 20]) {
    const page = db.prepare(`INSERT INTO listicle_pages
      (id, public_id, article_version_id, page_index, selection_mode, rule_set_id, ab_test_id) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    page.run(versionId + 1, "pg_rule" + versionId, versionId, 0, "rule_based", "rules_guide", null);
    page.run(versionId + 2, "pg_split" + versionId, versionId, 1, "ab_test", null, "split_guide");
    page.run(versionId + 3, "pg_empty" + versionId, versionId, 2, "single", null, null);
    const candidate = db.prepare(`INSERT INTO listicle_page_section_candidates
      (id, public_id, page_id, section_id, is_fallback, traffic_allocation) VALUES (?, ?, ?, ?, ?, ?)`);
    candidate.run(versionId + 1, "cand_rule" + versionId, versionId + 1, 2, 0, null);
    candidate.run(versionId + 2, "cand_fallback" + versionId, versionId + 1, 1, 1, null);
    candidate.run(versionId + 3, "cand_first" + versionId, versionId + 2, 1, 0, 70);
    candidate.run(versionId + 4, "cand_second" + versionId, versionId + 2, 2, 0, 30);
    db.prepare(`INSERT INTO listicle_page_rules
      (public_id, page_id, candidate_id, priority, conditions_json, conditions_hash)
      VALUES (?, ?, ?, 7, '{"sets":{"country":["FR"]}}', 'fr-rule')`).run("rule_" + versionId, versionId + 1, versionId + 1);
  }
}

// Record calls at the D1 boundary. The SQLite harness invokes run() inside its
// batch transaction, so give it the original all() for each batched SELECT.
function countedDb(sqlite: SqliteDb) {
  const db = d1FromSqlite(sqlite);
  const prepare = db.prepare.bind(db);
  const batch = db.batch.bind(db);
  const batchRead = new WeakMap<D1PreparedStatement, D1PreparedStatement["all"]>();
  const sqlByStatement = new WeakMap<D1PreparedStatement, string>();
  const rounds: Array<string | string[]> = [];
  db.prepare = (sql) => {
    const statement = prepare(sql);
    const first = statement.first.bind(statement);
    const all = statement.all.bind(statement);
    batchRead.set(statement, all);
    sqlByStatement.set(statement, sql);
    statement.first = <T>(column?: string) => {
      rounds.push(sql);
      return column === undefined ? first<T>() : first<T>(column);
    };
    statement.all = <T>() => {
      rounds.push(sql);
      return all<T>();
    };
    statement.run = () => { throw new Error("Unexpected standalone write in a listicle build"); };
    return statement;
  };
  db.batch = <T>(statements: D1PreparedStatement[]) => {
    rounds.push(statements.map(statement => sqlByStatement.get(statement)!));
    for (const statement of statements) statement.run = batchRead.get(statement)!;
    return batch<T>(statements);
  };
  return { db, rounds };
}

describe("cold listicle query rounds and response bytes", () => {
  let sqlite: SqliteDb;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T05:37:42Z"));
    sqlite = createDb("0032");
    seed(sqlite);
  });
  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
  });

  async function visit(inner: boolean, versionId = "ver_A", expectedStatus = 200) {
    const { db, rounds } = countedDb(sqlite);
    const { kv } = makeKvStub();
    Object.assign(kv, { async getWithMetadata() { return { value: null, metadata: null }; } });
    const env = buildLeadgenEnv(db, kv);
    const headers = new Headers({ Cookie: "ko_sid=returning" });
    if (inner) {
      env.EDGE_INNER = "1";
      headers.set("x-cms-variant", "lst:" + versionId);
      headers.set("x-cms-site-context", JSON.stringify({
        site_id: site, hostname: "guides.example", vertical_slug: "home", status: "active",
        content_version: 1, settings_version: 1,
      }));
    }
    const response = await publicRouter.request(url, { headers }, env);
    expect(response.status).toBe(expectedStatus);
    const bytes = Buffer.from(await response.arrayBuffer());
    return { response, html: bytes.toString("utf8"), digest: createHash("sha256").update(bytes).digest("hex"), rounds };
  }

  function addRedirect(siteId: string | null, status: number, active = 1) {
    sqlite.prepare(`INSERT INTO redirects (site_id, source_path, destination_path, status_code, is_active)
      VALUES (?, '/guide', '/moved-guide', ?, ?)`).run(siteId, status, active);
  }

  it.each([
    { path: "lst:ver_A inner", inner: true, version: "ver_A", expectedDigest: innerDigest },
    { path: "no variant", inner: false, version: "ver_B", expectedDigest: visitorDigest },
  ])("$path serves the selected version with identical bytes", async ({ inner, version, expectedDigest }) => {
    const { response, html, digest, rounds } = await visit(inner);
    expect(html).toContain('data-lander-v="' + version + '"');
    expect(html).toContain("/media/guides/hero.jpg");
    for (const name of ["head", "button", "inline"]) {
      expect(html).toContain('href="/lc/off_' + name + '?');
      expect(html).toContain("lnk=lnk_" + name);
    }
    expect(response.headers.getSetCookie().length).toBe(inner ? 0 : 2);
    expect(digest).toBe(expectedDigest);
    expect(rounds).toEqual(inner ? innerRounds : [hostRead, redirectRead, versionRead, expect.arrayContaining(shellReads)]);
  });

  it.each([
    { scope: "tenant", siteId: site, status: 302 },
    { scope: "global", siteId: null, status: 301 },
  ])("returns the $scope $status redirect over the selected shell in one D1 batch", async ({ siteId, status }) => {
    addRedirect(siteId, status);
    const { response, html, rounds } = await visit(true, "ver_A", status);
    expect(rounds).toEqual(innerRounds);
    expect(response.headers.get("Location")).toBe("/moved-guide");
    expect(response.headers.get("ETag")).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(html).toBe("");
  });

  it.each([
    { scope: "another tenant's", siteId: "other", active: 1 },
    { scope: "an inactive", siteId: site, active: 0 },
  ])("ignores $scope redirect in the selected shell batch", async ({ siteId, active }) => {
    addSite(sqlite, "other", "Other", "home");
    addRedirect(siteId, 302, active);
    const { digest, rounds } = await visit(true);
    expect(digest).toBe(innerDigest);
    expect(rounds).toEqual(innerRounds);
  });

  it("retries the redirect first when a shell statement fails", async () => {
    addRedirect(site, 302);
    sqlite.prepare("ALTER TABLE listicle_pages RENAME TO unavailable_pages").run();
    const { response, html, rounds } = await visit(true, "ver_A", 302);
    expect(rounds).toEqual([...innerRounds, redirectRead]);
    expect(response.headers.get("Location")).toBe("/moved-guide");
    expect(html).toBe("");
  });

  it("falls through to the canonical article when the selected listicle is unpublished", async () => {
    sqlite.prepare("UPDATE listicle_articles SET status = 'draft' WHERE id = 1").run();
    sqlite.prepare(`INSERT INTO articles (site_id, slug, title, content_json, status)
      VALUES (?, 'guide', 'Guide article', '{}', 'published')`).run(site);
    const { response, rounds } = await visit(true, "ver_A", 301);
    expect(response.headers.get("Location")).toBe("/article/guide");
    expect(rounds).toEqual([...innerRounds, expect.stringContaining("FROM pages"), expect.stringContaining("FROM articles")]);
  });

  it.each([
    ["link instances", "DELETE FROM listicle_section_offers"],
    ["offer summary", "DELETE FROM listicle_section_link_instances WHERE link_role <> 'headline'"],
  ])("serves block offers from the %s alone in the shell batch", async (_source, removeOtherIndex) => {
    sqlite.prepare(removeOtherIndex).run();
    const result = await visit(true);
    expect(result.digest).toBe(innerDigest);
    expect(result.rounds).toEqual(innerRounds);
  });

  it("discards a different tenant's selected version and serves this visitor's version and cookies", async () => {
    addSite(sqlite, "other", "Other", "home");
    sqlite.prepare(`INSERT INTO listicle_articles (id, public_id, site_id, slug, article_name, status)
      VALUES (3, 'art_other', 'other', 'guide', 'Other guide', 'published')`).run();
    sqlite.prepare(`INSERT INTO listicle_article_versions (public_id, article_id, headline, intro_paragraph)
      VALUES ('ver_other', 3, 'Other headline', '')`).run();
    const direct = await visit(false);
    const stale = await visit(true, "ver_other");
    expect(stale.digest).toBe(visitorDigest);
    expect(stale.response.headers.get("ETag")).toBe(direct.response.headers.get("ETag"));
    expect(stale.response.headers.getSetCookie()).toEqual(direct.response.headers.getSetCookie());
  });

  it("resolves unindexed numeric and encoded inline refs together and keeps missing offers inert", async () => {
    sqlite.prepare("DELETE FROM listicle_section_offers WHERE offer_id IN (42, 43)").run();
    sqlite.prepare("DELETE FROM listicle_section_link_instances WHERE offer_id IN (42, 43)").run();
    const legacy = await visit(true);
    expect(legacy.digest).toBe(innerDigest);
    expect(legacy.rounds).toEqual(innerRounds);

    sqlite.prepare("DELETE FROM listicle_offers WHERE id IN (42, 43)").run();
    const missing = await visit(true);
    expect(missing.html).toContain('href="/lc/off_head?');
    expect(missing.html).not.toContain('href="/lc/off_button?');
    expect(missing.html).not.toContain('href="/lc/off_inline?');
    expect(missing.rounds).toEqual(legacy.rounds);
  });

  it("resolves numeric and public IDs from structured blocks without either offer ledger", async () => {
    sqlite.prepare("DELETE FROM listicle_section_offers").run();
    sqlite.prepare("DELETE FROM listicle_section_link_instances").run();
    sqlite.prepare("UPDATE listicle_sections SET content_json = ? WHERE id = 2").run(JSON.stringify({ blocks: [
      { id: "note", type: "button", data: { text: "Read more", offer_id: "off_inline" } },
    ] }));
    const { html, rounds } = await visit(true);
    for (const offer of ["off_head", "off_button", "off_inline"]) expect(html).toContain('href="/lc/' + offer + '?');
    expect(rounds).toEqual(innerRounds);
  });

  it("keeps one shell batch beyond the D1 bind limit", async () => {
    const page = sqlite.prepare("INSERT INTO listicle_pages (id, public_id, article_version_id, page_index) VALUES (?, ?, 10, ?)");
    const candidate = sqlite.prepare("INSERT INTO listicle_page_section_candidates (public_id, page_id, section_id) VALUES (?, ?, 1)");
    for (let index = 3; index < 125; index++) {
      page.run(1000 + index, "pg_" + index, index);
      candidate.run("cand_" + index, 1000 + index);
    }
    sqlite.prepare("UPDATE listicle_article_versions SET hero_media_url = ? WHERE id = 10").run("/media/direct.jpg");
    const result = await visit(true);
    expect(result.html).toContain("cand_124");
    expect(result.html).toContain("/media/direct.jpg");
    expect(result.html).not.toContain("/media/guides/hero.jpg");
    expect(result.rounds).toEqual(innerRounds);
  });
});
