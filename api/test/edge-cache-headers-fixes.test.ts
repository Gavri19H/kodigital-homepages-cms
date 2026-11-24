import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyEdgeCacheHeaders } from "../src/cache/cache-control";
import type { PublicPageProps } from "../src/edge/types";
import type { Env } from "../src/env";
import worker, { honoFetch, PublicPage } from "../src/index";
import { ctxCapture } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv, type SqliteDb } from "./helpers/x06-a2-sqlite";

vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const siteId = "news";
const host = "news.example";
const origin = "https://" + host;
const day = "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400";

describe("edge cache headers", () => {
  it.each([
    [200, "no-store"],
    [200, "public, max-age=0, NO-STORE"],
    [301, "no-store, max-age=0"],
    [404, "private, no-store"],
  ] as const)("honors the renderer's %i %s even with gateway purge tags", (status, control) => {
    const response = new Response(null, { status, headers: { "Cache-Control": control, "Cache-Tag": "old" } });
    const edge = applyEdgeCacheHeaders(response, { siteId, path: "/lg/car", extraTags: ["quote:news:1"] });
    expect(edge.status).toBe(status);
    expect(edge.headers.get("Cache-Control")).toBe("private, no-store");
    expect(edge.headers.has("Cache-Tag")).toBe(false);
  });

  it.each([["/art%69cle/my-story", "my-story"], ["/page/about", "about"]])(
    "tags %s for both edits to its slug and site listing changes", (path, slug) => {
      const response = applyEdgeCacheHeaders(new Response(), { siteId, path });
      expect(response.headers.get("Cache-Control")).toBe(day);
      expect(response.headers.get("Cache-Tag")?.split(",").sort()).toEqual([
        "listing:news", "site:news", "slug:news:" + slug,
      ]);
    },
  );
});

// Model Workers Cache storage and tag eviction. The gateway, PublicPage,
// renderer and admin write run against the same SQLite fixture.
function cacheContext(env: Env) {
  const { ctx, promises } = ctxCapture();
  const entries = new Map<string, Response>();
  const binding = ({ props }: { props: PublicPageProps }) => ({
    async fetch(request: Request) {
      const key = JSON.stringify([props.siteKey, props.variantKey, request.url]);
      const cached = entries.get(key);
      const response = cached?.clone() ?? await new PublicPage({ ...ctx, props }, env).fetch(request);
      if (!cached && response.headers.get("Cache-Control")?.startsWith("public,")) {
        entries.set(key, response.clone());
      }
      response.headers.set("cf-cache-status", cached ? "HIT" : "MISS");
      return response;
    },
  });
  async function purgeTags(tags: string[]) {
    for (const [key, response] of entries) {
      if (response.headers.get("Cache-Tag")?.split(",").some(tag => tags.includes(tag))) entries.delete(key);
    }
    return { success: true, errors: [] };
  }
  Object.assign(ctx, { exports: { PublicPage: Object.assign(binding, { purgeTags }) } });
  return { ctx, promises };
}

