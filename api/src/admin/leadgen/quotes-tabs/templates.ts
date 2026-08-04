// LeadGen admin UI — Quotes editor, TEMPLATES tab module (LEADGEN-REWORK-03
// §12 P4, contract §8.3 — rebuilt per docs/leadgen/rework/design-pack/
// templates.html). Layout: elements list LEFT (292px, A–H existing box
// pickers relocated + I·Progress NEW) / live canvas CENTER (fluid, ONE real
// section through the studio's debounced-preview mechanism, mirrored here
// against POST /variants/:id/preview per §4.3-11's shared-page⊕variant-page
// resolved order) / the selected element's settings RIGHT (344px, the
// pre-existing box editors — UNCHANGED — plus the new Progress design box).
// A saved-template bar (M5 `leadgen_frame_templates` CRUD, already shipped in
// P1/frame-handlers.ts — this phase adds ZERO new server routes) sits above:
// create/save-as/rename/duplicate/delete-with-in-use-guard, one Default
// toggle, "Apply to funnel…" (preview-before-apply + confirm, 1:1 with the
// pinned-⑥ preview-before-apply behavior) and "A/B templates…" (forks a
// variant differing in frame_template_id via the existing fork/experiment
// endpoints).
//
// Boxes A–H (`renderTplBox{Background,Logo,Cta,Disclosure,FreeText,
// BrandLogos,Footer,Images}`) are UNCHANGED from the pre-P4 file — their
// `data-tplbox-panel`/`data-frame-key`/`data-tplbox-list` wiring is owned by
// the SHARED `QUOTE_EDITOR_SCRIPT` island (quotes-tabs/funnel.ts, OUT OF this
// slice) via generic, key-driven delegation on the whole `#lg-quote-editor`
// subtree (populateAllControls/writeConfigValue/showTplBoxPanel all match by
// attribute VALUE, never a hardcoded box list) — confirmed by reading that
// island: adding box I only needed a 9th `data-tplbox-pick="progress"` card +
// panel, no funnel.ts edit. Progress's own six controls (Position/Alignment/
// Thickness/Width/Color/Show label) reuse the SAME `progress.*` frame keys
// the pre-existing canvas-click Progress region inspector (funnel.ts
// `renderProgressInspector`) already writes — a duplicate-but-agreeing
// surface, the SAME pattern already established for boxes A/B (background/
// header) as documented below.
//
// Everything this file's OWN new behavior needs (the canvas, the theme
// switcher, the section picker, the template-bar CRUD, apply-to-funnel, and
// A/B-templates) is a fresh, SELF-CONTAINED inline `<script>` this function
// emits directly in its returned markup (mirrored in shape, not by reference,
// from quotes-tabs/funnel.ts's `renderPreview`/`schedulePreview` pattern —
// this file cannot reach that island's private closures, and ui-quotes.ts's
// `scripts` composition is out of this slice, so an inline `<script>` is the
// only place new JS can live). It is inert strict ES5 (no backticks/arrow/
// const/let — L-185) and defers all DOM work to `DOMContentLoaded` (this
// panel's own markup — and the `#lg-quote-data` blob emitted by ui-quotes.ts
// AFTER every tab panel — must already exist in the document by the time it
// runs). Every endpoint it calls already exists (frame-template-records CRUD,
// /funnels/:id/apply-template, /quotes/:id/shared-page, /variants/:id/preview
// {mode,draft_frame_config,draft_theme,section_public_id,site_id,
// sample_section}, /themes, /variants/:id/fork, /funnels/:id/experiments,
// /experiments/:id/start, /variants/:id PUT).
//
// R2 §3 ② (A.1 #11-D) — what this rebuild changed here:
//   1. ONE preview path. The empty-funnel leg used to call a SECOND endpoint
//      (POST /sections/preview) that renders a bare, frameless sample card —
//      so on a new funnel NOTHING the Funnel-layout boxes edit was visible.
//      Both legs now take POST /variants/:id/preview; an empty funnel asks
//      for the sample section INSIDE the real frame (`sample_section:true`,
//      quotes-handlers.ts buildSamplePreviewSection).
//   2. LIVE reflection for every element A–I. Scalars keep the
//      `[data-frame-key]`/`[data-role-pick]` mirror; the ARRAY-shaped groups
//      (C cta_slots · D disclosure.entries · E free_text · F brand_logos ·
//      G footer.blocks · H images) are re-read from their own box rows at
//      render time (collect*/overlayListGroups below — shapes mirror
//      funnel.ts's collectors 1:1), and hidden media `[data-frame-key]`
//      inputs (element A's background image, written with no 'change' event)
//      are re-read the same way. They no longer wait for a Save.
//   3. site_id rides the preview body (R5), so the canvas renders the chosen
//      site's real branding — #11A's missing logo.
//   4. "+ New template" posts the LIVE draft, not the page-load snapshot (R4).
//   5. The no-sections failure leg writes a visible message to the REAL
//      `#lg-tpl-canvas-status` (R6), and the dead static preview chip
//      is gone (B6).

import { escapeHtml } from "../../templates/layout";
import {
  FRAME_BACKGROUND_STYLES,
  FRAME_BRAND_LOGO_LAYOUTS,
  FRAME_CTA_SLOTS,
  FRAME_DISCLOSURE_MODES,
  FRAME_DISCLOSURE_V2_LOCATIONS,
  FRAME_ELEMENT_ALIGNS,
  FRAME_FOOTER_BLOCK_TYPES,
  FRAME_FREE_TEXT_BLOCK_TYPES,
  FRAME_FREE_TEXT_LIST_STYLES,
  FRAME_FREE_TEXT_SLOTS,
  FRAME_LOGO_ALIGNS,
  FRAME_PAGE_TARGET_MODES,
  FRAME_PROGRESS_ALIGNS,
  FRAME_PROGRESS_ICONS,
  FRAME_PROGRESS_POSITIONS,
  FRAME_PROGRESS_STYLES,
  FRAME_PROGRESS_WIDTHS,
  FRAME_SIZES,
  FRAME_TYPO_SIZES,
} from "../../../public/leadgen/designs/frames";
import { FUNNEL_TOKEN_ROLES, THEME_RECORD_FONT_NAMES } from "../../../public/leadgen/designs/theme";
import { type QuoteRulesRailAnswerField } from "../ui-rules-builder";
import {
  roleLabel,
  enumOptions,
  renderRoleStrip,
  frameControl,
  frameCheck,
  frameSelect,
  frameInput,
  mediaFieldMarkup,
  mediaPickerControl,
  renderFrameList,
} from "./shared";

// R2 P7 D1 (owner SRC-11A) — what the canvas says when the previewed site's
// stored logo reference resolves to an image the browser cannot load. The
// no-logo case already has its own honest chip (frame.ts
// LOGO_FALLBACK_CHIP_TEXT, "No logo — set it in Site settings."); this is the
// DIFFERENT, previously silent case: a logo IS configured, the file behind it
// is gone, and the operator used to get a ~143x18 broken-image sliver instead
// of a sentence. Exported so a test can assert the rendered copy by identity
// rather than by re-typing the string.
export const LOGO_UNREACHABLE_CANVAS_TEXT =
  "This site's logo image could not be loaded — re-upload it in Site settings.";

// R2 P8 S4.2 — the ONE operator vocabulary for `progress.style`. The thumbnail
// picker (PROGRESS_TYPE_OPTIONS below) already had these words; the island's
// saved-template pill and the apply-confirm sentences printed the RAW enum
// instead ("dots progress", "Progress style changes from numbered to dots.").
// Both now interpolate this map, so a style has exactly one operator name
// wherever this tab speaks about it. "hidden" is the Show-progress-bar toggle's
// state, not a picker tile, so it is named here and only here.
// Keyed off designs/frames.ts's own enum, so a new style cannot be added there
// without this map failing to compile.
export const PROGRESS_STYLE_LABELS: Readonly<Record<(typeof FRAME_PROGRESS_STYLES)[number], string>> = {
  hidden: "No progress bar",
  bar: "Bar",
  dots: "Dots",
  numbered: "Numbered",
  percent: "Percent",
  icon_on_track: "Icon on track",
};


// ---------------------------------------------------------------------------
// Round-4 P5b — TEMPLATES TAB: the seven (now eight, A–H) box pickers
// (operator restructure spec B-3). Each box is a card that opens its OWN
// right-side editor, reusing the EXISTING inspector-panel idioms
// (frameControl/frameCheck/frameSelect/mediaPickerControl/renderRoleStrip/
// renderFrameList/the SAME `.lg-inspector-panel`-style mutually-exclusive
// show/hide (`data-tplbox-panel` + `showTplBoxPanel` in the shared island,
// kept independent of the canvas's `data-region-panel`/`showRegionPanel` so
// the two navigation surfaces never cross-wire). Boxes A (Background) and B
// (Logo) edit the SAME `background.*` / `header.logo_*` keys the canvas-click
// Background/Header inspectors already own — the SAME `data-frame-key` names
// are reused (harmless duplicates: `populateAllControls` targets EVERY
// matching element and `activate()` repaints on every tab switch, so both
// copies always agree). Boxes C–H are Round-4 P5a's NEW authorable elements
// (cta_slots / disclosure.entries / free_text / brand_logos / footer.blocks /
// images) — UNCHANGED from before this phase. Box I (Progress, below) extends
// the SAME A/B duplicate-but-agreeing pattern to `progress.*`.
// ---------------------------------------------------------------------------

function renderTplBoxBackground(): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-tplbox-panel="background">
  <h3>A &middot; Background</h3>
  <p class="form-help">The funnel's page background &mdash; color and an optional image.</p>
  ${frameControl("Color", renderRoleStrip("background.role"))}
  ${mediaPickerControl("Background image (optional, from the Media library)", "background.image_media_id")}
  ${frameSelect("Style", "background.style", FRAME_BACKGROUND_STYLES, { flat: "Flat", brand: "Brand", brand_gradient: "Brand gradient" })}
</div>`;
}


// R2 P8 S4.2 — two copy defects lived in this box.
//   * §6 M9.1: the trailing help sentence sent the operator to "the Header
//     region on the canvas (Funnel builder tab) -> Advanced" for a manual logo
//     override. That canvas was DELETED at the owner's request, and no admin
//     surface writes `header.logo_media_id` any more (0 hits under src/admin
//     outside the FOOTER logo block's own `logo_media_id` list field), so the
//     sentence named a place AND an affordance that do not exist. Removed
//     rather than replaced: this box offers the two sources that do exist.
//   * §7 N12 (settled in P8 FIX ROUND F1): Alignment here offered Left/Center
//     while Progress's Alignment offered Left/Center/Right. The cause was the
//     STYLESHEET — default-funnel/styles.ts declared `.lg-frame-header--left`
//     and `--center` and no `--right`, so Right could not have been honoured
//     (§4 R3 corollary) and offering it would have been the defect, not the
//     fix. The `--right` rule now exists (the one-property mirror of `--left`
//     on the same flex `.lg-header-inner`, plus the extras band's mirror) and
//     frames.ts FRAME_LOGO_ALIGNS carries "right", so the two Alignment
//     controls now speak one vocabulary and this select offers all three.
function renderTplBoxLogo(): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-tplbox-panel="logo">
  <h3>B &middot; Logo</h3>
  <p class="form-help">The header logo &mdash; sourced from the selected preview site's branding by default.</p>
  ${frameSelect("Logo source", "header.logo_source", ["site", "cms_fallback"], { site: "Site logo (auto)", cms_fallback: "CMS fallback" })}
  ${frameSelect("Logo size", "header.logo_size", FRAME_SIZES, { s: "Small", m: "Medium", l: "Large" })}
  ${frameSelect("Alignment", "header.logo_align", FRAME_LOGO_ALIGNS, { left: "Left", center: "Center", right: "Right" }, "Where the logo sits in the header bar.")}
</div>`;
}


// 10C CTA/phone slots — the P2c-style plain-language condition builder over
// the __ctx synthetic keys PLUS every known answer field (the SAME `fields`
// list the routing-rules condition builder already offers, ui-rules-
// builder.ts). `when`/`op` mirror the FrameCtaCondition grammar exactly
// (frames.ts validateFrameCondition). The __-PREFIXED wire names are load-
// bearing — they must match resolver.ts buildFrameCtaCtx's ctx keys
// (__page/__hour/__weekday always present; __state/__device when known)
// byte for byte, or an authored condition never actually evaluates true.
// Plain answer fields (no prefix) use their real internal_field name.
const CTA_CONDITION_CTX_FIELDS: ReadonlyArray<readonly [string, string]> = [
  ["__state", "State"],
  ["__device", "Device"],
  ["__hour", "Hour (UTC 0–23)"],
  ["__weekday", "Weekday (UTC 0–6)"],
  ["__page", "Page number"],
];

const CTA_CONDITION_OPS: ReadonlyArray<readonly [string, string]> = [
  ["eq", "is"],
  ["neq", "is not"],
];

function ctaConditionFieldOptions(answerFields: readonly QuoteRulesRailAnswerField[], selected: string): string {
  const ctx = CTA_CONDITION_CTX_FIELDS.map(
    ([v, label]) => `<option value="${escapeHtml(v)}"${v === selected ? " selected" : ""}>${escapeHtml(label)}</option>`,
  ).join("");
  const answers = answerFields
    .map(
      (f) =>
        `<option value="${escapeHtml(f.internal_field)}"${f.internal_field === selected ? " selected" : ""}>${escapeHtml(f.label)}</option>`,
    )
    .join("");
  return `<optgroup label="Visitor info">${ctx}</optgroup>${answerFields.length > 0 ? `<optgroup label="Answers">${answers}</optgroup>` : ""}`;
}

function ctaConditionOpOptions(selected: string): string {
  return CTA_CONDITION_OPS.map(
    ([v, label]) => `<option value="${escapeHtml(v)}"${v === selected ? " selected" : ""}>${escapeHtml(label)}</option>`,
  ).join("");
}

// One condition row (rendered as the client-side template's content — the
// island clones it for "+ Add condition"; SSR never emits an initial row, the
// island fills from the loaded config exactly like the pre-existing
// footer.links/trust_strip.logos/benefit_bar.items lists).
function renderCtaConditionRowTemplate(answerFields: readonly QuoteRulesRailAnswerField[]): string {
  return `<div class="lg-list-row" data-cta-cond-row>
    <select class="form-select form-select-sm" data-cta-cond-field aria-label="Condition field">${ctaConditionFieldOptions(answerFields, "__state")}</select>
    <select class="form-select form-select-sm" data-cta-cond-op aria-label="Condition comparison">${ctaConditionOpOptions("eq")}</select>
    <input class="form-input" data-cta-cond-value placeholder="value" aria-label="Condition value" />
    <button type="button" class="btn btn-sm btn-outline" data-cta-cond-row-remove aria-label="Remove condition">&#10005;</button>
  </div>`;
}

function renderCtaSlotRowTemplate(answerFields: readonly QuoteRulesRailAnswerField[]): string {
  return `<div class="lg-tplbox-row" data-cta-row>
    <div class="lg-list-row">
      <select class="form-select form-select-sm" data-cta-slot aria-label="CTA slot">${enumOptions(FRAME_CTA_SLOTS, { header_right: "Header (right)", under_header: "Under the header", section_bottom: "Bottom of the section", footer: "Footer" })}</select>
      <input class="form-input" data-cta-label placeholder="Label (e.g. Call now)" aria-label="CTA label" />
      <input class="form-input" data-cta-tel placeholder="Phone, e.g. +1 555 123 4567" aria-label="CTA phone number" />
      <input class="form-input" data-cta-href placeholder="Or a link (https://…)" aria-label="CTA link" />
      <select class="form-select form-select-sm" data-cta-align aria-label="CTA alignment">${enumOptions(FRAME_ELEMENT_ALIGNS, { left: "Left", center: "Center", right: "Right" })}</select>
      <button type="button" class="btn btn-sm btn-outline" data-cta-remove aria-label="Remove CTA slot">&#10005;</button>
    </div>
    <button type="button" class="btn btn-sm btn-secondary" data-cta-cond-toggle aria-expanded="false">+ Add a condition</button>
    <div class="lg-tplbox-cond lg-hidden" data-cta-cond-box>
      <p class="form-help">Shown only when this holds (a compiled condition &mdash; toggling isn't wired live yet, but the config authors and round-trips today).</p>
      <div class="form-group"><label class="form-label">Match</label>
        <select class="form-select form-select-sm" data-cta-cond-match aria-label="Match all or any of these">
          <option value="all">All of these</option>
          <option value="any">Any of these</option>
        </select>
      </div>
      <div data-cta-cond-rows></div>
      <button type="button" class="btn btn-sm btn-secondary" data-cta-cond-add>+ Add condition</button>
    </div>
  </div>`;
}

function renderTplBoxCta(answerFields: readonly QuoteRulesRailAnswerField[]): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-tplbox-panel="cta">
  <h3>C &middot; Phone / URL</h3>
  <p class="form-help">Placeable call/link buttons (header, under the header, bottom of the section, or the footer).</p>
  <div data-tplbox-list="cta_slots"></div>
  <template data-tplbox-tpl="cta_slots">${renderCtaSlotRowTemplate(answerFields)}</template>
  <template data-tplbox-tpl="cta_cond_row">${renderCtaConditionRowTemplate(answerFields)}</template>
  <button type="button" class="btn btn-sm btn-secondary" data-tplbox-add="cta_slots">+ Add a CTA slot</button>
</div>`;
}


// 10H-adjacent disclosure v2 — per-location entries (top/bottom), full/hover.
function renderDisclosureEntryRowTemplate(): string {
  // ONE root element (the island clones templates via firstElementChild) —
  // the row + its textarea are both children of `data-disc-entry-row`.
  return `<div class="lg-tplbox-row" data-disc-entry-row>
    <div class="lg-list-row">
      <select class="form-select form-select-sm" data-disc-location aria-label="Disclosure location">${enumOptions(FRAME_DISCLOSURE_V2_LOCATIONS, { top: "Top", bottom: "Bottom" })}</select>
      <select class="form-select form-select-sm" data-disc-mode aria-label="Disclosure mode">${enumOptions(FRAME_DISCLOSURE_MODES, { full: "Always shown", hover: "Hover / focus trigger" })}</select>
      <input class="form-input" data-disc-link-label placeholder="Trigger label (hover mode)" aria-label="Disclosure trigger label" />
      <select class="form-select form-select-sm" data-disc-align aria-label="Disclosure alignment">${enumOptions(FRAME_ELEMENT_ALIGNS, { left: "Left", center: "Center", right: "Right" })}</select>
      <button type="button" class="btn btn-sm btn-outline" data-disc-entry-remove aria-label="Remove disclosure entry">&#10005;</button>
    </div>
    <textarea class="form-input" rows="2" data-disc-text placeholder="Disclosure copy for this entry" aria-label="Disclosure entry text"></textarea>
  </div>`;
}

function renderTplBoxDisclosure(): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-tplbox-panel="disclosure">
  <h3>D &middot; Disclosure</h3>
  <p class="form-help">Per-location advertising-disclosure entries (top and bottom can coexist).</p>
  <div data-tplbox-list="disclosure.entries"></div>
  <template data-tplbox-tpl="disclosure.entries">${renderDisclosureEntryRowTemplate()}</template>
  <button type="button" class="btn btn-sm btn-secondary" data-tplbox-add="disclosure.entries">+ Add a disclosure entry</button>
</div>`;
}


// Shared page-targeting mini-control (10E/10F) — scoped to its own row via
// ancestor lookup in the island (no shared ids), so every free-text /
// brand-logos owner gets its own independent mode/from/to/list inputs.
function renderPageTargetControl(): string {
  return `<div class="lg-tplbox-pagetarget">
    <div class="form-group"><label class="form-label">Show on</label>
      <select class="form-select form-select-sm" data-pt-mode aria-label="Page targeting mode">${enumOptions(FRAME_PAGE_TARGET_MODES, { all: "Every page", first: "First page only", range: "A page range", list: "Specific pages" })}</select>
    </div>
    <div class="lg-list-row">
      <input class="form-input form-input-sm" type="number" min="1" data-pt-from placeholder="From page" aria-label="Page range start" />
      <input class="form-input form-input-sm" type="number" min="1" data-pt-to placeholder="To page" aria-label="Page range end" />
      <input class="form-input" data-pt-list placeholder="Pages, comma-separated (e.g. 1, 3)" aria-label="Specific pages" />
    </div>
  </div>`;
}


