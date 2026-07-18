// Section Builder product-core remediation, phase P5 (register PC-10, operator
// decision D2 — Image9 "a good explanation for multi-choice including default
// answers") — the MultiQuestionGrid LIVE authoring + canvas-parity gate.
//
// CROSS-ENGINE (studio-only, no e2e.test dynamic tenant host) — the SAME shape
// as leadgen-p3a-placement / leadgen-p4c-rules / leadgen-p4d-editor's own
// studio-only legs (see playwright.config.ts CROSS_ENGINE_GESTURE_SPECS). It
// drives the REAL Section Studio: seed a grid → the canvas renders the stacked
// labeled pill rows with each row's default pre-selected (the Image9
// composition) → AUTHOR a new sub-question through the real rows editor (label /
// answer-name / default inputs) → save/reload persists + re-renders.
//
// The studio canvas is the SAME presets.ts server renderer a live /lg funnel
// embeds (documented at leadgen-p4d-editor.gesture.spec.ts), so the SSR
// composition + server-side default pre-selection proven here are byte-for-byte
// what a visitor sees. The RUNTIME half — each row's default seeding
// (applySectionDefaults), paint (enterSection), click recording
// (handleChoiceActivation) and per-row required (validateSection), ALL through
// the config-dto row projection with ZERO new engine bytes — plus the
// normalize→payload AUCTION round-trip, are proven deterministically through
// the EXACT server pipeline in test/leadgen-p5-multi-question-grid.test.ts
// (expandPublicComponents / normalizeAnswers / generateOfferPayload). A live
// dynamic-host browser leg adds no coverage those two surfaces do not already
// pin, and would be chromium-only (host-resolver-rules) — so it is a documented
// skip here, keeping this gate fully cross-engine.

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
        activity: `p5-act-${uniq}`,
        vertical: `p5-vert-${uniq}`,
        headline_text: "Tell us about the driver",
        continue_mode: "button",
        status: "active",
        content_json: contentJson,
      },
    }),
    `p5 section create (${name})`,
  );
}

async function fetchSection(
  request: APIRequestContext,
  publicId: string,
): Promise<{ content_json: { components: Array<Record<string, unknown>> } }> {
  return json(await request.get(`${LG_API}/sections/${publicId}`), `p5 section detail (${publicId})`);
}

function canvasRender(page: Page) {
  return page.frameLocator("#lg-studio-canvas-frame").locator("#lg-studio-canvas-render");
}

async function saveStudio(page: Page): Promise<void> {
  await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
}

const YESNO = [
  { label: "Yes", value: "yes", analytics_id: "yes" },
  { label: "No", value: "no", analytics_id: "no" },
];

// The Image9 "Tell us about the driver" grid: four labeled sub-questions, each a
// default-selected pill pair (Gender overrides with its own Male/Female set).
const DRIVER_GRID = {
  type: "MultiQuestionGrid",
  question_id: "q_driver",
  choices: YESNO,
  props: {
    rows: [
      { label: "Homeowner", internal_field: "homeowner", default: "yes", required: true },
      { label: "Married", internal_field: "married", default: "no" },
      {
        label: "Gender",
        internal_field: "gender",
        default: "male",
        choices: [
          { label: "Male", value: "male", analytics_id: "male" },
          { label: "Female", value: "female", analytics_id: "female" },
        ],
      },
      { label: "Military Affiliation", internal_field: "military", default: "no" },
    ],
  },
};

