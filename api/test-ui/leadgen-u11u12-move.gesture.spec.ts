// Section Builder v3.1 REMEDIATION — R7 U11a canvas move unification, THE GATE.
//
// Conductor ruling (2026-07-15): the chromium ATTEMPT (see the sibling
// leadgen-u11u12-move-chromium-attempt.spec.ts, a plain .spec.ts on the
// default chromium project) reproduced the R0a class — a real page.mouse
// sequence hangs at "mouse.move(step 1/5)" into the srcdoc canvas iframe,
// BOTH before and after this fix (the hang is a CDP + nested-iframe
// limitation on the MOVE PRIMITIVE itself, independent of native-DnD vs
// pointer-events). Per the conductor's explicit fallback: this file — the
// FIREFOX real-gesture trio — is THE automated gate. real page.mouse drags
// (down -> stepped moves -> up, utils/real-input realDragFromLocator) are
// genuinely hit-tested under Firefox/Juggler (no CDP) — an occluded/inert
// handle would fail here; nothing is dispatchEvent-based (register root
// rule / M1).
//
// Moves THREE previously-native-DnD-only types (now unified onto the ONE
// delegated pointer gesture, onFieldMoveMouseDown):
//   - ButtonAnswerGroup (the dispatch's named class; a choice-group root)
//   - TextBlock (a content primitive — "the previously-uncovered class")
//   - ZIPInputQuestion (a bare-input field — ALREADY worked pre-fix via its
//     OWN per-field mousedown binding; now covered by the SAME generalized,
//     delegated mechanism instead of a per-field one — proves no regression)
// Each move is asserted in the SAVED model (persisted content_json via the
// Section's own save+refetch flow), matching the dispatch's own acceptance
// wording ("asserting reorder in the saved model").
//
// FAIL-BEFORE/PASS-AFTER (ButtonAnswerGroup, the class that changed
// mechanism from native DnD to the delegated pointer path): run once against
// the UNFIXED code (temporarily revert FIX 1 — see the conductor dispatch
// notes) to confirm a real RED (native DnD does not respond to a raw
// page.mouse sequence in ANY browser — a well-known Playwright/browser
// limitation, not a hang), then green after the fix. Recorded in the
// conductor's report, not re-executed on every CI run (this file always
// exercises the FIXED code going forward).
//
// Run per-file (from api/), with the fresh-D1 preamble:
//   pkill -f "wrangler dev"; pkill -f workerd; pkill -f cms-panel; sleep 2; \
//   rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local
//   npx playwright test test-ui/leadgen-u11u12-move.gesture.spec.ts \
//     --project=firefox --workers=1 --reporter=line --timeout=120000
import { test, expect, type APIRequestContext, type Page, type FrameLocator } from "@playwright/test";
import { realDragFromLocator, type Box } from "./utils/real-input";

const LG_API = "/api/admin/leadgen";
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
        activity: `u11a-act-${uniq}`,
        vertical: `u11a-vert-${uniq}`,
        headline_text: "Pick your coverage",
        subheadline_text: "Choose one",
        continue_mode: "button",
        status: "active",
        content_json: { components },
      },
    }),
    `section create (${name})`,
  );
}

