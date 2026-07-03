// Listicles Phase 6 — public render e2e (§7.2/§15.2/§21/§22).
//
// Seeds a real ACTIVE tenant + published listicle through the admin APIs
// (listicles-p6-seed.ts), then drives the PUBLIC page:
//   * fixture renders at 1014×857 and 390×844 (screenshots →
//     test-artifacts/listicles-render/),
//   * Disclosure = the MEASURED dropdown behaviour (opens instantly;
//     outside click dismisses; Escape does NOT; trigger re-click keeps open),
//   * §15.2 sticky Version across reloads (same sid stable; fresh sids
//     spread across both arms of a running 50/50 experiment),
//   * §21 GA4 via analytics_script (dataLayer + gtag + config call — the
//     REMOTE gtag.js fetch is deliberately not asserted so the suite stays
//     offline-safe),
//   * §22 cache discipline at the wire: Cache-Control/ETag/nosniff,
//     byte-identical second response + 304 conditional GET (+ timing logged),
//   * §22.4 zero-CLS lazy hydration on an over-budget article.
//
// The browser resolves the tenant host via --host-resolver-rules; Node-side
// wire assertions send an explicit Host header to 127.0.0.1:8787.

import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  seedPublishedListicle,
  startFiftyFiftyExperiment,
  type SeededListicle,
} from "./listicles-p6-seed";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
});

const SHOT_DIR = "test-artifacts/listicles-render";
const ORIGIN = "http://127.0.0.1:8787";

let seeded: SeededListicle;

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seeded = await seedPublishedListicle(ctx, { hostPrefix: "lst-p6-render", slug: "p6-fixture" });
  await ctx.dispose();
});

function publicUrl(seed: SeededListicle): string {
  return `http://${seed.host}:8787/${seed.slug}`;
}

