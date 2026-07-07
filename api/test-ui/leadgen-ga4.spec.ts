// LeadGen §28 GA4 pass-through in the funnel shell — e2e.
//
// Seeds an activated funnel on a tenant host with a per-site GA4 measurement id
// (settings_overrides_json.ga4_measurement_id), then drives the PUBLIC funnel
// shell and proves the §28 GA4 contract:
//   * window.dataLayer exists and GROWS (is never reset) — a pre-existing entry
//     pushed BEFORE the shell scripts run survives the load;
//   * gtag is a function; a gtag('config', <site id>) call fires;
//   * the async gtag.js loader tag carries the site's id;
//   * NO GA4 console errors on the funnel;
//   * /lg/track (a header-only no-store beacon) never strips window.dataLayer.
//
// The tenant host resolves via --host-resolver-rules. The remote gtag.js host is
// STUBBED to an empty 200 so the async loader "loads" offline (no network error)
// — the inline snippet is what defines gtag + dataLayer and is what we assert
// (mirrors the listicles GA4 spec's offline-safe stance).

import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";
import { seedActivatedFunnel, type SeededP14Funnel } from "./leadgen-p14-seed";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
});

const ORIGIN = "http://127.0.0.1:8787";

let seeded: SeededP14Funnel;

test.beforeAll(async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seeded = await seedActivatedFunnel(ctx, {
    hostPrefix: "lg-p14-ga4",
    slug: "ga4",
    ga4MeasurementId: `G-P14${Date.now().toString().slice(-8)}`,
  });
  await ctx.dispose();
});

function shellUrl(): string {
  return `http://${seeded.host}:8787/lg/${seeded.slug}`;
}

// Stub the remote gtag.js so the async loader resolves offline (empty 200) — no
// net error to pollute the console-error assertion.
async function stubGoogleTagManager(page: Page): Promise<void> {
  await page.route("**://www.googletagmanager.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
}

test.describe("§28 GA4 pass-through", () => {
  test("dataLayer grows (not reset), gtag is a function, config carries the site id, no GA4 errors", async ({ page }) => {
    await stubGoogleTagManager(page);

    // A PRE-EXISTING dataLayer entry set BEFORE any document script runs — it must
    // survive (the shell uses `window.dataLayer = window.dataLayer || []`).
    await page.addInitScript(() => {
      const w = window as unknown as { dataLayer?: unknown[] };
      w.dataLayer = w.dataLayer ?? [];
      w.dataLayer.push({ __pre_existing_sentinel: "keep-me" });
    });

    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto(shellUrl(), { waitUntil: "load" });

    // the async loader tag carries the site's measurement id.
    await expect(
      page.locator(`script[src*="googletagmanager.com/gtag/js?id=${seeded.ga4MeasurementId}"]`),
    ).toHaveCount(1);

    const ga = await page.evaluate(() => {
      const w = window as unknown as { dataLayer?: unknown[]; gtag?: unknown };
      const layer = w.dataLayer ?? [];
      return {
        isArray: Array.isArray(w.dataLayer),
        len: layer.length,
        gtagType: typeof w.gtag,
        sentinelSurvives: layer.some(
          (e) => e !== null && typeof e === "object" && (e as { __pre_existing_sentinel?: string }).__pre_existing_sentinel === "keep-me",
        ),
        serialized: JSON.stringify(
          layer.map((e) =>
            e !== null && typeof (e as ArrayLike<unknown>).length === "number" ? Array.from(e as ArrayLike<unknown>) : e,
          ),
        ),
      };
    });

    expect(ga.isArray).toBe(true);
    expect(ga.gtagType).toBe("function");
    expect(ga.sentinelSurvives).toBe(true); // dataLayer was NOT reset
    expect(ga.len).toBeGreaterThan(1); // grew beyond the pre-existing entry (js + config)
    expect(ga.serialized).toContain("config");
    expect(ga.serialized).toContain(seeded.ga4MeasurementId);

    const ga4Errors = errors.filter((e) => /gtag|datalayer|googletagmanager/i.test(e));
    expect(ga4Errors, ga4Errors.join("\n")).toEqual([]);
  });

  test("/lg/track (header-only beacon) does not strip window.dataLayer", async ({ page }) => {
    await stubGoogleTagManager(page);
    await page.goto(shellUrl(), { waitUntil: "load" });

    const before = await page.evaluate(() => (window as unknown as { dataLayer?: unknown[] }).dataLayer?.length ?? 0);
    expect(before).toBeGreaterThan(0);

    // Fire a /lg/track beacon from the page (same-origin tenant host). It is a
    // server-side header-only no-store beacon — it can never touch client state.
    await page.evaluate(async () => {
      try {
        await fetch("/lg/track", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ events: [] }),
        });
      } catch {
        /* the beacon status is irrelevant — we assert dataLayer is untouched */
      }
    });

    const after = await page.evaluate(() => {
      const w = window as unknown as { dataLayer?: unknown[]; gtag?: unknown };
      return { isArray: Array.isArray(w.dataLayer), len: w.dataLayer?.length ?? 0, gtagType: typeof w.gtag };
    });
    expect(after.isArray).toBe(true);
    expect(after.gtagType).toBe("function");
    expect(after.len).toBeGreaterThanOrEqual(before); // never reset / shrank
  });
});

test.describe("§28 GA4 absence", () => {
  test("a funnel with NO ga4_measurement_id emits NO gtag loader", async ({ page }) => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    const noGa = await seedActivatedFunnel(ctx, { hostPrefix: "lg-p14-noga4", slug: "noga4" });
    await ctx.dispose();

    await page.goto(`http://${noGa.host}:8787/lg/${noGa.slug}`, { waitUntil: "load" });
    await expect(page.locator('script[src*="googletagmanager.com"]')).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain("gtag(");
  });
});

test.describe("§28 GA4 per-tenant isolation", () => {
  test("two tenants each carry ONLY their own GA4 id (no cross-tenant bleed)", async ({ page }) => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    const stamp = Date.now().toString().slice(-6);
    const gaA = `G-TNTA${stamp}`;
    const gaB = `G-TNTB${stamp}`;
    // Two DISTINCT tenant sites, each activated with its OWN measurement id.
    const siteA = await seedActivatedFunnel(ctx, { hostPrefix: "lg-p14-tenanta", slug: "a", ga4MeasurementId: gaA });
    const siteB = await seedActivatedFunnel(ctx, { hostPrefix: "lg-p14-tenantb", slug: "b", ga4MeasurementId: gaB });
    await ctx.dispose();

    // The shell is cached per site_id (lg-shell:{site_id}:…), so site A's shell can
    // carry ONLY gaA and site B's ONLY gaB — never each other's id.
    await page.goto(`http://${siteA.host}:8787/lg/${siteA.slug}`, { waitUntil: "domcontentloaded" });
    const htmlA = await page.content();
    expect(htmlA).toContain(gaA);
    expect(htmlA).not.toContain(gaB);

    await page.goto(`http://${siteB.host}:8787/lg/${siteB.slug}`, { waitUntil: "domcontentloaded" });
    const htmlB = await page.content();
    expect(htmlB).toContain(gaB);
    expect(htmlB).not.toContain(gaA);
  });
});
