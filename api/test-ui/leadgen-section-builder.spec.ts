// LeadGen v2.5 Phase C (slice C-verify) — the 15 §15.3 "Section Builder"
// Playwright rows, driven through the REAL studio at :8787 (wrangler dev
// webServer, playwright.config.ts). Seeding rides the REAL admin HTTP APIs
// only (leadgen-c-seed.ts). Rows covered (each test maps 1:1):
//
//   ① edit the canonical headline in the strip → the canvas updates WITHOUT a
//     second field appearing anywhere; inline-edit on canvas (dblclick) → the
//     strip updates (ONE store, two views; save → API read-back: bound node
//     carries NO props.text);
//   ② select a component → the inspector shows the scope header + the CORRECT
//     dynamic tabs (ZIP: Maps tab present; grid: Choices present, Maps absent);
//     select a CHOICE → the choice scope header ("this card only");
//   ③ C1: the Choices tab has NO universal provider-value control; each row's
//     read-only chip lists ONE row PER SELECTED OFFER and deep-links to that
//     Offer's value map — TWO Offers are seeded with DIVERGENT values for the
//     same choice (DEV-66d, §12.2: the chip shows both rows with their
//     distinct per-Offer values);
//   ④ image card grid: add an image per card via the PICKER (the real
//     Media-library dialog), set alt/title/subtitle/value; SAVE; re-open →
//     intact (UI + API read-back);
//   ⑤ the color control shows palette swatches, NO hex text; picking stores
//     the ROLE (design_overrides.iconColor === 'brand_primary' via API);
//   ⑥ map an answer to an Offer field from the Mapping tab via PICKERS only
//     (no JSON, no free text anywhere in the flow) → persisted edge read back;
//   ⑦ desktop/mobile round-trip at REAL widths (server-rendered viewport
//     param: 600px desktop wrap ↔ 480px mobile wrap, measured);
//   ⑧ the palette contains NO header/footer/progress/background items; the
//     callout links to the Quote Builder;
//   ⑨ a LEGACY Section carrying a HeaderBar (raw-API-injected) shows the amber
//     badge + the Move-to-frame flow END-TO-END: the confirm NAMES the funnel;
//     afterwards the funnel frame carries the header group (API read-back) and
//     the Section no longer has the node.
//
// Local D1 must be migrated + seeded once:
// `rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local`.
// Screenshots land in test-artifacts/leadgen-c-*.png.

import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import {
  seedSectionBuilder,
  IMAGE_CHOICES,
  PROVIDER_VALUE_MAP,
  PROVIDER_VALUE_MAP_B,
  IMAGE_SECTION_HEADLINE,
  type SectionBuilderSeed,
} from "./leadgen-c-seed";

test.use({ viewport: { width: 1280, height: 900 } });

const ORIGIN = "http://127.0.0.1:8787";
const LG_API = "/api/admin/leadgen";
const SHOT_DIR = "test-artifacts";
const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

let seed: SectionBuilderSeed;

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  seed = await seedSectionBuilder(ctx, uniq);
  await ctx.dispose();
});

const CANVAS = "#lg-studio-canvas-render";

async function openImageSection(page: Page): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${seed.imageSection.publicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(`${CANVAS} h1.lg-headline`)).toBeVisible({ timeout: 20_000 });
}

async function sectionDetail(page: Page, publicId: string): Promise<Record<string, unknown>> {
  const res = await page.request.get(`${LG_API}/sections/${publicId}`);
  expect(res.ok(), `GET section ${publicId}: ${res.status()}`).toBeTruthy();
  return (await res.json()) as Record<string, unknown>;
}

interface ContentNode {
  type: string;
  question_id: string;
  props?: Record<string, unknown>;
  choices?: Array<Record<string, unknown>>;
  design_overrides?: Record<string, unknown>;
}

function componentsOf(detail: Record<string, unknown>): ContentNode[] {
  return (detail["content_json"] as { components: ContentNode[] }).components;
}

