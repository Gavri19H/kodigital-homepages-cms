// R5 staging sign-off evidence capture (NOT a pixel-diff gate — see
// gate1c-baselines.spec.ts for that; this spec's only job is to produce the
// screenshots the R5 sign-off README points operator eyes at). Three items
// need a human decision/awareness before this ships live, none of which a
// pixel-diff assertion can adjudicate on its own:
//
//   1. R3 FIX-ROUND ERRATA (forensic-defect-register.md:231-237): size
//      presets s=300px/l=480px are PROPOSED, "bracketing the golden demo,
//      unspecified anywhere authoritative" — needs explicit operator sign-
//      off, not just a passing test. This spec renders both on the canvas
//      so the operator can SEE the two widths, not just read the numbers.
//   2. The studio's resize-handle chrome is a hardcoded #1B3A5C (navy) —
//      confirmed by direct read of ui-section-studio.ts's buildHandle
//      (own comment: "the fixed appearance (incl. the navy hex) is a
//      SEPARATE declaration-list literal"). This is themeing the EDITOR
//      affordance, not funnel content, so it is very likely intentional
//      (consistent editing-chrome regardless of the funnel's own theme) —
//      but a Bold-Yellow-themed section still showing navy handles is worth
//      an explicit operator look rather than silently shipping.
//   3. Typography (R5 D11): golden-matched headline/subheadline. This spec
//      does not re-capture it — state 01-build-default.png in
//      __screenshots__/leadgen-v31-gate1c/ (regenerated this same phase,
//      ratio=0 stability-proven) already shows the CURRENT (after) render;
//      the before/after VALUES (not pixels) are the tokens.ts git diff,
//      cited verbatim in the sign-off README instead of a duplicate screenshot.
//
// Seeding rides the real admin HTTP APIs only (repo convention). Run THIS
// FILE ONLY: `npx playwright test test-ui/leadgen-r5-staging-signoff.spec.ts
// --workers=1 --reporter=line` (same hard lesson as every other LeadGen
// Playwright spec in this repo — never the full `npm run test:ui`).

import { test, expect, type APIRequestContext } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const LG_API = "/api/admin/leadgen";
const EVIDENCE_DIR = "test-artifacts/leadgen-r5-staging-signoff";
const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

// 2600px matches gate1c-baselines.spec.ts's own CONFIRMED (not guessed)
// height for this exact page: the admin shell's <body> (not <html>) is the
// real scrolling container, so a plain (non-fullPage) screenshot needs a
// viewport tall enough to fit the whole editor — chrome + topbar + strip +
// canvas + drawer — with no scrolling anywhere (see that file's header for
// the full diagnosis; reused here rather than re-deriving it).
test.use({ viewport: { width: 1280, height: 2600 } });

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

interface Created {
  id: number;
  public_id: string;
}
interface ThemeCreated {
  item: { id: string; name: string };
}

