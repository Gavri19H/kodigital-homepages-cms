import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import { onPublicChange } from "../src/edge/public-change";
import type { Env } from "../src/env";
import { publicCss } from "../src/public/assets/public-css";
import { publicJs } from "../src/public/assets/public-js";
import publicRouter from "../src/public/router";
import { STEPS } from "../src/site-provisioning/steps";
import { buildEnv, makeFakeDb } from "./helpers/admin-test-kit";
import { addSite, createDb, env as sqliteEnv, hasSqlite, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("../src/edge/public-change", () => ({ onPublicChange: vi.fn() }));

const owner = "Site-A";
const allTags = ["site:site-a", "site:site-b", "site:site-c"];
const ctx = { props: {}, exports: {}, waitUntil() {}, passThroughOnException() {} };

describe.skipIf(!hasSqlite)("cache invalidation for globally visible rows", () => {
  let db: SqliteDb;
  let env: Env;

  beforeEach(() => {
    db = createDb();
    addSite(db, owner, "Publisher", "parenting");
    addSite(db, "Site-B", "Reader", "finance");
    addSite(db, "Site-C", "Inactive", "home");
    db.prepare("UPDATE sites SET status = 'disabled' WHERE id = ?").run("Site-C");
    env = sqliteEnv(db);
    vi.mocked(onPublicChange).mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => db.close());

  function write(method: string, path: string, body?: unknown) {
    return admin.request("/api/admin/" + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, env, ctx);
  }

  function expectGlobalChange(context: typeof ctx | undefined, reason: string) {
    expect(onPublicChange).toHaveBeenCalledExactlyOnceWith(env, context, { siteId: null, tags: allTags, reason });
  }

  function seedMedia() {
    return Number(db.prepare(
      "INSERT INTO media (site_id, filename, storage_key, mime_type, caption) VALUES (NULL, ?, ?, ?, ?)",
    ).run("photo.png", "shared/photo.png", "image/png", "Original caption").lastInsertRowid);
  }

  it("purges every tenant once after a global media caption changes", async () => {
    const id = seedMedia();
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(db.prepare("SELECT caption FROM media WHERE id = ?").get(id)).toEqual({ caption: "Revised" });
    });
    expect((await write("PUT", "media/" + id, { caption: "Revised" })).status).toBe(200);
    expectGlobalChange(ctx, "media.update");
  });

  it("purges every tenant once after a global media deletion", async () => {
    const id = seedMedia();
    env.MEDIA.delete = vi.fn();
    vi.mocked(onPublicChange).mockImplementationOnce(async () => {
      expect(db.prepare("SELECT id FROM media WHERE id = ?").get(id)).toBeUndefined();
    });
    expect((await write("DELETE", "media/" + id + "?site_id=" + owner)).status).toBe(200);
    expect(env.MEDIA.delete).toHaveBeenCalledExactlyOnceWith("shared/photo.png");
    expectGlobalChange(ctx, "media.delete");
  });

  it("keeps global media folder changes local to the library", async () => {
    const id = seedMedia();
    expect((await write("PUT", "media/" + id, { folder: "archive", caption: "Original caption" })).status).toBe(200);
    expect(db.prepare("SELECT folder FROM media WHERE id = ?").get(id)).toEqual({ folder: "archive" });
    expect(onPublicChange).not.toHaveBeenCalled();
  });

  it("purges a newly created category for a tenant that previously served a 404 and has no allocation", async () => {
    db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run("Site-B", "reader.example");
    env.CACHE.getWithMetadata = vi.fn().mockResolvedValue({ value: null, metadata: null });
    const url = "https://reader.example/category/community";
    expect((await publicRouter.request(url, {}, env)).status).toBe(404);

    expect((await write("POST", "categories", {
      site_id: owner, slug: "community", name: "Community guides", vertical_ids: [1, 2],
    })).status).toBe(201);
    expect(db.prepare("SELECT site_id FROM site_categories JOIN categories ON categories.id = category_id " +
      "WHERE slug = ?").all("community")).toEqual([{ site_id: owner }]);
    expectGlobalChange(ctx, "category.create");
    const fresh = await publicRouter.request(url, {}, env);
    expect(fresh.status).toBe(200);
    expect(await fresh.text()).toContain("Community guides");
  });

  it("purges a committed global category even if its admin allocation batch fails", async () => {
    db.prepare("CREATE TRIGGER reject_link BEFORE INSERT ON site_categories " +
      "BEGIN SELECT RAISE(ABORT, 'allocation failed'); END").run();
    expect((await write("POST", "categories", {
      site_id: owner, slug: "community", name: "Community", vertical_ids: [1],
    })).status).toBe(500);
    expect(db.prepare("SELECT slug FROM categories WHERE slug = ?").get("community")).toEqual({ slug: "community" });
    expectGlobalChange(ctx, "category.create");
  });

  function allocate() {
    return STEPS.allocate_vertical_categories({ env, db: env.DB, site_id: owner, job_id: "job-1", step_order: 3 });
  }

  it("purges once for multiple new provisioned categories and skips a run that only adds site links", async () => {
    // The last planned slug already exists. Earlier inserts still need one purge.
    db.prepare("INSERT INTO categories (slug, name) VALUES (?, ?)").run("newborn-baby-care", "Newborn & Baby Care");
    const first = await allocate();
    expect(first.status).toBe("completed");
    expect(JSON.parse(first.output)).toMatchObject({ allocated: 4 });
    expectGlobalChange(undefined, "provision.categories.create");

    vi.mocked(onPublicChange).mockClear();
    db.prepare("DELETE FROM site_categories WHERE site_id = ?").run(owner);
    expect((await allocate()).status).toBe("completed");
    expect(db.prepare("SELECT COUNT(*) AS n FROM site_categories WHERE site_id = ?").get(owner)).toEqual({ n: 4 });
    expect(onPublicChange).not.toHaveBeenCalled();
  });

  it("purges categories already inserted when a later provisioning link fails", async () => {
    db.prepare("CREATE TRIGGER reject_second_link BEFORE INSERT ON site_categories WHEN NEW.display_order = 1 " +
      "BEGIN SELECT RAISE(ABORT, 'allocation failed'); END").run();
    await expect(allocate()).rejects.toThrow("allocation failed");
    expect(db.prepare("SELECT slug FROM categories WHERE slug IN (?, ?) ORDER BY slug")
      .all("parenting-tips", "child-development")).toEqual([{ slug: "child-development" }, { slug: "parenting-tips" }]);
    expectGlobalChange(undefined, "provision.categories.create");
  });
});

describe("public assets requested by HTML from earlier releases", () => {
  const { db } = makeFakeDb([{ match: "FROM domains d INNER JOIN sites", row: {
    site_id: owner, hostname: "tenant.example", status: "active",
  } }]);
  const env = buildEnv(db);
  const base = "https://tenant.example/assets/";

  it.each([
    ["public.0.css", "text/css", publicCss],
    ["public.7old9.js", "text/javascript", publicJs],
  ])("serves the current bundle and immutable headers for %s", async (filename, mime, body) => {
    const response = await publicRouter.request(base + filename, {}, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(mime + "; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(await response.text()).toBe(body);
  });

  it("returns 404 for malformed asset names on a tenant host", async () => {
    for (const name of ["public..css", "public.a-b.js", "public.A.css", "public.a.b.css", "public.a.js/more"]) {
      const response = await publicRouter.request(base + name, {}, env);
      expect(response.status, name).toBe(404);
      expect(response.headers.get("Cache-Control") ?? "", name).not.toContain("immutable");
    }
  });
});
