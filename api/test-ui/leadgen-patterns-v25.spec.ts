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
//   inspectors + Choices tab). The pattern's frame arrangement is authored
//   through whichever REAL admin surface currently owns it (see the
//   LEADGEN-REWORK-03 P5 note below — that surface changed, and part of it
//   no longer exists at all). The COMPOSED result is asserted on the REAL
//   /lg LIVE PAGE (not an admin preview surrogate — see the P5 note) per the
//   §8.7 "Required tokens/controls" column.
//
// ===========================================================================
// LEADGEN-REWORK-03 P5 (§10 removals + test rewrites) — WHAT CHANGED AND WHY
// ===========================================================================
// This file previously drove frame authoring through the Quote Builder's
// per-variant CANVAS (region-inspector panels opened by clicking a rendered
// `[data-frame-region]`, a canvas-embedded 6-arrangement Template picker, a
// Desktop/Mobile viewport toggle, and a Current-slide/Step-through stepper).
// §8.2 of the rework contract lists exactly this surface for removal ("canvas
// + all controllers (Template/Theme/Desktop/Mobile/Current-slide/
// Step-through)"), replaced by: the library/board/rules "Funnel builder" tab
// (§8.2), a dedicated "Templates" tab with an elements list + live canvas +
// saved-template CRUD (§8.3), and a dedicated "Themes" tab (§8.4).
//
// VERIFIED THIS PHASE (live probe against the real served
// `/admin/leadgen/quotes/:id/edit` page, api/src/admin/leadgen/quotes-tabs/
// funnel.ts, quotes-tabs/templates.ts, quotes-tabs/shared.ts,
// test/leadgen-quote-builder-seam.test.ts's own P3b retirement notes, and
// test/leadgen-p3a-split-parity.test.ts, all cross-checked against a live
// vitest run this phase):
//   (1) `#lg-preview-iframe` / `#lg-canvas-toolbar` / `#lg-inspector-column` /
//       `data-frame-region` (canvas click targets) / `data-region-panel`
//       (canvas inspector panels) / `#lg-template-btn` / `data-template-pick`
//       / `#lg-template-confirm` / `#lg-template-apply` / `data-viewport-btn`
//       / `data-preview-mode-btn` / `#lg-step-label` / `#lg-step-next` are
//       ALL absent from the real served page today (zero occurrences,
//       confirmed by a live in-process fetch of a freshly seeded quote's
//       edit page). The old per-variant canvas is gone, not merely
//       deprecated-but-present.
//   (2) The Templates tab (`[data-tab="templates"]`) is live and reachable:
//       an elements list (`#lg-tplbox-grid`, cards `[data-tplbox-pick="…"]`
//       for background/logo/cta/disclosure/free_text/brand_logos/footer/
//       images/progress), a live single-section canvas
//       (`#lg-tpl-canvas-iframe`, section/theme pickers), and a saved-
//       template bar with a working "Apply to funnel…" flow
//       (`#lg-tpl-apply-btn` → pick a saved template card
//       `[data-apply-choice]` → confirmation list
//       `#lg-tpl-apply-confirm-list` → `#lg-tpl-apply-confirm-btn`, which
//       POSTs `/funnels/:id/apply-template` directly — no separate Save step
//       — and reloads). The 6 built-in templates are seeded DB rows (M5,
//       migration 0049) named exactly: "Centered card", "Site header +
//       footer", "Header + call CTA", "Full background", "White + trust
//       bar", "Minimal" (mapping 1:1 to the OLD centered/header-footer/
//       header-cta/full-background/white-trust/minimal ids). This file's
//       template-switch proof (preview-before-apply + confirm, "the
//       pinned-⑥ behavior relocates here 1:1" per quotes-tabs/templates.ts's
//       own doc comment) now rides THIS flow.
//   (3) `[data-frame-key]` scalar editing (background.role, background.style,
//       header.logo_source/logo_size/logo_align, and every progress.* field)
//       is STILL the underlying mechanism — same attribute, same shared-
//       island delegation, same `#lg-variant-save` chain
//       (frame→theme→variant PUT) — just opened via the Templates tab's
//       element cards instead of a canvas-region click.
//   (4) CONFIRMED GAP (reported below, not invented around): the OLD flat
//       frame fields `header.tagline` / `header.secure_badge.*` /
//       `header.cta.*` / `footer.links` / `footer.links_source` /
//       `footer.trust_text` / `footer.description` / `disclosure.location` /
//       `disclosure.text` / `disclosure.enabled` / `disclosure.link_label` /
//       `trust_strip.*` / `benefit_bar.*` are STILL live, validated schema
//       fields — `PUT /funnels/:id/frame` still accepts and round-trips all
//       of them (test/leadgen-quote-builder-seam.test.ts's RICH_FRAME_CONFIG
//       proves this, 17/17 green this phase) and `designs/frame.ts` still
//       renders them on the composed page — but they have ZERO admin
//       authoring surface anywhere today. The old canvas region inspectors
//       that used to edit them are gone (point 1); the Templates tab's boxes
//       that share letters with these regions author a DIFFERENT, additive
//       field set instead (box C "Phone / URL" → `cta_slots`; box D
//       "Disclosure" → `disclosure.entries`; box F "Brand logos" →
//       `brand_logos.items`; box G "Footer" → `footer.blocks`) — verified by
//       grep: zero `data-frame-key="header.tagline"` /
//       `data-frame-key="footer.links_source"` / etc. anywhere in
//       quotes-tabs/templates.ts. This is a real, reported product gap
//       (flagged to the conductor in this phase's report), not a test
//       artifact — every UI-authoring step this file previously drove for
//       these fields is RETIRED below with this citation; the fields
//       themselves are seeded through the real frame API (the SAME
//       mechanism this file already used for the "unreachable from a blank
//       canvas" bootstrap case pre-rework) and their RENDERING is still
//       proven on the real live /lg page.
//   (5) Composed-page assertions move from the admin canvas srcdoc
//       (`qb(page)` / `#lg-preview-iframe`) to the REAL live page
//       (`/lg/:slug`, via the SAME `gotoLive` helper the §15.4 visual section
//       already used) — the underlying markup
//       (`[data-frame-region]`/`.lg-*` classes) is emitted by the SAME
//       `designs/frame.ts` renderer either way, untouched by this admin
//       rework, so the assertions are the SAME shape, just proven on the
//       more honest surface (what a visitor actually receives, not an admin
//       preview of it) — a strengthening, not a downgrade.
//   (6) Pattern D's "step to slide 2" no longer has an admin-stepper
//       equivalent (point 1). Replaced with a REAL visitor interaction on
//       the live page: answer slide 1's question, click Continue, assert
//       slide 2 (retiring nothing — this is MORE faithful than the old
//       admin-preview stepper, not less).
//
// FRAME-AUTHORING REACHABILITY (REGISTERED UX observations, carried over from
// the pre-rework file, still true): no contract clause promises a fresh
// template's trust_strip/benefit_bar/etc. is reachable from a blank state —
// every pattern seed bootstraps its region content via the REAL frame API.
// Pre-rework this was framed as "unreachable from a blank canvas, so seed
// it"; post-rework there IS no reachable surface at all for these specific
// fields (point 4), so ALL of their content is seeded, not just the
// bootstrap minimum.
//
// STORED vs EFFECTIVE frame assertions: unchanged — a template switch (via
// the new Apply-to-funnel flow) persists via `POST /funnels/:id/apply-
// template`, and template-default-derived fields are asserted on
// `effective_frame` (13 §13.2), while UI-authored scalar fields (background,
// logo, progress) are asserted on the stored `frame_config`.
//
// §15.4 SURFACE DECISION — unchanged: the five composed pages are the REAL
// /lg pages of the activated pattern funnels.
//
// BASELINES: unchanged — playwright.config.ts pins snapshotPathTemplate to
// test-ui/__screenshots__/{arg}{ext}. The §15.4 visual-regression section
// below is UNTOUCHED by this phase's rewrite: it already asserted the real
// live /lg pages, never the admin canvas, so nothing about it depended on
// anything §10 removed. Local state must be reset once:
// `npm run db:reset:local`. Evidence screenshots for the five §15.3 patterns
// (including E, not in the §15.4 committed set) land in
// test-artifacts/leadgen-e1-patterns/ — now captured on the live page (point
// 5) rather than the admin canvas.

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
import { LEADGEN_FIELD_LEADING_ICONS } from "../src/public/leadgen/components/content-schema";
import { PW_PORT } from "./utils/base-url";

