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
  FRAME_PROGRESS_POSITIONS,
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
  mediaFieldMarkup,
  mediaPickerControl,
  renderFrameList,
} from "./shared";


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


function renderTplBoxLogo(): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-tplbox-panel="logo">
  <h3>B &middot; Logo</h3>
  <p class="form-help">The header logo &mdash; sourced from the selected preview site's branding by default (10 &sect;10.1).</p>
  ${frameSelect("Logo source", "header.logo_source", ["site", "cms_fallback"], { site: "Site logo (auto)", cms_fallback: "CMS fallback" })}
  ${frameSelect("Logo size", "header.logo_size", FRAME_SIZES, { s: "Small", m: "Medium", l: "Large" })}
  ${frameSelect("Alignment", "header.logo_align", FRAME_LOGO_ALIGNS, { left: "Left", center: "Center" })}
  <p class="form-help">For a manual logo override, open the Header region on the canvas (Funnel builder tab) &rarr; Advanced.</p>
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
// candidate page). `data-footer-pick-pagetype` carries the stable identity
// (never the page's row id — see leadgen/branding.ts's resolver comment on
// why); the label starts pre-filled from the page's title but stays
// author-editable (the SAME saved label rides every serving site).
function renderFooterPickRowTemplate(): string {
  return `<div class="lg-list-row" data-footer-pick-row>
    <label class="lg-check"><input type="checkbox" data-footer-pick-checked /> <span data-footer-pick-title></span></label>
    <input type="hidden" data-footer-pick-pagetype />
    <input class="form-input" data-footer-pick-label placeholder="Label" aria-label="Picked page label" />
    <input class="form-input" data-footer-pick-manualurl placeholder="Fallback URL if a site has no match (https://…)" aria-label="Picked page fallback URL" />
  </div>`;
}

function renderFooterBlockRowTemplate(): string {
  return `<div class="lg-tplbox-row" data-footer-block-row>
    <div class="lg-list-row">
      <select class="form-select form-select-sm" data-footer-block-type aria-label="Footer block type">${enumOptions(FRAME_FOOTER_BLOCK_TYPES, { about_paragraph: "About paragraph / company details", link_row: "Link row", disclosure: "Disclosure", logo: "Logo", address: "Address", socials: "Social links", heading: "Heading", list: "List" })}</select>
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

function renderTplBoxFooter(): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-tplbox-panel="footer">
  <h3>G &middot; Footer</h3>
  <p class="form-help">Bottom-of-page blocks (company details / links / disclosure / logo / address / socials / heading / list), with their own palette, font family and sizes &mdash; independent of the main template.</p>
  <h4>Palette &amp; typography scope</h4>
  <div class="lg-scalars">
    ${frameControl("Background", renderRoleStrip("footer.palette_scope.background"))}
    ${frameControl("Text", renderRoleStrip("footer.palette_scope.text"))}
    ${frameControl("Links", renderRoleStrip("footer.palette_scope.link"))}
  </div>
  ${frameSelect("Font family", "footer.typography_scope.font_family", THEME_RECORD_FONT_NAMES, undefined, "Independent of the main template's font.")}
  ${frameSelect("Text size", "footer.typography_scope.size", FRAME_TYPO_SIZES, { s: "Small", m: "Medium", l: "Large", xl: "Extra large" })}
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
  <h3>H &middot; Images</h3>
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

const PROGRESS_TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "bar", label: "Bar" },
  { value: "dots", label: "Dots" },
  { value: "numbered", label: "Numbered" },
  { value: "percent", label: "Percent" },
  { value: "icon_on_track", label: "Icon on track" },
];

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

function renderTplBoxProgress(): string {
  return `<div class="lg-inspector-panel lg-panel-card active" data-tplbox-panel="progress">
  <h3>I &middot; Progress</h3>
  <p class="form-help">Shows visitors how far through the funnel they are.</p>

  <div class="lg-tpl2-eyebrow">Style</div>
  ${renderProgressTypePicker()}
  <p class="form-help">5 real styles (Bar/Dots/Numbered/Percent/Icon on track) &mdash; "Hidden" is the toggle below, not a 6th style.</p>

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
  ${toggleControl("Show label", "progress.show_label", 'e.g. "Step 2 of 5" next to the bar')}
  <p class="lg-region-note">Progress counts the slides of this funnel variant automatically.</p>
</div>`;
}


const TPLBOX_CARDS: ReadonlyArray<{ key: string; letter: string; label: string }> = [
  { key: "background", letter: "A", label: "Background" },
  { key: "logo", letter: "B", label: "Logo" },
  { key: "cta", letter: "C", label: "Phone / URL" },
  { key: "disclosure", letter: "D", label: "Disclosure" },
  { key: "free_text", letter: "E", label: "Free text" },
  { key: "brand_logos", letter: "F", label: "Brand logos" },
  { key: "footer", letter: "G", label: "Footer" },
  { key: "images", letter: "H", label: "Images" },
  { key: "progress", letter: "I", label: "Progress" },
];


// ---------------------------------------------------------------------------
// §8.3 layout — LEFT elements list (292px). "Progress" (I) is pre-selected on
// load (matching the pack's Pin 1), so the settings column starts non-empty.
// ---------------------------------------------------------------------------

function renderElementsList(): string {
  const cards = TPLBOX_CARDS.map(
    (c) =>
      `<button type="button" class="lg-tplbox-card${c.key === "progress" ? " selected" : ""}" data-tplbox-pick="${escapeHtml(c.key)}">
    <span class="lg-tplbox-card-letter">${escapeHtml(c.letter)}</span>
    <span>${escapeHtml(c.label)}</span>
  </button>`,
  ).join("");
  return `<div class="lg-tpl2-eyebrow">Funnel-layout elements</div>
  <div class="lg-tplbox-grid" id="lg-tplbox-grid">${cards}</div>`;
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
    ${renderTplBoxFooter()}
    ${renderTplBoxImages()}
    ${renderTplBoxProgress()}
  </div>`;
}


