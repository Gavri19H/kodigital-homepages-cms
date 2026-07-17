// Listicles Phase 6 — §30.8/§31.1 visual regression, HONEST SCOPE:
//
//   (a) computed-style EXACT assertions keyed on tokens.ts + the DEV-13
//       measured drift (SINGLE SOURCE — §31.1's written literals are stale
//       per the drift register; the conductor's decision is that the
//       2026-07-03 live measurements win), across header / Disclosure /
//       title / byline / hero / body / buttons / links / legal / footer at
//       1014×857 AND 390×844 on a seeded fixture that mirrors the reference
//       STRUCTURE (two-line title, hero, 6 sections, 6/2/4/4/–/3 groups,
//       neutral OUR-OWN copy).
//   (b) full-page screenshot SELF-baseline: the first run writes
//       api/test-ui/__screenshots__/<name>.png and logs it; later runs
//       pixel-diff against it (desktop ≤0.10%, mobile ≤0.15% changed pixels
//       — §31.1 thresholds) via an in-browser canvas diff (no new deps).
//   (c) side-by-side evidence pack: our fixture renders are saved next to
//       copies of the reference captures under
//       test-artifacts/listicles-render/ for HUMAN comparison.
//       DECLARED HUMAN STEP: pixel-diffing OUR fixture content against THEIR
//       page is not meaningful cross-content — conformance to the MEASURED
//       values is what §31.1's computed-style list pins (part (a)); the pack
//       exists so a human can judge layout parity by eye.

import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";
import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
import { defaultListicleLayoutTokens } from "../src/public/listicle/layouts/default/tokens";
import {
  DRIFT_OVERRIDES_2026_07_03,
  DISCLOSURE_PANEL_STYLE,
  SECTION_DIVIDER,
  HEADING_NUMBER_BADGE,
  FOOTER_MEASURED,
} from "../src/public/listicle/layouts/default/measured-values";
import { seedPublishedListicle, type SeededListicle } from "./listicles-p6-seed";
import { PW_PORT } from "./utils/base-url";

test.use({
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
});

const T = defaultListicleLayoutTokens;
const D = DRIFT_OVERRIDES_2026_07_03;
const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
const BASELINE_DIR = join(SPEC_DIR, "__screenshots__");
const EVIDENCE_DIR = "test-artifacts/listicles-render";
const REFERENCE_DIR = join(SPEC_DIR, "..", "..", "docs", "listicles");

function hexToRgb(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgb(${r}, ${g}, ${b})`;
}

async function computed(page: Page, selector: string, prop: string): Promise<string> {
  return page.locator(selector).first().evaluate(
    (el, cssProp) => getComputedStyle(el).getPropertyValue(cssProp as string).trim(),
    prop,
  );
}

let seeded: SeededListicle;

test.beforeAll(async () => {
  mkdirSync(BASELINE_DIR, { recursive: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seeded = await seedPublishedListicle(ctx, { hostPrefix: "lst-p6-visual", slug: "p6-visual" });
  await ctx.dispose();
});

function url(): string {
  return `http://${seeded.host}:${PW_PORT}/${seeded.slug}`;
}

// One row of the computed-style table: [selector, css property, expected,
// human note naming the token source].
type StyleRow = [string, string, string, string];

