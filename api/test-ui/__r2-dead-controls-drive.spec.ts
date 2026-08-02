// R2 F-2 — LIVE OPERATOR DRIVE for the three dead controls (E6/E10).
//
// Existence is never proof: this spec sets each control through the REAL admin
// API the Themes manager / Templates tab call, re-PUTs the activation (the
// operator's own cache-coherence act — the shell is max-age=300, ADJ-N39), and
// MEASURES the browser's own computed values on the live visitor page at both
// contract viewports. Screenshots land next to the numbers.
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PW_PORT = process.env["PW_PORT"] || "8787";
const ADMIN = `http://127.0.0.1:${PW_PORT}/api/admin/leadgen`;
const HOST = "r2fix.e2e.test";
const SLUG = "r2fix";
const QUOTE = "lgq_01KZ19BSE7YHN24F81EG2NZWSF";
const FUNNEL = "lgf_01KZ19BSE71XDK3CD25202D308";
const SITE = "st_bef896a0878c4457";
const THEME = "thm_deadctl-probe";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, "..", "..", "docs", "leadgen", "r2", "evidence", "p7-owner", "dead-controls");

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] } });

test.beforeAll(() => mkdirSync(SHOTS, { recursive: true }));

const FIELD_HEIGHT_PX: Record<string, string> = { small: "44px", medium: "52px", large: "60px" };

async function setControlsAndRepublish(
  request: import("@playwright/test").APIRequestContext,
  controls: Record<string, string>,
): Promise<void> {
  const expected = FIELD_HEIGHT_PX[controls["field_height"] as string];
  const patch = await request.patch(`${ADMIN}/themes/${THEME}`, { data: { controls } });
  expect(patch.status(), await patch.text()).toBe(200);
  const reput = await request.put(`${ADMIN}/quotes/${QUOTE}/activation/${SITE}`, {
    data: { enabled: true, slug: SLUG },
  });
  expect(reput.status(), await reput.text()).toBe(200);
  // ADJ-N39: the public shell is max-age=300 and the republish is async, so a
  // navigation issued immediately can still be served the PREVIOUS render.
  // Poll the served stylesheet until it carries the value just written — never
  // measure a page we have not proven is the fresh one.
  const want = `.lg-input{`;
  for (let i = 0; i < 120; i++) {
    // ADJ-N39 is slow AND sticky here: re-assert the activation periodically so
    // a missed invalidation cannot strand the poll on a stale render.
    if (i > 0 && i % 12 === 0) {
      await request.put(`${ADMIN}/quotes/${QUOTE}/activation/${SITE}`, { data: { enabled: true, slug: SLUG } });
    }
    // node-side fetch cannot use the browser's --host-resolver-rules, so the
    // tenant host rides as an explicit Host header against loopback.
    const res = await request.get(`http://127.0.0.1:${PW_PORT}/lg/${SLUG}?_cb=poll${Date.now()}${i}`, {
      headers: { Host: HOST },
    });
    const body = await res.text();
    expect(body, "the polled response is the funnel shell").toContain("lg-funnel-root");
    const at = body.indexOf(want);
    const seen = at < 0 ? "" : /min-height:([0-9]+px)/.exec(body.slice(at, at + 400))?.[1];
    if (seen === expected) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`served page never reflected min-height ${expected} after the republish`);
}

async function measure(page: import("@playwright/test").Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`http://${HOST}:${PW_PORT}/lg/${SLUG}?_cb=${Date.now()}${width}`, { waitUntil: "load" });
  const input = page.locator("input.lg-input").first();
  await input.waitFor({ state: "visible" });
  return {
    fieldMinHeight: await input.evaluate((el) => getComputedStyle(el).minHeight),
    fieldBoxHeight: await input.evaluate((el) => Math.round(el.getBoundingClientRect().height)),
    buttonMinHeight: await page
      .locator("button.lg-btn.lg-continue, button.lg-btn")
      .first()
      .evaluate((el) => getComputedStyle(el).minHeight),
    noOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  };
}

