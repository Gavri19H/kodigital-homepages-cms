// T22 — Port the ads subsystem: config + gating + slots + provider scripts.
//
// Two behavioral claims, both proven against the REAL subsystem (no source
// grep). Each backing it() embeds the literal evidence file path
// `[api/test/ads-subsystem.test.ts]` plus its L2 disambiguation marker so the
// parse_test_output evidence route binds the receipt to its claim:
//   RC-039 -> T22-AC1  with AdSense enabled + a publisher id, the public head
//                      loads the provider script AND renderAdSlot emits real
//                      ad containers at the design dims (970×90 leaderboard,
//                      728×90 in-feed, 300×250 rect) with data-ad-slot/
//                      data-ad-type — and NO script/unit when not configured.
//   RC-040 -> T22-AC2  shouldShowAds excludes the excluded-pages + logged-in
//                      viewers; /ads.txt serves the operator override.

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import publicRouter from "../src/public/router";
import type { PublicSiteVariables } from "../src/public/middleware";
import type { Env } from "../src/env";
import { ADS_TXT_DEFAULT } from "../src/public/sitemap";
import {
  parseAdsConfig,
  shouldShowAds,
  renderAdProviderHead,
  renderAdSenseUnit,
  renderAdManagerScript,
  resolveAdsTxt,
  AD_SLOT_DIMENSIONS,
  hasGam,
  hasAnyAds,
  isExcluded,
  gamUnitPath,
  renderAdUnit,
  renderGamSlot,
  renderInContentAdUnit,
  AD_REFRESH_SECONDS_MIN,
  type AdsConfig,
  type AdSlotType,
} from "../src/public/ads";
import { renderAdSlot } from "../src/public/templates/components";
import { renderLayout } from "../src/public/templates/layout";
import { renderHome } from "../src/public/templates/home";
import type { HomeArticleCard, HomeViewModel } from "../src/public/view-models/home";

const PUBLISHER = "ca-pub-1234567890123456";

// A fully-configured AdSense config: enabled, a publisher id, per-slot unit
// ids, lazy-load with a custom margin, disable-for-logged-in, and two
// excluded pages.
function liveConfig(overrides: Record<string, string> = {}): AdsConfig {
  return parseAdsConfig({
    ads_enabled: "1",
    ad_provider: "adsense",
    adsense_publisher_id: PUBLISHER,
    ad_unit_leaderboard: "1111111111",
    ad_unit_in_feed: "2222222222",
    ad_unit_rect: "3333333333",
    ad_lazy_load: "1",
    ad_lazy_load_margin: "250px",
    ad_disable_logged_in: "1",
    ad_excluded_pages: "/about\n/contact",
    ...overrides,
  });
}

// Read a quoted attribute value off a single HTML tag string with `.match`
// (a stateful regex iterator is deliberately avoided).
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"));
  if (m === null) return null;
  const value = m[1];
  return value === undefined ? null : value;
}

// The <head>…</head> slice of a rendered document.
function headOf(doc: string): string {
  const start = doc.indexOf("<head>");
  const end = doc.indexOf("</head>");
  expect(start, "doc has <head>").toBeGreaterThan(-1);
  expect(end, "doc has </head>").toBeGreaterThan(start);
  return doc.slice(start, end);
}

const UNIT_BY_TYPE: Readonly<Record<AdSlotType, string>> = {
  leaderboard: "1111111111",
  "in-feed": "2222222222",
  rect: "3333333333",
};

function makeHomeCard(overrides: Partial<HomeArticleCard> = {}): HomeArticleCard {
  return {
    id: 1,
    slug: "story-one",
    title: "Story one",
    excerpt: "Lede sentence for story one.",
    href: "/article/story-one",
    imageUrl: "/media/story-one.jpg",
    imageAlt: "Story one image",
    publishedAt: "2026-05-18T10:00:00.000Z",
    categoryName: "Tech",
    categorySlug: "tech",
    readMinutes: 4,
    ...overrides,
  };
}