// Shared rows (identical at both capture viewports — both are <1024px).
function sharedRows(): StyleRow[] {
  const v = (entry: { values: Record<string, string> }, key: string): string => entry.values[key]!;
  return [
    // Header (drift: live #e0072b, no border, 16px padding-x; token height).
    [".lst-header", "height", T.header.height, "tokens.header.height"],
    [".lst-header", "background-color", hexToRgb(v(D.headerBackground!, "backgroundColor")), "drift headerBackground"],
    [".lst-header", "border-bottom-width", "0px", "drift headerBorderBottom"],
    [".lst-header", "padding-left", v(D.headerPaddingX!, "paddingX"), "drift headerPaddingX"],
    // HostLogo: h-10 w-auto (drift logoSlot).
    [".lst-logo img", "height", "40px", "drift logoSlot h-10"],
    // Disclosure trigger (12px below 1024px — drift).
    [".lst-disclosure-trigger", "color", hexToRgb(T.disclosureTrigger.color), "tokens.disclosureTrigger.color"],
    [".lst-disclosure-trigger", "font-size", v(D.disclosureTriggerFontSize!, "fontSize"), "drift disclosureTriggerFontSize"],
    [".lst-disclosure-trigger", "line-height", T.disclosureTrigger.lineHeight, "tokens.disclosureTrigger.lineHeight"],
    // Title container + byline (drift byline).
    [".lst-title", "text-align", T.articleHeadline.textAlign, "tokens.articleHeadline.textAlign"],
    [".lst-byline", "display", T.byline.display, "tokens.byline.display"],
    [".lst-byline", "gap", T.byline.gap, "tokens.byline.gap"],
    [".lst-byline", "font-size", v(D.byline!, "fontSize"), "drift byline 12px"],
    [".lst-byline", "line-height", v(D.byline!, "lineHeight"), "drift byline 18px"],
    [".lst-byline", "font-weight", v(D.byline!, "fontWeight"), "drift byline w600"],
    [".lst-byline", "color", hexToRgb(v(D.byline!, "color")), "drift byline #4b5563"],
    [".lst-byline-avatar", "width", v(D.byline!, "avatarSize"), "drift byline avatar 30px"],
    [".lst-byline-avatar", "height", v(D.byline!, "avatarSize"), "drift byline avatar 30px"],
    // Hero (drift radius 8px; token 2:1 cover).
    [".lst-hero img", "border-radius", v(D.hero!, "borderRadius"), "drift hero radius 8px"],
    [".lst-hero img", "object-fit", T.heroImage.objectFit, "tokens.heroImage.objectFit"],
    // Intro + in-section body paragraphs (drift 18/30, intro #333333 / section #2c2c2c, 6px pads).
    [".lst-intro p", "font-size", v(D.bodyParagraph!, "fontSize"), "drift bodyParagraph 18px"],
    [".lst-intro p", "line-height", v(D.bodyParagraph!, "lineHeight"), "drift bodyParagraph 30px"],
    [".lst-intro p", "color", hexToRgb(v(D.bodyParagraph!, "introColor")), "drift intro #333333"],
    [".lst-intro p", "padding-top", v(D.bodyParagraph!, "paddingY"), "drift 6px paddings"],
    [".lst-section p", "color", hexToRgb(v(D.bodyParagraph!, "sectionColor")), "drift in-section #2c2c2c"],
    [".lst-section p", "font-size", v(D.bodyParagraph!, "fontSize"), "drift bodyParagraph 18px"],
    [".lst-section p", "margin-bottom", "0px", "drift margins 0"],
    // Section heading (measured 22.4/29.6 at both capture viewports) + badge.
    [".lst-section h3", "font-size", T.sectionHeading.fontSizeDesktop, "tokens.sectionHeading 22.4px"],
    [".lst-section h3", "line-height", T.sectionHeading.lineHeightDesktop, "tokens.sectionHeading 29.6px"],
    [".lst-section h3", "font-weight", T.sectionHeading.fontWeight, "tokens.sectionHeading w700"],
    [".lst-section h3", "color", hexToRgb(T.sectionHeading.color), "tokens.sectionHeading #2c2c2c"],
    [".lst-heading-badge", "background-color", hexToRgb(HEADING_NUMBER_BADGE.values.backgroundColor!), "measured numberBadge"],
    [".lst-heading-badge", "border-radius", HEADING_NUMBER_BADGE.values.borderRadius!, "measured numberBadge r8"],
    // O3 divider (measured hr rhythm).
    ["hr.lst-divider", "height", SECTION_DIVIDER.values.height!, "measured separator 3px"],
    ["hr.lst-divider", "background-color", hexToRgb(SECTION_DIVIDER.values.color!), "measured separator #e5e7eb"],
    ["hr.lst-divider", "margin-top", SECTION_DIVIDER.values.marginTop!, "measured separator mt 32px"],
    ["hr.lst-divider", "margin-bottom", SECTION_DIVIDER.values.marginBottom!, "measured separator mb 20px"],
    // Section image (measured 16:9, radius 2px).
    [".lst-section .lst-img img", "border-radius", T.sectionImage.borderRadius, "tokens.sectionImage 2px"],
    // Choice buttons (measured #f8020e r8 62px).
    [".lst-choice-btn", "background-color", hexToRgb(T.choiceButton.backgroundColor), "tokens.choiceButton #f8020e"],
    [".lst-choice-btn", "color", hexToRgb(T.choiceButton.color), "tokens.choiceButton #fff"],
    [".lst-choice-btn", "border-radius", T.choiceButton.borderRadius, "tokens.choiceButton r8"],
    [".lst-choice-btn", "font-size", T.choiceButton.fontSize, "tokens.choiceButton 18px"],
    [".lst-choice-btn", "line-height", T.choiceButton.lineHeight, "tokens.choiceButton 28px"],
    [".lst-choice-btn", "font-weight", T.choiceButton.fontWeight, "tokens.choiceButton w700"],
    [".lst-choice-btn", "min-height", T.choiceButton.minHeight, "tokens.choiceButton 62px"],
    [".lst-choice-btn", "border-top-color", hexToRgb(T.choiceButton.borderColor), "tokens.choiceButton border"],
    [".lst-choice-btn", "padding-top", T.choiceButton.paddingY, "tokens.choiceButton pad 10px"],
    [".lst-choice-btn", "padding-left", T.choiceButton.paddingX, "tokens.choiceButton pad 20px"],
    // Inline links (measured blue underlined).
    ['.lst-section a[data-link-role="inline"]', "color", hexToRgb(T.inlineLink.color), "tokens.inlineLink #3b82f6"],
    ['.lst-section a[data-link-role="inline"]', "text-decoration-line", "underline", "tokens.inlineLink underline"],
    // Legal band (measured 16/24 black on white band).
    [".lst-legal", "font-size", T.legalDisclosureBlock.fontSize, "tokens.legalDisclosureBlock 16px"],
    [".lst-legal", "line-height", T.legalDisclosureBlock.lineHeight, "tokens.legalDisclosureBlock 24px"],
    [".lst-legal", "color", hexToRgb(T.legalDisclosureBlock.color), "tokens.legalDisclosureBlock #000"],
    // Footer (measured near-black band).
    [".lst-footer", "background-color", hexToRgb(T.footer.backgroundColor), "tokens.footer #000002"],
    [".lst-footer-nav a", "font-size", T.footer.linkFontSize, "tokens.footer link 14px"],
    [".lst-footer-nav a", "line-height", T.footer.linkLineHeight, "tokens.footer link 20px"],
    [".lst-footer-nav a", "font-weight", T.footer.linkFontWeight, "tokens.footer link w500"],
    [".lst-footer-nav a", "color", hexToRgb(T.footer.linkColor), "tokens.footer link #fff"],
    [".lst-footer-divider", "border-top-color", hexToRgb(FOOTER_MEASURED.values.dividerColor!), "measured footer hr #9ca3af"],
    [".lst-footer-legal", "text-align", FOOTER_MEASURED.values.legalTextAlign!, "measured footer legal justify"],
    [".lst-footer-copyright", "padding-bottom", FOOTER_MEASURED.values.copyrightPaddingBottom!, "measured copyright pb 69px (<1024)"],
  ];
}