test.describe("P5 MultiQuestionGrid — studio canvas composition + default pre-selection (cross-engine)", () => {
  test("renders four stacked labeled pill rows, each with its default pill pre-selected (the Image9 reference composition)", async ({ page }) => {
    const section = await createSection(page.request, `P5 grid ${uniq}`, { components: [DRIVER_GRID] });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });
    const canvas = canvasRender(page);

    // Four sub-question rows, each a label + a pill pair.
    await expect(canvas.locator(".lg-mqg-row")).toHaveCount(4);
    for (const label of ["Homeowner", "Married", "Gender", "Military Affiliation"]) {
      await expect(canvas.locator(".lg-mqg .lg-label", { hasText: label })).toBeVisible();
    }

    // Defaults pre-selected server-side: the default pill carries .lg-selected,
    // the sibling does not (the P1/P2-proven selected paint, per row).
    await expect(canvas.locator('[data-lg-question="q_driver::homeowner"] [data-lg-choice="yes"]')).toHaveClass(
      /lg-selected/,
    );
    await expect(
      canvas.locator('[data-lg-question="q_driver::homeowner"] [data-lg-choice="no"]'),
    ).not.toHaveClass(/lg-selected/);
    // Married default "no".
    await expect(canvas.locator('[data-lg-question="q_driver::married"] [data-lg-choice="no"]')).toHaveClass(
      /lg-selected/,
    );
    // Gender uses its OWN pill override; the "male" default is pre-selected.
    await expect(canvas.locator('[data-lg-question="q_driver::gender"] [data-lg-choice="male"]')).toHaveClass(
      /lg-selected/,
    );

    // COMPOSITION (measured): the four rows STACK vertically — each row's top is
    // strictly below the previous row's, and each pill pair sits below its label.
    const rowTops = await canvas.locator(".lg-mqg-row").evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect().top),
    );
    expect(rowTops).toHaveLength(4);
    for (let i = 1; i < rowTops.length; i++) {
      expect(rowTops[i], `row ${i} stacks below row ${i - 1}`).toBeGreaterThan(rowTops[i - 1]!);
    }
    // The [data-lg-question] hook rides the row wrapper; the label + the pill
    // grid are its children — the pills sit below the label (label-above-pills).
    const homeownerRow = canvas.locator('[data-lg-question="q_driver::homeowner"]');
    const homeownerLabelBottom = await homeownerRow
      .locator(".lg-label")
      .evaluate((el) => el.getBoundingClientRect().bottom);
    const homeownerPillsTop = await homeownerRow
      .locator(".lg-answer-group")
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(homeownerPillsTop, "the pill pair sits below its row label").toBeGreaterThanOrEqual(
      homeownerLabelBottom - 1,
    );
  });
});

test.describe("P5 MultiQuestionGrid — real studio authoring + save/reload (cross-engine)", () => {
  test("add a sub-question through the rows editor (label / answer-name / default), save + reload → it persists and renders with the default pre-selected", async ({ page }) => {
    const section = await createSection(page.request, `P5 author ${uniq}`, {
      components: [
        {
          type: "MultiQuestionGrid",
          question_id: "q_g",
          choices: YESNO,
          props: { rows: [{ label: "Homeowner", internal_field: "homeowner", default: "yes" }] },
        },
      ],
    });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });
    const canvas = canvasRender(page);
    await expect(canvas.locator(".lg-mqg-row")).toHaveCount(1);

    // Select the grid node by clicking its (non-pill) label — the rows carry no
    // data-question-id, so closest([data-question-id]) resolves to the ONE grid
    // node, opening its inspector.
    await canvas.locator(".lg-mqg .lg-label").first().click();
    const rowsBlock = page.locator("[data-mqg-rows-block]");
    await expect(rowsBlock).toBeVisible();

    // Author a second sub-question through the REAL rows editor inputs.
    await page.locator("[data-mqg-add-row]").click();
    const newRow = rowsBlock.locator("[data-mqg-row]").nth(1);
    await newRow.locator('input[data-mqg-field="label"]').fill("Married");
    await newRow.locator('input[data-mqg-field="internal_field"]').fill("married");
    await newRow.locator('select[data-mqg-field="default"]').selectOption("no");

    // Persist through the real router.
    await saveStudio(page);
    const detail = await fetchSection(page.request, section.public_id);
    const grid = detail.content_json.components[0] as {
      props: { rows: Array<{ label: string; internal_field: string; default?: string }> };
    };
    expect(grid.props.rows).toHaveLength(2);
    expect(grid.props.rows[1]).toMatchObject({ label: "Married", internal_field: "married", default: "no" });

    // Reload → the canvas re-renders BOTH rows, the new one's default pre-selected.
    await page.reload({ waitUntil: "domcontentloaded" });
    const reloaded = canvasRender(page);
    await expect(reloaded.locator(".lg-mqg-row")).toHaveCount(2);
    await expect(reloaded.locator(".lg-mqg .lg-label", { hasText: "Married" })).toBeVisible();
    await expect(reloaded.locator('[data-lg-question="q_g::married"] [data-lg-choice="no"]')).toHaveClass(
      /lg-selected/,
    );
  });
});

