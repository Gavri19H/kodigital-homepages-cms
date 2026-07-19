// LeadGen Round-4 Remediation — Phase P1 slice P1a probe spec (temporary; final
// consolidation lands in P7). Drives the REAL Section Studio through the REAL
// picker/inspector with REAL input (locator.click / fill / selectOption — ZERO
// dispatchEvent), asserting this slice's deliverables end-to-end:
//   AC-1  MultiQuestionGrid is usable from the picker: a picker-inserted grid
//         renders >=2 seeded rows on canvas; the "Add a sub-question" canvas
//         affordance adds a row; a sibling Dropdown's Rules source list offers
//         the grid rows BY THEIR ROW LABELS (never the section headline on
//         row 1); the whole section saves 2xx.
//   AC-2  AddressAutocompleteQuestion sub-fields are rule sources ("<Address>
//         — Street/City/State/ZIP"); the Accept type-swap is locked on Address.
//   AC-3  exactly ONE "When answered" WRITER control ([data-set-continue-mode]
//         in one container); the topbar On-answer control is read-only.
//   AC-4  saving with an empty name surfaces "Section name is required" — no raw
//         "section_name" id in the visible problems text.
//
// chromium-only: this slice touches NO gesture/drag machinery — every action is
// a plain click / fill / selectOption.

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const LG_API = "/api/admin/leadgen";
const uniq = Date.now();
const HEADLINE = "What describes your home?";

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
  components: unknown[],
): Promise<{ id: number; public_id: string }> {
  return json(
    await request.post(`${LG_API}/sections`, {
      data: {
        section_name: name,
        activity: `p1a-act-${uniq}`,
        vertical: `p1a-vert-${uniq}`,
        headline_text: HEADLINE,
        continue_mode: "button",
        status: "active",
        content_json: { components },
      },
    }),
    `p1a section create (${name})`,
  );
}

// A neutral, always-valid bound headline so a fresh section carries no answer
// field of its own — every rule source the tests assert then comes from the
// components inserted through the REAL picker.
const BOUND_HEADLINE = { type: "QuestionHeadline", question_id: "qh", bind: "section_headline" };

function canvas(page: Page) {
  return page.frameLocator("#lg-studio-canvas-frame").locator("#lg-studio-canvas-render");
}
function palette(page: Page, type: string) {
  return page.locator(`[data-add-component="${type}"]`);
}
// The Rules-tab condition SOURCE option labels for the currently-selected node
// (populated on selection by populateConditional). Read straight off the select
// so the assertion is independent of tab visibility.
async function ruleSourceLabels(page: Page): Promise<string[]> {
  return page.locator('[data-inspector-cond="when"]').evaluate((el) =>
    Array.from((el as HTMLSelectElement).options).map((o) => o.textContent ?? ""),
  );
}
async function openEdit(page: Page, publicId: string) {
  await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lg-section-name")).toBeVisible();
}

test.describe("P1a — MultiQuestionGrid usable from the picker + rules + save (AC-1)", () => {
  test("picker grid renders seeded rows, canvas add-sub-question grows them, a sibling Dropdown's rule sources use ROW labels (not the headline), and the section saves 2xx", async ({
    page,
  }) => {
    const section = await createSection(page.request, `P1a grid ${uniq}`, [BOUND_HEADLINE]);
    await openEdit(page, section.public_id);

    // Insert the grid through the REAL library tile.
    await palette(page, "MultiQuestionGrid").click();

    // A2z A-3 seed fix: a picker-inserted grid renders its starter rows on
    // canvas IMMEDIATELY (never an empty shell).
    await expect(canvas(page).locator(".lg-mqg-row")).toHaveCount(2);

    // The canvas "Add a sub-question" affordance (deliverable 2) adds a row via
    // the SAME addMqgRow the rows editor uses → 3 rows.
    await canvas(page).locator("[data-mqg-add-canvas]").click();
    await expect(canvas(page).locator(".lg-mqg-row")).toHaveCount(3);

    // Name the new sub-question through the real rows editor so the grid stays
    // save-valid (each row needs a label).
    const rowsEditor = page.locator("[data-mqg-rows-block]");
    await expect(rowsEditor).toBeVisible();
    const newRow = page.locator("[data-mqg-rows] [data-mqg-row]").nth(2);
    await newRow.locator('input[data-mqg-field="label"]').fill("Question 3");

    // Add a sibling Dropdown through the picker → it becomes the selection.
    await palette(page, "DropdownQuestion").click();

    // Its Rules source list offers every grid row BY ITS ROW LABEL — and row 1
    // is "Question 1", NOT the section headline (the A-4/P-4 mislabel bug).
    const labels = await ruleSourceLabels(page);
    expect(labels, `rule sources = ${JSON.stringify(labels)}`).toEqual(
      expect.arrayContaining(["Question 1", "Question 2", "Question 3"]),
    );
    expect(labels.join(" | ")).not.toContain(HEADLINE);

    // The whole section saves 2xx (the shared-choices save-trap is gone).
    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) =>
          /\/api\/admin\/leadgen\/sections\//.test(r.url()) &&
          ["PUT", "PATCH", "POST"].includes(r.request().method()),
      ),
      page.locator("#lg-section-save").click(),
    ]);
    expect(saveResp.status(), `save status`).toBeLessThan(300);
  });
});