// 10E free text — an entry is N inline blocks at a slot, with alignment/
// typography + page targeting. `id` is REQUIRED by validateFreeText and is
// never operator-authored — the island stamps one at add-time (hidden input).
function renderFreeTextBlockRowTemplate(): string {
  return `<div class="lg-tplbox-block" data-ft-block-row>
    <div class="lg-list-row">
      <select class="form-select form-select-sm" data-ft-block-type aria-label="Text block type">${enumOptions(FRAME_FREE_TEXT_BLOCK_TYPES, { paragraph: "Paragraph", heading: "Heading", list: "List" })}</select>
      <select class="form-select form-select-sm lg-hidden" data-ft-block-liststyle aria-label="List style">${enumOptions(FRAME_FREE_TEXT_LIST_STYLES, { unordered: "Bulleted", ordered: "Numbered", check: "Checklist" })}</select>
      <button type="button" class="btn btn-sm btn-outline" data-ft-block-remove aria-label="Remove text block">&#10005;</button>
    </div>
    <div class="lg-tplbox-toolbar" data-ft-block-toolbar>
      <button type="button" class="btn btn-sm btn-outline" data-ft-fmt="bold" aria-label="Bold" title="Bold"><strong>B</strong></button>
      <button type="button" class="btn btn-sm btn-outline" data-ft-fmt="italic" aria-label="Italic" title="Italic"><em>I</em></button>
      <button type="button" class="btn btn-sm btn-outline" data-ft-fmt="link" aria-label="Link" title="Link">Link</button>
    </div>
    <textarea class="form-input" rows="3" data-ft-block-text placeholder="Text for this block" aria-label="Text block content"></textarea>
    <textarea class="form-input lg-hidden" rows="3" data-ft-block-items placeholder="One list item per line" aria-label="List items, one per line"></textarea>
  </div>`;
}

function renderFreeTextEntryRowTemplate(): string {
  return `<div class="lg-tplbox-row" data-ft-entry-row>
    <input type="hidden" data-ft-entry-id />
    <div class="lg-list-row">
      <select class="form-select form-select-sm" data-ft-slot aria-label="Free-text slot">${enumOptions(FRAME_FREE_TEXT_SLOTS, { above_section: "Above the section", below_section: "Below the section", above_header: "Above the header", below_footer: "Below the footer" })}</select>
      <select class="form-select form-select-sm" data-ft-align aria-label="Free-text alignment">${enumOptions(FRAME_ELEMENT_ALIGNS, { left: "Left", center: "Center", right: "Right" })}</select>
      <button type="button" class="btn btn-sm btn-outline" data-ft-entry-remove aria-label="Remove free-text element">&#10005;</button>
    </div>
    <div class="lg-scalars">
      <div class="form-group"><label class="form-label">Text size</label><select class="form-select form-select-sm" data-ft-typo-size aria-label="Text size"><option value="">Theme default</option>${enumOptions(FRAME_TYPO_SIZES, { s: "Small", m: "Medium", l: "Large", xl: "Extra large" })}</select></div>
      <div class="form-group"><label class="form-label">Text color</label><select class="form-select form-select-sm" data-ft-typo-color aria-label="Text color role"><option value="">Theme default</option>${FUNNEL_TOKEN_ROLES.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(roleLabel(r))}</option>`).join("")}</select></div>
    </div>
    ${renderPageTargetControl()}
    <div data-ft-blocks></div>
    <button type="button" class="btn btn-sm btn-secondary" data-ft-block-add>+ Add a text block</button>
  </div>`;
}

function renderTplBoxFreeText(): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-tplbox-panel="free_text">
  <h3>E &middot; Free text</h3>
  <p class="form-help">Author paragraph / heading / checklist blocks anywhere in the funnel chrome.</p>
  <div data-tplbox-list="free_text"></div>
  <template data-tplbox-tpl="free_text">${renderFreeTextEntryRowTemplate()}</template>
  <template data-tplbox-tpl="free_text_block">${renderFreeTextBlockRowTemplate()}</template>
  <button type="button" class="btn btn-sm btn-secondary" data-tplbox-add="free_text">+ Add a free-text element</button>
</div>`;
}


// 10F brand logos strip — media-id or URL refs, PLUS a direct upload through
// P5c's sanitized endpoint (assets-handlers.ts uploadBrandLogoHandler: SVG
// runs the allowlist sanitizer before storage; PNG/JPEG pass the raster
// check). The hidden file input's accept list matches the dispatch's exact
// spec; the SERVER additionally accepts webp/gif/avif (belt-and-suspenders —
// the accept attribute is a UI filter hint only, never the security gate).
function renderBrandLogoItemRowTemplate(): string {
  return `<div class="lg-list-row" data-bl-item-row>
    ${mediaFieldMarkup("data-list-field", "media_id", "Logo image (from the Media library)")}
    <input class="form-input" data-bl-item-url placeholder="Or a direct image URL (https://…)" aria-label="Logo image URL" />
    <input class="form-input" data-bl-item-alt placeholder="Alt text (required)" aria-label="Logo alt text" />
    <select class="form-select form-select-sm" data-bl-item-size aria-label="Logo size">${enumOptions(FRAME_SIZES, { s: "Small", m: "Medium", l: "Large" })}</select>
    <span class="lg-row-rail">
      <button type="button" class="btn btn-sm btn-outline" data-bl-item-up aria-label="Move logo up">&#8593;</button>
      <button type="button" class="btn btn-sm btn-outline" data-bl-item-down aria-label="Move logo down">&#8595;</button>
      <button type="button" class="btn btn-sm btn-outline" data-bl-item-remove aria-label="Remove logo">&#10005;</button>
    </span>
  </div>`;
}

function renderTplBoxBrandLogos(): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-tplbox-panel="brand_logos">
  <h3>F &middot; Brand logos</h3>
  <p class="form-help">A row or grid of partner/trust logos, placed at a slot.</p>
  <label class="lg-check"><input type="checkbox" data-bl-enabled /> Show the brand-logos strip</label>
  <div class="lg-scalars">
    <div class="form-group"><label class="form-label">Layout</label><select class="form-select form-select-sm" data-bl-layout aria-label="Brand logos layout">${enumOptions(FRAME_BRAND_LOGO_LAYOUTS, { row: "Row", grid: "Grid" })}</select></div>
    <div class="form-group"><label class="form-label">Slot</label><select class="form-select form-select-sm" data-bl-slot aria-label="Brand logos slot">${enumOptions(FRAME_FREE_TEXT_SLOTS, { above_section: "Above the section", below_section: "Below the section", above_header: "Above the header", below_footer: "Below the footer" })}</select></div>
    <div class="form-group"><label class="form-label">Alignment</label><select class="form-select form-select-sm" data-bl-align aria-label="Brand logos alignment">${enumOptions(FRAME_ELEMENT_ALIGNS, { left: "Left", center: "Center", right: "Right" })}</select></div>
  </div>
  ${renderPageTargetControl()}
  <div data-tplbox-list="brand_logos.items"></div>
  <template data-tplbox-tpl="brand_logos.items">${renderBrandLogoItemRowTemplate()}</template>
  <div class="toolbar">
    <button type="button" class="btn btn-sm btn-secondary" data-tplbox-add="brand_logos.items">+ Add a logo</button>
    <button type="button" class="btn btn-sm btn-outline" data-bl-upload-btn>Upload a logo file&#8230;</button>
    <input type="file" class="lg-hidden" data-bl-upload-input accept="image/svg+xml,image/png,image/jpeg" aria-label="Upload a logo file (SVG, PNG or JPEG)" />
  </div>
  <p class="form-help lg-hidden" data-bl-upload-error role="alert"></p>
</div>`;
}


// 10H footer v2 — add/remove/reorder blocks + the footer's OWN palette/
// typography scope (10H "different color, font and sizes than the main
// template"). Type-conditional fields per FRAME_FOOTER_BLOCK_TYPES.
//
// R2 P3 (element J, SOURCE-OF-TRUTH A.2) upgrades this SAME box IN PLACE
// (contract §5.4 minor-1 — TPLBOX_CARDS keeps exactly one key:"footer" entry,
// asserted below; no second footer tile, no orphaned old footer.blocks shape
// — every field this adds is OPTIONAL on FrameFooterBlock/FrameTypographyScope,
// so a pre-J saved footer keeps validating and rendering byte-identically):
//   1. about_paragraph/disclosure/heading now carry a rich-text toolbar
//      (bold/italic/link — the SAME 3 actions as E's `data-ft-fmt` toolbar,
//      re-implemented here as `data-footer-fmt` because funnel.ts's existing
//      click handler for `data-ft-fmt` hardcodes free_text's own collector —
//      reusing its exact attribute name would silently wrap the RIGHT
//      textarea but persist to the WRONG config path; see this slice's
//      handoff note) plus new "Heading"/"List" block types mirroring
//      FRAME_FREE_TEXT_BLOCK_TYPES's own paragraph/heading/list model.
//   2. "About paragraph" is relabeled to name the owner's Image28/45 "company
//      details" example directly (the SAME about_paragraph type — no schema
//      break).
//   3. "Logo" gains a site/manual source toggle (FRAME_FOOTER_LINKS_SOURCES'
//      OWN site|manual enum, reused rather than a new one) + media/URL/alt.
//   4. The box gains an independent Font family control below, a CLOSED
//      enum (THEME_RECORD_FONT_NAMES — theme.ts's own pre-vetted vocabulary,
//      never an unconstrained string; see theme.ts's "P0 STORED-XSS FIX").
// All of these are schema+editor plumbing; the SERVED page's HTML for the
// new fields (html/items/list_style/logo_source/logo_media_id/logo_url/
// logo_alt/typography_scope.font_family) is produced by designs/frame.ts
// (singular — NOT this slice's file, see the handoff note), which today only
// reads block.text (escaped) and site branding for "logo" — this upgrade
// cannot make those fields visible on a live page by itself.
function renderFooterLinkRowTemplate(): string {
  return `<div class="lg-list-row" data-footer-link-row>
    <input class="form-input" data-footer-link-label placeholder="Label" aria-label="Footer link label" />
    <input class="form-input" data-footer-link-href placeholder="https://… or /page" aria-label="Footer link address" />
    <button type="button" class="btn btn-sm btn-outline" data-footer-link-remove aria-label="Remove link">&#10005;</button>
  </div>`;
}

// R2 P3 (element J) D2 — one row of the Pages-fed picker (data-footer-picks-
// load fetches GET /sites/:site_id/legal-pages, clones this template once per
// candidate page). The stable identity is carried in hidden fields (never the
// page's row id — see leadgen/branding.ts's resolver comment on why); the
// label starts pre-filled from the page's title but stays author-editable
// (the SAME saved label rides every serving site).
// R2 P3 FIX-FIRST (BLOCKER-2) — TWO identity fields now: the per-site UNIQUE
// `slug` (primary) and `page_type` (back-compat fallback). A stock site seeds
// FOUR pages as page_type:"legal", so page_type alone made four picks
// indistinguishable BOTH here (the operator saw four identical rows) and at
// serve time (all four resolved to one page). The visible title now also
// carries the slug, so the operator can tell them apart.
function renderFooterPickRowTemplate(): string {
  return `<div class="lg-list-row" data-footer-pick-row>
    <label class="lg-check"><input type="checkbox" data-footer-pick-checked /> <span data-footer-pick-title></span></label>
    <input type="hidden" data-footer-pick-pagetype />
    <input type="hidden" data-footer-pick-slug />
    <input class="form-input" data-footer-pick-label placeholder="Label" aria-label="Picked page label" />
    <input class="form-input" data-footer-pick-manualurl placeholder="Fallback URL if a site has no match (https://…)" aria-label="Picked page fallback URL" />
  </div>`;
}

// R2 P3 FIX-FIRST (MINOR-13) — the rich toolbar's "Link" dialog. The ADJ-A10
// studio modal idiom (ui-section-studio.ts renderNewSharedValueModal):
// role="dialog" aria-modal="true" overlay + panel, an inline error slot, and
// an explicit Cancel — never a raw window.prompt(). Rendered ONCE per
// Templates panel; funnel.ts's island drives it (openLinkModal /
// confirmLinkModal) for BOTH the footer-block and free-text toolbars.
function renderFooterLinkModal(): string {
  return `<div class="lg-media-picker-overlay lg-hidden" id="lg-link-modal" role="dialog" aria-modal="true" aria-label="Insert a link">
  <div class="lg-media-picker-panel" style="max-width:420px">
    <div class="studio-events-head">
      <span class="form-label">Insert a link</span>
      <button type="button" class="btn btn-sm btn-outline" data-link-modal-cancel>Close</button>
    </div>
    <div class="form-group">
      <label class="form-label" for="lg-link-modal-url">Link address</label>
      <input type="text" id="lg-link-modal-url" class="form-input" placeholder="https://… or /page" />
      <p class="form-help studio-field-error" id="lg-link-modal-error" hidden>Enter a web address (https://…), a page path (/…), or a #link.</p>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
      <button type="button" class="btn btn-sm btn-outline" data-link-modal-cancel>Cancel</button>
      <button type="button" class="btn btn-sm btn-secondary" data-link-modal-confirm>Insert link</button>
    </div>
  </div>
</div>`;
}

function renderFooterBlockRowTemplate(): string {
  return `<div class="lg-tplbox-row" data-footer-block-row>
    <div class="lg-list-row">
      <select class="form-select form-select-sm" data-footer-block-type aria-label="Footer block type">${enumOptions(FRAME_FOOTER_BLOCK_TYPES, { about_paragraph: "Company details", link_row: "Link row", disclosure: "Disclosure", logo: "Logo", address: "Address", socials: "Social links", heading: "Heading", list: "List" })}</select>
      <select class="form-select form-select-sm" data-footer-block-align aria-label="Footer block alignment">${enumOptions(FRAME_ELEMENT_ALIGNS, { left: "Left", center: "Center", right: "Right" })}</select>
      <span class="lg-row-rail">
        <button type="button" class="btn btn-sm btn-outline" data-footer-block-up aria-label="Move block up">&#8593;</button>
        <button type="button" class="btn btn-sm btn-outline" data-footer-block-down aria-label="Move block down">&#8595;</button>
        <button type="button" class="btn btn-sm btn-outline" data-footer-block-remove aria-label="Remove block">&#10005;</button>
      </span>
    </div>
    <div class="lg-tplbox-toolbar" data-footer-block-toolbar>
      <button type="button" class="btn btn-sm btn-outline" data-footer-fmt="bold" aria-label="Bold" title="Bold"><strong>B</strong></button>
      <button type="button" class="btn btn-sm btn-outline" data-footer-fmt="italic" aria-label="Italic" title="Italic"><em>I</em></button>
      <button type="button" class="btn btn-sm btn-outline" data-footer-fmt="link" aria-label="Link" title="Link">Link</button>
    </div>
    <textarea class="form-input" rows="2" data-footer-block-text placeholder="About / disclosure / address / heading copy" aria-label="Footer block text"></textarea>
    <select class="form-select form-select-sm lg-hidden" data-footer-block-level aria-label="Footer heading level"><option value="1">Heading level 1</option><option value="2">Heading level 2</option><option value="3" selected>Heading level 3</option><option value="4">Heading level 4</option><option value="5">Heading level 5</option><option value="6">Heading level 6</option></select>
    <select class="form-select form-select-sm lg-hidden" data-footer-block-liststyle aria-label="Footer list style">${enumOptions(FRAME_FREE_TEXT_LIST_STYLES, { unordered: "Bulleted", ordered: "Numbered", check: "Checklist" })}</select>
    <textarea class="form-input lg-hidden" rows="3" data-footer-block-items placeholder="One list item per line" aria-label="Footer list items, one per line"></textarea>
    <div class="lg-hidden" data-footer-block-linkrow>
      <div class="form-group"><label class="form-label">Links source</label>
        <select class="form-select form-select-sm" data-footer-block-linksource aria-label="Footer link row source">
          <option value="site">From site settings (legal links)</option>
          <option value="manual">Manual list</option>
          <option value="picked">From Pages (operator-picked)</option>
        </select>
      </div>
      <div data-footer-block-links></div>
      <button type="button" class="btn btn-sm btn-secondary" data-footer-block-link-add>+ Add link</button>
      <div data-footer-block-pickedrow>
        <button type="button" class="btn btn-sm btn-outline" data-footer-picks-load>Load pages from the preview site&#8230;</button>
        <div data-footer-block-picks></div>
        <p class="form-help">Each picked page resolves to that page on whichever site serves the funnel (by its stable page type, not by id) &mdash; add a fallback URL for a site with no matching page.</p>
      </div>
    </div>
    <div class="lg-hidden" data-footer-block-logo>
      <div class="form-group"><label class="form-label">Logo source</label>
        <select class="form-select form-select-sm" data-footer-block-logosource aria-label="Footer logo source">
          <option value="site">The site's own logo</option>
          <option value="manual">Manual (choose an image or paste a URL)</option>
        </select>
      </div>
      ${mediaFieldMarkup("data-list-field", "logo_media_id", "Footer logo image (from the Media library)")}
      <input class="form-input" data-footer-block-logourl placeholder="Or a direct image URL (https://…)" aria-label="Footer logo image URL" />
      <input class="form-input" data-footer-block-logoalt placeholder="Alt text" aria-label="Footer logo alt text" />
    </div>
  </div>`;
}

// R2 P8 S4.2 + FIX ROUND F1 (§7 N17): A.2 names "free text (rich toolbar)" and
// "company details" as two of the footer's parts; the product serves both from
// ONE block type (`about_paragraph`, which has carried the bold/italic/link
// toolbar since P3 item 1 above). Two fixes, in order: a help line says so in
// product words, and the OPTION LABEL — which literally read "About paragraph /
// company details", i.e. two names for one control, the defect §7 N17 names —
// is now the single name "Company details", the owner's own word for it and the
// same vocabulary the box's own summary line already used. The enum VALUE
// (`about_paragraph`) is untouched, so nothing stored changes.
//
// R2 P3 BLOCKER FIX (UI gap 1 of 3): this box had NO control for
// footer.enabled, so the operator could author a complete element-J footer
// here and still have it render NOTHING — designs/frame.ts renderFooterRegion
// returns "" on `!f.enabled` before it ever looks at blocks, and one of the six
// built-in arrangement families ("minimal") ships footer.enabled:false, as does
// any saved template derived from it. `frameCheck` is the SAME data-frame-key
// affordance every other boolean in this panel uses (onFrameKeyChange →
// setPath(myFrame,…) → scheduleCanvasPreview; funnel.ts hydrates it from the
// effective frame), so it saves and round-trips with no new plumbing.
// SCOPE NOTE: only footer.enabled is added — footer.show_on and
// footer.links_source stay unsurfaced (the saved template's own arrangement
// family supplies show_on:"all"), so this touches exactly ONE of the three keys
// test/leadgen-quote-builder-ui.test.ts's retired region-inspector inventory
// currently asserts absent (that conflict is reported, never edited away).
function renderTplBoxFooter(): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-tplbox-panel="footer">
  <h3>J &middot; Footer</h3>
  <p class="form-help">Bottom-of-page blocks (company details / links / disclosure / logo / address / socials / heading / list), with their own palette, font family and sizes &mdash; independent of the main template.</p>
  <p class="form-help">Free text and company details are the same block here &mdash; "Company details" takes rich text (bold, italic, links).</p>
  ${frameControl("Show the footer", frameCheck("Render the footer at the bottom of every funnel page", "footer.enabled"))}
  <h4>Palette &amp; typography scope</h4>
  <div class="lg-scalars">
    ${frameControl("Background", renderRoleStrip("footer.palette_scope.background"))}
    ${frameControl("Text", renderRoleStrip("footer.palette_scope.text"))}
    ${frameControl("Links", renderRoleStrip("footer.palette_scope.link"))}
  </div>
  ${frameSelect("Font family", "footer.typography_scope.font_family", THEME_RECORD_FONT_NAMES, undefined, "Independent of the main template's font.")}
  ${frameSelect("Text size", "footer.typography_scope.size", FRAME_TYPO_SIZES, { s: "Small", m: "Medium", l: "Large", xl: "Extra large" })}
  <h4>Links</h4>
  ${frameControl("Underline links", frameCheck("Underline every link in the footer", "footer.link_underline"))}
  ${frameInput("Separator between links", "footer.link_separator", "e.g.  |  — leave empty for spacing only")}
  <h4>Blocks</h4>
  <div data-tplbox-list="footer.blocks"></div>
  <template data-tplbox-tpl="footer.blocks">${renderFooterBlockRowTemplate()}</template>
  <template data-tplbox-tpl="footer_link_row">${renderFooterLinkRowTemplate()}</template>
  <template data-tplbox-tpl="footer_pick_row">${renderFooterPickRowTemplate()}</template>
  <button type="button" class="btn btn-sm btn-secondary" data-tplbox-add="footer.blocks">+ Add a footer block</button>
</div>`;
}


