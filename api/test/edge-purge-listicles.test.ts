import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import { onPublicChange } from "../src/edge/public-change";
import type { Env } from "../src/env";
import { loadActiveVersions, renderListicleShellForVersion } from "../src/public/listicle/serve";
import { addSite, createDb, env as sqliteEnv, hasSqlite, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("../src/edge/public-change", () => ({ onPublicChange: vi.fn() }));

const owner = "Site-A";
const second = "Site-B";
const unrelated = "Site-C";
const ownerOnly = { [owner]: ["listicle:art_alpha"] };
const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {}, exports: {} };
const versionFields = {
  headline: "Original headline", intro_paragraph: "Introduction", hero_media_url: "/media/hero.jpg", layout_style_id: "default",
};
const offerFields = {
  offer_name: "Reader offer", provider: "provider", activity: "lead", vertical: "home",
  conversion_tracking_method: "s2s_postback", offer_url_template: "https://offers.example/c?cid={clickid}", payout_method: "offsite",
};

let db: SqliteDb;
let env: Env;

function request(method: string, path: string, body?: unknown, context: typeof ctx | null = ctx) {
  return admin.request("/api/admin/listicles/" + path, {
    method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  }, env, context ?? undefined);
}

// Call order across sites and tag order within a merged purge have no public significance.
function expectChanges(bySite: Record<string, string[]>, context: typeof ctx | null = ctx) {
  const changes = vi.mocked(onPublicChange).mock.calls.map(([receivedEnv, receivedCtx, change]) => {
    expect(receivedEnv).toBe(env);
    expect(receivedCtx).toBe(context ?? undefined);
    expect(change.reason).toMatch(/\S/);
    return { siteId: change.siteId, tags: [...change.tags].sort() };
  });
  expect(changes).toHaveLength(Object.keys(bySite).length);
  for (const [siteId, tags] of Object.entries(bySite)) {
    expect(changes).toContainEqual({ siteId, tags: [...tags].sort() });
  }
}

function seedSection(key: string, blocks: unknown[] = [{ type: "paragraph", data: { text: "Body" } }]) {
  return Number(db.prepare(`INSERT INTO listicle_sections (public_id, section_name, headline_text, content_json)
    VALUES (?, ?, 'Heading', ?)`).run("sec_" + key, key, JSON.stringify({ version: 1, blocks })).lastInsertRowid);
}

function seedArticle(key: string, siteId = owner, sections: number[] = [], status = "published", versionStatus = "active") {
  const articleId = Number(db.prepare(`INSERT INTO listicle_articles (public_id, site_id, slug, article_name, status)
    VALUES (?, ?, ?, ?, ?)`).run("art_" + key, siteId, key.toLowerCase(), key, status).lastInsertRowid);
  const versionId = Number(db.prepare(`INSERT INTO listicle_article_versions
    (public_id, article_id, headline, intro_paragraph, hero_media_url, status) VALUES (?, ?, ?, ?, ?, ?)`)
    .run("ver_" + key, articleId, versionFields.headline, versionFields.intro_paragraph, versionFields.hero_media_url, versionStatus).lastInsertRowid);
  for (const [index, sectionId] of sections.entries()) {
    const suffix = `${key}_${index}`;
    const page = db.prepare("INSERT INTO listicle_pages (public_id, article_version_id, page_index) VALUES (?, ?, ?)")
      .run("pg_" + suffix, versionId, index);
    db.prepare("INSERT INTO listicle_page_section_candidates (public_id, page_id, section_id) VALUES (?, ?, ?)")
      .run("cand_" + suffix, page.lastInsertRowid, sectionId);
  }
  return { articleId, versionId };
}