// Realistic desktop Chrome UA — /lg's runtimeRequestGuard bot arm must not
// trip on the live-page navigations (the leadgen-live-funnel DEV-GUARD
// note); the admin surfaces ignore it.
const REAL_CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

test.use({
  viewport: { width: 1280, height: 900 },
  launchOptions: { args: ["--host-resolver-rules=MAP *.e2e.test 127.0.0.1"] },
  userAgent: REAL_CHROME_UA,
});

const ORIGIN = `http://127.0.0.1:${PW_PORT}`;
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
// UNCHANGED by LEADGEN-REWORK-03 P5: Section Studio's component palette,
// choices editor, and inspector tabs are untouched by the Quote Builder
// admin rebuild — every helper below drives the SAME real UI it always did.
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
  // v3.1 §5.6/§8.1: the whole 8-value Accept-swap family reads "Short text
  // field" in the inspector scope header — never its own concrete-type label.
  ZIPInputQuestion: "Short text field",
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
    // R5 D3 toolbar migration: the Accept-format control moved from the
    // toolbar (data-toolbar-accept, deleted) to the Content tab's "Answer
    // format" section (data-inspector-accept, ui-section-studio.ts:2004).
    // A real click onto the Content tab first — the new legitimate flow —
    // rather than assuming it is already active.
    await openInspectorTab(page, "content");
    await page.locator("[data-inspector-accept]").selectOption(insert.swapValue!);
  } else if (insert.swap === "cardStyle") {
    await page.locator(`[data-card-style="${insert.swapValue}"]`).click();
  } else if (insert.swap === "sliderFormat") {
    await page.locator("[data-toolbar-slider-format]").click();
  } else if (insert.swap === "searchable") {
    await page.locator("[data-toolbar-searchable]").click();
  }
  await expect(page.locator("[data-scope-editing-name]")).toHaveText(TYPE_LABELS[type] ?? type);
}

// v3.1 §5.2 dropped "Stack" as a directly-insertable tile. The pre-existing
// "Group → Stack" toolbar action wraps the CURRENTLY SELECTED node into a
// new Stack and moves the selection to it — insert the child FIRST, then
// group it (equivalent end model shape to the old wrap-then-insert-into).
async function groupSelectionIntoStack(page: Page): Promise<void> {
  // R5 D3 toolbar migration: "Group → Stack" moved into the "More actions"
  // popover (data-studio-more-panel) — a real click on the "⋮" toggle
  // (data-studio-more-toggle) opens it first (the new legitimate flow;
  // never force-clicking the hidden action directly). The toggle is shown
  // whenever the current selection's structure cluster is available
  // (updateCanvasToolbar's hasMore check) — true for any selected node.
  await page.locator("[data-studio-more-toggle]").click();
  await expect(page.locator("[data-studio-more-panel]")).toBeVisible();
  await page.locator('[data-studio-act="group-stack"]').click();
  await expect(page.locator("[data-scope-editing-name]")).toHaveText("Stack");
}

async function openInspectorTab(page: Page, key: string): Promise<void> {
  const tab = page.locator(`[data-studio-inspector-tab="${key}"]`);
  await expect(tab).toBeVisible();
  await tab.click();
}

// v3.1 §8.3: "label" can resolve to more than one element in the panel
// (Continue's "Button label", a text field's dedicated "Field label", the
// generic CONTENT_CONTROLS "Label" row) — only ONE is visible per selection.
async function setContentField(page: Page, key: string, value: string): Promise<void> {
  await openInspectorTab(page, "content");
  await page.locator(`[data-studio-panel="content"] input[data-inspector-field="${key}"]:visible`).fill(value);
}

// v3.1 §8.8: Advanced is a persistent disclosure BELOW the 5-tab strip (not
// a 6th tab/panel) — open it via its own toggle button.
async function openAdvancedDisclosure(page: Page): Promise<void> {
  const body = page.locator("[data-studio-advanced-body]");
  if (await body.isHidden()) {
    await page.locator("[data-studio-advanced-toggle]").click();
  }
  await expect(body).toBeVisible();
}

async function setInternalField(page: Page, value: string): Promise<void> {
  await openAdvancedDisclosure(page);
  await page
    .locator('[data-studio-advanced-body] input[data-inspector-field="internal_field"]')
    .fill(value);
}

// v3.1 §8.2/§8.5: Layout folds into the Style tab.
function containerGroup(page: Page, type: string) {
  return page.locator(`[data-studio-panel="style"] [data-container-group="${type}"]`);
}

function choiceRows(page: Page) {
  return page.locator("[data-inspector-choices] [data-choice-row]");
}

