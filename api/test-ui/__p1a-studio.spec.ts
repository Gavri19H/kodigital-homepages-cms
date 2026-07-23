// LeadGen Round-4 Remediation — Phase P1 slice P1a probe spec (temporary; final
// consolidation lands in P7). Drives the REAL Section Studio through the REAL
// picker/inspector with REAL input (locator.click / fill / selectOption — ZERO
// dispatchEvent), asserting this slice's deliverables end-to-end:
//   AC-1  MultiQuestionGrid is usable from the picker: a picker-inserted grid
//         renders >=2 seeded rows on canvas; the "Add a sub-question" canvas
//         affordance adds a row; a sibling Dropdown's Rules source list offers
//         the grid rows BY THEIR ROW LABELS (never the section headline on
//         row 1); a REAL show/hide condition authored on the Dropdown with an
//         MQG row as its `when` source SAVES 2xx and — after a page reload —
//         ROUND-TRIPS (source still selected, value intact); the picker-
//         authored grid (rows + a row's default-selected pill) also renders on
//         the LIVE preview render (`/sections/preview`), not just the studio
//         canvas.
//   AC-2  AddressAutocompleteQuestion sub-fields are rule sources ("<Address>
//         — Street/City/State/ZIP"); the Accept type-swap is locked on Address.
//   AC-3  exactly ONE "When answered" WRITER control ([data-set-continue-mode]
//         in one container); the topbar On-answer control is read-only.
//   AC-4  saving with an empty name surfaces "Section name is required" — no raw
//         "section_name" id in the visible problems text.
//
// Registered on BOTH engines (playwright.config.ts CROSS_ENGINE_GESTURE_SPECS):
// every action here is a plain click / fill / selectOption — no gesture/drag
// machinery — so it is expected to pass unmodified on chromium AND firefox.

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

// §10/S5.1: selectRuleSourceByLabel + previewHtml (a comment-through-preview
// helper mirroring test-ui/__p1b-render.spec.ts's own) were deleted here —
// both were ONLY ever called by the retired AC-1 MultiQuestionGrid journey
// below (see its own retirement note).

// §10/S5.1 RETIREMENT: MultiQuestionGrid has no catalog entry anymore
// (confirmed 0 references, P5 orphan-scan) — the picker tile this whole AC-1
// journey opened with (`palette(page, "MultiQuestionGrid")`) no longer
// exists, so nothing below it (rows editor, canvas add-sub-question, rule
// sourcing off row labels, save/round-trip, live-preview row rendering) is
// reachable through the Studio anymore. Replacement coverage: a stored node
// of this (or any other) extinct type renders the fail-safe box, never its
// old widget or a 500 — proved in test/leadgen-rework-render.test.ts's "§10
// seam: a stored node of ANY extinct type (RangeQuestion/CurrencyRangeQuestion
// /MultiQuestionGrid/OtherGroupSelector) renders the fail-safe box" test. The
// picker-insertion + rule-authoring-off-row-labels BEHAVIOR this AC-1 journey
// proved has no current equivalent for any live multi-row-question type (the
// catalog has no other multi-answer-per-question component) — a genuine,
// undocumented-elsewhere gap, not silently dropped.
test.describe("P1a — MultiQuestionGrid usable from the picker + rules + save (AC-1) [RETIRED: §10/S5.1]", () => {
  test("the retired MultiQuestionGrid tile has no current picker surface (see describe-block citation)", async ({ page }) => {
    const section = await createSection(page.request, `P1a grid ${uniq}`, [BOUND_HEADLINE]);
    await openEdit(page, section.public_id);
    await expect(palette(page, "MultiQuestionGrid")).toHaveCount(0);
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

    // Deliverable 9a, §10/S5.1 CORRECTED: the Accept type-swap dropdown is
    // hidden on an Address (Address is not in the accept_type_swap-capable
    // family — ui-section-studio.ts's populateInspector). The old "Address is
    // a fixed type" lock NOTE (data-accept-address-lock) is itself a §10
    // removal — Address instead gets the field-set editor in its place
    // (ui-section-studio.ts's own comment: "Rework §6.10 / §10: the Address
    // type-lock is REMOVED... Address instead gets the field-set editor").
    await expect(page.locator("[data-accept-wrap]")).toBeHidden();
    await expect(page.locator("[data-address-fieldset-block]")).toBeVisible();

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
