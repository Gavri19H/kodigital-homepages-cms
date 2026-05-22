import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import {
  RESERVED_PATHS,
  isReservedPath,
} from "../src/public/reserved";
import { accessAuth } from "../src/auth/access-auth";
import type { Env } from "../src/env";

interface PageSeed {
  slug: string;
  title?: string;
  content_html?: string | null;
  status?: string;
  updated_at?: number | null;
}

function makeDbMock(pages: PageSeed[]) {
  const rows = pages.map((p, i) => ({
    id: i + 1,
    slug: p.slug,
    title: p.title ?? p.slug,
    content_html: p.content_html ?? `<p>page-${p.slug}</p>`,
    status: p.status ?? "published",
    updated_at: p.updated_at ?? null,
  }));
  return {
    prepare(sql: string) {
      const stmt = {
        _args: [] as unknown[],
        bind(...args: unknown[]) {
          stmt._args = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          // T26: public middleware resolves SiteContext via
          // (domains JOIN sites). Return a tenant row for "localhost"
          // (the default Hono test hostname) so the reserved-path
          // suite continues to exercise the public routes after the
          // middleware lands.
          if (sql.startsWith("SELECT s.id AS site_id")) {
            const host = String(stmt._args[0] ?? "").toLowerCase();
            if (host === "localhost") {
              return {
                site_id: "site_local",
                hostname: "localhost",
                vertical_slug: "home",
                status: "active",
                content_version: 1,
                settings_version: 1,
              } as unknown as T | null;
            }
            return null;
          }
          if (
            sql.startsWith("SELECT id, slug, title, content_html, status, updated_at FROM pages") ||
            sql.startsWith("SELECT id, slug, title, content_html, status, updated_at, site_id FROM pages")
          ) {
            // T27: site-scoped page query passes (slug, siteId). The
            // fixture pages here are treated as global (site_id NULL) so
            // they still resolve under the (site_id = ? OR site_id IS NULL)
            // clause.
            const slug = stmt._args[0] as string;
            const r = rows.find((x) => x.slug === slug && x.status === "published");
            if (r) {
              return { ...r, site_id: null } as unknown as T | null;
            }
            return null;
          }
          if (sql.startsWith("SELECT * FROM articles WHERE slug")) {
            return null;
          }
          if (sql.startsWith("SELECT id, slug, name FROM categories")) {
            return null;
          }
          return null;
        },
        async all<T = unknown>() {
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

function makeNoopKv(): KVNamespace {
  // T33: /robots.txt + /ads.txt KV-cache the response body (T13). The
  // reserved-path suite exercises the cold path (KV miss), so the
  // fixture KV returns null on get and accepts put as a no-op.
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

function buildEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  // T26: ADMIN_HOST is distinct from "localhost" so the default Hono
  // test hostname routes through publicRouter as a tenant. The
  // makeDbMock above answers the (domains JOIN sites) SELECT for
  // "localhost" with a fake registered site row.
  return {
    DB: db,
    CACHE: makeNoopKv(),
    MEDIA: {} as R2Bucket,
    APP_ENV: "development",
    ADMIN_HOST: "admin.example",
    ADMIN_BASE_URL: "http://admin.example:8787",
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    DEV_BYPASS_AUTH: "true",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
    ...overrides,
  };
}

function buildWiredApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use("/admin/*", accessAuth);
  app.get("/admin", accessAuth, (c) =>
    c.json({ ok: true, area: "admin" }),
  );
  app.route("/", publicRouter);
  return app;
}

describe("reserved-path guard", () => {
  it("RESERVED_PATHS contains exactly admin, api, static, assets, media, preview, health (7 entries)", () => {
    expect([...RESERVED_PATHS].sort()).toEqual(
      ["admin", "api", "assets", "health", "media", "preview", "static"],
    );
    expect(RESERVED_PATHS.length).toBe(7);
  });

  it("isReservedPath returns true for reserved heads only", () => {
    expect(isReservedPath("admin")).toBe(true);
    expect(isReservedPath("/admin")).toBe(true);
    expect(isReservedPath("admin/articles")).toBe(true);
    expect(isReservedPath("api")).toBe(true);
    expect(isReservedPath("static")).toBe(true);
    expect(isReservedPath("assets")).toBe(true);
    expect(isReservedPath("media")).toBe(true);
    expect(isReservedPath("preview")).toBe(true);
    expect(isReservedPath("health")).toBe(true);
    expect(isReservedPath("about")).toBe(false);
    expect(isReservedPath("")).toBe(false);
    expect(isReservedPath(null)).toBe(false);
    expect(isReservedPath(undefined)).toBe(false);
  });

  it("BEHAVIORAL T9.AC2: GET /admin routes to admin handler, NOT the /:slug placeholder (even when a page row with slug='admin' is planted)", async () => {
    // Plant a published page row with the reserved slug. If the /:slug
    // catch-all served it, the response would be 200 HTML "<p>page-admin</p>".
    // The reserved-path guard prevents this — and route order ensures the
    // dedicated admin handler answers first.
    const db = makeDbMock([
      { slug: "admin", content_html: "<p>impostor admin page</p>" },
    ]);
    const app = buildWiredApp();
    const res = await app.request("/admin", {}, buildEnv(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; area: string };
    expect(body.area).toBe("admin");
    expect(body.ok).toBe(true);
  });

  it("/:slug rejects reserved 'api' even with a planted page row", async () => {
    const db = makeDbMock([
      { slug: "api", content_html: "<p>impostor api page</p>" },
    ]);
    const app = buildWiredApp();
    const res = await app.request("/api", {}, buildEnv(db));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Not Found");
  });

  it("/:slug serves a non-reserved published page", async () => {
    const db = makeDbMock([
      { slug: "about", content_html: "<p>about us</p>" },
    ]);
    const app = buildWiredApp();
    const res = await app.request("/about", {}, buildEnv(db));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<p>about us</p>");
  });

  it("/:slug returns 404 for unknown slug (no page or article)", async () => {
    const db = makeDbMock([]);
    const app = buildWiredApp();
    const res = await app.request("/no-such-slug", {}, buildEnv(db));
    expect(res.status).toBe(404);
  });

  it("/health on the public router returns the public scope marker", async () => {
    const db = makeDbMock([]);
    const app = buildWiredApp();
    const res = await app.request("/health", {}, buildEnv(db));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; scope: string };
    expect(body.ok).toBe(true);
    expect(body.scope).toBe("public");
  });

  it("/robots.txt is served by the public router", async () => {
    const db = makeDbMock([]);
    const app = buildWiredApp();
    const res = await app.request("/robots.txt", {}, buildEnv(db));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toContain("User-agent: *");
    expect(body).toContain("Disallow: /admin/");
  });
});