function makeHomeVm(): HomeViewModel {
  return {
    site: {
      site_id: "site-acme",
      name: "Acme Daily",
      hostname: "acme.example",
      tagline: "Tomorrow's news today",
      description: "Acme Daily covers technology, world, and culture.",
      logoUrl: "https://acme.example/logo.png",
      brandTokens: {},
    },
    hero: makeHomeCard({ id: 100, slug: "hero", title: "Hero", href: "/article/hero" }),
    featured: [
      makeHomeCard({ id: 1, slug: "f1", title: "Featured one", href: "/article/f1" }),
      makeHomeCard({ id: 2, slug: "f2", title: "Featured two", href: "/article/f2" }),
    ],
    picks: [],
    trending: [],
    latest: [makeHomeCard({ id: 10, slug: "l1", title: "Latest one", href: "/article/l1" })],
    categories: [{ id: 1, slug: "tech", name: "Tech", href: "/category/tech" }],
    newsletter: { heading: "Acme Daily newsletter", description: "Get the brief.", provider: "buttondown" },
    meta: {
      title: "Acme Daily",
      description: "Acme Daily covers technology.",
      canonicalUrl: "https://acme.example/",
    },
  };
}

// ---------------------------------------------------------------------------
// /ads.txt route harness — dispatch through the SHIPPED public router exactly
// as the worker mounts it (app.route("/", publicRouter)), with a DB that
// mirrors the fetchSiteSetting SQL and a KV store for the settings cache.
// ---------------------------------------------------------------------------
const TENANT_HOST = "tenant.example.com";
const ADMIN_HOST = "cms.kodigital.app";
const SITE_ID = "site_T22";

const SITE_CONTEXT_ROW = {
  site_id: SITE_ID,
  hostname: TENANT_HOST,
  vertical_slug: "news",
  status: "active",
  content_version: 7,
  settings_version: 1,
};

function makeKv(): KVNamespace {
  const store = new Map<string, { body: string; metadata: unknown }>();
  return {
    async get(key: string) {
      return store.get(key)?.body ?? null;
    },
    async put(key: string, value: string, opts?: KVNamespacePutOptions) {
      store.set(key, { body: value, metadata: opts?.metadata });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true, cacheStatus: null };
    },
    async getWithMetadata(key: string) {
      const e = store.get(key);
      if (!e) return { value: null, metadata: null, cacheStatus: null };
      return { value: e.body, metadata: e.metadata, cacheStatus: null };
    },
  } as unknown as KVNamespace;
}

// `adsTxtOverride` null → the ads_txt_content setting is absent, so /ads.txt
// must fall back to ADS_TXT_DEFAULT; a string → the operator override is served.
function makeDb(adsTxtOverride: string | null): D1Database {
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
            return { ...SITE_CONTEXT_ROW } as unknown as T;
          }
          if (sql.startsWith("SELECT value FROM site_settings")) {
            const key = captured[1] as string;
            if (key === "ads_txt_content") {
              return (adsTxtOverride === null
                ? null
                : { value: adsTxtOverride }) as unknown as T | null;
            }
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
  return db;
}

function makeEnv(db: D1Database): Env {
  return {
    DB: db,
    CACHE: makeKv(),
    MEDIA: {} as R2Bucket,
    APP_ENV: "test",
    ADMIN_HOST,
    ADMIN_BASE_URL: `https://${ADMIN_HOST}`,
    ADMIN_BASE_PATH: "/admin",
    CACHE_API_ENABLED: "false",
    HTML_CACHE_TTL_SECONDS: "60",
    OPENAI_TEXT_MODEL: "",
    OPENAI_IMAGE_MODEL: "",
    SITE_PROVISIONING_DRY_RUN: "true",
    SITE_PROVISIONING_ALLOW_ROUTE_MUTATION: "false",
  } as unknown as Env;
}

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: PublicSiteVariables }>();
  app.route("/", publicRouter);
  return app;
}

