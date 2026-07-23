// Section Builder v3.1 REMEDIATION — phase R2 (canvas interaction real).
// THE PHASE GATE: real, hit-tested page.mouse gestures against the studio's
// srcdoc canvas, driven under Playwright FIREFOX (*.gesture.spec.ts → the
// firefox project; register R0a proved raw page.mouse drags COMPLETE there
// where chromium/CDP hangs on the nested srcdoc iframe). ZERO dispatchEvent —
// synthetic input is inadmissible (register root rule / M1). Uses the R0
// helpers (utils/real-input realDrag + utils/effect-assert assertOverlayAligned).
//
// Run per-file only (from api/), with the fresh-D1 preamble the mission's
// Playwright ops mandate:
//   pkill -f "wrangler dev"; pkill -f workerd; pkill -f cms-panel; sleep 2; \
//   npm run db:reset:local
//   npx playwright test test-ui/leadgen-canvas-interactions.gesture.spec.ts \
//     --workers=1 --reporter=line --timeout=120000
//
// Boot pattern mirrors r0a-drag-spike.spec.ts (seed a Section through the real
// admin API, open its /edit studio). webServer (wrangler dev :<PW_PORT>,
// default 8787, DEV_BYPASS_AUTH) is launched by playwright.config.
import { test, expect, type APIRequestContext, type Page, type FrameLocator } from "@playwright/test";
import { realDrag, type Box } from "./utils/real-input";
import { assertOverlayAligned, computeOverlayAlignment, type RectLike } from "./utils/effect-assert";
import { PW_PORT } from "./utils/base-url";

const BASE = `http://127.0.0.1:${PW_PORT}`;
const LG_API = "/api/admin/leadgen";
const SHOT = "test-artifacts/r2-canvas-interactions";
const uniq = Date.now();

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
        activity: `r2-act-${uniq}`,
        vertical: `r2-vert-${uniq}`,
        headline_text: "What is your ZIP code?",
        subheadline_text: "Rates vary by ZIP",
        continue_mode: "button",
        status: "active",
        content_json: { components },
      },
    }),
    `section create (${name})`,
  );
}

const HEADLINE = { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" };
const SUBHEAD = { type: "Subheadline", question_id: "q_sub", bind: "section_subheadline" };
const CONT = { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } };
const ZIP = { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string", props: { placeholder: "ZIP code" } };

function frame(page: Page): FrameLocator { return page.frameLocator("#lg-studio-canvas-frame"); }
function canvas(page: Page) { return frame(page).locator("#lg-studio-canvas-render"); }
async function boot(page: Page, s: Created): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
  await expect(canvas(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 20_000 });
}
// 600-column recalibration (2026-07-15, content.maxWidth 500->600px — the
// golden's own composition column, contract §7.1): the canvas iframe's OWN
// page-level boundingBox, used to clamp gesture-drag targets so a hardcoded
// delta can never overshoot the canvas when the content column widens (see
// clampPointToBox in utils/real-input.ts for the incident this guards
// against — proven by bisect in the sibling u11u12-move gate).
async function canvasFrameBox(page: Page): Promise<Box> {
  const box = await page.locator("#lg-studio-canvas-frame").boundingBox();
  if (!box) throw new Error("canvas frame has no bounding box");
  return box;
}
function box2rect(b: { x: number; y: number; width: number; height: number } | null): RectLike {
  if (!b) throw new Error("element has no bounding box (not laid out / not visible)");
  return { x: b.x, y: b.y, width: b.width, height: b.height };
}
// The field's outline is the FIRST div[data-selection-chrome] inside its wrap.
function outlineOf(page: Page, qid: string) {
  return frame(page).locator(`[data-question-id="${qid}"]`).locator("xpath=..").locator("div[data-selection-chrome]").first();
}
async function selectNode(page: Page, qid: string): Promise<void> {
  // A plain, non-forced Locator.click() — a REAL, hit-tested pointer event
  // (M1-compliant). The selection OUTLINE/handles the product paints over a
  // selected field are ALL pointer-events:none (decorateFieldSelection), so
  // even an already-selected field's chrome never intercepts the click —
  // confirmed empirically (a real click here reaches the field directly,
  // selected or not; force:true is not needed and was removed — see the R2
  // adversarial-review MINOR finding #4: an earlier comment here described a
  // "pointer-events:auto outline drag surface (data-drag-qid)" that predates
  // the S1-5/S1-6 refactor onto the field element itself and no longer exists).
  await frame(page).locator(`[data-question-id="${qid}"]`).click({ timeout: 8000 });
  await expect(outlineOf(page, qid)).toBeVisible({ timeout: 8000 });
}
async function customBadgePx(page: Page): Promise<number | null> {
  const badge = frame(page).locator("text=/≈ \\d+ px · custom/");
  if ((await badge.count()) === 0) return null;
  const m = (await badge.first().textContent())?.match(/≈ (\d+) px/);
  return m ? Number(m[1]) : null;
}

