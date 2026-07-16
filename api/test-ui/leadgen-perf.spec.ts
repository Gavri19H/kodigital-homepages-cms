// LeadGen §28 funnel performance budgets — e2e.
//
// Seeds an activated single-section funnel (NO GA4, NO address section → no
// third-party / Maps SDK JS to muddy the runtime-JS budget) and proves the §28
// budgets on the PUBLIC shell:
//   * CLS === 0 WITH CONTENT (fix-contract v2.4 11 §11.2/§11.6): the shell now
//     SERVER-RENDERS the sections (03 §3.2) and the engine hydrates them —
//     the budget is measured over the content-bearing first question through
//     data-lg-ready="1", not over an empty mount. Mirrors the listicles
//     [cls-evidence] idiom.
//   * funnel runtime JS < 40 KB gzip — the sum of the served INLINE LeadGen
//     scripts (the bootstrap + the §16.3 assignment inject), gzipped; the Maps
//     SDK is excluded (external src, loads only on address sections) and so is
//     any GA4 snippet (this funnel has none).
//   * cache-hit second load is byte-identical + a conditional GET 304s — the P7
//     KV shell cache + strong ETag (mirrors the listicles-render cache-evidence).
//
// AUCTION P95 (§28 "auction P95 bounded by timeout_ms + parse"): NOT re-measured
// here as a load test — it is enforced at the engine level by the P10 auction
// runtime (Promise.race against timeout_ms + Promise.allSettled), and is covered
// by the P10 leadgen-auction-* unit/integration tests. A browser P95 harness would
// require heavy auction/offer seeding for no additional signal over the engine's
// own timeout proof; the budget therefore rides the existing unit enforcement.
//
// The tenant host resolves via --host-resolver-rules; Node-side wire assertions
// send an explicit Host header to 127.0.0.1:<PW_PORT> (default 8787;
// ./utils/base-url.ts).

import { test, expect, request as playwrightRequest } from "@playwright/test";
import { gzipSync } from "node:zlib";
import { seedActivatedFunnel, type SeededP14Funnel } from "./leadgen-p14-seed";
import { PW_PORT } from "./utils/base-url";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
});

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const JS_BUDGET_BYTES = 40 * 1024; // §28 funnel runtime JS < 40 KB gzip

let seeded: SeededP14Funnel;

test.beforeAll(async () => {
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seeded = await seedActivatedFunnel(ctx, { hostPrefix: "lg-p14-perf", slug: "perf" });
  await ctx.dispose();
});

function shellUrl(): string {
  return `http://${seeded.host}:${PW_PORT}/lg/${seeded.slug}`;
}

test.describe("§28 performance budgets", () => {
  test("CLS === 0 on the funnel shell WITH server-rendered content", async ({ page }) => {
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

    await page.goto(shellUrl(), { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    // fix-contract v2.4 11 §11.2/§11.6 (the old "mount stays empty … no
    // shift" comfort is deleted): the section content is SERVER-RENDERED and
    // must be visible, then hydration (the ENGINE sets data-lg-ready="1",
    // 03 §3.5.1) must complete WITHOUT shifting the rendered content.
    await expect(page.locator("[data-lg-mount] [data-lg-question]").first()).toBeVisible();
    await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 8_000 });
    await page.waitForTimeout(500);

    const cls = await page.evaluate(() => (window as unknown as { __clsTotal: number }).__clsTotal);
    console.log(`[cls-evidence] funnel-shell layout-shift total=${cls}`);
    expect(cls).toBe(0);
  });

  test("funnel runtime JS < 40 KB gzip (served inline LeadGen scripts, excl. Maps SDK)", async ({ page }) => {
    await page.goto(shellUrl(), { waitUntil: "load" });

    // Every INLINE <script> (external src'd scripts — the Maps SDK and the
    // versioned /lg/runtime/{v}.js engine bundle — are excluded by
    // :not([src]); the BUNDLE budget has its own dedicated gate,
    // verify:leadgen-runtime ≤ 40960 bytes, 11 §11.1). Inline here = the
    // pre-hydration stub + the §16.3 assignment inject + the #lg-config JSON;
    // drop any GA4 snippet (3rd-party analytics — this funnel has none anyway).
    const scripts = await page.$$eval("script:not([src])", (els) =>
      els.map((e) => e.textContent ?? ""),
    );
    const runtimeJs = scripts.filter((s) => !/googletagmanager|gtag\(/i.test(s)).join("\n");
    const rawBytes = Buffer.byteLength(runtimeJs, "utf8");
    const gzipBytes = gzipSync(Buffer.from(runtimeJs, "utf8")).length;
    console.log(`[js-budget] funnel runtime inline JS raw=${rawBytes}B gzip=${gzipBytes}B (budget ${JS_BUDGET_BYTES}B)`);

    expect(runtimeJs.length).toBeGreaterThan(0); // there IS a runtime (the bootstrap)
    expect(gzipBytes).toBeLessThan(JS_BUDGET_BYTES);
  });

  test("cache-hit second load is byte-identical + a conditional GET 304s", async () => {
    const ctx = await playwrightRequest.newContext();
    // Pin ko_sid so the §16.3 assignment inject is identical across requests
    // (single_control → deterministic dims; the body is then byte-stable).
    const H = { Host: `${seeded.host}:${PW_PORT}`, Cookie: "ko_sid=perf-probe" };
    const url = `${ORIGIN}/lg/${seeded.slug}`;

    const t1 = Date.now();
    const first = await ctx.get(url, { headers: H });
    const d1 = Date.now() - t1;
    expect(first.status()).toBe(200);
    expect(first.headers()["cache-control"]).toBe("public, max-age=300, stale-while-revalidate=86400");
    expect(first.headers()["x-content-type-options"]).toBe("nosniff");
    const etag = first.headers()["etag"] ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{16}"$/);
    const body1 = await first.text();

    const t2 = Date.now();
    const second = await ctx.get(url, { headers: H });
    const d2 = Date.now() - t2;
    expect(second.status()).toBe(200);
    expect(second.headers()["etag"]).toBe(etag);
    expect(await second.text()).toBe(body1); // byte-identical from the edge cache
    console.log(`[cache-evidence] first=${d1}ms second=${d2}ms etag=${etag}`);

    const cond = await ctx.get(url, { headers: { ...H, "If-None-Match": etag } });
    expect(cond.status()).toBe(304);
    expect(await cond.text()).toBe("");
    await ctx.dispose();
  });
});