test.beforeAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.describe("R5 staging sign-off — evidence capture (not a gate)", () => {
  test("1. Size-preset errata: s=300px and l=480px rendered side by side on the canvas", async ({ page, request }) => {
    const created = await json<Created>(
      await request.post(`${LG_API}/sections`, {
        data: {
          section_name: `R5 Signoff Size Presets ${uniq}`,
          activity: "Insurance",
          vertical: "Car",
          headline_text: "Size preset errata (R5 sign-off)",
          subheadline_text: "Left: s=300px. Right: l=480px.",
          continue_mode: "button",
          status: "active",
          content_json: {
            components: [
              { type: "QuestionHeadline", question_id: "q_h", bind: "section_headline" },
              { type: "Subheadline", question_id: "q_s", bind: "section_subheadline" },
              {
                type: "ZIPInputQuestion",
                question_id: "q_zip_s",
                internal_field: "zip_s",
                answer_type: "string",
                props: { label: "ZIP (preset s = 300px)", placeholder: "Enter ZIP" },
                design_overrides: { size: { width: "s" } },
              },
              {
                type: "ZIPInputQuestion",
                question_id: "q_zip_l",
                internal_field: "zip_l",
                answer_type: "string",
                props: { label: "ZIP (preset l = 480px)", placeholder: "Enter ZIP" },
                design_overrides: { size: { width: "l" } },
              },
              { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
            ],
          },
        },
      }),
      "create size-preset signoff section",
    );

    await page.goto(`/admin/leadgen/sections/${created.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    const canvas = page.frameLocator("#lg-studio-canvas-frame");
    await canvas.locator('[data-question-id="q_zip_s"]').waitFor();
    await canvas.locator('[data-question-id="q_zip_l"]').waitFor();

    // Confirm the grounded widths actually rendered before freezing them as
    // the sign-off evidence (a silently-broken render would otherwise mint a
    // misleading screenshot — same discipline as gate1c's own calibration
    // guard on the custom-resize badge). hydration()'s data-question-id lands
    // DIRECTLY on the <input> itself (presets.ts renderTextInput — confirmed
    // by direct source read, not assumed), so the locator targets the
    // element itself, never a nested "... input" descendant.
    const widthS = await canvas.locator('[data-question-id="q_zip_s"]').evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
    const widthL = await canvas.locator('[data-question-id="q_zip_l"]').evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
    console.log(`[r5-signoff] preset s input width=${widthS}px, preset l input width=${widthL}px`);
    expect(widthS).toBeLessThan(widthL); // s must render narrower than l — the whole point of the errata

    const shot = await page.screenshot({ animations: "disabled" });
    writeFileSync(`${EVIDENCE_DIR}/01-size-preset-errata-s300-l480.png`, shot);
  });

  test("2. Studio resize handles stay navy (#1B3A5C) even while the drawer's OWN preview proves the same section renders Bold Yellow elsewhere", async ({
    page,
    request,
  }) => {
    // CONFIRMED BY DIRECT SOURCE READ (not assumed): the main canvas has NO
    // theme mechanism at all — renderSectionStudio hardcodes
    // `const design = getFunnelDesign(null)` (ui-section-studio.ts:2661), so
    // there is no URL param / API call that makes the CANVAS itself render a
    // theme. The ONLY theme-aware render in the whole editor is the drawer's
    // "Preview in a quote" panel (`#lg-preview-theme` -> POST .../preview
    // `theme_id` -> a SEPARATE `#lg-preview-frame` srcdoc iframe, `runPreview`
    // in the island). This test uses that REAL mechanism (not a fabricated
    // query param) to render Bold Yellow in the preview panel, side by side
    // in one screenshot with the main canvas's own permanently-navy chrome —
    // an accurate picture of the actual product behavior, not a staged one.
    const themeName = `R5 Signoff Bold Yellow ${uniq}`;
    await json<ThemeCreated>(
      await request.post(`${LG_API}/themes`, {
        data: {
          name: themeName,
          roles: {
            brand_primary: "#13233B",
            accent: "#F5C518",
            page_bg: "#FFF7DE",
            card: "#FFFFFF",
            text: "#14181F",
            success: "#0E7C3A",
            error: "#B23A2C",
          },
          typography: { headline_font: "Newsreader", body_font: "Inter", base_px: 16 },
          controls: { field_height: "medium", button_size: "m", corners: "rounded" },
        },
      }),
      "create Bold Yellow signoff theme",
    );

    const created = await json<Created>(
      await request.post(`${LG_API}/sections`, {
        data: {
          section_name: `R5 Signoff Navy Handles ${uniq}`,
          activity: "Insurance",
          vertical: "Car",
          headline_text: "Navy-handle-vs-Bold-Yellow-preview check (R5 sign-off)",
          subheadline_text: "Top: canvas chrome (always navy). Bottom: drawer preview in Bold Yellow.",
          continue_mode: "button",
          status: "active",
          content_json: {
            components: [
              { type: "QuestionHeadline", question_id: "q_h", bind: "section_headline" },
              { type: "Subheadline", question_id: "q_s", bind: "section_subheadline" },
              {
                type: "ZIPInputQuestion",
                question_id: "q_zip",
                internal_field: "zip",
                answer_type: "string",
                props: { label: "ZIP code", placeholder: "Enter your ZIP code" },
              },
              { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
            ],
          },
        },
      }),
      "create navy-handle signoff section",
    );

    await page.goto(`/admin/leadgen/sections/${created.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    // Top: select the field on the main canvas so its (always-navy) resize
    // handles are visible.
    const canvas = page.frameLocator("#lg-studio-canvas-frame");
    await canvas.locator('[data-question-id="q_zip"]').click();
    await expect(canvas.locator("[data-width-handle]").first()).toBeVisible();

    // Bottom: the drawer's "Preview in a quote" panel is default-visible (no
    // click needed — confirmed by gate1c-baselines.spec.ts's own extensive
    // diagnosis of this exact page). Select the just-created Bold Yellow
    // theme by its exact (uniq-suffixed) name; its `change` listener
    // auto-triggers runPreview() — no separate refresh click needed.
    const themeSelect = page.locator("#lg-preview-theme");
    await expect(themeSelect.locator(`option:text-is("${themeName}")`)).toHaveCount(1, { timeout: 10_000 });
    await themeSelect.selectOption({ label: themeName });

    // Confirm the preview iframe ACTUALLY re-rendered with the Bold Yellow
    // accent hex before freezing this as sign-off evidence (same calibration
    // discipline as every other capture in this file / gate1c-baselines).
    // NOTE: toContainText() on a <style> element reads back "" (a <style>
    // tag renders no visible text, and Playwright's text-content assertions
    // follow the browser's rendered-text notion, not the raw text node) —
    // confirmed by a real failing run of this exact assertion, not assumed.
    // .evaluate() reads the DOM textContent directly instead, sidestepping
    // that behavior.
    const previewFrame = page.frameLocator("#lg-preview-frame");
    await expect
      .poll(
        async () => {
          const styleEls = previewFrame.locator("style");
          const count = await styleEls.count();
          for (let i = 0; i < count; i++) {
            const text = await styleEls.nth(i).evaluate((el) => el.textContent ?? "");
            if (text.includes("F5C518")) return true;
          }
          return false;
        },
        { timeout: 10_000 },
      )
      .toBe(true);

    const shot = await page.screenshot({ animations: "disabled" });
    writeFileSync(`${EVIDENCE_DIR}/02-navy-handles-vs-bold-yellow-preview.png`, shot);
  });
});