describe("ads-subsystem (T22)", () => {
  it("T22-AC1: AdSense enabled + publisher → head loads the provider script and renderAdSlot emits real containers at the design dims with data-ad-slot/data-ad-type (and nothing when unconfigured) [api/test/ads-subsystem.test.ts] L2_AUTO_DISAMBIGUATION:T22-AC1:RC-039", () => {
    const config = liveConfig();

    // (a) The provider <head> script: AdSense library, async + crossorigin,
    // keyed to the publisher client id — and it composes into the real <head>.
    const providerHead = renderAdProviderHead(config);
    expect(providerHead).toContain(
      "pagead2.googlesyndication.com/pagead/js/adsbygoogle.js",
    );
    expect(providerHead).toContain(`client=${PUBLISHER}`);
    expect(providerHead).toContain("async");
    expect(providerHead).toContain('crossorigin="anonymous"');

    const doc = renderLayout({
      site: { name: "Acme Daily", hostname: "acme.example" },
      meta: { title: "Acme Daily" },
      body: "<p>x</p>",
      extraHead: `${providerHead}\n${renderAdManagerScript(config)}`,
    });
    const head = headOf(doc);
    expect(head).toContain("adsbygoogle.js");
    expect(head).toContain(`client=${PUBLISHER}`);

    // (b) renderAdSlot emits a real container at the design dims, carrying
    // data-ad-slot + data-ad-type, with the AdSense <ins> unit (publisher
    // client id + the per-slot unit id) for each of the three design slots.
    const expectedDims: ReadonlyArray<[AdSlotType, number, number]> = [
      ["leaderboard", 970, 90],
      ["in-feed", 728, 90],
      ["rect", 300, 250],
    ];
    for (const [type, w, h] of expectedDims) {
      expect(AD_SLOT_DIMENSIONS[type]).toEqual({ width: w, height: h });
      const html = renderAdSlot({
        type,
        slotId: `slot-${type}`,
        surface: "home",
        ads: config,
      });
      expect(attr(html, "data-ad-type")).toBe(type);
      expect(attr(html, "data-ad-slot")).toBe(`slot-${type}`);
      // design dims reserved both inline and via data-w/data-h (anti-CLS).
      expect(html).toContain(`width:${w}px`);
      expect(html).toContain(`height:${h}px`);
      expect(attr(html, "data-w")).toBe(String(w));
      expect(attr(html, "data-h")).toBe(String(h));
      // the real AdSense unit at the publisher + per-slot unit id.
      expect(html).toContain('class="adsbygoogle"');
      expect(html).toContain(`data-ad-client="${PUBLISHER}"`);
      expect(html).toContain(`data-ad-slot="${UNIT_BY_TYPE[type]}"`);
      // the inner <ins> is sized to the design dims too.
      expect(renderAdSenseUnit(config, type)).toContain(`width:${w}px`);
    }

    // (c) The live home surface wires the config through to its §5/§9 slots.
    const home = renderHome({ vm: makeHomeVm(), ads: config });
    expect(home).toContain('data-ad-type="leaderboard"');
    expect(home).toContain('data-ad-slot="home-leaderboard"');
    expect(home).toContain(`data-ad-client="${PUBLISHER}"`);
    expect(home).toContain('data-ad-slot="1111111111"'); // leaderboard unit
    expect(home).toContain('data-ad-slot="2222222222"'); // in-feed unit

    // (d) The AdManager client JS lazy-loads via IntersectionObserver with the
    // configured rootMargin and pushes the AdSense queue.
    const mgr = renderAdManagerScript(config);
    expect(mgr).toContain("IntersectionObserver");
    expect(mgr).toContain("rootMargin");
    expect(mgr).toContain("250px");
    expect(mgr).toContain("adsbygoogle");
    expect(mgr).toContain("push(");

    // (e) NO silent fallback: with no publisher (or a non-AdSense provider) the
    // provider script and the <ins> unit are BOTH empty, and a slot rendered
    // without a config carries no AdSense markup at all.
    const noPublisher = parseAdsConfig({ ads_enabled: "1", ad_provider: "adsense" });
    expect(renderAdProviderHead(noPublisher)).toBe("");
    expect(renderAdSenseUnit(noPublisher, "rect")).toBe("");
    expect(renderAdManagerScript(noPublisher)).toBe("");
    const bareSlot = renderAdSlot({ type: "rect", slotId: "x", surface: "home" });
    expect(bareSlot).not.toContain("adsbygoogle");
    // …but the bare slot still reserves the design dimensions.
    expect(bareSlot).toContain("width:300px");
    expect(bareSlot).toContain("height:250px");
  });

  it("T22-AC2: shouldShowAds excludes excluded-pages + logged-in viewers, and /ads.txt serves the operator override [api/test/ads-subsystem.test.ts] L2_AUTO_DISAMBIGUATION:T22-AC2:RC-040", async () => {
    const config = liveConfig();

    // A normal anonymous page request shows ads.
    expect(shouldShowAds(config, { path: "/", loggedIn: false })).toBe(true);
    expect(shouldShowAds(config, { path: "/article/the-feature" })).toBe(true);

    // Excluded pages never show ads (and the match is trailing-slash safe).
    expect(shouldShowAds(config, { path: "/about" })).toBe(false);
    expect(shouldShowAds(config, { path: "/about/" })).toBe(false);
    expect(shouldShowAds(config, { path: "/contact" })).toBe(false);

    // Signed-in viewers are excluded when disable-for-logged-in is set.
    expect(shouldShowAds(config, { path: "/", loggedIn: true })).toBe(false);

    // Master switch + provider gating: a disabled config, a "none" provider,
    // and a missing publisher all suppress ads everywhere.
    expect(shouldShowAds(liveConfig({ ads_enabled: "0" }), { path: "/" })).toBe(false);
    expect(shouldShowAds(liveConfig({ ad_provider: "none" }), { path: "/" })).toBe(false);
    expect(
      shouldShowAds(parseAdsConfig({ ads_enabled: "1", ad_provider: "adsense" }), { path: "/" }),
    ).toBe(false);

    // resolveAdsTxt: an override wins; the default is served otherwise.
    expect(resolveAdsTxt({ override: "google.com, pub-1, DIRECT, f08c" })).toBe(
      "google.com, pub-1, DIRECT, f08c",
    );
    expect(resolveAdsTxt({ override: null })).toBe(ADS_TXT_DEFAULT);

    // /ads.txt served by the SHIPPED router: the operator override is returned
    // verbatim with a 200.
    const override = "google.com, pub-9999999999999999, DIRECT, f08c47fec0942fa0";
    const withOverride = await makeApp().request(
      `https://${TENANT_HOST}/ads.txt`,
      {},
      makeEnv(makeDb(override)),
    );
    expect(withOverride.status).toBe(200);
    expect(await withOverride.text()).toBe(override);

    // …and with no override stored, /ads.txt serves the documented default.
    const noOverride = await makeApp().request(
      `https://${TENANT_HOST}/ads.txt`,
      {},
      makeEnv(makeDb(null)),
    );
    expect(noOverride.status).toBe(200);
    expect(await noOverride.text()).toBe(ADS_TXT_DEFAULT);
  });

  it("rescue-4 round-5 (issue 2/3): Google Ad Manager (GPT) provider — gpt.js head, defineSlot containers, sticky anchor, refresh, native lazy-load, prefix-excluded [api/test/ads-subsystem.test.ts]", () => {
    const gam = parseAdsConfig({
      ads_enabled: "1",
      ad_provider: "gam",
      gam_network_code: "23456789",
      gam_unit_leaderboard: "home_leaderboard",
      gam_unit_in_feed: "home_infeed",
      gam_unit_rect: "/23456789/article_rect",
      ad_sticky_enabled: "1",
      gam_unit_anchor: "anchor_bottom",
      ad_refresh_seconds: "60",
      ad_excluded_pages: "/category",
    });

    expect(hasGam(gam)).toBe(true);
    expect(hasAnyAds(gam)).toBe(true);

    // head: the GPT loader (gpt.js), NOT adsbygoogle.
    const head = renderAdProviderHead(gam);
    expect(head).toContain("securepubads.g.doubleclick.net/tag/js/gpt.js");
    expect(head).toContain("googletag");
    expect(head).not.toContain("adsbygoogle");

    // gamUnitPath: a bare name gets /NETWORK/ prepended; a full path is kept.
    expect(gamUnitPath(gam, "home_leaderboard")).toBe("/23456789/home_leaderboard");
    expect(gamUnitPath(gam, "/23456789/article_rect")).toBe("/23456789/article_rect");

    // renderAdUnit (provider-agnostic) emits a GPT slot div, not an <ins>.
    const lb = renderAdUnit(gam, "leaderboard");
    expect(lb).toContain('class="gpt-slot"');
    expect(lb).toContain('data-gpt-unit="/23456789/home_leaderboard"');
    expect(lb).toContain('data-gpt-w="970"');
    expect(lb).toContain('data-gpt-h="90"');
    expect(lb).not.toContain("adsbygoogle");
    // mobile responsive: the leaderboard slot also carries the 300x250 size +
    // a viewport map (mobile -> 300x250) so wide banners never overflow a phone.
    expect(lb).toContain("data-gpt-map");
    expect(lb).toContain("[300,250]");
    expect(renderGamSlot(gam, "rect")).toContain('data-gpt-unit="/23456789/article_rect"');

    // renderAdSlot container carries the GPT slot at the design dims.
    const slot = renderAdSlot({ type: "leaderboard", slotId: "home-leaderboard", surface: "home", ads: gam });
    expect(attr(slot, "data-ad-type")).toBe("leaderboard");
    expect(slot).toContain('class="gpt-slot"');
    expect(slot).toContain('data-gpt-unit="/23456789/home_leaderboard"');

    // the GAM manager script: defineSlot + single-request + services + display,
    // the BOTTOM_ANCHOR sticky, native lazy-load, and a >=30s refresh timer.
    const mgr = renderAdManagerScript(gam);
    expect(mgr).toContain("googletag");
    expect(mgr).toContain("defineSlot");
    // rescue-4 round-5 (issue 3): lazy ON (default) -> SRA is OFF (GAM lazy-load
    // and single-request are mutually exclusive; SRA would defeat lazy-load).
    expect(mgr).not.toContain("singleRequest");
    // lazy OFF -> single-request batching via setConfig, and NO lazy-load.
    const mgrSra = renderAdManagerScript(parseAdsConfig({ ads_enabled: "1", ad_provider: "gam", gam_network_code: "23456789", gam_unit_leaderboard: "lb", ad_lazy_load: "0" }));
    expect(mgrSra).toContain("setConfig");
    expect(mgrSra).toContain("singleRequest");
    expect(mgrSra).not.toContain("enableLazyLoad");
    expect(mgr).toContain("enableServices");
    expect(mgr).toContain(".display(");
    expect(mgr).toContain("defineOutOfPageSlot");
    expect(mgr).toContain("BOTTOM_ANCHOR");
    expect(mgr).toContain("/23456789/anchor_bottom");
    expect(mgr).toContain("enableLazyLoad");
    expect(mgr).toContain("refresh(");
    expect(mgr).toContain("setInterval");
    expect(mgr).toContain("var rs=60");
    expect(mgr).toContain("defineSizeMapping");
    expect(mgr).toContain("sizeMapping");
    expect(mgr).not.toContain("adsbygoogle");

    // refresh clamp: a sub-floor value is raised to the 30s GAM viewability min.
    const fast = parseAdsConfig({ ads_enabled: "1", ad_provider: "gam", gam_network_code: "1", ad_refresh_seconds: "10" });
    expect(fast.refreshSeconds).toBe(AD_REFRESH_SECONDS_MIN);
    const off = parseAdsConfig({ ads_enabled: "1", ad_provider: "gam", gam_network_code: "1", ad_refresh_seconds: "0" });
    expect(off.refreshSeconds).toBe(0);

    // excluded pages match by PREFIX now: "/category" excludes "/category/jobs".
    expect(shouldShowAds(gam, { path: "/category" })).toBe(false);
    expect(shouldShowAds(gam, { path: "/category/jobs" })).toBe(false);
    expect(shouldShowAds(gam, { path: "/article/x" })).toBe(true);
    expect(isExcluded("/category/jobs", ["/category"])).toBe(true);
    expect(isExcluded("/articlexyz", ["/article"])).toBe(false);

    // no network code → NO silent fallback (no head, no unit, no script).
    const noNet = parseAdsConfig({ ads_enabled: "1", ad_provider: "gam" });
    expect(hasGam(noNet)).toBe(false);
    expect(renderAdProviderHead(noNet)).toBe("");
    expect(renderAdUnit(noNet, "rect")).toBe("");
    expect(renderAdManagerScript(noNet)).toBe("");

    // sticky off → no anchor slot in the script.
    const noSticky = parseAdsConfig({ ads_enabled: "1", ad_provider: "gam", gam_network_code: "1", gam_unit_leaderboard: "lb" });
    expect(renderAdManagerScript(noSticky)).not.toContain("BOTTOM_ANCHOR");

    // issue 2: the refresh timer is VIEWPORT-gated — only slots currently in
    // view are refreshed (inView() via getBoundingClientRect), never off-screen.
    expect(mgr).toContain("inView");
    expect(mgr).toContain("getBoundingClientRect");

    // issue 4: the in-content unit is DISTINCT from the sidebar rect unit (GAM
    // cannot serve the same ad unit twice on one page). With its own unit it
    // renders a gpt-slot; without it the in-content slot is skipped (so it never
    // duplicates the sidebar rect unit).
    const gamIC = parseAdsConfig({ ads_enabled: "1", ad_provider: "gam", gam_network_code: "23456789", gam_unit_rect: "sidebar_rect", gam_unit_in_content: "in_content_rect" });
    const ic = renderInContentAdUnit(gamIC);
    expect(ic).toContain('data-gpt-unit="/23456789/in_content_rect"');
    expect(ic).not.toContain("sidebar_rect");
    expect(renderInContentAdUnit(parseAdsConfig({ ads_enabled: "1", ad_provider: "gam", gam_network_code: "23456789", gam_unit_rect: "sidebar_rect" }))).toBe("");

    // AdSense still works unchanged (the dispatcher did not break it).
    const adsense = liveConfig();
    expect(renderAdUnit(adsense, "rect")).toContain("adsbygoogle");
    expect(renderAdProviderHead(adsense)).toContain("adsbygoogle.js");
  });
});