// ---- The alignment section: ≥7 field-chrome types, incl. helper + icon -----
const ALIGN_TYPES: Array<{ qid: string; node: Record<string, unknown> }> = [
  { qid: "q_text", node: { type: "FreeTextQuestion", question_id: "q_text", internal_field: "full_name", answer_type: "string", props: { placeholder: "Your name", helper: "As printed on your policy", icon: "location" } } },
  { qid: "q_zip", node: ZIP },
  { qid: "q_email", node: { type: "EmailInputQuestion", question_id: "q_email", internal_field: "email", answer_type: "string", props: { placeholder: "you@example.com", helper: "We never share it" } } },
  { qid: "q_drop", node: { type: "DropdownQuestion", question_id: "q_drop", internal_field: "us_state", answer_type: "enum", choices: [{ label: "California", value: "ca", analytics_id: "ca" }, { label: "New York", value: "ny", analytics_id: "ny" }], props: { placeholder: "Select a state" } } },
  { qid: "q_range", node: { type: "NumberRangeQuestion", question_id: "q_range", internal_field: "coverage_amt", answer_type: "number", props: { min: 0, max: 100000, step: 5000, default: 0, currency_affix: true } } },
  { qid: "q_btn", node: { type: "ButtonAnswerGroup", question_id: "q_btn", internal_field: "coverage", answer_type: "enum", choices: [{ label: "Basic", value: "basic", analytics_id: "b" }, { label: "Full", value: "full", analytics_id: "f" }] } },
  { qid: "q_cur", node: { type: "CurrencyInputQuestion", question_id: "q_cur", internal_field: "income", answer_type: "currency", props: { placeholder: "0", currency: "$" } } },
  { qid: "q_addr", node: { type: "AddressAutocompleteQuestion", question_id: "q_addr", internal_field: "street", answer_type: "object", props: { placeholder: "Street address" } } },
  { qid: "q_img", node: { type: "ImageBlock", question_id: "q_img", props: { source: "auto_logo", siteName: "Acme", accent: "Quotes" } } },
];

