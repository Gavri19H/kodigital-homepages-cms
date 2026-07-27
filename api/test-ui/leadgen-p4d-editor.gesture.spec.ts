// Section Builder product-core remediation, phase P4d — LIVE real-input legs
// (register PC-8, PC-A7, PC-A8, PC-A10). Cross-engine: every test here drives
// the SAME-origin Section Studio only (no e2e.test dynamic tenant host), the
// same shape as leadgen-p3a-placement.gesture.spec.ts / leadgen-p4b-
// validation.spec.ts / leadgen-p4c-rules.gesture.spec.ts's own studio-only
// legs — see playwright.config.ts CROSS_ENGINE_GESTURE_SPECS.
//
// PC-8/PC-A7's toolbar-Delete + "a real delete shows the undo toast, Undo
// restores it" happy path is ALREADY covered live by
// test-ui/leadgen-r4a-pipeline.spec.ts ("R4a E3-NEW-7"), unchanged by this
// phase (deleteSelectedWithUndo's call sites are byte-identical — the scope
// check moved INSIDE the function). This file adds the NET NEW real-input
// legs: the choice-vs-group Backspace split, and the "no selection ⇒ no
// phantom toast" boundary. The findRef-null-selection PHANTOM-TOAST fix
// itself (the exact PC-8 mechanism: a dangling, non-null selectedQuestionId)
// is proven at the EXECUTED-ISLAND level in
// test/leadgen-p4d-editor-integrity.test.ts — see that file's header for why
// a live browser cannot organically desync selectedQuestionId from a real
// node today (every OTHER mutation path already clears it defensively).
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const LG_API = "/api/admin/leadgen";
const uniq = Date.now();

