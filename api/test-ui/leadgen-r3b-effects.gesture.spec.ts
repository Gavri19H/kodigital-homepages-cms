// Section Builder v3.1 REMEDIATION — phase R3 STAGE B. THE PHASE GATE.
// Real, hit-tested inspector clicks (M1-compliant, ZERO dispatchEvent) under
// Playwright FIREFOX (*.gesture.spec.ts -> the firefox project). Covers:
// Continue Style rows show REAL resolved values + the deep link navigates
// (0-funnel case — a freshly created section has zero quote usage);
// text-color role renders for the text family (assertEffect EXPECTED value);
// TextBlock/ImageBlock insert -> author -> render e2e; the frame-scope
// read-only notice + zero controls for a legacy seeded node; the Spacer
// variant toggle effect; Rules/Behavior tab gating per type.
//
// Run per-file only (from api/), with the fresh-D1 preamble:
//   pkill -f "wrangler dev"; pkill -f workerd; pkill -f cms-panel; sleep 2; \
//   npm run db:reset:local
//   npx playwright test test-ui/leadgen-r3b-effects.gesture.spec.ts \
//     --workers=1 --reporter=line --timeout=180000
import { test, expect, type APIRequestContext, type Page, type FrameLocator } from "@playwright/test";
import { captureRenderState, assertEffect } from "./utils/effect-assert";

const LG_API = "/api/admin/leadgen";
const SHOT = "test-artifacts/r3b-effects";
const uniq = Date.now();

const ACCENT_RGB = "rgb(232, 93, 38)"; // design.color.accent #E85D26

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}
interface Created { id: number; public_id: string; }
async function createSection(request: APIRequestContext, name: string, components: unknown[]): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: `r3b-act-${uniq}`,
        vertical: `r3b-vert-${uniq}`,
        headline_text: "What coverage do you want?",
        subheadline_text: "Pick one",
        continue_mode: "button",
        status: "active",
        content_json: { components },
      },
    }),
    `section create (${name})`,
  );
}
const HEADLINE = { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" };
const CONT = { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } };

function frame(page: Page): FrameLocator { return page.frameLocator("#lg-studio-canvas-frame"); }
function canvas(page: Page) { return frame(page).locator("#lg-studio-canvas-render"); }
async function boot(page: Page, s: Created): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
  await expect(canvas(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 20_000 });
}
async function selectNode(page: Page, qid: string): Promise<void> {
  await frame(page).locator(`[data-question-id="${qid}"]`).click({ timeout: 8000 });
  await frame(page).locator(`[data-question-id="${qid}"]`).locator("xpath=..").locator("div[data-selection-chrome]").first().waitFor({ timeout: 8000 }).catch(() => {
    // frame-scope / non-field selections may not carry the 8-handle field
    // chrome at all — a soft wait, the scope-header name is the real proof.
  });
}