test.describe("R2 canvas interactions (firefox real input)", () => {
  test("(i) selection overlay tracks the field within ≤4px on x/y/w/h across ≥7 component types (incl. helper + leading icon)", async ({ page }) => {
    const s = await createSection(page.request, `R2 Align ${uniq}`, [HEADLINE, SUBHEAD, ...ALIGN_TYPES.map((t) => t.node), CONT]);
    await boot(page, s);
    let measured = 0;
    const worst: string[] = [];
    for (const t of ALIGN_TYPES) {
      const field = frame(page).locator(`[data-question-id="${t.qid}"]`);
      if ((await field.count()) === 0) continue;
      await selectNode(page, t.qid);
      const fieldRect = box2rect(await field.boundingBox());
      const outlineRect = box2rect(await outlineOf(page, t.qid).boundingBox());
      const r = computeOverlayAlignment(fieldRect, outlineRect, 4);
      worst.push(`${t.qid}: dx=${r.dx} dy=${r.dy} dw=${r.dw} dh=${r.dh}`);
      assertOverlayAligned(fieldRect, outlineRect, 4); // throws with per-axis deltas if any |·|>4
      measured += 1;
    }
    await page.screenshot({ path: `${SHOT}/i-alignment.png` });
    expect(measured, `measured ≥7 field-chrome types; deltas: ${worst.join(" | ")}`).toBeGreaterThanOrEqual(7);
    // the helper+icon field (which broke the old hardcoded overlay) is proven
    expect(worst.some((w) => w.startsWith("q_text:"))).toBe(true);
  });

  test("(ii) a real E/W width drag writes a snapped, clamped custom_px + shows the Custom chip", async ({ page }) => {
    // R5 full-bleed WIDER viewport (CONFIRMED needed, not a style choice — root-
    // caused by direct instrumentation, not a guess): the R5 full-bleed shell
    // (no admin sidebar) shifts the whole studio, including this ZIP field's
    // right-edge width handle, further right on the page than the default
    // Playwright "Desktop Firefox" 1280×720 viewport leaves room for. A +90px
    // rightward drag from the handle's measured x≈1223 lands at x≈1313 — PAST
    // the 1280px viewport edge, where the final mouseup has no element to
    // dispatch to. Confirmed directly: temporary console.log instrumentation in
    // onWidthHandleMouseDown/finishUp showed onMoveInner firing correctly (6×)
    // but neither onUpInner nor onUpOuter ever firing at the default viewport —
    // the exact same drag at 1600×900 fires onUpInner, runs finishUp, and the
    // field's rendered width changes (452px→544px, a real, working resize). The
    // drag mechanism itself is unchanged and correct; only the CANVAS'S
    // resulting page position moved (a legitimate consequence of the ratified
    // full-bleed rebuild), so the test's aim gets more room, not the product.
    await page.setViewportSize({ width: 1600, height: 900 });
    const s = await createSection(page.request, `R2 Width ${uniq}`, [HEADLINE, ZIP, CONT]);
    await boot(page, s);
    await selectNode(page, "q_zip");
    expect(await customBadgePx(page)).toBeNull(); // no custom yet
    const zip = frame(page).locator('[data-question-id="q_zip"]');
    const widthBefore = Math.round((await zip.boundingBox())!.width);
    const handle = frame(page).locator('[data-width-handle][data-handle-side="right"]');
    const hb = (await handle.boundingBox())!;
    const y = hb.y + hb.height / 2;
    const cx = hb.x + hb.width / 2;
    // 600-column recalibration (2026-07-15, content.maxWidth 500->600): drag
    // INWARD (-90, was +90) — every assertion below is direction-agnostic
    // (a snapped/clamped custom_px write + a real WIDTH CHANGE, not
    // specifically an increase); a rightward drag now overshoots the wider
    // canvas. clampToBox is belt-and-suspenders (see real-input.ts).
    await realDrag(page, { x: cx, y }, { x: cx - 90, y }, { steps: 5, settleMs: 700, clampToBox: await canvasFrameBox(page) });
    const px = await customBadgePx(page);
    expect(px, "width custom badge shows a real number after the drag").not.toBeNull();
    expect(px! % 4, "snapped to the 4px grid").toBe(0);
    expect(px!).toBeGreaterThanOrEqual(200);
    expect(px!).toBeLessThanOrEqual(600);
    // the Custom chip in the Style tab is now shown (deselecting every preset)
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator("[data-width-custom-chip]")).toBeVisible();
    await expect.poll(async () => Math.round((await zip.boundingBox())!.width)).toBe(px);
    expect(Math.abs(px! - widthBefore)).toBeGreaterThan(0);
  });

  test("(iii) a real N/S height drag writes a height custom_px + shows the height Custom chip + Reset", async ({ page }) => {
    // Consolidated fix round (register PC-3, root-caused by direct measurement,
    // not a guess): P1a's inter-component rhythm (spacing.stack, the U12
    // golden gaps) pushes every element further DOWN the page than before —
    // this test's own S-handle now measures y≈651.6 in a 720px-tall default
    // viewport, and the drag's final target (handle-center + 70) lands at
    // y≈727, PAST the viewport's bottom edge, where the mouseup has nowhere to
    // land (confirmed via temporary boundingBox instrumentation). Same root
    // cause + same remediation as tests (ii)/(vi) above (R5 full-bleed pushed
    // the WIDTH handle out of the default viewport; this is the IDENTICAL
    // class of bug, vertical this time, from the ratified P1a rhythm change) —
    // the drag mechanism itself is unchanged/correct, only the page's resulting
    // vertical position moved, so the test's aim needs more room, not the
    // product. Reusing the SAME already-established 1600×900 viewport (not a
    // new arbitrary size) keeps this consistent with the existing precedent.
    await page.setViewportSize({ width: 1600, height: 900 });
    const s = await createSection(page.request, `R2 Height ${uniq}`, [HEADLINE, ZIP, CONT]);
    await boot(page, s);
    await selectNode(page, "q_zip");
    const zip = frame(page).locator('[data-question-id="q_zip"]');
    const heightBefore = Math.round((await zip.boundingBox())!.height);
    // the mid-S (bottom-edge) handle: height-only (wSide empty, hSide bottom)
    const sHandle = frame(page).locator('[data-field-resize-handle][data-fr-hside="bottom"][data-fr-wside=""]');
    await expect(sHandle).toBeVisible();
    const hb = (await sHandle.boundingBox())!;
    const x = hb.x + hb.width / 2;
    const cy = hb.y + hb.height / 2;
    await realDrag(page, { x, y: cy }, { x, y: cy + 70 }, { steps: 5, settleMs: 700 });
    // the field's rendered height changed to a snapped, clamped custom_px
    // (presets.ts sizeAxisCssValue renders height custom_px as inline height)
    await expect.poll(async () => Math.round((await zip.boundingBox())!.height), { timeout: 8000 }).not.toBe(heightBefore);
    const hAfter = Math.round((await zip.boundingBox())!.height);
    expect(hAfter % 4, "height snapped to the 4px grid").toBe(0);
    expect(hAfter).toBeGreaterThanOrEqual(4);
    expect(hAfter).toBeLessThanOrEqual(600);
    // the inspector height Custom chip + Reset twin appear
    await page.locator('[data-studio-inspector-tab="style"]').click();
    await expect(page.locator("[data-height-custom-chip]")).toBeVisible();
    await expect(page.locator("[data-reset-height]")).toBeVisible();
    await page.screenshot({ path: `${SHOT}/iii-height.png` });
  });

  test("(iv) a real corner drag changes BOTH width and height", async ({ page }) => {
    // Consolidated fix round (register PC-3) — same root cause as (iii) above:
    // the SE-handle's y (≈651.6 in the default 720px viewport) plus this
    // drag's own +60 delta lands at y≈717, within 3px of the viewport's bottom
    // edge — margin thin enough that Firefox's own layout-metric differences
    // from the diagnostic measurement (taken on chromium) tip it over. Same
    // remediation as (ii)/(iii)/(vi): widen to the already-established
    // 1600×900 viewport (the drag mechanism is unchanged; only the page's
    // resulting vertical position moved, from the ratified P1a rhythm change).
    await page.setViewportSize({ width: 1600, height: 900 });
    const s = await createSection(page.request, `R2 Corner ${uniq}`, [HEADLINE, ZIP, CONT]);
    await boot(page, s);
    await selectNode(page, "q_zip");
    const zip = frame(page).locator('[data-question-id="q_zip"]');
    const b0 = (await zip.boundingBox())!;
    const w0 = Math.round(b0.width);
    const h0 = Math.round(b0.height);
    // the SE corner handle: width(right) + height(bottom)
    const se = frame(page).locator('[data-field-resize-handle][data-fr-wside="right"][data-fr-hside="bottom"]');
    await expect(se).toBeVisible();
    const hb = (await se.boundingBox())!;
    const cx = hb.x + hb.width / 2;
    const cy = hb.y + hb.height / 2;
    await realDrag(page, { x: cx, y: cy }, { x: cx - 120, y: cy + 60 }, { steps: 6, settleMs: 700 });
    await expect
      .poll(async () => {
        const b = (await zip.boundingBox())!;
        return Math.round(b.width) !== w0 && Math.round(b.height) !== h0;
      }, { timeout: 8000 })
      .toBe(true);
    const b1 = (await zip.boundingBox())!;
    expect(Math.round(b1.width) % 4).toBe(0);
    expect(Math.round(b1.height) % 4).toBe(0);
  });

  test("(v) a real mouse drag on the SELECTED field BODY moves/reorders it", async ({ page }) => {
    // Consolidated fix round (register PC-3) — same root cause as (iii)/(iv):
    // this fixture's q_after target (headline+sub+zip ahead of it) measures
    // afterBox.y≈675 in the default 720px viewport, and the drop point
    // (afterBox.y + height*0.75) lands at y≈715.6 — within 5px of the bottom
    // edge, the same thin margin that tips over under Firefox's own layout
    // metrics. Same remediation: widen to the established 1600×900 viewport
    // (the move/reorder mechanism is unchanged; only the page's resulting
    // vertical position moved, from the ratified P1a rhythm change).
    await page.setViewportSize({ width: 1600, height: 900 });
    const s = await createSection(page.request, `R2 Move ${uniq}`, [HEADLINE, ZIP, { type: "FreeTextQuestion", question_id: "q_after", internal_field: "note", answer_type: "string", props: { placeholder: "Note" } }, CONT]);
    await boot(page, s);
    const order = () => canvas(page).evaluate((root) => Array.from(root.querySelectorAll("[data-question-id]")).map((e) => e.getAttribute("data-question-id")));
    const before = await order();
    expect(before.indexOf("q_zip")).toBeLessThan(before.indexOf("q_after")); // zip precedes q_after
    await selectNode(page, "q_zip");
    // drag the field BODY itself DOWN past q_after — ZIP is a bare-input
    // field-chrome type, so onFieldMoveMouseDown is armed directly on its
    // <input> (decorateFieldSelection); the outline stays pointer-events:none
    // throughout and never participates in the gesture.
    const zipBox = (await frame(page).locator('[data-question-id="q_zip"]').boundingBox())!;
    const afterBox = (await frame(page).locator('[data-question-id="q_after"]').boundingBox())!;
    const from = { x: zipBox.x + zipBox.width / 2, y: zipBox.y + zipBox.height / 2 };
    const to = { x: afterBox.x + afterBox.width / 2, y: afterBox.y + afterBox.height * 0.75 };
    await realDrag(page, from, to, { steps: 6, settleMs: 800 });
    await expect
      .poll(async () => {
        const o = await order();
        return o.indexOf("q_zip") > o.indexOf("q_after");
      }, { timeout: 8000 })
      .toBe(true);
    await page.screenshot({ path: `${SHOT}/v-move.png` });
  });

  test("(vi) a drag that STARTS on a handle RESIZES (never moves)", async ({ page }) => {
    // R5 full-bleed WIDER viewport — same root cause as test (ii) above (see
    // its comment for the full instrumented diagnosis): this test's drag off
    // the SAME width handle needs the same extra room.
    await page.setViewportSize({ width: 1600, height: 900 });
    const s = await createSection(page.request, `R2 HandleVsMove ${uniq}`, [HEADLINE, ZIP, { type: "FreeTextQuestion", question_id: "q_after", internal_field: "note", answer_type: "string", props: { placeholder: "Note" } }, CONT]);
    await boot(page, s);
    const order = () => canvas(page).evaluate((root) => Array.from(root.querySelectorAll("[data-question-id]")).map((e) => e.getAttribute("data-question-id")));
    const before = await order();
    await selectNode(page, "q_zip");
    const handle = frame(page).locator('[data-width-handle][data-handle-side="right"]');
    const hb = (await handle.boundingBox())!;
    const y = hb.y + hb.height / 2;
    const cx = hb.x + hb.width / 2;
    // 600-column recalibration (2026-07-15, content.maxWidth 500->600): drag
    // INWARD (-80, was +80) — this test only asserts A resize occurred
    // (direction-agnostic); a rightward drag now overshoots the wider
    // canvas. clampToBox is belt-and-suspenders (see real-input.ts).
    await realDrag(page, { x: cx, y }, { x: cx - 80, y }, { steps: 5, settleMs: 700, clampToBox: await canvasFrameBox(page) });
    // a width custom_px was committed (the resize happened)…
    expect(await customBadgePx(page)).not.toBeNull();
    // …and NO reorder occurred (the gesture resized, it did not move the node)
    expect(await order()).toEqual(before);
  });

  test("(vii) a handle CLICK (no drag) keeps the selection", async ({ page }) => {
    const s = await createSection(page.request, `R2 HandleClick ${uniq}`, [HEADLINE, ZIP, CONT]);
    await boot(page, s);
    await selectNode(page, "q_zip");
    const handle = frame(page).locator('[data-width-handle][data-handle-side="right"]');
    await handle.click({ timeout: 8000 }); // a trusted click with NO movement
    // the field stays selected — its outline is still present (a deselect would
    // remove all selection chrome). No bogus custom_px written by the click.
    await expect(outlineOf(page, "q_zip")).toBeVisible();
    expect(await customBadgePx(page)).toBeNull();
  });

  test("(viii) dblclick edits a text field's placeholder; a DATE field is EXCLUDED (native behavior kept)", async ({ page }) => {
    const s = await createSection(page.request, `R2 Inline ${uniq}`, [
      HEADLINE,
      { type: "FreeTextQuestion", question_id: "q_text", internal_field: "full_name", answer_type: "string", props: { placeholder: "Old placeholder" } },
      { type: "DateQuestion", question_id: "q_date", internal_field: "dob", answer_type: "string", props: { placeholder: "DATE-KEEPS-THIS" } },
      CONT,
    ]);
    await boot(page, s);
    const textField = frame(page).locator('[data-question-id="q_text"]');
    // dblclick the text field body → placeholder edit; type a new placeholder,
    // commit. A plain (non-forced) dblclick — q_text is the auto-selected
    // first answer node, but its selection outline is pointer-events:none
    // (decorateFieldSelection), so the dblclick reaches the <input> directly;
    // onCanvasDblClick resolves it via closest('[data-question-id]') and
    // routes to the placeholder edit (startPlaceholderEdit).
    await textField.dblclick({ timeout: 8000 });
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.type("New placeholder");
    await page.keyboard.press("Enter");
    await expect.poll(async () => textField.getAttribute("placeholder"), { timeout: 8000 }).toBe("New placeholder");

    // dblclick the DATE field → NOT edited (inlineEditKeyFor returns null →
    // no preventDefault, no placeholder swap); its placeholder is untouched.
    const dateField = frame(page).locator('[data-question-id="q_date"]');
    await selectNode(page, "q_date");
    await dateField.dblclick({ timeout: 8000 });
    await page.keyboard.type("SHOULD-NOT-STICK");
    await page.keyboard.press("Enter");
    // unchanged — the date field never entered the placeholder-edit path
    expect(await dateField.getAttribute("placeholder")).toBe("DATE-KEEPS-THIS");
  });

  test("(ix) headline inline edit still works (bound → writes the strip store)", async ({ page }) => {
    const s = await createSection(page.request, `R2 Headline ${uniq}`, [HEADLINE, SUBHEAD, ZIP, CONT]);
    await boot(page, s);
    const headline = canvas(page).locator('[data-question-id="q_head"], .lg-headline').first();
    await headline.dblclick({ timeout: 8000 });
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.type("Edited headline copy");
    await page.keyboard.press("Enter");
    // the bound headline commits to the canonical strip input (§5.2 one store)
    await expect.poll(async () => page.locator("#lg-section-headline").inputValue(), { timeout: 8000 }).toContain("Edited headline");
  });

  test("(x) R2 adversarial-review MAJOR fix #1: a non-size-consuming type (NameFieldsGroup — R3a widened ButtonAnswerGroup into the consuming set, so the non-consuming example moved to a still-non-consuming field type) keeps selection chrome but has NO resize handle to grab; a drag attempt at the would-be handle position writes nothing and changes nothing", async ({ page }) => {
    const s = await createSection(page.request, `R2 NonConsuming ${uniq}`, [
      HEADLINE,
      { type: "NameFieldsGroup", question_id: "q_name", internal_field: "name", answer_type: "object" },
      CONT,
    ]);
    await boot(page, s);
    await selectNode(page, "q_name");

    // the alignment contract still holds (chrome for ALL field-chrome types) —
    // the measured outline tracks the field within tolerance exactly like a
    // consuming type would.
    const field = frame(page).locator('[data-question-id="q_name"]');
    const fieldRect = box2rect(await field.boundingBox());
    const outlineRect = box2rect(await outlineOf(page, "q_name").boundingBox());
    assertOverlayAligned(fieldRect, outlineRect, 4);

    // NOTHING to grab: zero resize-handle locators for this node (the inert
    // look-alike carries none of the grabbable data-attributes).
    const wrap = field.locator("xpath=..");
    await expect(wrap.locator("[data-field-resize-handle]")).toHaveCount(0);
    await expect(wrap.locator("[data-width-handle]")).toHaveCount(0);
    await expect(wrap.locator("[data-fr-wside]")).toHaveCount(0);

    // A real drag attempt at the position a corner handle WOULD occupy for a
    // consuming type (just outside the field's top-left corner) changes
    // NOTHING: no cursor to grab, nothing armed, so this is an ordinary
    // no-op gesture over inert chrome.
    const startX = fieldRect.x - 3;
    const startY = fieldRect.y - 3;
    const widthBefore = Math.round(fieldRect.width);
    const heightBefore = Math.round(fieldRect.height);
    await realDrag(page, { x: startX, y: startY }, { x: startX + 80, y: startY + 60 }, { steps: 5, settleMs: 700 });

    // no Custom badge (a consuming type's drag would show one; this type
    // must never show one, regardless of what the gesture did or didn't hit)
    expect(await customBadgePx(page), "no Custom badge appears for a non-consuming type").toBeNull();
    // the field's rendered box is byte-identical before/after
    const fieldRectAfter = box2rect(await field.boundingBox());
    expect(Math.round(fieldRectAfter.width), "width unchanged").toBe(widthBefore);
    expect(Math.round(fieldRectAfter.height), "height unchanged").toBe(heightBefore);

    // the deepest proof: SAVE (hard-navigates, the established idiom) then
    // re-fetch the persisted content_json — the NameFieldsGroup node must
    // carry NO design_overrides.size at all. A phantom write that the canvas
    // merely fails to RENDER would still show up here; this proves no write
    // ever reached the model, not just that the render looks unchanged.
    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    const detail = await json<{ content_json: { components: Array<{ question_id: string; design_overrides?: { size?: unknown } }> } }>(
      await page.request.get(`${LG_API}/sections/${s.public_id}`),
      "post-drag section detail",
    );
    const nameNode = detail.content_json.components.find((c) => c.question_id === "q_name");
    expect(nameNode, "the NameFieldsGroup node round-trips").toBeTruthy();
    expect(nameNode?.design_overrides?.size, "no design_overrides.size was ever written").toBeUndefined();
    await page.screenshot({ path: `${SHOT}/x-non-consuming.png` });
  });
});