async function assertRows(page: Page, rows: StyleRow[]): Promise<void> {
  const failures: string[] = [];
  for (const [selector, prop, expected, source] of rows) {
    const actual = await computed(page, selector, prop);
    if (actual !== expected) {
      failures.push(`${selector} { ${prop} }: expected '${expected}' (${source}), got '${actual}'`);
    }
  }
  expect(failures, `computed-style mismatches:\n${failures.join("\n")}`).toEqual([]);
}

test.describe("§31.1 computed-style EXACT assertions (tokens.ts single source)", () => {
  test("desktop 1014×857", async ({ page }) => {
    await page.setViewportSize({ width: 1014, height: 857 });
    await page.goto(url(), { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);

    await assertRows(page, [
      ...sharedRows(),
      // The measured two-line heading pattern at desktop: 36px/40px + 4px py
      // (drift register `headline`).
      [".lst-title .lst-title-line", "font-size", D.headline!.values.fontSize!, "drift headline 36px"],
      [".lst-title .lst-title-line", "line-height", D.headline!.values.lineHeight!, "drift headline 40px"],
      [".lst-title .lst-title-line", "padding-top", D.headline!.values.paddingY!, "drift headline +4px py"],
      [".lst-title .lst-title-line", "margin-top", "0px", "drift headline m0"],
    ]);

    // Page font: the live Inter stack (Arial-metric fallback) on the scope.
    const fontFamily = await computed(page, 'body[data-layout="default"]', "font-family");
    expect(fontFamily).toContain("Inter");

    // Hero 2:1 box geometry (aspect-ratio computed as width/height).
    const hero = await page.locator(".lst-hero img").boundingBox();
    expect(hero).toBeTruthy();
    expect(Math.abs(hero!.width / hero!.height - 2)).toBeLessThan(0.02);

    // Measured grid columns: the 6-button group is 1 column below 1024px;
    // 2- and 4-button groups are 2 columns.
    const cols6 = await computed(page, '.lst-choice-group[data-lst-cols="auto"]', "grid-template-columns");
    expect(cols6.split(" ").length).toBe(1);
    const cols2 = await computed(page, '.lst-choice-group[data-lst-cols="2"]', "grid-template-columns");
    expect(cols2.split(" ").length).toBe(2);

    // Disclosure panel (opened) — the measured dropdown box.
    await page.locator(".lst-disclosure-trigger").click();
    await assertRows(page, [
      [".lst-disclosure-panel", "width", DISCLOSURE_PANEL_STYLE.width, "measured panel 288px"],
      [".lst-disclosure-panel", "background-color", hexToRgb(DISCLOSURE_PANEL_STYLE.backgroundColor), "measured panel #fff"],
      [".lst-disclosure-panel", "border-radius", DISCLOSURE_PANEL_STYLE.borderRadius, "measured panel r4"],
      [".lst-disclosure-panel", "padding-top", DISCLOSURE_PANEL_STYLE.padding, "measured panel pad 16px"],
      [".lst-disclosure-panel", "font-size", DISCLOSURE_PANEL_STYLE.fontSize, "measured panel 16px"],
      [".lst-disclosure-panel", "line-height", DISCLOSURE_PANEL_STYLE.lineHeight, "measured panel 24px"],
      [".lst-disclosure-panel", "position", "absolute", "measured panel absolute below trigger"],
    ]);
    await page.screenshot({ path: `${EVIDENCE_DIR}/fixture-desktop-disclosure-open.png` });
  });

  test("mobile 390×844", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url(), { waitUntil: "domcontentloaded" });
    await page.evaluate(() => document.fonts.ready);

    await assertRows(page, [
      ...sharedRows(),
      // Mobile headline variant: 24px/32px + 4px py (tokens *Mobile fields,
      // measured 2026-07-03).
      [".lst-title .lst-title-line", "font-size", T.articleHeadline.fontSizeMobile, "tokens.articleHeadline mobile 24px"],
      [".lst-title .lst-title-line", "line-height", T.articleHeadline.lineHeightMobile, "tokens.articleHeadline mobile 32px"],
      [".lst-title .lst-title-line", "padding-top", D.headline!.values.paddingY!, "drift headline +4px py"],
    ]);

    // Logo does NOT downscale at 390px (measured logoSlot mobile note).
    const logoH = await computed(page, ".lst-logo img", "height");
    expect(logoH).toBe("40px");

    // Grid columns at 390: 6-button group 1 col; 2/4-button groups 2 cols.
    const cols6 = await computed(page, '.lst-choice-group[data-lst-cols="auto"]', "grid-template-columns");
    expect(cols6.split(" ").length).toBe(1);
    const cols2 = await computed(page, '.lst-choice-group[data-lst-cols="2"]', "grid-template-columns");
    expect(cols2.split(" ").length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// (b) full-page screenshot SELF-baseline (§31.1 thresholds) — in-browser
// canvas pixel diff, no external deps. First run writes the baseline.
// ---------------------------------------------------------------------------

async function pixelDiffRatio(page: Page, aPng: Buffer, bPng: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      function load(src: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = src;
        });
      }
      const ia = await load(`data:image/png;base64,${a}`);
      const ib = await load(`data:image/png;base64,${b}`);
      if (ia.width !== ib.width || ia.height !== ib.height) return 1;
      const draw = (img: HTMLImageElement): ImageData => {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx2d = canvas.getContext("2d")!;
        ctx2d.drawImage(img, 0, 0);
        return ctx2d.getImageData(0, 0, img.width, img.height);
      };
      const da = draw(ia).data;
      const db = draw(ib).data;
      let diff = 0;
      const total = ia.width * ia.height;
      // A pixel "changed" when any channel differs beyond a small
      // anti-aliasing tolerance (mirrors misMatchThreshold semantics).
      for (let i = 0; i < da.length; i += 4) {
        if (
          Math.abs(da[i]! - db[i]!) > 8 ||
          Math.abs(da[i + 1]! - db[i + 1]!) > 8 ||
          Math.abs(da[i + 2]! - db[i + 2]!) > 8
        ) {
          diff += 1;
        }
      }
      return diff / total;
    },
    [aPng.toString("base64"), bPng.toString("base64")] as const,
  );
}

