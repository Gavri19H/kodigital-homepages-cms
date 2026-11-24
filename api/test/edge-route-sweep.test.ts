import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { gatewayFetch } from "../src/edge/gateway";
import type { PublicPageProps } from "../src/edge/types";
import type { Env } from "../src/env";
import worker, { honoFetch, PublicPage } from "../src/index";
import { STEP_KEYS } from "../src/site-provisioning";
import manifest from "./fixtures/public-change-manifest.json";
import { ctxCapture } from "./helpers/leadgen-analytics-harness";
import { addSite, createDb, env as sqliteEnv, type SqliteDb } from "./helpers/x06-a2-sqlite";

// Supply the context that workerd gives an entrypoint. PublicPage.fetch, honoFetch,
// the renderers, and the edge cache-header policy all run their production code.
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const siteId = "sweep";
const host = siteId + ".example";
const origin = "https://" + host;
const returningSid = "returning-cookie-canary";
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const fallbackSid = /\bko-[a-z0-9]{8,10}-[a-z0-9]{1,8}\b/i;
const day = "public, max-age=0, s-maxage=86400, stale-while-revalidate=86400";
const cachePolicy: Record<number, string> = {
  200: day, 301: day, 308: day,
  404: "public, max-age=0, s-maxage=60",
  302: "private, no-store",
};

function leadgenId(prefix: string, n: number) {
  return prefix + "_" + String(n).padStart(26, "0");
}

function seedTenant(db: SqliteDb) {
  addSite(db, siteId, "Sweep News", "home");
  db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(siteId, host);
  const setting = db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
  setting.run(siteId, "site_name", "Sweep News");
  setting.run(siteId, "ads_txt_content", "ads.example, sweep, DIRECT");
  setting.run(siteId, "items_per_page", "1");
  const category = db.prepare("INSERT INTO categories (slug, name) VALUES ('garden', 'Garden')").run().lastInsertRowid;
  db.prepare("INSERT INTO site_categories (site_id, category_id) VALUES (?, ?)").run(siteId, category);
  const tag = db.prepare("INSERT INTO tags (site_id, slug, name) VALUES (?, 'local', 'Local')").run(siteId).lastInsertRowid;
  const article = db.prepare(`INSERT INTO articles (site_id, category_id, slug, title, content_json, status, published_at)
    VALUES (?, ?, ?, ?, '{"blocks":[]}', 'published', ?)`);
  for (const [slug, title, published] of [["story", "Garden story", 200], ["earlier", "Earlier story", 100]] as const) {
    const id = article.run(siteId, category, slug, title, published).lastInsertRowid;
    db.prepare("INSERT INTO article_tags (article_id, tag_id) VALUES (?, ?)").run(id, tag);
  }
  db.prepare(`INSERT INTO pages (site_id, slug, title, content_json, status)
    VALUES (?, 'contact', 'Contact the newsroom', '{"blocks":[]}', 'published')`).run(siteId);
  const redirect = db.prepare(`INSERT INTO redirects (site_id, source_path, destination_path, status_code)
    VALUES (?, ?, '/page/contact', ?)`);
  redirect.run(siteId, "/former", 301);
  redirect.run(siteId, "/temporary", 302);

  const listicle = db.prepare(`INSERT INTO listicle_articles (site_id, public_id, slug, article_name, status)
    VALUES (?, 'art_guide', 'guide', 'Garden guide', 'published')`).run(siteId).lastInsertRowid;
  const version = db.prepare(`INSERT INTO listicle_article_versions (article_id, public_id, headline, intro_paragraph)
    VALUES (?, 'ver_guide', 'Garden guide', 'Three ideas')`).run(listicle).lastInsertRowid;
  const page = db.prepare(`INSERT INTO listicle_pages (public_id, article_version_id, page_index)
    VALUES ('pg_guide', ?, 0)`).run(version).lastInsertRowid;
  const section = db.prepare(`INSERT INTO listicle_sections (public_id, section_name, headline_text, content_json)
    VALUES ('sec_guide', 'Garden ideas', 'Plant herbs', '{"blocks":[]}')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO listicle_page_section_candidates (public_id, page_id, section_id)
    VALUES ('cand_guide', ?, ?)`).run(page, section);

  const question = db.prepare(`INSERT INTO leadgen_sections
    (public_id, section_name, activity, vertical, headline_text, content_json)
    VALUES (?, 'ZIP', 'quote_funnel', 'life', 'Your ZIP code', ?)`).run(leadgenId("lgs", 1),
    JSON.stringify({ components: [{ type: "ZIPInputQuestion", question_id: "q_zip", question_key: "zip",
      internal_field: "zip", props: { validate: true } }] })).lastInsertRowid;
  for (const [n, slug] of [[1, null], [2, "renewal"]] as const) {
    const quote = db.prepare(`INSERT INTO leadgen_quotes (public_id, quote_name, activity, verticals_json, status)
      VALUES (?, ?, 'quote_funnel', '["life"]', 'active')`).run(leadgenId("lgq", n), slug ?? "Default").lastInsertRowid;
    db.prepare("INSERT INTO leadgen_site_quotes (site_id, quote_id, enabled, slug) VALUES (?, ?, 1, ?)")
      .run(siteId, quote, slug);
    const funnel = db.prepare(`INSERT INTO leadgen_funnels (public_id, quote_id, funnel_name, status)
      VALUES (?, ?, 'Life', 'active')`).run(leadgenId("lgf", n), quote).lastInsertRowid;
    const variant = db.prepare(`INSERT INTO leadgen_funnel_variants (public_id, funnel_id, variant_label, traffic_allocation_bp)
      VALUES (?, ?, 'A', 10000)`).run(leadgenId("lgn", n), funnel).lastInsertRowid;
    db.prepare("INSERT INTO leadgen_funnel_variant_sections (variant_id, section_id, position) VALUES (?, ?, 0)")
      .run(variant, question);
  }
}

