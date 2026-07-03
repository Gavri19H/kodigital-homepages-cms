// Listicles Phase 6 — public routing through the SHARED /:slug catch-all
// (§7.2): published-200 with the §22 header/ETag discipline + ko_sid/ko_ver
// cookies, draft fallthrough-404, listicle-over-page precedence, homepage
// untouched, edge-cache HIT on the second request, 304 conditional GET,
// sticky Version across calls, and the /lst-cand candidate endpoint.

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";
import { htmlKey, listicleKey } from "../src/cache/cache-keys";

const TENANT_HOST = "tenant.example.com";
const SITE_ID = "site_L6";
const PUBLIC_HTML_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";

// ---------------------------------------------------------------------------
// Fixture graph: one published listicle (2 versions under a RUNNING
// experiment), one draft listicle, one published page sharing a slug with
// the published listicle.
// ---------------------------------------------------------------------------

interface FixtureOptions {
  articleStatus?: string;
  experimentRunning?: boolean;
}

function makeDb(opts: FixtureOptions = {}): { db: D1Database; log: string[] } {
  const log: string[] = [];
  const articleStatus = opts.articleStatus ?? "published";
  const experimentRunning = opts.experimentRunning ?? true;

  const article = {
    id: 11,
    public_id: "art_L6",
    site_id: SITE_ID,
    slug: "lst-fixture",
    status: articleStatus,
    active_experiment_id: 21,
  };
  const versions = [
    {
      id: 31,
      public_id: "ver_A",
      article_id: 11,
      experiment_id: 21,
      variant_label: "A",
      is_control: 1,
      traffic_allocation: 50,
      headline: "Fixture line one\nFixture line two",
      intro_paragraph: "Neutral intro copy.",
      hero_media_id: null,
      hero_media_url: "/media/hero.png",
      layout_style_id: "default",
      byline_json: null,
      content_version: 3,
      status: "active",
    },
    {
      id: 32,
      public_id: "ver_B",
      article_id: 11,
      experiment_id: 21,
      variant_label: "B",
      is_control: 0,
      traffic_allocation: 50,
      headline: "Variant headline",
      intro_paragraph: "Variant intro.",
      hero_media_id: null,
      hero_media_url: null,
      layout_style_id: "default",
      byline_json: null,
      content_version: 5,
      status: "active",
    },
  ];
  const pages = [
    {
      id: 41,
      public_id: "pg_1",
      article_version_id: 31,
      page_index: 0,
      selection_mode: "single",
      ab_test_id: null,
      rule_set_id: null,
    },
    {
      id: 42,
      public_id: "pg_2",
      article_version_id: 32,
      page_index: 0,
      selection_mode: "single",
      ab_test_id: null,
      rule_set_id: null,
    },
  ];
  const candidates = [
    {
      id: 51,
      public_id: "cand_A1",
      page_id: 41,
      section_id: 61,
      label: "A",
      traffic_allocation: null,
      is_fallback: 0,
      section_public_id: "sec_61",
      section_name: "S61",
    },
    {
      id: 52,
      public_id: "cand_B1",
      page_id: 42,
      section_id: 61,
      label: "A",
      traffic_allocation: null,
      is_fallback: 0,
      section_public_id: "sec_61",
      section_name: "S61",
    },
  ];
  const section = {
    id: 61,
    public_id: "sec_61",
    section_name: "S61",
    headline_text: "Neutral section heading",
    headline_offer_id: null,
    image_json: null,
    content_json: JSON.stringify({
      blocks: [
        { type: "paragraph", data: { text: "Neutral body." } },
        {
          type: "choice_button_group",
          data: {
            layout_binding: "default.choiceButtonGroup",
            items: [{ text: "Go", offer_id: "off_1", link_instance_id: "lnk_1" }],
          },
        },
      ],
    }),
  };
  // A published PAGE that shares the listicle's slug (precedence probe).
  const pageRow = {
    id: 71,
    slug: "lst-fixture",
    title: "Shadowed page",
    content_html: "<p>page body</p>",
    status: "published",
    updated_at: 1_700_000_500,
    site_id: SITE_ID,
  };

  const db = {
    prepare(sql: string) {
      let captured: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          captured = args;
          return stmt;
        },
        async first<T = unknown>(): Promise<T | null> {
          log.push(sql);
          if (sql.startsWith("SELECT s.id AS site_id")) {
            const host = String(captured[0] ?? "").toLowerCase();
            if (host !== TENANT_HOST) return null;
            return {
              site_id: SITE_ID,
              hostname: TENANT_HOST,
              vertical_slug: "home",
              status: "active",
              content_version: 7,
              settings_version: 1,
            } as unknown as T;
          }
          if (sql.includes("FROM listicle_articles WHERE site_id = ? AND slug = ?")) {
            const slug = captured[1] as string;
            return (slug === article.slug ? article : null) as unknown as T | null;
          }
          if (sql.includes("FROM listicle_article_experiments")) {
            const id = captured[0] as number;
            if (id === 21 && experimentRunning) {
              return { id: 21, public_id: "exp_L6", status: "running" } as unknown as T;
            }
            return null;
          }
          if (sql.includes("FROM pages ")) {
            const slug = captured[0] as string;
            return (slug === pageRow.slug ? pageRow : null) as unknown as T | null;
          }
          if (sql.includes("FROM redirects")) return null;
          if (sql.startsWith("SELECT * FROM articles WHERE slug = ? AND site_id = ?")) return null;
          if (sql.includes("FROM listicle_page_rules WHERE candidate_id = ?")) return null;
          if (sql.includes("FROM listicle_page_section_candidates cand")) {
            const cid = captured[0] as string;
            const cand = candidates.find((x) => x.public_id === cid);
            if (cand === undefined) return null;
            const page = pages.find((p) => p.id === cand.page_id)!;
            const ver = versions.find((v) => v.id === page.article_version_id)!;
            return {
              candidate_id: cand.id,
              candidate_public_id: cand.public_id,
              section_id: cand.section_id,
              is_fallback: cand.is_fallback,
              page_index: page.page_index,
              selection_mode: page.selection_mode,
              lander_v: ver.public_id,
              version_content_version: ver.content_version,
              version_status: ver.status,
              article_public_id: article.public_id,
              article_status: article.status,
              site_id: article.site_id,
            } as unknown as T;
          }
          return null;
        },
        async all<T = unknown>() {
          log.push(sql);
          if (sql.includes("FROM listicle_article_versions")) {
            return { results: versions as unknown as T[], success: true, meta: {} };
          }
          if (sql.includes("FROM listicle_pages WHERE article_version_id IN")) {
            const wanted = captured as number[];
            return {
              results: pages.filter((p) => wanted.includes(p.article_version_id)) as unknown as T[],
              success: true,
              meta: {},
            };
          }
          if (sql.includes("FROM listicle_page_section_candidates c")) {
            const wanted = captured as number[];
            return {
              results: candidates.filter((c) => wanted.includes(c.page_id)) as unknown as T[],
              success: true,
              meta: {},
            };
          }
          if (sql.includes("FROM listicle_page_rules WHERE page_id IN")) {
            return { results: [] as T[], success: true, meta: {} };
          }
          if (sql.includes("FROM listicle_sections WHERE id IN")) {
            return { results: [section] as unknown as T[], success: true, meta: {} };
          }
          if (sql.includes("FROM listicle_offers WHERE public_id IN")) {
            return {
              results: [{ public_id: "off_1" }] as unknown as T[],
              success: true,
              meta: {},
            };
          }
          if (sql.includes("FROM site_settings")) {
            return {
              results: [{ key: "site_name", value: "L6 Tenant" }] as unknown as T[],
              success: true,
              meta: {},
            };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          log.push(sql);
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, log };
}

// Stateful fake KV: real get/put semantics so the edge-cache write-through +
// second-request HIT is observable.
function makeKv(): { kv: KVNamespace; store: Map<string, { value: string; metadata?: unknown }> } {
  const store = new Map<string, { value: string; metadata?: unknown }>();
  const kv = {
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async getWithMetadata(key: string) {
      const entry = store.get(key);
      return { value: entry?.value ?? null, metadata: entry?.metadata ?? null, cacheStatus: null };
    },
    async put(key: string, value: string, options?: { metadata?: unknown }) {
      store.set(key, { value, metadata: options?.metadata });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [...store.keys()].map((name) => ({ name })), list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
  return { kv, store };
}

function makeEnv(db: D1Database, kv: KVNamespace): Env {
  return {
    DB: db,
    CACHE: kv,
    ADMIN_HOST: "cms.kodigital.app",
    ADMIN_BASE_URL: "https://cms.kodigital.app",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "300",
  } as unknown as Env;
}

function app(): Hono<{ Bindings: Env; Variables: PublicSiteVariables }> {
  const a = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  a.route("/", publicRouter);
  return a;
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://${TENANT_HOST}${path}`, { headers });
}

// Headers.getSetCookie() exists at runtime (undici) but not in the lib DOM
// typings this repo pins — a typed accessor keeps strict mode clean.
function setCookies(res: Response): string[] {
  return (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
}

let env: Env;
let log: string[];
let kvStore: Map<string, { value: string; metadata?: unknown }>;

function freshEnv(opts: FixtureOptions = {}): void {
  const { db, log: dbLog } = makeDb(opts);
  const { kv, store } = makeKv();
  env = makeEnv(db, kv);
  log = dbLog;
  kvStore = store;
}

beforeEach(() => freshEnv());

describe("§7.2 published listicle render at /:slug", () => {
  it("200 + §22 headers (Cache-Control/ETag/nosniff) + ko_sid/ko_ver cookies + shell body", async () => {
    const res = await app().request(get("/lst-fixture"), undefined, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_HTML_CACHE_CONTROL);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{16}"$/);
    const cookies = setCookies(res);
    expect(cookies.some((c: string) => c.startsWith("ko_sid="))).toBe(true);
    expect(cookies.some((c: string) => c.startsWith("ko_ver=ver_"))).toBe(true);
    const body = await res.text();
    expect(body).toContain('data-layout="default"');
    expect(body).toMatch(/data-lander-v="ver_[AB]"/);
    expect(body).toContain("lst-header");
  });

  it("an existing ko_sid is NOT re-set; ko_ver is always echoed", async () => {
    const res = await app().request(
      get("/lst-fixture", { Cookie: "ko_sid=fixed-sid-1" }),
      undefined,
      env,
    );
    const cookies = setCookies(res);
    expect(cookies.some((c: string) => c.startsWith("ko_sid="))).toBe(false);
    expect(cookies.some((c: string) => c.startsWith("ko_ver="))).toBe(true);
  });

  it("§15.2 sticky: the same sid gets the SAME Version on every request; sids spread across arms", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const sid = `sid-${i}`;
      freshEnv();
      const first = await app().request(
        get("/lst-fixture", { Cookie: `ko_sid=${sid}` }),
        undefined,
        env,
      );
      const firstVer = (await first.text()).match(/data-lander-v="(ver_[AB])"/)?.[1] ?? "";
      seen.add(firstVer);
      const again = await app().request(
        get("/lst-fixture", { Cookie: `ko_sid=${sid}` }),
        undefined,
        env,
      );
      const againVer = (await again.text()).match(/data-lander-v="(ver_[AB])"/)?.[1] ?? "";
      expect(againVer).toBe(firstVer);
    }
    expect(seen).toEqual(new Set(["ver_A", "ver_B"])); // 50/50 over 40 sids
  });

  it("no running experiment ⇒ the control Version serves", async () => {
    freshEnv({ experimentRunning: false });
    const res = await app().request(get("/lst-fixture"), undefined, env);
    expect(await res.text()).toContain('data-lander-v="ver_A"');
  });

  it("each Version is its OWN cached shell under its lander_v (§22 key)", async () => {
    // Force both arms via many sids, then assert the two distinct keys exist
    // (the KV also carries cachestat: counters — count html: shells only).
    const shellKeys = () => [...kvStore.keys()].filter((k) => k.startsWith("html:")).length;
    for (let i = 0; i < 40 && shellKeys() < 2; i++) {
      await app().request(get("/lst-fixture", { Cookie: `ko_sid=sid-${i}` }), undefined, env);
    }
    expect(kvStore.has(listicleKey(SITE_ID, "lst-fixture", "ver_A", 3))).toBe(true);
    expect(kvStore.has(listicleKey(SITE_ID, "lst-fixture", "ver_B", 5))).toBe(true);
  });

  it("edge-cache HIT: the second request serves from KV without re-rendering", async () => {
    const sid = { Cookie: "ko_sid=hit-probe" };
    await app().request(get("/lst-fixture", sid), undefined, env);
    const rendersAfterFirst = log.filter((s) => s.includes("FROM listicle_sections WHERE id IN")).length;
    expect(rendersAfterFirst).toBe(1);
    const second = await app().request(get("/lst-fixture", sid), undefined, env);
    expect(second.status).toBe(200);
    const rendersAfterSecond = log.filter((s) => s.includes("FROM listicle_sections WHERE id IN")).length;
    expect(rendersAfterSecond).toBe(1); // no second render — KV hit
  });

  it("304 Not Modified on If-None-Match (ETag echoed, cookies still ride)", async () => {
    const sid = { Cookie: "ko_sid=etag-probe" };
    const first = await app().request(get("/lst-fixture", sid), undefined, env);
    const etag = first.headers.get("ETag") ?? "";
    const second = await app().request(
      get("/lst-fixture", { ...sid, "If-None-Match": etag }),
      undefined,
      env,
    );
    expect(second.status).toBe(304);
    expect(second.headers.get("ETag")).toBe(etag);
    expect(await second.text()).toBe("");
  });
});

describe("draft/scheduled/archived → the router's NORMAL fallthrough (§7.2)", () => {
  for (const status of ["draft", "scheduled", "archived"]) {
    it(`${status} listicle does not serve; the same-slug published PAGE serves instead`, async () => {
      freshEnv({ articleStatus: status });
      const res = await app().request(get("/lst-fixture"), undefined, env);
      // fallthrough hits servePage → the published page at this slug.
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).not.toContain("data-lander-v");
      expect(body).toContain("Shadowed page");
    });
  }

  it("an unknown slug still renders the styled 404 (behavior untouched)", async () => {
    const res = await app().request(get("/totally-unknown"), undefined, env);
    expect(res.status).toBe(404);
  });
});

describe("precedence — listicle vs page vs homepage", () => {
  it("a PUBLISHED listicle wins over a published page at the same slug", async () => {
    const res = await app().request(get("/lst-fixture"), undefined, env);
    const body = await res.text();
    expect(body).toContain("data-lander-v");
    expect(body).not.toContain("Shadowed page");
  });

  it("the homepage route never enters the listicle branch (listicle-slug-vs-homepage precedence)", async () => {
    // Plant the homepage cache entry so GET / serves without the home
    // view-model surface; then assert the listicle tables were never queried.
    kvStore.set(htmlKey(SITE_ID, "/", 7), {
      value: "<!DOCTYPE html><html><body>HOME</body></html>",
      metadata: { etag: '"homepage"' },
    });
    const res = await app().request(get("/"), undefined, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("HOME");
    expect(log.some((sql) => sql.includes("listicle_articles"))).toBe(false);
  });
});

describe("§22.4 GET /lst-cand/:candidate_public_id", () => {
  it("serves the cached candidate fragment with governed context", async () => {
    const res = await app().request(get("/lst-cand/cand_A1"), undefined, env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_HTML_CACHE_CONTROL);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = await res.text();
    expect(body).toContain('class="lst-section"');
    expect(body).toContain('href="/lc/off_1?a=art_L6&amp;lv=ver_A');
    expect(body).toContain("c=cand_A1");
  });

  it("second request is a KV hit (no re-render)", async () => {
    await app().request(get("/lst-cand/cand_A1"), undefined, env);
    const after1 = log.filter((s) => s.includes("FROM listicle_sections WHERE id IN")).length;
    await app().request(get("/lst-cand/cand_A1"), undefined, env);
    const after2 = log.filter((s) => s.includes("FROM listicle_sections WHERE id IN")).length;
    expect(after2).toBe(after1);
  });

  it("unknown candidate → 404; unpublished article → 404", async () => {
    const unknown = await app().request(get("/lst-cand/cand_ghost"), undefined, env);
    expect(unknown.status).toBe(404);
    freshEnv({ articleStatus: "draft" });
    const draft = await app().request(get("/lst-cand/cand_A1"), undefined, env);
    expect(draft.status).toBe(404);
  });
});
