// LeadGen v2.5.1 Phase E (slice E1) — 08 §8.7 THE FIVE CAPABILITY PATTERNS
// (A–E) built THROUGH THE UI (15 §15.3 "Patterns" row: fixtures, not seeded
// JSON) + the 15 §15.4 visual-regression set (five composed pages,
// desktop 1280 + mobile 375, committed baselines under
// test-ui/__screenshots__/leadgen-v25/).
//
// DIVISION OF LABOR vs the existing suites (why this file drives what it
// drives and reuses what it reuses):
//   * leadgen-quote-builder.spec.ts (B4) proves the GENERIC frame-studio
//     mechanics: template pick dialog (②/⑥), region-inspector open + progress
//     edits (④), one-Save persistence (⑧), site branding pickers (①/③).
//   * leadgen-section-builder.spec.ts (C-verify) proves the studio mechanics:
//     bound headline strip (①), scope tabs (②), the REAL media-picker dialog
//     (④), role swatches (⑤), viewport round-trip (⑦).
//   * leadgen-studio-patterns.spec.ts (DEV-67) proves the §8.11/§8.12 studio
//     flows with frame configs stored at SEED level.
//   THIS file closes the §15.3 "Patterns" row: for EACH §8.7 pattern the
//   UNIT is authored through the real Section Builder (palette + tabbed
//   inspectors + Choices tab) AND the pattern's PER-PATTERN frame config is
//   authored through the real Quote Builder (template pick → apply, region
//   inspectors: trust-strip logos via the REAL media picker, CTA tel,
//   disclosure copy, benefit items via the curated icon select, background
//   role swatch, footer links/description) and persisted by the ONE Save.
//   The COMPOSED result is asserted behaviorally on the Quote Builder canvas
//   (renderQuoteFrame — the SAME composition path /lg serves, 04 §4.6
//   parity-by-construction) per the §8.7 "Required tokens/controls" column.
//
// FRAME-AUTHORING REACHABILITY (REGISTERED UX observations, not defect
// assertions — no contract clause promises hidden-region reachability;
// flagged for the contract owner as §15.5 break-it-pass adjacent gaps):
//   (1) 04 §4.1 defines canvas region click as the ONLY inspector opener,
//       and designs/frame.ts renders trust_strip/benefit_bar ONLY when
//       enabled AND non-empty (`if (!t.enabled) return ""` /
//       `items.length === 0`). A fresh template exposes NO click target for
//       those regions — their on/off inspectors are unreachable from a blank
//       state through the UI alone. Each pattern seed therefore bootstraps
//       the minimal "region visible" content via the REAL frame API
//       (leadgen-e-seed) and the test authors the pattern's ACTUAL content
//       through the opened inspector. Every bootstrap template is OFF-TARGET
//       so the template pick in the test is a REAL C5 switch (content
//       preserved / layout replaced).
//   (2) The BACKGROUND inspector is unreachable [pre-E4 measurement; FIXED at HEAD — bare-canvas clicks now resolve to the background region (E4/DEV-74a); Playwright ⑩ grounds the click path; template-default authoring below remains valid §4.3/§8.7] even when the region
//       renders: `.lg-frame-background` is an aria-hidden layer stacked
//       BEHIND #lg-funnel-root's content, so a pointer click anywhere lands
//       on the root (measured: Playwright actionability reports
//       "#lg-funnel-root … intercepts pointer events" at every probed
//       point), and the island's region walk finds no data-frame-region on
//       the root → the panel never opens. Pattern D's brand background is
//       therefore authored the way §4.3/§8.7 define it — the full-background
//       TEMPLATE pick (role brand_primary + style brand are its defaults) —
//       and asserted on the composed page + effective_frame.
//
// STORED vs EFFECTIVE frame assertions: a template switch persists a SPARSE
// config (version + template + preserved operator content —
// computeTemplateSwitch), so template-default-derived fields (B's
// secure-badge availability / footer show_logo, C's disclosure availability)
// are asserted on `effective_frame` (13 §13.2), while every UI-authored
// field is asserted on the STORED `frame_config`.
//
// DEV-64(b) REGISTERED GAP (docs/leadgen/traceability.md): the §6.5 input
// "icon" quick control was omitted — renderTextInput has no icon slot, so a
// stored icon prop would never render. Pattern C's §8.7 "input icon" cell is
// therefore NOT asserted; the ZIP input + Next button are asserted instead.
//
// §15.4 SURFACE DECISION — the five composed pages are the REAL /lg pages of
// the activated pattern funnels (not the admin preview srcdoc):
//   * honest: the exact server-rendered + engine-hydrated bytes users get;
//   * cheap: activation is one PUT via the established seed helpers (pattern
//     units select NO Offers → clean 200, the leadgen-visual.spec.ts
//     precedent);
//   * stable: every rendered string is an authored constant (uniq values
//     live only in never-rendered names/hosts/keys), the funnel chrome
//     declares font stacks without @font-face (local fallback metrics are
//     machine-stable), logos are the deterministic 1-px seed PNG, the engine
//     autofocus is blurred (the leadgen-visual normalisation) and
//     animations/caret are disabled by toHaveScreenshot.
//   Masks (15 §15.4 "masks for dynamic ids"): the site-logo / footer-logo /
//   trust-strip <img> elements — their src carries per-run storage keys and
//   their alt fallback carries per-run site names.
//   The FIFTH page ("ZIP-input frame (C-unit variant)") is mission-3.8
//   Pattern E (ZIP lead capture = C's unit, §8.7 note) activated as its own
//   single-slide funnel in the header-cta frame with template defaults —
//   C's frame authoring is UI-proven by the C test; the fifth page pins the
//   unit-focused composition (single-step progress, no CTA/benefit content).
//
// BASELINES: playwright.config.ts pins snapshotPathTemplate to
// test-ui/__screenshots__/{arg}{ext}; the calls here name
// ['leadgen-v25', '<name>.png']. Generation run: `--update-snapshots`
// (writes the committed set); plain runs must be ZERO-DIFF
// (maxDiffPixelRatio mirrors the leadgen-visual conventions: 0.002 desktop /
// 0.0025 mobile).
//
// Determinism notes: the Quote Builder canvas is a server-rendered STILL
// (sandbox="allow-same-origin", scripts inert) — every edit re-renders it
// via the debounced preview POST, so assertions wait on the EXPECTED DOM
// (Playwright retry) instead of racing timers. Studio preview swaps follow
// the DEV-67 stale-marking idiom where hydration matters.
//
// Local D1 must be migrated + seeded once:
// `rm -rf .wrangler/state/v3/d1 && npm run db:migrate:local && npm run seed:local`.
// Evidence screenshots (§15.3 "then screenshot desktop+mobile" for ALL five
// patterns, including E which is not in the §15.4 committed set) land in
// test-artifacts/leadgen-e1-patterns/.

