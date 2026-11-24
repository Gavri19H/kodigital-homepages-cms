import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { articleKey, feedRssKey } from "../src/cache/cache-keys";
import { onPublicChange } from "../src/edge/public-change";
import type { PublicPageProps } from "../src/edge/types";
import type { Env } from "../src/env";
import worker, { PublicPage } from "../src/index";
import { ctxCapture, makeKvStub } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const siteId = "Site-A";
const origin = "https://news.example";
const articlePath = "/article/story";
const oldTitle = "Original headline";
const newTitle = "Updated headline";
const purgeTags = vi.fn(async (_tags: string[]) => ({ success: true, errors: [] }));
const cacheApi = { match: vi.fn(async () => undefined), put: vi.fn(async () => {}) };

describe("edge publish freshness", () => {
  let sql: SqliteDb;
  let env: Env;
  let context: ReturnType<typeof ctxCapture>;
  let store: Map<string, string>;
  let articleId: number;

  beforeEach(() => {
    sql = createDb();
    addSite(sql, siteId, "News", "home");
    sql.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(siteId, "news.example");
    articleId = Number(sql.prepare(`INSERT INTO articles (site_id, slug, title, content_json, status, published_at)
      VALUES (?, 'story', ?, '{"blocks":[]}', 'published', 100)`).run(siteId, oldTitle).lastInsertRowid);
    env = sqliteEnv(sql);
    env.DB.withSession = () => ({
      prepare: env.DB.prepare.bind(env.DB), batch: env.DB.batch.bind(env.DB), getBookmark: () => "0002",
    });
    const cache = makeKvStub();
    store = cache.store;
    env.CACHE = Object.assign(cache.kv, {
      getWithMetadata: vi.fn(async (key: string) => ({ value: store.get(key) ?? null, metadata: null, cacheStatus: null })),
    });
    vi.spyOn(env.CACHE, "get");
    vi.spyOn(env.CACHE, "put");
    vi.spyOn(Math, "random").mockReturnValue(0); // Exercise KV stats if a legacy lookup is attempted.
    env.CACHE_API_ENABLED = "true";
    vi.stubGlobal("caches", { default: cacheApi });

    context = ctxCapture();
    // A loopback invocation models an edge miss and runs the real snapshot and Hono renderer.
    const binding = Object.assign(
      ({ props }: { props: PublicPageProps }) => new PublicPage({ ...context.ctx, props }, env),
      { purgeTags },
    );
    Object.assign(context.ctx, { exports: { PublicPage: binding } });
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await Promise.all(context.promises);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sql.close();
  });

  function visit(path: string, etag?: string) {
    const request = new Request(origin + path, { headers: etag ? { "If-None-Match": etag } : {} });
    return worker.fetch(request, env, context.ctx);
  }

  async function expectLegacyCacheUntouched() {
    await Promise.all(context.promises);
    expect(env.CACHE.getWithMetadata).not.toHaveBeenCalled();
    expect(env.CACHE.get).not.toHaveBeenCalled();
    expect(env.CACHE.put).not.toHaveBeenCalled();
    expect(cacheApi.match).not.toHaveBeenCalled();
    expect(cacheApi.put).not.toHaveBeenCalled();
  }

  it("serves the edited article and a new ETag to a browser holding the pre-PATCH ETag", async () => {
    const before = await visit(articlePath);
    expect(before.status).toBe(200);
    expect(before.headers.get("Cache-Tag")).toBe("site:site-a,slug:site-a:story,listing:site-a");
    expect(await before.text()).toContain(">" + oldTitle + "</h1>");
    const oldEtag = before.headers.get("ETag")!;
    expect(oldEtag).toMatch(/^"[0-9a-f]{16}"$/);

    const patch = await worker.fetch(new Request(env.ADMIN_BASE_URL + "/api/admin/articles/" + articleId, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: newTitle }),
    }), env, context.ctx);
    expect(patch.status).toBe(200);
    expect(await patch.json()).toMatchObject({ article: { title: newTitle } });
    expect(purgeTags).toHaveBeenCalledExactlyOnceWith(["slug:site-a:story", "listing:site-a", "snap:site-a", "nf:site-a"]);

    const after = await visit(articlePath, oldEtag);
    expect(after.status).toBe(200);
    expect(after.headers.get("x-edge-cache")).toBe("none");
    const html = await after.text();
    expect(html).toContain(">" + newTitle + "</h1>");
    expect(html).not.toContain(oldTitle);
    const newEtag = after.headers.get("ETag")!;
    expect(newEtag).toMatch(/^"[0-9a-f]{16}"$/);
    expect(newEtag).not.toBe(oldEtag);
    expect((await visit(articlePath, newEtag)).status).toBe(304);
    await expectLegacyCacheUntouched();
  });

  it.each([
    [articlePath, articleKey(siteId, "story", 1)],
    ["/rss", feedRssKey(siteId, 1)],
  ])("uses the warm legacy copy of %s on fallback and renders from D1 on an edge miss", async (path, key) => {
    const fallback = () => worker.fetch(new Request(origin + path), env);
    const cold = await fallback();
    expect(cold.status).toBe(200);
    const original = await cold.text();
    expect(original).toContain(oldTitle);
    expect(store.get(key)).toBe(original);

    // Keep the same legacy key and put distinguishable content behind it.
    sql.prepare("UPDATE articles SET title = ? WHERE id = ?").run(newTitle, articleId);
    expect(await (await fallback()).text()).toBe(original);
    vi.clearAllMocks();
    const inner = await visit(path);
    expect(inner.status).toBe(200);
    expect(inner.headers.get("x-edge-cache")).toBe("none");
    expect(await inner.text()).toContain(newTitle);
    await expectLegacyCacheUntouched();
    expect(store.get(key)).toBe(original);
  });

  it("bumps every site named by a global change exactly once, including tags beyond the immediate purge", async () => {
    const ids = Array.from({ length: 161 }, (_, i) => "News-" + String(i).padStart(3, "0"));
    for (const id of ids) addSite(sql, id, id, "home");
    const tags = ids.map(id => "site:" + id.toLowerCase());
    const prepare = vi.spyOn(env.DB, "prepare");
    await onPublicChange(env, context.ctx, {
      siteId: null, tags: [...tags, "SITE:NEWS-000", "slug:site-a:story", "host:news.example"], reason: "category.update",
    });

    expect(sql.prepare("SELECT id, content_version, write_bookmark FROM sites ORDER BY id").all()).toEqual([
      ...ids.map(id => ({ id, content_version: 2, write_bookmark: "0002" })),
      { id: siteId, content_version: 1, write_bookmark: null },
    ]);
    expect(prepare.mock.calls.filter(([query]) => query.startsWith("UPDATE sites SET content_version"))).toHaveLength(3);
    expect(purgeTags).toHaveBeenCalledExactlyOnceWith(tags.slice(0, 100));
  });
});
