// LeadGen admin UI — Quotes editor, TEMPLATES tab module (LEADGEN-REWORK-03
// §12 P3a mechanical split of ui-quotes.ts). Round-4 P5b's "seven box
// pickers" (Background/Logo/CTA/Disclosure/Free text/Brand logos/Footer/
// Images) — each box a card opening its own right-side editor, reusing the
// shared frameControl/frameSelect/mediaPickerControl widget kit (./shared).
// P4 (Templates + Themes tabs, §8.3) owns this file next.
// PURE MOVE from ui-quotes.ts — zero logic/behavior change (P3a phase gate:
// test/leadgen-p3a-split-parity.test.ts asserts byte-identical SSR output).

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
  FRAME_SIZES,
  FRAME_TYPO_SIZES,
} from "../../../public/leadgen/designs/frames";
import { FUNNEL_TOKEN_ROLES } from "../../../public/leadgen/designs/theme";
import { type RoutingBuilderData } from "../ui-rules-builder";
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
  renderTemplatePicker,
} from "./shared";


// ---------------------------------------------------------------------------
// Round-4 P5b — TEMPLATES TAB: the seven box pickers (operator restructure
// spec B-3). Each box is a card that opens its OWN right-side editor, reusing
// the EXISTING inspector-panel idioms (frameControl/frameCheck/frameSelect/
// mediaPickerControl/renderRoleStrip/renderFrameList) and the SAME
// `.lg-inspector-panel`-style mutually-exclusive show/hide (a dedicated
// `data-tplbox-panel` attribute + `showTplBoxPanel` in the island, kept
// independent of the canvas's `data-region-panel`/`showRegionPanel` so the
// two navigation surfaces (canvas click-select vs. box-card click) never
// cross-wire). Boxes A (Background) and B (Logo) edit the SAME
// `background.*` / `header.logo_*` keys the canvas-click Background/Header
// inspectors already own — the SAME `data-frame-key` names are reused
// (harmless duplicates: `populateAllControls` targets EVERY matching element
// and `activate()` repaints on every tab switch, so both copies always agree)
// rather than moving those inspectors (moving them would strand the
// canvas-click-to-select mechanism those two groups share with the other
// eight region inspectors). Boxes C–G are Round-4 P5a's NEW authorable
// elements (cta_slots / disclosure.entries / free_text / brand_logos /
// footer.blocks) — this is their FIRST authoring surface.
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

