// LEADGEN R2 — P6 terminal: the §8.4 Themes-manager CENTER-column layout
// defect drive (owner clause ③, the Themes rebuild).
//
// DEFECT (measured, not reasoned): /admin/leadgen/themes packs the editor
// controls (data-pin="8.4-editor-controls") beside the live canvas
// (data-pin="8.4-live-canvas") inside the ONE flex:1 1 auto CENTER column.
// The canvas was flex:0 0 340px (unshrinkable) and the row had NO flex-wrap,
// so on any viewport where the centre column's inner width fell below
// 340 + 26(gap) + <editor>, the flexible editor child absorbed the whole
// deficit and computed to width 0 — hiding EVERY §10.3/§10.4 control it
// holds. At the suite's pinned 1280 desktop width the centre's inner width
// is ~304px, so the editor collapsed to 0 and `isVisible()` was false.
//
// This file MEASURES the layout at four real widths (1280 / 1366 / 1440 /
// 1600) plus a 375 overflow check. It asserts the DEGRADE contract:
//   * every width: the editor column has non-zero width, a §10.4 leaf
//     control is visible, and the live canvas is present and visible;
//   * 1600: the §8.4 anatomy is UNCHANGED — controls BESIDE the canvas
//     (canvas.x >= editor.right, vertically overlapping) with the canvas
//     still at its designed 340px;
//   * 1280: the SAME anatomy (added in P8 CLOSE — see below);
//   * 375: no horizontal overflow (scrollWidth <= innerWidth).
// Numbers are printed for every width so the degrade threshold is a
// measurement in the log, never a claim.
//
// P8 CLOSE SLICE F-A — THE 1280 LEG. The full-program adversarial review
// (docs/leadgen/r2/evidence/p8/review-p8-program/REVIEW.md, finding D-2) drove
// this page and measured the §8.4 anatomy delivered ONLY at >=1600: at 1280 it
// found "editor x603 y165 w304 / canvas x603 y2123 w304 — NO, 1958px below"
// (my own fail-before on the same page at HEAD 1dbf1783: canvas y2104, 1939px
// below). 1280 is the width the owner's OWN mock is authored and rendered at —
// docs/leadgen/rework/design-pack/themes.html, PIN "8.4-themes-tab-layout" /
// "full Themes tab layout at 1280", whose header states the pin verbatim:
// "Pins the Themes tab replacing its swatch-only preview with a live
// real-section canvas beside the editor ... rail widths (300/320) are kept
// exactly as built". So "beside" is asserted HERE too, at 1280, on a fresh
// load AND with a theme opened for edit through the real card link.
import { test, expect, type Page } from "@playwright/test";

const SHOT_DIR = "../docs/leadgen/r2/evidence/p6/themefix";
const EDITOR = '[data-pin="8.4-editor-controls"]';
const CANVAS = '[data-pin="8.4-live-canvas"]';

interface Geom {
  bodyW: number;
  editorW: number;
  editorX: number;
  editorY: number;
  editorRight: number;
  canvasW: number;
  canvasX: number;
  canvasY: number;
  sideBySide: boolean;
  sameRow: boolean;
}

async function measure(page: Page): Promise<Geom> {
  const body = await page.locator(".tm-body").boundingBox();
  const ed = await page.locator(EDITOR).boundingBox();
  const cv = await page.locator(CANVAS).boundingBox();
  if (body === null || ed === null || cv === null) {
    throw new Error(`missing box: body=${JSON.stringify(body)} editor=${JSON.stringify(ed)} canvas=${JSON.stringify(cv)}`);
  }
  return {
    bodyW: Math.round(body.width),
    editorW: Math.round(ed.width),
    editorX: Math.round(ed.x),
    editorY: Math.round(ed.y),
    editorRight: Math.round(ed.x + ed.width),
    canvasW: Math.round(cv.width),
    canvasX: Math.round(cv.x),
    canvasY: Math.round(cv.y),
    // BESIDE = the canvas starts at/after the editor's right edge AND the
    // two boxes share vertical space (a wrapped/stacked canvas starts at
    // the editor's own x, below it).
    sideBySide: Math.round(cv.x) >= Math.round(ed.x + ed.width) - 1,
    // The second half of BESIDE, asserted separately by the 1280 leg: the two
    // columns are on the SAME flex line. A wrapped canvas keeps its x when the
    // editor takes the full line, so x alone cannot tell the two apart.
    sameRow: Math.round(cv.y) === Math.round(ed.y),
  };
}