interface PageExample {
  route: string;
  path?: string;
  variants?: string[];
  status?: number;
  contains?: string;
  location?: string;
}

const examples: PageExample[] = [
  { route: "/", variants: ["human", "bot"], contains: "Sweep News" },
  { route: "/feed.xml", contains: "<rss" },
  { route: "/rss", contains: "<rss" },
  { route: "/atom.xml", contains: "<feed" },
  { route: "/sitemap.xml", contains: "<urlset" },
  { route: "/robots.txt", contains: "User-agent:" },
  { route: "/ads.txt", contains: "ads.example, sweep, DIRECT" },
  { route: "/llms.txt", contains: "Sweep News" },
  { route: "/site-icon.svg", contains: "<svg" },
  { route: "/favicon.ico", contains: "<svg" },
  { route: "/article/:slug", path: "/article/story", variants: ["human", "bot", "md"], contains: "Garden story" },
  { route: "/category/:slug", path: "/category/garden", variants: ["human", "bot"], contains: "Garden" },
  { route: "/category/:slug/page/:page", path: "/category/garden/page/2", variants: ["human", "bot"], contains: "Earlier story" },
  { route: "/category/:slug/page/:page", path: "/category/garden/page/1", status: 301, location: "/category/garden" },
  { route: "/tag/:slug", path: "/tag/local", contains: "Local" },
  { route: "/tag/:slug/page/:page", path: "/tag/local/page/2", contains: "Earlier story" },
  { route: "/tag/:slug/page/:page", path: "/tag/local/page/1", status: 301, location: "/tag/local" },
  { route: "/page/:slug", path: "/page/contact", contains: "Contact the newsroom" },
  { route: "/:slug", path: "/contact", contains: "Contact the newsroom" },
  { route: "/:slug", path: "/story", status: 301, location: "/article/story" },
  { route: "/:slug", path: "/former", status: 301, location: "/page/contact" },
  { route: "/:slug", path: "/temporary", status: 302, location: "/page/contact" },
  { route: "/:slug", path: "/guide", variants: ["lst:ver_guide"], contains: 'data-lander-v="ver_guide"' },
  { route: "/lg", variants: ["lg:" + leadgenId("lgn", 1)], contains: "<!--LG_ASSIGN-->" },
  { route: "/lg/:quote_slug", path: "/lg/renewal", variants: ["lg:" + leadgenId("lgn", 2)], contains: "<!--LG_ASSIGN-->" },
  { route: "/:slug", path: "/missing", status: 404 },
  { route: "/article/:slug", path: "/article/missing", status: 404, variants: ["human", "bot", "md"] },
  { route: "/page/:slug", path: "/page/missing", status: 404 },
  { route: "/category/:slug", path: "/category/missing", status: 404 },
  { route: "/tag/:slug", path: "/tag/missing", status: 404 },
];

