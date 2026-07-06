// LeadGen Phase 5 Stage C — contract 05 §14.10 VISUAL + COMPUTED-STYLE
// acceptance suite. Mirrors the Listicles visual suite discipline
// (listicles-visual.spec.ts): computed-style EXACT assertions keyed on the
// authoritative Stage-A tokens (designs/default-funnel/tokens.ts) + the
// MEASURED reference JSON, a full-page screenshot SELF-baseline with an
// in-browser canvas pixel diff (no new deps), gated on document.fonts.ready.
//
// RENDER SURFACE (reported as a deviation-free choice): the REAL Stage-B
// server-render endpoint POST /api/admin/leadgen/sections/preview
// (previewSectionHandler → renderSectionComponents + funnelChromeCss). Its
// JSON { preview: { css, desktop, mobile } } is composed into a top-level
// document EXACTLY as the editor's sandboxed preview iframe does
// (`<style>${css}</style>${html}` — ui-question-builder.ts), then loaded via
// page.setContent. This exercises the true server render + the true editor
// composition, is fully deterministic (no web-font network — the same as the
// editor iframe, which loads no fonts), and needs NO new route (P7 owns the
// public runtime). The default funnel design uses system-fallback fonts here
// exactly as the CMS preview does; the font-family COMPUTED value is still the
// declared 'Literata'/'Sora' stack (asserted), and fonts.ready is a no-op gate
// that keeps the screenshot discipline identical to listicles.
//
// KEY GUARANTEE proven by this suite: the §14.4/§14.6 interaction STATE colours
// (icon-card + answer-button SELECTED navy border+wash, answer-button :hover wash
// NOT navy fill, Continue :hover darken) APPLY at the element level. The
// per-instance inline `border`/`background` that used to outrank the scoped chrome
// state rules (styles.ts, no !important) has been removed from every stateful
// preset (presets.ts) — including the §13.2 answer buttons; the base border/
// background now lives ONLY in the scoped chrome CSS, so the state rules win by
// cascade. This suite proves it with real computed style: the seeded SELECTED
// icon card AND the seeded SELECTED TwoButtonYesNo button both compute to navy
// #1B3A5C border + #E8EEF4 wash (was defeated to #D2D9E5 / #FFFFFF before the
// fix), an answer-button :hover settles to the #F2F6FA wash (never the navy fill
// #0F2440), the real Continue :hover darkens to #0F2440, and a bare CONTROL
// element agrees. NO banned legacy identifiers anywhere.

import { test, expect, request as playwrightRequest, type Page, type APIRequestContext } from "@playwright/test";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { seedVisualSection, buildVisualSectionContent, type SeededVisualSection } from "./leadgen-p5-seed";

const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const ORIGIN = "http://127.0.0.1:8787";
const BASELINE_DIR = join(SPEC_DIR, "__screenshots__");
const EVIDENCE_DIR = "test-artifacts/leadgen-visual";

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

// The seeded Section's server-rendered preview (css + both viewport fragments).
interface Preview {
  css: string;
  desktop: string;
  mobile: string;
}
let seeded: SeededVisualSection;
let preview: Preview;

async function fetchPreview(ctx: APIRequestContext, content: unknown): Promise<Preview> {
  const res = await ctx.post("/api/admin/leadgen/sections/preview", { data: { content_json: content } });
  if (!res.ok()) throw new Error(`preview HTTP ${res.status()}: ${await res.text()}`);
  const body = (await res.json()) as { preview: Preview };
  return body.preview;
}