// FRESH-SEED PRECONDITION (measured, P8 CLOSE F-A): `npm run db:reset:local`
// + `npm run seed:leadgen-fixture` seeds a site/offer/quote/funnel but NO
// theme — on a freshly reset instance /admin/leadgen/themes renders "Create a
// theme to get started" and neither §8.4 pin exists, so every assertion in
// this file would fail for a reason that is not the layout. The catalog is
// therefore topped up through the REAL admin API with the SAME payload the
// manager's own "New theme" button POSTs (ui-theme-manager.ts wireNewTheme),
// and only when it is empty — an instance that already has themes is left
// exactly as it is.
async function ensureTheme(request: import("@playwright/test").APIRequestContext): Promise<void> {
  const listRes = await request.get("/api/admin/leadgen/themes");
  expect(listRes.status(), "GET /themes").toBe(200);
  const list = (await listRes.json()) as { items?: unknown[] };
  if ((list.items ?? []).length > 0) return;
  const created = await request.post("/api/admin/leadgen/themes", {
    data: {
      name: "R2P6 Drive Theme",
      roles: {
        brand_primary: "#1B3A5C", accent: "#2E6BB0", page_bg: "#FFFFFF",
        card: "#FFFFFF", text: "#1A1F36", success: "#0E7C3A", error: "#B23A2C",
      },
      typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
      controls: { field_height: "medium", button_size: "m", corners: "rounded" },
    },
  });
  expect(created.status(), `POST /themes -> ${await created.text()}`).toBeLessThan(300);
}

async function openThemes(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/admin/leadgen/themes?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tm-body")).toBeVisible({ timeout: 15_000 });
}

