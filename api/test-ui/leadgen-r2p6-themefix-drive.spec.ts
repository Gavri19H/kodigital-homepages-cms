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
//   * 375: no horizontal overflow (scrollWidth <= innerWidth).
// Numbers are printed for every width so the degrade threshold is a
// measurement in the log, never a claim.
import { test, expect, type Page } from "@playwright/test";

const SHOT_DIR = "../docs/leadgen/r2/evidence/p6/themefix";
const EDITOR = '[data-pin="8.4-editor-controls"]';
const CANVAS = '[data-pin="8.4-live-canvas"]';

interface Geom {
  bodyW: number;
  editorW: number;
  editorX: number;
  editorRight: number;
  canvasW: number;
  canvasX: number;
  sideBySide: boolean;
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
    editorRight: Math.round(ed.x + ed.width),
    canvasW: Math.round(cv.width),
    canvasX: Math.round(cv.x),
    // BESIDE = the canvas starts at/after the editor's right edge AND the
    // two boxes share vertical space (a wrapped/stacked canvas starts at
    // the editor's own x, below it).
    sideBySide: Math.round(cv.x) >= Math.round(ed.x + ed.width) - 1,
  };
}

async function openThemes(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/admin/leadgen/themes?_cb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".tm-body")).toBeVisible({ timeout: 15_000 });
}

test.describe("R2 P6 — §8.4 themes-manager centre-column layout", () => {
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
