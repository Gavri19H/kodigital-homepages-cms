// §15.4/§31.3 post-cache context injection — the cached shell stays
// BYTE-IDENTICAL in KV (geo/device/session never in the cache key or the
// cached bytes); the live response carries the injected per-request script
// (_LST_SID / __LST_CTX / __LST_EXP) immediately before the §15.3 selector;
// sid is REUSED from the ko_sid cookie or minted (and echoed via
// Set-Cookie); ko_ctx captures the landing params.

import { describe, expect, it, beforeEach } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";
import {
  buildContextScript,
  injectListicleContext,
} from "../src/public/listicle/ctx-inject";
import { SELECTOR_SCRIPT_MARKER } from "../src/public/listicle/runtime";

const TENANT_HOST = "tenant.example.com";
const SITE_ID = "site_P7";

// --- fixture (single published listicle, one version, running experiment) -----

function makeDb(): { db: D1Database } {
  const article = {
    id: 11,
    public_id: "art_P7",
    site_id: SITE_ID,
    slug: "p7-fixture",
    article_name: "P7 Fixture Article",
    status: "published",
    active_experiment_id: 21,
  };
  const versions = [
    {
      id: 31,
      public_id: "ver_P7A",
      article_id: 11,
      experiment_id: 21,
      variant_label: "A",
      is_control: 1,
      traffic_allocation: 100,
      headline: "Line one\nLine two",
      intro_paragraph: "Neutral intro.",
      hero_media_id: null,
      hero_media_url: null,
      layout_style_id: "default",
      byline_json: null,
      content_version: 2,
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
  ];
  const candidates = [
    {
      id: 51,
      public_id: "cand_P7",
      page_id: 41,
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
    headline_text: "Neutral heading",
    headline_offer_id: null,
    image_json: null,
    content_json: JSON.stringify({ blocks: [{ type: "paragraph", data: { text: "Body." } }] }),
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
            return (captured[1] === article.slug ? article : null) as unknown as T | null;
          }
          if (sql.includes("FROM listicle_article_experiments")) {
            return { id: 21, public_id: "exp_P7", status: "running" } as unknown as T;
          }
          if (sql.includes("FROM redirects")) return null;
          return null;
        },
        async all<T = unknown>() {
          if (sql.includes("FROM listicle_article_versions")) {
            return { results: versions as unknown as T[], success: true, meta: {} };
          }
          if (sql.includes("FROM listicle_pages WHERE article_version_id IN")) {
            return { results: pages as unknown as T[], success: true, meta: {} };
          }
          if (sql.includes("FROM listicle_page_section_candidates c")) {
            return { results: candidates as unknown as T[], success: true, meta: {} };
          }
          if (sql.includes("FROM listicle_page_rules WHERE page_id IN")) {
            return { results: [] as T[], success: true, meta: {} };
          }
          if (sql.includes("FROM listicle_sections WHERE id IN")) {
            return { results: [section] as unknown as T[], success: true, meta: {} };
          }
          if (sql.includes("key IN ('site_timezone', 'site_language')")) {
            return {
              results: [{ key: "site_timezone", value: "UTC" }] as unknown as T[],
              success: true,
              meta: {},
            };
          }
          if (sql.includes("FROM site_settings")) {
            return {
              results: [{ key: "site_name", value: "P7 Tenant" }] as unknown as T[],
              success: true,
              meta: {},
            };
          }
          return { results: [] as T[], success: true, meta: {} };
        },
        async run() {
          return { success: true, meta: {} };
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db };
}

function makeKv(): { kv: KVNamespace; store: Map<string, { value: string }> } {
  const store = new Map<string, { value: string }>();
  const kv = {
    async get(key: string) {
      return store.get(key)?.value ?? null;
    },
    async getWithMetadata(key: string) {
      const entry = store.get(key);
      return { value: entry?.value ?? null, metadata: null, cacheStatus: null };
    },
    async put(key: string, value: string) {
      store.set(key, { value });
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

function setCookies(res: Response): string[] {
  return (res.headers as unknown as { getSetCookie(): string[] }).getSetCookie();
}

let env: Env;
let kvStore: Map<string, { value: string }>;

beforeEach(() => {
  const { db } = makeDb();
  const { kv, store } = makeKv();
  env = makeEnv(db, kv);
  kvStore = store;
});

describe("buildContextScript (unit)", () => {
  it("emits sid + ctx + exp with </script>-safe escaping", () => {
    const script = buildContextScript({
      sid: 'abc"</script><script>alert(1)</script>',
      ctx: { country: "US", hour: 13 },
      exp: { experiment_id: "exp_1", variant_id: "ver_1", variant_label: "A", split: 50 },
    });
    expect(script.startsWith('<script data-lst="ctx">')).toBe(true);
    expect(script).toContain('window.__LST_CTX={"country":"US","hour":13};');
    expect(script).toContain('window.__LST_EXP={"experiment_id":"exp_1"');
    // the raw close-tag can never appear inside the payload.
    expect(script.slice('<script data-lst="ctx">'.length, -"</script>".length)).not.toContain("</script>");
    expect(script).toContain("\\u003c/script"); // escaped form
  });

  it("injectListicleContext (node fallback) splices immediately before the selector marker", async () => {
    const html = `<!DOCTYPE html><html><head><style>x</style>${SELECTOR_SCRIPT_MARKER}var a=1;</script></head><body></body></html>`;
    const res = new Response(html, { status: 200, headers: { "X-Probe": "1" } });
    const injected = injectListicleContext(res, { sid: "s1", ctx: { hour: 2 }, exp: null });
    const body = await injected.text();
    const ctxIdx = body.indexOf('<script data-lst="ctx">');
    const selIdx = body.indexOf(SELECTOR_SCRIPT_MARKER);
    expect(ctxIdx).toBeGreaterThan(-1);
    expect(selIdx).toBeGreaterThan(ctxIdx); // ctx BEFORE selector
    expect(injected.headers.get("X-Probe")).toBe("1"); // headers preserved
  });

  it("marker-less (stale Phase-6) shells degrade to a </head> injection", async () => {
    const res = new Response("<html><head><style>x</style></head><body>B</body></html>");
    const body = await injectListicleContext(res, { sid: "s1", ctx: {}, exp: null }).text();
    expect(body.indexOf('<script data-lst="ctx">')).toBeLessThan(body.indexOf("</head>"));
  });
});

describe("serve path — KV pristine, response injected (§15.4)", () => {
  it("the KV shell is byte-identical PRE-injection (no sid/ctx inside); the response carries them", async () => {
    const res = await app().request(get("/p7-fixture", { Cookie: "ko_sid=probe-sid-1" }), undefined, env);
    expect(res.status).toBe(200);
    const body = await res.text();

    const shellKeys = [...kvStore.keys()].filter((k) => k.startsWith("html:"));
    expect(shellKeys.length).toBe(1);
    const cachedShell = kvStore.get(shellKeys[0]!)?.value ?? "";

    // cached shell: NO per-request context — no injected ctx tag, no
    // LITERAL sid/ctx assignments (the selector's `window._LST_SID=sid`
    // variable echo is visitor-invariant and stays).
    expect(cachedShell).not.toContain('<script data-lst="ctx">');
    expect(cachedShell).not.toContain('window._LST_SID="');
    expect(cachedShell).not.toContain("window.__LST_CTX={");
    expect(cachedShell).not.toContain("probe-sid-1");
    // …but it DOES carry the visitor-invariant boot + selector + beacon.
    expect(cachedShell).toContain('<script data-lst="boot">');
    expect(cachedShell).toContain(SELECTOR_SCRIPT_MARKER);
    expect(cachedShell).toContain('<script data-lst="beacon">');

    // live response = the SAME shell + the injected ctx script before the selector.
    expect(body).toContain('window._LST_SID="probe-sid-1"');
    expect(body).toContain("window.__LST_CTX=");
    expect(body).toContain("window.__LST_EXP=");
    expect(body).toContain('"experiment_id":"exp_P7"');
    expect(body.indexOf('<script data-lst="ctx">')).toBeLessThan(body.indexOf(SELECTOR_SCRIPT_MARKER));
    // removing the injected script yields the cached shell exactly.
    const ctxTagRe = /<script data-lst="ctx">[\s\S]*?<\/script>/;
    expect(body.replace(ctxTagRe, "")).toBe(cachedShell);
  });

  it("cache HIT keeps KV byte-identical while each request gets ITS OWN sid injected", async () => {
    const first = await app().request(get("/p7-fixture", { Cookie: "ko_sid=sid-A" }), undefined, env);
    await first.text();
    const shellKey = [...kvStore.keys()].find((k) => k.startsWith("html:"))!;
    const cachedBefore = kvStore.get(shellKey)?.value ?? "";

    const second = await app().request(get("/p7-fixture", { Cookie: "ko_sid=sid-B" }), undefined, env);
    const bodyB = await second.text();
    expect(bodyB).toContain('window._LST_SID="sid-B"');
    expect(bodyB).not.toContain("sid-A");
    expect(kvStore.get(shellKey)?.value).toBe(cachedBefore); // KV untouched
  });

  it("sid mint when absent: Set-Cookie ko_sid == the injected _LST_SID", async () => {
    const res = await app().request(get("/p7-fixture"), undefined, env);
    const cookies = setCookies(res);
    const koSid = cookies.find((c) => c.startsWith("ko_sid="));
    expect(koSid).toBeTruthy();
    const sid = koSid!.split(";")[0]!.slice("ko_sid=".length);
    expect(decodeURIComponent(sid)).not.toBe("");
    expect(await res.text()).toContain(`window._LST_SID="${decodeURIComponent(sid)}"`);
  });

  it("sid reuse: an existing ko_sid is injected VERBATIM and never re-set", async () => {
    const res = await app().request(get("/p7-fixture", { Cookie: "ko_sid=keep-me" }), undefined, env);
    expect(setCookies(res).some((c) => c.startsWith("ko_sid="))).toBe(false);
    expect(await res.text()).toContain('window._LST_SID="keep-me"');
  });

  it("ko_ctx cookie captures landing params (utm_source/fbclid → fbc) on the render response", async () => {
    const res = await app().request(
      get("/p7-fixture?utm_source=nbk&fbclid=F9", { Cookie: "ko_sid=s" }),
      undefined,
      env,
    );
    const koCtx = setCookies(res).find((c) => c.startsWith("ko_ctx="));
    expect(koCtx).toBeTruthy();
    const value = decodeURIComponent(koCtx!.split(";")[0]!.slice("ko_ctx=".length));
    const parsed = JSON.parse(value) as Record<string, string>;
    expect(parsed.utm_source).toBe("nbk");
    expect(parsed.traffic_source).toBe("nbk"); // fallback
    expect(parsed.fbclid).toBe("F9");
    expect(parsed.fbc).toMatch(/^fb\.1\.\d+\.F9$/);
    expect(parsed.lander_v).toBe("ver_P7A");
    expect(koCtx).toContain("Max-Age=2592000"); // 30 days
    // …and the injected __LST_CTX carries the acquisition dims for rules.
    const body = await res.text();
    expect(body).toMatch(/window\.__LST_CTX=\{[^}]*"utm_source":"nbk"/);
    expect(body).toMatch(/window\.__LST_CTX=\{[^}]*"hour":\d+/);
  });
});