// Compose the EXACT editor-iframe document: <style>${css}</style> + fragment.
function buildDoc(css: string, fragment: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<style>${css}</style></head><body>${fragment}</body></html>`
  );
}

async function renderViewport(
  page: Page,
  viewport: "desktop" | "mobile",
  size: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(size);
  await page.setContent(buildDoc(preview.css, viewport === "desktop" ? preview.desktop : preview.mobile), {
    waitUntil: "domcontentloaded",
  });
  // Fonts.ready gate (discipline parity with listicles; no-op here since the
  // CMS preview declares no web fonts — the font-family COMPUTED value is the
  // declared stack regardless).
  await page.evaluate(() => document.fonts.ready);
}

test.beforeAll(async () => {
  mkdirSync(BASELINE_DIR, { recursive: true });
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seeded = await seedVisualSection(ctx, Date.now());
  preview = await fetchPreview(ctx, seeded.content);
  await ctx.dispose();
});

// One row of the computed-style table: [selector, css property, expected,
// human note naming the tokens.ts / reference-JSON source].
type StyleRow = [string, string, string, string];

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

// Rows identical at BOTH capture viewports (colours/sizes that don't respond).
// Every expected value is the tokens.ts value the render actually produces;
// the source note cites tokens.ts + whether the MEASURED reference JSON agrees.
function sharedRows(): StyleRow[] {
  return [
    // Header — bg + the padding that sizes it (no fixed height token: the
    // discarded §14.2 example's 64px is discarded; the measured header is
    // white + padding-sized + sticky).
    [".lg-header", "background-color", hexToRgb("#FFFFFF"), "tokens.header.backgroundColor / ref-JSON header.backgroundColor #FFFFFF"],
    [".lg-header", "padding-top", "16px", "tokens.header.paddingY 1rem / ref-JSON header.paddingY 16px"],
    [".lg-header", "padding-left", "24px", "tokens.header.paddingX 1.5rem / ref-JSON header.paddingX 24px"],
    [".lg-header", "position", "sticky", "tokens.header.position / ref-JSON header.sticky"],
    // Logo (Literata display, navy, 700; accent orange).
    [".lg-logo", "font-size", "17.6px", "tokens.header.logoFontSize 1.1rem / ref-JSON header.logo.fontSize 17.6px"],
    [".lg-logo", "font-weight", "700", "tokens.header.logoFontWeight / ref-JSON header.logo.fontWeight"],
    [".lg-logo", "color", hexToRgb("#1B3A5C"), "tokens.header.logoColor / ref-JSON header.logo.color navy"],
    [".lg-logo-accent", "color", hexToRgb("#E85D26"), "tokens.header.logoAccentColor / ref-JSON header.logo.accentSpanColor orange"],
    // Progress bar — track + fill height/radius/track colour.
    [".lg-progress-track", "height", "8px", "tokens.progress.height / ref-JSON progress.height 8px"],
    [".lg-progress-track", "background-color", hexToRgb("#E8EEF4"), "tokens.progress.trackColor / ref-JSON progress.trackColor #E8EEF4"],
    [".lg-progress-track", "border-radius", "9999px", "tokens.progress.borderRadius / ref-JSON progress.borderRadius 9999px"],
    [".lg-progress-fill", "border-radius", "9999px", "tokens.progress.borderRadius pill fill"],
    // Category label — ACCENT ORANGE (NOT the discarded green #1f9d57).
    [".lg-category", "color", hexToRgb("#E85D26"), "tokens.categoryLabel.color accent-orange (§14.2 note; screenshot green DISCARDED)"],
    [".lg-category", "text-transform", "uppercase", "tokens.categoryLabel.textTransform"],
    [".lg-category", "letter-spacing", "2px", "tokens.categoryLabel.letterSpacing"],
    [".lg-category", "font-weight", "700", "tokens.categoryLabel.fontWeight"],
    [".lg-category", "font-size", "13px", "tokens.categoryLabel.fontSize 0.8125rem"],
    // Headline — 700 / navy-ink / centered (font-size is viewport-specific).
    [".lg-headline", "font-weight", "700", "tokens.headline.fontWeight / ref-JSON headline.fontWeight"],
    [".lg-headline", "color", hexToRgb("#1A1F36"), "tokens.headline.color / ref-JSON headline.color #1A1F36"],
    [".lg-headline", "text-align", "center", "tokens.headline.textAlign / ref-JSON headline.textAlign"],
    // Subheadline.
    [".lg-subheadline", "font-size", "13.2px", "tokens.subheadline.fontSize 0.825rem / ref-JSON subheadline.fontSize 13.2px"],
    [".lg-subheadline", "color", hexToRgb("#4A5568"), "tokens.subheadline.color / ref-JSON subheadline.color #4A5568"],
    // Icon card — BASE border / radius / bg / min-height / shadow.
    [".lg-card", "border-top-width", "2px", "tokens.iconCard.border 2px / ref-JSON iconCard.border 2px"],
    [".lg-card", "border-top-style", "solid", "tokens.iconCard.border solid"],
    [".lg-card", "border-top-color", hexToRgb("#D2D9E5"), "tokens.iconCard.border #D2D9E5 / ref-JSON iconCard.border #D2D9E5"],
    [".lg-card", "border-radius", "10px", "tokens.iconCard.borderRadius / ref-JSON iconCard.borderRadius 10px"],
    [".lg-card", "background-color", hexToRgb("#FFFFFF"), "tokens.iconCard.background / ref-JSON iconCard.background #FFFFFF"],
    [".lg-card", "min-height", "96px", "tokens.iconCard.minHeight 96px (§14.4 taller-card; DIVERGES from ref-JSON measured 48px — see report)"],
    [".lg-card", "box-shadow", "none", "tokens.iconCard has NO shadow token — the measured card is flat (§14.2 shadow lives on header/content card)"],
    // Icon card title + icon.
    [".lg-card-title", "font-size", "16px", "tokens.iconCard.titleFontSize 1rem (§14.4 title ~16px; ref-JSON card fontSize 14px — see report)"],
    [".lg-card-title", "font-weight", "700", "tokens.iconCard.titleFontWeight (§14.4 title 700; ref-JSON fontWeight 500 — see report)"],
    [".lg-card-title", "color", hexToRgb("#1A1F36"), "tokens.iconCard.titleColor #1A1F36"],
    [".lg-card-icon", "color", hexToRgb("#1B3A5C"), "tokens.iconCard.iconColor navy (§14.4/audit icons navy; screenshot green DISCARDED)"],
    [".lg-card-icon", "font-size", "32px", "tokens.iconCard.iconSize 32px"],
    // Currency range — track colours + track height + navy fill (NOT green).
    [".lg-range-track", "background-color", hexToRgb("#E8EEF4"), "tokens.rangeQuestion.unfilledTrackColor #E8EEF4 (§14.5; screenshot #d7dbe2 DISCARDED)"],
    [".lg-range-track", "height", "8px", "tokens.rangeQuestion.trackHeight 8px (§14.5)"],
    [".lg-range-track", "border-radius", "9999px", "tokens.rangeQuestion.trackRadius pill (§14.5)"],
    [".lg-range-fill", "background-color", hexToRgb("#1B3A5C"), "tokens.rangeQuestion.filledTrackColor navy #1B3A5C (§14.5; screenshot green #1f9d57 DISCARDED)"],
    [".lg-range-value", "color", hexToRgb("#1A1F36"), "tokens.rangeQuestion.valueColor #1A1F36 (§14.5)"],
    // Continue — navy pill (NOT blue), white text, radius, min-height, size.
    [".lg-continue", "background-color", hexToRgb("#1B3A5C"), "tokens.primaryButton.background navy (§14.6 NOT blue; screenshot #2a6fdb DISCARDED)"],
    [".lg-continue", "color", hexToRgb("#FFFFFF"), "tokens.primaryButton.color / ref-JSON primaryButton.color #FFFFFF"],
    [".lg-continue", "border-radius", "10px", "tokens.primaryButton.borderRadius / ref-JSON primaryButton.borderRadius 10px"],
    [".lg-continue", "min-height", "52px", "tokens.primaryButton.minHeight / ref-JSON primaryButton.minHeight 52px"],
    [".lg-continue", "max-width", "320px", "tokens.primaryButton.maxWidth / ref-JSON primaryButton.maxWidth 320px"],
    [".lg-continue", "font-size", "15px", "tokens.primaryButton.fontSize 0.9375rem / ref-JSON primaryButton.fontSize 15px"],
    [".lg-continue", "font-weight", "600", "tokens.primaryButton.fontWeight / ref-JSON primaryButton.fontWeight 600"],
    // Reassurance badge — green outline + icon + text, pale-navy bg, radius.
    [".lg-badge", "border-top-width", "1px", "tokens.reassuranceBadge.border 1px (§14.7)"],
    [".lg-badge", "border-top-color", hexToRgb("#0E7C3A"), "tokens.reassuranceBadge.border success-green #0E7C3A (§14.7; screenshot #1f9d57 DISCARDED)"],
    [".lg-badge", "background-color", hexToRgb("#F2F6FA"), "tokens.reassuranceBadge.background #F2F6FA (§14.7; screenshot #eaf7ef DISCARDED)"],
    [".lg-badge", "border-radius", "10px", "tokens.reassuranceBadge.borderRadius 10px (§14.7)"],
    [".lg-badge", "color", hexToRgb("#0E7C3A"), "tokens.reassuranceBadge.textColor #0E7C3A (§14.7)"],
    [".lg-badge-icon", "color", hexToRgb("#0E7C3A"), "tokens.reassuranceBadge.iconColor #0E7C3A (§14.7)"],
    // Free-text PII input (§14.2 input tokens).
    ['[data-component-type="FreeTextQuestion"]', "border-top-color", hexToRgb("#D2D9E5"), "tokens.input.border #D2D9E5 / ref-JSON input.border"],
    ['[data-component-type="FreeTextQuestion"]', "border-radius", "10px", "tokens.input.borderRadius / ref-JSON input.borderRadius 10px"],
    ['[data-component-type="FreeTextQuestion"]', "font-size", "16px", "tokens.input.fontSize 1rem / ref-JSON input.fontSize 16px"],
  ];
}

// The Literata display family + the navy progress gradient are "contains"
// checks (font-family + gradient serialise with extra tokens), asserted
// separately from the exact-equality table.
async function assertContainsAndGradient(page: Page): Promise<void> {
  const headlineFamily = await computed(page, ".lg-headline", "font-family");
  expect(headlineFamily, "headline is the Literata display family (tokens.headline.fontFamily)").toContain("Literata");
  const logoFamily = await computed(page, ".lg-logo", "font-family");
  expect(logoFamily, "logo is Literata (tokens.header.logoFontFamily)").toContain("Literata");
  const rangeValueFamily = await computed(page, ".lg-range-value", "font-family");
  expect(rangeValueFamily, "range value is Literata (tokens.rangeQuestion.valueFontFamily)").toContain("Literata");
  const bodyFamily = await computed(page, '[data-funnel-design="default-funnel"]', "font-family");
  expect(bodyFamily, "funnel body is the Sora stack (tokens.page.fontFamily)").toContain("Sora");

  // Navy gradient progress fill (NOT solid green): both navy stops present.
  const fill = await computed(page, ".lg-progress-fill", "background-image");
  expect(fill, "progress fill is a linear-gradient").toContain("linear-gradient");
  expect(fill, "progress gradient stop 1 = navy #1B3A5C").toContain("rgb(27, 58, 92)");
  expect(fill, "progress gradient stop 2 = light-navy #2A5080").toContain("rgb(42, 80, 128)");

  // Header shadow (navy-tinted shadow-sm).
  const headerShadow = await computed(page, ".lg-header", "box-shadow");
  expect(headerShadow, "header carries the navy shadow-sm").toContain("rgba(27, 58, 92, 0.06)");
}

test.describe("§14.10(b) computed-style EXACT assertions (tokens.ts + measured reference JSON)", () => {
  test("desktop ≥640 (1280×900)", async ({ page }) => {
    await renderViewport(page, "desktop", { width: 1280, height: 900 });

    await assertRows(page, [
      ...sharedRows(),
      // Desktop headline size (tokens.headline.fontSizeDesktop 1.75rem = 28px).
      [".lg-headline", "font-size", "28px", "tokens.headline.fontSizeDesktop 1.75rem / ref-JSON headline.fontSizeDesktop 28px"],
    ]);
    await assertContainsAndGradient(page);

    // Icon-card grid = 3 columns at desktop (tokens.iconCardGrid.columnsDesktop
    // via --lg-cols:3), multi-choice grid = 2 columns.
    const iconCols = await computed(page, ".lg-card-grid:not(.lg-multi)", "grid-template-columns");
    expect(iconCols.split(" ").length, `icon-card grid is 3 columns at desktop (got '${iconCols}')`).toBe(3);
    const multiCols = await computed(page, ".lg-card-grid.lg-multi", "grid-template-columns");
    expect(multiCols.split(" ").length, `multi-choice grid is 2 columns at desktop (got '${multiCols}')`).toBe(2);

    // Range currency value renders "$330,000" (§14.5).
    const rangeValue = await page.locator(".lg-range-value").textContent();
    expect(rangeValue, "§14.5 currency range value").toBe("$330,000");

    // Range slider thumb size — 28px. NOTE: getComputedStyle on
    // ::-webkit-slider-thumb is unreliable in Chromium (returns the host
    // input width), so the thumb size is asserted from the APPLIED stylesheet
    // rule (the tokens.rangeQuestion.thumbSize value the chrome CSS emits).
    const thumbWidth = await readRuleLength(page, "-webkit-slider-thumb", "width");
    expect(thumbWidth, "range thumb width = tokens.rangeQuestion.thumbSize 28px (§14.5)").toBe("28px");
    const thumbHeight = await readRuleLength(page, "-webkit-slider-thumb", "height");
    expect(thumbHeight, "range thumb height = 28px (§14.5)").toBe("28px");

    await page.screenshot({ path: `${EVIDENCE_DIR}/computed-desktop.png`, fullPage: true });
  });

  test("mobile ≤480 (375×800)", async ({ page }) => {
    await renderViewport(page, "mobile", { width: 375, height: 800 });

    await assertRows(page, [
      ...sharedRows(),
      // Mobile headline size (tokens.headline.fontSizeMobile 1.375rem = 22px).
      [".lg-headline", "font-size", "22px", "tokens.headline.fontSizeMobile 1.375rem / ref-JSON mobile headline.fontSizeMobile 22px"],
    ]);
    await assertContainsAndGradient(page);

    // Card grids collapse to 1 column at ≤480 (styles.ts mobile media query).
    const iconCols = await computed(page, ".lg-card-grid:not(.lg-multi)", "grid-template-columns");
    expect(iconCols.split(" ").length, `icon-card grid collapses to 1 column on mobile (got '${iconCols}')`).toBe(1);

    await page.screenshot({ path: `${EVIDENCE_DIR}/computed-mobile.png`, fullPage: true });
  });
});

// Read a length from the FIRST applied stylesheet rule whose selector contains
// `selectorSubstr` (used for the ::-webkit-slider-thumb width/height, which the
// pseudo-element getComputedStyle path reports unreliably in Chromium). Lengths
// serialise cleanly ("28px"), so this is a stable read of the applied token.
async function readRuleLength(page: Page, selectorSubstr: string, prop: string): Promise<string> {
  return page.evaluate(
    ([sub, p]) => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRule[];
        try {
          rules = Array.from(sheet.cssRules);
        } catch {
          continue;
        }
        for (const rule of rules) {
          const styleRule = rule as CSSStyleRule;
          if (styleRule.selectorText && styleRule.selectorText.indexOf(sub) >= 0) {
            const v = styleRule.style.getPropertyValue(p).trim();
            if (v !== "") return v;
          }
        }
      }
      return "";
    },
    [selectorSubstr, prop] as const,
  );
}

// ---------------------------------------------------------------------------
// §14.10(b) interaction states — selected / hover / disabled.
//
// Proves the fix: the §14.4/§14.6 state rules APPLY on the SEEDED elements —
// the selected icon card computes to navy border #1B3A5C + wash bg #E8EEF4 (+
// weight 700), the real Continue :hover darkens to #0F2440, disabled opacity
// →0.6 — because the per-instance inline border/background was removed from the
// presets. A bare CONTROL element (never had inline) computes identically,
// confirming the design tokens themselves are correct.
// ---------------------------------------------------------------------------

test.describe("§14.10(b) interaction states (selected / hover / disabled)", () => {
  test("seeded elements + bare control elements", async ({ page }) => {
    await renderViewport(page, "desktop", { width: 1280, height: 900 });

    // (1a) SELECTED on the seeded first icon card now computes to the §14.4
    // navy border #1B3A5C + wash bg #E8EEF4 (+ weight 700) — the per-instance
    // inline base border/background is GONE, so the chrome [aria-checked] state
    // rule wins by cascade (the fix; before, it stayed #D2D9E5 / #FFFFFF). Set
    // the attribute, wait out the 150ms border-color/background transition
    // (tokens.transitions.cardHoverMs), THEN read the settled computed style
    // (a synchronous read would catch the transition's #D2D9E5/#FFFFFF START).
    await page.locator(".lg-card").first().evaluate((el) => el.setAttribute("aria-checked", "true"));
    await page.waitForTimeout(300); // > tokens.transitions.cardHoverMs (150ms)
    const seededSelected = await page.locator(".lg-card").first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        fontWeight: cs.fontWeight,
        borderTopColor: cs.borderTopColor,
        backgroundColor: cs.backgroundColor,
      };
    });
    expect(seededSelected.fontWeight, "selected card font-weight → 700 (chrome state rule)").toBe("700");
    expect(
      seededSelected.borderTopColor,
      "§14.4 selected navy border #1B3A5C now APPLIES on the seeded card (defect fixed)",
    ).toBe(hexToRgb("#1B3A5C"));
    expect(
      seededSelected.backgroundColor,
      "§14.4 selected wash bg #E8EEF4 now APPLIES on the seeded card (defect fixed)",
    ).toBe(hexToRgb("#E8EEF4"));

    // (1b) Continue disabled: opacity → 0.6 (chrome state rule; not inline).
    const disabledOpacity = await page.locator(".lg-continue").evaluate((el) => {
      el.setAttribute("aria-disabled", "true");
      return getComputedStyle(el).opacity;
    });
    expect(disabledOpacity, "disabled Continue opacity → 0.6 (tokens.primaryButton.disabledOpacity)").toBe("0.6");
    await page.locator(".lg-continue").evaluate((el) => el.removeAttribute("aria-disabled"));

    // (2) BARE CONTROL card (never had inline border/background) computes to the
    // SAME navy selected tokens as the seeded card in (1a) — confirming the fix
    // is complete and the design tokens themselves are correct.
    const control = await page.evaluate(() => {
      const scope = document.querySelector('[data-funnel-design="default-funnel"] .lg-content') as HTMLElement;
      const card = document.createElement("button");
      card.className = "lg-card";
      card.setAttribute("aria-checked", "true");
      card.id = "__ctl_card";
      scope.appendChild(card);
      const c = getComputedStyle(card);
      return { cardBorder: c.borderTopColor, cardBg: c.backgroundColor, cardWeight: c.fontWeight };
    });
    expect(control.cardBorder, "CONTROL: chrome .lg-card[aria-checked] renders navy border #1B3A5C").toBe(hexToRgb("#1B3A5C"));
    expect(control.cardBg, "CONTROL: chrome selected wash bg #E8EEF4").toBe(hexToRgb("#E8EEF4"));
    expect(control.cardWeight, "CONTROL: selected font-weight 700").toBe("700");

    // (3) Continue :hover now DARKENS on the REAL seeded element (defect fixed):
    // the inline background is gone, so the chrome .lg-btn:hover navy-dark
    // #0F2440 wins by cascade. Proven by a real hover computed-style read (after
    // the background transition settles) AND the deterministic CSSOM rule read.
    await page.locator(".lg-continue").hover();
    await page.waitForTimeout(300); // > tokens.transitions.btnHoverMs (200ms) — let the transition settle
    const hoverBg = await computed(page, ".lg-continue", "background-color");
    expect(
      hoverBg,
      "§14.6 Continue :hover darkens to navy-dark #0F2440 on the real element (chrome .lg-btn:hover applies)",
    ).toBe(hexToRgb("#0F2440"));
    const hoverBgRule = await readRuleValue(page, ".lg-btn:hover", "background");
    expect(
      hoverBgRule,
      `chrome .lg-btn:hover background token = navy-dark #0F2440 (got '${hoverBgRule}')`,
    ).toMatch(/0f2440|rgb\(15, ?36, ?64\)/);
  });

  test("answer buttons: selected → navy border + wash bg; hover ≠ navy fill (§14.6/§13.2)", async ({ page }) => {
    await renderViewport(page, "desktop", { width: 1280, height: 900 });

    // The seeded §13.2 TwoButtonYesNo renders two .lg-btn.lg-btn-answer buttons
    // ("Yes"/"No"). SELECT the first: the chrome [aria-checked] state rule now
    // wins by cascade (the fix — no inline base border/background defeats it, and
    // the compound .lg-btn.lg-btn-answer outranks the primary .lg-btn). Wait out
    // the 150ms border-color/background transition (tokens.transitions.cardHoverMs)
    // so we read the SETTLED navy #1B3A5C border + #E8EEF4 wash — not the
    // #D2D9E5/#FFFFFF transition START.
    await page.locator(".lg-btn-answer").first().evaluate((el) => el.setAttribute("aria-checked", "true"));
    await page.waitForTimeout(300); // > tokens.transitions.cardHoverMs (150ms)
    const selected = await page.locator(".lg-btn-answer").first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fontWeight: cs.fontWeight, borderTopColor: cs.borderTopColor, backgroundColor: cs.backgroundColor };
    });
    expect(selected.fontWeight, "selected answer button font-weight → 700 (chrome state rule)").toBe("700");
    expect(
      selected.borderTopColor,
      "§14.6 selected answer-button navy border #1B3A5C APPLIES (no inline base defeats it)",
    ).toBe(hexToRgb("#1B3A5C"));
    expect(
      selected.backgroundColor,
      "§14.6 selected answer-button wash bg #E8EEF4 APPLIES (no inline base defeats it)",
    ).toBe(hexToRgb("#E8EEF4"));

    // HOVER on the (still-unselected) second button settles to the #F2F6FA WASH —
    // NOT the primary navy FILL #0F2440 the bare .lg-btn:hover would impose: the
    // compound .lg-btn.lg-btn-answer:hover outranks it. Real hover computed style,
    // read after the background transition settles.
    await page.locator(".lg-btn-answer").nth(1).hover();
    await page.waitForTimeout(300); // > tokens.transitions.cardHoverMs (150ms)
    const hover = await page.locator(".lg-btn-answer").nth(1).evaluate((el) => {
      const cs = getComputedStyle(el);
      return { borderTopColor: cs.borderTopColor, backgroundColor: cs.backgroundColor };
    });
    expect(
      hover.backgroundColor,
      "§14.6 answer-button :hover settles to the #F2F6FA wash",
    ).toBe(hexToRgb("#F2F6FA"));
    expect(
      hover.backgroundColor,
      "§14.6 answer-button :hover is NOT the primary navy FILL #0F2440",
    ).not.toBe(hexToRgb("#0F2440"));
    expect(hover.borderTopColor, "§14.6 answer-button :hover navy border #1B3A5C").toBe(hexToRgb("#1B3A5C"));

    // Deterministic CSSOM cross-check: the chrome answer-hover rule background
    // token is the wash #F2F6FA (independent of the element-level cascade).
    const answerHoverRule = await readRuleValue(page, ".lg-btn.lg-btn-answer:hover", "background");
    expect(
      answerHoverRule,
      `chrome .lg-btn.lg-btn-answer:hover background = wash #F2F6FA (got '${answerHoverRule}')`,
    ).toMatch(/f2f6fa|rgb\(242, ?246, ?250\)/);

    await page.screenshot({ path: `${EVIDENCE_DIR}/answer-button-states.png`, fullPage: true });
  });
});