// 10G/Image24 (P5a commit f58f6c2) — the first-class `images` element: N
// independently-slotted placed images (mirrors free_text's per-item slot,
// NOT brand_logos' single group slot — each image authors its OWN slot/size/
// align/tooltip/page-targeting). A media source is EITHER the shared Media-
// library picker OR a direct URL (the SAME dual-shape as brand_logos items),
// PLUS an AI persona-portrait generator (P5c's POST /assets/persona-image).
//
// The persona dropdown is hardcoded to mirror api/src/ai/generators/image.ts
// LEADGEN_PERSONAS's exact 8 keys/labels — P5c exposes this set today ONLY
// inside the unknown-persona 400 response's `valid_personas` array (no GET
// endpoint); building one is a P5c-owned seam, reported rather than built.
const LEADGEN_PERSONA_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["old_person", "Older person"],
  ["young_salesman", "Young salesman"],
  ["young_woman", "Young woman"],
  ["mid_age_professional", "Mid-age professional"],
  ["friendly_advisor", "Friendly advisor"],
  ["senior_expert", "Senior expert"],
  ["casual_millennial", "Casual millennial"],
  ["warm_grandmother", "Warm grandmother"],
];

function personaOptionsMarkup(): string {
  return LEADGEN_PERSONA_OPTIONS.map(
    ([key, label]) => `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`,
  ).join("");
}

function renderImageItemRowTemplate(): string {
  return `<div class="lg-tplbox-row" data-img-item-row>
    <input type="hidden" data-img-item-id />
    <div class="lg-list-row">
      ${mediaFieldMarkup("data-list-field", "media_id", "Image (from the Media library)")}
      <input class="form-input" data-img-item-url placeholder="Or a direct image URL (https://…)" aria-label="Image URL" />
      <input class="form-input" data-img-item-alt placeholder="Alt text (required)" aria-label="Image alt text" />
      <span class="lg-row-rail">
        <button type="button" class="btn btn-sm btn-outline" data-img-item-up aria-label="Move image up">&#8593;</button>
        <button type="button" class="btn btn-sm btn-outline" data-img-item-down aria-label="Move image down">&#8595;</button>
        <button type="button" class="btn btn-sm btn-outline" data-img-item-remove aria-label="Remove image">&#10005;</button>
      </span>
    </div>
    <div class="lg-scalars">
      <div class="form-group"><label class="form-label">Slot</label><select class="form-select form-select-sm" data-img-item-slot aria-label="Image slot">${enumOptions(FRAME_FREE_TEXT_SLOTS, { above_section: "Above the section", below_section: "Below the section", above_header: "Above the header", below_footer: "Below the footer" })}</select></div>
      <div class="form-group"><label class="form-label">Size</label><select class="form-select form-select-sm" data-img-item-size aria-label="Image size">${enumOptions(FRAME_SIZES, { s: "Small", m: "Medium", l: "Large" })}</select></div>
      <div class="form-group"><label class="form-label">Alignment</label><select class="form-select form-select-sm" data-img-item-align aria-label="Image alignment">${enumOptions(FRAME_ELEMENT_ALIGNS, { left: "Left", center: "Center", right: "Right" })}</select></div>
    </div>
    <input class="form-input" data-img-item-tooltip placeholder="Hover caption (optional)" aria-label="Image hover caption" />
    ${renderPageTargetControl()}
    <div class="lg-tplbox-persona">
      <p class="form-help">Or generate an AI persona portrait (P5c, quota-guarded):</p>
      <div class="lg-list-row">
        <select class="form-select form-select-sm" data-img-item-persona aria-label="Persona">
          <option value="">Choose a persona&#8230;</option>
          ${personaOptionsMarkup()}
        </select>
        <button type="button" class="btn btn-sm btn-secondary" data-img-item-generate>Generate</button>
      </div>
      <p class="form-help lg-hidden" data-img-item-gen-error role="alert"></p>
    </div>
  </div>`;
}

function renderTplBoxImages(): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-tplbox-panel="images">
  <h3>G &middot; Images</h3>
  <p class="form-help">Individually placed images (e.g. a persona portrait), each with its own slot, size, alignment and optional hover caption.</p>
  <div data-tplbox-list="images"></div>
  <template data-tplbox-tpl="images">${renderImageItemRowTemplate()}</template>
  <button type="button" class="btn btn-sm btn-secondary" data-tplbox-add="images">+ Add an image</button>
</div>`;
}


// ---------------------------------------------------------------------------
// §8.3 NEW — Box I: Progress. Same duplicate-but-agreeing pattern as boxes
// A/B: reuses the EXACT `progress.*` frame keys the pre-existing canvas-click
// Progress region inspector (funnel.ts renderProgressInspector) already
// writes, so both surfaces always agree via the shared island's generic
// [data-frame-key] populate/write delegation — no funnel.ts edit needed.
// Unlike that inspector's flat 6-value vertical radio list, §8.3 pins a
// 5-real-style THUMBNAIL picker (bar/dots/numbered/percent/icon_on_track)
// plus a SEPARATE "Show progress bar" toggle mapping to style:'hidden' — two
// controls over the one `progress.style` enum. A hidden 6th radio (value
// "hidden") is this box's own proxy for that state (never rendered as a
// thumbnail) so the toggle only needs to flip ONE local radio, no cross-tab
// DOM reach into funnel.ts's own inspector.
// ---------------------------------------------------------------------------

// The five REAL styles, in pack order — every one of FRAME_PROGRESS_STYLES
// except "hidden" (the Show-progress-bar toggle's state, never a tile). Labels
// come from the ONE map above so the picker, the saved-template pill and the
// apply-confirm sentences can never call the same style three different things.
const PROGRESS_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = FRAME_PROGRESS_STYLES.filter(
  (s) => s !== "hidden",
).map((value) => ({ value, label: PROGRESS_STYLE_LABELS[value] }));

// A native radio input, visually hidden but focusable/tabbable, wrapped in a
// styled `<label>` — the accessible "custom radio" pattern already proven by
// funnel.ts's OWN progress-style radios (a real input, not a hand-rolled
// role="radio" div), just restyled here into the pack's horizontal thumbnail-
// card layout instead of a vertical list.
function renderProgressTypePicker(): string {
  const cards = PROGRESS_TYPE_OPTIONS.map(
    (o) => `<label class="lg-tpl2-ptype">
      <input type="radio" name="lg-progress-style" value="${escapeHtml(o.value)}" data-frame-key="progress.style" data-frame-radio="1" />
      <span class="lg-tpl2-ptype-thumb lg-tpl2-ptype-thumb--${escapeHtml(o.value)}" aria-hidden="true"></span>
      <span class="lg-tpl2-ptype-label">${escapeHtml(o.label)}</span>
    </label>`,
  ).join("");
  // The proxy "hidden" radio the Show-progress-bar toggle drives — visually
  // absent (never a 6th thumbnail), same `name` group as the 5 above so
  // native browser mutual-exclusion (and funnel.ts's OTHER 6-option list,
  // which shares this exact `name`) always agrees on which ONE is checked.
  const hiddenProxy = `<input type="radio" id="lg-tpl-progress-hidden-radio" name="lg-progress-style" value="hidden" data-frame-key="progress.style" data-frame-radio="1" class="lg-tpl2-visually-hidden" aria-hidden="true" tabindex="-1" />`;
  return `<div class="lg-tpl2-ptype-grid" id="lg-tpl-progress-types" role="radiogroup" aria-label="Progress style">${cards}</div>${hiddenProxy}`;
}

// A 2–3-way segmented control over a closed enum, `data-frame-key`-wired
// exactly like `frameSelect` (a real radio per option, same generic change
// listener) — §8.3 pins these as segmented buttons (Alignment/Thickness/
// Width) rather than the pre-existing inspector's plain `<select>`s.
function segmentedControl(
  label: string,
  key: string,
  options: ReadonlyArray<readonly [string, string]>,
  help?: string,
): string {
  const groupName = `lg-tpl-seg-${key.replace(/\./g, "-")}`;
  const items = options
    .map(
      ([value, optLabel]) =>
        `<label class="lg-tpl2-seg-item"><input type="radio" name="${escapeHtml(groupName)}" value="${escapeHtml(value)}" data-frame-key="${escapeHtml(key)}" data-frame-radio="1" /><span>${escapeHtml(optLabel)}</span></label>`,
    )
    .join("");
  return frameControl(label, `<div class="lg-tpl2-seg" role="radiogroup" aria-label="${escapeHtml(label)}">${items}</div>`, help);
}

// A checkbox restyled as a toggle switch (CSS-only presentation over the
// SAME native checkbox `data-frame-key` semantics `frameCheck` already uses —
// so populate/write/persist is the EXISTING mechanism, only the visual is
// new for this pack-pinned control).
function toggleControl(label: string, key: string, help?: string): string {
  return `<label class="lg-tpl2-toggle-row">
    <span class="lg-tpl2-toggle-copy">
      <span class="lg-tpl2-toggle-title">${escapeHtml(label)}</span>
      ${help === undefined ? "" : `<span class="lg-tpl2-toggle-help">${escapeHtml(help)}</span>`}
    </span>
    <span class="lg-tpl2-switch">
      <input type="checkbox" data-frame-key="${escapeHtml(key)}" class="lg-tpl2-switch-input" />
      <span class="lg-tpl2-switch-track" aria-hidden="true"><span class="lg-tpl2-switch-knob"></span></span>
    </span>
  </label>`;
}

// R2 P8 S4.2 — §6 M1, two of its legs land in this box:
//   * "Marker icon" used to render for all five styles. designs/frame.ts reads
//     `p.icon` inside ONE branch only (`if (p.style === "icon_on_track")`) — on
//     the other four styles the select changed a stored value that nothing
//     renders. It is now wrapped in #lg-tpl-progress-icon-row, which the island
//     shows for `icon_on_track` alone (syncProgressIconRow).
//   * "Show label" promised `"Step 2 of 5"`. The help now quotes exactly what
//     is painted, because the product now paints ONE wording: designs/frame.ts
//     SSRs `Step 1 of N` (numbered) / the ProgressBar preset's own step label
//     (bar + icon on track), and runtime/render.ts's hydration re-stamps that
//     SAME sentence instead of overwriting it with `N / M`.
//
// R2 P8 FIX ROUND F1 adds the other two M1 legs:
//   * "Marker icon" gains the operator's OWN image (frames.ts
//     FRAME_PROGRESS_ICONS "custom" + progress.icon_media_id), authored with
//     mediaPickerControl — the picker this file already uses four times. Its
//     row is shown only when the chosen mark IS an image, so the media control
//     never sits there dead (syncProgressIconMediaRow).
//   * "Show label" is HIDDEN for `numbered`. Measured: ON and OFF render
//     byte-identically for that style alone, because the numbered step label IS
//     the style (designs/frame.ts renders it unconditionally, pinned by
//     test/leadgen-frame-progress-back.test.ts). §4 R3's corollary — "A control
//     that cannot be honoured must not be offered" — so it is not offered
//     there, the same treatment "Marker icon" gets on the styles that ignore it.
function renderTplBoxProgress(): string {
  return `<div class="lg-inspector-panel lg-panel-card active" data-tplbox-panel="progress">
  <h3>I &middot; Progress</h3>
  <p class="form-help">Shows visitors how far through the funnel they are.</p>

  <div class="lg-tpl2-eyebrow">Style</div>
  ${renderProgressTypePicker()}
  <p class="form-help">5 real styles (Bar/Dots/Numbered/Percent/Icon on track) &mdash; "Hidden" is the toggle below, not a 6th style.</p>
  <div id="lg-tpl-progress-icon-row" class="lg-hidden">${frameSelect("Marker icon", "progress.icon", FRAME_PROGRESS_ICONS, {
    dot: "Plain dot",
    car: "Car",
    shield: "Shield",
    check: "Checkmark",
    star: "Star",
    site_logo: "This site's logo",
    custom: "My own image",
  }, "The mark that travels along the track.")}</div>
  <div id="lg-tpl-progress-icon-media-row" class="lg-hidden">${mediaPickerControl("Marker image", "progress.icon_media_id", "Your own image, from the Media library. Until one is chosen the marker stays a plain dot.")}</div>

  <label class="lg-tpl2-toggle-row">
    <span class="lg-tpl2-toggle-copy"><span class="lg-tpl2-toggle-title">Show progress bar</span></span>
    <span class="lg-tpl2-switch">
      <input type="checkbox" id="lg-tpl-progress-show-checkbox" class="lg-tpl2-switch-input" checked />
      <span class="lg-tpl2-switch-track" aria-hidden="true"><span class="lg-tpl2-switch-knob"></span></span>
    </span>
  </label>

  <div class="lg-tpl2-divider"></div>
  <div class="lg-tpl2-eyebrow">Design</div>
  ${frameSelect("Position", "progress.position", FRAME_PROGRESS_POSITIONS, { top: "Top of page", under_header: "Under the header", above_unit: "Above the question unit", in_card: "Inside the card" })}
  ${segmentedControl("Alignment", "progress.align", [["left", "Left"], ["center", "Center"], ["right", "Right"]] as ReadonlyArray<readonly [string, string]>, "Aligns the progress unit within its width band (defaults to Center).")}
  ${segmentedControl("Thickness", "progress.thickness", [["s", "Small"], ["m", "Medium"], ["l", "Large"]] as ReadonlyArray<readonly [string, string]>)}
  ${segmentedControl("Width", "progress.width", FRAME_PROGRESS_WIDTHS.map((w) => [w, w === "content" ? "Content width" : "Full width"] as readonly [string, string]))}
  ${frameControl("Color", renderRoleStrip("progress.color_role"))}
  <div id="lg-tpl-progress-showlabel-row">${toggleControl("Show label", "progress.show_label", 'A visitor sees "Step 2 of 5" beside the bar, or "40%" on Percent.')}</div>
  <p class="lg-region-note lg-hidden" id="lg-tpl-progress-numbered-note">Numbered steps always show the step label &mdash; that is what makes them numbered.</p>
  <p class="lg-region-note">Progress counts the sections of this funnel variant automatically.</p>