function ctaConditionFieldOptions(answerFields: RoutingBuilderData["fields"], selected: string): string {
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
function renderCtaConditionRowTemplate(answerFields: RoutingBuilderData["fields"]): string {
  return `<div class="lg-list-row" data-cta-cond-row>
    <select class="form-select form-select-sm" data-cta-cond-field aria-label="Condition field">${ctaConditionFieldOptions(answerFields, "__state")}</select>
    <select class="form-select form-select-sm" data-cta-cond-op aria-label="Condition comparison">${ctaConditionOpOptions("eq")}</select>
    <input class="form-input" data-cta-cond-value placeholder="value" aria-label="Condition value" />
    <button type="button" class="btn btn-sm btn-outline" data-cta-cond-row-remove aria-label="Remove condition">&#10005;</button>
  </div>`;
}

function renderCtaSlotRowTemplate(answerFields: RoutingBuilderData["fields"]): string {
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

function renderTplBoxCta(answerFields: RoutingBuilderData["fields"]): string {
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
function renderFooterLinkRowTemplate(): string {
  return `<div class="lg-list-row" data-footer-link-row>
    <input class="form-input" data-footer-link-label placeholder="Label" aria-label="Footer link label" />
    <input class="form-input" data-footer-link-href placeholder="https://… or /page" aria-label="Footer link address" />
    <button type="button" class="btn btn-sm btn-outline" data-footer-link-remove aria-label="Remove link">&#10005;</button>
  </div>`;
}

function renderFooterBlockRowTemplate(): string {
  return `<div class="lg-tplbox-row" data-footer-block-row>
    <div class="lg-list-row">
      <select class="form-select form-select-sm" data-footer-block-type aria-label="Footer block type">${enumOptions(FRAME_FOOTER_BLOCK_TYPES, { about_paragraph: "About paragraph", link_row: "Link row", disclosure: "Disclosure", logo: "Logo", address: "Address", socials: "Social links" })}</select>
      <select class="form-select form-select-sm" data-footer-block-align aria-label="Footer block alignment">${enumOptions(FRAME_ELEMENT_ALIGNS, { left: "Left", center: "Center", right: "Right" })}</select>
      <span class="lg-row-rail">
        <button type="button" class="btn btn-sm btn-outline" data-footer-block-up aria-label="Move block up">&#8593;</button>
        <button type="button" class="btn btn-sm btn-outline" data-footer-block-down aria-label="Move block down">&#8595;</button>
        <button type="button" class="btn btn-sm btn-outline" data-footer-block-remove aria-label="Remove block">&#10005;</button>
      </span>
    </div>
    <textarea class="form-input" rows="2" data-footer-block-text placeholder="About / disclosure / address copy" aria-label="Footer block text"></textarea>
    <div class="lg-hidden" data-footer-block-linkrow>
      <div class="form-group"><label class="form-label">Links source</label>
        <select class="form-select form-select-sm" data-footer-block-linksource aria-label="Footer link row source">
          <option value="site">From site settings (legal links)</option>
          <option value="manual">Manual list</option>
        </select>
      </div>
      <div data-footer-block-links></div>
      <button type="button" class="btn btn-sm btn-secondary" data-footer-block-link-add>+ Add link</button>
    </div>
  </div>`;
}

function renderTplBoxFooter(): string {
  return `<div class="lg-inspector-panel lg-panel-card" data-tplbox-panel="footer">
  <h3>G &middot; Footer</h3>
  <p class="form-help">Bottom-of-page blocks (about / links / disclosure / logo / address / socials), with their own palette and typography.</p>
  <h4>Palette &amp; typography scope</h4>
  <div class="lg-scalars">
    ${frameControl("Background", renderRoleStrip("footer.palette_scope.background"))}
    ${frameControl("Text", renderRoleStrip("footer.palette_scope.text"))}
    ${frameControl("Links", renderRoleStrip("footer.palette_scope.link"))}
  </div>
  ${frameSelect("Text size", "footer.typography_scope.size", FRAME_TYPO_SIZES, { s: "Small", m: "Medium", l: "Large", xl: "Extra large" })}
  <h4>Blocks</h4>
  <div data-tplbox-list="footer.blocks"></div>
  <template data-tplbox-tpl="footer.blocks">${renderFooterBlockRowTemplate()}</template>
  <template data-tplbox-tpl="footer_link_row">${renderFooterLinkRowTemplate()}</template>
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


const TPLBOX_CARDS: ReadonlyArray<{ key: string; letter: string; label: string }> = [
  { key: "background", letter: "A", label: "Background" },
  { key: "logo", letter: "B", label: "Logo" },
  { key: "cta", letter: "C", label: "Phone / URL" },
  { key: "disclosure", letter: "D", label: "Disclosure" },
  { key: "free_text", letter: "E", label: "Free text" },
  { key: "brand_logos", letter: "F", label: "Brand logos" },
  { key: "footer", letter: "G", label: "Footer" },
  { key: "images", letter: "H", label: "Images" },
];


function renderTemplateBoxPickers(answerFields: RoutingBuilderData["fields"]): string {
  const cards = TPLBOX_CARDS.map(
    (c) =>
      `<button type="button" class="lg-tplbox-card" data-tplbox-pick="${escapeHtml(c.key)}">
    <span class="lg-tplbox-card-letter">${escapeHtml(c.letter)}</span>
    <span>${escapeHtml(c.label)}</span>
  </button>`,
  ).join("");
  return `<div class="lg-panel-card">
  <h3>Funnel-layout elements</h3>
  <p class="form-help">Choose a box to open its editor.</p>
  <div class="lg-tplbox-grid" id="lg-tplbox-grid">${cards}</div>
  <div class="lg-tplbox-editor" id="lg-tplbox-editor">
    <p class="form-help" id="lg-tplbox-hint">Choose a box above to edit it.</p>
    ${renderTplBoxBackground()}
    ${renderTplBoxLogo()}
    ${renderTplBoxCta(answerFields)}
    ${renderTplBoxDisclosure()}
    ${renderTplBoxFreeText()}
    ${renderTplBoxBrandLogos()}
    ${renderTplBoxFooter()}
    ${renderTplBoxImages()}
  </div>
</div>`;
}


// Round-4 P5b: the Templates tab is EXACTLY the seven box pickers (operator
// restructure spec deliverable 2). The pre-existing 6-arrangement frame-
// template picker stays canvas-embedded (see renderTemplatePicker's doc
// comment for the reported conflict this resolves) — `#lg-template-btn`
// keeps its own, unchanged inline toggle into that canvas-embedded card.
export function renderTemplatesTabPanel(isControl: boolean, answerFields: RoutingBuilderData["fields"]): string {
  void isControl; // reserved: no per-arm override switch on the P5a element groups (funnel-wide only) — see the section header doc comment.
  return `<div class="lg-qpanel" data-panel="templates">
  ${renderTemplateBoxPickers(answerFields)}
</div>`;
}
