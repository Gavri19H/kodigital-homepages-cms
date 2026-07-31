// Section Builder v3.1 — R7 U11a chromium POSITIVE move-gate (U13 fix,
// 2026-07-15). This file used to ATTEMPT the drag and ACCEPT a chromium
// StepTimeoutError "hang" as an expected result (the R0a-class CDP-limitation
// theory). The U13 root cause disproved that theory: the "hang" was Chromium
// not delivering a held-button page.mouse stream across a scripts-DISABLED
// (sandbox="allow-same-origin") srcdoc boundary — the SAME dead-drag the
// operator hit in real Chrome. After the sandbox+CSP fix (allow-scripts + a
// first-in-head script-src 'none' CSP, ui-section-studio.ts) the drag
// COMPLETES under Chromium, so this file is now a POSITIVE gate: the real
// page.mouse drag must complete (NO StepTimeoutError) and the reorder must
// persist. A hang here now means the U13 fix regressed — it is surfaced as a
// failure, never swallowed as "expected".
//
// This is a PLAIN .spec.ts (NOT *.gesture.spec.ts) so it runs ONLY under the
// chromium project (firefox's testMatch pins the gesture-only lane; this file
// is not in it) — a chromium-specific assertion of the U13 delivery fix,
// complementary to leadgen-u11u12-move.gesture.spec.ts which gates BOTH engines.
//
// Moves a ButtonAnswerGroup — the class the FIX 1 dispatch calls out as
// "the previously-uncovered class" (it moved via native HTML5 DnD before R7).
// Its choice-covered body is not directly grabbable, so the move gesture is
// armed on its NAME TAG (decorateFieldSelection) — select a choice to reveal
// it, then drag the tag (the same mechanism the cross-engine gate uses).
// realDrag's per-step StepTimeoutError guard (utils/real-input.ts) makes any
// regression-hang a fast, typed, legible failure.
//
// Run per-file (from api/), with the fresh-D1 preamble:
//   pkill -f "wrangler dev"; pkill -f workerd; pkill -f cms-panel; sleep 2; \
//   npm run db:reset:local
//   npx playwright test test-ui/leadgen-u11u12-move-chromium-attempt.spec.ts \
//     --project=chromium --workers=1 --reporter=line --timeout=60000
import { test, expect, type APIRequestContext, type Page, type FrameLocator } from "@playwright/test";
import { realDragFromLocator, StepTimeoutError } from "./utils/real-input";

const LG_API = "/api/admin/leadgen";
const uniq = Date.now();

async function json<T>(res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}
interface Created { id: number; public_id: string; }

async function createSection(request: APIRequestContext): Promise<Created> {
  return json<Created>(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: `u11a-chromium-attempt-${uniq}`,
        activity: `u11a-act-${uniq}`,
        vertical: `u11a-vert-${uniq}`,
        headline_text: "Pick your coverage",
        subheadline_text: "Choose one",
        continue_mode: "button",
        status: "active",
        content_json: {
          components: [
            { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
            {
              type: "ButtonAnswerGroup",
              question_id: "q_btn",
              internal_field: "coverage",
              answer_type: "enum",
              choices: [
                { label: "Basic", value: "basic", analytics_id: "b" },
                { label: "Full", value: "full", analytics_id: "f" },
              ],
            },
            {
              type: "ZIPInputQuestion",
              question_id: "q_zip",
              internal_field: "zip",
              answer_type: "string",
              props: { placeholder: "ZIP code" },
            },
            { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
          ],
        },
      },
    }),
    "section create",
  );
}

function frame(page: Page): FrameLocator {
  return page.frameLocator("#lg-studio-canvas-frame");
}
function canvas(page: Page) {
  return frame(page).locator("#lg-studio-canvas-render");
}
async function boot(page: Page, s: Created): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
  await expect(canvas(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 20_000 });
}