function frame(page: Page): FrameLocator {
  return page.frameLocator("#lg-studio-canvas-frame");
}
function canvas(page: Page) {
  return frame(page).locator("#lg-studio-canvas-render");
}
// 600-column recalibration (2026-07-15, content.maxWidth 500->600px — the
// golden's own composition column, contract §7.1): the canvas iframe's OWN
// page-level boundingBox, used to clamp gesture-drag targets so a hardcoded
// delta can never overshoot the canvas when the content column widens (see
// clampPointToBox in utils/real-input.ts for the incident — bisect-proven —
// this guards against).
async function canvasFrameBox(page: Page): Promise<Box> {
  const box = await page.locator("#lg-studio-canvas-frame").boundingBox();
  if (!box) throw new Error("canvas frame has no bounding box");
  return box;
}
async function boot(page: Page, s: Created): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${s.public_id}/edit`, { waitUntil: "domcontentloaded" });
  await expect(canvas(page).locator("[data-question-id]").first()).toBeVisible({ timeout: 20_000 });
}

async function moveAndPersist(
  page: Page,
  request: APIRequestContext,
  sectionPublicId: string,
  moveQid: string,
  targetQid: string,
): Promise<string[]> {
  const moveEl = frame(page).locator(`[data-question-id="${moveQid}"]`);
  const targetEl = frame(page).locator(`[data-question-id="${targetQid}"]`);
  await expect(moveEl).toBeVisible();
  await expect(targetEl).toBeVisible();
  const targetBox = await targetEl.boundingBox();
  if (!targetBox) throw new Error(`${targetQid} has no bounding box`);
  // drop in the LOWER half of the target -> onFieldMoveMouseDown's
  // trackAt() computes mode:'after' (y > rect.height/2).
  const dropPoint = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height * 0.85 };
  await realDragFromLocator(page, moveEl, dropPoint, { steps: 5, perStepGuardMs: 8000, settleMs: 500 });

  await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
  const detail = await json<{ content_json: { components: Array<{ question_id: string }> } }>(
    await request.get(`${LG_API}/sections/${sectionPublicId}`),
    "refetch after save",
  );
  return detail.content_json.components.map((c) => c.question_id);
}

// A CHOICE-BEARING group's BODY is entirely covered by its data-lg-choice
// children (onFieldMoveMouseDown deliberately skips them — §6.2's own
// pre-existing, load-bearing choice-select/choice-reorder click semantics).
// The move gesture for these types is armed on the group's NAME TAG instead
// (decorateFieldSelection, a disjoint region above the field box that never
// overlaps a choice card) — mirroring the bare-input "outline doubles as the
// drag surface" precedent (S1-5/S1-6), generalized to this OTHER
// not-directly-grabbable type-class. Selecting a choice ALSO selects the
// group (selectChoice sets selectedQuestionId), so the tag renders first.
async function selectAndMoveViaTag(
  page: Page,
  request: APIRequestContext,
  sectionPublicId: string,
  groupQid: string,
  targetQid: string,
): Promise<string[]> {
  const anyChoice = frame(page).locator(`[data-question-id="${groupQid}"] [data-lg-choice]`).first();
  await anyChoice.click({ timeout: 8000 });
  const tag = frame(page).locator(`[data-move-handle="${groupQid}"]`);
  await expect(tag).toBeVisible({ timeout: 8000 });
  const targetEl = frame(page).locator(`[data-question-id="${targetQid}"]`);
  await expect(targetEl).toBeVisible();
  const targetBox = await targetEl.boundingBox();
  if (!targetBox) throw new Error(`${targetQid} has no bounding box`);
  const dropPoint = { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height * 0.85 };
  await realDragFromLocator(page, tag, dropPoint, { steps: 5, perStepGuardMs: 8000, settleMs: 500 });

  await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
  const detail = await json<{ content_json: { components: Array<{ question_id: string }> } }>(
    await request.get(`${LG_API}/sections/${sectionPublicId}`),
    "refetch after save",
  );
  return detail.content_json.components.map((c) => c.question_id);
}

test.describe("R7 U11a THE GATE (firefox) — unified pointer-path canvas move, real gestures, saved-model proof", () => {
  test("ButtonAnswerGroup moves AFTER the ZIP field via a real page.mouse drag (the dispatch's named class)", async ({ page, request }) => {
    const s = await createSection(request, `u11a-btn-${uniq}`, [
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
      { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string", props: { placeholder: "ZIP code" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await boot(page, s);
    // ButtonAnswerGroup is choice-bearing (typeMeta.choice === true): its own
    // body is entirely covered by data-lg-choice buttons (the group has no
    // "empty" pixel to grab) — the move gesture is armed on its name TAG
    // instead (see the R7 U11a decorateFieldSelection change), a disjoint
    // region above the field box, so this drag never lands on/interferes
    // with an actual choice button's own click/native-DnD reorder.
    const order = await selectAndMoveViaTag(page, request, s.public_id, "q_btn", "q_zip");
    const btnIdx = order.indexOf("q_btn");
    const zipIdx = order.indexOf("q_zip");
    expect(btnIdx, `persisted order: ${order.join(",")}`).toBeGreaterThanOrEqual(0);
    expect(zipIdx, `persisted order: ${order.join(",")}`).toBeGreaterThanOrEqual(0);
    expect(btnIdx, `q_btn must now sit AFTER q_zip — persisted order: ${order.join(",")}`).toBeGreaterThan(zipIdx);
  });

  test("TextBlock moves AFTER the ZIP field via a real page.mouse drag (previously-uncovered content-primitive class)", async ({ page, request }) => {
    const s = await createSection(request, `u11a-text-${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "TextBlock", question_id: "q_text", props: { text: "Some helper copy", role: "body" } },
      { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string", props: { placeholder: "ZIP code" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await boot(page, s);
    const order = await moveAndPersist(page, request, s.public_id, "q_text", "q_zip");
    const textIdx = order.indexOf("q_text");
    const zipIdx = order.indexOf("q_zip");
    expect(textIdx, `persisted order: ${order.join(",")}`).toBeGreaterThanOrEqual(0);
    expect(zipIdx, `persisted order: ${order.join(",")}`).toBeGreaterThanOrEqual(0);
    expect(textIdx, `q_text must now sit AFTER q_zip — persisted order: ${order.join(",")}`).toBeGreaterThan(zipIdx);
  });

  test("the ZIP field (bare-input; ALREADY worked pre-fix via its own per-field binding) still moves under the NEW generalized/delegated mechanism — no regression", async ({ page, request }) => {
    // Drop target is a TextBlock (NOT choice-bearing) — this test's OWN
    // purpose is the bare-input SOURCE-side mechanism (the delegated body
    // mousedown, replacing the old per-field binding); the choice-bearing
    // drop-target/tag-handle mechanism is the SEPARATE, dedicated concern the
    // ButtonAnswerGroup test above covers. Keeping the two variables apart.
    const s = await createSection(request, `u11a-zip-${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string", props: { placeholder: "ZIP code" } },
      { type: "TextBlock", question_id: "q_text", props: { text: "Some helper copy", role: "body" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await boot(page, s);
    const order = await moveAndPersist(page, request, s.public_id, "q_zip", "q_text");
    const zipIdx = order.indexOf("q_zip");
    const textIdx = order.indexOf("q_text");
    expect(zipIdx, `persisted order: ${order.join(",")}`).toBeGreaterThanOrEqual(0);
    expect(textIdx, `persisted order: ${order.join(",")}`).toBeGreaterThanOrEqual(0);
    expect(zipIdx, `q_zip must now sit AFTER q_text — persisted order: ${order.join(",")}`).toBeGreaterThan(textIdx);
  });

  test("drag-on-a-resize-handle still RESIZES, not moves (the R2 guard survives R7 U11a's generalized move gesture)", async ({ page, request }) => {
    const s = await createSection(request, `u11a-resize-guard-${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string", props: { placeholder: "ZIP code" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await boot(page, s);
    const zipField = frame(page).locator('[data-question-id="q_zip"]');
    await zipField.click({ timeout: 8000 });
    // the E (right-mid) width handle — data-handle-side="right", the legacy
    // locator the width-drag gates already use.
    const handle = frame(page).locator('[data-handle-side="right"][data-width-handle]');
    await expect(handle).toBeVisible({ timeout: 8000 });
    const box = await handle.boundingBox();
    if (!box) throw new Error("resize handle has no bounding box");
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    // 600-column recalibration (2026-07-15, content.maxWidth 500->600): drag
    // INWARD (-60, was +60) — this test only asserts a size override was
    // WRITTEN (direction-agnostic, see the assertions below), mirroring
    // leadgen-r3a-effects.gesture.spec.ts:193 which already drags inward and
    // survives at 600; a rightward +60 now overshoots the wider canvas
    // (bisect-proven: this exact drag passes at content.maxWidth=500, hangs
    // at 600 — the save-and-reload never fires because the mouseup lands
    // past the canvas). clampToBox is belt-and-suspenders against any future
    // column-width change (see clampPointToBox in utils/real-input.ts).
    const to = { x: from.x - 60, y: from.y };
    await realDragFromLocator(page, handle, to, { steps: 4, perStepGuardMs: 8000, settleMs: 400, clampToBox: await canvasFrameBox(page) });
    // A resize does NOT reorder — q_zip stays in its original position
    // (before q_cont) in the persisted model; onFieldMoveMouseDown's
    // [data-selection-chrome] skip prevents the drag from ALSO firing a move.
    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    const detail = await json<{ content_json: { components: Array<{ question_id: string; design_overrides?: { size?: unknown } }> } }>(
      await request.get(`${LG_API}/sections/${s.public_id}`),
      "refetch after save",
    );
    const order = detail.content_json.components.map((c) => c.question_id);
    expect(order.indexOf("q_zip"), `persisted order: ${order.join(",")}`).toBeLessThan(order.indexOf("q_cont"));
    const zipNode = detail.content_json.components.find((c) => c.question_id === "q_zip");
    expect(zipNode?.design_overrides?.size, "the resize DID write a size override (proves the drag was received as a resize)").toBeDefined();
  });

  test("fix-cycle SHIP MINOR restore: dragging a NESTED node and releasing over BLANK canvas space (below all content) moves it to the END OF ROOT — the retired native-DnD else-branch's parity (moveNodeTo(payload,null,null))", async ({ page, request }) => {
    // R5-style TALLER viewport (same root cause + same discipline as
    // canvas-interactions.gesture.spec.ts tests (ii)/(vi)): the default
    // Playwright "Desktop Firefox" viewport is only 1280x720, but this
    // fixture's canvas iframe (headline + a Stack-nested TextBlock + ZIP +
    // Continue) renders ~365px tall starting at page y~474 — its OWN bottom
    // edge (~838) already exceeds the 720px viewport, so a point even
    // further below (the blank space this test targets) is off-screen and
    // UNREACHABLE by a real page.mouse move — confirmed by direct diagnosis
    // (temporary console.log instrumentation of trackAt/finishUp): the
    // out-of-viewport steps delivered degenerate clientX=0/clientY=0 events,
    // translating to wildly negative iframe-relative coordinates, so
    // dropHint never got set and finishUp saw hint=null (cancel) — not a
    // product bug, a viewport-too-short test harness gap. 1000px height
    // comfortably fits the whole canvas on-screen; the SAME drag then
    // measured dropHint={qid:null,mode:'append'} and completed correctly.
    await page.setViewportSize({ width: 1280, height: 1000 });
    // A Stack container with ONE nested TextBlock child — proves the fuller
    // claim (reparents OUT of its container to the ROOT), not merely a
    // root-level reorder. TextBlock's own body-mousedown grab surface is
    // already proven (the TextBlock test above); nesting it inside a
    // container does not change that (isContainerType only gates the
    // CONTAINER's own body as a drop-target "into" zone, per trackAt).
    const s = await createSection(request, `u11a-blank-drop-${uniq}`, [
      { type: "QuestionHeadline", question_id: "q_head", bind: "section_headline" },
      {
        type: "Stack",
        question_id: "q_stack",
        children: [{ type: "TextBlock", question_id: "q_nested", props: { text: "Nested copy", role: "body" } }],
      },
      { type: "ZIPInputQuestion", question_id: "q_zip", internal_field: "zip", answer_type: "string", props: { placeholder: "ZIP code" } },
      { type: "ContinueButton", question_id: "q_cont", props: { label: "Continue" } },
    ]);
    await boot(page, s);
    const nested = frame(page).locator('[data-question-id="q_nested"]');
    await expect(nested).toBeVisible();
    const lastVisible = frame(page).locator('[data-question-id="q_cont"]');
    const lastBox = await lastVisible.boundingBox();
    if (!lastBox) throw new Error("q_cont has no bounding box");
    // A real point comfortably BELOW the last rendered node, now reachable
    // (the taller viewport above). The canvas iframe's own height floors at
    // 320px (updateCanvasFrameHeight, ui-section-studio.ts) and this
    // fixture's rendered content is far shorter, so this point sits on the
    // canvas's blank grey background — never on a [data-question-id]
    // element. clampToBox pulls it back inside the frame if this fixture
    // ever grows tall enough to challenge that assumption (belt-and-
    // suspenders, same discipline as the resize test above).
    const dropPoint = { x: lastBox.x + lastBox.width / 2, y: lastBox.y + lastBox.height + 60 };
    await realDragFromLocator(page, nested, dropPoint, {
      steps: 5,
      perStepGuardMs: 8000,
      settleMs: 500,
      clampToBox: await canvasFrameBox(page),
    });

    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    const detail = await json<{
      content_json: { components: Array<{ question_id: string; children?: Array<{ question_id: string }> }> };
    }>(await request.get(`${LG_API}/sections/${s.public_id}`), "refetch after save");
    const rootOrder = detail.content_json.components.map((c) => c.question_id);
    // fix-cycle parity restore (conductor-ruled, post-SHIP MINOR finding):
    // a release over blank canvas space moves the node to the END OF THE
    // ROOT list — the retired native-DnD else-branch's exact semantics.
    expect(rootOrder, "q_nested is now a ROOT-level node (present in the top-level components array)").toContain(
      "q_nested",
    );
    expect(rootOrder[rootOrder.length - 1], `persisted root order: ${rootOrder.join(",")}`).toBe("q_nested");
    const stackNode = detail.content_json.components.find((c) => c.question_id === "q_stack");
    expect(
      stackNode?.children?.map((c) => c.question_id) ?? [],
      "q_nested no longer lives inside its old Stack parent",
    ).not.toContain("q_nested");
  });
});