function seedOffer(id = 42, publicId = "off_live") {
  db.prepare(`INSERT INTO listicle_offers (id, public_id, offer_name, provider, activity, vertical,
    conversion_tracking_method, offer_url_template, payout_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, publicId, offerFields.offer_name, offerFields.provider, offerFields.activity, offerFields.vertical,
      offerFields.conversion_tracking_method, offerFields.offer_url_template, offerFields.payout_method);
}

function button(offerId: string | number) {
  return { type: "button", data: { text: "Open offer", offer_id: offerId } };
}

function beforeNextBatch(write: () => void | Promise<void>) {
  const batch = env.DB.batch.bind(env.DB);
  env.DB.batch = async <T>(statements: D1PreparedStatement[]) => {
    env.DB.batch = batch;
    await write();
    return batch<T>(statements);
  };
}

describe.skipIf(!hasSqlite)("listicle write paths and edge purge scope", () => {
  beforeEach(() => {
    db = createDb("0033");
    env = sqliteEnv(db);
    // Expose SELECT and RETURNING rows inside the kit's SQLite transaction as D1.batch does.
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = <T>(statements: D1PreparedStatement[]) => {
      for (const statement of statements) statement.run = statement.all.bind(statement);
      return batch<T>(statements);
    };
    for (const id of [owner, second, unrelated]) addSite(db, id, id, "home");
    vi.mocked(onPublicChange).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => db.close());

  it("purges no site when a new article and its control version are still a draft", async () => {
    const response = await request("POST", "articles", {
      ...versionFields, site_id: owner, article_name: "Draft guide", slug: "draft-guide",
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ article: { site_id: owner, status: "draft" }, version: { is_control: 1 } });
    expectChanges({});
  });

  it("purges the owner after a slug change even without a request context", async () => {
    seedArticle("Alpha");
    const actual = await vi.importActual<typeof import("../src/edge/public-change")>("../src/edge/public-change");
    vi.mocked(onPublicChange).mockImplementationOnce(async (...args) => {
      expect(db.prepare("SELECT slug FROM listicle_articles").get()).toEqual({ slug: "new-slug" });
      await actual.onPublicChange(...args);
    });
    expect((await request("PATCH", "articles/art_Alpha", { slug: "new-slug" }, null)).status).toBe(200);
    expectChanges(ownerOnly, null);
    const rows = db.prepare("SELECT site_id, action, status, payload FROM cache_purge_log ORDER BY id").all() as
      { site_id: string; action: string; status: string; payload: string }[];
    expect(rows.map(({ payload, ...row }) => ({ ...row, tags: (JSON.parse(payload).tags as string[]).sort() })))
      .toEqual(["purge_tags", "purge_tags_second"].map(action => ({
        site_id: owner, action, status: "pending", tags: ["listicle:art_alpha", "nf:site-a", "snap:site-a"],
      })));
  });

  it("purges both the previous and new owner when a published listicle moves", async () => {
    seedArticle("Alpha");
    expect((await request("PATCH", "articles/art_Alpha", { site_id: second, slug: "moved" })).status).toBe(200);
    expectChanges({ ...ownerOnly, [second]: ["listicle:art_alpha"] });
  });

  it("purges the actual previous owner and destination when another site move commits during validation", async () => {
    const { articleId } = seedArticle("Alpha");
    beforeNextBatch(() => {
      db.prepare("UPDATE listicle_articles SET site_id = ? WHERE id = ?").run(unrelated, articleId);
    });
    expect((await request("PATCH", "articles/art_Alpha", { site_id: second })).status).toBe(200);
    expectChanges({ [unrelated]: ["listicle:art_alpha"], [second]: ["listicle:art_alpha"] });
  });

  it("purges the owner after a rename changes the published shell's version", async () => {
    seedArticle("Alpha");
    seedArticle("Neighbor");
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(db.prepare("SELECT public_id, content_version FROM listicle_article_versions ORDER BY id").all()).toEqual([
        { public_id: "ver_Alpha", content_version: 2 }, { public_id: "ver_Neighbor", content_version: 1 },
      ]);
    });
    expect((await request("PATCH", "articles/art_Alpha", { article_name: "Renamed" })).status).toBe(200);
    expectChanges(ownerOnly);
  });

  it.each(["running", "draft"])("purges only the owner when creating a %s experiment with active arms", async status => {
    seedArticle("Alpha");
    const response = await request("POST", "articles/art_Alpha/experiments", {
      status, name: "Headline test", versions: [
        { version_id: "ver_Alpha", variant_label: "A", traffic_allocation: 60, is_control: false },
        { ...versionFields, variant_label: "B", traffic_allocation: 40, is_control: true },
      ],
    });
    expect(response.status).toBe(201);
    expectChanges(ownerOnly);
  });

  it.each([
    ["start", "draft", "running"], ["stop", "running", "stopped"],
  ] as const)("purges only the experiment's article owner after %s", async (action, before, after) => {
    const { articleId, versionId } = seedArticle("Alpha");
    const experiment = db.prepare(`INSERT INTO listicle_article_experiments (public_id, article_id, name, status)
      VALUES ('exp_current', ?, 'Control', ?)`).run(articleId, before);
    db.prepare("UPDATE listicle_article_versions SET experiment_id = ? WHERE id = ?").run(experiment.lastInsertRowid, versionId);
    if (before === "running") db.prepare("UPDATE listicle_articles SET active_experiment_id = ? WHERE id = ?").run(experiment.lastInsertRowid, articleId);
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(db.prepare("SELECT status FROM listicle_article_experiments").get()).toEqual({ status: after });
      expect(db.prepare("SELECT active_experiment_id FROM listicle_articles").get())
        .toEqual({ active_experiment_id: action === "start" ? experiment.lastInsertRowid : null });
    });
    expect((await request("POST", `experiments/exp_current/${action}`)).status).toBe(200);
    expectChanges(ownerOnly);
  });

  it("purges only the owner after article deletion cascades", async () => {
    seedArticle("Alpha", owner, [seedSection("used")]);
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(db.prepare("SELECT id FROM listicle_articles").all()).toEqual([]);
      expect(db.prepare("SELECT id FROM listicle_page_section_candidates").all()).toEqual([]);
    });
    expect((await request("DELETE", "articles/art_Alpha")).status).toBe(200);
    expectChanges(ownerOnly);
  });

  it("purges only the owner once the publish handler makes the listicle public", async () => {
    seedArticle("Alpha", owner, [seedSection("used")], "draft");
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(db.prepare("SELECT status FROM listicle_articles").get()).toEqual({ status: "published" });
    });
    expect((await request("POST", "articles/art_Alpha/publish")).status).toBe(200);
    expectChanges(ownerOnly);
  });

  it.each([0, 4])("purges only the owner after a version PUT with %i concurrent revision bumps", async interveningBumps => {
    const sectionId = seedSection("intro");
    const { versionId } = seedArticle("Alpha", owner, [sectionId]);
    if (interveningBumps) beforeNextBatch(() => {
      db.prepare("UPDATE listicle_article_versions SET content_version = content_version + ? WHERE id = ?").run(interveningBumps, versionId);
    });
    const response = await request("PUT", "versions/ver_Alpha", {
      ...versionFields, headline: "Revised headline", pages: [{
        page_index: 0, selection_mode: "single", candidates: [{ section_id: sectionId, public_id: "cand_updated" }],
      }],
    });
    expect(response.status).toBe(200);
    expect(db.prepare("SELECT headline, content_version FROM listicle_article_versions").get())
      .toEqual({ headline: "Revised headline", content_version: 2 + interveningBumps });
    expect(db.prepare("SELECT public_id FROM listicle_page_section_candidates").all()).toEqual([{ public_id: "cand_updated" }]);
    expectChanges(ownerOnly);
  });

  it("purges only the owner and bumps its shell revision when only a public candidate ID changes", async () => {
    const sectionId = seedSection("intro");
    seedArticle("Alpha", owner, [sectionId]);
    const response = await request("PUT", "versions/ver_Alpha", {
      ...versionFields, pages: [{
        public_id: "pg_Alpha_0", page_index: 0, selection_mode: "single",
        candidates: [{ section_id: sectionId, public_id: "cand_new_id" }],
      }],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      version: { content_version: 2 }, pages: [{ public_id: "pg_Alpha_0", candidates: [{ public_id: "cand_new_id" }] }],
    });
    expectChanges(ownerOnly);
  });

  it.each(["assignment group", "candidate order"])("purges only the owner when a PUT changes the A/B %s", async change => {
    const first = seedSection("first");
    const next = seedSection("next");
    const { versionId } = seedArticle("Alpha");
    const page = db.prepare(`INSERT INTO listicle_pages (public_id, article_version_id, page_index, selection_mode, ab_test_id)
      VALUES ('pg_ab', ?, 0, 'ab_test', 'ab_original')`).run(versionId);
    const candidates = [
      { public_id: "cand_first", section_id: first, label: "A", traffic_allocation: 60 },
      { public_id: "cand_next", section_id: next, label: "B", traffic_allocation: 40 },
    ];
    for (const candidate of candidates) {
      db.prepare(`INSERT INTO listicle_page_section_candidates (public_id, page_id, section_id, label, traffic_allocation)
        VALUES (?, ?, ?, ?, ?)`).run(candidate.public_id, page.lastInsertRowid, candidate.section_id, candidate.label, candidate.traffic_allocation);
    }
    const group = change === "assignment group" ? "ab_replaced" : "ab_original";
    const order = change === "candidate order" ? [...candidates].reverse() : candidates;
    const response = await request("PUT", "versions/ver_Alpha", {
      ...versionFields, pages: [{ public_id: "pg_ab", page_index: 0, selection_mode: "ab_test", ab_test_id: group, candidates: order }],
    });
    expect(response.status).toBe(200);
    expect(db.prepare("SELECT content_version FROM listicle_article_versions").get()).toEqual({ content_version: 2 });
    expect(db.prepare("SELECT ab_test_id FROM listicle_pages").get()).toEqual({ ab_test_id: group });
    expect(db.prepare("SELECT public_id FROM listicle_page_section_candidates ORDER BY id").all())
      .toEqual(order.map(({ public_id }) => ({ public_id })));
    expectChanges(ownerOnly);
  });

  it("keeps the owning listicle's candidate URL and revision when an identical PUT omits public IDs", async () => {
    const sectionId = seedSection("intro");
    seedArticle("Alpha", owner, [sectionId]);
    const response = await request("PUT", "versions/ver_Alpha", {
      ...versionFields, pages: [{ page_index: 0, selection_mode: "single", candidates: [{ section_id: sectionId }] }],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      version: { content_version: 1 }, pages: [{ public_id: "pg_Alpha_0", candidates: [{ public_id: "cand_Alpha_0" }] }],
    });
    expectChanges(ownerOnly);
  });

  it("purges only the owner once a new revision replaces the page, candidates and targeting rules", async () => {
    const first = seedSection("first");
    const fallback = seedSection("fallback");
    seedArticle("Alpha", owner, [first]);
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(db.prepare(`SELECT p.selection_mode, c.public_id, r.priority FROM listicle_pages p
        JOIN listicle_page_section_candidates c ON c.page_id = p.id LEFT JOIN listicle_page_rules r ON r.candidate_id = c.id
        ORDER BY c.id`).all()).toEqual([
        { selection_mode: "rule_based", public_id: "cand_targeted", priority: 1 },
        { selection_mode: "rule_based", public_id: "cand_default", priority: null },
      ]);
    });
    expect((await request("POST", "versions/ver_Alpha/new-revision", {
      ...versionFields, pages: [{ page_index: 0, selection_mode: "rule_based", candidates: [
        { section_id: first, public_id: "cand_targeted", rule: { priority: 1, conditions: { sets: { state: ["CA"] } } } },
        { section_id: fallback, public_id: "cand_default", is_fallback: true },
      ] }],
    })).status).toBe(200);
    expectChanges(ownerOnly);
  });

  it("purges no site when a candidate collision rolls back the version write", async () => {
    const sectionId = seedSection("used");
    seedArticle("Alpha", owner, [sectionId]);
    seedArticle("Other", second, [sectionId]);
    expect((await request("PUT", "versions/ver_Alpha", {
      ...versionFields, headline: "Should roll back", pages: [{
        page_index: 0, candidates: [{ section_id: sectionId, public_id: "cand_Other_0" }],
      }],
    })).status).toBe(400);
    expect(db.prepare("SELECT headline, content_version FROM listicle_article_versions WHERE public_id = ?").get("ver_Alpha"))
      .toEqual({ headline: versionFields.headline, content_version: 1 });
    expectChanges({});
  });

  it("purges only the owner when a published fork exposes new public candidate IDs", async () => {
    seedArticle("Alpha", owner, [seedSection("used")]);
    expect((await request("POST", "versions/ver_Alpha/fork")).status).toBe(201);
    expect(db.prepare("SELECT COUNT(*) AS n FROM listicle_page_section_candidates").get()).toEqual({ n: 2 });
    expectChanges(ownerOnly);
  });

  it("purges only the owner when a fork creates the published listicle's first active fallback", async () => {
    seedArticle("Alpha", owner, [], "published", "archived");
    expect((await request("POST", "versions/ver_Alpha/fork")).status).toBe(201);
    expectChanges(ownerOnly);
  });

  it("purges only the article owner when an empty fork joins an experiment that started before commit", async () => {
    const { articleId, versionId } = seedArticle("Alpha");
    const experiment = db.prepare(`INSERT INTO listicle_article_experiments (public_id, article_id, name, status)
      VALUES ('exp_join', ?, 'Draft split', 'draft')`).run(articleId);
    db.prepare("UPDATE listicle_article_versions SET experiment_id = ? WHERE id = ?").run(experiment.lastInsertRowid, versionId);
    beforeNextBatch(async () => {
      const started = await request("POST", "experiments/exp_join/start");
      expect(started.status).toBe(200);
      expectChanges(ownerOnly);
      vi.mocked(onPublicChange).mockClear();
    });
    const fork = await request("POST", "versions/ver_Alpha/fork", { join_experiment: true, traffic_allocation: 25 });
    expect(fork.status).toBe(201);
    expect(await fork.json()).toMatchObject({
      joined_experiment: true, pages: [], version: { status: "active", experiment_id: experiment.lastInsertRowid, traffic_allocation: 25 },
    });
    expectChanges(ownerOnly);
  });

  it("purges no site for a draft fork or an empty fork beside an existing published control", async () => {
    seedArticle("Draft", owner, [seedSection("used")], "draft");
    seedArticle("Published", second);
    expect((await request("POST", "versions/ver_Draft/fork")).status).toBe(201);
    expect((await request("POST", "versions/ver_Published/fork")).status).toBe(201);
    expectChanges({});
  });

  it.each([{ headline_text: "Revised" }, { section_name: "New selector name" }])(
    "purges only published active consumers of a shared section once per site for %o", async edit => {
      const created = await request("POST", "sections", {
        section_name: "Shared section", headline_text: "Heading", content_json: { blocks: [{ type: "paragraph", data: { text: "Body" } }] },
      });
      expect(created.status).toBe(201);
      const { section } = await created.json<{ section: { id: number } }>();
      const sectionId = section.id;
      seedArticle("Alpha", owner, [sectionId, sectionId]);
      seedArticle("Beta", owner, [sectionId]);
      seedArticle("Gamma", second, [sectionId]);
      seedArticle("Draft", unrelated, [sectionId], "draft");
      seedArticle("ArchivedVersion", owner, [sectionId], "published", "archived");
      seedArticle("DifferentSection", second, [seedSection("other")]);
      expect((await request("PATCH", `sections/${sectionId}`, edit)).status).toBe(200);
      expect(db.prepare("SELECT content_version FROM listicle_sections WHERE id = ?").get(sectionId))
        .toEqual({ content_version: "section_name" in edit ? 1 : 2 });
      expect(db.prepare("SELECT content_version FROM listicle_article_versions WHERE public_id = ?").get("ver_Alpha"))
        .toEqual({ content_version: 2 });
      expectChanges({ [owner]: ["listicle:art_alpha", "listicle:art_beta"], [second]: ["listicle:art_gamma"] });
    },
  );

  it("purges only the published consumer's site for a section status PATCH", async () => {
    const sectionId = seedSection("retiring");
    seedArticle("Alpha", owner, [sectionId]);
    seedArticle("Draft", second, [sectionId], "draft");
    expect((await request("PATCH", "sections/sec_retiring", { status: "archived" })).status).toBe(200);
    expect(db.prepare("SELECT status, content_version FROM listicle_sections WHERE id = ?").get(sectionId))
      .toEqual({ status: "archived", content_version: 1 });
    expect(db.prepare("SELECT content_version FROM listicle_article_versions WHERE public_id = ?").get("ver_Alpha"))
      .toEqual({ content_version: 1 });
    expectChanges(ownerOnly);
  });

  it("purges the owner for both public writes when a validated section metadata save overwrites a concurrent edit", async () => {
    const created = await request("POST", "sections", {
      section_name: "Original name", headline_text: "Original headline", content_json: { blocks: [{ type: "paragraph", data: { text: "Body" } }] },
    });
    expect(created.status).toBe(201);
    const { section } = await created.json<{ section: { id: number } }>();
    const { versionId } = seedArticle("Alpha", owner, [section.id]);
    const path = `sections/${section.id}`;
    const readState = () => db.prepare(`SELECT section_name, headline_text, ai_settings_json, content_version AS section_revision,
      (SELECT content_version FROM listicle_article_versions WHERE id = ?) AS shell_revision
      FROM listicle_sections WHERE id = ?`).get(versionId, section.id);
    beforeNextBatch(async () => {
      const concurrent = await request("PATCH", path, { section_name: "New name", headline_text: "New headline" });
      expect(concurrent.status).toBe(200);
      expect(readState()).toEqual({ section_name: "New name", headline_text: "New headline", ai_settings_json: null, section_revision: 2, shell_revision: 2 });
      expectChanges(ownerOnly);
      vi.mocked(onPublicChange).mockClear();
    });
    const response = await request("PATCH", path, { ai_settings: { tone: "concise" } });
    expect(response.status).toBe(200);
    expect(readState()).toEqual({
      section_name: "Original name", headline_text: "Original headline", ai_settings_json: '{"tone":"concise"}', section_revision: 3, shell_revision: 3,
    });
    expectChanges(ownerOnly);
  });

  it("passes every affected tag in one change for a site with more than 100 consuming listicles", async () => {
    const sectionId = seedSection("popular");
    const tags: string[] = [];
    for (let index = 0; index < 101; index++) {
      seedArticle("guide" + index, owner, [sectionId]);
      tags.push("listicle:art_guide" + index);
    }
    expect((await request("PATCH", "sections/sec_popular", { headline_text: "New" })).status).toBe(200);
    expectChanges({ [owner]: tags });
  });

  it("purges no site for a refused section archive or an unreferenced archive", async () => {
    seedArticle("Alpha", owner, [seedSection("used")]);
    seedSection("unused");
    expect((await request("DELETE", "sections/sec_used")).status).toBe(409);
    expect((await request("DELETE", "sections/sec_unused")).status).toBe(200);
    expectChanges({});
  });

  it("purges the consuming site if a candidate attaches between the archive check and write", async () => {
    seedSection("archiving");
    const { versionId } = seedArticle("Alpha");
    db.prepare("INSERT INTO listicle_pages (public_id, article_version_id, page_index) VALUES ('pg_waiting', ?, 0)").run(versionId);
    db.prepare(`CREATE TRIGGER attach_candidate AFTER UPDATE OF status ON listicle_sections WHEN NEW.status = 'archived'
      BEGIN INSERT INTO listicle_page_section_candidates (public_id, page_id, section_id)
        SELECT 'cand_attached', id, NEW.id FROM listicle_pages WHERE public_id = 'pg_waiting'; END`).run();
    expect((await request("DELETE", "sections/sec_archiving")).status).toBe(200);
    expectChanges(ownerOnly);
  });

  it("purges only consuming sites when deleting an offer used by legacy numeric and public-ID links", async () => {
    seedOffer();
    const numeric = seedSection("numeric", [button(42)]);
    const publicId = seedSection("public", [button("off_live")]);
    seedArticle("Alpha", owner, [numeric, publicId]);
    seedArticle("Beta", owner, [numeric]);
    seedArticle("Gamma", second, [publicId]);
    seedArticle("Draft", unrelated, [numeric], "draft");
    seedArticle("ArchivedVersion", owner, [publicId], "published", "archived");
    seedArticle("Similar", unrelated, [seedSection("other", [button("off_live_long"), button(142)])]);
    vi.mocked(onPublicChange).mockImplementation(async () => {
      expect(db.prepare("SELECT id FROM listicle_offers WHERE id = 42").all()).toEqual([]);
    });
    expect((await request("DELETE", "offers/off_live")).status).toBe(200);
    expectChanges({ [owner]: ["listicle:art_alpha", "listicle:art_beta"], [second]: ["listicle:art_gamma"] });
  });

  it("purges only the owning site whose previously unresolved numeric offer becomes renderable on create", async () => {
    seedOffer(41, "off_before");
    seedArticle("Alpha", owner, [seedSection("legacy", [button(42)])]);
    seedArticle("Unrelated", second, [seedSection("literal", [{ type: "paragraph", data: { text: "42" } }])]);
    expect((await request("POST", "offers", offerFields)).status).toBe(201);
    expect(db.prepare("SELECT offer_name FROM listicle_offers WHERE id = 42").get()).toEqual({ offer_name: offerFields.offer_name });
    expectChanges(ownerOnly);
  });

  it("purges the consuming site once when two offer deletes pass the usage guard", async () => {
    seedOffer();
    seedArticle("Alpha", owner, [seedSection("legacy", [button(42)])]);
    const prepare = env.DB.prepare.bind(env.DB);
    let competingStatus: number | undefined;
    env.DB.prepare = sql => {
      const statement = prepare(sql);
      if (sql.includes("WHERE cap_fallback_offer_id = ?")) {
        const read = statement.all.bind(statement);
        statement.all = async <T>() => {
          const rows = await read<T>();
          env.DB.prepare = prepare;
          competingStatus = (await request("DELETE", "offers/off_live")).status;
          return rows;
        };
      }
      return statement;
    };
    expect((await request("DELETE", "offers/off_live")).status).toBe(200);
    expect(competingStatus).toBe(200);
    expect(db.prepare("SELECT id FROM listicle_offers").all()).toEqual([]);
    expect(db.prepare("SELECT content_version FROM listicle_article_versions").get()).toEqual({ content_version: 2 });
    expectChanges(ownerOnly);
  });

  it("purges only listicles where encoded legacy references rendered a link to the deleted offer", async () => {
    seedOffer(42, "off_A");
    const inline = seedSection("inline", [{ type: "paragraph", data: { html: '<a data-offer="off_&#65;">Go</a>' } }]);
    const escaped = seedSection("escaped");
    db.prepare("UPDATE listicle_sections SET content_json = ? WHERE id = ?").run(
      String.raw`{"blocks":[{"type":"button","data":{"text":"See price","offer_id":"off_\u0041"}}]}`, escaped,
    );
    const { articleId } = seedArticle("Alpha", owner, [inline]);
    seedArticle("Beta", second, [escaped]);
    const [version] = await loadActiveVersions(env.DB, articleId);
    const render = () => renderListicleShellForVersion(env.DB, { siteId: owner, hostname: "a.example" },
      { public_id: "art_Alpha", slug: "alpha" }, version!);
    expect((await render()).html).toContain('href="/lc/off_A?');
    expect((await request("DELETE", "offers/off_A")).status).toBe(200);
    expect((await render()).html).not.toContain('href="/lc/off_A?');
    expectChanges({ ...ownerOnly, [second]: ["listicle:art_beta"] });
  });

  it("purges no site on offer metadata edits, a guarded delete, or an unused offer deletion", async () => {
    seedOffer();
    seedOffer(43, "off_unused");
    const sectionId = seedSection("indexed", [button(42)]);
    seedArticle("Alpha", owner, [sectionId]);
    db.prepare("INSERT INTO listicle_section_offers (section_id, offer_id, link_role) VALUES (?, 42, 'button')").run(sectionId);
    expect((await request("PATCH", "offers/off_live", {
      offer_name: "New label", offer_url_template: "https://new.example/c?cid={clickid}", payout_method: "in_site", payout_currency: "USD", payout_value: 5,
    })).status).toBe(200);
    expect((await request("DELETE", "offers/off_live")).status).toBe(409);
    expect((await request("DELETE", "offers/off_unused")).status).toBe(200);
    expectChanges({});
  });
});