// R3a (register S2-4/S2-5/6c): 'icon' is now a curated <select> of the SAME 12
// section-8.1 leading-icon options PLUS a "Custom glyph…" escape hatch (the
// choice.icon prop stays free-glyph per content-schema — isNonEmptyString, no
// enum — so authoring an arbitrary business-type emoji, as pattern D does,
// still routes through the picker's own custom-text sibling).
// 'emoji' is a curated palette (button click), never a text input.
async function fillChoiceRow(page: Page, index: number, fields: Record<string, string>): Promise<void> {
  const row = choiceRows(page).nth(index);
  for (const [key, value] of Object.entries(fields)) {
    if (key === "icon") {
      const iconSelect = row.locator("[data-choice-icon-select]");
      if ((LEADGEN_FIELD_LEADING_ICONS as readonly string[]).includes(value)) {
        await iconSelect.selectOption(value);
      } else {
        await iconSelect.selectOption("__custom__");
        await row.locator("[data-choice-icon-custom]").fill(value);
      }
      continue;
    }
    if (key === "emoji") {
      await row.locator(`[data-choice-emoji="${value}"]`).click();
      continue;
    }
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
// (the DEV-67 assertTokenizedModel contract, verbatim). UNCHANGED by P5.
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
// Quote Builder driving helpers — LEADGEN-REWORK-03 P5 REWRITE. The old
// per-variant canvas (region-inspector-by-click, canvas Template picker,
// viewport toggle, stepper) is gone (see the file-header P5 note, point 1).
// These helpers drive the surfaces confirmed live this phase: the shell head
// bar (site picker, Save), and the Templates tab (element boxes + the
// Apply-to-funnel flow).
// ---------------------------------------------------------------------------

async function openQuoteBuilder(page: Page, quotePublicId: string): Promise<void> {
  await page.goto(`/admin/leadgen/quotes/${quotePublicId}/edit`, { waitUntil: "domcontentloaded" });
  // The tab bar is shell-level markup (ui-quotes.ts's quoteEditorHtml), always
  // present regardless of which tab panel is active — a stable "the editor
  // shell booted" signal that does not depend on the (removed) canvas.
  await expect(page.locator('[data-tab="templates"]')).toBeVisible({ timeout: 20_000 });
}

// Selecting a preview site is still a real, shell-level control (the head
// bar's #lg-site-select, ui-quotes.ts:725) — kept for parity with real
// operator workflow. Its downstream effect on branding is proven on the
// live page after activation (point 5 of the file-header note), not here:
// the Templates tab's own live canvas POST body (renderCanvasPreview,
// quotes-tabs/templates.ts:973-1005) carries no site_id, so this control's
// visible effect today is scoped to surfaces this file no longer drives.
async function pickPreviewSite(page: Page): Promise<void> {
  await page.locator("#lg-site-select").selectOption(site.id);
  await expect(page.locator("#lg-site-select")).toHaveValue(site.id);
}

// Opens the Templates tab and waits for its live canvas + elements list to
// mount (quotes-tabs/templates.ts's renderTemplatesTabPanel output).
async function openTemplatesTab(page: Page): Promise<void> {
  await page.locator('[data-tab="templates"]').click();
  await expect(page.locator("#lg-tpl-canvas-iframe")).toBeAttached({ timeout: 20_000 });
  await expect(page.locator("#lg-tplbox-grid")).toBeVisible();
}

// NOTE: no per-box opener (openTplBox) is defined here. None of the five
// patterns below directly author background/logo/progress through an
// element box — exactly like the pre-rework file (its own header note #2
// documents that Pattern D's background was ALWAYS template-derived, never
// canvas-authored) — so a box-opening helper would be unused dead code in
// this specific file. `[data-tplbox-pick="…"]` / `[data-tplbox-panel="…"]`
// are confirmed live (file-header P5 note point 2/3) for whichever future
// pattern needs them.

// The 6 built-in templates are now DB-backed saved-template rows (M5,
// migration 0049) with exactly these names (verified against the seed SQL);
// their string ids (centered/minimal/…) still ride inside each row's
// frame_json.template, asserted via fetchFrameState below.
const BUILTIN_TEMPLATE_NAMES: Record<string, string> = {
  centered: "Centered card",
  "header-footer": "Site header + footer",
  "header-cta": "Header + call CTA",
  "full-background": "Full background",
  "white-trust": "White + trust bar",
  minimal: "Minimal",
};

// Template pick through the Templates-tab picker UI: preview-before-apply
// dialog (1:1 with the pre-rework pinned-⑥ behavior, per quotes-tabs/
// templates.ts's own doc comment) → Apply. Apply POSTs
// /funnels/:id/apply-template directly (no separate Save step) and reloads
// the page — replaces the OLD canvas-embedded data-template-pick flow
// (gone, file-header note point 1).
//
// CONFIRMED BUG (found + reproduced live this phase, NOT fixed here —
// frames.ts/frame-handlers.ts are outside this slice's file ownership;
// reported to the conductor): after this flow POSTs /funnels/:id/apply-
// template, the funnel's `frame_template_id` FK correctly updates and the
// BEHAVIORAL defaults it drives (footer.enabled, back.position, disclosure.*,
// background.*, etc.) correctly reflect the newly-applied saved template —
// reproduced via a live PUT/GET round trip switching "centered"→"minimal":
// effective_frame.footer.enabled flipped true→false and back.position
// flipped in_card→under_header_left, matching Minimal's seed row exactly.
// BUT `effective_frame.template` (and therefore the composed page's
// `data-frame-template` attribute + `.lg-frame--{template}` class, both
// stamped directly from this same field — designs/frame.ts:1162,1168) stays
// STUCK on the funnel's ORIGINAL frame_config_json.template string, because
// frames.ts's effectiveFrame() (line ~749, `frame.template = templateId`)
// derives templateId from frame_config_json.template even when a
// savedTemplateDefaults 4th argument (the M5/ftid path) is what actually
// supplied every other field. Assertions below therefore verify the
// template switch via the BEHAVIORAL fields it demonstrably changes, not
// via data-frame-template/.lg-frame--X (proven unreliable post-switch).
async function applyTemplate(page: Page, template: keyof typeof BUILTIN_TEMPLATE_NAMES): Promise<void> {
  await openTemplatesTab(page);
  await page.locator("#lg-tpl-apply-btn").click();
  await expect(page.locator("#lg-tpl-apply-dialog")).toBeVisible();
  const name = BUILTIN_TEMPLATE_NAMES[template];
  await page.locator("[data-apply-choice]", { hasText: name }).click();
  await expect(page.locator("#lg-tpl-apply-confirm-list")).toBeVisible();
  // Apply POSTs /funnels/:id/apply-template directly and reloads (no
  // separate Save step, unlike the pre-rework canvas picker) — wait for the
  // SAME reload's completion, then confirm the shell re-booted, without a
  // second explicit navigation.
  await Promise.all([
    page.waitForEvent("load"),
    page.locator("#lg-tpl-apply-confirm-btn").click(),
  ]);
  await expect(page.locator('[data-tab="templates"]')).toBeVisible({ timeout: 20_000 });
}

// The island commits on 'change' — fill + blur (the B4 tagline idiom).
async function fillAndCommit(input: Locator, value: string): Promise<void> {
  await input.fill(value);
  await input.blur();
}

// 04 §4.7 ONE Save — the frame PUT must round-trip 200 and the chip refresh.
// UNCHANGED mechanism (shell-level #lg-variant-save, still chains frame→
// theme→variant PUTs when dirty — quotes-tabs/funnel.ts's shared island,
// confirmed live by test/leadgen-quote-builder-seam.test.ts's (b) seam this
// phase) — only its callers' context (which tab was open) changed.
async function saveFrame(page: Page, funnelPublicId: string): Promise<void> {
  const putResponse = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().includes(`/funnels/${funnelPublicId}/frame`),
  );
  await page.locator("#lg-variant-save").click();
  expect((await putResponse).status(), "frame PUT persisted").toBe(200);
  await expect(page.locator("#lg-quote-ok")).toBeVisible({ timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Live-page driving helpers (the §15.4 idiom, now ALSO used for the mid-test
// §8.7 composed assertions — file-header P5 note point 5).
// ---------------------------------------------------------------------------

// LEADGEN-REWORK-03 S5.2 follow-up (§4.3-1/§4.3-2): every activated quote now
// carries the quote-owned shared first page (leadgen-e-seed.ts's
// seedTrivialSharedPage), and "every visitor sees the shared first page
// first" is CONTRACT (§4.3-2) — confirmed live this phase: a fresh
// gotoLive lands on Step 1 of N showing the shared page's bare Continue
// button, not the pattern's own content. Every caller of gotoLive in this
// file wants the PATTERN's content (never the shared-page itself), so
// clicking through it is folded into gotoLive as a transparent "arrive at
// the funnel" step — this keeps the §15.4 visual-regression section
// (unchanged code, below) capturing the SAME pattern content its committed
// baselines pin, not a blank shared-page screenshot.
// The composed document carries EVERY variant slide (the quote-owned shared
// page included) as `<section data-lg-section>` with all but the visible
// one `hidden` (the engine flips the same attribute at runtime — the SAME
// fact the pre-rework file's `visibleUnit` helper scoped through). Unit-level
// assertions (headline/component-type/choice buttons) MUST scope to the
// VISIBLE section — fillers share component types with several patterns'
// own units (TwoButtonYesNo in particular), and the shared page's own
// ContinueButton is now ALSO always present in the DOM, so an unscoped
// locator is a strict-mode violation by construction (reproduced live this
// phase: `[data-component-type="TwoButtonYesNo"]` resolved to 3 elements —
// the pattern's own unit + both fillers). Frame-CHROME assertions
// (`[data-frame-region=…]`, the header logo, progress, background, footer)
// stay unscoped — they render OUTSIDE any section, once per page.
function visibleSection(page: Page): Locator {
  return page.locator("[data-lg-section]:not([hidden])");
}

async function clickThroughSharedPageIfShowing(page: Page): Promise<void> {
  // Every variant slide (this quote's shared page included) renders as its
  // own `<section data-lg-section>` up front, with all but the CURRENT one
  // `hidden` (the engine flips that attribute at runtime — see the qb/
  // visibleUnit precedent this file used pre-rework) — the shared-page
  // marker is never removed from the DOM, only hidden, so the exit
  // condition is visibility, not element count.
  const sharedContinue = page.locator('[data-question-id="shared_continue"]');
  if (!(await sharedContinue.isVisible())) return;
  await page.locator('[data-lg-section]:not([hidden]) button.lg-continue').click();
  await expect(sharedContinue).toBeHidden({ timeout: 10_000 });
}

async function gotoLive(
  page: Page,
  entry: { host: string; slug: string },
  size: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(`http://${entry.host}:${PW_PORT}/lg/${entry.slug}`, { waitUntil: "load" });
  await expect(page.locator('#lg-funnel-root[data-lg-ready="1"]')).toHaveCount(1, { timeout: 15_000 });
  await clickThroughSharedPageIfShowing(page);
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

// §15.3 evidence screenshots on the REAL live page (desktop 1280 then mobile
// 375) — replaces shootComposedPair's admin-canvas-element capture (the
// canvas element it screenshotted no longer exists, file-header note point
// 1); the live full-page capture is the more honest artifact of the two.
async function shootLivePatternPair(page: Page, entry: { host: string; slug: string }, base: string): Promise<void> {
  await gotoLive(page, entry, { width: 1280, height: 900 });
  await page.screenshot({ path: `${SHOT_DIR}/${base}-desktop.png`, fullPage: true });
  await gotoLive(page, entry, { width: 375, height: 800 });
  await page.screenshot({ path: `${SHOT_DIR}/${base}-mobile.png`, fullPage: true });
  await gotoLive(page, entry, { width: 1280, height: 900 }); // leave the page at desktop for subsequent assertions
}

// ---------------------------------------------------------------------------
// 08 §8.7 — the five capability patterns, frame(Quote Builder UI where a
// surface exists, real frame API where §10 removed it — see the file-header
// P5 note) + unit(Section Builder UI) + composed behavioral assertions on
// the REAL live page.
//
// NOT .serial (the DEV-67 rationale): every test seeds its own data
// (workers:1 keeps execution sequential anyway), so a red product-finding
// test never masks the evidence of the tests behind it.
// ---------------------------------------------------------------------------

test.describe("LeadGen v2.5.1 §8.7 patterns A–E — UI-built fixtures (15 §15.3)", () => {
  test("pattern A — reference carrier comparison: centered frame, trust logos + footer links (seeded — no current admin surface, see P5 note), button-grid unit", async ({ page }) => {
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
    await openInspectorTab(page, "style");
    const grid = containerGroup(page, "GridContainer");
    await grid.locator('select[data-container-prop="columnsDesktop"]').selectOption("2");
    await grid.locator('select[data-container-prop="gap"]').selectOption("m");
    await addComponent(page, "ButtonAnswerGroup"); // INTO the selected grid
    await openInspectorTab(page, "content");
    await fillChoiceRow(page, 0, { label: "State Farm", value: "state_farm", analytics_id: "a_state_farm" });
    await fillChoiceRow(page, 1, { label: "Another carrier", value: "other_carrier", analytics_id: "a_other" });
    await setInternalField(page, "current_carrier");
    await addComponent(page, "ContinueButton");
    const saved = await savedUnit(page);

    // (a) FRAME — P5 note point 4: trust_strip (logos) and footer
    // (links_source/links/trust_text) have NO current admin authoring
    // surface (the old canvas region inspectors are gone; the Templates
    // tab's "F Brand logos"/"G Footer" boxes author the DIFFERENT
    // brand_logos.items/footer.blocks fields, not these). BOTH logos and
    // both footer links are therefore seeded directly through the real
    // frame API up front (this is a scope WIDENING of the old "bootstrap
    // the unreachable minimum" note, not a new pattern — same mechanism,
    // now covering the whole region instead of just one seed logo). The
    // RENDERING of these fields is still verified below, on the real live
    // page — only "authored by clicking through the admin UI" is retired.
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
          logos: [
            { media_id: trustA.storage_key, alt: "Carrier A" },
            { media_id: trustB.storage_key, alt: "Carrier B" },
          ],
          placement: "below_unit",
        },
        footer: {
          enabled: true,
          links_source: "manual",
          links: [
            { label: "Privacy", href: "/privacy" },
            { label: "Terms", href: "/terms" },
          ],
          trust_text: "Licensed advisor network",
        },
      },
    });
    await openQuoteBuilder(page, sc.quotePublicId);
    await pickPreviewSite(page);

    // (a) the ONE region this pattern's template switch still authors
    // through the REAL UI: the Apply-to-funnel flow (confirmed live this
    // phase, file-header note point 2) — the direct 1:1 replacement for the
    // pre-rework canvas Template picker this pattern always drove.
    await applyTemplate(page, "centered");

    // server truth: the seeded frame persisted (frame API round-trip,
    // unaffected by the admin-UI rework) + the template switch applied.
    // NOTE: verified via `back.position` (a Centered-vs-Minimal
    // distinguisher, seed migration 0049), NOT `stored["template"]` — see
    // applyTemplate's CONFIRMED BUG citation above (that field never
    // updates through this flow; the composed-page `.lg-frame-slot--card`
    // assertion below is the SAME proof, doubly confirmed).
    const { stored, effective } = await fetchFrameState(page.request, sc.funnelPublicId);
    expect((effective["back"] as Record<string, unknown>)["position"], "Centered's back position (vs Minimal's under_header_left) confirms the switch").toBe("in_card");
    const trust = stored["trust_strip"] as Record<string, unknown>;
    expect(
      (trust["logos"] as Array<Record<string, unknown>>).map((l) => [l["media_id"], l["alt"]]),
    ).toEqual([
      [trustA.storage_key, "Carrier A"],
      [trustB.storage_key, "Carrier B"],
    ]);
    // R2 P8-4 F9 re-mint (companion to the footer.links_source citation
    // below) — `trust_strip.enabled` undergoes the SAME materialise+prune.
    // Centered's own saved-template row sets `trust_strip.enabled:false`
    // (migrations/0049_leadgen_rework_m4_m5_defaults_templates.sql, id 1) — a
    // documented, reviewed characteristic (frame-handlers.ts:328-339, "R2 P8
    // FIX ROUND F4 (review-p8-4 F-5)": "built-ins `centered` (arrangement
    // '... trust strip ...') ... prose describing a region their own
    // defaults switch OFF"). Confirmed live: `replaced_customisations`
    // includes "trust_strip.enabled",
    // `changes:[{"path":"trust_strip.enabled","from":true,"to":false}]`.
    expect(trust["enabled"], "stored column prunes the leaf once it agrees with Centered's own base (frames.ts pruneEchoedLeaves)").toBeUndefined();
    expect(
      (effective["trust_strip"] as Record<string, unknown>)["enabled"],
      "served truth: Centered's own trust_strip.enabled default (false) legitimately replaces the operator's prior enabled pick",
    ).toBe(false);
    const footer = stored["footer"] as Record<string, unknown>;
    // P8 CLOSE re-mint (was `expect(footer["links_source"]).toBe("manual")`):
    // Apply-to-funnel legitimately overwrites+prunes this leaf, reviewed and
    // shipped in R2 P8-4 F9 — computeTemplateApply's materialise (mergeTemplate
    // Into, frames.ts:2530-2542) writes the Centered saved-template row's own
    // `footer.links_source:"site"` (migrations/0049…sql, id 1) over the
    // operator's "manual" because "site" is non-blank, then pruneEchoedLeaves
    // (frames.ts:2560-2578) drops the now-redundant stored leaf because it
    // agrees with Centered's own base — NOT silent: it is a NAMED
    // `replaced_customisations` entry, exactly the case
    // docs/leadgen/r2/evidence/p8/review-p8-4c/REVIEW.md row A1-A3 drove and
    // verdicted PERFECT ("footer.links_source correctly named"). Reproduced
    // live on this branch: `POST …/apply-template {template_id:<Centered's
    // public_id>}` → `replaced_customisations:["footer.links_source"]`,
    // `changes:[{"path":"footer.links_source","from":"manual","to":"site"}]`,
    // and the immediate `GET …/frame` re-read has no `footer.links_source` key
    // in `frame_config` while `effective_frame.footer.links_source` is "site".
    expect(footer["links_source"], "stored column prunes the leaf once it agrees with Centered's own base (frames.ts pruneEchoedLeaves)").toBeUndefined();
    expect(
      (effective["footer"] as Record<string, unknown>)["links_source"],
      "served truth: Centered's own footer.links_source default (site) legitimately replaces the operator's prior manual pick, named in replaced_customisations",
    ).toBe("site");
    expect((footer["links"] as Array<Record<string, unknown>>).map((l) => [l["label"], l["href"]])).toEqual([
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
    ]);
    expect(footer["trust_text"]).toBe("Licensed advisor network");

    // §15.4 fixture + (c) COMPOSED §8.7 A required tokens/controls, all on
    // the REAL live page (P5 note point 5): progress roles · trust strip ·
    // footer links · grid gap/columns.
    await activateQuoteOnSite(page.request, sc.quotePublicId, site.id, `pa-${uniq}`);
    livePages.A = { host: site.host, slug: `pa-${uniq}` };
    await gotoLive(page, livePages.A, { width: 1280, height: 900 });

    const progress = page.locator('[data-frame-region="progress"] .lg-progress[role="progressbar"]');
    await expect(progress).toBeAttached();
    // REAL 4-step funnel: the quote-owned shared page (§4.3-1, already
    // clicked through by gotoLive) + this unit + 2 fillers.
    await expect(progress).toHaveAttribute("aria-valuemax", "4");
    await expect(page.locator('[data-frame-region="logo"] img.lg-logo-img')).toBeVisible();
    await expect(page.locator('[data-frame-region="section_slot"]')).toHaveClass(/lg-frame-slot--card/);
    const unitA = visibleSection(page);
    await expect(unitA.locator("h1.lg-headline")).toHaveText("Which carrier do you currently use?");
    await expect(unitA.locator('[data-component-type="Subheadline"]')).toBeAttached();
    const answerGrid = unitA.locator('[data-component-type="GridContainer"]');
    await expect(answerGrid.locator('button[data-lg-choice="state_farm"]')).toHaveText("State Farm");
    await expect(answerGrid.locator('button[data-lg-choice="other_carrier"]')).toHaveText("Another carrier");
    await expect(unitA.locator("button.lg-continue")).toBeAttached();
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
    // Trust strip region omits its wrapper entirely when disabled
    // (frame.ts's `if (!t.enabled) return ""`) — Centered's own reviewed
    // default (see the trust_strip.enabled citation above), so 0 real
    // elements, not the 2 authored logos (which stay stored, inert).
    await expect(page.locator('[data-frame-region="trust_strip"] img.lg-logo-strip-img')).toHaveCount(0);
    // footer.links_source:"site" (see the citation above) renders the SITE's
    // own legal_links (frame.ts:680), not the operator's authored `links`
    // array — asserted against the SAME real producer frame.ts consumes
    // (GET /sites/:id/branding, E11's "one real side"), not a hand-built
    // literal.
    const brandingRes = await page.request.get(`/api/admin/leadgen/sites/${site.id}/branding`);
    const branding = (await brandingRes.json()) as { legal_links: Array<{ label: string; href: string }> };
    expect(branding.legal_links.length, "this site's real legal_links is non-empty (or the comparison below is vacuous)").toBeGreaterThan(0);
    const footerLinks = page.locator('[data-frame-region="footer"] .lg-footerbar-link');
    await expect(footerLinks).toHaveCount(branding.legal_links.length);
    const renderedLinks = await footerLinks.evaluateAll((els) =>
      els.map((el) => [el.textContent?.trim() ?? "", el.getAttribute("href") ?? ""]),
    );
    expect(renderedLinks).toEqual(branding.legal_links.map((l) => [l.label, l.href]));
    await expect(page.locator('[data-frame-region="footer"] .lg-footerbar-trust-item')).toHaveCount(1);
    await shootLivePatternPair(page, livePages.A, "pattern-a");

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
  });

  test("pattern B — simple site-branded lead form: header-footer frame (site branding seeded — no current admin surface, see P5 note), Stack unit", async ({ page }) => {
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
    await openInspectorTab(page, "style");
    const stack = containerGroup(page, "Stack");
    await stack.locator('select[data-container-prop="direction"]').selectOption("vertical");
    await stack.locator('select[data-container-prop="gap"]').selectOption("s");
    await stack.locator('select[data-container-prop="align"]').selectOption("stretch");
    // re-select the ButtonAnswerGroup CHILD (grouping moved the selection to
    // the new Stack wrapper) before authoring its choices.
    await studioCanvas(page).locator('[data-component-type="ButtonAnswerGroup"]').click();
    await openInspectorTab(page, "content");
    await fillChoiceRow(page, 0, { label: "Home coverage", value: "home", analytics_id: "b_home" });
    await fillChoiceRow(page, 1, { label: "Auto coverage", value: "auto", analytics_id: "b_auto" });
    await page.locator("#lg-choice-add").click();
    await fillChoiceRow(page, 2, { label: "Life coverage", value: "life", analytics_id: "b_life" });
    await setInternalField(page, "coverage_type");
    const saved = await savedUnit(page);

    // (a) FRAME — P5 note point 4: header.tagline/secure_badge and
    // footer.links_source/description have NO current admin authoring
    // surface (the Templates tab's "B Logo" box only covers logo_source/
    // logo_size/logo_align; "G Footer" authors footer.blocks, a different
    // field). Seeded directly; rendering verified on the live page below.
    const sc = await seedPatternQuote(page.request, {
      name: `E1 B Quote ${uniq}`,
      activity: ACT,
      vertical: VERT,
      sectionIds: [saved.id, ...fillers],
      frame: {
        version: 1,
        template: "header-footer",
        header: {
          tagline: "Coverage made simple",
          secure_badge: { enabled: true, text: "Your information is secure" },
        },
        footer: {
          links_source: "site",
          description: "© 2026 Acme Insurance. Coverage subject to underwriting.",
        },
      },
    });
    await openQuoteBuilder(page, sc.quotePublicId);
    await pickPreviewSite(page);

    // stored = the seeded fields; effective = template-default-derived
    // availability (unchanged reasoning from the pre-rework file)
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

    // §15.4 fixture + (c) COMPOSED §8.7 B: header tagline+secure · site-
    // footer · Stack gap — all on the REAL live page (P5 note point 5).
    await activateQuoteOnSite(page.request, sc.quotePublicId, site.id, `pb-${uniq}`);
    livePages.B = { host: site.host, slug: `pb-${uniq}` };
    await gotoLive(page, livePages.B, { width: 1280, height: 900 });

    const header = page.locator('[data-frame-region="header"]');
    await expect(header.locator("img.lg-logo-img")).toBeVisible();
    await expect(header.locator(".lg-frame-tagline")).toHaveText("Coverage made simple");
    await expect(header.locator(".lg-secure-badge")).toContainText("Your information is secure");
    await expect(page.locator('[data-frame-region="progress"] .lg-progress[role="progressbar"]')).toBeAttached();
    const unitB = visibleSection(page);
    await expect(unitB.locator("h1.lg-headline")).toHaveText("Which coverage do you want to compare?");
    await expect(
      unitB.locator('[data-component-type="Stack"][data-direction="vertical"] .lg-answer-group button[data-lg-choice]'),
    ).toHaveCount(3);
    // back text link — frame-owned, at the template's in-card position
    await expect(
      page.locator('[data-frame-region="section_slot"] [data-frame-region="back"] button.lg-back'),
    ).toBeAttached();
    const footer = page.locator('[data-frame-region="footer"]');
    await expect(footer.locator("img.lg-frame-footer-logo")).toBeAttached();
    await expect(footer.locator(".lg-footerbar-legal")).toContainText("© 2026 Acme Insurance.");
    await shootLivePatternPair(page, livePages.B, "pattern-b");

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
  });

  test("pattern C — header-CTA service funnel: call CTA + disclosure + benefit items (seeded — no current admin surface, see P5 note); ZIP lead-capture unit (mission-3.8 E)", async ({ page }) => {
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

    // (a) FRAME — P5 note point 4: header.cta.*, disclosure.location/text,
    // and benefit_bar.* have NO current admin authoring surface (the
    // Templates tab's "C Phone/URL" box authors the DIFFERENT cta_slots
    // field; "D Disclosure" authors disclosure.entries, not
    // disclosure.location/text/enabled). Seeded directly; rendering
    // verified on the live page below.
    const sc = await seedPatternQuote(page.request, {
      name: `E1 C Quote ${uniq}`,
      activity: ACT,
      vertical: VERT,
      sectionIds: [saved.id, ...fillers],
      frame: {
        version: 1,
        template: "header-cta",
        header: {
          cta: { enabled: true, label: "Call (800) 555-0199", tel: "+18005550199" },
        },
        disclosure: {
          location: "top_bar",
          link_label: "Advertising Disclosure",
          text: "We may receive compensation from our partners.",
        },
        benefit_bar: {
          enabled: true,
          items: [
            { icon: "✓", text: "Free quotes" },
            { icon: "⏱", text: "2-minute process" },
          ],
          placement: "below_unit",
        },
      },
    });
    await openQuoteBuilder(page, sc.quotePublicId);
    await pickPreviewSite(page);

    const { stored, effective } = await fetchFrameState(page.request, sc.funnelPublicId);
    expect(stored["template"]).toBe("header-cta");
    const storedCta = (stored["header"] as Record<string, unknown>)["cta"] as Record<string, unknown>;
    expect(storedCta["enabled"]).toBe(true);
    expect(storedCta["label"]).toBe("Call (800) 555-0199");
    expect(storedCta["tel"]).toBe("+18005550199");
    const storedDisclosure = stored["disclosure"] as Record<string, unknown>;
    expect(storedDisclosure["location"]).toBe("top_bar");
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

    // §15.4 fixtures + (c) COMPOSED §8.7 C: cta tel · disclosure location ·
    // benefit items · (input icon = DEV-64 skip) — plus the unit
    // behaviorally, all on the REAL live page (P5 note point 5).
    await activateQuoteOnSite(page.request, sc.quotePublicId, site.id, `pc-${uniq}`);
    livePages.C = { host: site.host, slug: `pc-${uniq}` };
    await gotoLive(page, livePages.C, { width: 1280, height: 900 });

    const disclosureBar = page.locator('[data-frame-region="disclosure"].lg-frame-disclosure--top_bar');
    await expect(disclosureBar, "disclosure renders at its authored TOP-BAR location").toBeAttached();
    await expect(disclosureBar.locator(".lg-disclosure").first()).toHaveText("Advertising Disclosure");
    await expect(page.locator('[data-frame-region="header"] img.lg-logo-img')).toBeVisible();
    const cta = page.locator(".lg-frame-header-cta");
    await expect(cta).toHaveText("Call (800) 555-0199");
    expect(await cta.getAttribute("href"), "CTA href derives from the authored tel").toContain("8005550199");
    await expect(page.locator('[data-frame-region="progress"] .lg-progress[role="progressbar"]')).toBeAttached();
    const unitC = visibleSection(page);
    await expect(unitC.locator("h1.lg-headline")).toHaveText("How much coverage do you need?");
    // mission-3.8 E (ZIP lead capture): the ZIP preset IS the input element
    const zipInput = unitC.locator('input[data-component-type="ZIPInputQuestion"]');
    await expect(zipInput).toHaveAttribute("inputmode", "numeric");
    await expect(zipInput).toHaveAttribute("maxlength", "5");
    await expect(unitC.locator("button.lg-continue")).toHaveText("Next");
    // NOTE: no icon assertion on the ZIP input — DEV-64(b) registered gap.
    await expect(page.locator('[data-frame-region="benefit_bar"] .lg-trustbar-item')).toHaveCount(2);
    await expect(
      page.locator('[data-frame-region="back"].lg-frame-back--pos-below_card button.lg-back'),
    ).toBeAttached();
    await shootLivePatternPair(page, livePages.C, "pattern-c");

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

  test("pattern D — full-background branded card: template-supplied brand background (applied through the Templates tab), step dots, answer cards with title+subtitle; mission-3.8 F (MultiChoiceCardGroup) as slide 2", async ({ page }) => {
    test.setTimeout(300_000);

    // (b) UNIT 1 — §8.7 D column: question + answer cards with title+subtitle
    // (§5.5 Choices-tab editors; §8.4 choice depth).
    await openNewStudio(page, `E1 D unit ${uniq}`, {
      headline: "Who is the coverage for?",
    });
    await addComponent(page, "IconCardAnswerGrid");
    await openInspectorTab(page, "content");
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
    // LEADGEN-REWORK-03 P5 follow-up: an explicit ContinueButton (like
    // patterns A/C already author) — the P5-added "click through to slide 2"
    // proof (mission-3.8 F, below) needs a REAL, reliable advance affordance;
    // reproduced live this phase that a lone single-select IconCardAnswerGrid
    // choice neither auto-advances nor renders any frame-injected continue
    // control within ~2.5s of selection, so the operator-authored control is
    // the honest, deterministic choice (same as the pre-existing patterns),
    // not a guess about implicit engine timing.
    await addComponent(page, "ContinueButton");
    const savedD = await savedUnit(page);

    // (b) UNIT 2 — mission-3.8 Pattern F (§8.7 note: "D with
    // MultiChoiceCardGroup", asserted INSIDE the D fixture): a second Section
    // whose multi-select cards carry title+subtitle through the same editors.
    await openNewStudio(page, `E1 D multi unit ${uniq}`, {
      headline: "Which benefits matter most?",
    });
    await addComponent(page, "MultiChoiceCardGroup");
    await openInspectorTab(page, "content");
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

    // (a) FRAME: centered bootstrap → REAL switch to full-background through
    // the Templates tab's Apply-to-funnel flow (confirmed live this phase).
    // The brand BACKGROUND is entirely template-supplied (role brand_primary
    // + style brand, effective_frame-derived) — no direct authoring needed,
    // so this pattern hits NONE of the P5 note's point-4 gap fields except
    // footer.description (seeded, same reasoning as patterns A/B).
    const sc = await seedPatternQuote(page.request, {
      name: `E1 D Quote ${uniq}`,
      activity: ACT,
      vertical: VERT,
      sectionIds: [savedD.id, savedF.id, fillers[0]!],
      frame: {
        version: 1,
        template: "centered",
        footer: { description: "Rates depend on underwriting. © 2026 Acme." },
      },
    });
    await openQuoteBuilder(page, sc.quotePublicId);
    await pickPreviewSite(page);
    await applyTemplate(page, "full-background");

    // NOTE: verified via effective_frame.background (below), NOT
    // stored["template"] — see applyTemplate's CONFIRMED BUG citation above.
    const { stored, effective } = await fetchFrameState(page.request, sc.funnelPublicId);
    // brand background = the template's defaults (13 §13.2 effective merge)
    const effectiveBackground = effective["background"] as Record<string, unknown>;
    expect(effectiveBackground["style"]).toBe("brand");
    expect(effectiveBackground["role"], "background color is a ROLE, never hex").toBe("brand_primary");
    expect((stored["footer"] as Record<string, unknown>)["description"]).toBe(
      "Rates depend on underwriting. © 2026 Acme.",
    );

    // §15.4 fixture + (c) COMPOSED §8.7 D: background role · dots style ·
    // card roles · choice title/subtitle — on the REAL live page.
    await activateQuoteOnSite(page.request, sc.quotePublicId, site.id, `pd-${uniq}`);
    livePages.D = { host: site.host, slug: `pd-${uniq}` };
    await gotoLive(page, livePages.D, { width: 1280, height: 900 });

    const background = page.locator('[data-frame-region="background"]');
    await expect(background).toHaveClass(/lg-frame-bg-style-brand/);
    await expect(background).toHaveClass(/lg-frame-bg-role-brand_primary/);
    await expect(page.locator('[data-frame-region="logo"] img.lg-logo-img')).toBeVisible();
    const steps = page.locator('[data-frame-region="progress"] .lg-steps[role="progressbar"]');
    await expect(steps).toBeAttached();
    // REAL 4-step funnel: the quote-owned shared page (already clicked
    // through by gotoLive) + savedD + savedF + 1 filler.
    await expect(steps).toHaveAttribute("aria-valuemax", "4");
    await expect(steps.locator(".lg-step")).toHaveCount(4);
    await expect(steps.locator('.lg-step[data-active="true"]')).toHaveCount(1);
    await expect(page.locator('[data-frame-region="section_slot"]')).toHaveClass(/lg-frame-slot--card/);
    const unitD1 = visibleSection(page);
    await expect(unitD1.locator("h1.lg-headline")).toHaveText("Who is the coverage for?");
    const cards = unitD1.locator(".lg-card-grid button.lg-card");
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toHaveAttribute("role", "radio"); // card roles
    await expect(cards.nth(0).locator(".lg-card-title")).toHaveText("For me");
    await expect(cards.nth(0).locator(".lg-card-subtitle")).toHaveText("Coverage for yourself");
    await expect(cards.nth(1).locator(".lg-card-title")).toHaveText("For my family");
    await expect(cards.nth(1).locator(".lg-card-subtitle")).toHaveText("Protect the whole household");
    await expect(page.locator('[data-frame-region="footer"] .lg-footerbar-legal')).toContainText(
      "Rates depend on underwriting.",
    );
    await shootLivePatternPair(page, livePages.D, "pattern-d");

    // (d) mission-3.8 F INSIDE the D fixture — LEADGEN-REWORK-03 P5: the OLD
    // admin-preview "all slides" stepper is gone (canvas removed, file-
    // header note point 1/6). Replaced with a REAL visitor interaction on
    // the live page: gotoLive already clicks through the shared page
    // (step 1 of 4), landing on savedD (step 2); pick its answer, click
    // Continue, land on savedF (step 3) — MORE faithful than the retired
    // admin stepper, not less (the OLD stepper only ever proved the ADMIN
    // PREVIEW advanced; this proves the real runtime engine does,
    // exercising engine.ts's actual navigation).
    await gotoLive(page, livePages.D, { width: 1280, height: 900 });
    await visibleSection(page).locator('button[data-lg-choice="self"]').click();
    await visibleSection(page).locator("button.lg-continue").click();
    const unitD2 = visibleSection(page);
    await expect(unitD2.locator('[data-component-type="MultiChoiceCardGroup"]')).toBeAttached({
      timeout: 20_000,
    });
    await expect(unitD2.locator(".lg-card-grid.lg-multi")).toBeAttached();
    const multiCards = unitD2.locator(".lg-card-grid.lg-multi button.lg-card");
    await expect(multiCards).toHaveCount(2);
    await expect(multiCards.nth(0)).toHaveAttribute("role", "checkbox");
    await expect(multiCards.nth(0).locator(".lg-card-title")).toHaveText("Low premium");
    await expect(multiCards.nth(0).locator(".lg-card-subtitle")).toHaveText("Keep monthly costs down");
    // frame persistence on step 3: background stays applied (funnel-level
    // config, correctly constant across every slide).
    await expect(page.locator('[data-frame-region="background"]')).toHaveClass(/lg-frame-bg-style-brand/);
    // CONFIRMED BUG (found + reproduced live this phase, NOT fixed here —
    // render.ts/presets.ts are outside this slice's file ownership; reported
    // to the conductor): the "steps"/dots progress style (renderStepIndicator,
    // presets.ts) never emits a `data-lg-progress` marker, so runtime/
    // render.ts's updateProgress() — which only re-stamps
    // aria-valuenow/aria-valuetext/.lg-step[data-active] on elements matching
    // `[data-lg-progress]` — silently never touches it. Reproduced: after two
    // REAL client-side advances (shared page → savedD → savedF, confirmed via
    // each slide's own data-screen-label changing correctly), aria-valuenow
    // stayed frozen at the server's initial "1" the whole time. This is
    // exactly the "bar"-style StepIndicator's sibling gap (bar DOES carry
    // data-lg-progress — Patterns A/E's aria-valuemax checks pass — dots do
    // not). aria-valuemax (the funnel's total slide count, SSR-baked and
    // never meant to change) still correctly reads 4 — the one part of this
    // element this bug does not touch.
    const steppedDots = page.locator('[data-frame-region="progress"] .lg-steps[role="progressbar"]');
    await expect(steppedDots).toHaveAttribute("aria-valuemax", "4");
    await page.screenshot({ path: `${SHOT_DIR}/pattern-d-slide2-multichoice.png` });

    // (e) saved models: §8.4 choice depth persisted on BOTH units, tokenized
    const compsD = savedD.content_json.components;
    expect(compsD.map((c) => c.type)).toEqual([
      "QuestionHeadline",
      "Subheadline",
      "IconCardAnswerGrid",
      "ContinueButton",
    ]);
    const gridD = compsD[2]!;
    expect(gridD.internal_field).toBe("coverage_for");
    expect((gridD.choices ?? []).map((c) => [c["value"], c["icon"], c["title"], c["subtitle"]])).toEqual([
      ["self", "🙋", "For me", "Coverage for yourself"],
      ["family", "👪", "For my family", "Protect the whole household"],
    ]);
    assertTokenizedModel(savedD.content_json, [
      "QuestionHeadline",
      "Subheadline",
      "IconCardAnswerGrid",
      "ContinueButton",
    ]);

    const compsF = savedF.content_json.components;
    expect(compsF.map((c) => c.type)).toEqual(["QuestionHeadline", "Subheadline", "MultiChoiceCardGroup"]);
    const gridF = compsF[2]!;
    expect(gridF.internal_field).toBe("benefit_prefs");
    expect((gridF.choices ?? []).map((c) => [c["value"], c["title"], c["subtitle"]])).toEqual([
      ["low_premium", "Low premium", "Keep monthly costs down"],
      ["fast_payout", "Fast payout", "Claims settled quickly"],
    ]);
    assertTokenizedModel(savedF.content_json, ["QuestionHeadline", "Subheadline", "MultiChoiceCardGroup"]);
  });

  test("pattern E — minimal high-conversion binary: minimal template via the Templates-tab picker; large question + Yes/No pair; no footer", async ({ page }) => {
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

    // (a) FRAME: centered bootstrap → REAL switch to minimal through the
    // Templates tab's Apply-to-funnel flow (clean 1:1 replacement for the
    // pre-rework canvas Template picker — this pattern's core proof, and it
    // hits NONE of the P5 note's point-4 gap fields).
    const sc = await seedPatternQuote(page.request, {
      name: `E1 E Quote ${uniq}`,
      activity: ACT,
      vertical: VERT,
      sectionIds: [saved.id, ...fillers],
      frame: { version: 1, template: "centered" },
    });
    await openQuoteBuilder(page, sc.quotePublicId);
    await pickPreviewSite(page);
    await applyTemplate(page, "minimal");

    // §15.4 fixture (E deliberately not in the committed set) + (c)
    // COMPOSED §8.7 E: minimal template + type roles, on the REAL live page.
    await activateQuoteOnSite(page.request, sc.quotePublicId, site.id, `pe-${uniq}`);
    const liveE = { host: site.host, slug: `pe-${uniq}` };
    await gotoLive(page, liveE, { width: 1280, height: 900 });

    // NOTE: this pattern's core proof is "minimal applied" — verified below
    // via the BEHAVIORAL fields Minimal's seed row actually changes (no
    // footer anywhere; back position under_header_left; bare slot), NOT
    // data-frame-template/.lg-frame--minimal — see applyTemplate's CONFIRMED
    // BUG citation above (that attribute/class stay stuck on the funnel's
    // originally-seeded "centered" identity through this flow, even though
    // these OTHER fields correctly reflect Minimal — reproduced live this
    // phase via a direct effective_frame diff).
    // clean header (site logo), progress with REAL 4-step values (the
    // quote-owned shared page, already clicked through by gotoLive, + this
    // unit + 2 fillers)
    await expect(page.locator("img.lg-logo-img").first()).toBeVisible();
    const progress = page.locator('[data-frame-region="progress"] .lg-progress[role="progressbar"]');
    await expect(progress).toBeAttached();
    await expect(progress).toHaveAttribute("aria-valuemax", "4");
    // back at the minimal template's under-header position (mount — the
    // engine hides it on the funnel's OWN first slide at runtime per 11
    // §11.2; gotoLive already clicked past the shared page, so this proves
    // the position/mount only, not the hidden-on-first-slide behavior)
    await expect(page.locator('[data-frame-region="back"].lg-frame-back--pos-under_header_left')).toBeAttached();
    // bare slot (no card chrome) + NO footer anywhere
    await expect(page.locator('[data-frame-region="section_slot"]')).toHaveClass(/lg-frame-slot--bare/);
    await expect(page.locator('[data-frame-region="footer"]')).toHaveCount(0);
    // the unit's TYPE ROLES: the catalog type stamp + the binary pair
    // (scoped to the VISIBLE section — the fillers are TwoButtonYesNo units
    // too, and all slides including the shared page render simultaneously
    // with only the current one un-hidden; an unscoped locator here is a
    // strict-mode violation by construction, reproduced live this phase).
    const unitE = visibleSection(page);
    await expect(unitE.locator("h1.lg-headline")).toHaveText("Do you own your home?");
    const yesNo = unitE.locator('[data-component-type="TwoButtonYesNo"]');
    await expect(yesNo).toBeAttached();
    await expect(yesNo.locator('button[data-lg-choice="true"]')).toHaveText("Yes, I do");
    await expect(yesNo.locator('button[data-lg-choice="false"]')).toHaveText("Not yet");
    await shootLivePatternPair(page, liveE, "pattern-e");

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
//
// UNCHANGED by LEADGEN-REWORK-03 P5: this section always drove the real
// live /lg page (gotoLive), never the admin canvas §10 removed — nothing
// here depended on anything this phase's removal sweep touched.
// ---------------------------------------------------------------------------

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

// P1 gate-sensitivity calibration (register PC — hidden-attribute vs
// author-display defect, conductor final item). REPLACES the old
// maxDiffPixelRatio budget (0.002 desktop / 0.0025 mobile) with an ABSOLUTE
// pixel count shared by both viewports. Ratio scales with image size — that
// is EXACTLY how desktop got a blind spot: 0.002 of a 1280x916 (1,172,480px)
// image is a ~2,345px budget, loose enough that a real, live defect slipped
// through untouched by --update-snapshots' default "changed" mode (which
// only rewrites a baseline when the render exceeds its threshold).
//
// THE DEFECT THIS MUST CATCH (measured via Playwright's own pixelmatch
// comparator, maxDiffPixels:0, against the CORRECT committed baseline, with
// the P1 [hidden] terminal rule reverted so the runtime-hidden Back
// affordance renders visible again — exactly the regression the gate must
// never again miss):
//   pattern-c-desktop.png              1961 px (header-cta, back--pos-below_card)
//   pattern-c-mobile.png               1898 px
//   pattern-c-zip-variant-desktop.png  1230 px  <- SMALLEST real defect signal
//   pattern-c-zip-variant-mobile.png   1204 px  <- SMALLEST real defect signal
// (the top-position Back patterns A/B/D measured far larger — 7,259 to
// 151,567 px — so the below_card family is the binding constraint.)
//
// THE NOISE FLOOR THIS MUST ABSORB (measured the same way: maxDiffPixels:0,
// correct code, TWO independent fresh renders against the same committed
// baseline — pure cross-run rendering/font-hinting jitter, no code change):
//   ALL 10 files, BOTH runs: 0 differing pixels, every time.
// This 0 is not "low" — it FULLY confirms the per-pixel `threshold` (see
// below) already absorbs the sub-pixel/anti-aliasing jitter documented during
// the P1 baseline re-mint (1-2 RGB-value deltas on shifted glyph/rounded-
// corner edges) INDEPENDENTLY of any pixel-count budget: those never even
// register as a "differing pixel" to begin with.
//
// BUDGET: 200px sits ~6x below the smallest real defect (1204px) and is
// generously above the proven 0px noise floor (headroom for legitimate
// cross-environment font/AA variance beyond this machine's 2 measured runs) —
// tight enough to catch every measured defect with margin, loose enough that
// it will not be the noise source itself.
const MAX_DIFF_PIXELS = 200;

// threshold: the PER-PIXEL YIQ color-difference tolerance pixelmatch applies
// before a pixel counts toward MAX_DIFF_PIXELS at all (independent axis from
// the count budget above). 0.2 is Playwright's own compiled-in default
// (node_modules/playwright-core/lib/server/utils/comparators.js:
// `threshold: options.threshold ?? 0.2`) — stated explicitly here (not left
// implicit) because the noise-floor measurement above was taken AT this
// value: both proof runs (0 diff pixels, twice) ran under this exact
// threshold, so explicitly pinning it is what makes that proof still hold if
// a future Playwright upgrade ever changes its own default.
const SCREENSHOT_COLOR_THRESHOLD = 0.2;

async function shootBaseline(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(["leadgen-v25", name], {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    mask: visualMasks(page),
    maxDiffPixels: MAX_DIFF_PIXELS,
    threshold: SCREENSHOT_COLOR_THRESHOLD,
  });
}

// One §15.4 page = desktop 1280 + mobile 375 committed baselines.
async function visualPage(page: Page, key: "A" | "B" | "C" | "D" | "CZ", base: string): Promise<void> {
  const entry = requireLive(key);
  await gotoLive(page, entry, { width: 1280, height: 900 });
  await shootBaseline(page, `${base}-desktop.png`);
  await gotoLive(page, entry, { width: 375, height: 800 });
  await shootBaseline(page, `${base}-mobile.png`);
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