import { test, expect, request as playwrightRequest, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { uploadPng } from "./listicles-p6-seed";
import {
  activateQuoteOnSite,
  fetchFrameState,
  fetchSectionDetail,
  seedBrandedSite,
  seedFeederOffer,
  seedFillerSections,
  seedPatternQuote,
  type PatternSite,
  type SectionDetail,
  type StudioNode,
} from "./leadgen-e-seed";

// Realistic desktop Chrome UA — /lg's runtimeRequestGuard bot arm must not
// trip on the §15.4 live-page navigations (the leadgen-live-funnel DEV-GUARD
// note); the admin surfaces ignore it.
const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test.use({
  viewport: { width: 1280, height: 900 },
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});

const ORIGIN = "http://127.0.0.1:8787";
const SHOT_DIR = "test-artifacts/leadgen-e1-patterns";
const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

// One shared activity/vertical vocabulary for the whole file — the §8.2
// dropdowns are sourced from Offers, so one feeder Offer with this pair makes
// the pair pickable on /sections/new (the DEV-67 E1 idiom).
const ACT = `e1-act-${uniq}`;
const VERT = `e1-vert-${uniq}`;

// Shared fixtures (seeded once in beforeAll through the REAL admin APIs).
let site: PatternSite;
let fillers: number[];

// §15.4 registry: pattern tests activate their funnels and register the live
// /lg page here; the visual tests consume it. A red pattern test leaves its
// entry missing and the dependent visual test fails with a NAMED cause —
// never a silent skip.
const livePages: Partial<Record<"A" | "B" | "C" | "D" | "CZ", { host: string; slug: string }>> = {};

function requireLive(key: "A" | "B" | "C" | "D" | "CZ"): { host: string; slug: string } {
  const entry = livePages[key];
  if (!entry) {
    throw new Error(
      `§15.4 page '${key}' was never activated — its §8.7 pattern test failed upstream (build the fixture first).`,
    );
  }
  return entry;
}

test.beforeAll(async () => {
  mkdirSync(SHOT_DIR, { recursive: true });
  const ctx = await playwrightRequest.newContext({ baseURL: ORIGIN });
  await seedFeederOffer(ctx, { uniq, activity: ACT, vertical: VERT });
  site = await seedBrandedSite(ctx, uniq);
  fillers = await seedFillerSections(ctx, { uniq, activity: ACT, vertical: VERT });
  await ctx.dispose();
});

// ---------------------------------------------------------------------------
// Section Builder driving helpers (the DEV-67 idiom — operator controls only)
// ---------------------------------------------------------------------------

function studioCanvas(page: Page) {
  return page.frameLocator("#lg-studio-canvas-frame").locator("#lg-studio-canvas-render");
}

async function waitBootPreview(page: Page): Promise<void> {
  await expect(
    page.frameLocator("#lg-preview-frame").locator('#lg-funnel-root[data-lg-ready="1"]'),
  ).toBeAttached({ timeout: 20_000 });
}

async function openNewStudio(
  page: Page,
  name: string,
  copy: { headline?: string; subheadline?: string } = {},
): Promise<void> {
  await page.goto("/admin/leadgen/sections/new", { waitUntil: "domcontentloaded" });
  const activity = page.locator("#lg-section-activity");
  await expect(activity.locator(`option[value="${ACT}"]`)).toHaveCount(1);
  await activity.selectOption(ACT);
  const vertical = page.locator("#lg-section-vertical");
  await expect(vertical.locator(`option[value="${VERT}"]`)).toHaveCount(1);
  await vertical.selectOption(VERT);
  await page.fill("#lg-section-name", name);
  await page.fill("#lg-section-headline", copy.headline ?? name);
  if (copy.subheadline !== undefined) {
    await page.fill("#lg-section-subheadline", copy.subheadline);
  }
  await waitBootPreview(page);
}

// §8.3 operator labels (STUDIO_TYPE_META) — the §7.1 scope header shows the
// LABEL of the selected component (type ids never surface).
const TYPE_LABELS: Record<string, string> = {
  ButtonAnswerGroup: "Simple answer buttons",
  TwoButtonYesNo: "Yes / No",
  IconCardAnswerGrid: "Icon answer cards",
  MultiChoiceCardGroup: "Multi-select cards",
  ZIPInputQuestion: "ZIP",
  ContinueButton: "Continue button",
  Stack: "Stack",
  GridContainer: "Answer grid",
};

// v3.1 Phase B redesign: the palette is now 20 golden TILES keyed by
// data-tile/data-name (contract §5.2/§5.5), not one dedicated
// data-add-component per catalog type. Grounded in ui-section-studio.ts's
// STUDIO_LIBRARY_GROUPS tile table + LEADGEN_FIELD_ACCEPT_TYPE
// (content-schema.ts) — see leadgen-studio-patterns.spec.ts's TYPE_INSERT
// for the full commented mapping; this file only needs the subset it uses.
interface TileInsert {
  dataName: string;
  swap?: "accept" | "cardStyle" | "sliderFormat" | "searchable";
  swapValue?: string;
}
const TYPE_INSERT: Partial<Record<string, TileInsert>> = {
  ButtonAnswerGroup: { dataName: "buttons" },
  TwoButtonYesNo: { dataName: "yes no" },
  IconCardAnswerGrid: { dataName: "cards" },
  MultiChoiceCardGroup: { dataName: "multi-select" },
  ContinueButton: { dataName: "continue button" },
  GridContainer: { dataName: "grid" },
  ZIPInputQuestion: { dataName: "short text", swap: "accept", swapValue: "us_zip" },
  // Stack intentionally omitted — no tile (§5.2); use groupSelectionIntoStack.
};

// Clicks the golden TILE (data-tile/data-name), then performs the §5.6 swap
// (Accept/Card-style/Slider-format/Searchable) when the wanted type isn't
// the tile's own default. `.first()` is deliberate: "Buttons"/"Cards"/
// "Short text" repeat once in the Suggested group (§5.2 "identical insert
// semantics") — both copies are always visible (Suggested/Answer-fields
// default OPEN), so `.first()` deterministically picks the Suggested one.
async function addComponent(page: Page, type: string): Promise<void> {
  const canvasNodes = studioCanvas(page).locator("[data-component-type]");
  const before = await canvasNodes.count();
  const insert = TYPE_INSERT[type];
  if (!insert) {
    throw new Error(`addComponent: no §5.6 tile mapping for type "${type}" in this file's TYPE_INSERT subset`);
  }
  const tile = page.locator(`[data-tile][data-name="${insert.dataName}"]`).first();
  // §5.1: the Layout group (Card/Columns/Grid/Spacer) is COLLAPSED by
  // default (defaultOpen: false) — unlike Suggested/Answer fields/Content,
  // its tiles are hidden until the group header is expanded. Detect this
  // generically (ancestor [data-library-items] group, rather than hardcode
  // which groups start closed — that's ui-section-studio.ts's own state).
  if (!(await tile.isVisible())) {
    const groupKey = await tile.evaluate(
      (el) => el.closest("[data-library-items]")?.getAttribute("data-library-items") ?? null,
    );
    if (groupKey) {
      await page.locator(`[data-library-group-toggle="${groupKey}"]`).click();
    }
  }
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(canvasNodes).toHaveCount(before + 1, { timeout: 20_000 });
  if (insert.swap === "accept") {
    await page.locator("[data-toolbar-accept]").selectOption(insert.swapValue!);
  } else if (insert.swap === "cardStyle") {
    await page.locator(`[data-card-style="${insert.swapValue}"]`).click();
  } else if (insert.swap === "sliderFormat") {
    await page.locator("[data-toolbar-slider-format]").click();
  } else if (insert.swap === "searchable") {
    await page.locator("[data-toolbar-searchable]").click();
  }
  await expect(page.locator("[data-scope-editing-name]")).toHaveText(TYPE_LABELS[type] ?? type);
}

// §5.2 dropped "Stack" as a directly-insertable tile. The pre-existing
// "Group → Stack" toolbar action wraps the CURRENTLY SELECTED node into a
// new Stack and moves the selection to it — insert the child FIRST, then
// group it (equivalent end model shape to the old wrap-then-insert-into).
async function groupSelectionIntoStack(page: Page): Promise<void> {
  await page.locator('[data-studio-act="group-stack"]').click();
  await expect(page.locator("[data-scope-editing-name]")).toHaveText("Stack");
}

async function openInspectorTab(page: Page, key: string): Promise<void> {
  const tab = page.locator(`[data-studio-inspector-tab="${key}"]`);
  await expect(tab).toBeVisible();
  await tab.click();
}

async function setContentField(page: Page, key: string, value: string): Promise<void> {
  await openInspectorTab(page, "content");
  await page.locator(`[data-studio-panel="content"] input[data-inspector-field="${key}"]`).fill(value);
}

async function setInternalField(page: Page, value: string): Promise<void> {
  await openInspectorTab(page, "advanced");
  await page
    .locator('[data-studio-panel="advanced"] input[data-inspector-field="internal_field"]')
    .fill(value);
}

function containerGroup(page: Page, type: string) {
  return page.locator(`[data-studio-panel="layout"] [data-container-group="${type}"]`);
}

function choiceRows(page: Page) {
  return page.locator("[data-inspector-choices] [data-choice-row]");
}

async function fillChoiceRow(page: Page, index: number, fields: Record<string, string>): Promise<void> {
  const row = choiceRows(page).nth(index);
  for (const [key, value] of Object.entries(fields)) {
    await row.locator(`input[data-choice-field="${key}"]`).fill(value);
  }
}

async function saveStudio(page: Page): Promise<void> {
  await Promise.all([page.waitForEvent("load"), page.locator("#lg-section-save").click()]);
}

function publicIdFromUrl(page: Page): string {
  const m = page.url().match(/\/sections\/(lgs_[^/]+)\/edit/);
  if (!m || m[1] === undefined) throw new Error(`no section public id in ${page.url()}`);
  return m[1];
}

// Author a unit and return its saved server model.
async function savedUnit(page: Page): Promise<SectionDetail> {
  await saveStudio(page);
  return fetchSectionDetail(page.request, publicIdFromUrl(page));
}

// ---------------------------------------------------------------------------
// §8.7(e) "zero custom CSS anywhere" — the saved model carries ONLY catalog
// types + typed node keys; props are tokenized values, never stylesheet text
// (the DEV-67 assertTokenizedModel contract, verbatim).
// ---------------------------------------------------------------------------

const NODE_KEYS = new Set([
  "type",
  "question_id",
  "question_key",
  "internal_field",
  "answer_type",
  "required",
  "valid_values",
  "bind",
  "choices",
  "choiceDisplay",
  "conditional",
  "design_preset",
  "design_overrides",
  "props",
  "children",
  "container_id",
]);

function collectNodes(nodes: StudioNode[], out: StudioNode[] = []): StudioNode[] {
  for (const node of nodes) {
    out.push(node);
    if (Array.isArray(node.children)) collectNodes(node.children, out);
  }
  return out;
}

function assertTokenizedModel(content: { components: StudioNode[] }, allowedTypes: string[]): void {
  for (const node of collectNodes(content.components)) {
    expect(allowedTypes, `node type '${node.type}' is one of the authored catalog types`).toContain(
      node.type,
    );
    for (const key of Object.keys(node)) {
      expect(NODE_KEYS.has(key), `node key '${key}' belongs to the typed content model`).toBe(true);
    }
    for (const propKey of Object.keys(node.props ?? {})) {
      expect(propKey).not.toMatch(/^(style|css|class|classname|customcss)$/i);
    }
  }
  const raw = JSON.stringify(content);
  expect(raw).not.toMatch(/style\s*=|!important|<style|font-family\s*:|customCss/i);
}

// ---------------------------------------------------------------------------
// Quote Builder driving helpers (the B4 idiom — canvas + region inspectors)
// ---------------------------------------------------------------------------

function qb(page: Page) {
  return page.frameLocator("#lg-preview-iframe");
}

// The composed document carries EVERY variant slide as
// `<section data-lg-section …>` with all but the visible one `hidden` (the
// engine flips the same attribute at runtime). Unit-level assertions scope
// to the VISIBLE slide — filler/second units share component types, so an
// unscoped locator is a strict-mode violation by construction.
function visibleUnit(page: Page) {
  return qb(page).locator("[data-lg-section]:not([hidden])");
}

async function openQuoteBuilder(page: Page, quotePublicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/quotes/${quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
  await expect(qb(page).locator("[data-frame-region='section_slot']")).toBeVisible({ timeout: 20_000 });
}

async function pickPreviewSite(page: Page): Promise<void> {
  await page.locator("#lg-site-select").selectOption(site.id);
  // §10.2 branding inheritance: the site logo appears in the header/logo region
  await expect(qb(page).locator("img.lg-logo-img").first()).toBeVisible({ timeout: 20_000 });
}

// Template pick through the picker UI: preview-before-apply dialog → Apply.
// Apply stages the server-merged config (C5); the ONE Save below persists it.
async function applyTemplate(page: Page, template: string): Promise<void> {
  await page.locator("#lg-template-btn").click();
  await page.locator(`[data-template-pick="${template}"]`).click();
  await expect(page.locator("#lg-template-confirm")).toBeVisible({ timeout: 20_000 });
  await page.locator("#lg-template-apply").click();
  await expect(
    qb(page).locator(`#lg-funnel-root[data-frame-template="${template}"]`),
  ).toBeAttached({ timeout: 20_000 });
}

// Open a region inspector by clicking its rendered canvas region (04 §4.1 —
// the only opener). `logo` clicks land on the Header inspector.
async function openRegionInspector(
  page: Page,
  clickRegion: string,
  panel: string,
  position?: { x: number; y: number },
): Promise<Locator> {
  const target = qb(page).locator(`[data-frame-region="${clickRegion}"]`).first();
  if (position !== undefined) {
    await target.click({ position });
  } else {
    await target.click();
  }
  const inspector = page.locator(`[data-region-panel="${panel}"]`);
  await expect(inspector).toBeVisible();
  return inspector;
}

// The island commits on 'change' — fill + blur (the B4 tagline idiom).
async function fillAndCommit(input: Locator, value: string): Promise<void> {
  await input.fill(value);
  await input.blur();
}

function listRows(page: Page, key: string) {
  return page.locator(`[data-frame-list="${key}"] .lg-list-row`);
}

async function addListRow(page: Page, key: string): Promise<Locator> {
  const rows = listRows(page, key);
  const before = await rows.count();
  await page.locator(`[data-add-list-row="${key}"]`).click();
  await expect(rows).toHaveCount(before + 1);
  return rows.nth(before);
}

// The REAL shared Media-library dialog (#lg-media-picker) targeting a list
// row's media cell — the trust-strip logo authoring leg.
async function pickMediaIntoRow(page: Page, row: Locator, storageKey: string): Promise<void> {
  await row.locator("[data-media-choose]").click();
  const picker = page.locator("#lg-media-picker");
  await expect(picker).toBeVisible();
  await expect(picker).toHaveAttribute("role", "dialog");
  await picker.locator(`[data-media-pick="${storageKey}"]`).click();
  await expect(picker).toBeHidden();
  await expect(row.locator('input[data-list-field="media_id"]')).toHaveValue(storageKey);
}

// 04 §4.7 ONE Save — the frame PUT must round-trip 200 and the chip refresh.
async function saveFrame(page: Page, funnelPublicId: string): Promise<void> {
  const putResponse = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${funnelPublicId}/frame`),
  );
  await page.locator("#lg-variant-save").click();
  expect((await putResponse).status(), "frame PUT persisted").toBe(200);
  await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 20_000 });
}

// §15.3 evidence screenshots: the composed canvas ELEMENT at desktop 1280,
// then the REAL mobile 375 canvas (the toolbar viewport toggle re-renders
// server-side and resizes the iframe element — DEV-66 semantics). The
// canvas iframe is 1280 CSS px wide inside an overflow:auto wrap, so the
// admin WINDOW is temporarily widened for the desktop capture (clipped
// scrollport pixels are never painted into an element screenshot) and
// restored to the file-wide 1280×900 afterwards.
async function shootComposedPair(page: Page, base: string, mobileMarker: Locator): Promise<void> {
  await page.setViewportSize({ width: 1900, height: 1000 });
  await page.locator("#lg-preview-iframe").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300); // paint settle (listicles-visual idiom)
  await page.locator("#lg-preview-iframe").screenshot({ path: `${SHOT_DIR}/${base}-desktop.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('[data-viewport-btn="mobile"]').click();
  await expect(page.locator('[data-viewport-btn="mobile"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#lg-preview-iframe")).toHaveCSS("width", "375px");
  await expect(mobileMarker).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(300);
  await page.locator("#lg-preview-iframe").screenshot({ path: `${SHOT_DIR}/${base}-mobile.png` });
}

// ---------------------------------------------------------------------------
// 08 §8.7 — the five capability patterns, frame(Quote Builder UI) +
// unit(Section Builder UI) + composed behavioral assertions.
//
// NOT .serial (the DEV-67 rationale): every test seeds its own data
// (workers:1 keeps execution sequential anyway), so a red product-finding
// test never masks the evidence of the tests behind it.
// ---------------------------------------------------------------------------

test.describe("LeadGen v2.5.1 §8.7 patterns A–E — UI-built fixtures (15 §15.3)", () => {
  test("pattern A — reference carrier comparison: centered frame, trust logos via the REAL media picker, manual footer links, button-grid unit", async ({ page }) => {
    test.setTimeout(300_000);

    // (b) UNIT through the real Section Builder: bound headline+sub lead the
    // new unit (§5.2); the §8.7 A "grid gap/columns" CONTROLS are the §8.5
    // "Answer grid" (GridContainer) Layout-tab selects — the answer buttons
    // ride inside it; Continue closes the unit.
    await openNewStudio(page, `E1 A unit ${uniq}`, {
      headline: "Which carrier do you currently use?",
      subheadline: "Compare rates from top carriers in minutes.",
    });
    await addComponent(page, "GridContainer");
    await openInspectorTab(page, "layout");
    const grid = containerGroup(page, "GridContainer");
    await grid.locator('select[data-container-prop="columnsDesktop"]').selectOption("2");
    await grid.locator('select[data-container-prop="gap"]').selectOption("m");
    await addComponent(page, "ButtonAnswerGroup"); // INTO the selected grid
    await openInspectorTab(page, "choices");
    await fillChoiceRow(page, 0, { label: "State Farm", value: "state_farm", analytics_id: "a_state_farm" });
    await fillChoiceRow(page, 1, { label: "Another carrier", value: "other_carrier", analytics_id: "a_other" });
    await setInternalField(page, "current_carrier");
    await addComponent(page, "ContinueButton");
    const saved = await savedUnit(page);

    // (a) FRAME: OFF-target bootstrap (minimal) + the trust-strip visibility
    // minimum (one seeded logo — see the header note on 04 §4.1 reachability);
    // the centered pick below is a REAL C5 switch that PRESERVES it.
    const trustA = await uploadPng(page.request, `e1-trust-a-${uniq}.png`);
    const trustB = await uploadPng(page.request, `e1-trust-b-${uniq}.png`);
    const sc = await seedPatternQuote(page.request, {
      name: `E1 A Quote ${uniq}`,
      activity: ACT,
      vertical: VERT,
      sectionIds: [saved.id, ...fillers],
      frame: {
        version: 1,
        template: "minimal",
        trust_strip: {
          enabled: true,
          source: "manual",
          logos: [{ media_id: trustA.storage_key, alt: "Carrier A" }],
          placement: "below_unit",
        },
      },
    });
    await openQuoteBuilder(page, sc.quotePublicId);
    await pickPreviewSite(page);
    await applyTemplate(page, "centered");

    // trust-strip inspector: add the SECOND logo through the REAL media
    // picker dialog + REQUIRED alt (04 §4.4).
    await openRegionInspector(page, "trust_strip", "trust_strip");
    await expect(listRows(page, "trust_strip.logos")).toHaveCount(1);
    const logoRow = await addListRow(page, "trust_strip.logos");
    await pickMediaIntoRow(page, logoRow, trustB.storage_key);
    await fillAndCommit(logoRow.locator('input[data-list-field="alt"]'), "Carrier B");
    await expect(
      qb(page).locator('[data-frame-region="trust_strip"] img.lg-logo-strip-img'),
    ).toHaveCount(2, { timeout: 20_000 });

    // footer inspector: manual links + trust text through the list editor.
    const footerPanel = await openRegionInspector(page, "footer", "footer");
    await footerPanel.locator('select[data-frame-key="footer.links_source"]').selectOption("manual");
    const link1 = await addListRow(page, "footer.links");
    await fillAndCommit(link1.locator('input[data-list-field="label"]'), "Privacy");
    await fillAndCommit(link1.locator('input[data-list-field="href"]'), "/privacy");
    const link2 = await addListRow(page, "footer.links");
    await fillAndCommit(link2.locator('input[data-list-field="label"]'), "Terms");
    await fillAndCommit(link2.locator('input[data-list-field="href"]'), "/terms");
    await fillAndCommit(footerPanel.locator('input[data-frame-key="footer.trust_text"]'), "Licensed advisor network");
    await expect(
      qb(page).locator('[data-frame-region="footer"] .lg-footerbar-link'),
    ).toHaveCount(2, { timeout: 20_000 });

    await saveFrame(page, sc.funnelPublicId);

    // server truth: the UI-authored frame persisted through the ONE Save
    const { stored } = await fetchFrameState(page.request, sc.funnelPublicId);
    expect(stored["template"]).toBe("centered");
    const trust = stored["trust_strip"] as Record<string, unknown>;
    expect(
      (trust["logos"] as Array<Record<string, unknown>>).map((l) => [l["media_id"], l["alt"]]),
    ).toEqual([
      [trustA.storage_key, "Carrier A"],
      [trustB.storage_key, "Carrier B"],
    ]);
    const footer = stored["footer"] as Record<string, unknown>;
    expect(footer["links_source"]).toBe("manual");
    expect((footer["links"] as Array<Record<string, unknown>>).map((l) => [l["label"], l["href"]])).toEqual([
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
    ]);
    expect(footer["trust_text"]).toBe("Licensed advisor network");

    // (c) COMPOSED §8.7 A required tokens/controls: progress roles · trust
    // strip · footer links · grid gap/columns.
    const f = qb(page);
    const progress = f.locator('[data-frame-region="progress"] .lg-progress[role="progressbar"]');
    await expect(progress).toBeAttached();
    await expect(progress).toHaveAttribute("aria-valuemax", "3"); // REAL 3-step funnel
    await expect(f.locator('[data-frame-region="logo"] img.lg-logo-img')).toBeVisible();
    await expect(f.locator('[data-frame-region="section_slot"]')).toHaveClass(/lg-frame-slot--card/);
    const unit = visibleUnit(page);
    await expect(unit.locator("h1.lg-headline")).toHaveText("Which carrier do you currently use?");
    await expect(unit.locator('[data-component-type="Subheadline"]')).toBeAttached();
    const answerGrid = unit.locator('[data-component-type="GridContainer"]');
    await expect(answerGrid.locator('button[data-lg-choice="state_farm"]')).toHaveText("State Farm");
    await expect(answerGrid.locator('button[data-lg-choice="other_carrier"]')).toHaveText("Another carrier");
    await expect(unit.locator("button.lg-continue")).toBeAttached();
    // the AUTHORED grid columns + gap tokens APPLY on the composed page
    // (chrome CSS: .lg-grid-container{display:grid;
    // grid-template-columns:repeat(var(--lg-gc-cols-d),minmax(0,1fr))})
    const gridStyle = await answerGrid.first().evaluate((el) => {
      const cs = getComputedStyle(el);
      return { display: cs.display, columns: cs.gridTemplateColumns, gap: cs.rowGap };
    });
    expect(gridStyle.display, "the answer grid lays out via CSS grid").toBe("grid");
    expect(
      gridStyle.columns.split(" ").length,
      `authored columnsDesktop=2 applies (got '${gridStyle.columns}')`,
    ).toBe(2);
    expect(parseFloat(gridStyle.gap), `authored gap token applies (got '${gridStyle.gap}')`).toBeGreaterThan(0);
    await expect(f.locator('[data-frame-region="trust_strip"] img.lg-logo-strip-img')).toHaveCount(2);
    await expect(f.locator('[data-frame-region="footer"] .lg-footerbar-link')).toHaveCount(2);
    await expect(f.locator('[data-frame-region="footer"] .lg-footerbar-trust-item')).toHaveCount(1);
    await shootComposedPair(page, "pattern-a", unit.locator("h1.lg-headline"));

    // (e) zero custom CSS: catalog types + typed keys + tokenized props only
    const comps = saved.content_json.components;
    expect(comps.map((c) => c.type)).toEqual([
      "QuestionHeadline",
      "Subheadline",
      "GridContainer",
      "ContinueButton",
    ]);
    expect(comps[0]!.bind, "headline is the §5.2 bound node (one store)").toBe("section_headline");
    expect(comps[0]!.props?.["text"], "bound node never stores duplicate text").toBeUndefined();
    expect(comps[1]!.bind).toBe("section_subheadline");
    // the Layout-tab grid tokens persisted on the container
    expect(comps[2]!.props).toMatchObject({ columnsDesktop: 2, gap: "m" });
    expect((comps[2]!.children ?? []).map((c) => c.type)).toEqual(["ButtonAnswerGroup"]);
    const answerGroup = (comps[2]!.children ?? [])[0]!;
    expect(answerGroup.internal_field).toBe("current_carrier");
    expect((answerGroup.choices ?? []).map((c) => c["value"])).toEqual(["state_farm", "other_carrier"]);
    assertTokenizedModel(saved.content_json, [
      "QuestionHeadline",
      "Subheadline",
      "GridContainer",
      "ButtonAnswerGroup",
      "ContinueButton",
    ]);

    // §15.4 fixture: activate → the live /lg page
    await activateQuoteOnSite(page.request, sc.quotePublicId, site.id, `pa-${uniq}`);
    livePages.A = { host: site.host, slug: `pa-${uniq}` };
  });

  test("pattern B — simple site-branded lead form: header-footer frame, tagline+secure via the header inspector, site-sourced footer, Stack unit", async ({ page }) => {
    test.setTimeout(300_000);

    // (b) UNIT: headline + vertical Stack (§8.5 layout tokens) holding the
    // answer buttons — the §8.7 B "vertical answer buttons (Stack)" column.
    await openNewStudio(page, `E1 B unit ${uniq}`, {
      headline: "Which coverage do you want to compare?",
    });
    // v3.1 §5.2 dropped "Stack" as a directly-insertable tile — insert the
    // answer group FIRST (root, auto-selected), THEN "Group → Stack" wraps
    // it (equivalent end model shape: Stack containing the ButtonAnswerGroup).
    await addComponent(page, "ButtonAnswerGroup");
    await groupSelectionIntoStack(page);
    await openInspectorTab(page, "layout");
    const stack = containerGroup(page, "Stack");
    await stack.locator('select[data-container-prop="direction"]').selectOption("vertical");
    await stack.locator('select[data-container-prop="gap"]').selectOption("s");
    await stack.locator('select[data-container-prop="align"]').selectOption("stretch");
    // re-select the ButtonAnswerGroup CHILD (grouping moved the selection to
    // the new Stack wrapper) before authoring its choices.
    await studioCanvas(page).locator('[data-component-type="ButtonAnswerGroup"]').click();
    await openInspectorTab(page, "choices");
    await fillChoiceRow(page, 0, { label: "Home coverage", value: "home", analytics_id: "b_home" });
    await fillChoiceRow(page, 1, { label: "Auto coverage", value: "auto", analytics_id: "b_auto" });
    await page.locator("#lg-choice-add").click();
    await fillChoiceRow(page, 2, { label: "Life coverage", value: "life", analytics_id: "b_life" });
    await setInternalField(page, "coverage_type");
    const saved = await savedUnit(page);

    // (a) FRAME: centered bootstrap → REAL switch to header-footer, then the
    // header inspector authors tagline + secure-badge text through the UI.
    const sc = await seedPatternQuote(page.request, {
      name: `E1 B Quote ${uniq}`,
      activity: ACT,
      vertical: VERT,
      sectionIds: [saved.id, ...fillers],
      frame: { version: 1, template: "centered" },
    });
    await openQuoteBuilder(page, sc.quotePublicId);
    await pickPreviewSite(page);
    await applyTemplate(page, "header-footer");

    const headerPanel = await openRegionInspector(page, "header", "header");
    await fillAndCommit(headerPanel.locator('input[data-frame-key="header.tagline"]'), "Coverage made simple");
    await fillAndCommit(
      headerPanel.locator('input[data-frame-key="header.secure_badge.text"]'),
      "Your information is secure",
    );
    await expect(qb(page).locator(".lg-frame-tagline")).toHaveText("Coverage made simple", { timeout: 20_000 });

    // footer inspector: pick "From site settings" explicitly (§8.7 B "footer
    // source=site") + author the legal description through the UI.
    const footerPanel = await openRegionInspector(page, "footer", "footer");
    await footerPanel.locator('select[data-frame-key="footer.links_source"]').selectOption("site");
    await fillAndCommit(
      footerPanel.locator('input[data-frame-key="footer.description"]'),
      "© 2026 Acme Insurance. Coverage subject to underwriting.",
    );

    await saveFrame(page, sc.funnelPublicId);

    // stored = the UI-authored fields; effective = template-default-derived
    // availability (see the header note on the sparse stored model)
    const { stored, effective } = await fetchFrameState(page.request, sc.funnelPublicId);
    expect(stored["template"]).toBe("header-footer");
    const storedHeader = stored["header"] as Record<string, unknown>;
    expect(storedHeader["tagline"]).toBe("Coverage made simple");
    expect((storedHeader["secure_badge"] as Record<string, unknown>)["text"]).toBe(
      "Your information is secure",
    );
    expect((stored["footer"] as Record<string, unknown>)["links_source"]).toBe("site");
    const effectiveHeader = effective["header"] as Record<string, unknown>;
    expect(
      (effectiveHeader["secure_badge"] as Record<string, unknown>)["enabled"],
      "secure badge ON (the §4.3 header-footer default)",
    ).toBe(true);
    const effectiveFooter = effective["footer"] as Record<string, unknown>;
    expect(effectiveFooter["links_source"]).toBe("site");
    expect(effectiveFooter["show_logo"], "LARGE site footer carries the logo").toBe(true);

    // (c) COMPOSED §8.7 B: header tagline+secure · site-footer · Stack gap.
    const f = qb(page);
    const header = f.locator('[data-frame-region="header"]');
    await expect(header.locator("img.lg-logo-img")).toBeVisible();
    await expect(header.locator(".lg-frame-tagline")).toHaveText("Coverage made simple");
    await expect(header.locator(".lg-secure-badge")).toContainText("Your information is secure");
    await expect(f.locator('[data-frame-region="progress"] .lg-progress[role="progressbar"]')).toBeAttached();
    const unit = visibleUnit(page);
    await expect(unit.locator("h1.lg-headline")).toHaveText("Which coverage do you want to compare?");
    await expect(
      unit.locator('[data-component-type="Stack"][data-direction="vertical"] .lg-answer-group button[data-lg-choice]'),
    ).toHaveCount(3);
    // back text link — frame-owned, at the template's in-card position
    await expect(
      f.locator('[data-frame-region="section_slot"] [data-frame-region="back"] button.lg-back'),
    ).toBeAttached();
    const footer = f.locator('[data-frame-region="footer"]');
    await expect(footer.locator("img.lg-frame-footer-logo")).toBeAttached();
    await expect(footer.locator(".lg-footerbar-legal")).toContainText("© 2026 Acme Insurance.");
    await shootComposedPair(page, "pattern-b", header);

    // (e) saved unit: Stack props are EXACTLY the picked §8.5 tokens
    const comps = saved.content_json.components;
    expect(comps.map((c) => c.type)).toEqual(["QuestionHeadline", "Subheadline", "Stack"]);
    expect(comps[2]!.props).toEqual({ direction: "vertical", gap: "s", align: "stretch" });
    expect((comps[2]!.children ?? []).map((c) => c.type)).toEqual(["ButtonAnswerGroup"]);
    const group = (comps[2]!.children ?? [])[0]!;
    expect(group.internal_field).toBe("coverage_type");
    expect((group.choices ?? []).map((c) => c["value"])).toEqual(["home", "auto", "life"]);
    assertTokenizedModel(saved.content_json, [
      "QuestionHeadline",
      "Subheadline",
      "Stack",
      "ButtonAnswerGroup",
    ]);

    await activateQuoteOnSite(page.request, sc.quotePublicId, site.id, `pb-${uniq}`);
    livePages.B = { host: site.host, slug: `pb-${uniq}` };
  });

  test("pattern C — header-CTA service funnel: call CTA + disclosure + benefit items via inspectors; ZIP lead-capture unit (mission-3.8 E)", async ({ page }) => {
    test.setTimeout(300_000);

    // (b) UNIT — §8.7 C column AND mission-3.8 Pattern E (ZIP lead capture =
    // C's unit): large headline/sub, ZIP input, Next button. The §8.7 "input
    // icon" cell is the DEV-64(b) REGISTERED gap (renderTextInput has no icon
    // slot) — not asserted; ZIP input + Next are the honest assertions.
    await openNewStudio(page, `E1 C unit ${uniq}`, {
      headline: "How much coverage do you need?",
      subheadline: "Compare rates in your area.",
    });
    await addComponent(page, "ZIPInputQuestion");
    await setContentField(page, "placeholder", "ZIP code");
    await setInternalField(page, "zip");
    await addComponent(page, "ContinueButton");
    await setContentField(page, "label", "Next");
    const saved = await savedUnit(page);

    // (a) FRAME: centered bootstrap + benefit-bar visibility minimum (one
    // seeded item — 04 §4.1 reachability, header note) → REAL switch to
    // header-cta (disclosure top bar is the §4.3 template default).
    const sc = await seedPatternQuote(page.request, {
      name: `E1 C Quote ${uniq}`,
      activity: ACT,
      vertical: VERT,
      sectionIds: [saved.id, ...fillers],
      frame: {
        version: 1,
        template: "centered",
        benefit_bar: {
          enabled: true,
          items: [{ icon: "✓", text: "Free quotes" }],
          placement: "below_unit",
        },
      },
    });
    await openQuoteBuilder(page, sc.quotePublicId);
    await pickPreviewSite(page);
    await applyTemplate(page, "header-cta");

    // header inspector: enable + author the call CTA (label + tel).
    const headerPanel = await openRegionInspector(page, "header", "header");
    await headerPanel.locator('input[data-frame-key="header.cta.enabled"]').check();
    await fillAndCommit(headerPanel.locator('input[data-frame-key="header.cta.label"]'), "Call (800) 555-0199");
    await fillAndCommit(headerPanel.locator('input[data-frame-key="header.cta.tel"]'), "+18005550199");
    await expect(qb(page).locator(".lg-frame-header-cta")).toHaveText("Call (800) 555-0199", { timeout: 20_000 });

    // disclosure inspector (the top-bar region renders by the template
    // default): pick the location explicitly + author label/copy via the UI.
    const disclosurePanel = await openRegionInspector(page, "disclosure", "disclosure");
    await disclosurePanel.locator('select[data-frame-key="disclosure.location"]').selectOption("top_bar");
    await fillAndCommit(
      disclosurePanel.locator('input[data-frame-key="disclosure.link_label"]'),
      "Advertising Disclosure",
    );
    await fillAndCommit(
      disclosurePanel.locator('textarea[data-frame-key="disclosure.text"]'),
      "We may receive compensation from our partners.",
    );

    // benefit-bar inspector: add the SECOND item via the CURATED icon select
    // (DEV-60a closed list) + text.
    await openRegionInspector(page, "benefit_bar", "benefit_bar");
    await expect(listRows(page, "benefit_bar.items")).toHaveCount(1);
    const itemRow = await addListRow(page, "benefit_bar.items");
    await itemRow.locator('select[data-list-field="icon"]').selectOption("⏱");
    await fillAndCommit(itemRow.locator('input[data-list-field="text"]'), "2-minute process");
    await expect(
      qb(page).locator('[data-frame-region="benefit_bar"] .lg-trustbar-item'),
    ).toHaveCount(2, { timeout: 20_000 });

    await saveFrame(page, sc.funnelPublicId);

    const { stored, effective } = await fetchFrameState(page.request, sc.funnelPublicId);
    expect(stored["template"]).toBe("header-cta");
    const storedCta = (stored["header"] as Record<string, unknown>)["cta"] as Record<string, unknown>;
    expect(storedCta["enabled"]).toBe(true);
    expect(storedCta["label"]).toBe("Call (800) 555-0199");
    expect(storedCta["tel"]).toBe("+18005550199");
    const storedDisclosure = stored["disclosure"] as Record<string, unknown>;
    expect(storedDisclosure["location"], "the UI-picked location persisted").toBe("top_bar");
    expect(storedDisclosure["text"]).toBe("We may receive compensation from our partners.");
    // availability is the §4.3 header-cta template default → effective_frame
    const effectiveDisclosure = effective["disclosure"] as Record<string, unknown>;
    expect(effectiveDisclosure["enabled"], "disclosure ON (the header-cta default)").toBe(true);
    expect(effectiveDisclosure["location"]).toBe("top_bar");
    const storedBenefit = stored["benefit_bar"] as Record<string, unknown>;
    expect((storedBenefit["items"] as Array<Record<string, unknown>>).map((i) => [i["icon"], i["text"]])).toEqual([
      ["✓", "Free quotes"],
      ["⏱", "2-minute process"],
    ]);

    // (c) COMPOSED §8.7 C: cta tel · disclosure location · benefit items ·
    // (input icon = DEV-64 skip) — plus the unit behaviorally.
    const f = qb(page);
    const disclosureBar = f.locator('[data-frame-region="disclosure"].lg-frame-disclosure--top_bar');
    await expect(disclosureBar, "disclosure renders at its authored TOP-BAR location").toBeAttached();
    await expect(disclosureBar.locator(".lg-disclosure").first()).toHaveText("Advertising Disclosure");
    await expect(f.locator('[data-frame-region="header"] img.lg-logo-img')).toBeVisible();
    const cta = f.locator(".lg-frame-header-cta");
    await expect(cta).toHaveText("Call (800) 555-0199");
    expect(await cta.getAttribute("href"), "CTA href derives from the authored tel").toContain("8005550199");
    await expect(f.locator('[data-frame-region="progress"] .lg-progress[role="progressbar"]')).toBeAttached();
    const unit = visibleUnit(page);
    await expect(unit.locator("h1.lg-headline")).toHaveText("How much coverage do you need?");
    // mission-3.8 E (ZIP lead capture): the ZIP preset IS the input element
    const zipInput = unit.locator('input[data-component-type="ZIPInputQuestion"]');
    await expect(zipInput).toHaveAttribute("inputmode", "numeric");
    await expect(zipInput).toHaveAttribute("maxlength", "5");
    await expect(unit.locator("button.lg-continue")).toHaveText("Next");
    // NOTE: no icon assertion on the ZIP input — DEV-64(b) registered gap.
    await expect(f.locator('[data-frame-region="benefit_bar"] .lg-trustbar-item')).toHaveCount(2);
    await expect(
      f.locator('[data-frame-region="back"].lg-frame-back--pos-below_card button.lg-back'),
    ).toBeAttached();
    await shootComposedPair(page, "pattern-c", unit.locator("h1.lg-headline"));

    // (d)+(e) saved unit = the mission-3.8 ZIP lead-capture model, tokenized
    const comps = saved.content_json.components;
    expect(comps.map((c) => c.type)).toEqual([
      "QuestionHeadline",
      "Subheadline",
      "ZIPInputQuestion",
      "ContinueButton",
    ]);
    expect(comps[2]!.internal_field).toBe("zip");
    expect(comps[2]!.props).toMatchObject({ placeholder: "ZIP code" });
    expect(comps[3]!.props).toMatchObject({ label: "Next" });
    assertTokenizedModel(saved.content_json, [
      "QuestionHeadline",
      "Subheadline",
      "ZIPInputQuestion",
      "ContinueButton",
    ]);

    // §15.4 fixtures: the C page AND the fifth "ZIP-input frame (C-unit
    // variant)" page — the SAME UI-built ZIP unit activated as its own
    // single-slide header-cta funnel (mission-3.8 E; see the header note).
    await activateQuoteOnSite(page.request, sc.quotePublicId, site.id, `pc-${uniq}`);
    livePages.C = { host: site.host, slug: `pc-${uniq}` };
    const zipVariant = await seedPatternQuote(page.request, {
      name: `E1 C-unit ZIP variant ${uniq}`,
      activity: ACT,
      vertical: VERT,
      sectionIds: [saved.id],
      frame: { version: 1, template: "header-cta" },
    });
    await activateQuoteOnSite(page.request, zipVariant.quotePublicId, site.id, `pcz-${uniq}`);
    livePages.CZ = { host: site.host, slug: `pcz-${uniq}` };
  });

  test("pattern D — full-background branded card: template-supplied brand background, step dots, answer cards with title+subtitle; mission-3.8 F (MultiChoiceCardGroup) as slide 2", async ({ page }) => {
    test.setTimeout(300_000);

    // (b) UNIT 1 — §8.7 D column: question + answer cards with title+subtitle
    // (§5.5 Choices-tab editors; §8.4 choice depth).
    await openNewStudio(page, `E1 D unit ${uniq}`, {
      headline: "Who is the coverage for?",
    });
    await addComponent(page, "IconCardAnswerGrid");
    await openInspectorTab(page, "choices");
    await fillChoiceRow(page, 0, {
      label: "For me",
      value: "self",
      analytics_id: "d_self",
      icon: "🙋",
      title: "For me",
      subtitle: "Coverage for yourself",
    });
    await fillChoiceRow(page, 1, {
      label: "For my family",
      value: "family",
      analytics_id: "d_family",
      icon: "👪",
      title: "For my family",
      subtitle: "Protect the whole household",
    });
    await setInternalField(page, "coverage_for");
    const savedD = await savedUnit(page);

    // (b) UNIT 2 — mission-3.8 Pattern F (§8.7 note: "D with
    // MultiChoiceCardGroup", asserted INSIDE the D fixture): a second Section
    // whose multi-select cards carry title+subtitle through the same editors.
    await openNewStudio(page, `E1 D multi unit ${uniq}`, {
      headline: "Which benefits matter most?",
    });
    await addComponent(page, "MultiChoiceCardGroup");
    await openInspectorTab(page, "choices");
    await fillChoiceRow(page, 0, {
      label: "Low premium",
      value: "low_premium",
      analytics_id: "d_low_premium",
      title: "Low premium",
      subtitle: "Keep monthly costs down",
    });
    await fillChoiceRow(page, 1, {
      label: "Fast payout",
      value: "fast_payout",
      analytics_id: "d_fast_payout",
      title: "Fast payout",
      subtitle: "Claims settled quickly",
    });
    await setInternalField(page, "benefit_prefs");
    const savedF = await savedUnit(page);

    // (a) FRAME: centered bootstrap → REAL switch to full-background. The
    // brand BACKGROUND is what the §4.3/§8.7 D template pick supplies (role
    // brand_primary + style brand defaults) — a valid authoring surface for
    // it. [pre-E4 note: the Background inspector originally could not be
    // opened by canvas click; FIXED at HEAD — bare-canvas clicks resolve to
    // the background region (E4/DEV-74a); Playwright ⑩ grounds the click
    // path. The template-default authoring here remains contract-valid.]
    // The legal footer is authored through the footer inspector.
    const sc = await seedPatternQuote(page.request, {
      name: `E1 D Quote ${uniq}`,
      activity: ACT,
      vertical: VERT,
      sectionIds: [savedD.id, savedF.id, fillers[0]!],
      frame: { version: 1, template: "centered" },
    });
    await openQuoteBuilder(page, sc.quotePublicId);
    await pickPreviewSite(page);
    await applyTemplate(page, "full-background");

    const footerPanel = await openRegionInspector(page, "footer", "footer");
    await fillAndCommit(
      footerPanel.locator('input[data-frame-key="footer.description"]'),
      "Rates depend on underwriting. © 2026 Acme.",
    );

    await saveFrame(page, sc.funnelPublicId);

    const { stored, effective } = await fetchFrameState(page.request, sc.funnelPublicId);
    expect(stored["template"]).toBe("full-background");
    // brand background = the template's defaults (13 §13.2 effective merge)
    const effectiveBackground = effective["background"] as Record<string, unknown>;
    expect(effectiveBackground["style"]).toBe("brand");
    expect(effectiveBackground["role"], "background color is a ROLE, never hex").toBe("brand_primary");
    expect((stored["footer"] as Record<string, unknown>)["description"]).toBe(
      "Rates depend on underwriting. © 2026 Acme.",
    );

    // (c) COMPOSED §8.7 D: background role · dots style · card roles ·
    // choice title/subtitle. The background layer stamps BOTH the role and
    // the style as classes — the render-backed "background role" proof.
    const f = qb(page);
    const background = f.locator('[data-frame-region="background"]');
    await expect(background).toHaveClass(/lg-frame-bg-style-brand/);
    await expect(background).toHaveClass(/lg-frame-bg-role-brand_primary/);
    await expect(f.locator('[data-frame-region="logo"] img.lg-logo-img')).toBeVisible();
    const steps = f.locator('[data-frame-region="progress"] .lg-steps[role="progressbar"]');
    await expect(steps).toBeAttached();
    await expect(steps).toHaveAttribute("aria-valuemax", "3");
    await expect(steps.locator(".lg-step")).toHaveCount(3);
    await expect(steps.locator('.lg-step[data-active="true"]')).toHaveCount(1);
    await expect(f.locator('[data-frame-region="section_slot"]')).toHaveClass(/lg-frame-slot--card/);
    const unit = visibleUnit(page);
    await expect(unit.locator("h1.lg-headline")).toHaveText("Who is the coverage for?");
    const cards = unit.locator(".lg-card-grid button.lg-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute("role", "radio"); // card roles
    await expect(cards.nth(0).locator(".lg-card-title")).toHaveText("For me");
    await expect(cards.nth(0).locator(".lg-card-subtitle")).toHaveText("Coverage for yourself");
    await expect(cards.nth(1).locator(".lg-card-title")).toHaveText("For my family");
    await expect(cards.nth(1).locator(".lg-card-subtitle")).toHaveText("Protect the whole household");
    await expect(f.locator('[data-frame-region="footer"] .lg-footerbar-legal')).toContainText(
      "Rates depend on underwriting.",
    );
    await shootComposedPair(page, "pattern-d", unit.locator("h1.lg-headline"));

    // (d) mission-3.8 F INSIDE the D fixture: step to slide 2 in all-slides
    // mode — the MultiChoiceCardGroup renders inside the SAME frame with its
    // title+subtitle depth, and the frame chrome persists across the step.
    await page.locator('[data-preview-mode-btn="all"]').click();
    await expect(page.locator("#lg-step-label")).toHaveText("Slide 1 of 3", { timeout: 20_000 });
    await page.locator("#lg-step-next").click();
    await expect(page.locator("#lg-step-label")).toHaveText("Slide 2 of 3");
    // the VISIBLE stepped slide carries the multi-select unit
    const steppedUnit = visibleUnit(page);
    await expect(steppedUnit.locator('[data-component-type="MultiChoiceCardGroup"]')).toBeAttached({
      timeout: 20_000,
    });
    await expect(steppedUnit.locator(".lg-card-grid.lg-multi")).toBeAttached();
    const multiCards = steppedUnit.locator(".lg-card-grid.lg-multi button.lg-card");
    await expect(multiCards).toHaveCount(2);
    await expect(multiCards.nth(0)).toHaveAttribute("role", "checkbox");
    await expect(multiCards.nth(0).locator(".lg-card-title")).toHaveText("Low premium");
    await expect(multiCards.nth(0).locator(".lg-card-subtitle")).toHaveText("Keep monthly costs down");
    // frame persistence on the stepped slide: background + dots advanced
    await expect(f.locator('[data-frame-region="background"]')).toHaveClass(/lg-frame-bg-style-brand/);
    const steppedDots = f.locator('[data-frame-region="progress"] .lg-steps[role="progressbar"]');
    await expect(steppedDots).toHaveAttribute("aria-valuenow", "2");
    await page.screenshot({ path: `${SHOT_DIR}/pattern-d-slide2-multichoice.png` });

    // (e) saved models: §8.4 choice depth persisted on BOTH units, tokenized
    const compsD = savedD.content_json.components;
    expect(compsD.map((c) => c.type)).toEqual(["QuestionHeadline", "Subheadline", "IconCardAnswerGrid"]);
    const gridD = compsD[2]!;
    expect(gridD.internal_field).toBe("coverage_for");
    expect((gridD.choices ?? []).map((c) => [c["value"], c["icon"], c["title"], c["subtitle"]])).toEqual([
      ["self", "🙋", "For me", "Coverage for yourself"],
      ["family", "👪", "For my family", "Protect the whole household"],
    ]);
    assertTokenizedModel(savedD.content_json, ["QuestionHeadline", "Subheadline", "IconCardAnswerGrid"]);

    const compsF = savedF.content_json.components;
    expect(compsF.map((c) => c.type)).toEqual(["QuestionHeadline", "Subheadline", "MultiChoiceCardGroup"]);
    const gridF = compsF[2]!;
    expect(gridF.internal_field).toBe("benefit_prefs");
    expect((gridF.choices ?? []).map((c) => [c["value"], c["title"], c["subtitle"]])).toEqual([
      ["low_premium", "Low premium", "Keep monthly costs down"],
      ["fast_payout", "Fast payout", "Claims settled quickly"],
    ]);
    assertTokenizedModel(savedF.content_json, ["QuestionHeadline", "Subheadline", "MultiChoiceCardGroup"]);

    await activateQuoteOnSite(page.request, sc.quotePublicId, site.id, `pd-${uniq}`);
    livePages.D = { host: site.host, slug: `pd-${uniq}` };
  });

  test("pattern E — minimal high-conversion binary: minimal template via the picker; large question + Yes/No pair; no footer", async ({ page }) => {
    test.setTimeout(300_000);

    // (b) UNIT: large question + the Yes/No pair (labels via the Content tab).
    await openNewStudio(page, `E1 E unit ${uniq}`, {
      headline: "Do you own your home?",
    });
    await addComponent(page, "TwoButtonYesNo");
    await setContentField(page, "yesLabel", "Yes, I do");
    await setContentField(page, "noLabel", "Not yet");
    await setInternalField(page, "owns_home");
    const saved = await savedUnit(page);

    // (a) FRAME: centered bootstrap → REAL switch to minimal (clean header,
    // progress, back under the header, bare slot, NO footer).
    const sc = await seedPatternQuote(page.request, {
      name: `E1 E Quote ${uniq}`,
      activity: ACT,
      vertical: VERT,
      sectionIds: [saved.id, ...fillers],
      frame: { version: 1, template: "centered" },
    });
    await openQuoteBuilder(page, sc.quotePublicId);
    await pickPreviewSite(page);
    // the seeded centered footer renders before the switch…
    await expect(qb(page).locator('[data-frame-region="footer"]')).toBeVisible({ timeout: 20_000 });
    await applyTemplate(page, "minimal");
    // …and minimal drops it (C5 preview already showed the WOULD-BE result)
    await expect(qb(page).locator('[data-frame-region="footer"]')).toHaveCount(0, { timeout: 20_000 });

    await saveFrame(page, sc.funnelPublicId);
    const { stored } = await fetchFrameState(page.request, sc.funnelPublicId);
    expect(stored["template"]).toBe("minimal");

    // (c) COMPOSED §8.7 E: minimal template + type roles.
    const f = qb(page);
    await expect(f.locator('#lg-funnel-root[data-frame-template="minimal"]')).toBeAttached();
    await expect(f.locator("#lg-funnel-root")).toHaveClass(/lg-frame--minimal/);
    // clean header (site logo), progress with REAL 3-step values
    await expect(f.locator("img.lg-logo-img").first()).toBeVisible();
    const progress = f.locator('[data-frame-region="progress"] .lg-progress[role="progressbar"]');
    await expect(progress).toBeAttached();
    await expect(progress).toHaveAttribute("aria-valuemax", "3");
    // back at the minimal template's under-header position (mount — the
    // engine hides it on the first slide at runtime, 11 §11.2)
    await expect(f.locator('[data-frame-region="back"].lg-frame-back--pos-under_header_left')).toBeAttached();
    // bare slot (no card chrome) + NO footer anywhere
    await expect(f.locator('[data-frame-region="section_slot"]')).toHaveClass(/lg-frame-slot--bare/);
    await expect(f.locator('[data-frame-region="footer"]')).toHaveCount(0);
    // the unit's TYPE ROLES: the catalog type stamp + the binary pair
    // (scoped to the VISIBLE slide — the fillers are Yes/No units too)
    const unit = visibleUnit(page);
    await expect(unit.locator("h1.lg-headline")).toHaveText("Do you own your home?");
    const yesNo = unit.locator('[data-component-type="TwoButtonYesNo"]');
    await expect(yesNo).toBeAttached();
    await expect(yesNo.locator('button[data-lg-choice="true"]')).toHaveText("Yes, I do");
    await expect(yesNo.locator('button[data-lg-choice="false"]')).toHaveText("Not yet");
    await shootComposedPair(page, "pattern-e", unit.locator("h1.lg-headline"));

    // (e) saved unit: tokenized, labels are token props
    const comps = saved.content_json.components;
    expect(comps.map((c) => c.type)).toEqual(["QuestionHeadline", "Subheadline", "TwoButtonYesNo"]);
    expect(comps[2]!.internal_field).toBe("owns_home");
    expect(comps[2]!.props).toMatchObject({ yesLabel: "Yes, I do", noLabel: "Not yet" });
    assertTokenizedModel(saved.content_json, ["QuestionHeadline", "Subheadline", "TwoButtonYesNo"]);
    // E is deliberately NOT in the §15.4 committed set (15 §15.4 names five
    // pages: A · B · C · D · ZIP-input variant) — its §15.3 desktop+mobile
    // screenshots are the evidence pair shot above.
  });
});

// ---------------------------------------------------------------------------
// 15 §15.4 — visual regression: FIVE composed pages on the REAL /lg runtime,
// desktop 1280 + mobile 375, committed baselines under
// test-ui/__screenshots__/leadgen-v25/ (snapshotPathTemplate), masks over the
// dynamic-id-backed images, thresholds per the leadgen-visual conventions.
// ---------------------------------------------------------------------------

async function gotoLive(
  page: Page,
  entry: { host: string; slug: string },
  size: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`http://${entry.host}:8787/lg/${entry.slug}`, { waitUntil: "load" });
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  // focus normalisation (the leadgen-visual idiom): the engine autofocuses
  // the first input — blur so base-state tokens render, not :focus chrome.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  await page.waitForTimeout(200); // paint settle
  // E6: no horizontal overflow at the capture width.
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    overflow.scrollWidth,
    `E6 no horizontal overflow at ${size.width}px (scrollWidth ${overflow.scrollWidth} ≤ innerWidth ${overflow.innerWidth})`,
  ).toBeLessThanOrEqual(overflow.innerWidth);
}

// §15.4 masks — the dynamic-id-backed images (per-run storage-key srcs; alt
// fallbacks carry per-run site names). Everything else on the page is an
// authored constant.
function visualMasks(page: Page): Locator[] {
  return [
    page.locator("img.lg-logo-img"),
    page.locator("img.lg-frame-footer-logo"),
    page.locator("img.lg-logo-strip-img"),
  ];
}

async function shootBaseline(page: Page, name: string, maxDiffPixelRatio: number): Promise<void> {
  await expect(page).toHaveScreenshot(["leadgen-v25", name], {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    mask: visualMasks(page),
    maxDiffPixelRatio,
  });
}

// One §15.4 page = desktop 1280 + mobile 375 committed baselines.
async function visualPage(page: Page, key: "A" | "B" | "C" | "D" | "CZ", base: string): Promise<void> {
  const entry = requireLive(key);
  await gotoLive(page, entry, { width: 1280, height: 900 });
  await shootBaseline(page, `${base}-desktop.png`, 0.002);
  await gotoLive(page, entry, { width: 375, height: 800 });
  await shootBaseline(page, `${base}-mobile.png`, 0.0025);
}

test.describe("LeadGen v2.5.1 §15.4 visual regression — five composed /lg pages (committed baselines)", () => {
  test("A — reference-style frame with Section card (desktop+mobile)", async ({ page }) => {
    test.setTimeout(120_000);
    await visualPage(page, "A", "pattern-a");
  });

  test("B — simple branded frame (desktop+mobile)", async ({ page }) => {
    test.setTimeout(120_000);
    await visualPage(page, "B", "pattern-b");
  });

  test("C — header-CTA frame (desktop+mobile)", async ({ page }) => {
    test.setTimeout(120_000);
    await visualPage(page, "C", "pattern-c");
  });

  test("D — full-background card frame (desktop+mobile)", async ({ page }) => {
    test.setTimeout(120_000);
    await visualPage(page, "D", "pattern-d");
  });

  test("ZIP-input frame — C-unit variant, mission-3.8 E (desktop+mobile)", async ({ page }) => {
    test.setTimeout(120_000);
    await visualPage(page, "CZ", "pattern-c-zip-variant");
  });
});