test.describe("published listicle renders (§7.2)", () => {
  test("desktop 1014×857 + mobile 390×844 render the measured shell (screenshots)", async ({ page, browser }) => {
    await page.setViewportSize({ width: 1014, height: 857 });
    await page.goto(publicUrl(seeded), { waitUntil: "domcontentloaded" });
    await expect(page.locator("header.lst-header")).toBeVisible();
    await expect(page.locator(".lst-title .lst-title-line")).toHaveCount(2); // two-line pattern
    await expect(page.locator(".lst-byline")).toBeVisible();
    await expect(page.locator(".lst-hero img")).toBeVisible();
    await expect(page.locator("section.lst-section:visible")).toHaveCount(6);
    await expect(page.locator("hr.lst-divider:visible")).toHaveCount(6);
    // choice groups per the fixture structure: 6/2/4/4/–/3 → 5 groups.
    await expect(page.locator(".lst-choice-group:visible")).toHaveCount(5);
    await expect(page.locator(".lst-legal-band")).toBeVisible();
    await expect(page.locator("footer.lst-footer")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${SHOT_DIR}/fixture-desktop-1014x857.png`, fullPage: true });

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto(publicUrl(seeded), { waitUntil: "domcontentloaded" });
    await expect(mobile.locator("header.lst-header")).toBeVisible();
    await expect(mobile.locator(".lst-hero img")).toBeVisible();
    await mobile.evaluate(() => document.fonts.ready);
    await mobile.waitForTimeout(200);
    await mobile.screenshot({ path: `${SHOT_DIR}/fixture-mobile-390x844.png`, fullPage: true });
    await mobile.close();
  });

  test("governed links carry the full first-party /lc context (no provider URL on the page)", async ({ page }) => {
    await page.goto(publicUrl(seeded), { waitUntil: "domcontentloaded" });
    const href = await page.locator('.lst-choice-btn[href^="/lc/"]').first().getAttribute("href");
    expect(href).toBeTruthy();
    for (const param of ["a=", "lv=", "p=", "s=", "c=", "m=", "r=", "lnk=", "blk=", "role=", "pv="]) {
      expect(href!, `param ${param}`).toContain(param);
    }
    const bodyHtml = await page.content();
    expect(bodyHtml).not.toContain("offers.e2e.test"); // the provider URL never renders
  });
});

test.describe("Disclosure — the MEASURED dropdown interaction", () => {
  test("opens instantly on trigger click; Escape does NOT close; re-click keeps open; outside click dismisses", async ({ page }) => {
    await page.setViewportSize({ width: 1014, height: 857 });
    await page.goto(publicUrl(seeded), { waitUntil: "domcontentloaded" });
    const trigger = page.locator(".lst-disclosure-trigger");
    const panel = page.locator(".lst-disclosure-panel");
    await expect(panel).toBeHidden();

    await trigger.click();
    await expect(panel).toBeVisible(); // instant (no animation to await)
    // Measured: Escape does NOT close.
    await page.keyboard.press("Escape");
    await expect(panel).toBeVisible();
    // Measured: re-clicking the trigger keeps it OPEN (no toggle-close).
    await trigger.click();
    await expect(panel).toBeVisible();
    // Measured: outside click is the ONLY dismiss.
    await page.mouse.click(300, 600);
    await expect(panel).toBeHidden();
  });
});

test.describe("§15.2 sticky Version pick", () => {
  test("same sid stable across reloads; fresh sids spread across both arms", async ({ browser }) => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    await startFiftyFiftyExperiment(ctx, seeded);
    await ctx.dispose();

    // Same browser context (cookie jar) → same ko_sid → stable Version.
    const stable = await browser.newContext();
    const page = await stable.newPage();
    await page.goto(publicUrl(seeded), { waitUntil: "domcontentloaded" });
    const first = await page.locator("body").getAttribute("data-lander-v");
    expect(first).toBeTruthy();
    for (let i = 0; i < 3; i++) {
      await page.reload({ waitUntil: "domcontentloaded" });
      expect(await page.locator("body").getAttribute("data-lander-v")).toBe(first);
    }
    await stable.close();

    // Fresh contexts (fresh sids) → both arms observed over 20 contexts
    // (P[all-same] = 2·(1/2)^20 ≈ 2e-6 under the 50/50 allocation).
    const seen = new Set<string>();
    for (let i = 0; i < 20 && seen.size < 2; i++) {
      const fresh = await browser.newContext();
      const p = await fresh.newPage();
      await p.goto(publicUrl(seeded), { waitUntil: "domcontentloaded" });
      const lander = await p.locator("body").getAttribute("data-lander-v");
      if (lander) seen.add(lander);
      await fresh.close();
    }
    expect(seen.size).toBe(2);
  });
});

test.describe("§21 GA4 via analytics_script", () => {
  test("dataLayer + gtag exist and the config call carries the site's measurement id", async ({ page }) => {
    await page.goto(publicUrl(seeded), { waitUntil: "domcontentloaded" });
    // The loader tag is in <head> via the settings head path (§21/DEV-5).
    await expect(
      page.locator(`script[src*="googletagmanager.com/gtag/js?id=${seeded.gaMeasurementId}"]`),
    ).toHaveCount(1);
    const ga = await page.evaluate(() => {
      const w = window as unknown as { dataLayer?: unknown[]; gtag?: unknown };
      return {
        hasDataLayer: Array.isArray(w.dataLayer),
        gtagType: typeof w.gtag,
        serialized: JSON.stringify(
          (w.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>)),
        ),
      };
    });
    expect(ga.hasDataLayer).toBe(true);
    expect(ga.gtagType).toBe("function");
    expect(ga.serialized).toContain("config");
    expect(ga.serialized).toContain(seeded.gaMeasurementId);
  });
});

test.describe("§22 cache discipline at the wire", () => {
  test("headers + byte-identical second response + 304 conditional GET (timing logged)", async () => {
    const ctx = await playwrightRequest.newContext();
    const url = `${ORIGIN}/${seeded.slug}`;
    const headers = { Host: `${seeded.host}:8787`, Cookie: "ko_sid=wire-probe" };

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
    expect(await second.text()).toBe(body1); // byte-identical from the edge cache
    console.log(`[cache-evidence] first=${d1}ms second=${d2}ms etag=${etag}`);

    const conditional = await ctx.get(url, {
      headers: { ...headers, "If-None-Match": etag },
    });
    expect(conditional.status()).toBe(304);
    expect(await conditional.text()).toBe("");
    await ctx.dispose();
  });
});

test.describe("§22.4 zero CLS on below-fold lazy hydration", () => {
  test("over-budget shell hydrates /lst-cand placeholders with zero layout shift", async ({ page }) => {
    // A SECOND article whose alternate candidates blow the 40KB budget:
    // 3 ab_test pages × 1 hidden alternate × ~45KB → below-fold pages
    // lazy-hydrate (page 0 stays inline).
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    const over = await seedPublishedListicle(ctx, {
      hostPrefix: "lst-p6-cls",
      slug: "p6-over-budget",
      abPairs: true,
      sectionFiller: "neutral filler copy ".repeat(2400), // ~48KB per section
    });
    // The shell must actually be over budget: raw HTML carries lazy hooks.
    const raw = await ctx.get(`${ORIGIN}/${over.slug}`, {
      headers: { Host: `${over.host}:8787` },
    });
    const rawHtml = await raw.text();
    expect(rawHtml).toContain("data-lst-lazy");
    expect(rawHtml).toContain("lst-cand-pending");
    await ctx.dispose();

    await page.setViewportSize({ width: 1014, height: 857 });
    // CLS instrumentation BEFORE any content loads.
    await page.addInitScript(() => {
      (window as unknown as { __clsTotal: number }).__clsTotal = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
          if (!entry.hadRecentInput) {
            (window as unknown as { __clsTotal: number }).__clsTotal += entry.value;
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    });
    // Review finding 2 — STRUCTURAL zero-CLS: hydration is eager-on-load-idle,
    // so the swap completes shortly after the `load` event WITHOUT the user
    // ever scrolling. This test never scrolls; it waits for `load` and then
    // asserts the placeholders resolve promptly. The min-height floor +
    // aspect-ratio reservations remain the extreme-latency-tail fallback (no
    // scroll trigger exists to test — hydration never waits for the user).
    await page.goto(`http://${over.host}:8787/${over.slug}`, { waitUntil: "load" });
    // Placeholders hydrate from GET /lst-cand/:id SHORTLY AFTER load — well
    // inside the hydrator's own 2s idle-timeout bound + fetch time.
    await expect(page.locator("[data-lst-lazy]")).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator(".lst-cand-pending")).toHaveCount(0);
    // Hydrated content is real section markup.
    await expect(page.locator('.lst-page[data-page-index="1"] .lst-section')).toBeVisible();
    // Proof the user never scrolled: the swap happened at scroll position 0.
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBe(0);
    await page.waitForTimeout(500); // let any late shifts land
    const cls = await page.evaluate(() => (window as unknown as { __clsTotal: number }).__clsTotal);
    console.log(`[cls-evidence] layout-shift total=${cls} (hydrated-without-scroll, scrollY=${scrollY})`);
    expect(cls).toBeLessThan(0.02); // zero-CLS budget (≈0; tolerance for env noise)
  });
});