test.describe("R3b effect matrix (firefox real input)", () => {
  test("deliverable 1 (S2-2 reclassified): Continue Style rows show REAL resolved values (not the old fake strings) and the deep link navigates to the quotes list (0-funnel case)", async ({ page }) => {
    const s = await createSection(page.request, `R3b Continue ${uniq}`, [HEADLINE, CONT]);
    await boot(page, s);
    await selectNode(page, "q_cont");
    await page.locator('[data-studio-inspector-tab="style"]').click();
    const styleBlock = page.locator("[data-style-continue-block]");
    await expect(styleBlock).toBeVisible();
    // the OLD fake strings are GONE
    await expect(styleBlock).not.toContainText("Brand primary");
    await expect(styleBlock).not.toContainText("Bottom, full width");
    // the REAL resolved values render
    await expect(page.locator("[data-continue-color-text]")).toContainText("Button");
    await expect(page.locator("[data-continue-color-text]")).toContainText("#1B3A5C");
    await expect(page.locator("[data-continue-position-text]")).toContainText("Inside the question");
    await expect(styleBlock).toContainText("Medium (fixed)");

    // the deep link: a freshly created section has ZERO quote usage -> the
    // real navigation is to the quotes LIST (never a disabled no-op).
    await Promise.all([
      page.waitForURL("**/admin/leadgen/quotes", { timeout: 10_000 }),
      page.locator('[data-continue-change-in-frame="color"]').click(),
    ]);
    expect(page.url()).toContain("/admin/leadgen/quotes");
  });

  test("deliverable 2/E2-C1: the text-color role control changes the canvas TextBlock color to the EXACT accent hex", async ({ page }) => {
    const s = await createSection(page.request, `R3b TextColor ${uniq}`, [
      HEADLINE,
      { type: "TextBlock", question_id: "q_tb", props: { role: "heading", text: "Section heading" } },
      CONT,
    ]);
    await boot(page, s);
    await selectNode(page, "q_tb");
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator("[data-style-text-block]")).toBeVisible();
    const target = '[data-question-id="q_tb"]';
    const before = await captureRenderState(frame(page), target);
    // scoped to the Style-tab's text-variant block: the CANVAS TOOLBAR also
    // carries a data-inspector-override="featureColor" select (gated to
    // CategoryLabel only), so the bare attribute selector is ambiguous.
    await page.locator('[data-style-text-block] [data-inspector-override="featureColor"]').selectOption("accent");
    await expect.poll(async () => (await captureRenderState(frame(page), target)).computed.color, { timeout: 8000 }).toBe(ACCENT_RGB);
    const after = await captureRenderState(frame(page), target);
    assertEffect(before, after, { color: ACCENT_RGB }, { label: "TextBlock featureColor=accent" });
  });

  test("deliverable 4/E2-C2: TextBlock insert seeds a REAL, VISIBLE heading (not an invisible empty box)", async ({ page }) => {
    const s = await createSection(page.request, `R3b TextBlockInsert ${uniq}`, [HEADLINE, CONT]);
    await boot(page, s);
    const canvasNodes = canvas(page).locator("[data-component-type]");
    const before = await canvasNodes.count();
    await page.locator('[data-tile][data-name="text legal note reassurance disclosure"]').first().click();
    await expect(canvasNodes).toHaveCount(before + 1, { timeout: 20_000 });
    await expect(canvas(page).locator(".lg-text-heading")).toHaveText("New text");
  });

  test("deliverable 4/E2-NEW-1: ImageBlock insert shows an honest placeholder, then authoring a real image URL replaces it with a real <img>", async ({ page }) => {
    const s = await createSection(page.request, `R3b ImageBlockInsert ${uniq}`, [HEADLINE, CONT]);
    await boot(page, s);
    const canvasNodes = canvas(page).locator("[data-component-type]");
    const before = await canvasNodes.count();
    await page.locator('[data-tile][data-name="image logo picture"]').first().click();
    await expect(canvasNodes).toHaveCount(before + 1, { timeout: 20_000 });
    // default source = media, no logoMediaId yet -> the labeled placeholder
    await expect(canvas(page).locator('[data-placeholder="true"]')).toBeVisible();
    await expect(canvas(page).locator('[data-placeholder="true"]')).toHaveText("Image");
    // author a real image URL through the dedicated Content-tab control
    await page.locator('[data-studio-inspector-tab="content"]').click();
    await expect(page.locator("[data-content-imageblock-block]")).toBeVisible();
    await page.locator("#lg-imageblock-media").fill("https://example.com/logo.png");
    await expect.poll(async () => canvas(page).locator(".lg-image-block-img").count(), { timeout: 8000 }).toBe(1);
    await expect(canvas(page).locator('[data-placeholder="true"]')).toHaveCount(0);
    // the inspector's OWN thumbnail also updates
    await expect(page.locator("[data-imageblock-thumb]")).toBeVisible();
  });

  test("deliverable 6/E2-NEW-9: the Spacer variant toggle actually changes the canvas render (gap -> line divider)", async ({ page }) => {
    const s = await createSection(page.request, `R3b SpacerVariant ${uniq}`, [HEADLINE, CONT]);
    await boot(page, s);
    await page.locator('[data-library-group-toggle="layout"]').click();
    const canvasNodes = canvas(page).locator("[data-component-type]");
    const before = await canvasNodes.count();
    await page.locator('[data-tile][data-name="spacer gap"]').first().click();
    await expect(canvasNodes).toHaveCount(before + 1, { timeout: 20_000 });
    await expect(canvas(page).locator(".lg-spacer-line")).toHaveCount(0);
    await page.locator('[data-studio-inspector-tab="style"]').click();
    const variantSelect = page.locator('[data-container-prop="variant"]');
    await expect(variantSelect).toBeVisible();
    await variantSelect.selectOption("line");
    await expect.poll(async () => canvas(page).locator(".lg-spacer-line").count(), { timeout: 8000 }).toBe(1);
  });

  test("deliverable 8/E2-NEW-3/E2-NEW-8: a legacy frame-scope node (StepIndicator, no palette tile) gets the read-only notice in BOTH tabs — zero editing controls", async ({ page }) => {
    const s = await createSection(page.request, `R3b FrameScope ${uniq}`, [
      HEADLINE,
      { type: "StepIndicator", question_id: "q_step", props: { steps: 3, current: 1 } },
      CONT,
    ]);
    await boot(page, s);
    await selectNode(page, "q_step");
    // Content tab: the read-only notice, not the Layout structured-prop group.
    await expect(page.locator("[data-content-framescope-block]")).toBeVisible();
    await expect(page.locator("[data-content-framescope-block]")).toContainText("Part of the funnel layout");
    // the SSR'd Layout structured-prop group for StepIndicator still EXISTS in
    // the DOM (renderContainerLayoutPanel emits it unconditionally, toggled by
    // a separate per-type loop) but its ANCESTOR (data-style-field-block) is
    // hidden for the frame_scope variant, so it must never be VISIBLE —
    // existence (.toHaveCount) is the wrong check here; visibility is the
    // real "no editing controls" proof.
    await expect(page.locator('[data-container-group="StepIndicator"]')).not.toBeVisible();
    await expect(page.locator('[data-container-prop="steps"]')).not.toBeVisible();
    // Style tab: same notice, no Width/Corners/Layout controls either.
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator("[data-style-framescope-block]")).toBeVisible();
    await expect(page.locator("[data-style-framescope-block]")).toContainText("Part of the funnel layout");
    await expect(page.locator("[data-style-size-appearance]")).not.toBeVisible();
    // canvas render of the legacy node itself is UNCHANGED (still renders its dots).
    await expect(frame(page).locator('[data-question-id="q_step"] .lg-step')).toHaveCount(3);
  });

  test("deliverable 3/E2-NEW-5: Rules tab is gone for a TextBlock selection; Behavior section is gone for an AutoAdvanceButton (produces:null)", async ({ page }) => {
    const s = await createSection(page.request, `R3b RulesBehavior ${uniq}`, [
      HEADLINE,
      { type: "TextBlock", question_id: "q_tb2", props: { role: "body", text: "Some copy" } },
      { type: "AutoAdvanceButton", question_id: "q_aab", props: { label: "Continue" } },
      CONT,
    ]);
    await boot(page, s);
    await selectNode(page, "q_tb2");
    await expect(page.locator('[data-studio-inspector-tab="rules"]')).toBeHidden();
    await selectNode(page, "q_aab");
    await page.locator('[data-studio-inspector-tab="content"]').click();
    await expect(page.locator("[data-content-behavior-section]")).toBeHidden();
  });
});