describe("tenant page rendering", () => {
  let db: SqliteDb;
  let env: Env;
  let cache: ReturnType<typeof cacheContext>;
  let relatedId: number | bigint;

  beforeEach(() => {
    db = createDb();
    addSite(db, siteId, "News", "home");
    db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(siteId, host);
    const category = db.prepare("INSERT INTO categories (slug, name) VALUES ('outdoors', 'Outdoors')").run().lastInsertRowid;
    db.prepare("INSERT INTO site_categories (site_id, category_id) VALUES (?, ?)").run(siteId, category);
    const article = db.prepare(`INSERT INTO articles (site_id, category_id, slug, title, content_json, status, published_at)
      VALUES (?, ?, ?, ?, '{"blocks":[]}', 'published', 100)`);
    article.run(siteId, category, "story", "Main story");
    relatedId = article.run(siteId, category, "neighbor", "Original related headline").lastInsertRowid!;
    env = sqliteEnv(db);
    cache = cacheContext(env);
  });
  afterEach(async () => {
    await Promise.all(cache.promises);
    vi.restoreAllMocks();
    db.close();
  });

  function visit(path: string) {
    return worker.fetch(new Request(origin + path), env, cache.ctx);
  }

  it("refreshes a cached article's related card on the first visit after its neighbor is edited", async () => {
    const path = "/article/story";
    await visit(path);
    await visit("/site-icon.svg");
    const warm = await visit(path);
    expect(warm.headers.get("x-edge-cache")).toBe("HIT");
    expect(await warm.text()).toContain("Original related headline");

    const edit = await worker.fetch(new Request(env.ADMIN_BASE_URL + "/api/admin/articles/" + relatedId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Edited related headline" }),
    }), env, cache.ctx);
    expect(edit.status).toBe(200);
    const fresh = await visit(path);
    expect(fresh.headers.get("x-edge-cache")).toBe("MISS");
    const html = await fresh.text();
    expect(html).toContain("Edited related headline");
    expect(html).not.toContain("Original related headline");
    expect((await visit("/site-icon.svg")).headers.get("x-edge-cache")).toBe("HIT");
  });

  it.each(["/", "/article/story", "/category/outdoors"])(
    "makes only the gateway-assigned bot render of %s public", async path => {
      const live = await honoFetch(Object.assign(new Request(origin + path), { cf: { botManagement: { score: 5 } } }), env);
      const keyed = await honoFetch(new Request(origin + path, { headers: { "x-cms-variant": "bot" } }), env);
      expect(live.status).toBe(200);
      expect(live.headers.get("Cache-Control")).toBe("private, no-store");
      expect(keyed.status).toBe(200);
      expect(keyed.headers.get("Cache-Control")).toBe("public, max-age=300, stale-while-revalidate=86400");
      expect(await keyed.text()).toBe(await live.text());
    },
  );

  it.each(["storage key", "numeric media ID"])("serves the uploaded favicon by %s with zero D1 or R2 reads on a HIT", async reference => {
    const key = "2026/11/24/icon.png";
    const id = db.prepare("INSERT INTO media (site_id, filename, storage_key, mime_type) VALUES (?, 'icon.png', ?, 'image/png')")
      .run(siteId, key).lastInsertRowid;
    db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, 'favicon_media_id', ?)")
      .run(siteId, reference === "storage key" ? key : String(id));
    const bytes = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1cAAAAASUVORK5CYII=", "base64"));
    const get = vi.fn(async (storageKey: string) => storageKey === key ? {
      body: new Response(bytes).body, httpMetadata: { contentType: "image/png" }, httpEtag: '"icon-v1"', size: bytes.byteLength,
    } : null);
    Object.assign(env.MEDIA, { get });
    const cold = await visit("/favicon.ico");
    expect(cold.status).toBe(200);
    expect(cold.headers.get("Location")).toBeNull();
    expect(cold.headers.get("Content-Type")).toBe("image/png");
    expect(cold.headers.get("ETag")).toBe('"icon-v1"');
    expect(cold.headers.get("Cache-Control")).toBe(day);
    expect(cold.headers.get("Cache-Tag")).toBe("site:news");
    expect(cold.headers.get("x-edge-cache")).toBe("MISS");
    expect(new Uint8Array(await cold.arrayBuffer())).toEqual(bytes);
    expect(get).toHaveBeenCalledExactlyOnceWith(key);

    const queries = vi.spyOn(env.DB, "prepare");
    get.mockClear();
    const hit = await visit("/favicon.ico?utm_source=second");
    expect(hit.headers.get("x-edge-cache")).toBe("HIT");
    expect(new Uint8Array(await hit.arrayBuffer())).toEqual(bytes);
    expect(queries).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("uses the site's own badge when the selected icon is missing from R2", async () => {
    const setting = db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
    setting.run(siteId, "favicon_media_id", "missing.svg");
    setting.run(siteId, "brand_tokens_json", '{"tw-brand":"#345678"}');
    Object.assign(env.MEDIA, { get: async () => null });
    const favicon = await visit("/favicon.ico");
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("Content-Type")).toBe("image/svg+xml; charset=utf-8");
    expect(favicon.headers.get("Cache-Tag")).toBe("site:news");
    const svg = await favicon.text();
    expect(svg).toContain('fill="#345678"');
    expect(svg).toBe(await (await visit("/site-icon.svg")).text());
  });
});
