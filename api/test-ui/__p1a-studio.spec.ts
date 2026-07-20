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
// Select a Rules-tab condition source by its VISIBLE label substring (never a
// hand-guessed internal_field) and return the option's real VALUE — the same
// pattern test-ui/__p1b-render.spec.ts's selectRuleSource uses for an Address
// role — so the round-trip assertion below compares against what was actually
// picked, not an assumed field name.
async function selectRuleSourceByLabel(page: Page, labelSubstring: string): Promise<string> {
  const when = page.locator('[data-inspector-cond="when"]');
  const value = await when.evaluate((el, word) => {
    const opt = Array.from((el as HTMLSelectElement).options).find((o) => (o.textContent ?? "").includes(word));
    return opt ? opt.value : "";
  }, labelSubstring);
  if (!value) throw new Error(`no rule-source option matching "${labelSubstring}"`);
  await when.selectOption(value);
  return value;
}
async function openEdit(page: Page, publicId: string) {
  await page.goto(`/admin/leadgen/sections/${publicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#lg-section-name")).toBeVisible();
}
// The live-equivalent render MARKUP (no studio decoration) straight from the
// shared preview producer — the SAME renderSectionComponents the live funnel
// uses (mirrors test-ui/__p1b-render.spec.ts's previewHtml exactly, duplicated
// per this repo's per-file self-containment convention for vm-probe-adjacent
// Playwright specs).
async function previewHtml(request: APIRequestContext, components: unknown[]): Promise<string> {
  const body = await json<Record<string, unknown>>(
    await request.post(`${LG_API}/sections/preview`, {
      data: { content_json: JSON.stringify({ components }), viewport: "desktop" },
    }),
    "p1a preview",
  );
  const preview = (body["preview"] as Record<string, unknown> | undefined) ?? body;
  return String(preview["html"] ?? preview["desktop"] ?? preview["mobile"] ?? "");
}

test.describe("P1a — MultiQuestionGrid usable from the picker + rules + save (AC-1)", () => {
  test("picker grid renders seeded rows, canvas add-sub-question grows them, a sibling Dropdown's rule sources use ROW labels (not the headline), a rule authored ON a row saves + round-trips after reload, and the grid renders rows + a default-selected pill on the LIVE preview", async ({
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
    // save-valid (each row needs a label), and give IT a default pill — the
    // live-render leg below proves this specific row+default round-trips into
    // the LIVE output, not just the studio canvas.
    const rowsEditor = page.locator("[data-mqg-rows-block]");
    await expect(rowsEditor).toBeVisible();
    const newRow = page.locator("[data-mqg-rows] [data-mqg-row]").nth(2);
    await newRow.locator('input[data-mqg-field="label"]').fill("Question 3");
    await newRow.locator('select[data-mqg-field="default"]').selectOption("no");

    // Add a sibling Dropdown through the picker → it becomes the selection.
    await palette(page, "DropdownQuestion").click();

    // Its Rules source list offers every grid row BY ITS ROW LABEL — and row 1
    // is "Question 1", NOT the section headline (the A-4/P-4 mislabel bug).
    const labels = await ruleSourceLabels(page);
    expect(labels, `rule sources = ${JSON.stringify(labels)}`).toEqual(
      expect.arrayContaining(["Question 1", "Question 2", "Question 3"]),
    );
    expect(labels.join(" | ")).not.toContain(HEADLINE);

    // --- REVIEW ROUND leg 1: author a REAL show/hide condition on the Dropdown
    // whose `when` IS an MQG row's internal_field (Question 1 / "answer1") ---
    await page.locator('[data-studio-inspector-tab="rules"]').click();
    await page.locator("[data-rules-add-condition]").click();
    const ruleField = await selectRuleSourceByLabel(page, "Question 1");
    await page.locator('[data-inspector-cond="op"]').selectOption("eq");
    // Question 1 has no per-row choices override — its effective set is the
    // grid's shared Yes/No pills, so the "eq" value control is the ENUM select
    // (never the free-text input) with "yes"/"no" options.
    await expect(page.locator('[data-inspector-cond="value-enum"]')).toBeVisible();
    await page.locator('[data-inspector-cond="value-enum"]').selectOption("yes");

    // The whole section (grid + the new rule) saves 2xx (the shared-choices
    // save-trap is gone, and the row field is a KNOWN condition source). The
    // response predicate is scoped to a PATCH on THIS section's OWN url (never
    // a bare "/sections/" substring match) so it cannot pick up the debounced
    // live-preview refresher's POST to the SIBLING /sections/preview endpoint,
    // which shares that same substring and also returns 2xx.
    const saveUrl = `${LG_API}/sections/${section.public_id}`;
    const [saveResp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(saveUrl) && r.request().method() === "PATCH"),
      // A clean (0-problems) save ALWAYS hard-navigates back to this SAME edit
      // URL once the PATCH succeeds (ui-section-studio.ts saveBtn handler) —
      // waiting for `load` alongside the response (rather than an explicit
      // page.reload() afterward, which would race that in-flight navigation)
      // is the SAME pattern test-ui/leadgen-p5-multi-question-grid.gesture.spec.ts's
      // saveStudio() helper uses.
      page.waitForEvent("load"),
      page.locator("#lg-section-save").click(),
    ]);
    const saveBody = await saveResp.text().catch(() => "(body unavailable)");
    expect(saveResp.status(), `save status (${saveBody})`).toBeLessThan(300);

    // --- REVIEW ROUND leg 1 (cont'd): the save's own redirect already reloaded
    // the studio fresh from the server — confirm the rule ROUND-TRIPS (the
    // source is still selected and the value is intact) ---
    await expect(page.locator("#lg-section-name")).toBeVisible();
    await canvas(page).locator('[data-component-type="DropdownQuestion"]').click();
    await page.locator('[data-studio-inspector-tab="rules"]').click();
    await expect(page.locator('[data-inspector-cond="when"]'), "rule source round-trips").toHaveValue(ruleField);
    const valueEnum = page.locator('[data-inspector-cond="value-enum"]');
    await expect(valueEnum, "value control re-derives as the enum select").toBeVisible();
    await expect(valueEnum, "rule value round-trips").toHaveValue("yes");

    // --- REVIEW ROUND leg 2: the picker-authored grid renders its rows AND a
    // row's default-selected pill on the LIVE preview render, not just canvas ---
    const persisted = await json<{ content_json?: { components?: unknown[] } }>(
      await page.request.get(`${LG_API}/sections/${section.id}`),
      "p1a fetch persisted section",
    );
    const persistedComponents = persisted.content_json?.components ?? [];
    const live = await previewHtml(page.request, persistedComponents);
    expect((live.match(/class="lg-field lg-mqg-row"/g) ?? []).length, "3 rows render on the LIVE output").toBe(3);
    // Exactly one default-selected pill overall (only "Question 3" has one) —
    // and it sits inside THAT row's own markup slice, on the "no" pill.
    expect((live.match(/lg-selected/g) ?? []).length, "exactly one default-selected pill").toBe(1);
    const q3LabelIdx = live.indexOf(">Question 3<");
    expect(q3LabelIdx, "Question 3's row present in the LIVE output").toBeGreaterThan(-1);
    const nextRowIdx = live.indexOf('class="lg-field lg-mqg-row"', q3LabelIdx + 1);
    const q3RowSlice = nextRowIdx === -1 ? live.slice(q3LabelIdx) : live.slice(q3LabelIdx, nextRowIdx);
    expect(q3RowSlice, "Question 3's own pill carries the selected class").toContain("lg-selected");
    expect(q3RowSlice, "Question 3's selected pill is the 'no' value").toContain('data-lg-choice="no"');
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