// Read the raw serialised value of `prop` from the FIRST applied stylesheet
// rule whose selector contains `selectorSubstr` (lowercased). Used to prove a
// STATE token (e.g. .lg-btn:hover background) is correctly defined in the
// chrome CSS, independent of the element-level inline-override defeat.
async function readRuleValue(page: Page, selectorSubstr: string, prop: string): Promise<string> {
  return page.evaluate(
    ([sub, p]) => {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRule[];
        try {
          rules = Array.from(sheet.cssRules);
        } catch {
          continue;
        }
        for (const rule of rules) {
          const styleRule = rule as CSSStyleRule;
          if (styleRule.selectorText && styleRule.selectorText.indexOf(sub) >= 0) {
            const shorthand = styleRule.style.getPropertyValue(p).trim();
            const longhand = styleRule.style.getPropertyValue(`${p}-color`).trim();
            const combined = `${shorthand} ${longhand}`.trim();
            if (combined !== "") return combined.toLowerCase();
          }
        }
      }
      return "";
    },
    [selectorSubstr, prop] as const,
  );
}

// ---------------------------------------------------------------------------
// (b') full-page screenshot SELF-baseline (§14.10 / listicles §31.1 thresholds)
// — in-browser canvas pixel diff, no external deps. First run writes baseline.
// Content is fully static run-stable literals (no dates/counts/random ids reach
// the render), so no masking is required — the render is byte-identical across
// runs (the listicles run-stable discipline).
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
  viewport: "desktop" | "mobile",
  size: { width: number; height: number },
  maxRatio: number,
): Promise<void> {
  await renderViewport(page, viewport, size);
  await page.waitForTimeout(200); // settle
  const shot = await page.screenshot({ fullPage: true, animations: "disabled" });
  writeFileSync(join(EVIDENCE_DIR, `${name}.png`), shot); // evidence copy every run
  const baselinePath = join(BASELINE_DIR, `${name}.png`);
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

test.describe("§14.10 screenshot self-baseline (masking N/A — static render)", () => {
  test("desktop full-page ≤0.10% changed pixels", async ({ page }) => {
    await selfBaseline(page, "leadgen-fixture-desktop", "desktop", { width: 1280, height: 900 }, 0.001);
  });

  test("mobile full-page ≤0.15% changed pixels", async ({ page }) => {
    await selfBaseline(page, "leadgen-fixture-mobile", "mobile", { width: 375, height: 800 }, 0.0015);
  });
});

// ---------------------------------------------------------------------------
// §14.10(c) NO arbitrary-CSS escapes.
//   (i)  rendered markup carries no author-supplied <style> block;
//   (ii) author content never flows into a style="…" attribute;
//   (iii) design_overrides_json accepts ONLY curated token keys — arbitrary
//         CSS (and unknown keys) are rejected at save (validateSection +
//         validateSectionContent).
// ---------------------------------------------------------------------------

test.describe("§14.10(c) no arbitrary-CSS escapes", () => {
  test("(i)+(ii) rendered markup has no author <style>; author text never enters a style attr", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    try {
      // A draft whose author text is a CSS/HTML injection attempt + a unique
      // alphanumeric sentinel. Preview render escapes it (editor/sanitize).
      const SENTINEL = "INJECTSENTINEL7f3q";
      const injection = {
        components: [
          {
            type: "QuestionHeadline",
            question_id: "q_inj_headline",
            props: { text: `${SENTINEL}</style><style>body{background:red}</style><script>alert(1)</script>` },
          },
          {
            type: "IconCardAnswerGrid",
            question_id: "q_inj_grid",
            internal_field: "inj",
            choices: [{ label: `${SENTINEL}"><style>x{}`, value: "a", analytics_id: "inj_a", icon: "★" }],
            props: { columns: 2 },
          },
        ],
      };
      const inj = await fetchPreview(ctx, injection);
      const markup = `${inj.desktop}\n${inj.mobile}`;

      // (i) NO author <style> / <script> block leaked into the render.
      expect(markup.toLowerCase(), "rendered markup contains no <style> block").not.toContain("<style");
      expect(markup.toLowerCase(), "rendered markup contains no <script> block").not.toContain("<script");
      // The injected close-tags survive ONLY as escaped text.
      expect(markup, "author </style> is HTML-escaped, not raw").toContain("&lt;/style&gt;");

      // (ii) The author sentinel appears (as escaped text) but is NEVER inside
      // a style="…" attribute value. Parse every style attr with matchAll (the
      // repo hook forbids RegExp.prototype.exec in test files).
      expect(markup, "author sentinel is present as text content").toContain(SENTINEL);
      const styleValues: string[] = [];
      for (const m of markup.matchAll(/style="([^"]*)"/g)) {
        styleValues.push(m[1] ?? "");
      }
      expect(styleValues.length, "preset output DOES emit token-only style attributes").toBeGreaterThan(0);
      const leaked = styleValues.filter((v) => v.includes(SENTINEL));
      expect(leaked, `author content leaked into a style attribute: ${leaked.join(" | ")}`).toEqual([]);
    } finally {
      await ctx.dispose();
    }
  });

  test("(iii) design_overrides_json rejects unknown keys AND arbitrary CSS at save", async () => {
    const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
    try {
      const base = {
        section_name: `E2E LG Override Neg ${Date.now()}`,
        activity: "quote_funnel",
        vertical: "business_loan",
        headline_text: "How much do you need?",
        content_json: buildVisualSectionContent(),
        status: "active",
      };

      // Unknown (non-curated) key at the Section level → 400.
      const unknownKey = await ctx.post("/api/admin/leadgen/sections", {
        data: { ...base, design_overrides_json: { evilKey: "anything" } },
      });
      expect(unknownKey.status(), "unknown design-override key is rejected at save").toBe(400);
      const unknownBody = (await unknownKey.json()) as { fields?: Record<string, string> };
      expect(
        Object.keys(unknownBody.fields ?? {}).some((k) => k.includes("design_overrides")),
        `unknown-key error is field-keyed under design_overrides: ${JSON.stringify(unknownBody.fields)}`,
      ).toBe(true);

      // Curated key BUT arbitrary-CSS value → 400 (CSS-injection punctuation).
      const arbitraryCss = await ctx.post("/api/admin/leadgen/sections", {
        data: { ...base, design_overrides_json: { iconColor: "#fff; background:url(evil)" } },
      });
      expect(arbitraryCss.status(), "arbitrary-CSS value in a curated key is rejected at save").toBe(400);
      const arbitraryBody = (await arbitraryCss.json()) as { fields?: Record<string, string> };
      expect(
        Object.keys(arbitraryBody.fields ?? {}).some((k) => k.includes("design_overrides")),
        `arbitrary-CSS error is field-keyed under design_overrides: ${JSON.stringify(arbitraryBody.fields)}`,
      ).toBe(true);

      // Per-COMPONENT design_overrides arbitrary CSS → 400 (content-schema
      // arbitrary_css_override), surfaced under content.components[…].
      const nodeCss = {
        components: [
          {
            type: "CurrencyRangeQuestion",
            question_id: "q_bad_range",
            internal_field: "bad_range",
            props: { min: 0, max: 10 },
            design_overrides: { rangeColor: "red;}</style><style>x{}" },
          },
        ],
      };
      const nodeCssRes = await ctx.post("/api/admin/leadgen/sections", { data: { ...base, content_json: nodeCss } });
      expect(nodeCssRes.status(), "per-component arbitrary-CSS override is rejected at save").toBe(400);
      const nodeBody = (await nodeCssRes.json()) as { fields?: Record<string, string> };
      expect(
        Object.keys(nodeBody.fields ?? {}).some((k) => k.includes("design_overrides")),
        `per-component override error is field-keyed: ${JSON.stringify(nodeBody.fields)}`,
      ).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// §14.10 blue/green NEGATIVE — the discarded exploration palette (blue pill
// #2a6fdb + green #1f9d57 and their variants) appears NOWHERE in the rendered
// default funnel (CSS + both viewport fragments). The default is navy/orange.
// ---------------------------------------------------------------------------

test("§14.10 discarded blue/green palette appears nowhere in the default funnel", async () => {
  const haystack = `${preview.css}\n${preview.desktop}\n${preview.mobile}`.toLowerCase();
  // NOTE: #0E7C3A (success green, KEPT for the badge) is DELIBERATELY not here —
  // the discarded green is #1f9d57 and its variants only.
  const discarded: Array<[string, string]> = [
    ["#2a6fdb", "discarded blue pill background (§14.6 screenshot; default is navy #1B3A5C)"],
    ["#215bb5", "discarded blue hover"],
    ["#1c4f9e", "discarded blue active"],
    ["#a9c0e8", "discarded blue disabled"],
    ["#1f9d57", "discarded green (§14.2 progress/category/range/icon/badge; default is navy/orange/success-green)"],
    ["#14663a", "discarded green badge text"],
    ["#eaf7ef", "discarded green badge bg"],
    ["#f2fbf6", "discarded green selected-card wash"],
  ];
  const found = discarded.filter(([hex]) => haystack.includes(hex.toLowerCase())).map(([hex, why]) => `${hex} (${why})`);
  expect(found, `discarded palette leaked into the default funnel render:\n${found.join("\n")}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// §14.10(d) capability checklist — every operator-screenshot component pattern
// is expressible through CMS presets and PRESENT in the seeded rendered
// Section. Each row asserts the pattern's rendered signature.
// ---------------------------------------------------------------------------

test("§14.10(d) operator-screenshot capability checklist — every pattern present", () => {
  const markup = seeded.content ? preview.desktop : "";
  const has = (needle: string): boolean => markup.includes(needle);

  const checklist: Array<[string, boolean]> = [
    // Icon cards (§14.4 Sole-Proprietor/…/S-Corp).
    ["icon cards (IconCardAnswerGrid)", has('data-component-type="IconCardAnswerGrid"') && has("lg-card-icon") && has("Sole Proprietor") && has("S Corporation")],
    // Currency range (§14.5 BUSINESS LOAN / $330,000 / $10,000 / $1M+).
    ["currency range (CurrencyRangeQuestion)", has('data-component-type="CurrencyRangeQuestion"') && has('data-format="currency"') && has("$330,000") && has("$10,000") && has("$1M+")],
    // Navy pill (was "blue pill" in the screenshots) — the Continue button.
    ["navy pill Continue (ContinueButton — renders NAVY, §14.6)", has('data-component-type="ContinueButton"') && has("lg-continue")],
    // Green reassurance badge (§14.7).
    ["green reassurance badge (ReassuranceBadge)", has('data-component-type="ReassuranceBadge"') && has("lg-badge") && has("Get your offers in 2 minutes or less.")],
    // Progress bar.
    ["progress bar (ProgressBar)", has('data-component-type="ProgressBar"') && has("lg-progress-fill")],
    // Dropdown.
    ["dropdown (DropdownQuestion)", has('data-component-type="DropdownQuestion"') && has("lg-dropdown") && has("<select")],
    // Multi-choice.
    ["multi-choice (MultiChoiceCardGroup)", has('data-component-type="MultiChoiceCardGroup"') && has("lg-multi")],
    // Free-text.
    ["free-text (FreeTextQuestion)", has('data-component-type="FreeTextQuestion"') && has('type="text"')],
    // PII inputs — email / phone / name / ZIP.
    ["PII email (EmailInputQuestion)", has('data-component-type="EmailInputQuestion"') && has('type="email"')],
    ["PII phone (PhoneInputQuestion)", has('data-component-type="PhoneInputQuestion"') && has('type="tel"')],
    ["PII name (NameFieldsGroup)", has('data-component-type="NameFieldsGroup"') && has('autocomplete="given-name"') && has('autocomplete="family-name"')],
    ["PII ZIP (ZIPInputQuestion)", has('data-component-type="ZIPInputQuestion"') && has('pattern="\\d{5}"')],
  ];

  const missing = checklist.filter(([, ok]) => !ok).map(([name]) => name);
  expect(missing, `§14.10(d) patterns NOT expressible/present in the seeded Section:\n${missing.join("\n")}`).toEqual([]);
});
