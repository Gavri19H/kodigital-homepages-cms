// Section Builder v3.1 REMEDIATION — phase R3 STAGE A. THE PHASE GATE.
// Real, hit-tested inspector clicks (M1-compliant, ZERO dispatchEvent) under
// Playwright FIREFOX (*.gesture.spec.ts → the firefox project). For EVERY type
// in the R3-widened size-consuming set, a Style-tab click must produce the
// EXACTLY-expected canvas computed style (assertEffect — an EXPECTED-VALUE proof,
// register M5 "click ⇒ render changed", never a bare delta). Plus: leading-icon
// render (text + Address), helper render, and the choices-editor honesty
// (labels + per-type gating + emoji/icon pickers + image thumbnail).
//
// Run per-file only (from api/), with the fresh-D1 preamble:
//   pkill -f "wrangler dev"; pkill -f workerd; pkill -f cms-panel; sleep 2; \
//   rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local
//   npx playwright test test-ui/leadgen-r3a-effects.gesture.spec.ts \
//     --workers=1 --reporter=line --timeout=180000
//
// Expected-value table (derived — Appendix B + §8.5b + default design tokens):
//   corners sharp/rounded/pill  → border-radius 0px / 8px / 20px
//   border  neutral/brand/accent → rgb(210,217,229) / rgb(27,58,92) / rgb(232,93,38)
//   width   s/m/l/full → 300px / 384px / 480px / 100% (R3 BLOCKER-1 grounding:
//            §7.1 line 345 "384 (= 64% of the 600 column)"; s/l proposed-errata
//            brackets of the 600 unit column) ; custom_px → Npx
//   height  small/medium/large → 44px / 52px / 60px (§10.4 "shared size
//            language": base .lg-input min-height + theme Button-size M/L),
//            applied as min-height on the buttons/items.
//   (Every preset now renders its grounded value — the per-type matrix asserts
//    corners + border role; the size presets get their own effect test below.)
import { test, expect, type APIRequestContext, type Page, type FrameLocator } from "@playwright/test";
import { realDrag } from "./utils/real-input";
import { captureRenderState, assertEffect, type ExpectedEffect } from "./utils/effect-assert";

const LG_API = "/api/admin/leadgen";
const SHOT = "test-artifacts/r3a-effects";
const uniq = Date.now();

const PILL_RADIUS = "20px";
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
        activity: `r3a-act-${uniq}`,
        vertical: `r3a-vert-${uniq}`,
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
const CH = [{ label: "Basic", value: "basic", analytics_id: "b" }, { label: "Full", value: "full", analytics_id: "f" }];

function frame(page: Page): FrameLocator { return page.frameLocator("#lg-studio-canvas-frame"); }
function canvas(page: Page) { return frame(page).locator("#lg-studio-canvas-render"); }
async function boot(page: Page, s: Created): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
  await expect(canvas(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 20_000 });
}
async function selectNode(page: Page, qid: string): Promise<void> {
  await frame(page).locator(`[data-question-id="${qid}"]`).click({ timeout: 8000 });
  await frame(page).locator(`[data-question-id="${qid}"]`).locator("xpath=..").locator("div[data-selection-chrome]").first().waitFor({ timeout: 8000 });
}
async function openStyleTab(page: Page): Promise<void> {
  await page.locator('[data-studio-inspector-tab="style"]').click();
  await expect(page.locator("[data-style-size-appearance]")).toBeVisible({ timeout: 8000 });
}
// Click a Style-tab control, WAIT for the debounced canvas re-render to apply the
// expected computed value on `targetSelector`, then assert the exact effect.
async function clickAndAssert(page: Page, targetSelector: string, clickSelector: string, expected: ExpectedEffect): Promise<void> {
  const key = Object.keys(expected)[0] as keyof typeof expected;
  const want = expected[key]!;
  const before = await captureRenderState(frame(page), targetSelector);
  await page.locator(clickSelector).click();
  await expect
    .poll(async () => (await captureRenderState(frame(page), targetSelector)).computed[key], { timeout: 10_000, message: `${clickSelector} → ${targetSelector}.${key} == ${want}` })
    .toBe(want);
  const after = await captureRenderState(frame(page), targetSelector);
  assertEffect(before, after, expected, { label: `${clickSelector} on ${targetSelector}` });
}