const cases = examples.flatMap(({ route, path = route, variants = ["human"], status = 200, contains, location }) =>
  variants.map(variant => ({ path, variant, status, contains, location })));

function renderEnv(db: SqliteDb): Env {
  const bindings = sqliteEnv(db);
  bindings.DB.batch = <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(s => s.all<T>()));
  const entries = new Map<string, { value: string; metadata: unknown }>();
  Object.assign(bindings.CACHE, {
    async get(key: string) { return entries.get(key)?.value ?? null; },
    async getWithMetadata(key: string) { return entries.get(key) ?? { value: null, metadata: null }; },
    async put(key: string, value: string, options?: KVNamespacePutOptions) {
      entries.set(key, { value, metadata: options?.metadata ?? null });
    },
  });
  return bindings;
}

// Record the responses handed to the entrypoint cache, before gateway injection or fallback.
async function visit(request: Request, bindings: Env) {
  const { ctx, promises } = ctxCapture();
  const calls: { props: PublicPageProps; request: Request; response: Response }[] = [];
  const exports = {
    PublicPage({ props }: { props: PublicPageProps }) {
      const page = new PublicPage({ ...ctx, props }, bindings);
      return {
        async fetch(inner: Request) {
          const response = await page.fetch(inner);
          calls.push({ props, request: inner, response: response.clone() });
          return response;
        },
      };
    },
  };
  Object.assign(ctx, { exports });
  const outer = await worker.fetch(request, bindings, ctx);
  await outer.arrayBuffer();
  await Promise.all(promises);
  return { calls, outer };
}

async function checkShell(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(response.headers.get("Cache-Control")).toBe(cachePolicy[status]);
  const body = await response.text();
  expect(body).not.toContain(returningSid);
  expect(body).not.toContain("landing-query-canary");
  expect(body).not.toMatch(uuid);
  expect(body).not.toMatch(fallbackSid);
  return body;
}

describe("tenant routes forwarded to PublicPage", () => {
  let db: SqliteDb;
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T12:00:00Z"));
    db = createDb();
    seedTenant(db);
  });
  afterAll(() => {
    vi.useRealTimers();
    db?.close();
  });

  it("has a seeded example for every registered GET class admitted by the gateway", async () => {
    const bindings = sqliteEnv(db);
    const { ctx } = ctxCapture();
    // Probe admission only. Uncached Hono handlers (e.g. click tracking) must never run here.
    const snapshot = vi.fn(() => ({ fetch: async () => new Response(null, { status: 404 }) }));
    Object.assign(ctx, { exports: { PublicPage: snapshot } });
    const routes = new Set(worker.routes.filter(route => route.method === "GET").map(route => route.path));
    const admitted = new Set<string>();
    for (const pattern of routes) {
      snapshot.mockClear();
      const path = pattern.replace(/:[^/]+/g, "2"); // Valid as a slug, quote name or page number.
      await gatewayFetch(new Request(origin + path), bindings, ctx, () => new Response(null));
      if (pattern === "/lg/attempt") {
        expect(snapshot).toHaveBeenCalledExactlyOnceWith({ props: { siteKey: "host:" + host, variantKey: "snap" } });
      } else if (snapshot.mock.calls.length) {
        admitted.add(pattern);
      }
    }
    expect([...admitted].sort()).toEqual([...new Set(examples.map(example => example.route))].sort());
  });

  it.each(cases)("$path [$variant] returns a visitor-independent $status shell", async testCase => {
    const { path, variant, status, contains, location } = testCase;
    const returningEnv = renderEnv(db);
    const sessionCookie = "ko_sid=" + returningSid;
    const visits = [
      [renderEnv(db), "GET", ""],
      [returningEnv, "GET", sessionCookie],
      [returningEnv, "HEAD", sessionCookie],
    ] as const;
    let firstBody: string | undefined;
    for (const [bindings, method, cookie] of visits) {
      const headers = new Headers({
        Accept: variant === "md" ? "text/markdown" : "text/html",
        "User-Agent": cookie ? "returning-agent-canary" : "first-agent-canary",
        "Accept-Language": cookie ? "es" : "en",
      });
      if (cookie) headers.set("Cookie", cookie);
      const request = new Request(origin + path + "?utm_source=landing-query-canary", { method, headers });
      if (variant === "bot") Object.assign(request, { cf: { botManagement: { score: 5 } } });
      const { calls, outer } = await visit(request, bindings);
      expect(calls.map(call => call.props)).toEqual([
        { siteKey: "host:" + host, variantKey: "snap" }, { siteKey: siteId, variantKey: variant },
      ]);
      const [snapshot, page] = calls;
      await checkShell(snapshot!.response, 200);
      expect(page!.request.url).toBe(origin + path);
      expect(page!.request.headers.has("Cookie")).toBe(false);
      const body = await checkShell(page!.response, status);
      if (firstBody === undefined) firstBody = body;
      else expect(body, "same public variant across visitors and cache fills").toBe(firstBody);
      if (contains) expect(body).toContain(contains);
      if (location) expect(page!.response.headers.get("Location")).toBe(location);
      if (variant === "md" && status === 200) expect(page!.response.headers.get("Content-Type")).toContain("text/markdown");
      if (variant.startsWith("lst:")) expect(body).not.toContain('<script data-lst="ctx">');
      if (variant.startsWith("lg:")) expect(body).not.toContain("window.__LG_ASSIGNMENT__=");
      expect(outer.headers.has("x-edge-cache"), "gateway must serve the checked shell").toBe(true);
    }
  });
});

