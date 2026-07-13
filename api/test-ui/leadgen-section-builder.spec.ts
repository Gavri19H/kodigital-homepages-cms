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
//     param: 600px desktop wrap declared+rendered ↔ mobile wrap declared 480
//     but RENDERED at the REAL 375 frame viewport; DEV-66: the canvas is a
//     srcdoc iframe so the design's @media mobile rules genuinely fire —
//     asserted via a computed-style flip on .lg-content padding 24px↔16px);
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

import { test, expect, request as playwrightRequest, type FrameLocator, type Page } from "@playwright/test";
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

// DEV-66: the Build canvas renders inside a same-origin srcdoc iframe (a
// REAL 1280/375 viewport so the design's @media rules genuinely fire) — the
// render region and every decoration live in the FRAME document now, reached
// through frameLocator (the leadgen-quote-builder canvas idiom).
const CANVAS_FRAME = "#lg-studio-canvas-frame";
const CANVAS = "#lg-studio-canvas-render";

function canvas(page: Page): FrameLocator {
  return page.frameLocator(CANVAS_FRAME);
}

async function openImageSection(page: Page): Promise<void> {
  await page.goto(`/admin/leadgen/sections/${seed.imageSection.publicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(canvas(page).locator(`${CANVAS} h1.lg-headline`)).toBeVisible({ timeout: 20_000 });
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
    const canvasHeadline = canvas(page).locator(`${CANVAS} h1.lg-headline`);
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
    await expect(canvas(page).locator(`${CANVAS} h1.lg-headline`)).toHaveCount(1);
    await expect(canvas(page).locator(`${CANVAS} input`).filter({ hasNot: page.locator("nothing") })).not.toHaveCount(0); // ZIP input exists — the canvas is live markup…
    expect(
      await canvas(page).locator(`${CANVAS} input`).evaluateAll((els, needle) => els.filter((e) => (e as HTMLInputElement).value === needle).length, typed),
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
    // v3.1 §8.4: the selected BOUND node's Content tab shows BOTH Headline
    // and Subheadline inputs together (one source, two places to edit)
    await expect(page.locator('[data-bound-shared-input="section_headline"]')).toHaveValue(typed);
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

    // v3.1 §6.2 "Default selection on open" (contract-mandated, Phase B):
    // the studio now opens with the FIRST real answer node already selected
    // (never a bare "This Section" scope) — for this fixture that is the
    // ImageCardAnswerGrid ("q_cards"), which precedes the ZIP field in
    // seedSectionBuilder's content array. This supersedes the pre-v3.1
    // "nothing selected on open" assumption.
    await expect(scopeName).toHaveText("Image answer cards");

    // v3.1 §8.2: the golden's 5 dynamic tabs (choices/validation fold into
    // Content; design+layout fold into Style; mapping -> Offers).
    // ZIP component → component scope header + ZIP's tab set (Maps present).
    // v3.1 §5.6/§8.1: the whole 8-value Accept-swap family reads "Short text
    // field" — never its own concrete-type label ("ZIP").
    await canvas(page).locator(`${CANVAS} [data-component-type="ZIPInputQuestion"]`).click();
    await expect(scopeName).toHaveText("Short text field");
    await expect(affects).toContainText("Affects: this question unit");
    await expect(tab("maps")).toBeVisible();
    await expect(tab("content")).toBeVisible();
    await expect(tab("offers")).toBeVisible();
    // ZIP has no choices — the Content tab's choices sub-block stays hidden
    await tab("content").click();
    await expect(page.locator("[data-field-choices-block]")).toBeHidden();

    // a CHOICE card → choice scope header ("this card only") + Content tab
    // (choices now fold into Content, §8.2)
    await canvas(page).locator(`${CANVAS} [data-lg-choice="${IMAGE_CHOICES[0].value}"]`).click();
    await expect(scopeName).toContainText("Answer choice");
    await expect(scopeName).toContainText(IMAGE_CHOICES[0].label);
    await expect(affects).toHaveText("Affects: this card only.");
    await expect(page.locator('[data-scope-pill="choice"].active').first()).toBeVisible();
    await expect(tab("content")).toBeVisible();
    await expect(page.locator('[data-studio-panel="content"]')).toBeVisible();
    await expect(page.locator("[data-field-choices-block]")).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-02a-choice-scope.png` });

    // Component pill → the grid's component scope + ITS dynamic tabs
    await page.locator('[data-scope-pill="component"]').first().click();
    await expect(scopeName).toHaveText("Image answer cards");
    await expect(affects).toContainText("Affects: this question unit");
    await expect(tab("content")).toBeVisible();
    await expect(tab("style")).toBeVisible();
    await expect(tab("offers")).toBeVisible();
    await expect(tab("maps"), "Maps is ZIP/address-only — not on a card grid").toBeHidden();
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-02b-component-scope-tabs.png` });
  });

  test("③ C1: Choices tab has NO universal provider-value control; the per-choice chip lists one row per selected Offer (TWO Offers, DIVERGENT values) + deep-links", async ({ page }) => {
    test.setTimeout(120_000);
    await openImageSection(page);
    await canvas(page).locator(`${CANVAS} [data-lg-choice="${IMAGE_CHOICES[0].value}"]`).click();
    const panel = page.locator('[data-studio-panel="content"]');
    await expect(panel).toBeVisible();

    // the §12.2 copy: provider values are per Offer, in the Mapping tab
    await expect(panel.locator("[data-choices-c1-note]")).toContainText("Provider values are set per Offer in the Offers tab");

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
    await canvas(page).locator(`${CANVAS} [data-lg-choice="${IMAGE_CHOICES[0].value}"]`).click();
    const panel = page.locator('[data-studio-panel="content"]');
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
    await expect(canvas(page).locator(`${CANVAS} h1.lg-headline`)).toBeVisible({ timeout: 20_000 });
    await canvas(page).locator(`${CANVAS} [data-lg-choice="${edits[0]!.value}"]`).click();
    const panelAfter = page.locator('[data-studio-panel="content"]');
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
    await canvas(page).locator(`${CANVAS} [data-lg-choice]`).first().click();
    await page.locator('[data-scope-pill="component"]').first().click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
    const panel = page.locator('[data-studio-panel="style"]');
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
    await canvas(page).locator(`${CANVAS} [data-lg-choice]`).first().click();
    await page.locator('[data-scope-pill="component"]').first().click();
    await page.locator('[data-studio-inspector-tab="style"]').click();
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

  test("⑥ map an answer to an Offer field from the Offers tab via PICKERS only (no JSON anywhere in the flow)", async ({ page }) => {
    test.setTimeout(120_000);
    await openImageSection(page);
    await canvas(page).locator(`${CANVAS} [data-component-type="ZIPInputQuestion"]`).click();
    await page.locator('[data-studio-inspector-tab="offers"]').click();
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

  test("⑦ desktop/mobile round-trip at REAL widths (server viewport param + DEV-66: the frame viewport makes mobile @media rules ACTUALLY fire)", async ({ page }) => {
    test.setTimeout(120_000);
    // the wide admin window is kept from the pre-DEV-66 row; the widths are
    // now measured INSIDE the canvas iframe, whose element IS the viewport
    // (Desktop 1280 / Mobile 375 — §6.1.4), independent of the column width
    await page.setViewportSize({ width: 1760, height: 900 });
    await openImageSection(page);
    const frameEl = page.locator(CANVAS_FRAME);
    const wrap = canvas(page).locator(`${CANVAS} .lg-preview`).first();
    // computed style + rect measured through the same-origin contentDocument
    // (the exact mechanism the island itself uses)
    const measure = (prop: "paddingLeft" | "wrapWidth") =>
      page.evaluate((p) => {
        const f = document.querySelector("#lg-studio-canvas-frame") as HTMLIFrameElement;
        const el = f.contentDocument!.querySelector(p === "wrapWidth" ? ".lg-preview" : ".lg-content")!;
        if (p === "wrapWidth") return Math.round(el.getBoundingClientRect().width);
        return f.contentWindow!.getComputedStyle(el).paddingLeft;
      }, prop);

    // desktop: the frame is a REAL 1280 viewport; the server-rendered wrap
    // declares its width and RENDERS at it (kept server-width assertions)
    await expect(frameEl).toHaveAttribute("data-canvas-frame-viewport", "desktop");
    expect(Math.round((await frameEl.boundingBox())!.width), "the canvas frame is a real 1280 viewport").toBe(1280);
    await expect(wrap).toHaveAttribute("data-viewport", "desktop");
    await expect(wrap).toHaveClass(/lg-preview-desktop/);
    const desktopDeclared = Number(((await wrap.getAttribute("style")) ?? "").match(/max-width:(\d+)px/)?.[1]);
    expect(desktopDeclared).toBe(600);
    expect(await measure("wrapWidth"), "desktop wrap renders at its real width").toBe(600);
    // the @media(max-width:480px)-gated .lg-content padding is OFF at 1280:
    // the desktop token (1.5rem = 24px) applies inside the canvas document
    expect(await measure("paddingLeft"), "mobile-only padding rule must NOT fire at the 1280 frame viewport").toBe("24px");

    // → mobile: the island re-renders SERVER-side with viewport=mobile AND
    // sizes the frame element to a REAL 375 viewport
    await page.locator('[data-canvas-viewport="mobile"]').click();
    const mobileWrap = canvas(page).locator(`${CANVAS} .lg-preview`).first();
    await expect(mobileWrap).toHaveAttribute("data-viewport", "mobile", { timeout: 20_000 });
    await expect(mobileWrap).toHaveClass(/lg-preview-mobile/);
    await expect(page.locator('[data-canvas-viewport="mobile"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-canvas-viewport="desktop"]')).toHaveAttribute("aria-pressed", "false");
    await expect(frameEl).toHaveAttribute("data-canvas-frame-viewport", "mobile");
    expect(Math.round((await frameEl.boundingBox())!.width), "the canvas frame is a real 375 viewport").toBe(375);
    // the server STILL declares the design's mobile wrap width (480 — the
    // kept server-width assertion) while the RENDERED width is genuinely
    // capped by the 375 frame viewport (pre-DEV-66 the inline region let it
    // render 480 wide in a wide admin window and no mobile rule ever fired)
    const mobileDeclared = Number(((await mobileWrap.getAttribute("style")) ?? "").match(/max-width:(\d+)px/)?.[1]);
    expect(mobileDeclared).toBe(480);
    expect(await measure("wrapWidth"), "mobile wrap renders at the REAL frame viewport").toBe(375);
    // DEV-66 acceptance: a REAL mobile-only CSS effect now applies inside
    // the canvas — funnelChromeCss's @media-gated .lg-content padding drops
    // to the mobile token (1rem = 16px), differing from the desktop 24px
    expect(await measure("paddingLeft"), "the mobile @media rule FIRES inside the 375 canvas frame").toBe("16px");
    // the SAME canvas content re-rendered — the bound headline still rides it
    await expect(canvas(page).locator(`${CANVAS} h1.lg-headline`)).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-07a-mobile-375.png` });

    // → back to desktop: full round-trip (declared 600 AND rendered 600; the
    // mobile-only padding effect switches OFF again)
    await page.locator('[data-canvas-viewport="desktop"]').click();
    const backWrap = canvas(page).locator(`${CANVAS} .lg-preview`).first();
    await expect(backWrap).toHaveAttribute("data-viewport", "desktop", { timeout: 20_000 });
    await expect(frameEl).toHaveAttribute("data-canvas-frame-viewport", "desktop");
    expect(await measure("wrapWidth")).toBe(600);
    expect(await measure("paddingLeft"), "the mobile rule stops firing back at 1280").toBe("24px");
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
    // …while unit items remain placeable. v3.1 §5.2/§5.6: "Cards" is now one
    // tile whose default insert is IconCardAnswerGrid (ImageCardAnswerGrid is
    // reached via the Card-style swap, not its own data-add-component tile)
    // — check the tile itself, in the Answer-fields group (its Suggested
    // duplicate would make a bare data-add-component count ambiguous).
    await expect(
      library.locator('[data-library-group="answer-fields"] [data-tile][data-name="cards"]'),
    ).toHaveCount(1);
    await expect(library.locator('[data-add-component="ContinueButton"]')).toHaveCount(1);

    // the callout redirects page chrome to the Quote Builder
    const callout = page.locator("[data-studio-frame-callout]");
    await expect(callout).toBeVisible();
    // E2 F5: the Appendix-A verbatim copy (§5.2 / Appendix A) — rendered text,
    // so &amp;/&#8212; decode to & / em-dash.
    await expect(callout).toContainText("Header, footer, progress & background belong to the whole funnel");
    await expect(callout).toContainText("Quote Builder");
    await expect(callout.locator("[data-studio-callout-open]")).toHaveAttribute("href", "/admin/leadgen/quotes");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-08-palette-callout.png` });
  });

  test("⑨ legacy HeaderBar: amber badge + Move-to-frame END-TO-END (confirm names the funnel; frame gains the header group; the node leaves the Section)", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(`/admin/leadgen/sections/${seed.legacySection.publicId}/edit`, { waitUntil: "domcontentloaded" });
    const headerNode = canvas(page).locator(`${CANVAS} [data-component-type="HeaderBar"]`);
    await expect(headerNode).toBeVisible({ timeout: 20_000 });

    // the §5.4 amber badge with the Move / Keep affordances + the C2 note
    // (DEV-66: the badge is a canvas decoration — it lives in the frame doc)
    const badge = canvas(page).locator("[data-frame-badge]");
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("Page-frame element — belongs to the Quote frame");
    await expect(badge.locator("[data-frame-move]")).toHaveText("Move to Quote frame");
    await expect(badge.locator("[data-frame-keep]")).toHaveText("Keep (legacy)");
    await expect(badge).toContainText("activation blocks on this element unless that funnel’s Advanced legacy override allows it");
    await page.screenshot({ path: `${SHOT_DIR}/leadgen-c-09a-amber-badge.png` });

    // v3.1 §6.2 default selection now auto-selects the first REAL
    // answer-collecting node on open (here: the section's TwoButtonYesNo),
    // which leaves scope at 'component' — return to 'This Section' scope
    // explicitly (`.first()`: §6.1.2 "ONE pill implementation, two hosts" —
    // toolbar + inspector both render it) so the section-level usage line
    // (not the per-component affects text) is what's actually asserted below.
    await page.locator('[data-scope-pill="section"]').first().click();

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
    await expect(canvas(page).locator(`${CANVAS} [data-component-type="HeaderBar"]`)).toHaveCount(0);
    await expect(canvas(page).locator("[data-frame-badge]")).toHaveCount(0);
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