// The widened size-consuming set + the canvas ITEM whose computed corners/border
// the click must change (per the semantics in presets.ts).
const MATRIX: Array<{ type: string; qid: string; node: Record<string, unknown>; item: string }> = [
  { type: "ButtonAnswerGroup", qid: "q_bag", node: { type: "ButtonAnswerGroup", question_id: "q_bag", internal_field: "cov", answer_type: "enum", choices: CH }, item: '[data-question-id="q_bag"] .lg-btn-answer' },
  { type: "TwoButtonYesNo", qid: "q_yn", node: { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "ins", answer_type: "boolean", props: { yesLabel: "Yes", noLabel: "No" } }, item: '[data-question-id="q_yn"] .lg-btn-answer' },
  { type: "OtherGroupSelector", qid: "q_ogs", node: { type: "OtherGroupSelector", question_id: "q_ogs", internal_field: "brand", answer_type: "enum", choices: CH }, item: '[data-question-id="q_ogs"] .lg-btn-answer' },
  { type: "IconCardAnswerGrid", qid: "q_icg", node: { type: "IconCardAnswerGrid", question_id: "q_icg", internal_field: "kind", answer_type: "enum", choices: [{ label: "Home", value: "home", icon: "home", analytics_id: "h" }, { label: "Car", value: "car", icon: "car", analytics_id: "c" }] }, item: '[data-question-id="q_icg"] .lg-card' },
  { type: "ImageCardAnswerGrid", qid: "q_img", node: { type: "ImageCardAnswerGrid", question_id: "q_img", internal_field: "look", answer_type: "enum", choices: [{ label: "A", value: "a", imageMediaId: "https://example.com/a.png", image_alt: "A", analytics_id: "a" }] }, item: '[data-question-id="q_img"] .lg-card' },
  { type: "MultiChoiceCardGroup", qid: "q_mcg", node: { type: "MultiChoiceCardGroup", question_id: "q_mcg", internal_field: "extras", answer_type: "array", choices: CH }, item: '[data-question-id="q_mcg"] .lg-card' },
  { type: "DropdownQuestion", qid: "q_dd", node: { type: "DropdownQuestion", question_id: "q_dd", internal_field: "state", answer_type: "enum", choices: CH, props: { placeholder: "Pick" } }, item: '[data-question-id="q_dd"]' },
  { type: "SearchableDropdownQuestion", qid: "q_sdd", node: { type: "SearchableDropdownQuestion", question_id: "q_sdd", internal_field: "make", answer_type: "enum", choices: CH, props: { placeholder: "Pick" } }, item: '[data-question-id="q_sdd"] .lg-dropdown' },
];