// P5 fix-round (conductor-flagged residual, register PC-10): the studio rows
// editor's collectMqgRows silently DROPPED any per-row `choices` override on
// save (it rebuilt each row from only label/internal_field/default/required),
// so Image9's Gender=Male/Female override — authorable/seedable per the schema
// — was NOT preserved through the real editor: editing any OTHER row's field
// re-collected every row and erased Gender's override, orphaning its "male"
// default (no longer a member of the reverted shared Yes/No set) and 400ing on
// save. Fixed: the rows editor now (a) HONESTLY DISPLAYS an existing per-row
// override as a checked "Custom answers for this row" toggle + live, editable
// label/value entries (never hidden), and (b) round-trips it through
// collectMqgRows regardless of what else on the page changed.
test.describe("P5 fix-round (PC-10) — a per-row custom-choices override survives editing an adjacent row (cross-engine)", () => {
  test("Gender's seeded Male/Female override displays honestly (checked toggle + entries), and SURVIVES a save that only edits the Homeowner row", async ({
    page,
  }) => {
    const section = await createSection(page.request, `P5 row-choices ${uniq}`, { components: [DRIVER_GRID] });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });
    const canvas = canvasRender(page);
    await expect(canvas.locator(".lg-mqg-row")).toHaveCount(4);

    // Select the grid → open the rows editor.
    await canvas.locator(".lg-mqg .lg-label").first().click();
    const rowsBlock = page.locator("[data-mqg-rows-block]");
    await expect(rowsBlock).toBeVisible();
    const genderRow = rowsBlock.locator("[data-mqg-row]").nth(2);
    await expect(genderRow.locator('input[data-mqg-field="label"]')).toHaveValue("Gender");

    // HONEST DISPLAY: the override is CHECKED and its entries show the real
    // Male/Female pair — never a hidden/silent state.
    const customToggle = genderRow.locator("[data-mqg-custom-choices]");
    await expect(customToggle).toBeChecked();
    const entries = genderRow.locator("[data-mqg-choice-entry]");
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0).locator('[data-mqg-choice-field="label"]')).toHaveValue("Male");
    await expect(entries.nth(1).locator('[data-mqg-choice-field="label"]')).toHaveValue("Female");
    await expect(genderRow.locator('select[data-mqg-field="default"]')).toHaveValue("male");

    // Edit an ADJACENT row (Homeowner, index 0) — the exact regression shape:
    // any other row's collect must never erase Gender's override.
    const homeownerRow = rowsBlock.locator("[data-mqg-row]").nth(0);
    await homeownerRow.locator('input[data-mqg-field="label"]').fill("Owns home");
    await saveStudio(page);

    const detail = await fetchSection(page.request, section.public_id);
    const grid = detail.content_json.components[0] as {
      props: {
        rows: Array<{
          label: string;
          internal_field: string;
          default?: string;
          choices?: Array<{ label: string; value: string; analytics_id: string }>;
        }>;
      };
    };
    expect(grid.props.rows[0]).toMatchObject({ label: "Owns home", internal_field: "homeowner" });
    // The override SURVIVED — byte-identical to what was seeded.
    expect(grid.props.rows[2]).toMatchObject({
      label: "Gender",
      internal_field: "gender",
      default: "male",
      choices: [
        { label: "Male", value: "male", analytics_id: "male" },
        { label: "Female", value: "female", analytics_id: "female" },
      ],
    });

    // Reload → canvas renders the override (Male/Female labels, Male selected).
    // containText (not exact) — the studio canvas OVERLAYS a quick-remove "×"
    // on every choice pill (decorateChoiceCards, pre-existing, unrelated to
    // this fix); the label text is a substring of the decorated node.
    await page.reload({ waitUntil: "domcontentloaded" });
    const reloaded = canvasRender(page);
    const genderCanvasRow = reloaded.locator('[data-lg-question="q_driver::gender"]');
    await expect(genderCanvasRow.locator('[data-lg-choice="male"]')).toContainText("Male");
    await expect(genderCanvasRow.locator('[data-lg-choice="female"]')).toContainText("Female");
    await expect(genderCanvasRow.locator('[data-lg-choice="male"]')).toHaveClass(/lg-selected/);
  });

  test("turning OFF the custom toggle reverts the row to the shared set on save (an explicit operator choice, not a silent drop)", async ({
    page,
  }) => {
    const section = await createSection(page.request, `P5 row-choices-off ${uniq}`, { components: [DRIVER_GRID] });
    await page.goto(`/admin/leadgen/sections/${section.public_id}/edit`, { waitUntil: "domcontentloaded" });
    const canvas = canvasRender(page);
    await canvas.locator(".lg-mqg .lg-label").first().click();
    const rowsBlock = page.locator("[data-mqg-rows-block]");
    const genderRow = rowsBlock.locator("[data-mqg-row]").nth(2);
    await genderRow.locator("[data-mqg-custom-choices]").uncheck();
    // Unchecking hides the entries and reverts the default-picker to the
    // shared Yes/No set — the row's default ("male") is no longer a member,
    // so it resets to none rather than carrying an invalid value forward.
    await expect(genderRow.locator("[data-mqg-row-choices-list]")).toBeHidden();
    await saveStudio(page);

    const detail = await fetchSection(page.request, section.public_id);
    const grid = detail.content_json.components[0] as {
      props: { rows: Array<{ label: string; choices?: unknown }> };
    };
    expect(grid.props.rows[2]).toMatchObject({ label: "Gender" });
    expect("choices" in grid.props.rows[2]!).toBe(false);
  });
});
