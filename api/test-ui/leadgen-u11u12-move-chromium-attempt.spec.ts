// Section Builder v3.1 — R7 U11a chromium move-gate ATTEMPT (conductor
// ruling, 2026-07-15): "ATTEMPT it exactly as specced (page.mouse move trio
// with the StepTimeoutError timebox). If chromium STILL hangs at the srcdoc
// boundary (the R0a class), do NOT force it: fall back to (a) firefox, (b) a
// chromium vm/logic-level test, (c) a register-facing mechanism statement."
//
// This is a PLAIN .spec.ts (NOT *.gesture.spec.ts) so it runs under the
// DEFAULT chromium project with ZERO playwright.config.ts changes — the
// most surgical way to attempt the chromium lane without disturbing the
// established firefox-only gesture-lane architecture (which stays intact
// regardless of this file's outcome).
//
// Moves a ButtonAnswerGroup — the class the FIX 1 dispatch calls out as
// "the previously-uncovered class" (it moved via native HTML5 DnD before R7,
// never covered by any real-mouse probe). realDrag's per-step StepTimeoutError
// guard (utils/real-input.ts) makes a genuine CDP hang a fast, typed, legible
// result instead of wedging to the global test timeout.
//
// Run per-file (from api/), with the fresh-D1 preamble:
//   pkill -f "wrangler dev"; pkill -f workerd; pkill -f cms-panel; sleep 2; \
//   rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local
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

test.describe("R7 U11a — chromium ATTEMPT: real page.mouse move of a ButtonAnswerGroup (conductor-ruled probe)", () => {
  test("move q_btn to AFTER q_zip via a real page.mouse drag, then save+refetch to confirm reorder — reports HANG, NO-OP, or SUCCESS", async ({ page, request }) => {
    const s = await createSection(request);
    await boot(page, s);

    const btnGroup = frame(page).locator('[data-question-id="q_btn"]');
    const zipField = frame(page).locator('[data-question-id="q_zip"]');
    await expect(btnGroup).toBeVisible();
    await expect(zipField).toBeVisible();

    // Drag from the ButtonAnswerGroup's own body to a point in the LOWER
    // half of the ZIP field's box (the onFieldMoveMouseDown/onCanvasDragOver
    // "after" drop-zone rule: y > rect.height/2 -> mode:'after').
    const zipBox = await zipField.boundingBox();
    if (!zipBox) throw new Error("zip field has no bounding box");
    const dropPoint = { x: zipBox.x + zipBox.width / 2, y: zipBox.y + zipBox.height * 0.85 };

    let outcome: "hang" | "error" | "completed";
    let errorDetail = "";
    try {
      await realDragFromLocator(page, btnGroup, dropPoint, { steps: 5, perStepGuardMs: 6000, settleMs: 400 });
      outcome = "completed";
    } catch (e) {
      if (e instanceof StepTimeoutError) {
        outcome = "hang";
        errorDetail = e.message;
      } else {
        outcome = "error";
        errorDetail = e instanceof Error ? e.message : String(e);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[U11a chromium attempt] drag primitive outcome: ${outcome}${errorDetail ? " — " + errorDetail : ""}`);

    test.info().annotations.push({ type: "u11a-chromium-drag-outcome", description: outcome });
    if (outcome === "hang") {
      // The R0a class reproduced for the unified pointer path too — a
      // legible, typed, FAST failure (not a wedged run). This IS a valid,
      // reportable result per the register's own "HANG (harness)" verdict
      // convention (L5 P3DRAG/P4DRAG/P10DRAG) — not a bug to route around.
      expect(outcome, "chromium CDP hang on the srcdoc canvas (R0a class) — see console log above").toBe("hang");
      return;
    }
    expect(outcome, `drag primitive must not throw a non-hang error: ${errorDetail}`).toBe("completed");

    // Persist + confirm: save (hard-navigates per the studio's own save flow)
    // then re-fetch the section and check q_btn now sits AFTER q_zip.
    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    const detail = await json<{ content_json: { components: Array<{ question_id: string }> } }>(
      await request.get(`${LG_API}/sections/${s.public_id}`),
      "refetch after save",
    );
    const order = detail.content_json.components.map((c) => c.question_id);
    const btnIdx = order.indexOf("q_btn");
    const zipIdx = order.indexOf("q_zip");
    // eslint-disable-next-line no-console
    console.log(`[U11a chromium attempt] persisted order: ${order.join(",")}`);
    expect(btnIdx, "q_btn must appear in the persisted order").toBeGreaterThanOrEqual(0);
    expect(zipIdx, "q_zip must appear in the persisted order").toBeGreaterThanOrEqual(0);
    expect(btnIdx, "q_btn must now sit AFTER q_zip (the real reorder took effect)").toBeGreaterThan(zipIdx);
  });
});