describe("public change manifest", () => {
  it("matches every non-GET method/path on the mounted app and its scheduled and queue exports", () => {
    const keys = new Set(worker.routes.filter(route => route.method !== "GET").map(route => route.method + " " + route.path));
    for (const hook of ["scheduled", "queue"] as const) {
      if (typeof worker[hook] === "function") keys.add(hook.toUpperCase() + " worker." + hook);
    }
    expect(Object.keys(manifest).sort()).toEqual([...keys].sort());
  });

  it("requires a purge proof file or a source-backed reason for each entry", () => {
    const files = new Set(readdirSync(new URL(".", import.meta.url), { withFileTypes: true })
      .filter(file => file.isFile() && file.name.endsWith(".test.ts")).map(file => file.name));
    for (const [route, entry] of Object.entries(manifest)) {
      if ("proof" in entry) {
        expect(entry, route).toEqual({ effect: "purges", proof: expect.any(String) });
        expect(files.has(entry.proof), route + " cites missing proof " + entry.proof).toBe(true);
      } else {
        expect(entry, route).toEqual({ effect: "none", reason: expect.stringMatching(/^[^\r\n]+$/) });
        const citations = [...entry.reason.matchAll(/\b((?:src|test)\/[\w./-]+):([1-9]\d*)/g)];
        expect(citations.length, route + " requires file:line evidence").toBeGreaterThan(0);
        for (const [, file, line] of citations) {
          const source = readFileSync(new URL("../" + file, import.meta.url), "utf8").split("\n");
          expect(source[Number(line) - 1]?.trim(), route + " cites " + file + ":" + line).toBeTruthy();
        }
      }
    }
  });

  it("resuming a job at launch queues both purges for its tenant and hostname", async () => {
    const db = createDb();
    try {
      addSite(db, siteId, "Sweep News", "home");
      db.prepare("UPDATE sites SET status = 'provisioning' WHERE id = ?").run(siteId);
      db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(siteId, host);
      db.prepare(`INSERT INTO site_creation_jobs (id, site_id, status, current_step_index, total_steps)
        VALUES ('resume-job', ?, 'failed', ?, ?)`).run(siteId, STEP_KEYS.indexOf("update_launch_readiness"), STEP_KEYS.length);
      const response = await honoFetch(new Request("https://localhost/api/admin/sites/" + siteId + "/provision/resume",
        { method: "POST" }), sqliteEnv(db));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ completed: true, site_status: "active" });
      const rows = db.prepare("SELECT action, status, payload FROM cache_purge_log WHERE site_id = ? ORDER BY action")
        .all(siteId) as { action: string; status: string; payload: string }[];
      expect(rows.map(row => [row.action, row.status])).toEqual([["purge_tags", "pending"], ["purge_tags_second", "pending"]]);
      for (const { payload } of rows) {
        expect(JSON.parse(payload).tags.sort()).toEqual(["host:" + host, "nf:" + siteId, "site:" + siteId, "snap:" + siteId]);
      }
    } finally {
      db.close();
    }
  });
});