test("field_height + button_size govern the live painted funnel at 1280 and 375", async ({ page, request }) => {
  const ladder: Record<string, { fieldMin: string[]; fieldBox: number[]; button: string[] }> = {
    "1280": { fieldMin: [], fieldBox: [], button: [] },
    "375": { fieldMin: [], fieldBox: [], button: [] },
  };
  for (const step of [
    { field_height: "small", button_size: "s", corners: "rounded" },
    { field_height: "medium", button_size: "m", corners: "rounded" },
    { field_height: "large", button_size: "l", corners: "rounded" },
  ]) {
    await setControlsAndRepublish(request, step);
    for (const width of [1280, 375]) {
      const m = await measure(page, width);
      ladder[String(width)]!.fieldMin.push(m.fieldMinHeight);
      ladder[String(width)]!.fieldBox.push(m.fieldBoxHeight);
      ladder[String(width)]!.button.push(m.buttonMinHeight);
      expect(m.noOverflow, `no horizontal overflow at ${width}`).toBe(true);
      await page.screenshot({
        path: path.join(SHOTS, `theme-${step.field_height}-${width}.png`),
        fullPage: false,
      });
    }
  }
  // eslint-disable-next-line no-console
  console.log("MEASURED ladder:", JSON.stringify(ladder));
  for (const width of ["1280", "375"]) {
    expect(ladder[width]!.button, `button_size ladder @${width}`).toEqual(["44px", "52px", "60px"]);
    expect(ladder[width]!.fieldMin, `field_height ladder @${width}`).toEqual(["44px", "52px", "60px"]);
    // The PAINTED box: the ladder is a FLOOR (presets.ts: "a preset only ever
    // FLOORS the box — it never clips"), and this field's intrinsic content box
    // is 54px, so Small/Medium sit under it and Large lifts it. Recorded as a
    // measured fact, not asserted as a fixed number beyond the ordering.
    const box = ladder[width]!.fieldBox;
    expect(box[2]!, `Large lifts the painted field box @${width}`).toBeGreaterThan(box[0]!);
    expect(box[2]!, `Large paints its own step @${width}`).toBe(60);
  }
});

test("element F per-logo Size governs the live logo strip at 1280 and 375", async ({ page, request }) => {
  // A REAL uploaded logo (the operator's own /assets/brand-logo path) so the
  // strip renders actual pixels — a broken <img> would make the screenshot
  // worthless as size evidence.
  const upload = await request.post(`${ADMIN}/assets/brand-logo`, {
    multipart: {
      file: {
        name: "probe.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" rx="12" fill="#0B5FFF"/></svg>',
        ),
      },
    },
  });
  expect(upload.status(), await upload.text()).toBe(200);
  const logoUrl = ((await upload.json()) as { url: string }).url;
  const put = await request.put(`${ADMIN}/funnels/${FUNNEL}/frame`, {
    data: {
      frame_config_json: {
        brand_logos: {
          enabled: true,
          layout: "row",
          slot: "below_section",
          items: [
            { url: logoUrl, alt: "Logo S", size: "s" },
            { url: logoUrl, alt: "Logo M", size: "m" },
            { url: logoUrl, alt: "Logo L", size: "l" },
          ],
        },
      },
    },
  });
  expect(put.status(), await put.text()).toBe(200);
  const reput = await request.put(`${ADMIN}/quotes/${QUOTE}/activation/${SITE}`, {
    data: { enabled: true, slug: SLUG },
  });
  expect(reput.status()).toBe(200);

  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`http://${HOST}:${PW_PORT}/lg/${SLUG}?_cb=${Date.now()}${width}`, { waitUntil: "load" });
    const imgs = page.locator(".lg-frame-brand-logos .lg-logo-strip-img");
    await expect(imgs).toHaveCount(3);
    const resolved = await imgs.evaluateAll((els) =>
      els.map((el) => `${el.className}=${getComputedStyle(el).maxHeight}`),
    );
    // The PAINTED boxes must actually differ — computed CSS alone would not
    // prove the strip renders three different sizes.
    const boxes = await imgs.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    // eslint-disable-next-line no-console
    console.log(`MEASURED logo painted heights @${width}:`, JSON.stringify(boxes));
    expect(boxes, `three distinct painted logo heights @${width}`).toEqual([24, 32, 48]);
    // eslint-disable-next-line no-console
    console.log(`MEASURED logo max-height @${width}:`, JSON.stringify(resolved));
    expect(resolved).toEqual([
      "lg-logo-strip-img lg-logo-strip-img--s=24px",
      "lg-logo-strip-img lg-logo-strip-img--m=32px",
      "lg-logo-strip-img lg-logo-strip-img--l=48px",
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: path.join(SHOTS, `logo-sizes-${width}.png`), fullPage: false });
  }
});