</div>`;
}


// R2 P7 (owner: "the 'J' element, I don't see it in the Quotes") — the footer
// tile is lettered **J** and sits LAST, in its own group.
//
// Why this exact treatment, given two owner-verbatim letter anchors that cannot
// both be contiguous:
//   * SOURCE-OF-TRUTH A.2 — "Add a bottom of the page template management …
//     this is seperate template element …" → new Funnel-Layout Element "J".
//   * SOURCE-OF-TRUTH A.1 item 11.D — "Add a 'I' 'funnel layout element' -
//     progress bar" → Progress is "I", and re-lettering it would break the
//     owner's OTHER anchor.
// Nine tiles cannot fill A..J (ten slots), so EXACTLY ONE letter is unused no
// matter what. The owner never said "G"; they said the footer is "J".
//
// R2 P8 FIX ROUND F1 (§7 N9 — "Element letters skip G … the owner noticed"):
// WHICH letter is vacant is the part that was decided badly. The run used to be
// A B C D E F H I J, so the gap fell in the middle of the contiguous block and
// the list read like a mistake. The owner's two pins (Progress = I, A.1 #11.D;
// Footer = J, A.2) fix the last two letters and nothing else, so the sensible
// placement is contiguous-then-pinned: Images moves H -> G, giving
// A B C D E F G · I · J. The gap is now forced to H by the owner's own pins,
// which is the only place it can be without moving a letter they named.
// The tile also MOVES to the end and renders under its own "Bottom of the page"
// group heading, so the screen reads the way A.2 describes it: a *separate*
// template element that comes after the others.
//
// §5.4 invariant: still EXACTLY ONE footer-keyed entry in this array — the
// array-entry literal is grep-asserted (count === 1) by
// test/leadgen-element-j-r2.test.ts, so do not repeat that literal anywhere
// in this file, comments included.
const TPLBOX_CARDS: ReadonlyArray<{ key: string; letter: string; label: string }> = [
  { key: "background", letter: "A", label: "Background" },
  { key: "logo", letter: "B", label: "Logo" },
  { key: "cta", letter: "C", label: "Phone / URL" },
  { key: "disclosure", letter: "D", label: "Disclosure" },
  { key: "free_text", letter: "E", label: "Free text" },
  { key: "brand_logos", letter: "F", label: "Brand logos" },
  { key: "images", letter: "G", label: "Images" },
  { key: "progress", letter: "I", label: "Progress" },
  { key: "footer", letter: "J", label: "Footer" },
];

// The one tile A.2 calls a "seperate template element" — rendered in its own
// group below the in-page elements rather than inline with them.
const TPLBOX_SEPARATE_KEY = "footer";


// ---------------------------------------------------------------------------
// §8.3 layout — LEFT elements list (292px). "Progress" (I) is pre-selected on
// load (matching the pack's Pin 1), so the settings column starts non-empty.
// ---------------------------------------------------------------------------

function tplBoxCard(c: { key: string; letter: string; label: string }): string {
  return `<button type="button" class="lg-tplbox-card${c.key === "progress" ? " selected" : ""}" data-tplbox-pick="${escapeHtml(c.key)}">
    <span class="lg-tplbox-card-letter">${escapeHtml(c.letter)}</span>
    <span>${escapeHtml(c.label)}</span>
  </button>`;
}

function renderElementsList(): string {
  // R2 P7: the in-page elements first, then A.2's "seperate template element"
  // (J · Footer) under its own heading so the separation is on the screen and
  // not only in the letter.
  // R2 P7 D3 (owner: "why you left comments to yourself on the UI????") — the
  // heading and help below used to quote the contract at the operator
  // ("separate template element", "independent of the main template"). The
  // grouping is unchanged; only the words are now product copy.
  const inPage = TPLBOX_CARDS.filter((c) => c.key !== TPLBOX_SEPARATE_KEY).map(tplBoxCard).join("");
  const separate = TPLBOX_CARDS.filter((c) => c.key === TPLBOX_SEPARATE_KEY).map(tplBoxCard).join("");
  return `<div class="lg-tpl2-eyebrow">Funnel-layout elements</div>
  <div class="lg-tplbox-grid" id="lg-tplbox-grid">${inPage}</div>
  <div class="lg-tpl2-divider"></div>
  <div class="lg-tpl2-eyebrow">Page footer</div>
  <div class="lg-tplbox-grid lg-tplbox-grid-separate" id="lg-tplbox-grid-separate">${separate}</div>
  <p class="form-help">Sits at the bottom of every page and keeps its own colours, fonts and sizes.</p>`;
}


function renderSettingsColumn(answerFields: readonly QuoteRulesRailAnswerField[]): string {
  return `<div class="lg-tplbox-editor" id="lg-tplbox-editor">
    <p class="form-help" id="lg-tplbox-hint" hidden>Choose a box above to edit it.</p>
    ${renderTplBoxBackground()}
    ${renderTplBoxLogo()}
    ${renderTplBoxCta(answerFields)}
    ${renderTplBoxDisclosure()}
    ${renderTplBoxFreeText()}
    ${renderTplBoxBrandLogos()}
    ${renderTplBoxImages()}
    ${renderTplBoxProgress()}
    ${renderTplBoxFooter()}
  </div>`;
}


// ---------------------------------------------------------------------------
// §8.3 CENTER — live canvas. Toolbar (theme switcher + a route to the Themes
// tab + section picker + preview-site select) and a server-rendered
// srcdoc iframe, populated entirely by the inline script below through the
// ONE preview endpoint (POST /variants/:id/preview — see the top-of-file doc
// comment for why this can't reuse funnel.ts's private `renderPreview`/
// `schedulePreview` closures).
//
// R2 P8 S4.2 (§6 M9.5 / I5 — no copy names a place that does not exist): the
// toolbar button read "+ New theme…" with title "Create a theme in the Themes
// tab", but a theme RECORD is created only by the standalone Themes manager
// (ui-theme-manager.ts:1471 POSTs /api/admin/leadgen/themes; the quote
// editor's Themes tab has no create call at all — it designs THIS funnel's
// theme and links out with "Manage all presets →"). The button's click target
// is unchanged (it opens the Themes tab, which is where it has always gone,
// and test/leadgen-templates-canvas-r2.test.ts:651 pins that line); only the
// two strings that mis-described it are now true. The empty-list option in
// populateThemeSwitcher points at the manager, matching quotes-tabs/themes.ts's
// own "…from the Themes manager…" register.
// ---------------------------------------------------------------------------

function renderCanvas(): string {
  return `<div class="lg-tpl2-canvas-shell">
    <div class="lg-tpl2-canvas-toolbar" id="lg-tpl-canvas-toolbar">
      <select class="form-select form-select-sm" id="lg-tpl-theme-select" aria-label="Theme switcher" style="max-width:180px">
        <option value="">Current theme</option>
      </select>
      <button type="button" class="btn btn-sm btn-outline" id="lg-tpl-theme-create" title="Open the Themes tab to design this funnel's theme">Themes tab &#8594;</button>
      <select class="form-select form-select-sm" id="lg-tpl-section-select" aria-label="Section picker" style="max-width:240px">
        <option value="">Loading sections&#8230;</option>
      </select>
      <select class="form-select form-select-sm" id="lg-tpl-site-select" data-site-select aria-label="Preview site" style="max-width:220px;margin-left:auto">
        <option value="">CMS fallback branding</option>
      </select>
    </div>
    <div class="lg-tpl2-canvas-surface">
      <iframe id="lg-tpl-canvas-iframe" class="lg-tpl2-canvas-iframe" title="Templates live preview" sandbox="allow-same-origin"></iframe>
    </div>
    <p class="form-help" id="lg-tpl-canvas-status" role="status"></p>
  </div>`;
}


// ---------------------------------------------------------------------------
// §8.3 template bar — saved DB-backed templates (M5 `leadgen_frame_templates`,
// CRUD already shipped in frame-handlers.ts/P1): create / save-as / rename /
// duplicate / delete-with-in-use-guard (rendering the SERVER's real 409
// `error` + `in_use` referrers — never a hand-authored guard string), ONE
// Default toggle (atomic swap, PUT .../default), "Apply to funnel…" and
// "A/B templates…". All state is fetched/rendered client-side — see the
// inline script.
// ---------------------------------------------------------------------------

function renderTemplateBar(): string {
  // P8-1 F1 (B3/R6-1 round 2): this panel says WHICH funnel it is editing and
  // lets the operator change it. Name + options are filled by TPL_SCRIPT from
  // the board's own #lg-board-data funnel rows (no new endpoint; this
  // function's signature is fixed by its renderTemplatesTabPanel call site).
  // Copy mirrors quotes-tabs/shared.ts's own scopeHead sentence.
  return `<div class="lg-panel-card" id="lg-tpl-bar">
  <div class="lg-scope-head">Editing: <strong id="lg-tpl-target-name" data-lg-target-funnel-name>this funnel</strong> · Funnel layout template · affects every section of this funnel<select class="form-select form-select-sm" id="lg-tpl-target-select" data-lg-target-funnel aria-label="Funnel this template edits" style="margin-left:8px;max-width:200px;vertical-align:middle"></select></div>
  <div class="lg-tpl2-bar-row">
    <span class="lg-tpl2-eyebrow">Saved templates</span>
    <div id="lg-tpl-list" class="lg-tpl2-chip-row"><span class="form-help">Loading templates&#8230;</span></div>
    <button type="button" class="btn btn-outline btn-sm" id="lg-tpl-new-btn">+ New template</button>
  </div>
  <div class="lg-tpl2-bar-row lg-tpl2-new-form lg-hidden" id="lg-tpl-new-form">
    <input class="form-input" id="lg-tpl-new-name" placeholder="Template name" aria-label="New template name" maxlength="60" />
    <button type="button" class="btn btn-sm btn-primary" id="lg-tpl-new-save">Create</button>
    <button type="button" class="btn btn-sm btn-outline" id="lg-tpl-new-cancel">Cancel</button>
  </div>
  <div class="lg-tpl2-bar-row">
    <button type="button" class="btn btn-secondary btn-sm" id="lg-tpl-apply-btn">Apply to funnel&#8230;</button>
    <button type="button" class="btn btn-secondary btn-sm" id="lg-tpl-ab-btn">A/B templates&#8230;</button>
  </div>
  <p class="alert alert-error lg-hidden" id="lg-tpl-delete-guard" role="alert"></p>
  <p class="alert alert-error lg-hidden" id="lg-tpl-bar-error" role="alert"></p>
</div>`;
}


// ---------------------------------------------------------------------------
// §8.3 "Apply to funnel…" — two states (choose / confirm), 1:1 with the
// pre-existing preview-before-apply + region-naming-confirmation flow
// (renderTemplatePicker's canvas-embedded picker keeps that EXACT flow for
// the 6 code-registry arrangements — untouched, out of this slice); this
// dialog is the SAME shape over the NEW saved (DB) templates + the M5
// `POST /funnels/:id/apply-template` {template_id} persistence route.
// ---------------------------------------------------------------------------

function renderApplyDialog(): string {
  return `<div class="lg-tpl2-dialog-overlay lg-hidden" id="lg-tpl-apply-dialog" role="dialog" aria-modal="true" aria-label="Apply a template to this funnel">
  <div class="lg-tpl2-dialog-panel">
    <div data-apply-state="choose">
      <h3>Funnel layout template</h3>
      <p class="form-help">Your copy, images and colors are kept. Layout comes from the template. Nothing changes until you confirm.</p>
      <div id="lg-tpl-apply-choices" class="lg-tpl2-apply-grid"></div>
    </div>
    <div class="lg-hidden" data-apply-state="confirm">
      <h3>Before you switch</h3>
      <ul id="lg-tpl-apply-confirm-list"></ul>
      <div class="toolbar">
        <button type="button" class="btn btn-primary" id="lg-tpl-apply-confirm-btn">Switch template</button>
        <button type="button" class="btn btn-outline" id="lg-tpl-apply-back-btn">Back</button>
      </div>
    </div>
    <p class="alert alert-error lg-hidden" id="lg-tpl-apply-error" role="alert"></p>
    <div class="toolbar"><button type="button" class="btn btn-outline" id="lg-tpl-apply-cancel-btn">Cancel</button></div>
  </div>
</div>`;
}


// §4.3-10/M5 — "A/B templates…": forks the currently-edited variant (the
// existing fork mechanism) and sets the NEW arm's frame_template_id to a
// DIFFERENT chosen saved template (M5's per-variant override axis) — the
// same "whole-quote template-level testing" reframe the A/B tab (ab.ts)
// already describes, scoped here to templates specifically.
function renderAbTemplatesDialog(): string {
  return `<div class="lg-tpl2-dialog-overlay lg-hidden" id="lg-tpl-ab-dialog" role="dialog" aria-modal="true" aria-label="A/B test templates">
  <div class="lg-tpl2-dialog-panel">
    <h3>A/B templates</h3>
    <p class="form-help">Forks the current variant into a new arm using a DIFFERENT saved template — the A/B tab manages the traffic split afterward.</p>
    <div class="form-group">
      <label class="form-label" for="lg-tpl-ab-template-select">New arm's template</label>
      <select class="form-select" id="lg-tpl-ab-template-select" aria-label="Template for the new arm"></select>
      <p class="form-help" id="lg-tpl-ab-effect" role="status"></p>
    </div>
    <p class="alert alert-error lg-hidden" id="lg-tpl-ab-error" role="alert"></p>
    <div class="toolbar">
      <button type="button" class="btn btn-primary" id="lg-tpl-ab-confirm-btn">Create A/B arm</button>
      <button type="button" class="btn btn-outline" id="lg-tpl-ab-cancel-btn">Cancel</button>
    </div>
  </div>