async function json<T>(
  res: { ok(): boolean; status(): number; json(): Promise<unknown>; text(): Promise<string> },
  label: string,
): Promise<T> {
  if (!res.ok()) throw new Error(`${label} HTTP ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function createSection(
  request: APIRequestContext,
  name: string,
  contentJson: unknown,
): Promise<{ id: number; public_id: string }> {
  return json(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: `p4d-act-${uniq}`,
        vertical: `p4d-vert-${uniq}`,
        headline_text: name,
        continue_mode: "button",
        status: "active",
        content_json: contentJson,
      },
    }),
    `p4d section create (${name})`,
  );
}

async function fetchSection(
  request: APIRequestContext,
  publicId: string,
): Promise<{ content_json: { components: Array<Record<string, unknown>> } }> {
  return json(await request.get(`${LG_API}/sections/${publicId}`), `p4d section detail (${publicId})`);
}

function canvasRender(page: Page) {
  return page.frameLocator("#lg-studio-canvas-frame").locator("#lg-studio-canvas-render");
}

async function openInspectorTab(page: Page, key: string): Promise<void> {
  const tab = page.locator(`[data-studio-inspector-tab="${key}"]`);
  await expect(tab).toBeVisible();
  await tab.click();
}

async function saveStudio(page: Page): Promise<void> {
  await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
}

function publicIdFromUrl(page: Page): string {
  const m = page.url().match(/\/sections\/(lgs_[^/]+)\/edit/);
  if (!m || m[1] === undefined) throw new Error(`no section public id in ${page.url()}`);
  return m[1];
}

const choice = (label: string, value: string) => ({ label, value, analytics_id: value });

test.describe("PC-A7 — choice-scoped Backspace deletes ONLY the choice; group Backspace still deletes the whole group", () => {
  test("selecting a choice card and pressing Backspace removes just that choice — the group and its other choice survive; group-scope Backspace afterward deletes the whole group", async ({ page }) => {
    const section = await createSection(page.request, `P4d PC-A7 ${uniq}`, {
      components: [
        {
          type: "ButtonAnswerGroup",
          question_id: "q_make",
          internal_field: "car_make",
          answer_type: "enum",
          choices: [choice("Toyota", "toyota"), choice("Honda", "honda")],
        },
      ],
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });

    page.on("dialog", (d) => {
      throw new Error(`unexpected dialog: ${d.message()}`);
    });

    // §6.4 clicking a choice CARD focuses the CHOICE scope (not the group).
    // selectChoice's own focusChoiceRow moves KEYBOARD focus to the Content
    // tab's choice-label input in the PARENT document (so the operator can
    // immediately type a label) — a real Backspace right after the click
    // would edit THAT input's text, never reach onCanvasKeyDown at all.
    // Re-focus the canvas surface explicitly (its own tabindex="0", the SAME
    // element bindCanvasSurface wires the keydown delegate to) before every
    // key press — the deterministic equivalent of the operator clicking back
    // onto the canvas before pressing Backspace.
    const canvasSurface = page.locator("#lg-studio-canvas");
    await canvasRender(page).locator('[data-lg-choice="toyota"]').click();
    await expect(page.locator("[data-scope-editing-name]")).toContainText("Answer choice");
    await canvasSurface.focus();
    await page.keyboard.press("Backspace");

    // the CHOICE is gone; the GROUP survives with its other choice
    await expect(canvasRender(page).locator('[data-lg-choice="toyota"]')).toHaveCount(0);
    await expect(canvasRender(page).locator('[data-lg-choice="honda"]')).toHaveCount(1);
    await expect(canvasRender(page).locator('[data-component-type="ButtonAnswerGroup"]')).toHaveCount(1);

    const toast = page.locator("[data-studio-undo-toast]");
    await expect(toast).toBeVisible({ timeout: 5_000 });
    await expect(toast).toContainText("deleted");

    // scope fell back to the GROUP (component), never cleared to section —
    // the group's own breadcrumb/pill should now read the component name
    await expect(page.locator("[data-scope-pill=\"component\"]").first()).toHaveClass(/active/);

    // Undo restores the choice at its original (first) position — a
    // client-only history revert (never saved), so no server round-trip
    // check is needed: the canvas re-render IS the proof.
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(canvasRender(page).locator('[data-lg-choice="toyota"]')).toBeVisible({ timeout: 5_000 });

    // Now select the GROUP itself (component scope, no choice focused) and
    // Backspace — the WHOLE group must be removed this time.
    await canvasRender(page).locator('[data-component-type="ButtonAnswerGroup"]').click();
    await expect(page.locator("[data-scope-editing-name]")).not.toContainText("Answer choice");
    await canvasSurface.focus();
    await page.keyboard.press("Backspace");
    await expect(canvasRender(page).locator('[data-component-type="ButtonAnswerGroup"]')).toHaveCount(0);
    await expect(page.locator("[data-studio-undo-toast]")).toContainText("deleted");
  });
});

test.describe("PC-8 — no selection at all: Backspace is a silent no-op (never a phantom toast)", () => {
  test("with nothing selected on the canvas, Backspace shows no undo toast and changes nothing", async ({ page }) => {
    const section = await createSection(page.request, `P4d PC-8 boundary ${uniq}`, {
      components: [{ type: "TwoButtonYesNo", question_id: "q1", internal_field: "a1", props: { yesLabel: "Yes", noLabel: "No" } }],
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });
    // the studio auto-selects q1 by default (findDefaultSelectionId) — click
    // it explicitly first, then explicitly re-focus the canvas surface
    // (its own tabindex="0" — the SAME element bindCanvasSurface wires the
    // keydown delegate to; a plain click may or may not hand real keyboard
    // focus to a non-input canvas element, so this is the deterministic
    // equivalent of the operator's own focus before pressing a canvas key).
    // Escape then walks UP from a root-level node straight to NO selection
    // (onCanvasKeyDown: selectComponent(null) when the node has no parent) —
    // onCanvasKeyDown's own top-line guard (`if (!selectedQuestionId)
    // return;`) then makes Backspace a pure no-op.
    const canvasSurface = page.locator("#lg-studio-canvas");
    await canvasRender(page).locator('[data-component-type="TwoButtonYesNo"]').click();
    await expect(canvasRender(page).locator(".studio-selected-node")).toHaveCount(1);
    await canvasSurface.focus();
    await page.keyboard.press("Escape");
    await expect(canvasRender(page).locator(".studio-selected-node")).toHaveCount(0);
    await canvasSurface.focus();
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(300);
    await expect(page.locator("[data-studio-undo-toast]")).toHaveCount(0);
    await expect(canvasRender(page).locator('[data-component-type="TwoButtonYesNo"]')).toHaveCount(1);
  });
});