test.describe.serial("LeadGen v2.5 Section Builder — §15.3 rows", () => {
  test("① canonical headline: strip → canvas (no second field); canvas dblclick → strip (one store, two views)", async ({ page }) => {
    test.setTimeout(120_000);
    await openImageSection(page);
    const strip = page.locator("#lg-section-headline");
    const canvasHeadline = page.locator(`${CANVAS} h1.lg-headline`);
    await expect(canvasHeadline).toHaveText(IMAGE_SECTION_HEADLINE);
    await expect(strip).toHaveValue(IMAGE_SECTION_HEADLINE);

    // strip → canvas: typing live-updates the server-rendered bound node
    const typed = `Which company type fits you ${uniq}?`;
    await strip.fill(typed);
    await expect(canvasHeadline).toHaveText(typed, { timeout: 20_000 });

    // …WITHOUT a second field appearing anywhere: the strip input is the ONE
    // field carrying the headline value (nothing is selected → no inspector
    // mirror), and the canvas renders TEXT (one h1, zero inputs with the value)
    const fieldsWithValue = await page.evaluate(
      (needle) =>
        Array.from(document.querySelectorAll("input, textarea")).filter(
          (el) => (el as HTMLInputElement).value === needle,
        ).length,
      typed,
    );
    expect(fieldsWithValue, "exactly ONE field carries the headline").toBe(1);
    await expect(page.locator(`${CANVAS} h1.lg-headline`)).toHaveCount(1);
    await expect(page.locator(`${CANVAS} input`).filter({ hasNot: page.locator("nothing") })).not.toHaveCount(0); // ZIP input exists — the canvas is live markup…
    expect(
      await page.locator(`${CANVAS} input`).evaluateAll((els, needle) => els.filter((e) => (e as HTMLInputElement).value === needle).length, typed),
      "…but NO canvas input carries the headline",
    ).toBe(0);
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-01a-strip-to-canvas.png` });

    // canvas → strip: dblclick opens the §6.2 inline contenteditable session.
    // Select FIRST (single click) and let the selection toolbar/inspector
    // layout settle — a dblclick straight off an unselected node moves the
    // target mid-gesture (the toolbar clusters appear after click #1).
    const inline = `Which sector fits best ${uniq}?`;
    await canvasHeadline.click();
    await expect(page.locator("[data-scope-editing-name]")).toHaveText("Question headline");
    // §5.2: the selected BOUND node's Content tab shows the SAME single field
    await expect(page.locator("[data-bound-content-label]")).toHaveText("Question headline (shared with the Section header above)");
    await expect(page.locator("[data-bound-shared-input]")).toHaveValue(typed);
    await canvasHeadline.dblclick();
    await expect(canvasHeadline).toHaveAttribute("contenteditable", "true");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(inline);
    await page.keyboard.press("Enter");
    await expect(strip).toHaveValue(inline);
    await expect(canvasHeadline).toHaveText(inline, { timeout: 20_000 });
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-01b-canvas-to-strip.png` });

    // ONE store persisted: headline_text updated; the bound node stores NO text
    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    const detail = await sectionDetail(page, seed.imageSection.publicId);
    expect(detail["headline_text"]).toBe(inline);
    const head = componentsOf(detail).find((c) => c.question_id === "q_head")!;
    expect(head.type).toBe("QuestionHeadline");
    expect(head.props?.["text"], "bound node never stores duplicate text").toBeUndefined();
  });

  test("② scope-aware inspector: component scope + correct dynamic tabs; choice scope on a card", async ({ page }) => {
    test.setTimeout(120_000);
    await openImageSection(page);
    const scopeName = page.locator("[data-scope-editing-name]");
    const affects = page.locator("[data-scope-affects]");
    const tab = (key: string) => page.locator(`[data-studio-inspector-tab="${key}"]`);

    // section scope before any selection
    await expect(scopeName).toHaveText("This Section (question unit)");

    // ZIP component → component scope header + ZIP's tab set (Maps present)
    await page.locator(`${CANVAS} [data-component-type="ZIPInputQuestion"]`).click();
    await expect(scopeName).toHaveText("ZIP");
    await expect(affects).toContainText("Affects: this question unit");
    await expect(tab("maps")).toBeVisible();
    await expect(tab("validation")).toBeVisible();
    await expect(tab("mapping")).toBeVisible();
    await expect(tab("choices")).toBeHidden();

    // a CHOICE card → choice scope header ("this card only") + Choices tab
    await page.locator(`${CANVAS} [data-lg-choice="${IMAGE_CHOICES[0].value}"]`).click();
    await expect(scopeName).toContainText("Answer choice");
    await expect(scopeName).toContainText(IMAGE_CHOICES[0].label);
    await expect(affects).toHaveText("Affects: this card only.");
    await expect(page.locator('[data-scope-pill="choice"].active').first()).toBeVisible();
    await expect(tab("choices")).toBeVisible();
    await expect(page.locator('[data-studio-panel="choices"]')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-02a-choice-scope.png` });

    // Component pill → the grid's component scope + ITS dynamic tabs
    await page.locator('[data-scope-pill="component"]').first().click();
    await expect(scopeName).toHaveText("Image answer cards");
    await expect(affects).toContainText("Affects: this question unit");
    await expect(tab("choices")).toBeVisible();
    await expect(tab("design")).toBeVisible();
    await expect(tab("mapping")).toBeVisible();
    await expect(tab("maps"), "Maps is ZIP/address-only — not on a card grid").toBeHidden();
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-02b-component-scope-tabs.png` });
  });

  test("③ C1: Choices tab has NO universal provider-value control; the per-choice chip lists one row per selected Offer (TWO Offers, DIVERGENT values) + deep-links", async ({ page }) => {
    test.setTimeout(120_000);
    await openImageSection(page);
    await page.locator(`${CANVAS} [data-lg-choice="${IMAGE_CHOICES[0].value}"]`).click();
    const panel = page.locator('[data-studio-panel="choices"]');
    await expect(panel).toBeVisible();

    // the §12.2 copy: provider values are per Offer, in the Mapping tab
    await expect(panel.locator("[data-choices-c1-note]")).toContainText("Provider values are set per Offer in the Mapping tab");

    // NO provider-value control: every editable choice field is Section-owned
    const rows = panel.locator("[data-choice-row]");
    await expect(rows).toHaveCount(IMAGE_CHOICES.length);
    const fieldKeys = await panel.locator("[data-choice-field]").evaluateAll((els) => [
      ...new Set(els.map((e) => e.getAttribute("data-choice-field"))),
    ]);
    expect(fieldKeys.some((k) => /provider/i.test(k ?? "")), "no provider-keyed input exists").toBe(false);
    expect(fieldKeys).toEqual(
      expect.arrayContaining(["label", "value", "analytics_id", "title", "subtitle", "imageMediaId", "image_alt"]),
    );

    // DEV-66d (§12.2 at browser level): TWO Offers are selected and their
    // value maps DIVERGE per choice — each row ENDS with the read-only chip
    // listing ONE row PER Offer, each with ITS OWN provider value + deep link.
    for (const choice of IMAGE_CHOICES) {
      // the fixture is genuinely divergent (the leg cannot degenerate)
      expect(PROVIDER_VALUE_MAP[choice.value]).not.toBe(PROVIDER_VALUE_MAP_B[choice.value]);

      const chip = panel.locator(`[data-choice-provider-chip="${choice.value}"]`);
      await expect(chip).toHaveText("Provider values: 2/2 Offers");
      await chip.click();
      const chipRows = panel.locator(`[data-choice-provider-rows="${choice.value}"] [data-provider-offer]`);
      await expect(chipRows).toHaveCount(2); // one row per selected Offer

      // Offer A's row: its own name, ITS value, ITS deep link
      const rowA = chipRows.filter({ hasText: `${seed.offer.name}:` });
      await expect(rowA).toHaveCount(1);
      await expect(rowA).toContainText(`${seed.offer.name}: ${PROVIDER_VALUE_MAP[choice.value]}`);
      const linkA = rowA.locator(`[data-provider-valuemap-link="${seed.offer.publicId}"]`);
      await expect(linkA).toHaveText("Open value map");
      await expect(linkA).toHaveAttribute("href", `/admin/leadgen/offers/${seed.offer.publicId}/edit#payload`);

      // Offer B's row: the DIVERGENT value for the SAME choice + its own link
      const rowB = chipRows.filter({ hasText: `${seed.offerB.name}:` });
      await expect(rowB).toHaveCount(1);
      await expect(rowB).toContainText(`${seed.offerB.name}: ${PROVIDER_VALUE_MAP_B[choice.value]}`);
      // A's value never bleeds into B's row (distinct per-Offer values)
      await expect(rowB).not.toContainText(PROVIDER_VALUE_MAP[choice.value]);
      const linkB = rowB.locator(`[data-provider-valuemap-link="${seed.offerB.publicId}"]`);
      await expect(linkB).toHaveText("Open value map");
      await expect(linkB).toHaveAttribute("href", `/admin/leadgen/offers/${seed.offerB.publicId}/edit#payload`);
    }
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-03-provider-chip-per-offer.png` });
  });

  test("④ image card grid: image per card via the REAL picker dialog + alt/title/subtitle/value; SAVE; re-open intact", async ({ page }) => {
    test.setTimeout(180_000);
    await openImageSection(page);
    await page.locator(`${CANVAS} [data-lg-choice="${IMAGE_CHOICES[0].value}"]`).click();
    const panel = page.locator('[data-studio-panel="choices"]');
    await expect(panel).toBeVisible();
    const rows = panel.locator("[data-choice-row]");
    await expect(rows).toHaveCount(2);

    const edits = [
      { alt: `Two designers at a whiteboard ${uniq}`, title: "Design agency", subtitle: "Studios & freelancers", value: "design_studio" },
      { alt: `Terminal on a laptop ${uniq}`, title: "Software vendor", subtitle: "SaaS & tools", value: "software_vendor" },
    ];

    for (let i = 0; i < 2; i += 1) {
      const row = rows.nth(i);
      // the PICKER: Choose… opens the shared Media-library dialog; picking a
      // library item writes the row's image cell
      await row.locator("[data-choice-media-choose]").click();
      const picker = page.locator("#lg-media-picker");
      await expect(picker).toBeVisible();
      await expect(picker).toHaveAttribute("role", "dialog");
      await picker.locator(`[data-media-pick="${seed.pickerMedia[i]}"]`).click();
      await expect(picker).toBeHidden();
      await expect(row.locator('[data-choice-field="imageMediaId"]')).toHaveValue(seed.pickerMedia[i]!);

      await row.locator('[data-choice-field="image_alt"]').fill(edits[i]!.alt);
      await row.locator('[data-choice-field="title"]').fill(edits[i]!.title);
      await row.locator('[data-choice-field="subtitle"]').fill(edits[i]!.subtitle);
      await row.locator('[data-choice-field="value"]').fill(edits[i]!.value);
    }
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-04a-picker-filled.png` });

    // SAVE → reload → RE-OPEN the choices grid → every field intact
    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    await expect(page.locator(`${CANVAS} h1.lg-headline`)).toBeVisible({ timeout: 20_000 });
    await page.locator(`${CANVAS} [data-lg-choice="${edits[0]!.value}"]`).click();
    const panelAfter = page.locator('[data-studio-panel="choices"]');
    await expect(panelAfter).toBeVisible();
    const rowsAfter = panelAfter.locator("[data-choice-row]");
    for (let i = 0; i < 2; i += 1) {
      const row = rowsAfter.nth(i);
      await expect(row.locator('[data-choice-field="imageMediaId"]')).toHaveValue(seed.pickerMedia[i]!);
      await expect(row.locator('[data-choice-field="image_alt"]')).toHaveValue(edits[i]!.alt);
      await expect(row.locator('[data-choice-field="title"]')).toHaveValue(edits[i]!.title);
      await expect(row.locator('[data-choice-field="subtitle"]')).toHaveValue(edits[i]!.subtitle);
      await expect(row.locator('[data-choice-field="value"]')).toHaveValue(edits[i]!.value);
    }
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-04b-reopened-intact.png` });

    // server truth
    const detail = await sectionDetail(page, seed.imageSection.publicId);
    const grid = componentsOf(detail).find((c) => c.question_id === "q_cards")!;
    for (let i = 0; i < 2; i += 1) {
      expect(grid.choices?.[i]).toMatchObject({
        imageMediaId: seed.pickerMedia[i],
        image_alt: edits[i]!.alt,
        title: edits[i]!.title,
        subtitle: edits[i]!.subtitle,
        value: edits[i]!.value,
      });
    }
  });

  test("⑤ color control: palette swatches, NO hex text; picking stores the ROLE (API read-back)", async ({ page }) => {
    test.setTimeout(120_000);
    await openImageSection(page);
    // select the grid (card → Component pill), open the Design tab
    await page.locator(`${CANVAS} [data-lg-choice]`).first().click();
    await page.locator('[data-scope-pill="component"]').first().click();
    await page.locator('[data-studio-inspector-tab="design"]').click();
    const panel = page.locator('[data-studio-panel="design"]');
    await expect(panel).toBeVisible();

    // the §9.4 role row: swatch chip + role select with OPERATOR labels
    const iconRow = panel.locator('[data-override-row="iconColor"]');
    await expect(iconRow.locator('[data-override-swatch="iconColor"]')).toBeVisible();
    const select = panel.locator("#lg-inspector-iconColor");
    await expect(select.locator('option[value="brand_primary"]')).toHaveText("Brand primary");
    // NO hex text anywhere on this tab (visible copy + option labels)
    const panelText = await panel.innerText();
    expect(panelText).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    const optionLabels = await panel.locator("option").allTextContents();
    for (const label of optionLabels) expect(label).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);

    // picking writes the ROLE (never hex)
    await select.selectOption("brand_primary");
    await expect(select).toHaveValue("brand_primary");
    // afterModelChange re-renders the §9.4 decorations on the SAME tick
    // (renderOverrideDecorations); re-selecting exercises the populate path
    // over the stored ROLE as well.
    await page.locator(`${CANVAS} [data-lg-choice]`).first().click();
    await page.locator('[data-scope-pill="component"]').first().click();
    await page.locator('[data-studio-inspector-tab="design"]').click();
    await expect(panel.locator('[data-override-source="iconColor"]')).toContainText("Brand primary");
    await expect(panel.locator('[data-override-reset="iconColor"]'), "Reset to inherited appears once overridden").toBeVisible();
    const swatchBg = await panel
      .locator('[data-override-swatch="iconColor"]')
      .evaluate((el) => (el as HTMLElement).style.background);
    expect(swatchBg, "the swatch previews the resolved role color").not.toBe("");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-05-role-swatches.png` });

    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    const detail = await sectionDetail(page, seed.imageSection.publicId);
    const grid = componentsOf(detail).find((c) => c.question_id === "q_cards")!;
    expect(grid.design_overrides?.["iconColor"], "the stored value is the ROLE").toBe("brand_primary");
  });

  test("⑥ map an answer to an Offer field from the Mapping tab via PICKERS only (no JSON anywhere in the flow)", async ({ page }) => {
    test.setTimeout(120_000);
    await openImageSection(page);
    await page.locator(`${CANVAS} [data-component-type="ZIPInputQuestion"]`).click();
    await page.locator('[data-studio-inspector-tab="mapping"]').click();
    const wrap = page.locator("[data-studio-inspector-mapping]");
    await expect(wrap).toBeVisible();

    // one row per selected Offer, loaded from the live offers panel
    const offerRow = wrap.locator(`[data-inspector-map-offer="${seed.offer.publicId}"]`);
    await expect(offerRow).toBeVisible({ timeout: 20_000 });
    await expect(offerRow.locator("[data-map-state]")).toHaveAttribute("data-map-state", "unmapped");

    // PICKERS ONLY: the flow is a single select of labeled schema fields —
    // no free-text input, no textarea, no JSON surface anywhere in it
    await expect(wrap.locator("textarea")).toHaveCount(0);
    await expect(wrap.locator("input")).toHaveCount(0);
    expect(await wrap.innerText()).not.toMatch(/\bJSON\b/i);

    const quickmap = offerRow.locator(`select[data-inspector-quickmap="${seed.offer.id}"]`);
    // §12.1 (DEV-65c mapping-panel work): the option LABEL is the schema
    // field's operator label + plain-words type; the raw dotted path stays
    // the option VALUE (plumbing) and never renders as the visible label.
    const zipOption = quickmap.locator('option[value="lead.company_zip"]');
    await expect(zipOption).toContainText("Company zip — text");
    await expect(zipOption).not.toContainText("lead.company_zip");
    await quickmap.selectOption("lead.company_zip");
    await expect(
      page.locator(`[data-inspector-map-offer="${seed.offer.publicId}"] [data-map-state]`),
    ).toHaveAttribute("data-map-state", "complete");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-06-quickmap-pickers.png` });

    // persisted: the zip → lead.company_zip edge joined the business_type edge
    await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
    const detail = await sectionDetail(page, seed.imageSection.publicId);
    const maps = detail["answer_maps"] as Array<Record<string, unknown>>;
    const zipEdge = maps.find((m) => m["internal_field"] === "zip");
    expect(zipEdge, "zip edge persisted").toBeTruthy();
    expect(zipEdge!["offer_payload_field_path"]).toBe("lead.company_zip");
    expect(maps.find((m) => m["internal_field"] === "business_type"), "seeded edge kept").toBeTruthy();
  });

  test("⑦ desktop/mobile round-trip at REAL widths (server-rendered viewport param)", async ({ page }) => {
    test.setTimeout(120_000);
    // wide enough that the canvas COLUMN (viewport − 250px admin sidebar −
    // 280px library − 380px inspector − paddings/gaps) exceeds the 600px
    // desktop wrap → both server-declared widths render UNCAPPED
    await page.setViewportSize({ width: 1760, height: 900 });
    await openImageSection(page);
    const wrap = page.locator(`${CANVAS} .lg-preview`).first();

    // desktop: the server-rendered wrap declares its width and RENDERS at it
    await expect(wrap).toHaveAttribute("data-viewport", "desktop");
    await expect(wrap).toHaveClass(/lg-preview-desktop/);
    const desktopDeclared = Number(((await wrap.getAttribute("style")) ?? "").match(/max-width:(\d+)px/)?.[1]);
    expect(desktopDeclared).toBe(600);
    const desktopBox = await wrap.boundingBox();
    expect(Math.round(desktopBox!.width), "desktop wrap renders at its real width").toBe(600);

    // → mobile: the island re-renders SERVER-side with viewport=mobile
    await page.locator('[data-canvas-viewport="mobile"]').click();
    const mobileWrap = page.locator(`${CANVAS} .lg-preview`).first();
    await expect(mobileWrap).toHaveAttribute("data-viewport", "mobile", { timeout: 20_000 });
    await expect(mobileWrap).toHaveClass(/lg-preview-mobile/);
    await expect(page.locator('[data-canvas-viewport="mobile"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-canvas-viewport="desktop"]')).toHaveAttribute("aria-pressed", "false");
    const mobileBox = await mobileWrap.boundingBox();
    expect(Math.round(mobileBox!.width), "mobile wrap renders at the design's real mobile width").toBe(480);
    // the SAME canvas content re-rendered — the bound headline still rides it
    await expect(page.locator(`${CANVAS} h1.lg-headline`)).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-07a-mobile-480.png` });

    // → back to desktop: full round-trip
    await page.locator('[data-canvas-viewport="desktop"]').click();
    const backWrap = page.locator(`${CANVAS} .lg-preview`).first();
    await expect(backWrap).toHaveAttribute("data-viewport", "desktop", { timeout: 20_000 });
    const backBox = await backWrap.boundingBox();
    expect(Math.round(backBox!.width)).toBe(600);
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-07b-desktop-600.png` });
  });

  test("⑧ palette carries NO header/footer/progress/background items; the callout links to the Quote Builder", async ({ page }) => {
    test.setTimeout(90_000);
    await openImageSection(page);
    const library = page.locator("[data-studio-library]");
    await expect(library).toBeVisible();

    // §8.2/§8.3: every frame-scope type is GONE from the palette
    const frameTypes = [
      "HeaderBar",
      "FooterBar",
      "ProgressBar",
      "StepIndicator",
      "HeaderLogo",
      "BackButton",
      "DisclosureLink",
      "BackgroundPanel",
    ];
    for (const type of frameTypes) {
      await expect(library.locator(`[data-add-component="${type}"]`), `${type} must not be placeable`).toHaveCount(0);
    }
    // …while unit items remain placeable
    await expect(library.locator('[data-add-component="ImageCardAnswerGrid"]')).toHaveCount(1);
    await expect(library.locator('[data-add-component="ContinueButton"]')).toHaveCount(1);

    // the callout redirects page chrome to the Quote Builder
    const callout = page.locator("[data-studio-frame-callout]");
    await expect(callout).toBeVisible();
    await expect(callout).toContainText("Looking for the page header, footer, progress bar or background?");
    await expect(callout).toContainText("Quote Builder");
    await expect(callout.locator("[data-studio-callout-open]")).toHaveAttribute("href", "/admin/leadgen/quotes");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-08-palette-callout.png` });
  });

  test("⑨ legacy HeaderBar: amber badge + Move-to-frame END-TO-END (confirm names the funnel; frame gains the header group; the node leaves the Section)", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`/admin/leadgen/sections/${seed.legacySection.publicId}/edit`, { waitUntil: "domcontentloaded" });
    const headerNode = page.locator(`${CANVAS} [data-component-type="HeaderBar"]`);
    await expect(headerNode).toBeVisible({ timeout: 20_000 });

    // the §5.4 amber badge with the Move / Keep affordances + the C2 note
    const badge = page.locator("[data-frame-badge]");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Page-frame element — belongs to the Quote frame");
    await expect(badge.locator("[data-frame-move]")).toHaveText("Move to Quote frame");
    await expect(badge.locator("[data-frame-keep]")).toHaveText("Keep (legacy)");
    await expect(badge).toContainText("activation blocks on this element unless that funnel’s Advanced legacy override allows it");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-09a-amber-badge.png` });

    // wait for the §7.1 usage line — the single-funnel Move needs the loaded
    // usage rows (this Section is used by exactly ONE funnel)
    await expect(page.locator("[data-scope-affects]")).toContainText("used in 1 quote", { timeout: 20_000 });

    // the explicit confirm NAMES the funnel — capture + accept
    let confirmMessage = "";
    page.once("dialog", (dialog) => {
      confirmMessage = dialog.message();
      void dialog.accept();
    });
    await badge.locator("[data-frame-move]").click();

    // the move completes on the SAME action: PUT frame + section PATCH
    const note = page.locator("[data-studio-pending-note]");
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(note).toContainText(`Moved into the Quote frame of “${seed.funnelName}”`);
    await expect(note).toContainText("the Section was saved without the element");
    expect(confirmMessage).toContain("Move this Header bar into the Quote frame of funnel");
    expect(confirmMessage, "the confirm NAMES the funnel").toContain(seed.funnelName);

    // the canvas no longer shows the node (and no amber badge remains)
    await expect(page.locator(`${CANVAS} [data-component-type="HeaderBar"]`)).toHaveCount(0);
    await expect(page.locator("[data-frame-badge]")).toHaveCount(0);
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-09b-after-move.png` });

    // API read-back 1: the funnel frame CARRIES the equivalent header group
    const frame = (await page.request
      .get(`${LG_API}/funnels/${seed.funnelPublicId}/frame`)
      .then((r) => r.json())) as { frame_config: Record<string, unknown> };
    const header = frame.frame_config["header"] as Record<string, unknown>;
    expect(header, "frame gained the header group").toBeTruthy();
    expect(header["enabled"]).toBe(true);
    expect(header["secure_badge"]).toMatchObject({ enabled: true, text: "Secure & confidential" });
    // the pre-seeded template survived the group merge
    expect(frame.frame_config["template"]).toBe("centered");

    // API read-back 2: the Section no longer has the node (persisted removal)
    const detail = await sectionDetail(page, seed.legacySection.publicId);
    expect(componentsOf(detail).some((c) => c.type === "HeaderBar")).toBe(false);
    // …and the rest of the unit survived
    expect(componentsOf(detail).some((c) => c.type === "TwoButtonYesNo")).toBe(true);
  });
});