</div>`;
}


// ---------------------------------------------------------------------------
// Styles (inline — this file cannot add to shared.ts's LG_QUOTES_STYLES
// export, out of this slice; a `<style>` tag anywhere in the document applies
// globally regardless of its containing element's own display state, so this
// is safe even though it physically sits inside the initially-inactive
// `.lg-qpanel[data-panel="templates"]`). New classes are `lg-tpl2-*`-prefixed
// throughout to avoid any collision with the pre-existing `.lg-tplbox-*`/
// `.lg-template-*` vocabulary this file and funnel.ts both still use.
// ---------------------------------------------------------------------------

const TPL_STYLES = `
.lg-tpl2-eyebrow{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--c-muted);margin:10px 0 8px}
.lg-tpl2-shell{display:flex;gap:12px;align-items:flex-start;min-height:520px}
.lg-tpl2-left{flex:0 0 292px;min-width:0}
.lg-tpl2-center{flex:1 1 auto;min-width:0;background:var(--c-bg,#f6f7f9);border:1px solid var(--c-border);border-radius:8px;display:flex;flex-direction:column;overflow:hidden}
.lg-tpl2-right{flex:0 0 344px;min-width:0}
@media (max-width:1100px){.lg-tpl2-shell{flex-direction:column}.lg-tpl2-left,.lg-tpl2-right{flex:1 1 auto}}
.lg-tpl2-canvas-shell{display:flex;flex-direction:column;height:100%}
.lg-tpl2-canvas-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px;border-bottom:1px solid var(--c-border);background:var(--c-card,#fff)}
.lg-tpl2-canvas-surface{flex:1 1 auto;overflow:auto;padding:20px;display:flex;justify-content:center}
.lg-tpl2-canvas-iframe{width:600px;max-width:100%;min-height:520px;border:0;background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(16,24,40,.12)}
.lg-tpl2-bar-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.lg-tpl2-chip-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1 1 auto}
.lg-tpl2-tpl-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--c-border);border-radius:20px;padding:4px 10px;font-size:12px;background:var(--c-card,#fff);position:relative}
.lg-tpl2-tpl-chip.is-default{border-color:var(--c-primary,#1B3A5C)}
.lg-tpl2-tpl-chip-default-badge{font-size:9px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;background:var(--c-primary,#1B3A5C);color:#fff;border-radius:10px;padding:1px 6px}
.lg-tpl2-tpl-chip button{background:none;border:0;cursor:pointer;color:var(--c-muted);font-size:11px;padding:0 2px}
/* R2 P8 F1 (M10): the saved template's real band picture, sized for the chip.
   The bands themselves keep the shared .lg-tpl-thumb/.lg-tpl-band vocabulary
   (quotes-tabs/shared.ts) — only the chip-scale geometry is overridden here. */
.lg-tpl2-tpl-chip .lg-tpl-thumb{width:24px;min-height:18px;padding:2px;gap:1px;border-radius:3px;flex:none}
.lg-tpl2-tpl-chip .lg-tpl-band{height:2px;border-radius:1px}
.lg-tpl2-tpl-chip .lg-tpl-slot{height:6px}
.lg-tpl2-tpl-menu{position:absolute;top:100%;left:0;z-index:5;background:var(--c-card,#fff);border:1px solid var(--c-border);border-radius:6px;box-shadow:0 4px 14px rgba(16,24,40,.16);padding:4px;display:flex;flex-direction:column;min-width:140px;margin-top:4px}
.lg-tpl2-tpl-menu button{display:block;width:100%;text-align:left;padding:6px 8px;font-size:12px;color:var(--c-text);white-space:nowrap}
.lg-tpl2-tpl-menu button:hover{background:var(--c-bg,#f6f7f9)}
.lg-tpl2-new-form{align-items:center}
.lg-tpl2-ptype-grid{display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap}
.lg-tpl2-ptype{display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 6px;border:1px solid var(--c-border);border-radius:8px;background:var(--c-card,#fff);flex:1 1 0;min-width:56px;cursor:pointer;position:relative}
.lg-tpl2-ptype input{position:absolute;opacity:0;width:100%;height:100%;top:0;left:0;margin:0;cursor:pointer}
.lg-tpl2-ptype.active{border-color:var(--c-primary,#1B3A5C);border-width:2px;background:var(--c-bg,#f6f7f9)}
.lg-tpl2-ptype-thumb{width:32px;height:14px;border-radius:3px;background:var(--c-border);display:block;position:relative;overflow:visible}
/* R2 P7 (ADJ-N23: a picker must LOOK like what it produces) — each thumbnail
   is a miniature of that style's real render: bar = a solid 60% fill; percent =
   the same fill CANDY-STRIPED (styles.ts .lg-frame-progress--percent); dots =
   three empty pills; numbered = three ringed badges over a caption line;
   icon on track = the fill plus the round marker riding its edge. */
.lg-tpl2-ptype-thumb--bar{background:linear-gradient(to right,var(--c-primary,#1B3A5C) 0 60%,var(--c-border) 60% 100%)}
.lg-tpl2-ptype-thumb--percent{background:linear-gradient(to right,var(--c-primary,#1B3A5C) 0 60%,var(--c-border) 60% 100%);background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.55) 0 3px,rgba(255,255,255,0) 3px 6px),linear-gradient(to right,var(--c-primary,#1B3A5C) 0 60%,var(--c-border) 60% 100%);box-shadow:inset 0 0 0 1px var(--c-muted)}
.lg-tpl2-ptype-thumb--dots{background:transparent;background-image:radial-gradient(circle 4px at 6px 7px,var(--c-primary,#1B3A5C) 98%,transparent 100%),radial-gradient(circle 4px at 16px 7px,var(--c-border) 98%,transparent 100%),radial-gradient(circle 4px at 26px 7px,var(--c-border) 98%,transparent 100%)}
.lg-tpl2-ptype-thumb--numbered{background:transparent;background-image:radial-gradient(circle 5px at 6px 5px,var(--c-primary,#1B3A5C) 98%,transparent 100%),radial-gradient(circle 5px at 16px 5px,transparent 55%,var(--c-muted) 60% 98%,transparent 100%),radial-gradient(circle 5px at 26px 5px,transparent 55%,var(--c-muted) 60% 98%,transparent 100%),linear-gradient(to right,var(--c-border) 0 100%);background-repeat:no-repeat;background-size:100% 12px,100% 12px,100% 12px,20px 2px;background-position:0 0,0 0,0 0,6px 13px}
.lg-tpl2-ptype-thumb--icon_on_track{background:linear-gradient(to right,var(--c-primary,#1B3A5C) 0 60%,var(--c-border) 60% 100%)}
.lg-tpl2-ptype-thumb--icon_on_track::after{content:"";position:absolute;left:60%;top:50%;width:12px;height:12px;transform:translate(-50%,-50%);border-radius:50%;background:var(--c-primary-dark,#123);border:2px solid #fff;box-shadow:0 1px 2px rgba(16,24,40,.25)}
.lg-tpl2-ptype-label{font-size:10px;font-weight:700;text-align:center;color:var(--c-text)}
.lg-tpl2-visually-hidden{position:absolute !important;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
.lg-tpl2-seg{display:inline-flex;border:1px solid var(--c-border);border-radius:8px;overflow:hidden;width:100%}
.lg-tpl2-seg-item{flex:1;text-align:center;font-size:12px;font-weight:600;padding:7px 6px;cursor:pointer;position:relative;color:var(--c-muted);border-left:1px solid var(--c-border)}
.lg-tpl2-seg-item:first-child{border-left:0}
.lg-tpl2-seg-item input{position:absolute;opacity:0;width:100%;height:100%;top:0;left:0;margin:0;cursor:pointer}
.lg-tpl2-seg-item.active{background:var(--c-primary,#1B3A5C);color:#fff}
.lg-tpl2-divider{height:1px;background:var(--c-border);margin:12px 0}
.lg-tpl2-toggle-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:6px 0}
.lg-tpl2-toggle-title{font-size:13px;font-weight:600;color:var(--c-text);display:block}
.lg-tpl2-toggle-help{font-size:11px;color:var(--c-muted);display:block}
.lg-tpl2-switch{position:relative;display:inline-block;flex:0 0 auto}
.lg-tpl2-switch-input{position:absolute;opacity:0;width:38px;height:22px;margin:0;cursor:pointer;z-index:1}
.lg-tpl2-switch-track{display:inline-block;width:38px;height:22px;border-radius:20px;background:#CBD3DF;position:relative;transition:background .12s}
.lg-tpl2-switch-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.25);transition:left .12s}
.lg-tpl2-switch-input:checked + .lg-tpl2-switch-track{background:var(--c-primary,#1B3A5C)}
.lg-tpl2-switch-input:checked + .lg-tpl2-switch-track .lg-tpl2-switch-knob{left:18px}
.lg-tpl2-dialog-overlay{position:fixed;top:0;right:0;bottom:0;left:0;background:rgba(15,23,42,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:24px}
.lg-tpl2-dialog-panel{background:var(--c-card,#fff);border-radius:10px;max-width:640px;width:100%;max-height:85vh;overflow:auto;padding:20px}
.lg-tpl2-apply-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:10px}
.lg-tpl2-apply-card{border:1px solid var(--c-border);border-radius:8px;padding:10px;text-align:left;background:var(--c-card,#fff);cursor:pointer}
.lg-tpl2-apply-card:hover,.lg-tpl2-apply-card:focus{border-color:var(--c-primary,#1B3A5C)}
.lg-tpl2-apply-card .lg-tpl2-apply-name{font-weight:700;font-size:13px;display:block;margin-bottom:2px}
.lg-tpl2-apply-card .lg-tpl2-apply-summary{font-size:11px;color:var(--c-muted)}
/* shared.ts's LG_QUOTES_STYLES defines the base .lg-hidden rule (display:
   none, equal specificity, single class); several rules above ALSO set a
   display value on elements that carry lg-hidden (the two dialog overlays,
   the new-template-form bar-row) via an equal-specificity single-class
   selector of their own — a same-specificity tie resolves by SOURCE ORDER,
   and this style block is emitted after LG_QUOTES_STYLES, so without this
   re-assertion those earlier display:flex rules would win and the "hidden"
   dialogs would render interactive/blocking. Re-declaring the exact base
   rule LAST here (not a compound override per element) is the simplest fix
   that also covers any future lg-tpl2- prefixed class this file adds. */
.lg-hidden{display:none}
`;


// ---------------------------------------------------------------------------
// Inline script (this file's own island — see top-of-file doc comment for
// why it cannot live in the shared QUOTE_EDITOR_SCRIPT). Strict ES5 (L-185):
// var/function only, string concatenation, no template literals. Deferred to
// DOMContentLoaded so `#lg-quote-data` (emitted by ui-quotes.ts AFTER every
// tab panel) is guaranteed present. Every fetch below targets an
// ALREADY-SHIPPED endpoint — see the top-of-file doc comment's inventory.
//
// R2 P3 tail-2 (item 2): fetchFooterPicks + its data-footer-picks-load click
// delegate (below) are THIS island's alone — funnel.ts's QUOTE_EDITOR_SCRIPT
// reads/writes the SAME footer.blocks DOM (its own "G" section, a documented
// byte-mirrored twin of this file's collectFooterBlocks/collectFooterPickRows)
// but ships no fetch handler for this button; it depends on THIS script
// shipping on the same page. That is guaranteed by construction, not by load
// order — ui-quotes.ts always concatenates renderBuilderPanel(...) (funnel.ts)
// and renderTemplatesTabPanel(...) (this function, which embeds TPL_SCRIPT
// inline) into ONE synchronous response — see funnel.ts's own note above its
// QUOTE_EDITOR_SCRIPT declaration, and
// test/leadgen-p3-fixround-footer-picker-coupling.test.ts, which fails if
// either half of that pairing disappears.
// ---------------------------------------------------------------------------

const TPL_SCRIPT = `
(function () {
  'use strict';
  var LG_API = '/api/admin/leadgen';
  // R2 P7 D1 — the plain-words replacement for a logo image the browser could
  // not load (see watchCanvasLogo below). Interpolated from the ONE server
  // constant so the canvas and frame.ts can never drift apart.
  var LOGO_UNREACHABLE_TEXT = ${JSON.stringify(LOGO_UNREACHABLE_CANVAS_TEXT)};
  // R2 P8 S4.2 — the SAME operator words the Style tiles show (one vocabulary
  // per thing), interpolated from the one server map so the pill, the
  // apply-confirm sentences and the tiles cannot drift.
  var PROGRESS_LABELS = ${JSON.stringify(PROGRESS_STYLE_LABELS)};
  function progressStyleLabel(v) {
    return (v !== null && v !== undefined && PROGRESS_LABELS[v]) ? PROGRESS_LABELS[v] : String(v);
  }
  var boot = null;
  var templates = [];
  // R2 D5 (contract §7 D5): this quote's PER-QUOTE default template override
  // (leadgen_quote_default_template, migration 0055) — its public_id, or ''
  // when unset (falls back to the global default). Loaded from GET
  // /quotes/:id (quoteDetailJson's default_template_id) alongside loadTemplates.
  var myQuoteDefaultTemplateId = '';
  var myFrame = {};
  var myDraftThemeId = '';
  var mySiteId = '';
  var arraysArmed = false;
  var lastRealProgressStyle = 'bar';
  var previewSeq = 0;
  var currentSections = [];
  // P8-1 F1 (B3/R6-1, round 2): WHICH funnel this panel edits lives in the
  // page URL's hash (tab=<name>&funnel=<public id>), set by a board Template
  // chip click (quotes-tabs/funnel.ts) or by this panel's own funnel picker,
  // and read HERE at each action, never cached. Round 1 used a transient
  // data-carried-funnel-public-id attribute on #lg-quote-editor that the plain
  // tab-click listener wiped, so one tab round-trip silently retargeted the
  // editor's own funnel. The hash survives tab navigation, a reload and
  // repeated chip clicks; this island is a separate closure from both other
  // islands, so a shared page-level channel is the only way across.
  // window.location is read defensively (the ES5 island-probe harnesses stub
  // window with timers only).
  function lgHashParam(name) {
    var loc = (typeof window === 'undefined' || !window) ? null : window.location;
    var h = (loc && loc.hash) ? String(loc.hash) : '';
    var m = h.match(new RegExp('[#&]' + name + '=([^&]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function lgSetHashParam(name, value) {
    var loc = (typeof window === 'undefined' || !window) ? null : window.location;
    if (!loc) { return; }
    var tab = name === 'tab' ? value : lgHashParam('tab');
    var funnel = name === 'funnel' ? value : lgHashParam('funnel');
    var parts = [];
    if (tab) { parts.push('tab=' + encodeURIComponent(tab)); }
    if (funnel) { parts.push('funnel=' + encodeURIComponent(funnel)); }
    var hash = parts.length > 0 ? '#' + parts.join('&') : '';
    var hist = window.history;
    if (hist && hist.replaceState) { hist.replaceState(null, '', (loc.pathname || '') + (loc.search || '') + hash); return; }
    loc.hash = hash;
  }
  // The board's own funnel rows — the SAME list the board columns render,
  // already on this page as #lg-board-data (quotes-tabs/funnel.ts's
  // boardDataBlob, emitted before this panel). No new endpoint.
  function boardFunnels() {
    var el = document.getElementById('lg-board-data');
    var raw = el ? (el.textContent || el.innerText || '') : '';
    if (!raw) { return []; }
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) { return []; }
    return (parsed && parsed.funnels) ? parsed.funnels : [];
  }
  function boardFunnelBy(pub) {
    var fs = boardFunnels();
    var i;
    for (i = 0; i < fs.length; i++) { if (fs[i].public_id === pub) { return fs[i]; } }
    return null;
  }
  function targetFunnelPublicId() {
    // A chosen funnel the board no longer has resolves back to the editor
    // default rather than editing blind.
    var picked = lgHashParam('funnel');
    if (picked !== '' && boardFunnelBy(picked) !== null) { return picked; }
    return boot ? boot.funnel_public_id : '';
  }
  function targetVariantPublicId() {
    var picked = targetFunnelPublicId();
    var bootFunnel = boot ? boot.funnel_public_id : '';
    var bootVariant = boot ? boot.selected_variant : '';
    if (picked === bootFunnel) { return bootVariant; }
    var f = boardFunnelBy(picked);
    return (f && f.active_variant_public_id) ? f.active_variant_public_id : bootVariant;
  }
  function targetFunnelName() {
    var f = boardFunnelBy(targetFunnelPublicId());
    return (f && f.name) ? String(f.name) : '';
  }

  function byId(id) { return document.getElementById(id); }
  function toArray(nodeList) { return Array.prototype.slice.call(nodeList); }
  function clearChildren(el) { while (el && el.firstChild) { el.removeChild(el.firstChild); } }
  function text(s) { return document.createTextNode(s === null || s === undefined ? '' : String(s)); }
  function isRecord(v) { return v !== null && typeof v === 'object' && !(v instanceof Array); }

  function getPath(obj, path) {
    var parts = path.split('.');
    var cur = obj;
    var i;
    for (i = 0; i < parts.length; i++) {
      if (!isRecord(cur)) { return undefined; }
      cur = cur[parts[i]];
    }
    return cur;
  }
  function setPath(obj, path, value) {
    var parts = path.split('.');
    var cur = obj;
    var i;
    for (i = 0; i < parts.length - 1; i++) {
      if (!isRecord(cur[parts[i]])) { cur[parts[i]] = {}; }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
  function deepClone(v) { return v === null || v === undefined ? v : JSON.parse(JSON.stringify(v)); }

  function fetchJson(url, opts) {
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
    });
  }

  function showError(id, msg) {
    var el = byId(id);
    if (!el) { return; }
    clearChildren(el);
    el.appendChild(text(msg));
    el.className = el.className.replace(/\\s*lg-hidden/g, '');
  }
  function hideError(id) {
    var el = byId(id);
    if (!el) { return; }
    if (el.className.indexOf('lg-hidden') < 0) { el.className = el.className + ' lg-hidden'; }
  }

  // --- boot state -------------------------------------------------------
  function loadBoot() {
    var el = byId('lg-quote-data');
    if (!el) { return null; }
    try { return JSON.parse(el.textContent || el.innerText || '{}'); } catch (e) { return null; }
  }

  // --- canvas: POST /variants/:id/preview (mode:section, draft_frame_config,
  // draft_theme, section_public_id) — mirrors quotes-tabs/funnel.ts's
  // renderPreview/schedulePreview SHAPE (debounce + monotonic seq guard
  // against out-of-order responses), a fresh implementation since that
  // island's closures are not reachable from here. -----------------------
  function setCanvasDoc(bodyHtml, css) {
    var frame = byId('lg-tpl-canvas-iframe');
    if (!frame) { return; }
    var doc = '<!doctype html><html><head><meta charset="utf-8"><style>' + (css || '') + '</style></head><body>' + (bodyHtml || '') + '</body></html>';
    frame.setAttribute('srcdoc', doc);
    watchCanvasLogo(frame);
  }

  // R2 P7 D1 (owner SRC-11A: "I chose a site - why I don't see its logo????").
  // Measured cause: the site's stored logo reference is resolved by the SERVER
  // into <img class="lg-logo-img" src="/media/..."> with no way to know, at
  // render time, whether that asset still exists. When it does not (a deleted
  // or re-keyed media row) the browser collapses the <img> to its alt text —
  // a ~143x18 sliver, "at most a tiny mark where the logo belongs", with no
  // explanation at all. Activation state is NOT involved: an activated and a
  // not-activated site with the same logo render byte-identically.
  //
  // The canvas is a sandboxed srcdoc iframe with scripting OFF, so nothing
  // inside the document can react to the load failure; the ADMIN page can
  // (sandbox="allow-same-origin" keeps contentDocument reachable). On a broken
  // load we swap in the SAME plain-words chip the no-logo ladder already
  // renders (frame.ts LOGO_FALLBACK_CHIP_TEXT), so the operator reads why the
  // logo is missing instead of squinting at a sliver.
  function replaceBrokenLogo(img) {
    if (!img || img.getAttribute('data-logo-broken') === '1') { return; }
    img.setAttribute('data-logo-broken', '1');
    var doc = img.ownerDocument;
    var chip = doc.createElement('span');
    chip.className = 'lg-frame-logo-fallback';
    chip.setAttribute('data-logo-unreachable', '1');
    chip.setAttribute('style', 'display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#5A6470;background:#F6F8FB;border:1px dashed #E1E6EE;border-radius:20px;padding:7px 14px');
    chip.appendChild(doc.createTextNode(LOGO_UNREACHABLE_TEXT));
    if (img.parentNode) { img.parentNode.replaceChild(chip, img); }
  }
  function checkCanvasLogos(idoc) {
    if (!idoc) { return; }
    var imgs = idoc.querySelectorAll ? idoc.querySelectorAll('img.lg-logo-img') : [];
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      // complete && naturalWidth === 0 is the browser's own "this load failed"
      // state; a still-loading image is re-checked by the img's error handler.
      if (img.complete && img.naturalWidth === 0) { replaceBrokenLogo(img); }
      else if (!img.complete) { armLogoErrorHandler(img); }
    }
  }
  function armLogoErrorHandler(img) {
    if (img.getAttribute('data-logo-armed') === '1') { return; }
    img.setAttribute('data-logo-armed', '1');
    img.onerror = function () { replaceBrokenLogo(img); };
  }
  function watchCanvasLogo(frame) {
    var run = function () {
      var idoc = null;
      try { idoc = frame.contentDocument; } catch (e) { idoc = null; }
      checkCanvasLogos(idoc);
    };
    frame.onload = run;
    // srcdoc can already be parsed when a re-render reuses the same document;
    // one deferred pass covers that race without polling.
    window.setTimeout(run, 250);
  }

  // R2 §3 ② (R6): ONE status sink, the REAL id (#lg-tpl-canvas-status). The
  // pre-R2 no-sections error leg wrote an EMPTY message to an id that does
  // not exist in this panel, so a failed render left a blank canvas with no
  // explanation at all.
  function canvasStatus(msg) {
    var el = byId('lg-tpl-canvas-status');
    if (!el) { return; }
    clearChildren(el);
    if (msg) { el.appendChild(text(msg)); }
  }

  function currentEffectiveFrameForDraft() {
    var d = deepClone(myFrame) || {};
    if (d.template === undefined && boot && boot.frame && boot.frame.effective_frame) { d.template = boot.frame.effective_frame.template; }
    // R2 §3 ② — the ARRAY-shaped elements (C cta_slots / D disclosure.entries /
    // E free_text / F brand_logos / G footer.blocks / H images) live in the
    // box editors' DOM rows, not in any scalar [data-frame-key]; before this
    // they reached the canvas only after Save. Once the operator has touched
    // the Templates panel we re-read them straight from those rows on every
    // render, so each edit shows up in the canvas live.
    if (arraysArmed) { overlayListGroups(d); }
    overlayHiddenFrameKeys(d);
    d.version = 1;
    return d;
  }
  function currentDraftTheme() {
    if (myDraftThemeId === '') { return undefined; }
    return { theme_id: myDraftThemeId };
  }

  // R2 §3 ② — ONE preview path for EVERY funnel: the draft-aware composed
  // endpoint (POST /variants/:id/preview). An EMPTY funnel no longer detours
  // to the section-only endpoint (a bare, frameless sample card that
  // reflected NO frame edit) — it asks this same endpoint for the sample
  // section INSIDE the real frame with sample_section:true.
  function renderCanvasPreview() {
    // P8-1 S1.6 (B3/R6-1): target the carried variant when a Template chip
    // click set one, the editor-default otherwise.
    var targetVariant = targetVariantPublicId();
    if (!boot || !targetVariant) { return; }
    var sectionSelect = byId('lg-tpl-section-select');
    var sectionPublicId = sectionSelect ? sectionSelect.value : '';
    var noSections = currentSections.length === 0;
    var seq = ++previewSeq;
    var body = {
      mode: 'section',
      viewport: 'desktop',
      draft_frame_config: currentEffectiveFrameForDraft()
    };
    var draftTheme = currentDraftTheme();
    if (draftTheme !== undefined) { body.draft_theme = draftTheme; }
    if (!noSections && sectionPublicId) { body.section_public_id = sectionPublicId; }
    if (noSections) { body.sample_section = true; }
    // R5: the site whose branding the canvas renders under — WITHOUT this the
    // server resolves no SiteBranding and an authored site logo can never
    // appear (#11A "I chose a site - why I don't see its logo????"). The
    // funnel builder's canvas already sends it (funnel.ts previewBody).
    if (mySiteId) { body.site_id = mySiteId; }
    fetchJson(LG_API + '/variants/' + encodeURIComponent(targetVariant) + '/preview', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      if (seq !== previewSeq) { return; }
      if (!res.ok || !res.body) {
        // The canvas keeps its last good render; the status says WHY — the
        // server's own path-precise problem when it sent one (§3.6), never a
        // bare "Validation failed".
        var problems = res.body && res.body.problems;
        var detail = (problems && problems.length > 0 && problems[0].message) || (res.body && res.body.error);
        canvasStatus(detail ? 'Preview failed: ' + detail : 'Preview failed \\u2014 the canvas is showing the last good render.');
        return;
      }
      var p = res.body.preview || {};
      setCanvasDoc(p.html || '', p.css || '');
      // Appendix A-9's no-sections copy, VERBATIM (unchanged from the retired
      // client fixture) + what is new: it renders inside the REAL frame.
      canvasStatus(res.body.sample_section === true ? 'Sample section (add sections to preview your own). Your frame, theme and every element edit render around it.' : '');
    }).catch(function () {
      if (seq !== previewSeq) { return; }
      canvasStatus('Preview failed: network error.');
    });
  }

  var previewTimer = null;
  function scheduleCanvasPreview() {
    if (previewTimer) { window.clearTimeout(previewTimer); }
    previewTimer = window.setTimeout(function () { previewTimer = null; renderCanvasPreview(); }, 300);
  }

  // --- reactive local frame patch: mirrors (never owns) the shared
  // island's [data-frame-key]/[data-role-pick] writes so THIS canvas also
  // sees Progress (and any other scalar) edits before Save. See the
  // top-of-file "Scope boundary" note for what this deliberately excludes. --
  function controlValueOf(el) {
    if (el.type === 'checkbox') { return el.checked; }
    return el.value === '' ? null : el.value;
  }
  function onFrameKeyChange(ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var key = el.getAttribute('data-frame-key');
    if (key === null) { return; }
    if (el.type === 'radio' && !el.checked) { return; }
    setPath(myFrame, key, controlValueOf(el));
    if (key === 'progress.style') { syncProgressToggleUi(); syncProgressIconRow(); }
    if (key === 'progress.icon') { syncProgressIconRow(); }
    syncRadioActiveClasses();
    scheduleCanvasPreview();
  }
  function onRolePickClick(ev) {
    var el = ev.target;
    if (!el || !el.getAttribute) { return; }
    var pick = el.getAttribute('data-role-pick');
    if (pick === null) { return; }
    var pickFor = el.getAttribute('data-role-pick-for') || '';
    if (pickFor === '' || pickFor.indexOf('palette.') === 0 || pickFor.indexOf('theme:') === 0) { return; }
    setPath(myFrame, pickFor, pick);
    scheduleCanvasPreview();
  }

  // =========================================================================
  // R2 §3 ② — LIVE reflection for the ARRAY-shaped elements (C/D/E/F/G/H).
  //
  // The box editors' rows ARE the authored value; the shared island collects
  // them into ITS working frame on 'change' (funnel.ts TPLBOX_LIST_WRITERS)
  // and that value only reached this canvas after a Save + reload. These
  // readers re-derive the SAME six group values from the SAME rows this file
  // renders, so every C-H edit is in the very next canvas render. Shapes
  // mirror funnel.ts's collect* functions 1:1 (skip-empty guards included) —
  // the server validates draft_frame_config, so a drifting shape would 400
  // rather than silently render something else.
  // =========================================================================
  function panelRoot() { return document.querySelector('.lg-qpanel[data-panel="templates"]'); }
  function q(scope, sel) { return scope ? scope.querySelector(sel) : null; }
  function qa(scope, sel) { return scope ? toArray(scope.querySelectorAll(sel)) : []; }
  function valOf(scope, sel) { var el = q(scope, sel); return el ? el.value : ''; }
  function tplListEl(key) { return q(panelRoot(), '[data-tplbox-list="' + key + '"]'); }

  function collectPageTarget(scopeEl) {
    var mode = valOf(scopeEl, '[data-pt-mode]') || 'all';
    if (mode === 'all') { return null; }
    var pt = { mode: mode };
    if (mode === 'range') {
      var from = valOf(scopeEl, '[data-pt-from]');
      var to = valOf(scopeEl, '[data-pt-to]');
      pt.from = from !== '' ? Number(from) : 1;
      pt.to = to !== '' ? Number(to) : pt.from;
    } else if (mode === 'list') {
      var parts = String(valOf(scopeEl, '[data-pt-list]')).split(',');
      var pages = [];
      var i;
      for (i = 0; i < parts.length; i++) {
        var raw = parts[i].replace(/^\\s+|\\s+$/g, '');
        var n = Number(raw);
        if (raw !== '' && isFinite(n)) { pages.push(n); }
      }
      pt.pages = pages;
    }
    return pt;
  }

  function collectCtaCondition(row) {
    var box = q(row, '[data-cta-cond-box]');
    if (!box || String(box.className).indexOf('lg-hidden') >= 0) { return null; }
    var rows = qa(box, '[data-cta-cond-row]');
    var conds = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var when = valOf(rows[i], '[data-cta-cond-field]');
      var value = valOf(rows[i], '[data-cta-cond-value]');
      if (when === '' && value === '') { continue; }
      conds.push({ when: when, op: valOf(rows[i], '[data-cta-cond-op]'), value: value });
    }
    if (conds.length === 0) { return null; }
    if (conds.length === 1) { return conds[0]; }
    return { match: valOf(box, '[data-cta-cond-match]') || 'all', conditions: conds };
  }

  function collectCtaSlots() {
    var rows = qa(tplListEl('cta_slots'), '[data-cta-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var tel = valOf(rows[i], '[data-cta-tel]');
      var href = valOf(rows[i], '[data-cta-href]');
      if (tel === '' && href === '') { continue; }
      var entry = { slot: valOf(rows[i], '[data-cta-slot]'), label: valOf(rows[i], '[data-cta-label]'), align: valOf(rows[i], '[data-cta-align]') };
      if (tel !== '') { entry.tel = tel; }
      if (href !== '') { entry.href = href; }
      var cond = collectCtaCondition(rows[i]);
      if (cond) { entry.condition = cond; }
      out.push(entry);
    }
    return out;
  }

  function collectDisclosureEntries() {
    var rows = qa(tplListEl('disclosure.entries'), '[data-disc-entry-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var body = valOf(rows[i], '[data-disc-text]');
      var linkLabel = valOf(rows[i], '[data-disc-link-label]');
      if (body === '' && linkLabel === '') { continue; }
      var entry = { location: valOf(rows[i], '[data-disc-location]'), mode: valOf(rows[i], '[data-disc-mode]'), text: body, align: valOf(rows[i], '[data-disc-align]') };
      if (linkLabel !== '') { entry.link_label = linkLabel; }
      out.push(entry);
    }
    return out;
  }

  function collectFreeTextBlocks(entryRow) {
    var rows = qa(q(entryRow, '[data-ft-blocks]'), '[data-ft-block-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var type = valOf(rows[i], '[data-ft-block-type]');
      if (type === 'list') {
        var lines = String(valOf(rows[i], '[data-ft-block-items]')).split('\\n');
        var items = [];
        var j;
        for (j = 0; j < lines.length; j++) {
          var t = lines[j].replace(/^\\s+|\\s+$/g, '');
          if (t !== '') { items.push(t); }
        }
        if (items.length === 0) { continue; }
        out.push({ type: 'list', items: items, style: valOf(rows[i], '[data-ft-block-liststyle]') || 'unordered' });
      } else {
        var html = valOf(rows[i], '[data-ft-block-text]');
        if (html === '') { continue; }
        out.push({ type: type, html: html });
      }
    }
    return out;
  }

  function collectFreeText() {
    var rows = qa(tplListEl('free_text'), '[data-ft-entry-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var blocks = collectFreeTextBlocks(rows[i]);
      if (blocks.length === 0) { continue; }
      var idEl = q(rows[i], '[data-ft-entry-id]');
      var entry = {
        id: (idEl && idEl.value) || ('ft_preview_' + i),
        slot: valOf(rows[i], '[data-ft-slot]'),
        blocks: blocks,
        align: valOf(rows[i], '[data-ft-align]')
      };
      var size = valOf(rows[i], '[data-ft-typo-size]');
      var color = valOf(rows[i], '[data-ft-typo-color]');
      var typo = {};
      if (size !== '') { typo.size = size; }
      if (color !== '') { typo.color = color; }
      if (size !== '' || color !== '') { entry.typography = typo; }
      var pt = collectPageTarget(rows[i]);
      if (pt) { entry.pages = pt; }
      out.push(entry);
    }
    return out;
  }

  function collectBrandLogoItems() {
    var rows = qa(tplListEl('brand_logos.items'), '[data-bl-item-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var mediaId = valOf(rows[i], '[data-list-field="media_id"]');
      var url = valOf(rows[i], '[data-bl-item-url]');
      var alt = valOf(rows[i], '[data-bl-item-alt]');
      // PREVIEW-safe: a half-typed row (alt only, no image yet) is not
      // renderable and validateFrameConfig rejects it — skip it here so a
      // mid-edit row never replaces the canvas with a validation error. The
      // SAVE payload is the shared island's own collector, unchanged.
      if (mediaId === '' && url === '') { continue; }
      var item = { alt: alt, size: valOf(rows[i], '[data-bl-item-size]') || 'm' };
      if (mediaId !== '') { item.media_id = mediaId; }
      if (url !== '') { item.url = url; }
      out.push(item);
    }
    return out;
  }

  function collectBrandLogos() {
    var panel = q(panelRoot(), '[data-tplbox-panel="brand_logos"]');
    if (!panel) { return null; }
    var enabledEl = q(panel, '[data-bl-enabled]');
    var cfg = {
      enabled: enabledEl ? enabledEl.checked : false,
      layout: valOf(panel, '[data-bl-layout]') || 'row',
      items: collectBrandLogoItems(),
      slot: valOf(panel, '[data-bl-slot]') || 'below_section',
      align: valOf(panel, '[data-bl-align]') || 'left'
    };
    var pt = collectPageTarget(panel);
    if (pt) { cfg.pages = pt; }
    return cfg;
  }

  function collectFooterLinkRows(linkrowEl) {
    var rows = qa(q(linkrowEl, '[data-footer-block-links]'), '[data-footer-link-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var label = valOf(rows[i], '[data-footer-link-label]');
      var href = valOf(rows[i], '[data-footer-link-href]');
      if (label === '' && href === '') { continue; }
      out.push({ label: label, href: href });
    }
    return out;
  }

  // R2 P3 (element J) D2 — only CHECKED picker rows become picks; page_type
  // is REQUIRED (a row with no page_type, which should never happen once
  // fetchFooterPicks below has populated it, is defensively skipped rather
  // than saved half-built).
  function collectFooterPickRows(pickedRowEl) {
    var rows = qa(q(pickedRowEl, '[data-footer-block-picks]'), '[data-footer-pick-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var checkedEl = q(rows[i], '[data-footer-pick-checked]');
      if (!checkedEl || !checkedEl.checked) { continue; }
      var pageType = valOf(rows[i], '[data-footer-pick-pagetype]');
      var label = valOf(rows[i], '[data-footer-pick-label]');
      if (pageType === '' || label === '') { continue; }
      var pick = { page_type: pageType, label: label };
      // R2 P3 FIX-FIRST (BLOCKER-2) — the per-site-UNIQUE slug identity (the
      // funnel.ts twin does the same); page_type stays for back-compat.
      var pickSlug = valOf(rows[i], '[data-footer-pick-slug]');
      if (pickSlug !== '') { pick.slug = pickSlug; }
      var manualUrl = valOf(rows[i], '[data-footer-pick-manualurl]');
      if (manualUrl !== '') { pick.manual_url = manualUrl; }
      out.push(pick);
    }
    return out;
  }

  // R2 P3 (element J) D2 — "Load pages from the preview site…" (mySiteId,
  // the SAME reference site the canvas previews under — populateSiteSelect
  // above). Mirrors populateThemeSwitcher's fetch-then-build idiom. Building
  // rows via the SAME data-tplbox-tpl clone the funnel-wide "+ Add a footer
  // block" idiom uses (funnel.ts cloneTplRow) keeps ONE row-construction
  // convention; this island only reads the <template>, never invents markup.
  function fetchFooterPicks(loadBtn) {
    var blockRow = loadBtn.closest('[data-footer-block-row]');
    var pickedRowEl = blockRow ? q(blockRow, '[data-footer-block-pickedrow]') : null;
    var list = pickedRowEl ? q(pickedRowEl, '[data-footer-block-picks]') : null;
    var tpl = document.querySelector('template[data-tplbox-tpl="footer_pick_row"]');
    if (!list || !tpl || !tpl.content || !mySiteId) { return; }
    fetchJson(LG_API + '/sites/' + encodeURIComponent(mySiteId) + '/legal-pages', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) {
        var pages = (res.ok && res.body && res.body.pages) ? res.body.pages : [];
        clearChildren(list);
        var i;
        for (i = 0; i < pages.length; i++) {
          var row = document.importNode(tpl.content, true).firstElementChild;
          // R2 P3 FIX-FIRST (BLOCKER-2) — the visible option must allow an
          // operator to tell apart the FOUR pages a stock site seeds with the
          // same page_type ("legal"): show the slug alongside the title.
          var titleEl = q(row, '[data-footer-pick-title]');
          var pageSlug = pages[i].slug || '';
          var pageTitle = pages[i].title || pages[i].page_type || '';
          if (titleEl) { titleEl.appendChild(text(pageSlug === '' ? pageTitle : pageTitle + ' (/' + pageSlug + ')')); }
          var typeEl = q(row, '[data-footer-pick-pagetype]');
          if (typeEl) { typeEl.value = pages[i].page_type || ''; }
          var slugEl = q(row, '[data-footer-pick-slug]');
          if (slugEl) { slugEl.value = pageSlug; }
          var labelEl = q(row, '[data-footer-pick-label]');
          if (labelEl) { labelEl.value = pages[i].title || ''; }
          list.appendChild(row);
        }
      })
      .catch(function () { /* the operator can still author a manual link_row instead */ });
  }

  // MINOR-9's plain-text projection (the funnel.ts twin's helper, mirrored).
  function plainFromMarkup(s) { return String(s === null || s === undefined ? '' : s).replace(/<[^>]*>/g, ''); }
  function collectFooterBlocks() {
    var rows = qa(tplListEl('footer.blocks'), '[data-footer-block-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var type = valOf(rows[i], '[data-footer-block-type]');
      var body = valOf(rows[i], '[data-footer-block-text]');
      var hasText = type === 'about_paragraph' || type === 'disclosure' || type === 'address';
      // R2 P3 (element J) — about_paragraph/disclosure keep writing the SAME
      // 'text' field so the canvas preview never blanks pre-existing content
      // (designs/frame.ts's renderer still only reads block.text for these
      // two types); 'html' rides ALONGSIDE it, ready for once that renderer
      // also prefers html-if-present (mirrors free_text's own field, sanitized
      // server-side at validateFrameConfig). 'heading' is new and has no
      // legacy text concept, so it is html-only (mirrors free_text's heading).
      var hasHtml = type === 'about_paragraph' || type === 'disclosure' || type === 'heading';
      if (type === 'heading') {
        if (body === '') { continue; }
      } else if (hasText && body === '') {
        continue;
      }
      var block = { type: type, align: valOf(rows[i], '[data-footer-block-align]') };
      // R2 P3 FIX-FIRST (MINOR-9) — the funnel.ts twin's rule, mirrored: only
      // 'html' may hold markup; 'text' gets the plain projection so the field
      // designs/frame.ts escapes verbatim can never carry raw tags.
      if (hasText) { block.text = hasHtml ? plainFromMarkup(body) : body; }
      if (hasHtml) { block.html = body; }
      // R2 P3 FIX-FIRST (MINOR-6) — the heading level, now authorable here too.
      if (type === 'heading') {
        var levelVal = valOf(rows[i], '[data-footer-block-level]');
        if (levelVal !== '') { block.level = Number(levelVal); }
      }
      if (type === 'list') {
        var lines = String(valOf(rows[i], '[data-footer-block-items]')).split('\\n');
        var items = [];
        var j;
        for (j = 0; j < lines.length; j++) {
          var t = lines[j].replace(/^\\s+|\\s+$/g, '');
          if (t !== '') { items.push(t); }
        }
        if (items.length === 0) { continue; }
        block.items = items;
        block.list_style = valOf(rows[i], '[data-footer-block-liststyle]') || 'unordered';
      }
      if (type === 'logo') {
        var logoSource = valOf(rows[i], '[data-footer-block-logosource]') || 'site';
        block.logo_source = logoSource;
        if (logoSource === 'manual') {
          var logoMediaId = valOf(rows[i], '[data-list-field="logo_media_id"]');
          var logoUrl = valOf(rows[i], '[data-footer-block-logourl]');
          if (logoMediaId !== '') { block.logo_media_id = logoMediaId; }
          if (logoUrl !== '') { block.logo_url = logoUrl; }
        }
        var logoAlt = valOf(rows[i], '[data-footer-block-logoalt]');
        if (logoAlt !== '') { block.logo_alt = logoAlt; }
      }
      if (type === 'link_row') {
        block.links_source = valOf(rows[i], '[data-footer-block-linksource]') || 'site';
        if (block.links_source === 'manual') {
          var linkrowEl = q(rows[i], '[data-footer-block-linkrow]');
          var links = linkrowEl ? collectFooterLinkRows(linkrowEl) : [];
          if (links.length === 0) { continue; }
          block.links = links;
        }
        // R2 P3 (element J) D2 — S3b's Pages-fed legal-links picker.
        if (block.links_source === 'picked') {
          var pickedRowEl = q(rows[i], '[data-footer-block-pickedrow]');
          var picks = pickedRowEl ? collectFooterPickRows(pickedRowEl) : [];
          if (picks.length === 0) { continue; }
          block.picks = picks;
        }
      }
      out.push(block);
    }
    return out;
  }

  // R2 P7 D2 / R1 — the funnel studio's stripIncompleteImagesForPreview died
  // with the dead §4.1 canvas; this is its equivalent on the LIVE canvas path,
  // widened to the two shapes it never covered. frames.ts validateImages
  // refuses an image row unless it has (media_id OR a SAFE url) AND alt, and
  // ONE such row 400s the WHOLE preview — measured live on this canvas: a URL
  // pasted BEFORE the alt text is typed ("Preview failed: An image needs alt
  // text.") and every keystroke of a half-typed URL ("…or a safe image URL.")
  // left the canvas frozen on its last good render. The predicate mirrors
  // validateImages/SAFE_HREF_RE 1:1 so a row the SERVER would render is never
  // dropped from the canvas. Only this canvas draft is filtered — funnel.ts's
  // collectImages (the SAVE collector) and PUT /funnels/:id/frame validation
  // are untouched, so Save still rejects exactly the same row.
  function previewSafeImageHref(raw) {
    var s = String(raw).trim().toLowerCase();
    if (s.indexOf('https://') === 0 || s.indexOf('http://') === 0) { return true; }
    if (s.charAt(0) === '#' || s.indexOf('tel:') === 0 || s.indexOf('mailto:') === 0) { return true; }
    return s.charAt(0) === '/' && s.charAt(1) !== '/';
  }
  function imageRowRenderable(mediaId, url, alt) {
    if (String(alt).trim() === '') { return false; }
    if (String(mediaId).trim() !== '') { return true; }
    return String(url).trim() !== '' && previewSafeImageHref(url);
  }

  function collectImages() {
    var rows = qa(tplListEl('images'), '[data-img-item-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var mediaId = valOf(rows[i], '[data-list-field="media_id"]');
      var url = valOf(rows[i], '[data-img-item-url]');
      var alt = valOf(rows[i], '[data-img-item-alt]');
      // the no-source short-circuit stays VERBATIM and first: it is the exact
      // line the brand-logo collector above uses, the symmetry
      // test/leadgen-templates-canvas-r2.test.ts pins across BOTH media-bearing
      // collectors ("a half-typed image / brand-logo row never blanks the
      // canvas"). imageRowRenderable then widens it to the alt / unsafe-url
      // shapes that same drive measured.
      if (mediaId === '' && url === '') { continue; }
      if (!imageRowRenderable(mediaId, url, alt)) { continue; }
      var idEl = q(rows[i], '[data-img-item-id]');
      var item = {
        id: (idEl && idEl.value) || ('img_preview_' + i),
        alt: alt,
        slot: valOf(rows[i], '[data-img-item-slot]'),
        size: valOf(rows[i], '[data-img-item-size]') || 'm',
        align: valOf(rows[i], '[data-img-item-align]') || 'left'
      };
      if (mediaId !== '') { item.media_id = mediaId; }
      if (url !== '') { item.url = url; }
      var tooltip = valOf(rows[i], '[data-img-item-tooltip]');
      if (tooltip !== '') { item.tooltip = tooltip; }
      var pt = collectPageTarget(rows[i]);
      if (pt) { item.pages = pt; }
      out.push(item);
    }
    return out;
  }

  // Overlay the six group values onto a draft frame. Called ONLY once the
  // operator has edited in this panel (arraysArmed) — before that the rows
  // may not be populated yet and an empty read would WIPE stored elements
  // out of the preview.
  function overlayListGroups(draft) {
    if (!panelRoot()) { return; }
    setPath(draft, 'cta_slots', collectCtaSlots());
    setPath(draft, 'disclosure.entries', collectDisclosureEntries());
    setPath(draft, 'free_text', collectFreeText());
    var bl = collectBrandLogos();
    if (bl !== null) { setPath(draft, 'brand_logos', bl); }
    setPath(draft, 'footer.blocks', collectFooterBlocks());
    setPath(draft, 'images', collectImages());
  }

  // A media pick writes a hidden [data-frame-key] input DIRECTLY (no native
  // 'change' event — funnel.ts writeMediaFieldValue), so element A's
  // background image would otherwise never reach this canvas live. Read those
  // hidden inputs at render time.
  function overlayHiddenFrameKeys(draft) {
    var inputs = qa(panelRoot(), 'input[type="hidden"][data-frame-key]');
    var i;
    for (i = 0; i < inputs.length; i++) {
      var key = inputs[i].getAttribute('data-frame-key');
      if (!key) { continue; }
      setPath(draft, key, inputs[i].value === '' ? null : inputs[i].value);
    }
  }

  // Every edit inside the Templates panel — typing (input), select/checkbox
  // (change) and the add/remove/reorder/media buttons (click) — re-renders
  // the canvas. The 300ms debounce means the collectors run once per burst,
  // AFTER the shared island's own handlers have mutated the rows.
  function onPanelEdit(ev) {
    var el = ev.target;
    if (!el || !el.closest) { return; }
    if (!el.closest('.lg-qpanel[data-panel="templates"]')) { return; }
    arraysArmed = true;
    // The shared island (funnel.ts) repopulates every [data-frame-key] control
    // when a tab activates or the target funnel changes, and a programmatic
    // .checked assignment fires no 'change' — so re-derive the Marker-icon
    // row's visibility from whatever the radios now say, on any panel activity.
    syncProgressIconRow();
    scheduleCanvasPreview();
  }

  // --- Progress: Show-progress-bar toggle <-> progress.style="hidden" ----
  function progressStyleRadios() { return toArray(document.querySelectorAll('input[data-frame-key="progress.style"][data-frame-radio="1"]')); }
  function currentProgressStyle() {
    var radios = progressStyleRadios();
    var i;
    for (i = 0; i < radios.length; i++) { if (radios[i].checked) { return radios[i].value; } }
    return 'bar';
  }
  function setProgressStyleRadio(value) {
    var radios = progressStyleRadios();
    var i;
    var target = null;
    for (i = 0; i < radios.length; i++) { if (radios[i].value === value) { target = radios[i]; } }
    if (!target) { return; }
    target.checked = true;
    var evt;
    if (typeof window.Event === 'function') { evt = new window.Event('change', { bubbles: true }); }
    target.dispatchEvent(evt);
  }
  function syncProgressToggleUi() {
    var toggle = byId('lg-tpl-progress-show-checkbox');
    var isHidden = currentProgressStyle() === 'hidden';
    if (toggle) { toggle.checked = !isHidden; }
  }
  // R2 P8 S4.2 (M1) — "Marker icon" only appears when it does something:
  // designs/frame.ts reads progress.icon inside its icon_on_track branch
  // alone. Before any radio is checked (this island runs at DOMContentLoaded;
  // funnel.ts's shared island populates the controls on its own schedule) the
  // boot frame's own effective style is the truth, so the row is right on the
  // first paint too, not only after the operator touches something.
  function styleForIconRow() {
    var radios = progressStyleRadios();
    var i;
    for (i = 0; i < radios.length; i++) { if (radios[i].checked) { return radios[i].value; } }
    var eff = (boot && boot.frame && boot.frame.effective_frame && boot.frame.effective_frame.progress)
      ? boot.frame.effective_frame.progress.style : '';
    return eff || '';
  }
  // R2 P8 F1 — every "this control would do nothing here" row of the Progress
  // box is decided in ONE pass, by the ONE function that already owned that job
  // (no new island symbol: the var-manifest harnesses rebuild this island from
  // a hand-listed set of names, and a new top-level helper would be a bare
  // ReferenceError there). The rows:
  //   * Marker icon      — only for the icon_on_track style (designs/frame.ts
  //                        reads progress.icon in that branch alone);
  //   * Marker image     — only when the chosen mark IS an image (icon custom),
  //                        so the media picker never sits there dead;
  //   * Show label       — NOT for numbered: that style renders the step label
  //                        unconditionally, so the switch cannot be honoured
  //                        (section 4 R3, "a control that cannot be honoured
  //                        must not be offered");
  //   * numbered note    — takes the switch's place, so the operator is told
  //                        why rather than finding a control that does nothing.
  function syncProgressIconRow() {
    var style = styleForIconRow();
    var iconSel = toArray(document.querySelectorAll('[data-frame-key="progress.icon"]'));
    var icon = (iconSel.length > 0 && iconSel[0].value) ? iconSel[0].value : '';
    if (icon === '' && boot && boot.frame && boot.frame.effective_frame && boot.frame.effective_frame.progress) {
      icon = boot.frame.effective_frame.progress.icon || '';
    }
    var rows = [
      ['lg-tpl-progress-icon-row', style === 'icon_on_track'],
      ['lg-tpl-progress-icon-media-row', style === 'icon_on_track' && icon === 'custom'],
      ['lg-tpl-progress-showlabel-row', style !== 'numbered'],
      ['lg-tpl-progress-numbered-note', style === 'numbered']
    ];
    var i;
    for (i = 0; i < rows.length; i++) {
      var row = byId(rows[i][0]);
      if (!row) { continue; }
      var base = row.className.replace(/\\s*lg-hidden/g, '');
      row.className = rows[i][1] ? base : base + ' lg-hidden';
    }
  }
  function wireProgressToggle() {
    var toggle = byId('lg-tpl-progress-show-checkbox');
    if (!toggle) { return; }
    toggle.addEventListener('change', function () {
      if (toggle.checked) {
        setProgressStyleRadio(lastRealProgressStyle || 'bar');
      } else {
        var nowStyle = currentProgressStyle();
        if (nowStyle !== 'hidden') { lastRealProgressStyle = nowStyle; }
        setProgressStyleRadio('hidden');
      }
    });
  }

  // --- generic active-class sync for the type-picker + segmented controls
  function syncRadioActiveClasses() {
    var radios = toArray(document.querySelectorAll('.lg-tpl2-ptype input, .lg-tpl2-seg-item input'));
    var i;
    for (i = 0; i < radios.length; i++) {
      var wrap = radios[i].parentNode;
      if (!wrap || !wrap.className) { continue; }
      var base = wrap.className.replace(/\\s*active/g, '');
      wrap.className = radios[i].checked ? base + ' active' : base;
    }
  }

  // --- section picker: shared page (quote-scoped, §4.3-1) first, else this
  // funnel/variant's own sections (boot.sections) — §8.3's own fallback
  // order. Empty either way -> the fixture (renderCanvasPreview handles it).
  function populateSectionPicker() {
    var sel = byId('lg-tpl-section-select');
    if (!sel) { return; }
    var quoteId = boot ? boot.quote_public_id : '';
    var fromVariant = (boot && boot.sections) ? boot.sections.map(function (s) { return { value: s.public_id, label: s.name }; }) : [];
    function finish(sharedList) {
      var combined = sharedList.concat(fromVariant);
      currentSections = combined;
      clearChildren(sel);
      if (combined.length === 0) {
        var opt = document.createElement('option');
        opt.value = '';
        opt.appendChild(text('No sections yet (sample shown)'));
        sel.appendChild(opt);
        renderCanvasPreview();
        return;
      }
      var i;
      for (i = 0; i < combined.length; i++) {
        var o = document.createElement('option');
        o.value = combined[i].value;
        o.appendChild(text(combined[i].label));
        sel.appendChild(o);
      }
      renderCanvasPreview();
    }
    if (!quoteId) { finish([]); return; }
    fetchJson(LG_API + '/quotes/' + encodeURIComponent(quoteId) + '/shared-page', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) {
        var shared = (res.ok && res.body && res.body.shared_page && res.body.shared_page.sections) ? res.body.shared_page.sections : [];
        finish(shared.map(function (s) { return { value: s.section_public_id, label: s.section_name }; }));
      })
      .catch(function () { finish([]); });
  }

  // --- theme switcher: GET /themes, preview-only (draft_theme), never
  // persists the funnel's OWN theme_json. B7: the dropdown lists the REAL
  // theme presets, says so honestly when there are none yet, and the
  // "+ New theme…" button next to it reaches the Themes tab (where presets
  // are authored) instead of dead-ending. ------------------------------
  function populateThemeSwitcher() {
    var sel = byId('lg-tpl-theme-select');
    if (!sel) { return; }
    fetchJson(LG_API + '/themes', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (res) {
      var items = (res.ok && res.body && res.body.items) ? res.body.items : [];
      var i;
      for (i = 0; i < items.length; i++) {
        var o = document.createElement('option');
        o.value = items[i].id;
        o.appendChild(text(items[i].name || items[i].id));
        sel.appendChild(o);
      }
      if (items.length === 0) {
        var empty = document.createElement('option');
        empty.value = '';
        empty.disabled = true;
        empty.appendChild(text('No themes yet \\u2014 create one in the Themes manager'));
        sel.appendChild(empty);
      }
    }).catch(function () { /* the "Current theme" option alone still works */ });
    sel.addEventListener('change', function () {
      myDraftThemeId = sel.value;
      scheduleCanvasPreview();
    });
  }

  function wireThemeCreateAffordance() {
    var btn = byId('lg-tpl-theme-create');
    if (!btn) { return; }
    btn.addEventListener('click', function () {
      var tab = document.querySelector('[data-tab="themes"]');
      if (tab) { tab.click(); }
    });
  }

  // --- preview site (R5 / #11A): the site whose branding the canvas renders
  // under. Options come from the boot blob's activation sites; the select
  // carries [data-site-select], the SAME hook the funnel builder's toolbar
  // uses, so the two canvases agree on the chosen site. Default = the first
  // ACTIVE site, so a funnel that IS live on a site shows that site's logo
  // without a second click. ---------------------------------------------
  function populateSiteSelect() {
    var sel = byId('lg-tpl-site-select');
    var sites = (boot && boot.sites) ? boot.sites : [];
    var chosen = '';
    var i;
    if (sel) {
      for (i = 0; i < sites.length; i++) {
        var o = document.createElement('option');
        o.value = sites[i].site_id;
        o.appendChild(text((sites[i].site_name || sites[i].site_id) + ' \\u2014 ' + (sites[i].badge || '')));
        sel.appendChild(o);
      }
    }
    // An explicit choice already made on another tab's site select wins.
    var others = toArray(document.querySelectorAll('[data-site-select]'));
    for (i = 0; i < others.length; i++) {
      if (others[i] !== sel && others[i].value) { chosen = others[i].value; }
    }
    if (chosen === '') {
      for (i = 0; i < sites.length; i++) {
        if (sites[i].badge === 'Active') { chosen = sites[i].site_id; break; }
      }
    }
    mySiteId = chosen;
    if (sel && chosen !== '') { sel.value = chosen; }
    document.addEventListener('change', function (ev) {
      var el = ev.target;
      if (!el || !el.getAttribute || el.getAttribute('data-site-select') === null) { return; }
      mySiteId = el.value || '';
      if (sel && sel !== el) { sel.value = mySiteId; }
      scheduleCanvasPreview();
    });
  }

  // --- saved template bar --------------------------------------------
  // R2 P8 S4.2 (§6 M10, client leg): the saved-template pill printed the raw
  // stored enum ("Bare layout \\u00b7 dots progress"). It now speaks the SAME
  // words the Style tiles do (PROGRESS_LABELS) and names the footer the way
  // every other control in this panel does. Each bit is still read straight off
  // the template's OWN frame_json, so the pill describes the record and nothing
  // else.
  //
  // R2 P8 FIX ROUND F1 — the real THUMBNAIL is consumed now. The server key
  // thumbnail_html is pre-composed MARKUP and an island here may not use
  // innerHTML, so frame-handlers.ts emits the DATA sibling "thumbnail"
  // (root_class + id + bands) from the SAME frameThumbnailData the markup is
  // serialised from, and thumbFor below builds those exact nodes with
  // createElement. The bands are never re-derived from frame_json here: that
  // would be a second reader of one wire shape, which is section 4 R1's own
  // defect.
  function templateSummary(frameJson) {
    var bits = [];
    if (frameJson && frameJson.section_slot && frameJson.section_slot.card) { bits.push(frameJson.section_slot.card === 'card' ? 'Card layout' : 'Bare layout'); }
    if (frameJson && frameJson.progress && frameJson.progress.style) { bits.push(frameJson.progress.style === 'hidden' ? PROGRESS_LABELS.hidden : (progressStyleLabel(frameJson.progress.style) + ' progress')); }
    if (frameJson && frameJson.footer && frameJson.footer.enabled === false) { bits.push('No footer'); }
    return bits.join(' \\u00b7 ');
  }

  // The saved template's picture, built from the server's band DATA. Returns
  // null when a record predates the key, so an older payload degrades to the
  // name pill it always had rather than an empty box.
  function thumbFor(tpl) {
    var data = tpl ? tpl.thumbnail : null;
    if (!data || !data.bands || !data.bands.length) { return null; }
    var box = document.createElement('span');
    box.className = data.root_class || 'lg-tpl-thumb';
    box.setAttribute('data-template-thumb', data.id || '');
    box.setAttribute('aria-hidden', 'true');
    var i;
    for (i = 0; i < data.bands.length; i++) {
      var band = document.createElement('span');
      band.className = data.bands[i];
      box.appendChild(band);
    }
    return box;
  }

  function closeAllTplMenus() {
    var menus = toArray(document.querySelectorAll('.lg-tpl2-tpl-menu'));
    var i;
    for (i = 0; i < menus.length; i++) { if (menus[i].parentNode) { menus[i].parentNode.removeChild(menus[i]); } }
  }

  function renderTemplateList() {
    var list = byId('lg-tpl-list');
    if (!list) { return; }
    clearChildren(list);
    if (templates.length === 0) {
      list.appendChild(text('No saved templates yet.'));
      return;
    }
    var i;
    for (i = 0; i < templates.length; i++) {
      (function (tpl) {
        // R2 D5: "DEFAULT" now marks THIS QUOTE's override (myQuoteDefaultTemplateId)
        // when one is set; a quote with no override shows the GLOBAL default
        // (tpl.is_default) instead, since that is what it actually inherits.
        var isThisQuoteDefault = myQuoteDefaultTemplateId ? (tpl.public_id === myQuoteDefaultTemplateId) : !!tpl.is_default;
        var chip = document.createElement('span');
        chip.className = 'lg-tpl2-tpl-chip' + (isThisQuoteDefault ? ' is-default' : '');
        chip.setAttribute('data-tpl-chip', tpl.public_id);
        var thumb = thumbFor(tpl);
        if (thumb) { chip.appendChild(thumb); }
        chip.appendChild(text(tpl.name));
        if (isThisQuoteDefault) {
          var badge = document.createElement('span');
          badge.className = 'lg-tpl2-tpl-chip-default-badge';
          badge.appendChild(text(myQuoteDefaultTemplateId ? 'DEFAULT FOR THIS QUOTE' : 'DEFAULT'));
          chip.appendChild(badge);
        }
        var moreBtn = document.createElement('button');
        moreBtn.type = 'button';
        moreBtn.setAttribute('data-tpl-more', tpl.public_id);
        moreBtn.setAttribute('aria-label', 'Template actions for ' + tpl.name);
        moreBtn.appendChild(text('\\u22ef'));
        chip.appendChild(moreBtn);
        list.appendChild(chip);
      }(templates[i]));
    }
  }

  function loadTemplates() {
    return fetchJson(LG_API + '/frame-template-records', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (res) {
      templates = (res.ok && res.body && res.body.items) ? res.body.items : [];
      renderTemplateList();
      return templates;
    });
  }

  // R2 D5: this quote's per-quote default override (quoteDetailJson's
  // default_template_id) — a SEPARATE fetch from loadTemplates (which lists
  // every SAVED template, global is_default included) since the per-quote
  // override lives on the quote's OWN row, not the template records list.
  function loadQuoteDefaultTemplate() {
    if (!boot || !boot.quote_public_id) { return Promise.resolve(''); }
    return fetchJson(LG_API + '/quotes/' + encodeURIComponent(boot.quote_public_id), { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (res) {
        myQuoteDefaultTemplateId = (res.ok && res.body && res.body.default_template_id) ? res.body.default_template_id : '';
        renderTemplateList();
        return myQuoteDefaultTemplateId;
      })
      .catch(function () { return ''; });
  }

  function findTemplate(publicId) {
    var i;
    for (i = 0; i < templates.length; i++) { if (templates[i].public_id === publicId) { return templates[i]; } }
    return null;
  }

  function openTplMenu(publicId, anchor) {
    closeAllTplMenus();
    var menu = document.createElement('div');
    menu.className = 'lg-tpl2-tpl-menu';
    function addItem(label, handler) {
      var b = document.createElement('button');
      b.type = 'button';
      b.appendChild(text(label));
      b.addEventListener('click', function (ev) { ev.stopPropagation(); closeAllTplMenus(); handler(); });
      menu.appendChild(b);
    }
    var tpl = findTemplate(publicId);
    addItem('Rename\\u2026', function () {
      var next = window.prompt('New name for this template:', tpl ? tpl.name : '');
      if (next === null) { return; }
      next = next.replace(/^\\s+|\\s+$/g, '');
      if (!next) { return; }
      fetchJson(LG_API + '/frame-template-records/' + encodeURIComponent(publicId), {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: next })
      }).then(function (res) {
        if (!res.ok) { showError('lg-tpl-bar-error', (res.body && res.body.error) || 'Rename failed.'); return; }
        hideError('lg-tpl-bar-error');
        loadTemplates();
      });
    });
    addItem('Duplicate', function () {
      fetchJson(LG_API + '/frame-template-records/' + encodeURIComponent(publicId) + '/duplicate', {
        method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }
      }).then(function (res) {
        if (!res.ok) { showError('lg-tpl-bar-error', (res.body && res.body.error) || 'Duplicate failed.'); return; }
        hideError('lg-tpl-bar-error');
        loadTemplates();
      });
    });
    // R2 D5 (contract §7 D5, owner ruling on A.1 #11-D/ADJ-B2): "Set as
    // default" is now PER-QUOTE — it writes/updates THIS quote's row
    // (PATCH /quotes/:id {default_template_id}, migration 0055's
    // leadgen_quote_default_template) rather than the old cross-quote-global
    // PUT /frame-template-records/:id/default. The global default (set
    // elsewhere) remains the fallback for quotes with no override.
    addItem('Set as this quote\\u2019s default', function () {
      if (!boot || !boot.quote_public_id || !tpl) { return; }
      fetchJson(LG_API + '/quotes/' + encodeURIComponent(boot.quote_public_id), {
        method: 'PATCH', credentials: 'same-origin',
        headers: { 'content-type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ default_template_id: tpl.id })
      }).then(function (res) {
        if (!res.ok) { showError('lg-tpl-bar-error', (res.body && res.body.error) || 'Could not set this quote\\u2019s default.'); return; }
        hideError('lg-tpl-bar-error');
        loadQuoteDefaultTemplate();
      });
    });
    addItem('Delete', function () {
      hideError('lg-tpl-delete-guard');
      fetchJson(LG_API + '/frame-template-records/' + encodeURIComponent(publicId), {
        method: 'DELETE', credentials: 'same-origin', headers: { Accept: 'application/json' }
      }).then(function (res) {
        if (res.status === 409) {
          var body = res.body || {};
          var names = [];
          var inUse = body.in_use || {};
          var fs = inUse.funnels || [];
          var vs = inUse.variants || [];
          var i;
          for (i = 0; i < fs.length; i++) { names.push(fs[i].name); }
          for (i = 0; i < vs.length; i++) { names.push(vs[i].label); }
          var msg = (body.error || 'This template is in use.') + (names.length > 0 ? ' Used by: ' + names.join(', ') + '. Assign them a different template first, then delete this one.' : '');
          showError('lg-tpl-delete-guard', msg);
          return;
        }
        if (!res.ok) { showError('lg-tpl-bar-error', (res.body && res.body.error) || 'Delete failed.'); return; }
        hideError('lg-tpl-bar-error');
        loadTemplates();
      });
    });
    document.body.appendChild(menu);
    var rect = anchor.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = rect.bottom + 'px';
    menu.style.left = rect.left + 'px';
  }

  function wireTemplateBar() {
    document.addEventListener('click', function (ev) {
      var el = ev.target;
      if (!el || !el.getAttribute) { return; }
      var moreId = el.getAttribute('data-tpl-more');
      if (moreId !== null) { openTplMenu(moreId, el); return; }
      if (!el.closest || !el.closest('.lg-tpl2-tpl-menu')) { closeAllTplMenus(); }
    });
    var newBtn = byId('lg-tpl-new-btn');
    var newForm = byId('lg-tpl-new-form');
    var newName = byId('lg-tpl-new-name');
    var newSave = byId('lg-tpl-new-save');
    var newCancel = byId('lg-tpl-new-cancel');
    if (newBtn && newForm) {
      newBtn.addEventListener('click', function () {
        newForm.className = newForm.className.replace(/\\s*lg-hidden/g, '');
        if (newName) { newName.value = ''; newName.focus(); }
      });
    }
    if (newCancel && newForm) {
      newCancel.addEventListener('click', function () { newForm.className = newForm.className + ' lg-hidden'; });
    }
    if (newSave) {
      newSave.addEventListener('click', function () {
        var name = newName ? newName.value.replace(/^\\s+|\\s+$/g, '') : '';
        if (!name) { showError('lg-tpl-bar-error', 'Enter a template name.'); return; }
        // R4: save what the operator is LOOKING AT — the island's live draft
        // (scalar edits + the C-H rows) — not boot.frame.effective_frame, the
        // page-load snapshot that ignored every unsaved edit.
        fetchJson(LG_API + '/frame-template-records', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ name: name, frame_json: currentEffectiveFrameForDraft() })
        }).then(function (res) {
          if (!res.ok) { showError('lg-tpl-bar-error', (res.body && res.body.error) || 'Create failed.'); return; }
          hideError('lg-tpl-bar-error');
          if (newForm) { newForm.className = newForm.className + ' lg-hidden'; }
          loadTemplates();
        });
      });
    }
  }

  // --- Apply to funnel -------------------------------------------------
  function applyDialogShowState(state) {
    var dialog = byId('lg-tpl-apply-dialog');
    if (!dialog) { return; }
    var panels = toArray(dialog.querySelectorAll('[data-apply-state]'));
    var i;
    for (i = 0; i < panels.length; i++) {
      var isMatch = panels[i].getAttribute('data-apply-state') === state;
      var base = panels[i].className.replace(/\\s*lg-hidden/g, '');
      panels[i].className = isMatch ? base : base + ' lg-hidden';
    }
  }
  var applyChosenTemplate = null;

  // =======================================================================
  // R2 P8 S4.2 (§6 M3 / R2-1) — what this dialog is allowed to promise.
  //
  // MEASURED BEFORE: the four enumerated promises were all false after apply.
  // The dialog computed them HERE, in the client, by comparing a RESOLVED frame
  // (boot.frame.effective_frame — every group present, every default filled)
  // against a SPARSE saved-template patch, and reading an ABSENT key as an
  // authored one: a template that never mentions the footer has
  // cand.footer.enabled === undefined, which is !== true, so the operator was
  // told "The footer will be hidden." from a key the template does not set
  // (and progress could read "...changes from numbered to undefined."). On top
  // of that it modelled the apply as a merge the apply did not perform.
  //
  // A second client-side predictor is the R1 defect class waiting to happen —
  // producer and consumer written to different contracts. So the promises are
  // no longer predicted here at all: the SERVER dry-runs the real apply
  // (POST /funnels/:id/apply-template {dry_run:true} — frame-handlers.ts
  // returns before any write) and hands back the operator-language
  // confirmations that designs/frames.ts computeTemplateApply derives from the
  // REAL before/after leaf diff, which is the same function, on the same
  // inputs, that the confirm button then executes. One truth, one place.
  // A failed dry run shows the error slot and no promises at all.
  // =======================================================================
  function applyLeadLine(tpl) {
    return '"' + (tpl && tpl.name ? tpl.name : 'This template') + '" becomes this funnel\u2019s layout template.';
  }
  function paintConfirmList(lines) {
    var list = byId('lg-tpl-apply-confirm-list');
    if (!list) { return; }
    clearChildren(list);
    var i;
    for (i = 0; i < lines.length; i++) {
      var li = document.createElement('li');
      li.appendChild(text(lines[i]));
      list.appendChild(li);
    }
  }
  function openApplyConfirm(tpl) {
    var targetFunnel = targetFunnelPublicId();
    if (!tpl || !targetFunnel) { return; }
    fetchJson(LG_API + '/funnels/' + encodeURIComponent(targetFunnel) + '/apply-template', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ template_id: tpl.id, dry_run: true })
    }).then(function (res) {
      if (!res.ok || !res.body || !res.body.confirmations) {
        showError('lg-tpl-apply-error', (res.body && res.body.error) || 'Could not preview this template.');
        return;
      }
      applyChosenTemplate = tpl;
      hideError('lg-tpl-apply-error');
      paintConfirmList([applyLeadLine(tpl)].concat(res.body.confirmations));
      applyDialogShowState('confirm');
    }).catch(function () {
      // R2 P8 FIX ROUND F4 (F-9): a REJECTED fetch (the visitor's laptop drops
      // its network mid-click) resolved nothing and rendered nothing, so the
      // card click did literally nothing — no confirm state, no message, no
      // reason. HTTP errors were always handled (the branch above); this is the
      // other half, in the SAME error slot, in the same words.
      showError('lg-tpl-apply-error', 'Could not preview this template.');
    });
  }

  // =======================================================================
  // The A/B arm predicate — a DIFFERENT question from the one above, because
  // an arm is resolved differently from an apply. An A/B arm points
  // variant.frame_template_id at a template, and that row resolves as the BASE
  // layer UNDER the funnel's config (resolver.ts resolveSavedFrameTemplateDefaults
  // For: variant.frame_template_id ?? funnel.frame_template_id -> effectiveFrame's
  // 4th argument). So a leaf the funnel's OWN config carries does not move on the
  // new arm, however different the two templates are.
  //
  // R2 P8 FIX ROUND F4 (F-2) — that shadow used to cover EVERYTHING on any
  // funnel someone had pressed "Apply to funnel…" on, because the apply copied
  // the whole template into the funnel column: measured, every non-current
  // template reported "Nothing this template sets would change on the new arm"
  // and the forked arm rendered byte-identically. FIXED AT THE SOURCE, not
  // reported here: designs/frames.ts computeTemplateApply now stores only what
  // the funnel DIFFERS from its template by, so the column shadows only leaves
  // the operator actually authored and an arm's own template decides the rest
  // (driven fork→apply→render proof in test/leadgen-p8-m3-apply-template.ts's
  // "F-2" legs). The count below is therefore a real number again on an applied
  // funnel; the zero-case copy stays for the case it was always true of — a
  // funnel whose OWN authored settings already decide every leaf this template
  // sets. It is still deliberately scoped to the leaves THIS TEMPLATE SETS: a
  // leaf the current arm's template authors and the chosen one does not is
  // outside what this page can resolve (it would need the other template's
  // family defaults), so the zero-case copy claims only what it can prove and
  // never the stronger "the two arms are identical".
  function currentEffectiveFrame() { return (boot && boot.frame && boot.frame.effective_frame) || {}; }
  // The layers that merge ABOVE a saved template's defaults on a served arm.
  function shadowLayers() {
    var layers = [];
    var stored = (boot && boot.frame && boot.frame.frame_config) || null;
    if (isRecord(stored)) { layers.push(stored); }
    var onBootFunnel = boot && targetFunnelPublicId() === boot.funnel_public_id;
    var overrides = (onBootFunnel && boot) ? boot.overrides : null;
    if (isRecord(overrides)) { layers.push(overrides); }
    return layers;
  }
  function pinnedAbove(path) {
    var layers = shadowLayers();
    var i;
    for (i = 0; i < layers.length; i++) { if (getPath(layers[i], path) !== undefined) { return true; } }
    return false;
  }
  // Every leaf that would move on the new arm, counted. Deliberately a COUNT
  // and not a sentence: designs/frames.ts computeTemplateApply already owns the
  // operator register for "what changes" (the apply dialog paints its words
  // above), and a second set of sentences here would be two wordings for one
  // event — the drift this slice exists to remove. Walks the template's OWN
  // leaves (records recurse; arrays and scalars are leaves, exactly how
  // effectiveFrame's mergeInto treats them).
  function sameLeaf(a, b) {
    if (a === b) { return true; }
    if (a === null || b === null || a === undefined || b === undefined) { return false; }
    if (typeof a !== 'object' && typeof b !== 'object') { return false; }
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function countArmChanges(cand, prefix, acc) {
    var cur = currentEffectiveFrame();
    var key;
    var path;
    var value;
    for (key in cand) {
      if (!Object.prototype.hasOwnProperty.call(cand, key)) { continue; }
      if (prefix === '' && (key === 'template' || key === 'version')) { continue; }
      path = prefix === '' ? key : prefix + '.' + key;
      value = cand[key];
      if (isRecord(value)) { acc = countArmChanges(value, path, acc); continue; }
      if (value === undefined) { continue; }
      if (pinnedAbove(path)) { continue; }
      if (sameLeaf(getPath(cur, path), value)) { continue; }
      acc = acc + 1;
    }
    return acc;
  }
  function renderApplyChoices() {
    var box = byId('lg-tpl-apply-choices');
    if (!box) { return; }
    clearChildren(box);
    var i;
    for (i = 0; i < templates.length; i++) {
      (function (tpl) {
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'lg-tpl2-apply-card';
        card.setAttribute('data-apply-choice', tpl.public_id);
        var name = document.createElement('span');
        name.className = 'lg-tpl2-apply-name';
        name.appendChild(text(tpl.name));
        var summary = document.createElement('span');
        summary.className = 'lg-tpl2-apply-summary';
        summary.appendChild(text(templateSummary(tpl.frame_json)));
        card.appendChild(name);
        card.appendChild(summary);
        // The confirm state is entered by the dry run's answer, never before
        // it: a template whose preview failed must not show promises.
        card.addEventListener('click', function () { openApplyConfirm(tpl); });
        box.appendChild(card);
      }(templates[i]));
    }
  }
  function wireApplyDialog() {
    var openBtn = byId('lg-tpl-apply-btn');
    var dialog = byId('lg-tpl-apply-dialog');
    var cancelBtn = byId('lg-tpl-apply-cancel-btn');
    var backBtn = byId('lg-tpl-apply-back-btn');
    var confirmBtn = byId('lg-tpl-apply-confirm-btn');
    if (openBtn && dialog) {
      openBtn.addEventListener('click', function () {
        applyChosenTemplate = null;
        hideError('lg-tpl-apply-error');
        renderApplyChoices();
        applyDialogShowState('choose');
        dialog.className = dialog.className.replace(/\\s*lg-hidden/g, '');
      });
    }
    function closeDialog() { if (dialog) { dialog.className = dialog.className + ' lg-hidden'; } }
    if (cancelBtn) { cancelBtn.addEventListener('click', closeDialog); }
    if (backBtn) { backBtn.addEventListener('click', function () { applyDialogShowState('choose'); }); }
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        // P8-1 S1.6 (B3/R6-1): target the carried funnel when present.
        var targetFunnel = targetFunnelPublicId();
        if (!applyChosenTemplate || !boot || !targetFunnel) { return; }
        fetchJson(LG_API + '/funnels/' + encodeURIComponent(targetFunnel) + '/apply-template', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ template_id: applyChosenTemplate.id })
        }).then(function (res) {
          if (!res.ok) { showError('lg-tpl-apply-error', (res.body && res.body.error) || 'Apply failed.'); return; }
          window.location.reload();
        });
      });
    }
  }

  // --- A/B templates -----------------------------------------------------
  // R2 P8 S4.2 (§6 M3, A/B leg): the two arms were measured byte-identical, so
  // the operator could start a test that can never produce a result. Two
  // separate reasons, and this island can only speak to them honestly:
  //   * IDENTITY — nothing said which template the funnel already uses, so
  //     picking that one forked an arm that differs in no way at all. The
  //     board blob already carries funnel.frame_template_id (funnel.ts
  //     boardDataBlob), so that option is now named as the current one.
  //   * SHADOWING — an arm resolves template defaults UNDER the funnel's own
  //     frame_config (resolver.ts variant.frame_template_id ??
  //     funnel.frame_template_id -> effectiveFrame's base layer), so a leaf the
  //     funnel's own config carries can still render identically on both arms.
  //     The line below counts, with the SAME rules the apply dialog uses, what
  //     the new arm would actually change — 0 means the two arms would look the
  //     same, said before the fork rather than discovered after it.
  //     R2 P8 FIX ROUND F4 (F-2): the shadowing WAS the apply path's defect and
  //     is now FIXED there (frames.ts computeTemplateApply stores the funnel's
  //     differences from its template, never a copy of it), so this count is a
  //     real number on an applied funnel instead of a permanent 0.
  function abCurrentTemplateId() {
    var f = boardFunnelBy(targetFunnelPublicId());
    return (f && f.frame_template_id !== null && f.frame_template_id !== undefined) ? String(f.frame_template_id) : '';
  }
  function abEffectLine() {
    var el = byId('lg-tpl-ab-effect');
    var select = byId('lg-tpl-ab-template-select');
    if (!el) { return; }
    clearChildren(el);
    var chosen = (select && select.value) ? findTemplateByDbId(select.value) : null;
    if (!chosen) { return; }
    if (String(chosen.id) === abCurrentTemplateId()) {
      el.appendChild(text('This funnel already uses this template \\u2014 both arms would look the same.'));
      return;
    }
    var total = countArmChanges(chosen.frame_json || {}, '', 0);
    if (total === 0) {
      el.appendChild(text('Nothing this template sets would change on the new arm \\u2014 this funnel\\u2019s own saved layout settings already decide those.'));
      return;
    }
    el.appendChild(text('The new arm differs from the current one in ' + total + (total === 1 ? ' layout setting.' : ' layout settings.')));
  }
  function findTemplateByDbId(dbId) {
    var i;
    for (i = 0; i < templates.length; i++) { if (String(templates[i].id) === String(dbId)) { return templates[i]; } }
    return null;
  }
  function wireAbTemplatesDialog() {
    var openBtn = byId('lg-tpl-ab-btn');
    var dialog = byId('lg-tpl-ab-dialog');
    var cancelBtn = byId('lg-tpl-ab-cancel-btn');
    var confirmBtn = byId('lg-tpl-ab-confirm-btn');
    var select = byId('lg-tpl-ab-template-select');
    if (select) { select.addEventListener('change', abEffectLine); }
    if (openBtn && dialog) {
      openBtn.addEventListener('click', function () {
        hideError('lg-tpl-ab-error');
        if (select) {
          clearChildren(select);
          var currentId = abCurrentTemplateId();
          var i;
          for (i = 0; i < templates.length; i++) {
            var o = document.createElement('option');
            o.value = templates[i].id;
            o.appendChild(text(templates[i].name + (String(templates[i].id) === currentId ? ' (this funnel\\u2019s current template)' : '')));
            select.appendChild(o);
          }
        }
        abEffectLine();
        dialog.className = dialog.className.replace(/\\s*lg-hidden/g, '');
      });
    }
    function closeDialog() { if (dialog) { dialog.className = dialog.className + ' lg-hidden'; } }
    if (cancelBtn) { cancelBtn.addEventListener('click', closeDialog); }
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        // P8-1 S1.6 (B3/R6-1): target the carried funnel/variant when present.
        var targetFunnelForAb = targetFunnelPublicId();
        var targetVariantForAb = targetVariantPublicId();
        if (!boot || !targetVariantForAb || !targetFunnelForAb || !select || !select.value) { return; }
        var templateId = select.value;
        var funnelId = targetFunnelForAb;
        var variantId = targetVariantForAb;

        function ensureRunningThenFork() {
          return fetchJson(LG_API + '/quotes/' + encodeURIComponent(boot.quote_public_id) + '/structure', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
            .then(function (structRes) {
              var funnels = (structRes.ok && structRes.body && structRes.body.funnels) ? structRes.body.funnels : [];
              var i;
              var funnel = null;
              for (i = 0; i < funnels.length; i++) { if (funnels[i].public_id === funnelId) { funnel = funnels[i]; } }
              var abTests = funnel ? (funnel.ab_tests || []) : [];
              var running = null;
              for (i = 0; i < abTests.length; i++) { if (abTests[i].status === 'running') { running = abTests[i]; } }
              if (running) { return Promise.resolve(true); }
              return fetchJson(LG_API + '/funnels/' + encodeURIComponent(funnelId) + '/experiments', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'content-type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({})
              }).then(function (createRes) {
                if (!createRes.ok || !createRes.body || !createRes.body.public_id) { throw new Error((createRes.body && createRes.body.error) || 'Could not create an A/B test.'); }
                return fetchJson(LG_API + '/experiments/' + encodeURIComponent(createRes.body.public_id) + '/start', {
                  method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }
                });
              }).then(function (startRes) {
                if (startRes && !startRes.ok) { throw new Error((startRes.body && startRes.body.error) || 'Could not start the A/B test.'); }
                return true;
              });
            });
        }

        ensureRunningThenFork().then(function () {
          return fetchJson(LG_API + '/variants/' + encodeURIComponent(variantId) + '/fork', {
            method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }
          });
        }).then(function (forkRes) {
          if (!forkRes.ok || !forkRes.body || !forkRes.body.public_id) { throw new Error((forkRes.body && forkRes.body.error) || 'Fork failed.'); }
          return fetchJson(LG_API + '/variants/' + encodeURIComponent(forkRes.body.public_id), {
            method: 'PUT', credentials: 'same-origin',
            headers: { 'content-type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ frame_template_id: parseInt(templateId, 10) })
          });
        }).then(function (putRes) {
          if (!putRes.ok) { throw new Error((putRes.body && putRes.body.error) || 'Could not set the new arm\\u2019s template.'); }
          window.location.reload();
        }).catch(function (err) {
          showError('lg-tpl-ab-error', (err && err.message) || 'A/B templates failed.');
        });
      });
    }
  }

  // --- P8-1 F1: WHICH funnel this panel edits, said out loud ---------------
  function paintTargetHeader() {
    var name = targetFunnelName();
    var nameEl = byId('lg-tpl-target-name');
    if (nameEl) {
      clearChildren(nameEl);
      nameEl.appendChild(text(name !== '' ? name : 'this funnel'));
    }
    var sel = byId('lg-tpl-target-select');
    if (!sel) { return; }
    var fs = boardFunnels();
    if (fs.length === 0) { return; }
    var want = targetFunnelPublicId();
    clearChildren(sel);
    var i;
    for (i = 0; i < fs.length; i++) {
      var opt = document.createElement('option');
      opt.value = fs[i].public_id;
      opt.appendChild(text(fs[i].name));
      if (fs[i].public_id === want) { opt.selected = true; }
      sel.appendChild(opt);
    }
    sel.value = want;
  }
  // Re-read the newly targeted funnel's own layout state (GET /funnels/:id/
  // frame — the SAME body ui-quotes.ts seeds boot.frame from), so the canvas
  // stops previewing the editor-selected funnel's frame over another funnel's
  // variant, then re-render.
  // P8-1 F5 (B3/R6-1, defect D): this panel's CONTROLS are not this island's
  // — the element groups, the dynamic lists and the media fields beside the
  // canvas are populated and written by quotes-tabs/funnel.ts's island
  // (delegated [data-frame-key]/[data-tplbox-*] wiring over the whole
  // #lg-quote-editor subtree; see this file's header). Only the canvas
  // followed the target switch, so the operator read Funnel A's control
  // values while the canvas rendered the target. Hand that island the frame
  // body ALREADY fetched here — one GET, two consumers, no second request.
  function announceTargetFunnelFrame(pub, frame) {
    try {
      var evt = document.createEvent('CustomEvent');
      evt.initCustomEvent('lg:target-funnel-frame', true, false, { funnel_public_id: pub, frame: frame });
      document.dispatchEvent(evt);
    } catch (e) { /* engines without createEvent: the save chain still resolves its target from the hash */ }
  }
  function syncFrameToTargetFunnel() {
    // P8-1 F6: named targetFunnel, not f — this island also binds the name f
    // to a BOARD ROW (boardFunnelBy) two functions up, and the closed-set
    // proof in test/leadgen-p8-b3-funnel-identity.test.ts decides "is this URL
    // built from the target resolver?" by following the identifier's
    // assignments. One name, one meaning: every targetFunnel here is the
    // resolver's answer.
    var targetFunnel = targetFunnelPublicId();
    if (!targetFunnel) { renderCanvasPreview(); return; }
    fetchJson(LG_API + '/funnels/' + encodeURIComponent(targetFunnel) + '/frame', {
      credentials: 'same-origin', headers: { Accept: 'application/json' }
    }).then(function (res) {
      if (res.ok && res.body) {
        myFrame = deepClone(res.body.frame_config || {}) || {};
        if (boot) { boot.frame = res.body; }
        announceTargetFunnelFrame(targetFunnel, res.body);
      }
      renderCanvasPreview();
    });
  }
  function onTargetFunnelChanged() {
    paintTargetHeader();
    syncFrameToTargetFunnel();
  }
  function announceTargetFunnel(pub) {
    var delivered = false;
    try {
      var evt = document.createEvent('CustomEvent');
      evt.initCustomEvent('lg:target-funnel-change', true, false, { funnel_public_id: pub });
      document.dispatchEvent(evt);
      delivered = true;
    } catch (e) { delivered = false; }
    if (!delivered) { onTargetFunnelChanged(); }
  }
  function wireTargetPicker() {
    var sel = byId('lg-tpl-target-select');
    if (!sel) { return; }
    sel.addEventListener('change', function (ev) {
      var el = (ev && ev.target) ? ev.target : sel;
      // Only THIS panel's picker (its own marker attribute) switches funnels —
      // this island also listens for change events on the whole document.
      if (!el.getAttribute || el.getAttribute('data-lg-target-funnel') === null) { return; }
      var next = el.value || '';
      if (next === '') { return; }
      lgSetHashParam('funnel', next);
      announceTargetFunnel(next);
    });
    document.addEventListener('lg:target-funnel-change', function () { onTargetFunnelChanged(); });
  }

  // --- init ---------------------------------------------------------------
  function init() {
    boot = loadBoot();
    myFrame = deepClone((boot && boot.frame && boot.frame.frame_config) || {}) || {};
    lastRealProgressStyle = (boot && boot.frame && boot.frame.effective_frame && boot.frame.effective_frame.progress && boot.frame.effective_frame.progress.style !== 'hidden')
      ? boot.frame.effective_frame.progress.style
      : 'bar';

    document.addEventListener('change', onFrameKeyChange);
    document.addEventListener('click', onRolePickClick);
    // R2 §3 ② — every Templates-panel edit re-renders the canvas (the C-H
    // rows included; see onPanelEdit / overlayListGroups).
    document.addEventListener('input', onPanelEdit);
    document.addEventListener('change', onPanelEdit);
    document.addEventListener('click', onPanelEdit);
    // R2 P3 (element J) D2 — "Load pages from the preview site…" (own
    // listener: this populates candidate rows, a DIFFERENT concern from
    // onPanelEdit's "re-render the canvas on any edit").
    document.addEventListener('click', function (ev) {
      var el = ev.target;
      if (el && el.closest && el.closest('[data-footer-picks-load]')) { fetchFooterPicks(el); }
    });
    wireProgressToggle();
    syncProgressToggleUi();
    syncProgressIconRow();
    syncRadioActiveClasses();

    // P8-1 F1: name the target funnel + wire its picker before the first
    // canvas render, and — when the operator returns to a persisted target
    // that is NOT the funnel this page was opened on (a reload, or a chip
    // click into a different column) — read THAT funnel's own layout state
    // instead of previewing this page's boot frame over it.
    paintTargetHeader();
    wireTargetPicker();
    if (boot && targetFunnelPublicId() !== boot.funnel_public_id) { syncFrameToTargetFunnel(); }

    populateThemeSwitcher();
    wireThemeCreateAffordance();
    populateSiteSelect();
    populateSectionPicker(); // triggers the first canvas render on resolve
    wireTemplateBar();
    wireApplyDialog();
    wireAbTemplatesDialog();
    loadTemplates();
    loadQuoteDefaultTemplate();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}());
`;


// Round-4 P5b: before this rebuild, the Templates tab was the retired v2.x
// box-picker panels; §8.3 rebuild adds
// the I·Progress box, a live real-section canvas, and the saved-template bar
// — the pre-existing 6-arrangement frame-template picker stays canvas-
// embedded in the Funnel builder tab (`renderTemplatePicker`, quotes-tabs/
// shared.ts — unchanged, out of this slice); `#lg-template-btn` keeps its own
// unchanged inline toggle into that canvas-embedded card.
export function renderTemplatesTabPanel(isControl: boolean, answerFields: readonly QuoteRulesRailAnswerField[]): string {
  void isControl; // reserved: no per-arm override switch on the box-picker element groups (funnel-wide only) — see the section header doc comment.
  return `<div class="lg-qpanel" data-panel="templates">
  <style>${TPL_STYLES}</style>
  ${renderTemplateBar()}
  <div class="lg-tpl2-shell" id="lg-tpl-shell">
    <div class="lg-tpl2-left">${renderElementsList()}</div>
    <div class="lg-tpl2-center">${renderCanvas()}</div>
    <div class="lg-tpl2-right">${renderSettingsColumn(answerFields)}</div>
  </div>
  ${renderApplyDialog()}
  ${renderAbTemplatesDialog()}
  ${renderFooterLinkModal()}
  <script>${TPL_SCRIPT}</script>
</div>`;
}