test.describe("R2 P6 — §8.4 themes-manager centre-column layout", () => {
  test.beforeEach(async ({ request }) => {
    await ensureTheme(request);
  });

  for (const width of [1280, 1366, 1440, 1600]) {
    test(`editor controls are visible and usable at ${width}px (canvas still present)`, async ({ page }) => {
      await openThemes(page, width);
      const g = await measure(page);
      console.log(
        `[themefix ${width}] tm-body=${g.bodyW} editor=${g.editorW}@x${g.editorX} ` +
          `canvas=${g.canvasW}@x${g.canvasX} sideBySide=${g.sideBySide}`,
      );

      // 1) the editor column is not collapsed
      expect(g.editorW, `editor column width at ${width}`).toBeGreaterThan(240);
      // 2) its §10.4 controls are really on screen (leaf probe, not the box)
      await expect(page.getByText("Colors — semantic roles")).toBeVisible();
      await expect(page.getByText("Buttons & inputs — the shared size language")).toBeVisible();
      await expect(page.locator("#tm-headline-font")).toBeVisible();
      await expect(page.locator("#tm-adv-toggle")).toBeVisible();
      await expect(page.locator("#tm-delete-theme")).toBeVisible();
      // E6 capture at the TOP of the editor column (before the disclosure
      // click below scrolls it).
      await page.screenshot({ path: `${SHOT_DIR}/themes-editor-${width}.png`, fullPage: false });
      // 3) usable: the Advanced disclosure really opens from this width
      await page.locator("#tm-adv-toggle").click();
      await expect(page.locator("#tm-adv-body")).toBeVisible();
      // 4) the live canvas is still present and visible
      await expect(page.locator(CANVAS)).toBeVisible();
      await expect(page.locator(".tm-canvas-frame")).toBeVisible();
      expect(g.canvasW, `canvas width at ${width}`).toBeGreaterThan(240);
    });
  }

  test("1600: the §8.4 side-by-side anatomy is preserved (controls BESIDE the canvas)", async ({ page }) => {
    await openThemes(page, 1600);
    const g = await measure(page);
    console.log(`[themefix 1600 anatomy] ${JSON.stringify(g)}`);
    expect(g.sideBySide, "canvas beside (not below) the editor at 1600").toBe(true);
    expect(g.canvasW, "canvas keeps its designed 340px at 1600").toBe(340);
    expect(g.editorW, "editor column at 1600").toBeGreaterThan(240);
  });

  // P8 CLOSE SLICE F-A / review D-2 — the owner's own mock width.
  test("1280: the §8.4 anatomy the owner's mock pins — canvas BESIDE the editor, fresh AND with a theme opened", async ({ page }) => {
    await openThemes(page, 1280);
    const fresh = await measure(page);
    console.log(`[themefix 1280 anatomy · fresh] ${JSON.stringify(fresh)}`);
    // FAIL-BEFORE at HEAD 1dbf1783 (driven): editor w304 @y165, canvas w304
    // @y2104 — sameRow false, 1939px below. The pin is "beside the editor".
    expect(fresh.sameRow, "canvas on the SAME row as the editor at 1280").toBe(true);
    expect(fresh.sideBySide, "canvas starts at/after the editor's right edge at 1280").toBe(true);
    expect(fresh.canvasW, "canvas keeps its designed 340px at 1280 (design-pack pin)").toBe(340);
    expect(fresh.editorW, "editor column at its own §8.4 floor at 1280").toBeGreaterThanOrEqual(258);
    // Both §8.4 columns really painted, not merely boxed (E10).
    await expect(page.locator(".tm-canvas-frame")).toBeVisible();
    await expect(page.locator("#tm-headline-font")).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/themes-anatomy-1280-fresh.png`, fullPage: false });

    // …and again after the operator OPENS a theme for edit through the real
    // card link in the list rail (a plain <a href="?theme=…">, ui-theme-
    // manager.ts renderThemeList), which re-renders the whole page.
    const card = page.locator('.tm-body a[href*="theme="]').first();
    await expect(card).toBeVisible();
    await card.click();
    await expect(page.locator(".tm-body")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(CANVAS)).toBeVisible();
    const opened = await measure(page);
    console.log(`[themefix 1280 anatomy · opened for edit] ${JSON.stringify(opened)}`);
    expect(opened.sameRow, "canvas still on the editor's row after opening a theme").toBe(true);
    expect(opened.sideBySide, "still side-by-side after opening a theme").toBe(true);
    expect(opened.canvasW, "canvas still 340px after opening a theme").toBe(340);
    expect(opened.editorW, "editor still at/above its floor after opening a theme").toBeGreaterThanOrEqual(258);
    await page.screenshot({ path: `${SHOT_DIR}/themes-anatomy-1280-opened.png`, fullPage: false });

    // The two pinned rails are untouched by the fix ("rail widths (300/320)
    // are kept exactly as built" — design-pack header).
    const rails = await page.evaluate(() => {
      const body = document.querySelector(".tm-body");
      const kids = Array.from(body === null ? [] : body.children);
      return kids.map((k) => Math.round(k.getBoundingClientRect().width));
    });
    console.log(`[themefix 1280 rails] ${JSON.stringify(rails)}`);
    expect(rails[0], "left list rail stays 300px").toBe(300);
    expect(rails[2], "right A/B rail stays 320px").toBe(320);
  });

  test("375: no horizontal overflow on the themes manager", async ({ page }) => {
    await openThemes(page, 375);
    const m = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    console.log(`[themefix 375] scrollWidth=${m.scrollWidth} innerWidth=${m.innerWidth}`);
    await page.screenshot({ path: `${SHOT_DIR}/themes-editor-375.png`, fullPage: false });
    expect(m.scrollWidth).toBeLessThanOrEqual(m.innerWidth);
  });
});