test.describe("P1a — Address sub-fields are rule sources + Accept is locked (AC-2)", () => {
  test("an Address exposes Street/City/State/ZIP role sources to a sibling, and its own Accept type-swap is hidden/locked", async ({
    page,
  }) => {
    const section = await createSection(page.request, `P1a addr ${uniq}`, [BOUND_HEADLINE]);
    await openEdit(page, section.public_id);

    // Insert Address through the real tile → it becomes the selection.
    await palette(page, "AddressAutocompleteQuestion").click();
    await expect(canvas(page).locator('[data-component-type="AddressAutocompleteQuestion"]')).toHaveCount(1);

    // Deliverable 9a: the Accept type-swap dropdown is LOCKED (hidden) on an
    // Address, with a one-line explanation shown instead.
    await expect(page.locator("[data-accept-wrap]")).toBeHidden();
    await expect(page.locator("[data-accept-address-lock]")).toBeVisible();

    // Insert a sibling Dropdown → it becomes the selection; its Rules source
    // list now enumerates the Address role sub-fields (deliverable 8).
    await palette(page, "DropdownQuestion").click();
    const labels = (await ruleSourceLabels(page)).join(" | ");
    for (const role of ["Street", "City", "State", "ZIP"]) {
      expect(labels, `Address role "${role}" present in sources: ${labels}`).toContain(role);
    }
    // Role entries read "<Address> — <Role>" (em-dash separator).
    expect(labels).toContain("—");
  });
});

test.describe("P1a — exactly one When-answered writer; topbar is read-only (AC-3)", () => {
  test("[data-set-continue-mode] writers live in ONE container and the topbar On-answer control is read-only", async ({
    page,
  }) => {
    const section = await createSection(page.request, `P1a onewriter ${uniq}`, [
      BOUND_HEADLINE,
      { type: "TwoButtonYesNo", question_id: "q_yn", internal_field: "insured", props: { yesLabel: "Yes", noLabel: "No" } },
    ]);
    await openEdit(page, section.public_id);

    // The WRITER buttons exist and share exactly one container.
    const writers = page.locator("[data-set-continue-mode]");
    await expect(writers).toHaveCount(2);
    const containerCount = await writers.evaluateAll(
      (els) => new Set(els.map((e) => e.closest("[data-continue-mode-group]"))).size,
    );
    expect(containerCount, "all writers in ONE container").toBe(1);

    // The topbar control is a read-only status: marked read-only and holding no
    // writer button.
    const roGroup = page.locator("[data-continue-mode-readonly]");
    await expect(roGroup).toHaveCount(1);
    expect(await roGroup.locator("[data-set-continue-mode]").count(), "topbar holds no writer").toBe(0);
  });
});

test.describe("P1a — empty section name surfaces a human message (AC-4)", () => {
  test("saving with an empty name shows 'Section name is required' with NO raw section_name id", async ({ page }) => {
    const section = await createSection(page.request, `P1a name ${uniq}`, [BOUND_HEADLINE]);
    await openEdit(page, section.public_id);

    // Clear the name and save — the server 400s on the empty name.
    await page.locator("#lg-section-name").fill("");
    await page.locator("#lg-section-save").click();

    const problems = page.locator("[data-studio-save-problems]");
    await expect(problems).toBeVisible();
    await expect(problems).toContainText("Section name is required");
    // Deliverable 7: the raw id is mapped away everywhere in the visible text.
    await expect(problems).not.toContainText("section_name");
  });
});
