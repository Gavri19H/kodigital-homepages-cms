import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { EdgeRequestSignals } from "../src/analytics/listicle-quality";
import { edgeBotVariant } from "../src/edge/bot";
import type { PublicPageProps } from "../src/edge/types";
import type { Env } from "../src/env";
import worker, { honoFetch, PublicPage } from "../src/index";
import { addSite, createDb, env as sqliteEnv, type SqliteDb } from "./helpers/x06-a2-sqlite";

// Supply the Workers context to the real PublicPage entrypoint in Node.
vi.mock("cloudflare:workers", () => ({
  WorkerEntrypoint: class {
    constructor(readonly ctx: ExecutionContext, readonly env: Env) {}
  },
}));

const siteId = "edge-news";
const host = siteId + ".example";
const residential = { asn: 7922 };
const datacenter = { asn: 16509 };
const googlebot = {
  ...datacenter, verifiedBot: true, verifiedBotCategory: "Search Engine Crawler", botManagement: { score: 1 },
};
const publisher = "ca-pub-1234567890123456";
const adLoader = "pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";

function visit(path: string, cf: EdgeRequestSignals | undefined, init: RequestInit = {}): Request {
  return Object.assign(new Request("https://" + host + path, init), { cf });
}

function clientHeaders(variant: string) {
  return { "X-CMS-Variant": variant, "x-cms-bookmark": "client-bookmark", "x-cms-tags": "site:client" };
}

describe("edgeBotVariant", () => {
  it.each([
    ["verified search crawler", "/", googlebot, "Googlebot/2.1", false],
    ["verified AI crawler", "/", { verifiedBot: true, verifiedBotCategory: "AI Crawler" }, "Mozilla/5.0", true],
    ["low bot score", "/article/story", { botManagement: { score: 29 } }, "Mozilla/5.0", true],
    ["datacenter ASN", "/category/wellness", datacenter, "Mozilla/5.0", true],
    ["declared HTTP client", "/category/wellness/page/2", {}, "curl/8.4.0", true],
    ["residential browser", "/article/story", residential, "Mozilla/5.0", false],
    ["absent Cloudflare metadata", "/", undefined, "curl/8.4.0", false],
  ] as const)("%s on %s", (_label, path, cf, ua, expected) => {
    expect(edgeBotVariant(visit(path, cf, { headers: { "User-Agent": ua } }), path)).toBe(expected);
  });

  it.each([
    "/lg", "/lg/quotes", "/lg/auction", "/lg/pb/provider", "/lc/offer", "/guide", "/page/info",
    "/tag/wellness", "/feed.xml", "/article/", "/article/story/extra", "/category/wellness/",
    "/category/wellness/page/two", "/category/wellness/page/2/extra",
  ])("keeps %s out of the bot variant", path => {
    expect(edgeBotVariant(visit(path, datacenter), path)).toBe(false);
  });
});

function pageContext<Props>(props: Props, exports: Cloudflare.Exports = {}): ExecutionContext<Props> {
  return {
    props, exports, waitUntil() {}, passThroughOnException() {},
    get tracing(): never { throw new Error("unexpected tracing access"); },
  };
}

function pageBinding(env: Env) {
  const bind = vi.fn(({ props }: { props: PublicPageProps }) => new PublicPage(pageContext(props), env));
  return { bind, ctx: pageContext({}, { PublicPage: bind }) };
}

async function readPage(response: Response, ads: boolean): Promise<string> {
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("text/html");
  const body = await response.text();
  expect(body).toContain("Edge News");
  expect(body.includes(adLoader)).toBe(ads);
  expect(body.includes('data-ad-client="' + publisher + '"')).toBe(ads);
  return body;
}