test.describe("R7 U11a — chromium POSITIVE gate: the U13 sandbox+CSP fix delivers held-button page.mouse streams (real drag completes + reorder persists)", () => {
  test("a real page.mouse drag of a ButtonAnswerGroup completes under chromium (NO StepTimeoutError) and persists q_btn AFTER q_zip", async ({ page, request }) => {
    const s = await createSection(request);
    await boot(page, s);

    // ButtonAnswerGroup is choice-bearing: its body is covered by choice cards
    // (onFieldMoveMouseDown skips them), so the move gesture is armed on its
    // NAME TAG (decorateFieldSelection). Selecting a choice ALSO selects the
    // group, so the tag renders — mirrors the cross-engine gate's mechanism.
    const anyChoice = frame(page).locator('[data-question-id="q_btn"] [data-lg-choice]').first();
    await anyChoice.click({ timeout: 8000 });
    const tag = frame(page).locator('[data-move-handle="q_btn"]');
    await expect(tag).toBeVisible({ timeout: 8000 });
    // P6 C2 (harness gap, measured — NOT a product change; the cross-engine
    // gate leadgen-u11u12-move.gesture.spec.ts carries the full diagnosis):
    // revealing the tag by clicking a choice also runs the product's own
    // §6.2/§6.4 focusChoiceRow, which scrollIntoView()s + focuses the matching
    // inspector row and drives the studio's BODY scroller (clientHeight 720,
    // scrollHeight 2357) to scrollTop 651 — at the default 1280x720 viewport
    // that puts this tag at page y=-63.1, ABOVE the viewport. toBeVisible()
    // still passes, but realDragFromLocator drives raw page.mouse at that box,
    // so mouse.down() is undeliverable and the drag never starts. Scrolling
    // the handle into view is the operator's own gesture; the drag below stays
    // a fully hit-tested page.mouse drag. The zip box is measured AFTER this
    // scroll on purpose — it moves with it.
    await tag.scrollIntoViewIfNeeded();

    const zipField = frame(page).locator('[data-question-id="q_zip"]');
    await expect(zipField).toBeVisible();
    // Drop in the LOWER half of the ZIP field's box (the onFieldMoveMouseDown
    // "after" drop-zone rule: y > rect.height/2 -> mode:'after').
    const zipBox = await zipField.boundingBox();
    if (!zipBox) throw new Error("zip field has no bounding box");
    const dropPoint = { x: zipBox.x + zipBox.width / 2, y: zipBox.y + zipBox.height * 0.85 };

    // THE U13 ASSERTION: this real held-button drag MUST complete under
    // Chromium. Pre-fix it hung at mouse.move(step 1/N) with a
    // StepTimeoutError; a hang here now = the U13 delivery fix regressed. We
    // catch ONLY StepTimeoutError so the regression is asserted legibly (any
    // other error still propagates).
    let hung: StepTimeoutError | null = null;
    try {
      await realDragFromLocator(page, tag, dropPoint, { steps: 5, perStepGuardMs: 8000, settleMs: 500 });
    } catch (e) {
      if (e instanceof StepTimeoutError) {
        hung = e;
      } else {
        throw e;
      }
    }
    expect(
      hung,
      hung ? `U13 REGRESSION — chromium held-button drag HUNG: ${hung.message}` : "drag completed under chromium",
    ).toBeNull();

    // Persist + confirm the reorder actually took effect (save hard-navigates
    // per the studio's own save flow; then re-fetch and check order).
    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    const detail = await json<{ content_json: { components: Array<{ question_id: string }> } }>(
      await request.get(`${LG_API}/sections/${s.public_id}`),
      "refetch after save",
    );
    const order = detail.content_json.components.map((c) => c.question_id);
    const btnIdx = order.indexOf("q_btn");
    const zipIdx = order.indexOf("q_zip");
    expect(btnIdx, `q_btn must appear in the persisted order: ${order.join(",")}`).toBeGreaterThanOrEqual(0);
    expect(zipIdx, `q_zip must appear in the persisted order: ${order.join(",")}`).toBeGreaterThanOrEqual(0);
    expect(btnIdx, `q_btn must now sit AFTER q_zip (the real reorder took effect) — persisted order: ${order.join(",")}`).toBeGreaterThan(zipIdx);
  });
});