test.describe("R3 effect matrix (firefox real input)", () => {
  test("the widened Style-tab quad is HIDDEN for a non-consuming field type (honest gating)", async ({ page }) => {
    const s = await createSection(page.request, `R3 Gate ${uniq}`, [
      HEADLINE,
      { type: "NameFieldsGroup", question_id: "q_name", internal_field: "name", answer_type: "object" },
      { type: "ButtonAnswerGroup", question_id: "q_bag", internal_field: "cov", answer_type: "enum", choices: CH },
      CONT,
    ]);
    await boot(page, s);
    // consuming type → the size/appearance quad is shown
    await selectNode(page, "q_bag");
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator("[data-style-size-appearance]")).toBeVisible();
    await expect(page.locator("[data-corners-group]")).toBeVisible();
    // non-consuming type (NameFieldsGroup) → the quad is hidden
    await selectNode(page, "q_name");
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator("[data-style-size-appearance]")).toBeHidden();
  });

  for (const m of MATRIX) {
    test(`${m.type}: corners=pill ⇒ ${m.item} border-radius ${PILL_RADIUS}; border=accent ⇒ its border color ${ACCENT_RGB}`, async ({ page }) => {
      const s = await createSection(page.request, `R3 ${m.type} ${uniq}`, [HEADLINE, m.node, CONT]);
      await boot(page, s);
      await selectNode(page, m.qid);
      await openStyleTab(page);
      // CORNERS (strong: base radius 10px → pill 20px on the interactive item)
      await clickAndAssert(page, m.item, '[data-set-corners="pill"]', { borderRadius: PILL_RADIUS });
      // BORDER role (strong: base #D2D9E5 gray → accent #E85D26 — for dropdowns
      // via --lg-field-border, for buttons/cards via a direct border-color; the
      // computed borderColor resolves the same either way)
      await clickAndAssert(page, m.item, '[data-set-border-color="accent"]', { borderColor: ACCENT_RGB });
      await page.screenshot({ path: `${SHOT}/${m.type}.png` });
    });
  }

  test("ButtonAnswerGroup: width Full ⇒ the group carries the grounded width:100% (the one grounded width preset)", async ({ page }) => {
    const s = await createSection(page.request, `R3 WidthFull ${uniq}`, [HEADLINE, { type: "ButtonAnswerGroup", question_id: "q_bag", internal_field: "cov", answer_type: "enum", choices: CH }, CONT]);
    await boot(page, s);
    await selectNode(page, "q_bag");
    await openStyleTab(page);
    const group = frame(page).locator('[data-question-id="q_bag"]');
    // Before: no width override (a block group fills its column, but carries NO
    // inline width — computed width can't distinguish, so assert the INLINE
    // grounded value the preset writes).
    expect(await group.evaluate((el: HTMLElement) => el.style.width)).toBe("");
    await page.locator('[data-set-width="full"]').click();
    await expect.poll(async () => group.evaluate((el: HTMLElement) => el.style.width), { timeout: 8000 }).toBe("100%");
  });

  test("BLOCKER-1: EVERY size preset renders its grounded px — width on the group, height on the buttons (real clicks, expected-value)", async ({ page }) => {
    const s = await createSection(page.request, `R3 SizePresets ${uniq}`, [HEADLINE, { type: "ButtonAnswerGroup", question_id: "q_bag", internal_field: "cov", answer_type: "enum", choices: CH }, CONT]);
    await boot(page, s);
    await selectNode(page, "q_bag");
    await openStyleTab(page);
    const group = frame(page).locator('[data-question-id="q_bag"]');
    const item = frame(page).locator('[data-question-id="q_bag"] .lg-btn-answer').first();

    // WIDTH — each preset writes the group's inline width = the exact grounded
    // resolver output (300/384/480px, full=100%). Fail-before: on the pre-fix
    // resolver s/m/l emit nothing so this poll times out (group.style.width "").
    const WIDTH: Record<string, string> = { s: "300px", m: "384px", l: "480px", full: "100%" };
    for (const preset of ["s", "m", "l", "full"] as const) {
      await page.locator(`[data-set-width="${preset}"]`).click();
      await expect
        .poll(async () => group.evaluate((el: HTMLElement) => el.style.width), { timeout: 8000, message: `width=${preset} ⇒ ${WIDTH[preset]}` })
        .toBe(WIDTH[preset]);
    }

    // HEIGHT — each preset writes each button's inline min-height (44/52/60px).
    const HEIGHT: Record<string, string> = { small: "44px", medium: "52px", large: "60px" };
    for (const preset of ["small", "medium", "large"] as const) {
      await page.locator(`[data-set-height="${preset}"]`).click();
      await expect
        .poll(async () => item.evaluate((el: HTMLElement) => el.style.minHeight), { timeout: 8000, message: `height=${preset} ⇒ ${HEIGHT[preset]}` })
        .toBe(HEIGHT[preset]);
    }
    // …and the largest min-height actually TAKES EFFECT (computed box height ≥ 60px).
    await expect.poll(async () => Math.round((await item.boundingBox())!.height), { timeout: 8000 }).toBeGreaterThanOrEqual(60);
    await page.screenshot({ path: `${SHOT}/size-presets.png` });
  });

  test("ButtonAnswerGroup: a real drag on the E/W handle sets a custom width the group RENDERS at", async ({ page }) => {
    const s = await createSection(page.request, `R3 WidthDrag ${uniq}`, [HEADLINE, { type: "ButtonAnswerGroup", question_id: "q_bag", internal_field: "cov", answer_type: "enum", choices: CH }, CONT]);
    await boot(page, s);
    await selectNode(page, "q_bag");
    const group = frame(page).locator('[data-question-id="q_bag"]');
    const w0 = Math.round((await group.boundingBox())!.width);
    const handle = frame(page).locator('[data-width-handle][data-handle-side="right"]');
    await expect(handle).toBeVisible();
    const hb = (await handle.boundingBox())!;
    await realDrag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + hb.width / 2 - 100, y: hb.y + hb.height / 2 }, { steps: 6, settleMs: 800 });
    await expect.poll(async () => Math.round((await group.boundingBox())!.width), { timeout: 8000 }).not.toBe(w0);
    const w1 = Math.round((await group.boundingBox())!.width);
    expect(w1 % 4, "snapped to the 4px grid").toBe(0);
    expect(w1).toBeGreaterThanOrEqual(200);
    expect(w1).toBeLessThan(w0);
  });

  test("ButtonAnswerGroup: a real N/S drag sets a custom height the BUTTONS render at (min-height)", async ({ page }) => {
    // R5 full-bleed TALLER viewport (CONFIRMED needed, not a style choice —
    // root-caused by direct instrumentation, not a guess): at the default
    // Playwright "Desktop Firefox" 1280×720 viewport, this group's bottom
    // (S) resize handle measures y≈681 — only ~39px from the 720px viewport
    // floor. The test's +90px downward drag lands the final mouseup at
    // y≈777, PAST the viewport, where it has no element to dispatch to (the
    // drag mechanism itself never completes). Confirmed directly: the
    // identical drag at viewport height 1000 fires the mouseup correctly and
    // the button's rendered height actually changes (52px→240px, a real,
    // working resize) — the resize logic is unchanged and correct; only the
    // page's available height matters here, so the test's aim gets more
    // room, not the product.
    await page.setViewportSize({ width: 1280, height: 1000 });
    const s = await createSection(page.request, `R3 HeightDrag ${uniq}`, [HEADLINE, { type: "ButtonAnswerGroup", question_id: "q_bag", internal_field: "cov", answer_type: "enum", choices: CH }, CONT]);
    await boot(page, s);
    await selectNode(page, "q_bag");
    const btn = frame(page).locator('[data-question-id="q_bag"] .lg-btn-answer').first();
    const h0 = Math.round((await btn.boundingBox())!.height);
    const sHandle = frame(page).locator('[data-field-resize-handle][data-fr-hside="bottom"][data-fr-wside=""]');
    await expect(sHandle).toBeVisible();
    const hb = (await sHandle.boundingBox())!;
    await realDrag(page, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 + 90 }, { steps: 6, settleMs: 800 });
    await expect.poll(async () => Math.round((await btn.boundingBox())!.height), { timeout: 8000 }).not.toBe(h0);
    expect(Math.round((await btn.boundingBox())!.height) % 4).toBe(0);
  });

  test("S2-8/E1-NEW-9: the calendar leading icon renders as an SVG on a text field AND on Address", async ({ page }) => {
    const s = await createSection(page.request, `R3 Icons ${uniq}`, [
      HEADLINE,
      { type: "FreeTextQuestion", question_id: "q_txt", internal_field: "name", answer_type: "string", props: { icon: "calendar", placeholder: "x" } },
      { type: "AddressAutocompleteQuestion", question_id: "q_addr", internal_field: "addr", answer_type: "object", props: { icon: "calendar" } },
      CONT,
    ]);
    await boot(page, s);
    // Both fields render a leading-icon SVG (calendar). The only two
    // .lg-field-icon in this section are q_txt + q_addr, so the total is 2;
    // Address's icon is a descendant of its own data-question-id div (robust,
    // regardless of the studio's selection-wrap on the auto-selected text field).
    await expect(frame(page).locator(".lg-field-icon svg")).toHaveCount(2);
    await expect(frame(page).locator('[data-question-id="q_addr"] .lg-field-icon svg')).toHaveCount(1);
  });

  test("E1-NEW-8: helper text renders below a ButtonAnswerGroup", async ({ page }) => {
    const s = await createSection(page.request, `R3 Helper ${uniq}`, [
      HEADLINE,
      { type: "ButtonAnswerGroup", question_id: "q_bag", internal_field: "cov", answer_type: "enum", choices: CH, props: { helper: "We keep this private" } },
      CONT,
    ]);
    await boot(page, s);
    await expect(frame(page).locator('.lg-field-help', { hasText: "We keep this private" })).toHaveCount(1);
  });

  test("S2-4/S2-5/E1-NEW-2: the choices editor shows column labels, per-type gated fields, emoji + icon pickers, and an image thumbnail", async ({ page }) => {
    const s = await createSection(page.request, `R3 Choices ${uniq}`, [
      HEADLINE,
      { type: "ButtonAnswerGroup", question_id: "q_bag", internal_field: "cov", answer_type: "enum", choices: CH },
      { type: "IconCardAnswerGrid", question_id: "q_icg", internal_field: "kind", answer_type: "enum", choices: [{ label: "Home", value: "home", icon: "home", analytics_id: "h" }] },
      { type: "ImageCardAnswerGrid", question_id: "q_img", internal_field: "look", answer_type: "enum", choices: [{ label: "A", value: "a", imageMediaId: "https://example.com/a.png", image_alt: "A", analytics_id: "a" }] },
      CONT,
    ]);
    await boot(page, s);

    // ButtonAnswerGroup: ONLY label / value / analytics_id cells (gated); labeled.
    await selectNode(page, "q_bag");
    await page.locator('[data-studio-inspector-tab="content"]').click();
    const bagRow = page.locator("[data-inspector-choices] [data-choice-row]").first();
    await expect(bagRow.locator("[data-choice-cell]")).toHaveCount(3);
    await expect(bagRow.locator('.lg-choice-cell-label', { hasText: "Label" })).toHaveCount(1);
    await expect(bagRow.locator('.lg-choice-cell-label', { hasText: "Saved value" })).toHaveCount(1);
    await expect(bagRow.locator('.lg-choice-cell-label', { hasText: "Analytics ID" })).toHaveCount(1);
    // gated OUT: no emoji/icon/image cells for a plain button group
    await expect(bagRow.locator('[data-choice-cell="emoji"]')).toHaveCount(0);
    await expect(bagRow.locator('[data-choice-icon-select]')).toHaveCount(0);

    // IconCardAnswerGrid: the emoji palette + the 12-option icon SELECT exist,
    // PLUS the "Custom glyph…" escape hatch (R3a correction: choice.icon is
    // validated as ANY non-empty string in content-schema — no enum — so the
    // curated picker must not regress the pre-existing free-glyph convention).
    await selectNode(page, "q_icg");
    await page.locator('[data-studio-inspector-tab="content"]').click();
    const icgRow = page.locator("[data-inspector-choices] [data-choice-row]").first();
    await expect(icgRow.locator('[data-choice-cell="emoji"] [data-choice-emoji]').first()).toBeVisible();
    const iconSel = icgRow.locator('[data-choice-icon-select]');
    await expect(iconSel).toHaveCount(1);
    await expect(iconSel.locator("option")).not.toHaveCount(0);
    // the seeded choice's icon:"home" (a curated id) shows selected; the custom
    // glyph input stays hidden (this is the KNOWN branch, not custom).
    await expect(iconSel).toHaveValue("home");
    await expect(icgRow.locator("[data-choice-icon-custom]")).toBeHidden();

    // EFFECT 1: picking a DIFFERENT curated id re-renders the canvas card's icon
    // as the golden-style SVG (never invented CSS — the same FIELD_LEADING_ICON_SVGS
    // map the leading-icon feature uses).
    const cardIcon = frame(page).locator('[data-question-id="q_icg"] .lg-card-icon').first();
    await expect(cardIcon.locator("svg")).toHaveCount(1); // "home" already renders an SVG
    await iconSel.selectOption("car");
    await expect.poll(async () => cardIcon.locator("svg").count(), { timeout: 8000 }).toBe(1);

    // EFFECT 2: switching to "Custom glyph…" reveals the free-text input; typing
    // an arbitrary emoji (content-schema's genuinely-supported free-glyph case,
    // e.g. a business-type icon unrelated to the 12 curated ids) re-renders the
    // card's icon as the LITERAL glyph TEXT, not an SVG — proving the escape
    // hatch is real, not just present in the DOM.
    await iconSel.selectOption("__custom__");
    const customInput = icgRow.locator("[data-choice-icon-custom]");
    await expect(customInput).toBeVisible();
    await customInput.fill("\u{1F3E2}"); // 🏢 office building — not a curated id (Playwright's fill() fires a real input event — no dispatchEvent)
    await expect.poll(async () => cardIcon.locator("svg").count(), { timeout: 8000 }).toBe(0);
    await expect(cardIcon).toHaveText("\u{1F3E2}");

    // ImageCardAnswerGrid: the image cell shows a THUMBNAIL next to Choose….
    await selectNode(page, "q_img");
    await page.locator('[data-studio-inspector-tab="content"]').click();
    const imgRow = page.locator("[data-inspector-choices] [data-choice-row]").first();
    await expect(imgRow.locator("[data-choice-media-choose]")).toHaveCount(1);
    const thumb = imgRow.locator("[data-choice-thumb]");
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toBeVisible(); // a real src (the choice's imageMediaId URL) → not hidden
    await page.screenshot({ path: `${SHOT}/choices-editor.png` });
  });
});