test.describe("PC-A8 — NameFieldsGroup per-field placeholder/helper/icon: author -> canvas -> save -> reload -> render", () => {
  test("the operator's Contact scenario end to end", async ({ page }) => {
    const section = await createSection(page.request, `P4d PC-A8 Contact ${uniq}`, {
      components: [{ type: "NameFieldsGroup", question_id: "q_name", props: {} }],
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await canvasRender(page).locator('[data-component-type="NameFieldsGroup"]').click();
    await openInspectorTab(page, "content");

    const block = page.locator("[data-content-namefieldsgroup-block]");
    await expect(block).toBeVisible();
    await block.locator('input[data-inspector-field="firstPlaceholder"]').fill("Jane");
    await block.locator('input[data-inspector-field="lastPlaceholder"]').fill("Doe");
    await block.locator('input[data-inspector-field="firstHelper"]').fill("As shown on your ID");
    await block.locator('select[data-inspector-field="firstIcon"]').selectOption("user");

    // canvas (the SAME server renderer as the live funnel — presets.ts
    // renderNameFieldsGroup) reflects the authoring live, before any save
    const first = canvasRender(page).locator('input[data-name-field="first"]');
    await expect(first).toHaveAttribute("placeholder", "Jane", { timeout: 5_000 });
    const last = canvasRender(page).locator('input[data-name-field="last"]');
    await expect(last).toHaveAttribute("placeholder", "Doe");
    await expect(canvasRender(page).locator("text=As shown on your ID")).toBeVisible();
    await expect(canvasRender(page).locator(".lg-field-icon")).toHaveCount(1);

    await saveStudio(page);
    const detail = await fetchSection(page.request, publicIdFromUrl(page));
    const saved = detail.content_json.components[0] as { props: Record<string, unknown> };
    expect(saved.props.firstPlaceholder).toBe("Jane");
    expect(saved.props.lastPlaceholder).toBe("Doe");
    expect(saved.props.firstHelper).toBe("As shown on your ID");
    expect(saved.props.firstIcon).toBe("user");

    // reload: the canvas re-renders the SAVED content — still live.
    await page.reload({ waitUntil: "domcontentloaded" });
    const firstAfterReload = canvasRender(page).locator('input[data-name-field="first"]');
    await expect(firstAfterReload).toHaveAttribute("placeholder", "Jane", { timeout: 5_000 });
    await expect(canvasRender(page).locator("text=As shown on your ID")).toBeVisible();
    await expect(canvasRender(page).locator(".lg-field-icon")).toHaveCount(1);
  });
});

test.describe("PC-A10 — SearchableDropdown + Range helpers now render live (the drift fix)", () => {
  test("SearchableDropdownQuestion's authored Helper text paints on the live canvas", async ({ page }) => {
    const section = await createSection(page.request, `P4d PC-A10 dropdown ${uniq}`, {
      components: [
        {
          type: "SearchableDropdownQuestion",
          question_id: "q_sd",
          internal_field: "sd",
          answer_type: "enum",
          choices: [choice("Alpha", "a"), choice("Beta", "b")],
        },
      ],
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await canvasRender(page).locator('[data-component-type="SearchableDropdownQuestion"]').click();
    await openInspectorTab(page, "content");
    await page.locator('[data-studio-panel="content"] input[data-inspector-field="helper"]:visible').fill("We never share this");
    await expect(canvasRender(page).locator("text=We never share this")).toBeVisible({ timeout: 5_000 });
  });

  test("NumberRangeQuestion's authored Helper text paints on the live canvas", async ({ page }) => {
    const section = await createSection(page.request, `P4d PC-A10 range ${uniq}`, {
      components: [{ type: "NumberRangeQuestion", question_id: "q_r", internal_field: "amt", props: { min: 0, max: 100 } }],
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await canvasRender(page).locator('[data-component-type="NumberRangeQuestion"]').click();
    await openInspectorTab(page, "content");
    await page.locator('[data-studio-panel="content"] input[data-inspector-field="helper"]:visible').fill("Slide to set your amount");
    await expect(canvasRender(page).locator("text=Slide to set your amount")).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("PC-A10 — TextBlock's Icon control is hidden for the 5 non-consuming roles, shown for reassurance/secure_badge", () => {
  test("switching the Style-tab Role picker toggles the Content-tab Icon row live", async ({ page }) => {
    const section = await createSection(page.request, `P4d PC-A10 textblock ${uniq}`, {
      components: [{ type: "TextBlock", question_id: "q_tb", props: { role: "heading", text: "Hello" } }],
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });
    await canvasRender(page).locator('[data-component-type="TextBlock"]').click();

    await openInspectorTab(page, "content");
    const iconRow = page.locator('[data-content-prop="icon"]');
    await expect(iconRow).toBeHidden();

    await openInspectorTab(page, "style");
    await page.locator("[data-text-block-role]").selectOption("reassurance");
    await openInspectorTab(page, "content");
    await expect(iconRow).toBeVisible();

    await openInspectorTab(page, "style");
    await page.locator("[data-text-block-role]").selectOption("secure_badge");
    await openInspectorTab(page, "content");
    await expect(iconRow).toBeVisible();

    await openInspectorTab(page, "style");
    await page.locator("[data-text-block-role]").selectOption("body");
    await openInspectorTab(page, "content");
    await expect(iconRow).toBeHidden();
  });
});
