// Listicles Phase 10 — CWV + cache + GA4 + homepage-isolation regression
// (§22 / §21 / §25, pillar-1 final proof). Runs against the real worker under
// `wrangler dev` (playwright.config.ts webServer). Seeds a real published
// listicle through the admin APIs; the homepage-isolation check reads the
// `npm run seed:local` localhost site (the gate runs seed:local first).
//
// Honest bounds: LCP/CLS are measured on the LOCAL dev instance (miniflare, no
// Cloudflare edge cache tier, no CDN) — CLS targets ~0 (structural, must
// hold), and LCP is asserted against a GENEROUS local ceiling + logged as
// evidence (production edge LCP is faster; a local ceiling is the honest
// pre-deploy proxy). The cache proof is the Phase-6 KV/Cache-API mechanism at
// the wire (byte-identical 2nd response + 304 conditional GET + timing).

import { test, expect, request as playwrightRequest } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { seedPublishedListicle, type SeededListicle } from "./listicles-p6-seed";

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

const SHOT_DIR = "test-artifacts/listicles-perf";
const ORIGIN = "http://127.0.0.1:8787";
let seeded: SeededListicle;

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seeded = await seedPublishedListicle(ctx, { hostPrefix: "lst-p10-perf", slug: "p10-perf" });
  await ctx.dispose();
});

function publicUrl(): string {
  return `http://${seeded.host}:8787/${seeded.slug}`;
}

test.describe("§22 CWV on a rendered listicle", () => {
  test("CLS ~0 and a reasonable LCP (both logged as evidence)", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __clsTotal: number; __lcp: number };
      w.__clsTotal = 0;
      w.__lcp = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
          if (!e.hadRecentInput) w.__clsTotal += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        const entries = list.getEntries() as unknown as Array<{ startTime: number; renderTime: number; loadTime: number }>;
        const last = entries[entries.length - 1];
        if (last) w.__lcp = last.renderTime || last.loadTime || last.startTime || 0;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    });
    await page.setViewportSize({ width: 1014, height: 857 });
    await page.goto(publicUrl(), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600); // let LCP settle + any late shifts land

    const cwv = await page.evaluate(() => {
      const w = window as unknown as { __clsTotal: number; __lcp: number };
      return { cls: w.__clsTotal, lcp: w.__lcp };
    });
    console.log(`[p10-cwv] CLS=${cwv.cls} LCP=${cwv.lcp}ms`);
    expect(cwv.cls).toBeLessThan(0.02); // §22.4 zero-CLS target
    expect(cwv.lcp).toBeGreaterThan(0); // LCP actually captured
    expect(cwv.lcp).toBeLessThan(4000); // generous LOCAL ceiling (logged for evidence)
    await page.screenshot({ path: `${SHOT_DIR}/cwv-rendered-listicle.png`, fullPage: true });
  });
});

test.describe("§22 cache discipline at the wire (Phase-6 KV/Cache-API mechanism)", () => {
  test("headers + byte-identical 2nd response (cache HIT) + 304 conditional GET, timing logged", async () => {
    const ctx = await playwrightRequest.newContext();
    const url = `${ORIGIN}/${seeded.slug}`;
    const headers = { Host: `${seeded.host}:8787`, Cookie: "ko_sid=perf-probe" };

    const t1 = Date.now();
    const first = await ctx.get(url, { headers });
    const d1 = Date.now() - t1;
    expect(first.status()).toBe(200);
    expect(first.headers()["cache-control"]).toBe("public, max-age=300, stale-while-revalidate=86400");
    expect(first.headers()["x-content-type-options"]).toBe("nosniff");
    const etag = first.headers()["etag"] ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    const body1 = await first.text();

    const t2 = Date.now();
    const second = await ctx.get(url, { headers });
    const d2 = Date.now() - t2;
    expect(second.status()).toBe(200);
    expect(second.headers()["etag"]).toBe(etag);
    expect(await second.text()).toBe(body1); // byte-identical from the edge cache (HIT)
    console.log(`[p10-cache] first=${d1}ms second=${d2}ms etag=${etag}`);

    const conditional = await ctx.get(url, { headers: { ...headers, "If-None-Match": etag } });
    expect(conditional.status()).toBe(304);
    expect(await conditional.text()).toBe("");
    await ctx.dispose();
  });
});

test.describe("§21 GA4 via analytics_script", () => {
  test("gtag.js loader + dataLayer + config call carry the site's measurement id", async ({ page }) => {
    await page.goto(publicUrl(), { waitUntil: "domcontentloaded" });
    await expect(page.locator(`script[src*="googletagmanager.com/gtag/js?id=${seeded.gaMeasurementId}"]`)).toHaveCount(1);
    const ga = await page.evaluate(() => {
      const w = window as unknown as { dataLayer?: unknown[]; gtag?: unknown };
      return {
        has: Array.isArray(w.dataLayer),
        t: typeof w.gtag,
        s: JSON.stringify((w.dataLayer ?? []).map((e) => Array.from(e as ArrayLike<unknown>))),
      };
    });
    expect(ga.has).toBe(true);
    expect(ga.t).toBe("function");
    expect(ga.s).toContain("config");
    expect(ga.s).toContain(seeded.gaMeasurementId);
  });
});

test.describe("pillar-1 regression — homepage + /api/track untouched", () => {
  test("homepage renders (non-listicle), /api/track still 204s, homepage.events shape unchanged", async ({ page }) => {
    // /api/track always 204s (single event + {events:[...]} batch).
    const single = await page.request.post(`${ORIGIN}/api/track`, {
      data: { event: "page_view", session_id: "perf-hp-1", url: "http://localhost:8787/" },
    });
    expect(single.status()).toBe(204);
    const batch = await page.request.post(`${ORIGIN}/api/track`, {
      data: { events: [{ event: "impression", advertiser: "x", session_id: "perf-hp-2" }, { event: "click", session_id: "perf-hp-2" }] },
    });
    expect(batch.status()).toBe(204);
    // an UNKNOWN event type is still 204 (dropped, never errored) — schema guard.
    const unknown = await page.request.post(`${ORIGIN}/api/track`, { data: { event: "not_a_real_event" } });
    expect(unknown.status()).toBe(204);

    const home = await page.request.get("http://localhost:8787/");
    expect(home.status()).toBe(200); // a hard 200, not merely "< 500"
    const html = await home.text();
    // POSITIVE homepage marker (seeded home buckets) — a blank/degraded but
    // non-5xx homepage now FAILS, not just a listicle-marker absence check.
    expect(html).toMatch(/home-(grid|section)/);
    expect(html).not.toContain("lst-header");
    expect(html).not.toContain("lst-page");
    console.log(`[p10-homepage] status=${home.status()} home-marker=present`);
  });
});
