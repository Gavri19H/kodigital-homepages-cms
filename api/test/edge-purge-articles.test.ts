import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import { onPublicChange } from "../src/edge/public-change";
import type { Env } from "../src/env";
import { processScheduledArticles } from "../src/workflow/scheduled";
import { addSite, createDb, env as sqliteEnv, hasSqlite, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("../src/edge/public-change", () => ({ onPublicChange: vi.fn() }));

const siteId = "Site-A";
const slug = "Edge-Story";
const articleTags = ["slug:site-a:edge-story", "listing:site-a"];
const ctx = { props: {}, exports: {}, waitUntil() {}, passThroughOnException() {} };

function write(env: Env, method: string, path: string, body?: unknown) {
  return admin.request("/api/admin/" + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env, ctx);
}

describe.skipIf(!hasSqlite)("article write purges through the admin router", () => {
  let sql: SqliteDb;
  let env: Env;

  beforeEach(() => {
    sql = createDb();
    addSite(sql, siteId, "Site A", "finance");
    addSite(sql, "Site-B", "Site B", "finance");
    env = sqliteEnv(sql);
    // The SQLite helper runs each batched statement in a transaction. Use its
    // row-returning executor so SELECT and RETURNING expose rows as D1.batch does.
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = <T>(statements: D1PreparedStatement[]) => {
      for (const statement of statements) statement.run = statement.all.bind(statement);
      return batch<T>(statements);
    };
    vi.mocked(onPublicChange).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => sql.close());

  function seedArticle(status: string, owner: string | null = siteId): number {
    const row = sql.prepare(
      "INSERT INTO articles (site_id, slug, title, content_json, status, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(owner, slug, "Story", '{"blocks":[]}', status, status === "scheduled" ? 100 : null);
    return Number(row.lastInsertRowid);
  }

  function expectChange(reason: string, tags = articleTags, owner: string | null = siteId) {
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(env, ctx, { siteId: owner, tags, reason });
  }

  it.each([null, 2])("purges after article creation with vertical_id %s", async (verticalId) => {
    seedArticle("draft", "Site-B");
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(sql.prepare("SELECT vertical_id FROM articles WHERE slug = ? AND site_id = ?").get(slug, siteId))
        .toEqual({ vertical_id: verticalId });
    });
    const res = await write(env, "POST", "articles", {
      site_id: siteId, slug: " " + slug + " ", title: "Story", vertical_id: verticalId,
    });
    expect(res.status).toBe(201);
    expectChange("article.create");
  });

  it("purges the deleted article's site and slug after deletion", async () => {
    const id = seedArticle("published");
    seedArticle("published", "Site-B");
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(sql.prepare("SELECT site_id FROM articles WHERE slug = ?").all(slug)).toEqual([{ site_id: "Site-B" }]);
    });
    expect((await write(env, "DELETE", "articles/" + id)).status).toBe(200);
    expectChange("article.delete");
  });

  it.each([
    { action: "edit", update: { title: "Edited" }, finalSlug: slug, tags: articleTags },
    { action: "save the same slug", update: { slug }, finalSlug: slug, tags: articleTags },
    { action: "rename", update: { slug: "New-Story" }, finalSlug: "New-Story",
      tags: ["slug:site-a:edge-story", "slug:site-a:new-story", "listing:site-a"] },
  ])("purges once for a PATCH to $action", async ({ update, finalSlug, tags }) => {
    const id = seedArticle("published");
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(sql.prepare("SELECT title, slug FROM articles WHERE id = ?").get(id))
        .toEqual({ title: update.title ?? "Story", slug: finalSlug });
    });
    expect((await write(env, "PATCH", "articles/" + id, update)).status).toBe(200);
    expectChange("article.update", tags);
  });

  it("purges the slug actually replaced when another rename commits during validation", async () => {
    const id = seedArticle("published");
    const prepare = env.DB.prepare.bind(env.DB);
    vi.spyOn(env.DB, "prepare").mockImplementation(query => {
      if (query.includes("WHERE slug = ? AND site_id = ? AND id <> ?")) {
        sql.prepare("UPDATE articles SET slug = ? WHERE id = ?").run("Intermediate", id);
      }
      return prepare(query);
    });
    const res = await write(env, "PATCH", "articles/" + id, { slug: "Final" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ article: { slug: "Final" } });
    expectChange("article.update", ["slug:site-a:intermediate", "slug:site-a:final", "listing:site-a"]);
  });

  it("purges linked and unlinked sites once after multiple verticals are allocated", async () => {
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(sql.prepare("SELECT sc.site_id, cv.vertical_id FROM site_categories sc " +
        "JOIN category_verticals cv ON cv.category_id = sc.category_id JOIN categories c ON c.id = sc.category_id " +
        "WHERE c.slug = ? ORDER BY cv.vertical_id").all("edge-category")).toEqual([
        { site_id: siteId, vertical_id: 1 }, { site_id: siteId, vertical_id: 2 },
      ]);
    });
    const res = await write(env, "POST", "categories", {
      site_id: siteId, slug: "edge-category", name: "Edge category", vertical_ids: [1, 2],
    });
    expect(res.status).toBe(201);
    expectChange("category.create", ["site:site-a", "site:site-b"], null);
  });

  it("covers both committed site allocations in a single global category purge", async () => {
    // Install a second allocation between the global category insert and the handler's join batch.
    sql.prepare("CREATE TEMP TRIGGER share_category AFTER INSERT ON categories BEGIN " +
      "INSERT INTO site_categories (site_id, category_id) VALUES ('Site-B', NEW.id); END").run();
    const res = await write(env, "POST", "categories", {
      site_id: siteId, slug: "shared", name: "Shared", vertical_ids: [1, 2],
    });
    expect(res.status).toBe(201);
    expect(sql.prepare("SELECT site_id FROM site_categories JOIN categories ON categories.id = category_id " +
      "WHERE slug = ? ORDER BY site_id").all("shared")).toEqual([{ site_id: siteId }, { site_id: "Site-B" }]);
    expectChange("category.create", ["site:site-a", "site:site-b"], null);
  });

  it("purges site settings once after a multi-key save and its version bump", async () => {
    const version = sql.prepare("SELECT settings_version FROM sites WHERE id = ?").get(siteId) as { settings_version: number };
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(sql.prepare("SELECT settings_version FROM sites WHERE id = ?").get(siteId))
        .toEqual({ settings_version: version.settings_version + 1 });
      expect(sql.prepare("SELECT value FROM site_settings WHERE site_id = ? AND key = ?").get(siteId, "tagline"))
        .toEqual({ value: "Updated" });
    });
    const res = await write(env, "PATCH", "settings", {
      site_id: siteId, updates: { site_name: "New name", tagline: "Updated" },
    });
    expect(res.status).toBe(200);
    expectChange("settings.update", ["site:site-a"]);
  });

  it.each([
    ["publish", "draft", "published"],
    ["unpublish", "published", "draft"],
    ["archive", "published", "archived"],
    ["schedule", "draft", "scheduled"],
    ["cancel-schedule", "scheduled", "draft"],
  ])("purges after the %s transition commits", async (action, from, to) => {
    const id = seedArticle(from);
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(sql.prepare("SELECT status FROM articles WHERE id = ?").get(id)).toEqual({ status: to });
    });
    const res = await write(env, "POST", "articles/" + id + "/" + action,
      action === "schedule" ? { scheduled_at: 200 } : undefined);
    expect(res.status).toBe(200);
    expectChange("article." + action);
  });

  it("purges the current slug when an article is renamed during its publish snapshot", async () => {
    const id = seedArticle("draft");
    sql.prepare("CREATE TEMP TRIGGER rename_during_snapshot AFTER INSERT ON article_versions BEGIN " +
      "UPDATE articles SET slug = 'Renamed' WHERE id = NEW.article_id; END").run();
    expect((await write(env, "POST", "articles/" + id + "/publish")).status).toBe(200);
    expectChange("article.publish", ["slug:site-a:renamed", "listing:site-a"]);
  });

  it("purges after the restored version's content is written", async () => {
    const id = seedArticle("published");
    const content = '{"blocks":[{"type":"paragraph","data":{"text":"Earlier"}}]}';
    const version = sql.prepare(
      "INSERT INTO article_versions (article_id, version_number, content_json, status) VALUES (?, ?, ?, ?)",
    ).run(id, 1, content, "draft");
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(sql.prepare("SELECT content_json FROM articles WHERE id = ?").get(id)).toEqual({ content_json: content });
    });
    const res = await write(env, "POST", "articles/" + id + "/versions/" + version.lastInsertRowid + "/restore");
    expect(res.status).toBe(200);
    expectChange("article.restore");
  });

  it("passes a scheduled publication to the pending purge path without a request context", async () => {
    const id = seedArticle("scheduled");
    const actual = await vi.importActual<typeof import("../src/edge/public-change")>("../src/edge/public-change");
    vi.mocked(onPublicChange).mockImplementationOnce(actual.onPublicChange);
    expect(await processScheduledArticles(env, 100)).toEqual({ due: 1, published: [id], failed: [] });
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(env, undefined, { siteId, tags: articleTags, reason: "article.publish" });
    expect(sql.prepare("SELECT status FROM cache_purge_log WHERE site_id = ? AND action = ?").all(siteId, "purge_tags"))
      .toEqual([{ status: "pending" }]);
  });

  it("still purges a committed publication if the legacy version bump fails", async () => {
    const id = seedArticle("draft");
    sql.prepare("CREATE TEMP TRIGGER reject_bump BEFORE UPDATE OF content_version ON sites " +
      "BEGIN SELECT RAISE(ABORT, 'version bump failed'); END").run();
    expect((await write(env, "POST", "articles/" + id + "/publish")).status).toBe(500);
    expect(sql.prepare("SELECT status FROM articles WHERE id = ?").get(id)).toEqual({ status: "published" });
    expectChange("article.publish");
  });

  it("skips tenant purges for legacy articles without a site", async () => {
    const id = seedArticle("draft", null);
    expect((await write(env, "POST", "articles/" + id + "/publish")).status).toBe(200);
    expect(onPublicChange).not.toHaveBeenCalled();
  });

  it("skips purges for failed writes, missing articles and rejected transitions", async () => {
    const id = seedArticle("draft");
    expect((await write(env, "PATCH", "articles/" + id, { status: "invalid" })).status).toBe(500);
    expect((await write(env, "DELETE", "articles/" + (id + 1))).status).toBe(404);
    expect((await write(env, "POST", "articles/" + id + "/archive")).status).toBe(409);
    expect(onPublicChange).not.toHaveBeenCalled();
  });
});