// ---------------------------------------------------------------------------
// §8.3 CENTER — live canvas. Toolbar (theme switcher + "+ New theme…"
// affordance + section picker + preview-site select) and a server-rendered
// srcdoc iframe, populated entirely by the inline script below through the
// ONE preview endpoint (POST /variants/:id/preview — see the top-of-file doc
// comment for why this can't reuse funnel.ts's private `renderPreview`/
// `schedulePreview` closures).
// ---------------------------------------------------------------------------

function renderCanvas(): string {
  return `<div class="lg-tpl2-canvas-shell">
    <div class="lg-tpl2-canvas-toolbar" id="lg-tpl-canvas-toolbar">
      <select class="form-select form-select-sm" id="lg-tpl-theme-select" aria-label="Theme switcher" style="max-width:180px">
        <option value="">Current theme</option>
      </select>
      <button type="button" class="btn btn-sm btn-outline" id="lg-tpl-theme-create" title="Create a theme in the Themes tab">+ New theme&#8230;</button>
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
  return `<div class="lg-panel-card" id="lg-tpl-bar">
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
.lg-tpl2-tpl-menu{position:absolute;top:100%;left:0;z-index:5;background:var(--c-card,#fff);border:1px solid var(--c-border);border-radius:6px;box-shadow:0 4px 14px rgba(16,24,40,.16);padding:4px;display:flex;flex-direction:column;min-width:140px;margin-top:4px}
.lg-tpl2-tpl-menu button{display:block;width:100%;text-align:left;padding:6px 8px;font-size:12px;color:var(--c-text);white-space:nowrap}
.lg-tpl2-tpl-menu button:hover{background:var(--c-bg,#f6f7f9)}
.lg-tpl2-new-form{align-items:center}
.lg-tpl2-ptype-grid{display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap}
.lg-tpl2-ptype{display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 6px;border:1px solid var(--c-border);border-radius:8px;background:var(--c-card,#fff);flex:1 1 0;min-width:56px;cursor:pointer;position:relative}
.lg-tpl2-ptype input{position:absolute;opacity:0;width:100%;height:100%;top:0;left:0;margin:0;cursor:pointer}
.lg-tpl2-ptype.active{border-color:var(--c-primary,#1B3A5C);border-width:2px;background:var(--c-bg,#f6f7f9)}
.lg-tpl2-ptype-thumb{width:32px;height:14px;border-radius:3px;background:var(--c-border);display:block}
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
// ---------------------------------------------------------------------------

const TPL_SCRIPT = `
(function () {
  'use strict';
  var LG_API = '/api/admin/leadgen';
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
    if (!boot || !boot.selected_variant) { return; }
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
    fetchJson(LG_API + '/variants/' + encodeURIComponent(boot.selected_variant) + '/preview', {
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
    if (key === 'progress.style') { syncProgressToggleUi(); }
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
          var titleEl = q(row, '[data-footer-pick-title]');
          if (titleEl) { titleEl.appendChild(text(pages[i].title || pages[i].page_type)); }
          var typeEl = q(row, '[data-footer-pick-pagetype]');
          if (typeEl) { typeEl.value = pages[i].page_type || ''; }
          var labelEl = q(row, '[data-footer-pick-label]');
          if (labelEl) { labelEl.value = pages[i].title || ''; }
          list.appendChild(row);
        }
      })
      .catch(function () { /* the operator can still author a manual link_row instead */ });
  }

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
      if (hasText) { block.text = body; }
      if (hasHtml) { block.html = body; }
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

  function collectImages() {
    var rows = qa(tplListEl('images'), '[data-img-item-row]');
    var out = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var mediaId = valOf(rows[i], '[data-list-field="media_id"]');
      var url = valOf(rows[i], '[data-img-item-url]');
      var alt = valOf(rows[i], '[data-img-item-alt]');
      // PREVIEW-safe, same rule as the brand-logo items above: an image row
      // with no media/url yet cannot render and would 400 the whole preview.
      if (mediaId === '' && url === '') { continue; }
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
        empty.appendChild(text('No themes yet \\u2014 create one in the Themes tab'));
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
  function templateSummary(frameJson) {
    var bits = [];
    if (frameJson && frameJson.section_slot && frameJson.section_slot.card) { bits.push(frameJson.section_slot.card === 'card' ? 'Card layout' : 'Bare layout'); }
    if (frameJson && frameJson.progress && frameJson.progress.style) { bits.push(frameJson.progress.style === 'hidden' ? 'No progress bar' : (frameJson.progress.style + ' progress')); }
    if (frameJson && frameJson.footer && frameJson.footer.enabled === false) { bits.push('no footer'); }
    return bits.join(' \\u00b7 ');
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
  function diffSentences(candidateFrameJson) {
    var sentences = [];
    var cur = (boot && boot.frame && boot.frame.effective_frame) || {};
    var cand = candidateFrameJson || {};
    if (cur.section_slot && cand.section_slot && cur.section_slot.card !== cand.section_slot.card) {
      sentences.push('The question unit changes from a ' + (cur.section_slot.card === 'card' ? 'card' : 'bare layout') + ' to a ' + (cand.section_slot.card === 'card' ? 'card' : 'bare layout') + '.');
    }
    if (cur.footer && cand.footer && cur.footer.enabled !== cand.footer.enabled) {
      sentences.push(cand.footer.enabled ? 'The footer will be shown.' : 'The footer will be hidden.');
    }
    if (cur.trust_strip && cand.trust_strip && cur.trust_strip.enabled !== cand.trust_strip.enabled) {
      sentences.push(cand.trust_strip.enabled ? 'A trust strip will be added.' : "The trust strip isn't part of this template's arrangement.");
    }
    if (cur.benefit_bar && cand.benefit_bar && cur.benefit_bar.enabled !== cand.benefit_bar.enabled) {
      sentences.push(cand.benefit_bar.enabled ? 'A benefit bar will be added.' : "The benefit bar isn't part of this template's arrangement.");
    }
    if (cur.progress && cand.progress && cur.progress.style !== cand.progress.style) {
      sentences.push('Progress style changes from ' + cur.progress.style + ' to ' + cand.progress.style + '.');
    }
    if (sentences.length === 0) { sentences.push('This template keeps the same overall arrangement.'); }
    return sentences;
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
        card.addEventListener('click', function () {
          applyChosenTemplate = tpl;
          var list = byId('lg-tpl-apply-confirm-list');
          if (list) {
            clearChildren(list);
            var sentences = diffSentences(tpl.frame_json);
            var s;
            for (s = 0; s < sentences.length; s++) {
              var li = document.createElement('li');
              li.appendChild(text(sentences[s]));
              list.appendChild(li);
            }
          }
          applyDialogShowState('confirm');
        });
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
        if (!applyChosenTemplate || !boot || !boot.funnel_public_id) { return; }
        fetchJson(LG_API + '/funnels/' + encodeURIComponent(boot.funnel_public_id) + '/apply-template', {
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
  function wireAbTemplatesDialog() {
    var openBtn = byId('lg-tpl-ab-btn');
    var dialog = byId('lg-tpl-ab-dialog');
    var cancelBtn = byId('lg-tpl-ab-cancel-btn');
    var confirmBtn = byId('lg-tpl-ab-confirm-btn');
    var select = byId('lg-tpl-ab-template-select');
    if (openBtn && dialog) {
      openBtn.addEventListener('click', function () {
        hideError('lg-tpl-ab-error');
        if (select) {
          clearChildren(select);
          var i;
          for (i = 0; i < templates.length; i++) {
            var o = document.createElement('option');
            o.value = templates[i].id;
            o.appendChild(text(templates[i].name));
            select.appendChild(o);
          }
        }
        dialog.className = dialog.className.replace(/\\s*lg-hidden/g, '');
      });
    }
    function closeDialog() { if (dialog) { dialog.className = dialog.className + ' lg-hidden'; } }
    if (cancelBtn) { cancelBtn.addEventListener('click', closeDialog); }
    if (confirmBtn) {
      confirmBtn.addEventListener('click', function () {
        if (!boot || !boot.selected_variant || !boot.funnel_public_id || !select || !select.value) { return; }
        var templateId = select.value;
        var funnelId = boot.funnel_public_id;
        var variantId = boot.selected_variant;

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
    syncRadioActiveClasses();

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
  <script>${TPL_SCRIPT}</script>
</div>`;
}