describe("bot and human pages on an ad-enabled tenant", () => {
  let db: SqliteDb;
  let env: Env;
  beforeAll(() => {
    db = createDb();
    addSite(db, siteId, "Edge News", "health");
    db.prepare("INSERT INTO domains (site_id, hostname, status) VALUES (?, ?, 'active')").run(siteId, host);
    db.prepare("INSERT INTO articles (site_id, slug, title, content_json, status) VALUES (?, ?, ?, ?, 'published')")
      .run(siteId, "story", "Test article", '{"blocks":[]}');
    const setting = db.prepare("INSERT INTO site_settings (site_id, key, value) VALUES (?, ?, ?)");
    setting.run(siteId, "site_name", "Edge News");
    setting.run(siteId, "ads_enabled", "1");
    setting.run(siteId, "ad_provider", "adsense");
    setting.run(siteId, "adsense_publisher_id", publisher);
    env = sqliteEnv(db);
    // Return each statement's rows inside the SQLite fixture's batch transaction.
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = <T>(statements: D1PreparedStatement[]) => {
      for (const statement of statements) statement.run = statement.all.bind(statement);
      return batch<T>(statements);
    };
    Object.assign(env.CACHE, { async getWithMetadata() { return { value: null, metadata: null }; } });
  });
  afterAll(() => db.close());

  it.each(["/", "/article/story", "/category/wellness", "/category/wellness/page/2"])(
    "honors the trusted variant on %s and uses Cloudflare signals when it is absent", async path => {
      const render = (cf: EdgeRequestSignals, variant?: string) => honoFetch(
        visit(path, cf, { headers: variant === undefined ? {} : { "x-cms-variant": variant } }), env,
      );
      const liveBot = await render(datacenter);
      expect(liveBot.headers.get("Cache-Control")).toBe("private, no-store");
      const botHtml = await readPage(liveBot, false);
      expect(await readPage(await render(residential, "bot"), false)).toBe(botHtml);
      const humanHtml = await readPage(await render(residential), true);
      expect(await readPage(await render(datacenter, "human"), true)).toBe(humanHtml);
    },
  );

  it.each([
    { path: "/", cf: datacenter, ua: "Mozilla/5.0", accept: "text/html", variantKey: "bot" },
    { path: "/", cf: googlebot, ua: "Googlebot/2.1", accept: "text/html", variantKey: "human" },
    { path: "/%61rticle/story", cf: datacenter, ua: "Mozilla/5.0", accept: "text/html, text/markdown;q=0.1", variantKey: "bot" },
    { path: "/%61rticle/story", cf: datacenter, ua: "curl/8.4.0", accept: "text/markdown", variantKey: "md" },
    { path: "/article/story", cf: datacenter, ua: "GPTBot", accept: "text/*;q=1, text/markdown;q=0", variantKey: "md" },
  ])("fetches the cacheable $variantKey page for $ua on $path", async ({ path, cf, ua, accept, variantKey }) => {
    const { bind, ctx } = pageBinding(env);
    const headers = { ...clientHeaders(variantKey === "bot" ? "human" : "bot"), "User-Agent": ua, Accept: accept };
    const response = await worker.fetch(visit(path + "?utm_source=test", cf, { headers }), env, ctx);
    expect(bind.mock.calls.map(([{ props }]) => props)).toEqual([
      { siteKey: "host:" + host, variantKey: "snap" }, { siteKey: siteId, variantKey },
    ]);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, s-maxage=86400, stale-while-revalidate=86400");
    expect(response.headers.getSetCookie()).toEqual([]);
    if (variantKey === "md") {
      const live = await honoFetch(visit(path, cf, { headers: { Accept: accept, "User-Agent": ua } }), env);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
      const body = await response.text();
      expect(body).toBe(await live.text());
      expect(body).toContain("# Test article");
      expect(body).not.toContain(adLoader);
      expect(body).not.toContain('data-ad-client="' + publisher + '"');
    } else {
      await readPage(response, variantKey === "human");
    }
  });

  it("revalidates the browser's article and the ad-free article against their own representations", async () => {
    const { ctx } = pageBinding(env);
    const path = "/article/story";
    const headers = new Headers({ Accept: "text/html", "Accept-Encoding": "br, gzip" });
    const live = await honoFetch(visit(path, residential, { headers }), env);
    const innerTag = live.headers.get("ETag");
    expect(innerTag).toMatch(/^"[0-9a-f]{16}"$/);
    const fetchPage = (cf: EdgeRequestSignals) => worker.fetch(visit(path, cf, { headers }), env, ctx);
    const human = await fetchPage(residential);
    const humanTag = human.headers.get("ETag");
    expect(humanTag).toBe("W/" + innerTag);
    expect(await readPage(human, true)).toBe(await live.text());
    headers.set("If-None-Match", humanTag!);
    expect((await fetchPage(residential)).status).toBe(304);
    const bot = await fetchPage(datacenter);
    await readPage(bot, false);
    const botTag = bot.headers.get("ETag");
    expect(botTag).toMatch(/^W\/"[^"]+"$/);
    expect(botTag).not.toBe(humanTag);
    headers.set("If-None-Match", botTag!);
    const matched = await fetchPage(datacenter);
    expect(matched.status).toBe(304);
    expect(matched.body).toBeNull();
    expect(matched.headers.get("ETag")).toBe(botTag);
  });

  describe.each([
    ["without a binding", "/", false],
    // Hono accepts the numeric prefix as page 2. The gateway caches only all-digit pages.
    ["on an uncached path with a binding", "/category/wellness/page/2-extra", true],
  ] as const)("default Worker %s", (_label, path, bound) => {
    it.each([
      ["human", datacenter, false], ["bot", residential, true],
      ["lst:client", datacenter, false], ["lg:client", datacenter, false],
    ] as const)("ignores client x-cms headers for %s", async (variant, cf, ads) => {
      const { bind, ctx } = pageBinding(env);
      const fetchPage = (headers?: Record<string, string>) =>
        worker.fetch(visit(path, cf, { headers }), env, bound ? ctx : undefined);
      const clean = await fetchPage();
      const marked = await fetchPage(clientHeaders(variant));
      expect([...marked.headers]).toEqual([...clean.headers]);
      expect(await readPage(marked, ads)).toBe(await readPage(clean, ads));
      expect(bind).not.toHaveBeenCalled();
    });
  });

  it("preserves the auction's bot block with a client-supplied human variant", async () => {
    const { bind, ctx } = pageBinding(env);
    const request = visit("/lg/auction", datacenter, { method: "POST", headers: clientHeaders("human"), body: "{}" });
    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "blocked", reason: "bot" });
    expect(bind).not.toHaveBeenCalled();
  });
});