async function selfBaseline(
  page: Page,
  name: string,
  viewport: { width: number; height: number },
  maxRatio: number,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(url(), { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200); // §31.1 settle
  const shot = await page.screenshot({ fullPage: true });
  const baselinePath = join(BASELINE_DIR, `${name}.png`);
  // Evidence copy on every run.
  writeFileSync(join(EVIDENCE_DIR, `${name}.png`), shot);
  if (!existsSync(baselinePath)) {
    writeFileSync(baselinePath, shot);
    console.log(`[visual-baseline] first run — baseline written: ${baselinePath}`);
    return;
  }
  const baseline = readFileSync(baselinePath);
  const ratio = await pixelDiffRatio(page, baseline, shot);
  console.log(`[visual-baseline] ${name}: changed-pixel ratio=${ratio}`);
  expect(ratio, `${name} changed-pixel ratio ${ratio} exceeds ${maxRatio}`).toBeLessThanOrEqual(maxRatio);
}

test.describe("§31.1 screenshot self-baseline", () => {
  test("desktop full-page ≤0.10% changed pixels", async ({ page }) => {
    await selfBaseline(page, "listicle-fixture-desktop", { width: 1014, height: 857 }, 0.001);
  });

  test("mobile full-page ≤0.15% changed pixels", async ({ page }) => {
    await selfBaseline(page, "listicle-fixture-mobile", { width: 390, height: 844 }, 0.0015);
  });
});

// ---------------------------------------------------------------------------
// (c) side-by-side evidence pack (HUMAN comparison step declared above)
// ---------------------------------------------------------------------------

test("evidence pack: fixture renders sit next to the reference captures", async ({ page }) => {
  await page.setViewportSize({ width: 1014, height: 857 });
  await page.goto(url(), { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${EVIDENCE_DIR}/fixture-desktop-full.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${EVIDENCE_DIR}/fixture-mobile-full.png`, fullPage: true });

  // Copy the reference captures next to ours for the human pass.
  for (const file of [
    "reference-desktop.png",
    "reference-mobile.png",
    "reference-desktop-disclosure-open.png",
    "reference-desktop-sections.png",
    "reference-desktop-footer.png",
  ]) {
    const source = join(REFERENCE_DIR, file);
    if (existsSync(source)) copyFileSync(source, join(EVIDENCE_DIR, file));
  }
  expect(existsSync(join(EVIDENCE_DIR, "fixture-desktop-full.png"))).toBe(true);
  expect(existsSync(join(EVIDENCE_DIR, "reference-desktop.png"))).toBe(true);
});
