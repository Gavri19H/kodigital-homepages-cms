import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import admin from "../src/admin/router";
import { generateFeatureImage } from "../src/ai/generators/image";
import type { Env } from "../src/env";
import media, { MEDIA_CACHE_CONTROL } from "../src/media";
import { addSite, createDb, env as testEnv, hasSqlite, type SqliteDb } from "./helpers/x06-a2-sqlite";

const site = "image-site";
const revisions = ["first image", "second image"];

describe.skipIf(!hasSqlite)("immutable public media URLs", () => {
  let db: SqliteDb;
  let env: Env;
  let objects: Map<string, ArrayBuffer>;

  beforeEach(() => {
    db = createDb();
    addSite(db, site, "Image Site", "finance");
    objects = new Map();
    env = {
      ...testEnv(db),
      OPENAI_API_KEY: "test-key",
      OPENAI_IMAGE_MODEL: "gpt-image-2",
      MEDIA: {
        async put(key: string, bytes: ArrayBuffer) { objects.set(key, bytes); },
        async get(key: string) {
          const body = objects.get(key);
          return body && { body, size: body.byteLength, httpEtag: key, httpMetadata: { contentType: "image/png" } };
        },
      } as unknown as R2Bucket,
    };
    let renders = 0;
    vi.stubGlobal("fetch", async (url: string) => {
      expect(url).toMatch(/\/images\/generations$/);
      const bytes = Buffer.from(revisions[renders++] ?? "third image");
      return Response.json({ data: [{ b64_json: bytes.toString("base64") }] });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    db.close();
  });

  async function expectTwoVersions(urls: string[]) {
    const rows = db.prepare("SELECT id, storage_key FROM media ORDER BY id").all() as { id: number; storage_key: string }[];
    expect(rows).toHaveLength(2);
    expect(objects.size).toBe(2);
    expect(urls[0]).not.toBe(urls[1]);
    expect(urls).toEqual(rows.map(row => `/media/${row.storage_key}`));
    for (const [i, row] of rows.entries()) {
      for (const path of [urls[i]!, `/media/${row.id}`]) {
        const response = await media.request(path, {}, env);
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe(MEDIA_CACHE_CONTROL);
        expect(await response.text()).toBe(revisions[i]);
      }
    }
  }

  it.each([
    ["/admin/media", 200],
    ["/api/admin/media/upload", 201],
    ["/api/admin/leadgen/assets/brand-logo", 200],
  ] as const)("retains both uploads of the same filename through %s", async (path, status) => {
    const urls: string[] = [];
    for (const bytes of revisions) {
      const form = new FormData();
      form.append("file", new File([bytes], "same.png", { type: "image/png" }));
      form.append("site_id", site);
      const router = path === "/admin/media" ? media : admin;
      const response = await router.request(path, { method: "POST", body: form }, env);
      expect(response.status).toBe(status);
      const body = await response.json() as { url?: string; storage_key?: string };
      urls.push(body.url ?? `/media/${body.storage_key}`);
    }
    await expectTwoVersions(urls);
  });

  it.each([
    ["/api/admin/ai/image", { prompt: "A tree" }],
    ["/api/admin/ai/logo", {}],
    ["/api/admin/leadgen/assets/persona-image", { persona_key: "young_woman" }],
  ] as const)("retains both generations for the same request through %s", async (path, fields) => {
    const urls: string[] = [];
    for (const _ of revisions) {
      const response = await admin.request(path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site_id: site, ...fields }),
      }, env);
      expect(response.status).toBe(200);
      const body = await response.json() as { image_url?: string; url?: string; ai_generation_id: string };
      urls.push((body.image_url ?? body.url)!);
      if (urls.length === 1 && path !== "/api/admin/ai/image") {
        // Reopen the same receipt for a real render, keeping its generation ID.
        db.prepare("UPDATE ai_generations SET status = 'pending' WHERE id = ?").run(body.ai_generation_id);
      }
    }
    await expectTwoVersions(urls);
    if (path === "/api/admin/ai/logo") {
      expect(db.prepare("SELECT value FROM site_settings WHERE site_id = ? AND key = 'logo_media_id'").get(site))
        .toEqual({ value: urls[1]!.slice("/media/".length) });
    }
  });

  it("moves the article's featured image and replays its new key without another upload", async () => {
    const input = { site_id: site, article_title: "Risk management", article_slug: "risk-management", vertical: "finance" };
    const first = await generateFeatureImage(env, input);
    expect(first.status).toBe("success");
    db.prepare("INSERT INTO articles (site_id, title, slug, content_json, featured_image_id) VALUES (?, ?, ?, '{}', ?)")
      .run(site, input.article_title, input.article_slug, first.media_id);
    db.prepare("UPDATE ai_generations SET status = 'failed', parsed_json = NULL WHERE id = ?").run(first.ai_generation_id);

    const second = await generateFeatureImage(env, input);
    expect(second).toMatchObject({ status: "success", replay: false, ai_generation_id: first.ai_generation_id });
    expect(second.media_id).not.toBe(first.media_id);
    expect(db.prepare("SELECT featured_image_id FROM articles WHERE site_id = ? AND slug = ?").get(site, input.article_slug))
      .toEqual({ featured_image_id: second.media_id });
    const replay = await generateFeatureImage(env, input);
    expect(replay).toMatchObject({ replay: true, media_id: second.media_id, storage_key: second.storage_key });
    await expectTwoVersions([`/media/${first.storage_key}`, `/media/${second.storage_key}`]);
  });

  it("keeps the newer reference and receipt when two regenerations finish out of order", async () => {
    const input = { site_id: site, article_title: "Savings", article_slug: "savings", vertical: "finance" };
    const first = await generateFeatureImage(env, input);
    db.prepare("INSERT INTO articles (site_id, title, slug, content_json, featured_image_id) VALUES (?, ?, ?, '{}', ?)")
      .run(site, input.article_title, input.article_slug, first.media_id);
    db.prepare("UPDATE ai_generations SET status = 'pending' WHERE id = ?").run(first.ai_generation_id);

    let reachedBatch!: () => void;
    const reached = new Promise<void>(resolve => { reachedBatch = resolve; });
    let releaseBatch!: () => void;
    const released = new Promise<void>(resolve => { releaseBatch = resolve; });
    const commit = env.DB.batch.bind(env.DB);
    vi.spyOn(env.DB, "batch").mockImplementationOnce(async statements => {
      reachedBatch();
      await released;
      return commit(statements);
    });

    const delayed = generateFeatureImage(env, input);
    await reached;
    const newest = await generateFeatureImage(env, input).finally(releaseBatch);
    const late = await delayed;
    expect(newest.status).toBe("success");
    expect(late).toMatchObject({ media_id: newest.media_id, storage_key: newest.storage_key, replay: false });
    expect(db.prepare("SELECT featured_image_id FROM articles WHERE site_id = ? AND slug = ?").get(site, input.article_slug))
      .toEqual({ featured_image_id: newest.media_id });
    expect(await generateFeatureImage(env, input)).toMatchObject({
      media_id: newest.media_id, storage_key: newest.storage_key, replay: true,
    });
    expect(objects.size).toBe(3);
    expect(await (await media.request(`/media/${newest.storage_key}`, {}, env)).text()).toBe("third image");
  });

  it("replaces a legacy numeric hero setting and preserves a later manual selection", async () => {
    const key = "ai/image-site/feature_image/site-hero.png";
    objects.set(key, await new Blob(["legacy image"]).arrayBuffer());
    const { lastInsertRowid } = db.prepare(
      "INSERT INTO media (site_id, filename, storage_key, mime_type) VALUES (?, 'feature-site-hero.png', ?, 'image/png')",
    ).run(site, key);
    db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, 'hero_image_media_id', ?)").run(site, String(lastInsertRowid));
    const setting = db.prepare("SELECT value FROM site_settings WHERE site_id = ? AND key = 'hero_image_media_id'");
    const input = { site_id: site, article_title: "Site hero", article_slug: "site-hero", vertical: "finance" };

    const next = await generateFeatureImage(env, input);
    expect(next.status).toBe("success");
    expect(next.storage_key).not.toBe(key);
    expect(setting.get(site)).toEqual({ value: next.storage_key });
    expect(await (await media.request(`/media/${lastInsertRowid}`, {}, env)).text()).toBe("legacy image");
    expect(await (await media.request(`/media/${key}`, {}, env)).text()).toBe("legacy image");

    db.prepare("UPDATE site_settings SET value = 'uploads/editor.png' WHERE site_id = ? AND key = 'hero_image_media_id'").run(site);
    db.prepare("UPDATE ai_generations SET status = 'pending' WHERE id = ?").run(next.ai_generation_id);
    const third = await generateFeatureImage(env, input);
    expect(third.status).toBe("success");
    expect(third.storage_key).not.toBe(next.storage_key);
    expect(setting.get(site)).toEqual({ value: "uploads/editor.png" });
  });
});
